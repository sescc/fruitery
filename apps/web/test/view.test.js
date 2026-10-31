// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED } from '../../../packages/core/index.js';
import { view } from '../test-support/load-view.js';

const { buildView, dayProgress, withTick, withoutTick, serializeSnapshot, restoreSnapshot, SNAPSHOT_KEY, iconOf, letterOf } = view;

// Monday 2026-10-12, 09:00 in Tokyo
const NOW = Date.parse('2026-10-12T00:00:00Z');
const NOV3 = Date.parse('2026-11-03T03:00:00Z');

/** @returns {any} a mutable deep copy of the example dataset */
function snap(over = {}) {
  return { ...JSON.parse(JSON.stringify(SEED)), completions: [], ...over };
}

/** @param {any} s @param {string} id @param {Record<string, unknown>} over */
function patch(s, id, over) {
  Object.assign(s.items.find((/** @type {any} */ i) => i.id === id), over);
  return s;
}

/** @param {any} v @param {string} id */
function findItem(v, id) {
  for (const w of v.workspaces) {
    for (const g of w.groups) for (const i of g.items) if (i.id === id) return i;
    for (const i of w.notDue) if (i.id === id) return i;
  }
  return undefined;
}

test('Mixed buckets: 1/3 progress, two due unticked, one ticked, the weekly item under Not due with its next date', async () => {
  const s = snap();
  // Fun group: the word game (daily, due), two more daily items (one ticked today) and a weekly Sunday
  // item ticked on Sunday 2026-10-11, i.e. earlier in its current period. The every-3-days item
  // is desktop-only and stays hidden.
  patch(s, 'it-weekly-bonus', { schedule: { type: 'weekly', weekday: 7 } });
  const wordGame = s.items.find((/** @type {any} */ i) => i.id === 'it-word-game');
  s.items.push({ ...JSON.parse(JSON.stringify(wordGame)), id: 'it-extra', name: 'Extra', order: 5 });
  s.items.push({ ...JSON.parse(JSON.stringify(wordGame)), id: 'it-extra2', name: 'Extra2', order: 6 });
  s.completions = [
    { itemId: 'it-extra2', periodKey: '2026-10-12', doneAt: NOW },
    { itemId: 'it-weekly-bonus', periodKey: '2026-10-11', doneAt: Date.parse('2026-10-11T00:00:00Z') },
  ];
  const v = buildView(s, NOW);
  const ws = v.workspaces.find((w) => w.id === 'ws-daily');
  assert.ok(ws);
  const games = ws.groups.find((g) => g.id === 'g-fun');
  assert.ok(games);
  assert.deepEqual(games.progress, { done: 1, total: 3 });
  assert.deepEqual(games.items.map((i) => [i.id, i.bucket]), [['it-word-game', 'due'], ['it-extra', 'due'], ['it-extra2', 'done']]);
  const weekly = ws.notDue.find((i) => i.id === 'it-weekly-bonus');
  assert.ok(weekly);
  assert.equal(weekly.bucket, 'notDue');
  assert.equal(weekly.nextDue, '2026-10-18');
});

test('Desktop-only items are hidden', () => {
  const v = buildView(snap(), NOW);
  assert.equal(findItem(v, 'it-every-3-days'), undefined);
  assert.ok(findItem(v, 'it-word-game'));
  // phone-only and all are shown
  const s = patch(snap(), 'it-every-3-days', { devices: 'phone' });
  assert.ok(findItem(buildView(s, NOW), 'it-every-3-days'));
});

