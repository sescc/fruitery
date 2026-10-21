// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routePopup, isIdentityUrl, looksLikeAuthFlow, registrableDomain, sameSite, shouldReloadOpener, IDENTITY_HOSTS } from '../lib/popup-route.js';

const OPENER = 'https://app.app-host.example.com/app/today';
const tab = (/** @type {string} */ url, /** @type {string} */ openerUrl = OPENER, /** @type {string} */ disposition = 'foreground-tab') => routePopup({ url, disposition, openerUrl });

test('rule 1: not http(s) -> deny, whatever the disposition', () => {
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'ms-settings:', 'data:text/html,<b>x</b>', 'ftp://example.com/x', 'microsoft-edge:https://example.com', '', 'not a url']) {
    for (const disposition of ['new-window', 'foreground-tab', 'background-tab', 'default', 'other']) {
      assert.equal(routePopup({ url, disposition, openerUrl: OPENER }), 'deny', `${url} / ${disposition}`);
    }
  }
  assert.equal(routePopup(/** @type {any} */ ({ url: null, disposition: 'new-window' })), 'deny');
});

test('rule 1: about:blank (a script-opened sign-in window that navigates next) -> app window', () => {
  assert.equal(tab('about:blank'), 'app-window');
  assert.equal(routePopup({ url: 'about:blank', disposition: 'new-window', openerUrl: OPENER }), 'app-window');
});

test('rule 2: new-window -> app window (the sign-in popup), even for an unrelated plain URL', () => {
  assert.equal(routePopup({ url: 'https://other.example.org/page', disposition: 'new-window', openerUrl: OPENER }), 'app-window');
  assert.equal(routePopup({ url: 'https://other.example.org/page', disposition: 'new-window' }), 'app-window');
});

test('rule 3a: the Google Identity Services sign-in arriving as a new tab -> same pane', () => {
  assert.equal(tab('https://accounts.google.com/o/oauth2/v2/auth?client_id=1.apps.googleusercontent.com&redirect_uri=storagerelay%3A%2F%2Fhttps%2Fapp.example.com&response_type=token'), 'same-pane');
  assert.equal(tab('https://accounts.google.com/gsi/select?client_id=abc'), 'same-pane');
  assert.equal(tab('https://accounts.google.com/'), 'same-pane');
  assert.equal(tab('https://accounts.youtube.com/accounts/SetSID'), 'same-pane');
});

test('rule 3a: Microsoft, Apple and other identity hosts as a new tab -> same pane', () => {
  assert.equal(tab('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=y'), 'same-pane');
  assert.equal(tab('https://login.microsoftonline.com/'), 'same-pane');
  assert.equal(tab('https://login.live.com/'), 'same-pane');
  assert.equal(tab('https://login.microsoft.com/'), 'same-pane');
  assert.equal(tab('https://appleid.apple.com/auth/authorize?x=1'), 'same-pane');
  assert.equal(tab('https://dev-123.okta.com/'), 'same-pane');
  assert.equal(tab('https://okta.com/'), 'same-pane');
  assert.equal(tab('https://tenant.eu.auth0.com/u/login'), 'same-pane');
  assert.equal(tab('https://auth0.com/'), 'same-pane');
  assert.equal(tab('https://acme.onelogin.com/'), 'same-pane');
});

