// @ts-check
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, authorize, clearJwksCache, parseOwners, parseServiceTokenIds } from '../src/auth.js';

const TEAM = 'https://team.example.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const OWNER = 'owner@example.com';
const NOW = Date.parse('2026-10-12T00:00:00Z');
const NOW_S = NOW / 1000;
const ENV = { TEAM_DOMAIN: TEAM, POLICY_AUD: AUD, OWNER_EMAIL: OWNER };

const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };

/** @param {string} kid */
async function makeKey(kid) {
  const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']));
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey: pair.privateKey, jwk };
}

const KEY = await makeKey('kid-1');
const OTHER_KEY = await makeKey('kid-1'); // same kid, different key material (forged)
const KEY2 = await makeKey('kid-2');

/** @param {unknown} v */
function b64url(v) {
  const bytes = v instanceof Uint8Array ? v : new TextEncoder().encode(JSON.stringify(v));
  return Buffer.from(bytes).toString('base64url');
}

/**
 * @param {Record<string, unknown>} claims overrides
 * @param {{key?: typeof KEY, alg?: string}} [opts]
 */
async function sign(claims, opts = {}) {
  const key = opts.key ?? KEY;
  const header = { alg: opts.alg ?? 'RS256', kid: key.kid, typ: 'JWT' };
  const payload = { iss: TEAM, aud: [AUD], email: OWNER, exp: NOW_S + 3600, nbf: NOW_S - 10, ...claims };
  const input = `${b64url(header)}.${b64url(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

/** @param {string | null} token @param {string} [url] */
function req(token, url = 'https://app.example.com/api/state') {
  return new Request(url, token === null ? {} : { headers: { 'Cf-Access-Jwt-Assertion': token } });
}

/** A fetch stub serving JWKS; counts calls. */
function jwksFetch(/** @type {JsonWebKey[]} */ keys) {
  const calls = /** @type {string[]} */ ([]);
  /** @type {any} */
  const fn = async (/** @type {string} */ url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: /** @type {typeof fetch} */ (fn), calls };
}

beforeEach(() => clearJwksCache());

test('a valid owner token is accepted and the certs URL is fetched from the team domain', async () => {
  const { fetch, calls } = jwksFetch([KEY.jwk]);
  const id = await authenticate(req(await sign({})), ENV, { now: NOW, fetch });
  assert.deepEqual(id, { email: OWNER });
  assert.deepEqual(calls, [`${TEAM}/cdn-cgi/access/certs`]);
});

test('aud as a plain string and as an array are both accepted', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  assert.ok(await authenticate(req(await sign({ aud: AUD })), ENV, { now: NOW, fetch }));
  assert.ok(await authenticate(req(await sign({ aud: ['other', AUD] })), ENV, { now: NOW, fetch }));
});

test('the email comparison is case-insensitive', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  assert.ok(await authenticate(req(await sign({ email: 'Owner@Example.COM' })), ENV, { now: NOW, fetch }));
});

test('rejections: missing token, wrong key, expired, not yet valid, wrong aud, wrong iss, wrong email', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const deps = { now: NOW, fetch };
  const cases = /** @type {[string, string | null][]} */ ([
    ['missing token', null],
    ['not a jwt', 'abc'],
    ['wrong key', await sign({}, { key: OTHER_KEY })],
    ['expired', await sign({ exp: NOW_S - 3600 })],
    ['not yet valid', await sign({ nbf: NOW_S + 3600 })],
    ['wrong aud (string)', await sign({ aud: 'nope' })],
    ['wrong aud (array)', await sign({ aud: ['nope'] })],
    ['missing aud', await sign({ aud: undefined })],
    ['wrong iss', await sign({ iss: 'https://evil.example.com' })],
    ['wrong email', await sign({ email: 'someone@example.com' })],
    ['no email', await sign({ email: undefined })],
    ['no exp', await sign({ exp: undefined })],
    ['alg none', await sign({}, { alg: 'none' })],
    ['alg HS256', await sign({}, { alg: 'HS256' })],
  ]);
  for (const [label, token] of cases) {
    assert.equal(await authenticate(req(token), ENV, deps), null, label);
  }
});

test('60 seconds of leeway on exp and nbf', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const deps = { now: NOW, fetch };
  assert.ok(await authenticate(req(await sign({ exp: NOW_S - 30 })), ENV, deps), 'expired 30 s ago still ok');
  assert.equal(await authenticate(req(await sign({ exp: NOW_S - 90 })), ENV, deps), null, 'expired 90 s ago rejected');
  assert.ok(await authenticate(req(await sign({ nbf: NOW_S + 30 })), ENV, deps), 'valid in 30 s still ok');
  assert.equal(await authenticate(req(await sign({ nbf: NOW_S + 90 })), ENV, deps), null, 'valid in 90 s rejected');
});

test('a tampered payload is rejected', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const [h, , s] = (await sign({})).split('.');
  const forged = `${h}.${b64url({ iss: TEAM, aud: [AUD], email: 'attacker@example.com', exp: NOW_S + 3600 })}.${s}`;
  assert.equal(await authenticate(req(forged), ENV, { now: NOW, fetch }), null);
});

test('missing configuration fails closed', async () => {
  const { fetch, calls } = jwksFetch([KEY.jwk]);
  const token = await sign({});
  for (const missing of ['TEAM_DOMAIN', 'POLICY_AUD', 'OWNER_EMAIL']) {
    const env = { ...ENV, [missing]: undefined };
    assert.equal(await authenticate(req(token), env, { now: NOW, fetch }), null, missing);
  }
  assert.equal(await authenticate(req(token), {}, { now: NOW, fetch }), null);
  assert.equal(calls.length, 0, 'no network without configuration');
});

test('DEV_NO_AUTH=1 bypasses auth on a local host; any other value does not', async () => {
  const { fetch } = jwksFetch([]);
  for (const url of ['http://localhost:8787/api/state', 'http://127.0.0.1:8787/api/state', 'http://[::1]:8787/api/state']) {
    assert.deepEqual(await authenticate(req(null, url), { DEV_NO_AUTH: '1' }, { now: NOW, fetch }), { email: 'dev@local' }, url);
    assert.equal(await authenticate(req(null, url), { DEV_NO_AUTH: 'true' }, { now: NOW, fetch }), null, url);
    assert.equal(await authenticate(req(null, url), { ...ENV, DEV_NO_AUTH: '0' }, { now: NOW, fetch }), null, url);
  }
});

test('DEV_NO_AUTH set in production is ignored: a non-local host fails closed, a valid token still works', async () => {
  const { fetch, calls } = jwksFetch([KEY.jwk]);
  const prod = 'https://fruitery.example.workers.dev/api/state';
  assert.equal(await authenticate(req(null, prod), { DEV_NO_AUTH: '1' }, { now: NOW, fetch }), null);
  assert.equal(await authenticate(req(null, prod), { ...ENV, DEV_NO_AUTH: '1' }, { now: NOW, fetch }), null);
  assert.equal(await authenticate(req(null, 'https://localhost.example.com/api/state'), { DEV_NO_AUTH: '1' }, { now: NOW, fetch }), null);
  assert.equal(calls.length, 0, 'no token, so no network');
  const id = await authenticate(req(await sign({}), prod), { ...ENV, DEV_NO_AUTH: '1' }, { now: NOW, fetch });
  assert.deepEqual(id, { email: OWNER }, 'normal JWT validation continues');
});

test('forced JWKS refreshes for unknown kids are rate-limited to one per 60 s per team domain', async () => {
  const { fetch, calls } = jwksFetch([KEY.jwk]);
  const unknown = await sign({}, { key: KEY2 });
  await authenticate(req(unknown), ENV, { now: NOW, fetch }); // initial load
  assert.equal(calls.length, 1);
  await authenticate(req(unknown), ENV, { now: NOW + 1000, fetch }); // first forced refresh
  assert.equal(calls.length, 2);
  await authenticate(req(unknown), ENV, { now: NOW + 30_000, fetch }); // within 60 s: no fetch
  await authenticate(req(await sign({}, { key: KEY2 })), ENV, { now: NOW + 59_000, fetch });
  assert.equal(calls.length, 2, 'two further unknown-kid requests within 60 s cause no fetch');
  await authenticate(req(unknown), ENV, { now: NOW + 62_000, fetch }); // 61 s after the forced one
  assert.equal(calls.length, 3, 'allowed again after 60 s');
});

/** A Worker-level Access binding (`ctx.access`) stub. @param {string | (() => never)} emailOrThrow */
function accessStub(emailOrThrow) {
  return {
    calls: 0,
    async getIdentity() {
      this.calls++;
      if (typeof emailOrThrow === 'function') emailOrThrow();
      return { email: emailOrThrow };
    },
  };
}

test('ctx.access: the owner email is accepted (case-insensitively) without any JWT header or JWT config', async () => {
  const { fetch, calls } = jwksFetch([]);
  const access = accessStub('Owner@Example.com');
  assert.deepEqual(await authenticate(req(null), { OWNER_EMAIL: OWNER }, { now: NOW, fetch, access }), { email: OWNER });
  assert.deepEqual(await authenticate(req(null), ENV, { now: NOW, fetch, access }), { email: OWNER });
  assert.equal(calls.length, 0, 'no JWKS fetch on the ctx.access path');
});

test('ctx.access: another email, a throwing getIdentity, no identity, or no OWNER_EMAIL all fail closed', async () => {
  const { fetch } = jwksFetch([]);
  const deps = (/** @type {any} */ access) => ({ now: NOW, fetch, access });
  assert.equal(await authenticate(req(null), ENV, deps(accessStub('someone@example.com'))), null);
  assert.equal(await authenticate(req(null), ENV, deps(accessStub(() => { throw new Error('no identity'); }))), null);
  assert.equal(await authenticate(req(null), ENV, deps({ getIdentity: async () => undefined })), null);
  assert.equal(await authenticate(req(null), ENV, deps({ getIdentity: async () => ({}) })), null);
  const owner = accessStub(OWNER);
  assert.equal(await authenticate(req(null), { TEAM_DOMAIN: TEAM, POLICY_AUD: AUD }, deps(owner)), null, 'OWNER_EMAIL unset');
  assert.equal(await authenticate(req(null), {}, deps(owner)), null);
  assert.equal(owner.calls, 0, 'getIdentity is not even asked without OWNER_EMAIL');
});

test('a present JWT header wins: an invalid one is rejected even when ctx.access names the owner', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const access = accessStub(OWNER);
  const forged = await sign({}, { key: OTHER_KEY });
  assert.equal(await authenticate(req(forged), ENV, { now: NOW, fetch, access }), null, 'forged signature');
  assert.equal(await authenticate(req('garbage'), ENV, { now: NOW, fetch, access }), null, 'not a jwt');
  assert.equal(await authenticate(req(await sign({ email: 'someone@example.com' })), ENV, { now: NOW, fetch, access }), null, 'valid token for another email');
  assert.equal(await authenticate(req(await sign({})), { OWNER_EMAIL: OWNER }, { now: NOW, fetch, access }), null, 'header present but JWT config missing');
  assert.equal(access.calls, 0, 'never falls through to ctx.access');
  // and a valid header still works with or without ctx.access
  assert.deepEqual(await authenticate(req(await sign({})), ENV, { now: NOW, fetch, access }), { email: OWNER });
});

test('no header and no ctx.access fails closed', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  assert.equal(await authenticate(req(null), ENV, { now: NOW, fetch }), null);
});
test('JWKS are cached for 10 minutes, then refetched', async () => {
  const { fetch, calls } = jwksFetch([KEY.jwk]);
  const token = await sign({ exp: NOW_S + 7200 });
  await authenticate(req(token), ENV, { now: NOW, fetch });
  await authenticate(req(token), ENV, { now: NOW + 9 * 60 * 1000, fetch });
  assert.equal(calls.length, 1);
  await authenticate(req(token), ENV, { now: NOW + 11 * 60 * 1000, fetch });
  assert.equal(calls.length, 2);
});

test('an unknown kid triggers exactly one refetch, and rotated keys are then accepted', async () => {
  /** @type {JsonWebKey[]} */
  let served = [KEY.jwk];
  const calls = /** @type {number[]} */ ([]);
  /** @type {any} */
  const fn = async () => {
    calls.push(1);
    return new Response(JSON.stringify({ keys: served }));
  };
  const fetch = /** @type {typeof globalThis.fetch} */ (fn);
  await authenticate(req(await sign({})), ENV, { now: NOW, fetch });
  assert.equal(calls.length, 1);
  served = [KEY.jwk, KEY2.jwk]; // the team rotated in a new key
  const id = await authenticate(req(await sign({}, { key: KEY2 })), ENV, { now: NOW + 1000, fetch });
  assert.deepEqual(id, { email: OWNER });
  assert.equal(calls.length, 2, 'one refetch');
});

test('an unknown kid that stays unknown refetches once per request and is rejected', async () => {
  const { fetch, calls } = jwksFetch([KEY.jwk]);
  const id = await authenticate(req(await sign({}, { key: KEY2 })), ENV, { now: NOW, fetch });
  assert.equal(id, null);
  assert.equal(calls.length, 1, 'initial load counts as the fetch: no second fetch in the same request');
  await authenticate(req(await sign({}, { key: KEY2 })), ENV, { now: NOW + 1000, fetch });
  assert.equal(calls.length, 2, 'cached keys lack the kid: exactly one refetch');
});

test('a failing JWKS endpoint fails closed', async () => {
  /** @type {any} */
  const fn = async () => new Response('nope', { status: 500 });
  assert.equal(await authenticate(req(await sign({})), ENV, { now: NOW, fetch: fn }), null);
  /** @type {any} */
  const boom = async () => {
    throw new Error('network');
  };
  assert.equal(await authenticate(req(await sign({})), ENV, { now: NOW, fetch: boom }), null);
});

test('a trailing slash or missing scheme in TEAM_DOMAIN is normalised', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const token = await sign({});
  assert.ok(await authenticate(req(token), { ...ENV, TEAM_DOMAIN: `${TEAM}/` }, { now: NOW, fetch }));
  clearJwksCache();
  assert.ok(await authenticate(req(token), { ...ENV, TEAM_DOMAIN: 'team.example.cloudflareaccess.com' }, { now: NOW, fetch }));
});

// ----- denial reasons -----

/** @param {Request} request @param {Record<string, unknown>} env @param {any} [deps] */
async function denial(request, env, deps) {
  const r = await authorize(request, /** @type {any} */ (env), { now: NOW, ...deps });
  assert.equal(r.ok, false);
  return /** @type {{ok: false, reason: string, path: string}} */ (r);
}

test('every denial reason is reachable and names the examined path', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const d = { fetch };
  /** @type {[string, Request, Record<string, unknown>, any, string, string][]} */
  const cases = [
    ['no-credentials', req(null), ENV, d, 'no-credentials', 'none'],
    ['no-credentials, nothing configured', req(null), {}, d, 'no-credentials', 'none'],
    ['jwt-config-missing (no TEAM_DOMAIN)', req(await sign({})), { POLICY_AUD: AUD, OWNER_EMAIL: OWNER }, d, 'jwt-config-missing', 'jwt'],
    ['jwt-config-missing (no POLICY_AUD)', req(await sign({})), { TEAM_DOMAIN: TEAM, OWNER_EMAIL: OWNER }, d, 'jwt-config-missing', 'jwt'],
    ['owner-email-missing (jwt)', req(await sign({})), { TEAM_DOMAIN: TEAM, POLICY_AUD: AUD }, d, 'owner-email-missing', 'jwt'],
    ['owner-email-missing (all-empty list)', req(await sign({})), { ...ENV, OWNER_EMAIL: ' , ,, ' }, d, 'owner-email-missing', 'jwt'],
    ['owner-email-missing (ctx.access)', req(null), { OWNER_EMAIL: '' }, { ...d, access: accessStub(OWNER) }, 'owner-email-missing', 'ctx.access'],
    ['jwt-malformed (not a jwt)', req('abc'), ENV, d, 'jwt-malformed', 'jwt'],
    ['jwt-malformed (alg none)', req(await sign({}, { alg: 'none' })), ENV, d, 'jwt-malformed', 'jwt'],
    ['jwt-malformed (no exp)', req(await sign({ exp: undefined })), ENV, d, 'jwt-malformed', 'jwt'],
    ['jwt-unknown-key', req(await sign({}, { key: KEY2 })), ENV, d, 'jwt-unknown-key', 'jwt'],
    ['jwt-bad-signature', req(await sign({}, { key: OTHER_KEY })), ENV, d, 'jwt-bad-signature', 'jwt'],
    ['jwt-expired', req(await sign({ exp: NOW_S - 3600 })), ENV, d, 'jwt-expired', 'jwt'],
    ['jwt-not-yet-valid', req(await sign({ nbf: NOW_S + 3600 })), ENV, d, 'jwt-not-yet-valid', 'jwt'],
    ['jwt-wrong-issuer', req(await sign({ iss: 'https://evil.example.com' })), ENV, d, 'jwt-wrong-issuer', 'jwt'],
    ['jwt-wrong-audience', req(await sign({ aud: ['nope'] })), ENV, d, 'jwt-wrong-audience', 'jwt'],
    ['jwt email-mismatch', req(await sign({ email: 'someone@example.com' })), ENV, d, 'email-mismatch', 'jwt'],
    ['jwt without email', req(await sign({ email: undefined })), ENV, d, 'email-mismatch', 'jwt'],
    ['ctx.access email-mismatch', req(null), ENV, { ...d, access: accessStub('someone@example.com') }, 'email-mismatch', 'ctx.access'],
    ['access-identity-error', req(null), ENV, { ...d, access: accessStub(() => { throw new Error('boom'); }) }, 'access-identity-error', 'ctx.access'],
    ['access-no-email (no identity)', req(null), ENV, { ...d, access: { getIdentity: async () => undefined } }, 'access-no-email', 'ctx.access'],
    ['access-no-email (blank email)', req(null), ENV, { ...d, access: { getIdentity: async () => ({ email: ' ' }) } }, 'access-no-email', 'ctx.access'],
  ];
  for (const [label, request, env, deps, reason, path] of cases) {
    clearJwksCache();
    const r = await denial(request, env, deps);
    assert.deepEqual({ reason: r.reason, path: r.path }, { reason, path }, label);
  }
});

test('a JWKS endpoint that cannot be reached is denied as jwt-unknown-key', async () => {
  /** @type {any} */
  const boom = async () => {
    throw new Error('network');
  };
  assert.equal((await denial(req(await sign({})), ENV, { fetch: boom })).reason, 'jwt-unknown-key');
});

test('a denial carries only codes: no email, token, audience or domain anywhere in the result', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const token = await sign({ email: 'intruder@example.com' });
  const results = [
    await denial(req(token), ENV, { fetch }),
    await denial(req(null), ENV, { fetch, access: accessStub('intruder@example.com') }),
    await denial(req('tok.en.value'), ENV, { fetch }),
  ];
  for (const r of results) {
    assert.deepEqual(Object.keys(r).sort(), ['ok', 'path', 'reason']);
    const text = JSON.stringify(r);
    for (const secret of [OWNER, 'intruder@example.com', AUD, 'team.example', token, 'tok.en.value']) assert.equal(text.includes(secret), false, secret);
  }
});

test('an allowed request through authorize reports the identity', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  assert.deepEqual(await authorize(req(await sign({})), ENV, { now: NOW, fetch }), { ok: true, identity: { email: OWNER } });
  assert.deepEqual(await authorize(req(null, 'http://localhost:8787/api/state'), { DEV_NO_AUTH: '1' }, { now: NOW }), { ok: true, identity: { email: 'dev@local' } });
});

// ----- several owner addresses -----

test('parseOwners trims, lower-cases and drops empty entries', () => {
  assert.deepEqual(parseOwners(' A@x.com , b@Y.com,, ,'), ['a@x.com', 'b@y.com']);
  assert.deepEqual(parseOwners(''), []);
  assert.deepEqual(parseOwners(undefined), []);
  assert.deepEqual(parseOwners(' , '), []);
});

test('OWNER_EMAIL may list several addresses: first, second and no match (JWT path)', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const env = { ...ENV, OWNER_EMAIL: ' First@Example.com , second@example.com ,, ' };
  const deps = { now: NOW, fetch };
  assert.deepEqual(await authenticate(req(await sign({ email: 'first@example.com' })), env, deps), { email: 'first@example.com' });
  assert.deepEqual(await authenticate(req(await sign({ email: 'SECOND@example.com' })), env, deps), { email: 'second@example.com' });
  const none = await authorize(req(await sign({ email: 'third@example.com' })), env, deps);
  assert.deepEqual(none, { ok: false, reason: 'email-mismatch', path: 'jwt' });
});

test('OWNER_EMAIL may list several addresses: first, second and no match (ctx.access path)', async () => {
  const env = { OWNER_EMAIL: 'first@example.com,second@example.com' };
  assert.deepEqual(await authenticate(req(null), env, { now: NOW, access: accessStub('first@example.com') }), { email: 'first@example.com' });
  assert.deepEqual(await authenticate(req(null), env, { now: NOW, access: accessStub('Second@Example.com') }), { email: 'second@example.com' });
  assert.deepEqual(await authorize(req(null), env, { now: NOW, access: accessStub('third@example.com') }), { ok: false, reason: 'email-mismatch', path: 'ctx.access' });
});

// ----- service tokens (SERVICE_TOKEN_IDS) -----

const TOKEN_ID = 'a1b2c3d4e5f6.access';
const OTHER_TOKEN_ID = 'ffffeeeedddd.access';
const TOKEN_ENV = { ...ENV, SERVICE_TOKEN_IDS: ` ${TOKEN_ID} , ${OTHER_TOKEN_ID} ,, ` };

/** A service-token JWT: client id in common_name, empty sub, no email. @param {string} [id] @param {Record<string, unknown>} [over] */
const serviceJwt = (id = TOKEN_ID, over = {}) => sign({ type: 'app', email: undefined, sub: '', common_name: id, ...over });

test('parseServiceTokenIds trims and drops empty entries but keeps case', () => {
  assert.deepEqual(parseServiceTokenIds(' A.access , b.access,, ,'), ['A.access', 'b.access']);
  assert.deepEqual(parseServiceTokenIds(''), []);
  assert.deepEqual(parseServiceTokenIds(undefined), []);
  assert.deepEqual(parseServiceTokenIds(' , '), []);
});

test('service token (JWT): a listed client id is accepted and becomes {serviceToken}', async () => {
  const { fetch, calls } = jwksFetch([KEY.jwk]);
  const deps = { now: NOW, fetch };
  assert.deepEqual(await authenticate(req(await serviceJwt()), TOKEN_ENV, deps), { serviceToken: TOKEN_ID });
  assert.deepEqual(await authenticate(req(await serviceJwt(OTHER_TOKEN_ID)), TOKEN_ENV, deps), { serviceToken: OTHER_TOKEN_ID });
  assert.deepEqual(await authorize(req(await serviceJwt()), TOKEN_ENV, deps), { ok: true, identity: { serviceToken: TOKEN_ID } });
  assert.deepEqual(calls, [`${TEAM}/cdn-cgi/access/certs`], 'validated against the team keys like any token');
});

test('service token (JWT): works without OWNER_EMAIL, and the owner still works with both configured', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const deps = { now: NOW, fetch };
  const envNoOwner = { TEAM_DOMAIN: TEAM, POLICY_AUD: AUD, SERVICE_TOKEN_IDS: TOKEN_ID };
  assert.deepEqual(await authenticate(req(await serviceJwt()), envNoOwner, deps), { serviceToken: TOKEN_ID });
  assert.deepEqual(await authenticate(req(await sign({})), TOKEN_ENV, deps), { email: OWNER });
  // an owner JWT with no owner list is still refused with the email reason
  assert.deepEqual(await authorize(req(await sign({})), envNoOwner, deps), { ok: false, reason: 'owner-email-missing', path: 'jwt' });
});

test('service token (JWT): the id is matched exactly and case-sensitively', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const deps = { now: NOW, fetch };
  for (const id of [TOKEN_ID.toUpperCase(), TOKEN_ID.replace('.access', ''), `${TOKEN_ID}x`, `x${TOKEN_ID}`]) {
    assert.deepEqual(await authorize(req(await serviceJwt(id)), TOKEN_ENV, deps), { ok: false, reason: 'service-token-not-allowed', path: 'jwt' }, id);
  }
});

test('service token (JWT): an unlisted token is service-token-not-allowed, with no list it is service-token-ids-missing', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const deps = { now: NOW, fetch };
  const token = await serviceJwt('9999.access');
  assert.deepEqual(await authorize(req(token), TOKEN_ENV, deps), { ok: false, reason: 'service-token-not-allowed', path: 'jwt' });
  for (const value of [undefined, '', ' , ,, ']) {
    clearJwksCache();
    const r = await authorize(req(await serviceJwt()), { ...ENV, SERVICE_TOKEN_IDS: value }, deps);
    assert.deepEqual(r, { ok: false, reason: 'service-token-ids-missing', path: 'jwt' }, String(value));
  }
});

test('service token (JWT): signature, issuer, audience and expiry are validated exactly as for the owner', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const deps = { now: NOW, fetch };
  /** @type {[string, string, string][]} */
  const cases = [
    ['forged signature', await sign({ email: undefined, common_name: TOKEN_ID }, { key: OTHER_KEY }), 'jwt-bad-signature'],
    ['expired', await serviceJwt(TOKEN_ID, { exp: NOW_S - 3600 }), 'jwt-expired'],
    ['wrong audience', await serviceJwt(TOKEN_ID, { aud: ['nope'] }), 'jwt-wrong-audience'],
    ['wrong issuer', await serviceJwt(TOKEN_ID, { iss: 'https://evil.example.com' }), 'jwt-wrong-issuer'],
    ['unknown key', await sign({ email: undefined, common_name: TOKEN_ID }, { key: KEY2 }), 'jwt-unknown-key'],
  ];
  for (const [label, token, reason] of cases) {
    clearJwksCache();
    assert.deepEqual(await authorize(req(token), TOKEN_ENV, deps), { ok: false, reason, path: 'jwt' }, label);
  }
});

test('cross-check: a service token never matches OWNER_EMAIL, and an email never matches SERVICE_TOKEN_IDS', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const deps = { now: NOW, fetch };
  // a service token whose client id equals an owner address is still judged against the token list only
  const asOwner = await authorize(req(await serviceJwt(OWNER)), TOKEN_ENV, deps);
  assert.deepEqual(asOwner, { ok: false, reason: 'service-token-not-allowed', path: 'jwt' });
  // an email identity whose address equals a listed client id is judged against the owners only
  const env = { ...ENV, SERVICE_TOKEN_IDS: 'someone@example.com' };
  const asToken = await authorize(req(await sign({ email: 'someone@example.com' })), env, deps);
  assert.deepEqual(asToken, { ok: false, reason: 'email-mismatch', path: 'jwt' });
  // an email token that also carries a listed common_name is still an email identity
  const both = await authorize(req(await sign({ email: 'someone@example.com', common_name: TOKEN_ID })), TOKEN_ENV, deps);
  assert.deepEqual(both, { ok: false, reason: 'email-mismatch', path: 'jwt' });
});

test('service token (ctx.access): service_token_id, or common_name as the fallback, is checked against the list', async () => {
  const deps = (/** @type {any} */ identity) => ({ now: NOW, access: { getIdentity: async () => identity } });
  for (const field of ['service_token_id', 'common_name']) {
    const ok = await authorize(req(null), TOKEN_ENV, deps({ [field]: TOKEN_ID, service_token_status: true }));
    assert.deepEqual(ok, { ok: true, identity: { serviceToken: TOKEN_ID } }, field);
    const unknown = await authorize(req(null), TOKEN_ENV, deps({ [field]: '9999.access' }));
    assert.deepEqual(unknown, { ok: false, reason: 'service-token-not-allowed', path: 'ctx.access' }, field);
    const noList = await authorize(req(null), ENV, deps({ [field]: TOKEN_ID }));
    assert.deepEqual(noList, { ok: false, reason: 'service-token-ids-missing', path: 'ctx.access' }, field);
  }
  // service_token_id wins over common_name
  assert.deepEqual(await authorize(req(null), TOKEN_ENV, deps({ service_token_id: TOKEN_ID, common_name: 'x' })), { ok: true, identity: { serviceToken: TOKEN_ID } });
  // works without OWNER_EMAIL
  assert.deepEqual(await authenticate(req(null), { SERVICE_TOKEN_IDS: TOKEN_ID }, deps({ service_token_id: TOKEN_ID })), { serviceToken: TOKEN_ID });
});

test('service token (ctx.access): cross-checks, and getIdentity is skipped only when both lists are empty', async () => {
  const deps = (/** @type {any} */ access) => ({ now: NOW, access });
  assert.deepEqual(await authorize(req(null), TOKEN_ENV, deps({ getIdentity: async () => ({ common_name: OWNER }) })), { ok: false, reason: 'service-token-not-allowed', path: 'ctx.access' });
  assert.deepEqual(
    await authorize(req(null), { ...ENV, SERVICE_TOKEN_IDS: 'someone@example.com' }, deps({ getIdentity: async () => ({ email: 'someone@example.com' }) })),
    { ok: false, reason: 'email-mismatch', path: 'ctx.access' },
  );
  const spy = accessStub(OWNER);
  assert.deepEqual(await authorize(req(null), {}, deps(spy)), { ok: false, reason: 'owner-email-missing', path: 'ctx.access' });
  assert.equal(spy.calls, 0, 'both lists empty: not asked');
  assert.deepEqual(await authenticate(req(null), { SERVICE_TOKEN_IDS: TOKEN_ID }, deps(spy)), null, 'only a token list: asked, and an owner email is not admitted');
  assert.equal(spy.calls, 1);
  assert.deepEqual(await authorize(req(null), TOKEN_ENV, deps({ getIdentity: async () => ({}) })), { ok: false, reason: 'access-no-email', path: 'ctx.access' });
});

test('a present JWT header still decides alone: an invalid one is refused even when ctx.access names an allowed service token', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  let asked = 0;
  const access = { getIdentity: async () => { asked++; return { service_token_id: TOKEN_ID }; } };
  const forged = await sign({ email: undefined, common_name: TOKEN_ID }, { key: OTHER_KEY });
  assert.equal((await denial(req(forged), TOKEN_ENV, { fetch, access })).reason, 'jwt-bad-signature');
  assert.equal(asked, 0);
});

test('a service-token denial carries only codes: no client id anywhere in the result', async () => {
  const { fetch } = jwksFetch([KEY.jwk]);
  const secretId = 'topsecretid.access';
  const results = [
    await denial(req(await serviceJwt(secretId)), TOKEN_ENV, { fetch }),
    await denial(req(null), TOKEN_ENV, { access: { getIdentity: async () => ({ service_token_id: secretId }) } }),
    await denial(req(null), ENV, { access: { getIdentity: async () => ({ service_token_id: secretId }) } }),
  ];
  for (const r of results) {
    assert.deepEqual(Object.keys(r).sort(), ['ok', 'path', 'reason']);
    const text = JSON.stringify(r);
    for (const s of [secretId, TOKEN_ID, OWNER]) assert.equal(text.includes(s), false, s);
  }
});