test('Unscheduled items are link rows, not check-ins; deleted items and empty workspaces/groups are not shown', () => {
  const s = snap();
  patch(s, 'it-word-game', { deleted: true });
  const v = buildView(s, NOW);
  assert.equal(findItem(v, 'it-word-game'), undefined);
  assert.equal(findItem(v, 'it-tasks').bucket, 'link', 'an unscheduled item is shown, as a link row');
  const prod = v.workspaces.find((w) => w.id === 'ws-productivity');
  assert.deepEqual([prod?.groups.length, prod?.notDue.length], [1, 0], 'the unscheduled ungrouped items of Productivity form the Default section; none is a check-in');
  assert.deepEqual(prod?.groups[0].progress, { done: 0, total: 0 }, 'links are not counted');
  s.workspaces.push({ id: 'ws-empty', name: 'Empty', icon: null, order: 9, sleepAfterMin: 0, openInEdge: false, ungroupedLabel: null, updatedAt: 0, deleted: false });
  assert.equal(buildView(s, NOW).workspaces.some((w) => w.id === 'ws-empty'), false, 'a workspace with nothing to show is omitted');
  // a group whose items are all not due is not listed as a group
  const s2 = snap();
  for (const id of ['it-word-game', 'it-weekly-bonus']) patch(s2, id, { devices: 'desktop' });
  const games = buildView(s2, NOW).workspaces.find((w) => w.id === 'ws-daily')?.groups.find((g) => g.id === 'g-fun');
  assert.equal(games, undefined);
});

test('Rotating URL: the monthly shop opens an address ending in /202611 on 2026-11-03', () => {
  const v = buildView(snap(), NOV3);
  const shop = findItem(v, 'it-monthly-shop');
  assert.ok(shop);
  assert.equal(shop.href, 'https://example.com/shop/202611');
  assert.equal(shop.hint, null);
});

test('The date token uses the configured timezone', () => {
  const s = snap();
  s.settings.timezone = 'Asia/Tokyo';
  // 2026-10-31T16:30Z is already November in Tokyo
  const v = buildView(s, Date.parse('2026-10-31T16:30:00Z'));
  assert.equal(findItem(v, 'it-monthly-shop').href, 'https://example.com/shop/202611');
});

test('Missing Google email: a hint and no link; with the email set the link is filled and encoded', () => {
  const s = snap();
  s.items.push({ ...JSON.parse(JSON.stringify(s.items.find((/** @type {any} */ i) => i.id === 'it-word-game'))), id: 'it-mail-check', name: 'Mail', url: 'https://mail.example.com/?authuser={googleEmail}', order: 7 });
  const without = findItem(buildView(s, NOW), 'it-mail-check');
  assert.equal(without.href, null);
  assert.equal(without.hint, 'set-google-email');
  s.settings.googleEmail = 'me+tag@example.com';
  const withMail = findItem(buildView(s, NOW), 'it-mail-check');
  assert.equal(withMail.href, 'https://mail.example.com/?authuser=me%2Btag%40example.com');
  assert.equal(withMail.hint, null);
});

test('App items open their fallback URL; without any usable URL they are not openable', () => {
  const s = snap();
  patch(s, 'it-language', { kind: 'app', url: null, appPath: 'C:\\apps\\x.exe', fallbackUrl: 'https://learn.example.org/daily' });
  patch(s, 'it-word-game', { kind: 'app', url: null, appPath: 'C:\\apps\\y.exe', fallbackUrl: null });
  const v = buildView(s, NOW);
  assert.equal(findItem(v, 'it-language').href, 'https://learn.example.org/daily');
  assert.deepEqual([findItem(v, 'it-word-game').href, findItem(v, 'it-word-game').hint], [null, null]);
  // an app item ignores a stale url in favour of its fallback
  const s2 = patch(snap(), 'it-language', { kind: 'app', url: 'https://stale.example.com/', appPath: 'x', fallbackUrl: 'https://fallback.example.com/' });
  assert.equal(findItem(buildView(s2, NOW), 'it-language').href, 'https://fallback.example.com/');
  // a web item falls back to fallbackUrl when url is blank
  const s3 = patch(snap(), 'it-language', { url: ' ', fallbackUrl: 'https://fallback.example.com/' });
  assert.equal(findItem(buildView(s3, NOW), 'it-language').href, 'https://fallback.example.com/');
});