test('rule 3a: path-restricted hosts match only their sign-in paths', () => {
  assert.equal(isIdentityUrl('https://github.com/login/oauth/authorize'), true);
  assert.equal(isIdentityUrl('https://github.com/login'), true);
  assert.equal(isIdentityUrl('https://github.com/someone/repo'), false);
  assert.equal(isIdentityUrl('https://github.com/loginfoo'), false);
  assert.equal(isIdentityUrl('https://discord.com/oauth2/authorize?x=1'), true);
  assert.equal(isIdentityUrl('https://discord.com/login'), true);
  assert.equal(isIdentityUrl('https://discord.com/about'), false);
  assert.equal(isIdentityUrl('https://www.facebook.com/dialog/oauth?client_id=1'), true);
  assert.equal(isIdentityUrl('https://facebook.com/login.php'), false);
  assert.equal(isIdentityUrl('https://www.facebook.com/login/'), true);
  assert.equal(isIdentityUrl('https://www.facebook.com/about'), false);
  assert.equal(isIdentityUrl('https://api.twitter.com/oauth/authenticate'), true);
  assert.equal(isIdentityUrl('https://twitter.com/i/oauth2/authorize'), true);
  assert.equal(isIdentityUrl('https://x.com/i/oauth2/authorize'), true);
  assert.equal(isIdentityUrl('https://x.com/home'), false);
  assert.ok(IDENTITY_HOSTS.length >= 14);
});

test('rule 3a: a lookalike host is not an identity host -> external', () => {
  assert.equal(isIdentityUrl('https://accounts.google.com.evil.example/'), false);
  assert.equal(isIdentityUrl('https://evil-accounts.google.com.example/'), false);
  assert.equal(isIdentityUrl('https://notokta.com/'), false);
  assert.equal(tab('https://accounts.google.com.evil.example/'), 'external');
  assert.equal(tab('https://login.microsoftonline.com.phish.example/'), 'external');
});

test('rule 3b: an auth-looking path or query as a new tab -> same pane', () => {
  assert.equal(tab('https://sso.partner.example.net/oauth2/authorize?client_id=x&redirect_uri=y'), 'same-pane');
  assert.equal(tab('https://idp.partner.example.net/saml/login'), 'same-pane');
  assert.equal(tab('https://partner.example.net/SSO/start'), 'same-pane');
  assert.equal(tab('https://partner.example.net/sign-in'), 'same-pane');
  assert.equal(tab('https://partner.example.net/signin?next=/'), 'same-pane');
  assert.equal(tab('https://partner.example.net/auth'), 'same-pane');
  assert.equal(tab('https://partner.example.net/connect?client_id=1&redirect_uri=https%3A%2F%2Fx'), 'same-pane');
  assert.equal(tab('https://partner.example.net/go?response_type=code'), 'same-pane');
  assert.equal(tab('https://partner.example.net/acs?SAMLRequest=abc'), 'same-pane');
  assert.equal(looksLikeAuthFlow('https://partner.example.net/go?client_id=only'), false);
});

test('rule 3b: words that merely contain an auth word are not auth flows', () => {
  assert.equal(looksLikeAuthFlow('https://news.example.net/world/author-interview'), false);
  assert.equal(looksLikeAuthFlow('https://news.example.net/2026/auth-reform-explained'), false);
  assert.equal(looksLikeAuthFlow('https://news.example.net/login-tips'), false);
  assert.equal(tab('https://news.example.net/world/author-interview'), 'external');
});

test('rule 3c: same-site as the opener -> same pane (including an oauth callback)', () => {
  assert.equal(tab('https://app.app-host.example.com/oauth/callback?code=1'), 'same-pane');
  assert.equal(tab('https://www.app-host.example.com/help'), 'same-pane');
  assert.equal(tab('https://app-host.example.com/'), 'same-pane');
  assert.equal(tab('https://shop.example.co.uk/x', 'https://www.example.co.uk/'), 'same-pane');
  assert.equal(tab('http://127.0.0.1:9000/page', 'http://127.0.0.1:9001/other'), 'same-pane');
});

