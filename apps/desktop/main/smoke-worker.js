// @ts-check
// Smoke mode only: the REAL Worker request handler (apps/web/src/api.js) over a node:sqlite D1 stand-in with
// the real migrations, behind a node:http server on 127.0.0.1. The Worker is reached exactly like the real one:
// the access key travels in the CF-Access-Client-Id / CF-Access-Client-Secret headers, and a synthetic
// Worker-level Access binding (`ctx.access`) answers with a service-token identity only when both headers
// match; otherwise the handler denies the request (403) just as production does.
// The web sources are loaded lazily, so a normal run never touches them.

import http from 'node:http';

/**
 * @param {object} o
 * @param {string} o.clientId  the service token's client id the Worker accepts
 * @param {string} o.secret    its secret
 * @param {{workspaces: any[], groups: any[], items: any[], settings: any}} o.seed  what the "server" starts with
 */
export async function startSmokeWorker({ clientId, secret, seed }) {
  const { handle } = await import('../../web/src/api.js');
  const { upsertEntities } = await import('../../web/src/store.js');
  const { createMigratedDb } = await import('../../web/test-support/d1-sqlite.js');
  const db = await createMigratedDb();
  await upsertEntities(db, seed);

  /** @type {{method: string, path: string, id: string | undefined, secret: string | undefined, status: number}[]} */
  const seen = [];
  /** @type {import('node:http').Server | null} */
  let server = null;
  let port = 0;

  const env = { DB: db, OWNER_EMAIL: 'owner@example.com', SERVICE_TOKEN_IDS: clientId };

  const makeServer = () =>
    http.createServer((req, res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const id = /** @type {string | undefined} */ (req.headers['cf-access-client-id']);
        const sec = /** @type {string | undefined} */ (req.headers['cf-access-client-secret']);
        const body = Buffer.concat(chunks);
        const init = /** @type {RequestInit} */ ({ method: req.method, headers: { 'content-type': String(req.headers['content-type'] ?? 'application/json') } });
        if (body.length > 0 && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
        const access = { getIdentity: async () => (id === clientId && sec === secret ? { service_token_id: clientId } : undefined) };
        const response = await handle(new Request(`http://localhost:${port}${req.url}`, init), env, { now: Date.now(), access, log: () => {} });
        const text = await response.text();
        seen.push({ method: String(req.method), path: String(req.url), id, secret: sec, status: response.status });
        res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json' });
        res.end(text);
      });
    });

  const listen = (/** @type {number} */ wanted) =>
    new Promise((resolve, reject) => {
      server = makeServer();
      server.once('error', reject);
      server.listen(wanted, '127.0.0.1', () => {
        port = /** @type {any} */ (server?.address()).port;
        resolve(undefined);
      });
    });
  await listen(0);

  return {
    db,
    seen,
    get port() { return port; },
    get url() { return `http://127.0.0.1:${port}`; },
    /** Stop answering (the app then sees a refused connection, like being offline). */
    async stop() {
      const s = server;
      server = null;
      if (!s) return;
      await new Promise((r) => { s.close(() => r(undefined)); s.closeAllConnections?.(); });
    },
    /** Answer again on the same port, with the same data. */
    async start() {
      if (!server) await listen(port);
    },
    /** @param {string} sql @param {...unknown} args */
    row: (sql, ...args) => db.prepare(sql).bind(...args).first(),
    /** @param {string} sql @param {...unknown} args @returns {Promise<Record<string, any>[]>} */
    rows: async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results,
  };
}