test('Deep link: it becomes the open-target; a web URL alongside it is offered as webHref (the "↗ web" chip)', () => {
  const dl = 'intent://open/#Intent;scheme=myapp;package=com.example.app;end';
  // deep link + a web url: href is the deep link, webHref the web link (chip shown)
  const s = patch(snap(), 'it-language', { deepLink: dl, url: 'https://learn.example.org/daily' });
  const both = findItem(buildView(s, NOW), 'it-language');
  assert.deepEqual([both.href, both.webHref, both.hint], [dl, 'https://learn.example.org/daily', null]);
  // deep link but no web url: href is the deep link, no chip
  const s2 = patch(snap(), 'it-language', { deepLink: dl, url: null, fallbackUrl: null });
  const only = findItem(buildView(s2, NOW), 'it-language');
  assert.deepEqual([only.href, only.webHref], [dl, null]);
  // no deep link: href is the web link, no chip (unchanged behaviour)
  const s3 = snap();
  const plain = findItem(buildView(s3, NOW), 'it-language');
  assert.deepEqual([plain.href, plain.webHref], ['https://learn.example.org/daily', null]);
  // an invalid stored deep link is ignored: the web link is used and no chip is offered
  const s4 = patch(snap(), 'it-language', { deepLink: 'javascript:alert(1)', url: 'https://learn.example.org/daily' });
  const unsafe = findItem(buildView(s4, NOW), 'it-language');
  assert.deepEqual([unsafe.href, unsafe.webHref], ['https://learn.example.org/daily', null]);
  // a deep link on a check-in item: the bucket (tick) is unaffected, href is still the deep link
  const s5 = patch(snap(), 'it-language', { deepLink: dl });
  const checkIn = findItem(buildView(s5, NOW), 'it-language');
  assert.equal(checkIn.bucket, 'due');
  assert.equal(checkIn.href, dl);
});

test('Ungrouped items come last as the ungrouped group (id null); stored order is kept', () => {
  const s = snap();
  patch(s, 'it-word-game', { groupId: null });
  patch(s, 'it-weekly-bonus', { groupId: 'g-gone' }); // dangling group id
  const groups = buildView(s, NOW).workspaces.find((w) => w.id === 'ws-daily')?.groups;
  assert.deepEqual(groups.map((g) => g.id), ['g-study', 'g-perks', null]);
  const other = groups[groups.length - 1];
  assert.equal(other.name, 'Default');
  assert.deepEqual(other.items.map((i) => i.id), ['it-word-game', 'it-weekly-bonus']);
  // order within a group follows `order`, then id
  const s2 = snap();
  patch(s2, 'it-coding', { order: -1 });
  const learning = buildView(s2, NOW).workspaces.find((w) => w.id === 'ws-daily')?.groups[0];
  assert.deepEqual(learning.items.map((i) => i.id), ['it-coding', 'it-language']);
});

test('Workspaces and groups follow their stored order', () => {
  const s = snap();
  s.workspaces.find((/** @type {any} */ w) => w.id === 'ws-daily').order = 0;
  s.groups.find((/** @type {any} */ g) => g.id === 'g-fun').order = -1;
  const v = buildView(s, NOW);
  assert.deepEqual(v.workspaces.find((w) => w.id === 'ws-daily')?.groups.map((g) => g.id), ['g-fun', 'g-study', 'g-perks']);
});

test('Deleted groups send their items to the ungrouped group', () => {
  const s = snap();
  s.groups.find((/** @type {any} */ g) => g.id === 'g-study').deleted = true;
  const groups = buildView(s, NOW).workspaces.find((w) => w.id === 'ws-daily')?.groups;
  assert.equal(groups[groups.length - 1].id, null);
  assert.deepEqual(groups[groups.length - 1].items.map((i) => i.id).sort(), ['it-coding', 'it-language']);
});

test('dayProgress totals the groups; complete means everything due is done', () => {
  const s = snap();
  let v = buildView(s, NOW);
  const p0 = dayProgress(v);
  assert.equal(p0.done, 0);
  assert.ok(p0.total > 0);
  assert.equal(p0.complete, false);
  const doneAll = withTick(withTick(s, 'it-language', NOW), 'it-coding', NOW);
  let t = doneAll;
  for (const w of v.workspaces) for (const g of w.groups) for (const i of g.items) t = withTick(t, i.id, NOW);
  v = buildView(t, NOW);
  assert.deepEqual(dayProgress(v), { done: p0.total, total: p0.total, complete: true });
  assert.deepEqual(dayProgress({ workspaces: [] }), { done: 0, total: 0, complete: false });
});