test('otherwise a plain link -> external', () => {
  assert.equal(tab('https://docs.example.org/wiki/Cookie'), 'external');
  assert.equal(tab('https://blog.example.org/2026/10/news-article'), 'external');
  assert.equal(tab('https://other.co.uk/', 'https://www.example.co.uk/'), 'external');
  assert.equal(tab('http://localhost:9000/plain', 'http://127.0.0.1:9000/page'), 'external');
  for (const d of ['foreground-tab', 'background-tab', 'default', 'other']) assert.equal(tab('https://docs.example.org/wiki/Cookie', OPENER, d), 'external', d);
  assert.equal(routePopup({ url: 'https://docs.example.org/wiki/Cookie', disposition: 'foreground-tab' }), 'external', 'no opener url: not same-site');
  assert.equal(routePopup({ url: 'https://docs.example.org/wiki/Cookie', disposition: 'foreground-tab', openerUrl: 'about:blank' }), 'external');
});

test('registrableDomain and sameSite', () => {
  assert.equal(registrableDomain('app.example.com'), 'example.com');
  assert.equal(registrableDomain('A.B.Example.COM'), 'example.com');
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(registrableDomain('www.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('x.y.example.com.au'), 'example.com.au');
  assert.equal(registrableDomain('shop.example.org.uk'), 'example.org.uk');
  assert.equal(registrableDomain('news.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(registrableDomain('localhost'), 'localhost');
  assert.equal(registrableDomain('[::1]'.slice(1, -1)), '::1');
  assert.equal(sameSite('https://a.example.com/', 'https://b.example.com/x'), true);
  assert.equal(sameSite('https://example.com/', 'https://example.org/'), false);
  assert.equal(sameSite('https://a.example.co.uk/', 'https://b.example.co.uk/'), true);
  assert.equal(sameSite('https://a.co.uk/', 'https://b.co.uk/'), false);
  assert.equal(sameSite('https://a.example.com/', null), false);
  assert.equal(sameSite('https://a.example.com/', 'not a url'), false);
});

test('shouldReloadOpener: only when the opener is unchanged and the popup went through a sign-in', () => {
  const sso = ['about:blank', 'https://accounts.google.com/o/oauth2/auth?client_id=1', 'https://app.example.com/oauth/callback'];
  assert.equal(shouldReloadOpener({ openerUrlBefore: OPENER, openerUrlNow: OPENER, visited: sso }), true);
  assert.equal(shouldReloadOpener({ openerUrlBefore: OPENER, openerUrlNow: 'https://app.app-host.example.com/app/inbox', visited: sso }), false, 'the opener moved on by itself');
  assert.equal(shouldReloadOpener({ openerUrlBefore: OPENER, openerUrlNow: OPENER, visited: ['https://blog.example.org/post'] }), false, 'an ordinary popup');
  assert.equal(shouldReloadOpener({ openerUrlBefore: OPENER, openerUrlNow: OPENER, visited: [] }), false);
  assert.equal(shouldReloadOpener({ openerUrlBefore: null, openerUrlNow: OPENER, visited: sso }), false);
  assert.equal(shouldReloadOpener({ openerUrlBefore: OPENER, openerUrlNow: null, visited: sso }), false, 'opener gone');
  assert.equal(shouldReloadOpener({ openerUrlBefore: OPENER, openerUrlNow: OPENER, visited: ['https://p.example.net/oauth2/authorize?x=1'] }), true, 'an auth-looking path counts too');
});

test('rule 3: only foreground-tab / background-tab become the same pane; other dispositions of a sign-in stay app windows', () => {
  const sso = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=2&response_type=code';
  assert.equal(tab(sso, OPENER, 'foreground-tab'), 'same-pane');
  assert.equal(tab(sso, OPENER, 'background-tab'), 'same-pane');
  assert.equal(tab(sso, OPENER, 'new-window'), 'app-window');
  assert.equal(tab(sso, OPENER, 'default'), 'app-window');
  assert.equal(tab(sso, OPENER, 'other'), 'app-window');
  assert.equal(tab('about:blank', OPENER, 'foreground-tab'), 'app-window', 'a blank window is never the pane');
  assert.equal(tab('https://docs.example.org/wiki/Cookie', OPENER, 'foreground-tab'), 'external');
});