test('withTick / withoutTick are pure and idempotent', () => {
  const s = snap();
  const ticked = withTick(s, 'it-word-game', NOW);
  assert.equal(s.completions.length, 0);
  assert.deepEqual(ticked.completions, [{ itemId: 'it-word-game', periodKey: '2026-10-12', doneAt: NOW }]);
  assert.equal(withTick(ticked, 'it-word-game', NOW).completions.length, 1);
  assert.equal(findItem(buildView(ticked, NOW), 'it-word-game').bucket, 'done');
  const unticked = withoutTick(ticked, 'it-word-game', NOW);
  assert.equal(unticked.completions.length, 0);
  assert.equal(findItem(buildView(unticked, NOW), 'it-word-game').bucket, 'due');
  // unknown or unscheduled items leave the snapshot alone
  assert.equal(withTick(s, 'nope', NOW), s);
  assert.equal(withTick(s, 'it-tasks', NOW), s);
  assert.equal(withoutTick(s, 'nope', NOW), s);
});

test('serializeSnapshot / restoreSnapshot round-trip the data and the save time; server-only fields are dropped', () => {
  const s = snap({ completions: [{ itemId: 'it-word-game', periodKey: '2026-10-12', doneAt: NOW }], serverNow: NOW, extra: 'x' });
  const text = serializeSnapshot(s, 1234);
  assert.equal(typeof text, 'string');
  const restored = restoreSnapshot(text);
  assert.ok(restored);
  assert.equal(restored.savedAt, 1234);
  assert.deepEqual(Object.keys(restored.snapshot).sort(), ['completions', 'groups', 'items', 'settings', 'workspaces']);
  assert.deepEqual(restored.snapshot.completions, s.completions);
  assert.deepEqual(restored.snapshot.items, s.items);
  assert.deepEqual(restored.snapshot.settings, s.settings);
  // the restored snapshot produces exactly the same view as the original
  assert.deepEqual(buildView(restored.snapshot, NOW), buildView(s, NOW));
  assert.equal(SNAPSHOT_KEY, 'fruitery:lastSnapshot');
});

test('restoreSnapshot returns null for malformed text or the wrong shape', () => {
  const good = JSON.parse(serializeSnapshot(snap(), 1));
  /** @param {(d: any) => void} edit */
  const variant = (edit) => {
    const d = JSON.parse(JSON.stringify(good));
    edit(d);
    return JSON.stringify(d);
  };
  const bad = [
    undefined, null, '', 'not json', '{', '[]', '{}', 'null', '5', '"x"',
    variant((d) => delete d.savedAt),
    variant((d) => (d.savedAt = '123')),
    variant((d) => (d.savedAt = null)),
    variant((d) => delete d.snapshot),
    variant((d) => (d.snapshot = null)),
    variant((d) => (d.snapshot = [])),
    variant((d) => delete d.snapshot.workspaces),
    variant((d) => (d.snapshot.groups = {})),
    variant((d) => (d.snapshot.items = 'x')),
    variant((d) => (d.snapshot.completions = null)),
    variant((d) => delete d.snapshot.settings),
    variant((d) => (d.snapshot.settings = [])),
    variant((d) => (d.snapshot.settings = 'UTC')),
    variant((d) => delete d.snapshot.settings.timezone),
    variant((d) => (d.snapshot.settings.timezone = 5)),
  ];
  for (const text of bad) assert.equal(restoreSnapshot(/** @type {any} */ (text)), null, String(text).slice(0, 60));
  assert.ok(restoreSnapshot(JSON.stringify(good)), 'the unmodified one is accepted');
});

/** A small generic snapshot (no SEED): workspace w1 with one group and a mix of check-ins and links. */
function mini() {
  const item = (/** @type {string} */ id, /** @type {number} */ order, /** @type {Record<string, unknown>} */ over = {}) => ({
    id, workspaceId: 'w1', groupId: null, order, name: `Item ${id}`, icon: null, kind: 'web', url: `https://example.com/${id}`, appPath: null, fallbackUrl: null,
    devices: 'all', schedule: null, resetTime: '00:00', notify: false, badge: false, edge: { mode: 'inherit', profile: null }, isolate: false,
    persistSessionCookies: true, sleepAfterMin: null, userAgent: { preset: 'default', custom: null }, updatedAt: 0, deleted: false, ...over,
  });
  return {
    workspaces: [{ id: 'w1', name: 'Work', icon: null, order: 0, sleepAfterMin: 0, openInEdge: false, ungroupedLabel: null, updatedAt: 0, deleted: false }],
    groups: [{ id: 'g1', workspaceId: 'w1', name: 'Group', order: 0, collapsed: false, updatedAt: 0, deleted: false }],
    items: [
      item('c1', 0, { groupId: 'g1', schedule: { type: 'daily' } }),
      item('c2', 1, { schedule: { type: 'daily' } }),
      item('l1', 2), item('l2', 3), item('l3', 4), item('l4', 5),
    ],
    settings: { timezone: 'UTC', googleEmail: null, updatedAt: 0 },
    completions: [],
  };
}

test('Ungrouped items are named by the workspace label, else "Default"', () => {
  const s = mini();
  const last = (/** @type {any} */ snapshot) => buildView(snapshot, NOW).workspaces[0].groups.at(-1);
  assert.equal(last(s)?.id, null);
  assert.equal(last(s)?.name, 'Default');
  s.workspaces[0].ungroupedLabel = ' Misc ';
  assert.equal(last(s)?.name, 'Misc');
  s.workspaces[0].ungroupedLabel = '   ';
  assert.equal(last(s)?.name, 'Default');
});

/** @param {any} v the built view @param {string | null} groupId @returns {any} the group of the first workspace */
const groupOf = (v, groupId) => v.workspaces[0].groups.find((/** @type {any} */ g) => g.id === groupId);
/** @param {any} g @returns {string[]} */
const rowIds = (g) => g.items.map((/** @type {any} */ i) => i.id);

test('A link in a group: it is a link row in that group, among its rows in stored order, with no progress change', () => {
  const s = mini();
  patch(s, 'l1', { groupId: 'g1', order: 0.5 }); // between c1 (order 0) and nothing else of g1
  patch(s, 'l2', { groupId: 'g1', order: -1 }); // before c1
  const g = groupOf(buildView(s, NOW), 'g1');
  assert.deepEqual(rowIds(g), ['l2', 'c1', 'l1'], 'links and check-ins mix in the stored order');
  assert.deepEqual(g.items.map((/** @type {any} */ i) => i.bucket), ['link', 'due', 'link']);
  assert.deepEqual(g.progress, { done: 0, total: 1 }, 'only the check-in counts');
  // ticking the check-in changes the progress, still ignoring the links
  assert.deepEqual(groupOf(buildView(withTick(s, 'c1', NOW), NOW), 'g1').progress, { done: 1, total: 1 });
  // a link has no due date and is never in Not due
  assert.equal(g.items[0].nextDue, null);
  assert.deepEqual(buildView(s, NOW).workspaces[0].notDue, []);
  // an item given a schedule stops being a link and becomes a check-in that counts
  patch(s, 'l1', { schedule: { type: 'daily' } });
  const g2 = groupOf(buildView(s, NOW), 'g1');
  assert.equal(g2.items.find((/** @type {any} */ i) => i.id === 'l1').bucket, 'due');
  assert.deepEqual(g2.progress, { done: 0, total: 2 });
});

test('A link without a group is in the ungrouped section, named by the workspace label; links come in stored order', () => {
  const s = mini();
  const other = groupOf(buildView(s, NOW), null);
  assert.equal(other.name, 'Default');
  assert.deepEqual(rowIds(other), ['c2', 'l1', 'l2', 'l3', 'l4']);
  assert.deepEqual(other.progress, { done: 0, total: 1 }, 'one check-in and four links');
  patch(s, 'l4', { order: -1 });
  assert.deepEqual(rowIds(groupOf(buildView(s, NOW), null)), ['l4', 'c2', 'l1', 'l2', 'l3']);
  s.workspaces[0].ungroupedLabel = 'Misc';
  assert.equal(groupOf(buildView(s, NOW), null).name, 'Misc');
});

test('A group of only links is shown with no check-ins counted; the day summary ignores links', () => {
  const s = mini();
  s.items = s.items.filter((/** @type {any} */ i) => i.id !== 'c1' && i.id !== 'c2');
  patch(s, 'l1', { groupId: 'g1' });
  const v = buildView(s, NOW);
  assert.deepEqual(v.workspaces[0].groups.map((/** @type {any} */ g) => g.id), ['g1', null], 'the links-only group and the ungrouped section are both listed');
  const g = groupOf(v, 'g1');
  assert.deepEqual([rowIds(g), g.progress], [['l1'], { done: 0, total: 0 }]);
  assert.deepEqual(dayProgress(v), { done: 0, total: 0, complete: false }, 'links never make the day complete or add to the total');
  // a mix: all check-ins ticked means the day is complete whatever links there are
  const m = mini();
  const done = withTick(withTick(m, 'c1', NOW), 'c2', NOW);
  assert.deepEqual(dayProgress(buildView(done, NOW)), { done: 2, total: 2, complete: true });
  // a workspace with nothing visible at all is omitted
  s.items = [];
  assert.deepEqual(buildView(s, NOW).workspaces, []);
});

test('Hidden links: deleted and desktop-only unscheduled items are not shown; phone-only ones are', () => {
  const s = mini();
  patch(s, 'l1', { deleted: true });
  patch(s, 'l2', { devices: 'desktop' });
  patch(s, 'l3', { devices: 'phone' });
  assert.deepEqual(rowIds(groupOf(buildView(s, NOW), null)), ['c2', 'l3', 'l4']);
  // a group whose only link is hidden is not listed
  const t = mini();
  patch(t, 'l1', { groupId: 'g2' });
  t.groups.push({ id: 'g2', workspaceId: 'w1', name: 'Only links', order: 1, collapsed: false, updatedAt: 0, deleted: false });
  assert.equal(groupOf(buildView(t, NOW), 'g2').items.length, 1);
  patch(t, 'l1', { devices: 'desktop' });
  assert.equal(groupOf(buildView(t, NOW), 'g2'), undefined);
});

test('A link whose group is deleted, or names a group of another workspace, goes to the ungrouped section', () => {
  const s = mini();
  patch(s, 'l1', { groupId: 'g1' });
  s.groups[0].deleted = true;
  assert.deepEqual(buildView(s, NOW).workspaces[0].groups.map((/** @type {any} */ g) => g.id), [null]);
  assert.ok(rowIds(groupOf(buildView(s, NOW), null)).includes('l1'));
  assert.ok(rowIds(groupOf(buildView(s, NOW), null)).includes('c1'), 'the group\'s check-in goes there too');
  const t = mini();
  t.groups.push({ id: 'g-other', workspaceId: 'w-elsewhere', name: 'Elsewhere', order: 1, collapsed: false, updatedAt: 0, deleted: false });
  patch(t, 'l2', { groupId: 'g-other' });
  assert.ok(rowIds(groupOf(buildView(t, NOW), null)).includes('l2'));
});

test('Links open like check-ins: expanded address, app items use the fallback, missing Google email gives the hint', () => {
  const s = mini();
  const link = (/** @type {string} */ id) => /** @type {any} */ (buildView(s, NOW).workspaces[0]).groups.flatMap((/** @type {any} */ g) => g.items).find((/** @type {any} */ l) => l.id === id);
  patch(s, 'l1', { url: 'https://example.com/mail?authuser={googleEmail}&m={YYYY}{MM}' });
  assert.deepEqual([link('l1').href, link('l1').hint], [null, 'set-google-email']);
  s.settings.googleEmail = 'me+tag@example.com';
  assert.equal(link('l1').href, 'https://example.com/mail?authuser=me%2Btag%40example.com&m=202610');
  assert.equal(link('l2').href, 'https://example.com/l2');
  patch(s, 'l3', { kind: 'app', url: null, appPath: 'C:\\apps\\notes.exe', fallbackUrl: 'https://notes.example.com/' });
  assert.equal(link('l3').href, 'https://notes.example.com/');
  patch(s, 'l3', { fallbackUrl: null });
  assert.deepEqual([link('l3').href, link('l3').hint], [null, null], 'an app item without a fallback is not openable');
});

test('iconOf: the origin of the item\'s address plus /favicon.ico, for http(s) sites only; the typed icon is passed through', () => {
  const it = (/** @type {Record<string, unknown>} */ over) => /** @type {any} */ ({ kind: 'web', url: 'https://example.com/a/b?x=1#h', fallbackUrl: null, icon: null, ...over });
  assert.deepEqual(iconOf(it({})), { icon: null, iconUrl: 'https://example.com/favicon.ico' });
  assert.equal(iconOf(it({ url: 'https://example.com:8443/a' })).iconUrl, 'https://example.com:8443/favicon.ico');
  assert.equal(iconOf(it({ url: 'http://nas.local/x' })).iconUrl, 'http://nas.local/favicon.ico');
  assert.equal(iconOf(it({ url: 'https://user:secret@example.com/x' })).iconUrl, 'https://example.com/favicon.ico', 'credentials in an address never reach the icon request');
  assert.equal(iconOf(it({ url: 'https://example.com/m/{YYYY}{MM}?u={googleEmail}' })).iconUrl, 'https://example.com/favicon.ico', 'placeholders in the path or query do not matter');
  assert.equal(iconOf(it({ url: 'https://{googleEmail}.example.com/' })).iconUrl, null, 'a placeholder in the host is not a valid address as written');
  for (const bad of ['ftp://example.com/x', 'javascript:alert(1)', 'file:///C:/x', 'example.com', '', '   ', null]) assert.equal(iconOf(it({ url: bad })).iconUrl, null, String(bad));
  // an empty web address falls back to the fallback address; an app item always uses its fallback
  assert.equal(iconOf(it({ url: '', fallbackUrl: 'https://fb.example.com/p' })).iconUrl, 'https://fb.example.com/favicon.ico');
  assert.equal(iconOf(it({ kind: 'app', url: 'https://ignored.example.com/', fallbackUrl: 'https://notes.example.com/' })).iconUrl, 'https://notes.example.com/favicon.ico');
  assert.equal(iconOf(it({ kind: 'app', url: null, fallbackUrl: null })).iconUrl, null);
  // the typed icon is trimmed; blank means none
  assert.equal(iconOf(it({ icon: '  🍎 ' })).icon, '🍎');
  assert.equal(iconOf(it({ icon: '   ' })).icon, null);
});

test('letterOf: the first letter, upper case; an emoji stays whole; a blank name is ?', () => {
  assert.equal(letterOf(' mail'), 'M');
  assert.equal(letterOf('🍎 apples'), '🍎');
  assert.equal(letterOf(''), '?');
  assert.equal(letterOf('   '), '?');
});

test('every check-in, Not due entry and link carries its icon and iconUrl', () => {
  const s = mini();
  patch(s, 'l1', { icon: '🍎' });
  const v = buildView(s, NOW);
  const ws = /** @type {any} */ (v.workspaces[0]);
  const rows = ws.groups.flatMap((/** @type {any} */ g) => g.items);
  for (const i of rows) assert.ok('icon' in i && 'iconUrl' in i, i.id);
  assert.equal(rows.find((/** @type {any} */ l) => l.id === 'l1').icon, '🍎');
  assert.equal(rows.find((/** @type {any} */ l) => l.id === 'l2').iconUrl, 'https://example.com/favicon.ico');
  const all = buildView(snap(), NOW);
  for (const w of all.workspaces) for (const i of [...w.groups.flatMap((/** @type {any} */ g) => g.items), ...w.notDue]) assert.ok('iconUrl' in i, i.id);
});