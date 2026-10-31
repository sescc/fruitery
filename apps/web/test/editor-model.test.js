// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED, validateItem, removalPlan, mergeLww } from '../../../packages/core/index.js';
import { editorModel, view } from '../test-support/load-view.js';

const { PHONE_FIELDS, newItem, applyForm, formFromItem, moveWithin, newGroup, newWorkspace, rename, newId, errorsByField, checkName, scheduleFromFields, scheduleFields, dropPlan, renameWorkspace } = editorModel;

const NOW = Date.parse('2026-10-15T00:00:00Z');

/** @returns {any} a mutable copy of the example dataset */
function snap() {
  return { ...structuredClone(SEED), completions: [] };
}

/** @param {any} s @param {string} id */
const itemOf = (s, id) => s.items.find((/** @type {any} */ i) => i.id === id);

test('newId joins the prefix and the injected UUID', () => {
  assert.equal(newId('it', () => 'abc-123'), 'it-abc-123');
});

test('Add a daily check-in: a new item in group Study validates and appears as due in the view', () => {
  const s = snap();
  const fresh = applyForm(newItem(s, { workspaceId: 'ws-daily', groupId: 'g-study' }, NOW, 'it-new'), { name: 'Example quiz', url: 'https://example.com/quiz' }, NOW);
  assert.deepEqual(validateItem(fresh, { groups: s.groups }), []);
  assert.deepEqual(fresh.schedule, { type: 'daily' }, 'a grouped item defaults to a daily schedule');
  const next = { ...s, items: [...s.items, fresh] };
  const learning = view.buildView(next, NOW).workspaces.find((w) => w.id === 'ws-daily')?.groups.find((g) => g.id === 'g-study');
  const row = learning?.items.find((i) => i.id === 'it-new');
  assert.equal(row?.bucket, 'due');
  assert.equal(row?.href, 'https://example.com/quiz');
});

test('newItem defaults, order last among siblings, and no schedule outside a group', () => {
  const s = snap();
  const learning = s.items.filter((/** @type {any} */ i) => i.groupId === 'g-study');
  const grouped = newItem(s, { workspaceId: 'ws-daily', groupId: 'g-study' }, NOW, 'a');
  assert.equal(grouped.order, Math.max(...learning.map((/** @type {any} */ i) => i.order)) + 1);
  assert.deepEqual(
    { kind: grouped.kind, devices: grouped.devices, resetTime: grouped.resetTime, edge: grouped.edge, isolate: grouped.isolate, persistSessionCookies: grouped.persistSessionCookies, sleepAfterMin: grouped.sleepAfterMin, icon: grouped.icon, userAgent: grouped.userAgent, notify: grouped.notify, badge: grouped.badge, appPath: grouped.appPath, updatedAt: grouped.updatedAt, deleted: grouped.deleted },
    { kind: 'web', devices: 'all', resetTime: '00:00', edge: { mode: 'inherit', profile: null }, isolate: false, persistSessionCookies: true, sleepAfterMin: null, icon: null, userAgent: { preset: 'default', custom: null }, notify: false, badge: false, appPath: null, updatedAt: NOW, deleted: false },
  );
  const ungrouped = newItem(s, { workspaceId: 'ws-productivity' }, NOW, 'b');
  assert.equal(ungrouped.groupId, null);
  assert.equal(ungrouped.schedule, null);
  assert.equal(ungrouped.order, 4, 'after the four productivity items');
  assert.equal(newItem({ items: [] }, { workspaceId: 'x' }, NOW, 'c').order, 0);
  // deleted siblings do not count
  s.items.find((/** @type {any} */ i) => i.id === 'it-tasks').deleted = true;
  s.items.find((/** @type {any} */ i) => i.id === 'it-notes').deleted = true;
  assert.equal(newItem(s, { workspaceId: 'ws-productivity' }, NOW, 'd').order, 2);
});

test('Invalid URL: a URL without a scheme gives a url error that errorsByField phrases', () => {
  const s = snap();
  const bad = applyForm(newItem(s, { workspaceId: 'ws-daily', groupId: 'g-study' }, NOW, 'x'), { name: 'Quiz', url: 'example.com' }, NOW);
  const errors = validateItem(bad, { groups: s.groups });
  assert.deepEqual(errors, [{ field: 'url', code: 'invalid-url' }]);
  assert.deepEqual(errorsByField(errors), { url: 'Must start with http:// or https://' });
  // a blank URL on a web item is "required"
  const blank = applyForm(bad, { url: '   ' }, NOW);
  assert.equal(blank.url, null);
  assert.deepEqual(errorsByField(validateItem(blank, { groups: s.groups })), { url: 'Required' });
});

test('Edit a renamed desktop item: an isolated, Firefox-preset item keeps both, and every desktop-only field survives', () => {
  const s = snap();
  const original = /** @type {any} */ (itemOf(s, 'it-language'));
  Object.assign(original, {
    kind: 'app', appPath: 'C:\\apps\\x.exe', fallbackUrl: 'https://learn.example.org/daily', isolate: true, persistSessionCookies: false, sleepAfterMin: 3,
    edge: { mode: 'always', profile: 'Profile 2' }, userAgent: { preset: 'firefox', custom: null }, icon: 'owl',
  });
  const before = JSON.stringify(original);
  const out = applyForm(original, { ...formFromItem(original), name: 'Language practice (renamed)' }, NOW + 1);
  assert.equal(JSON.stringify(original), before, 'the input is not mutated');
  assert.equal(out.name, 'Language practice (renamed)');
  assert.equal(out.updatedAt, NOW + 1);
  for (const field of ['kind', 'appPath', 'isolate', 'persistSessionCookies', 'sleepAfterMin', 'edge', 'userAgent', 'icon', 'order', 'id', 'deleted']) {
    assert.deepEqual(/** @type {any} */ (out)[field], original[field], field);
  }
  assert.equal(out.isolate, true);
  assert.equal(out.userAgent.preset, 'firefox');
  assert.notEqual(out.edge, original.edge, 'nested objects are copies');
});

test('applyForm copies only PHONE_FIELDS: attempts to set desktop-only fields through the form are ignored', () => {
  const item = /** @type {any} */ (itemOf(snap(), 'it-word-game'));
  const out = applyForm(item, { kind: 'app', appPath: 'C:\\evil.exe', isolate: true, userAgent: { preset: 'chrome', custom: null }, edge: { mode: 'always', profile: null }, sleepAfterMin: 0, id: 'other', deleted: true, order: 99 }, NOW);
  for (const field of ['kind', 'appPath', 'isolate', 'userAgent', 'edge', 'sleepAfterMin', 'id', 'deleted', 'order']) assert.deepEqual(/** @type {any} */ (out)[field], item[field], field);
  assert.deepEqual([...PHONE_FIELDS], ['name', 'url', 'fallbackUrl', 'deepLink', 'workspaceId', 'groupId', 'schedule', 'resetTime', 'devices', 'notify', 'badge']);
});

test('applyForm changes each phone field, trims text, and treats blank optional text as null', () => {
  const item = /** @type {any} */ (itemOf(snap(), 'it-word-game'));
  const out = applyForm(item, { name: '  Word game!  ', url: ' https://example.com/w ', fallbackUrl: ' ', deepLink: ' myapp://open ', resetTime: '04:30', devices: 'phone', notify: true, badge: true, schedule: { type: 'weekly', weekday: 3 } }, NOW);
  assert.deepEqual([out.name, out.url, out.fallbackUrl, out.deepLink, out.resetTime, out.devices, out.notify, out.badge, out.schedule], ['Word game!', 'https://example.com/w', null, 'myapp://open', '04:30', 'phone', true, true, { type: 'weekly', weekday: 3 }]);
  assert.equal(applyForm(item, { schedule: null }, NOW).schedule, null);
  assert.equal(applyForm(item, { deepLink: '  ' }, NOW).deepLink, null); // blank deep link clears it
});

test('Moving to another workspace clears the group (core moveItem) unless the form also names a group there, and places the item last', () => {
  const s = snap();
  const item = /** @type {any} */ (itemOf(s, 'it-word-game'));
  const moved = applyForm(item, { workspaceId: 'ws-productivity' }, NOW, s);
  assert.equal(moved.workspaceId, 'ws-productivity');
  assert.equal(moved.groupId, null);
  assert.equal(moved.order, 4, 'last among the four productivity items');
  assert.equal(moved.updatedAt, NOW);
  // with a group of the new workspace in the same form
  const s2 = snap();
  s2.groups.push({ id: 'g-p', workspaceId: 'ws-productivity', name: 'P', order: 0, collapsed: false, updatedAt: 0, deleted: false });
  const both = applyForm(itemOf(s2, 'it-word-game'), { workspaceId: 'ws-productivity', groupId: 'g-p' }, NOW, s2);
  assert.deepEqual([both.workspaceId, both.groupId], ['ws-productivity', 'g-p']);
  assert.deepEqual(validateItem(both, { groups: s2.groups }), []);
  // a group from another workspace is caught by validateItem, not silently accepted
  const wrong = applyForm(item, { groupId: 'g-nope' }, NOW);
  assert.deepEqual(validateItem(wrong, { groups: s.groups }), [{ field: 'groupId', code: 'group-not-found' }]);
  // changing only the group places the item last in it
  const regroup = applyForm(itemOf(s, 'it-word-game'), { groupId: 'g-study' }, NOW, s);
  assert.equal(regroup.order, Math.max(...s.items.filter((/** @type {any} */ i) => i.groupId === 'g-study').map((/** @type {any} */ i) => i.order)) + 1);
  // an unchanged workspace and group leave the order alone
  assert.equal(applyForm(item, { workspaceId: item.workspaceId, groupId: item.groupId }, NOW, s).order, item.order);
});

test('formFromItem is the inverse of applyForm for the phone fields', () => {
  const item = /** @type {any} */ (itemOf(snap(), 'it-monthly-shop'));
  const form = formFromItem(item);
  assert.equal(form.url, 'https://example.com/shop/{YYYY}{MM}');
  assert.equal(form.fallbackUrl, '');
  assert.deepEqual(form.schedule, { type: 'monthly', day: 1 });
  const { updatedAt, ...rest } = applyForm(item, form, NOW);
  const { updatedAt: _u, ...orig } = item;
  assert.equal(updatedAt, NOW);
  assert.deepEqual(rest, orig);
  assert.equal(formFromItem({ ...item, groupId: null, url: null }).groupId, '');
});

test('scheduleFromFields and scheduleFields round-trip every schedule type', () => {
  assert.deepEqual(scheduleFromFields({ type: 'none' }), null);
  assert.deepEqual(scheduleFromFields({ type: 'daily' }), { type: 'daily' });
  assert.deepEqual(scheduleFromFields({ type: 'weekly', weekday: '3' }), { type: 'weekly', weekday: 3 });
  assert.deepEqual(scheduleFromFields({ type: 'monthly', day: '31' }), { type: 'monthly', day: 31 });
  assert.deepEqual(scheduleFromFields({ type: 'everyNDays', n: '3', startDate: '2026-01-01' }), { type: 'everyNDays', n: 3, startDate: '2026-01-01' });
  for (const schedule of [null, { type: 'daily' }, { type: 'weekly', weekday: 7 }, { type: 'monthly', day: 9 }, { type: 'everyNDays', n: 4, startDate: '2026-02-03' }]) {
    assert.deepEqual(scheduleFromFields(scheduleFields(/** @type {any} */ (schedule))), schedule);
  }
  // typed garbage is kept as NaN/'' so core validation reports it
  const s = snap();
  const item = applyForm(newItem(s, { workspaceId: 'ws-daily', groupId: 'g-study' }, NOW, 'z'), { name: 'Z', url: 'https://example.com/', schedule: scheduleFromFields({ type: 'weekly', weekday: '' }) }, NOW);
  assert.deepEqual(errorsByField(validateItem(item, { groups: s.groups })), { 'schedule.weekday': 'Out of range' });
});

test('Move up: the second item of a group becomes the first; the top item up changes nothing; the bottom item down changes nothing', () => {
  const s = snap();
  const learning = s.items.filter((/** @type {any} */ i) => i.groupId === 'g-study').sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order);
  assert.ok(learning.length >= 2);
  const up = moveWithin(s, 'item', learning[1].id, -1, NOW);
  assert.deepEqual(up.items.map((i) => [i.id, i.order, i.updatedAt]).sort(), [[learning[0].id, 1, NOW], [learning[1].id, 0, NOW]].sort());
  assert.deepEqual([up.groups, up.workspaces], [[], []]);
  const top = moveWithin(s, 'item', learning[0].id, -1, NOW);
  assert.deepEqual(top, { workspaces: [], groups: [], items: [] });
  assert.deepEqual(moveWithin(s, 'item', learning[learning.length - 1].id, 1, NOW), { workspaces: [], groups: [], items: [] });
  // applying the change puts the item first in the view
  const merged = { ...s, items: mergeLww(s.items, up.items) };
  const view2 = view.buildView(merged, NOW).workspaces.find((w) => w.id === 'ws-daily')?.groups.find((g) => g.id === 'g-study');
  assert.equal(view2?.items[0].id, learning[1].id);
});

test('moveWithin works for groups and workspaces, ignores deleted siblings, and leaves unknown ids alone', () => {
  const s = snap();
  const down = moveWithin(s, 'group', 'g-study', 1, NOW);
  assert.deepEqual(down.groups.map((g) => [g.id, g.order]).sort(), [['g-perks', 0], ['g-study', 1]]);
  const ws = moveWithin(s, 'workspace', 'ws-daily', -1, NOW);
  assert.deepEqual(ws.workspaces.map((w) => [w.id, w.order]).sort(), [['ws-daily', 0], ['ws-productivity', 1]]);
  // a deleted sibling is skipped: with g-perks deleted, moving g-study down passes g-fun
  s.groups.find((/** @type {any} */ g) => g.id === 'g-perks').deleted = true;
  const skip = moveWithin(s, 'group', 'g-study', 1, NOW);
  assert.deepEqual(skip.groups.map((g) => g.id).sort(), ['g-fun', 'g-study']);
  assert.deepEqual(moveWithin(s, 'item', 'nope', 1, NOW), { workspaces: [], groups: [], items: [] });
  assert.deepEqual(moveWithin(s, 'item', 'it-word-game', 0, NOW), { workspaces: [], groups: [], items: [] });
  // the input is not mutated
  assert.equal(s.groups.find((/** @type {any} */ g) => g.id === 'g-study').order, 0);
});

test('newGroup, newWorkspace and rename produce one stamped entity each', () => {
  const s = snap();
  const g = newGroup(s, 'ws-daily', '  Quizzes ', NOW, 'g-new');
  assert.deepEqual(g, { id: 'g-new', workspaceId: 'ws-daily', name: 'Quizzes', order: 3, collapsed: false, updatedAt: NOW, deleted: false });
  const w = newWorkspace(s, ' Home ', NOW, 'ws-new');
  assert.deepEqual(w, { id: 'ws-new', name: 'Home', icon: null, order: 2, sleepAfterMin: 10, openInEdge: false, ungroupedLabel: null, updatedAt: NOW, deleted: false });
  const renamed = rename(s.groups[0], ' Study ', NOW);
  assert.deepEqual([renamed.name, renamed.updatedAt, renamed.id], ['Study', NOW, s.groups[0].id]);
  assert.equal(s.groups[0].name, 'Study', 'the input is untouched');
  assert.deepEqual(checkName('  '), [{ field: 'name', code: 'required' }]);
  assert.deepEqual(checkName('ok'), []);
  assert.deepEqual(checkName(undefined), [{ field: 'name', code: 'required' }]);
});

test('errorsByField accepts client errors and 422 details, phrases codes, and joins several errors on one field', () => {
  assert.deepEqual(errorsByField([{ field: 'url', code: 'invalid-url' }, { field: 'resetTime', code: 'invalid-time' }]), { url: 'Must start with http:// or https://', resetTime: 'Use HH:MM, from 00:00 to 23:59' });
  const details = [{ id: 'it-1', errors: [{ field: 'url', code: 'required' }, { field: 'name', code: 'required' }] }, { id: 'it-2', errors: [{ field: 'url', code: 'unknown-token' }] }];
  assert.deepEqual(errorsByField(details), { url: 'Required; Unknown {placeholder}', name: 'Required' });
  assert.deepEqual(errorsByField([{ field: 'timezone', code: 'invalid-timezone' }, { field: 'x', code: 'something-new' }]), { timezone: 'Unknown timezone', x: 'Not accepted' });
  assert.deepEqual(errorsByField([]), {});
  assert.deepEqual(errorsByField(null), {});
  assert.deepEqual(errorsByField([{ field: 'url', code: 'required' }, { field: 'url', code: 'required' }]), { url: 'Required' });
});

test('Delete a group: removalPlan keeps its items, ungrouped, and the view lists them under Other', () => {
  const s = snap();
  const plan = /** @type {any} */ (removalPlan(s, 'group', 'g-fun', NOW));
  const next = { ...s, groups: mergeLww(s.groups, plan.changed.groups), items: mergeLww(s.items, plan.changed.items) };
  const groups = view.buildView(next, NOW).workspaces.find((w) => w.id === 'ws-daily')?.groups ?? [];
  assert.equal(groups.some((g) => g.id === 'g-fun'), false);
  assert.ok((groups.find((g) => g.id === null)?.items.length ?? 0) >= 2, 'the former Fun items are now in Other');
});

// ----- group moves (5.1 regression) and drag-and-drop plans (5.5) -----

/** A small generic dataset: workspace w1 (groups ga, gb; items a1-a3 in ga, b1 in gb, u1 ungrouped) and w2. */
function mini() {
  const ws = (/** @type {string} */ id, /** @type {number} */ order) => ({ id, name: id, icon: null, order, sleepAfterMin: 10, openInEdge: false, ungroupedLabel: null, updatedAt: 0, deleted: false });
  const grp = (/** @type {string} */ id, /** @type {string} */ workspaceId, /** @type {number} */ order) => ({ id, workspaceId, name: id, order, collapsed: false, updatedAt: 0, deleted: false });
  const it = (/** @type {string} */ id, /** @type {string} */ workspaceId, /** @type {string | null} */ groupId, /** @type {number} */ order) => ({
    ...newItem({ items: [] }, { workspaceId, groupId }, 0, id), id, name: id, url: `https://example.com/${id}`, order, groupId,
  });
  return {
    workspaces: [ws('w1', 0), ws('w2', 1)],
    groups: [grp('ga', 'w1', 0), grp('gb', 'w1', 1), grp('gx', 'w2', 0)],
    items: [it('a1', 'w1', 'ga', 0), it('a2', 'w1', 'ga', 1), it('a3', 'w1', 'ga', 2), it('b1', 'w1', 'gb', 0), it('u1', 'w1', null, 0), it('x1', 'w2', 'gx', 0)],
  };
}

/** @param {any} s @param {any} changed */
function apply(s, changed) {
  return { ...s, workspaces: mergeLww(s.workspaces, changed.workspaces), groups: mergeLww(s.groups, changed.groups), items: mergeLww(s.items, changed.items) };
}
/** @param {any} s @param {string} groupId @param {string} ws */
const seq = (s, ws, groupId) => s.items.filter((/** @type {any} */ i) => !i.deleted && i.workspaceId === ws && (i.groupId ?? null) === groupId).sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order || (a.id < b.id ? -1 : 1)).map((/** @type {any} */ i) => i.id);

test('moving groups: every position, with ties, gaps, deleted siblings and other workspaces\' groups in between', () => {
  const s = mini();
  const groupSeq = (/** @type {any} */ x, /** @type {string} */ ws) => x.groups.filter((/** @type {any} */ g) => !g.deleted && g.workspaceId === ws).sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order || (a.id < b.id ? -1 : 1)).map((/** @type {any} */ g) => g.id);
  // plain
  const down = moveWithin(s, 'group', 'ga', 1, NOW);
  assert.deepEqual(groupSeq(apply(s, down), 'w1'), ['gb', 'ga']);
  assert.deepEqual(groupSeq(apply(s, moveWithin(s, 'group', 'gb', -1, NOW)), 'w1'), ['gb', 'ga']);
  // the other workspace's group is never touched
  assert.deepEqual(down.groups.map((g) => g.id).sort(), ['ga', 'gb']);
  // ties (all order 0): visible order is by id, and a move still takes effect
  const tied = { ...s, groups: s.groups.map((g) => ({ ...g, order: 0 })) };
  const t = apply(tied, moveWithin(tied, 'group', 'gb', -1, NOW));
  assert.deepEqual(groupSeq(t, 'w1'), ['gb', 'ga']);
  // gaps in the stored order
  const gappy = { ...s, groups: s.groups.map((g) => ({ ...g, order: g.order * 10 + 5 })) };
  assert.deepEqual(groupSeq(apply(gappy, moveWithin(gappy, 'group', 'ga', 1, NOW)), 'w1'), ['gb', 'ga']);
  // a deleted group in between is skipped; three groups, moving across it
  const three = { ...s, groups: [...s.groups, { id: 'gc', workspaceId: 'w1', name: 'gc', order: 2, collapsed: false, updatedAt: 0, deleted: false }, { id: 'gd', workspaceId: 'w1', name: 'gd', order: 1.5, collapsed: false, updatedAt: 0, deleted: true }] };
  assert.deepEqual(groupSeq(apply(three, moveWithin(three, 'group', 'gc', -1, NOW)), 'w1'), ['ga', 'gc', 'gb']);
  // the server's winners merged back keep the new order (what the phone does after a save)
  const merged = apply(three, moveWithin(three, 'group', 'ga', 1, NOW));
  assert.deepEqual(groupSeq(merged, 'w1'), ['gb', 'ga', 'gc']);
  assert.deepEqual(view.buildView({ ...merged, settings: { timezone: 'UTC', googleEmail: null, updatedAt: 0 }, completions: [] }, NOW).workspaces.map((w) => w.id), ['w1', 'w2']);
});

test('dropPlan: reorder within a group', () => {
  const s = mini();
  const plan = dropPlan(s, { kind: 'item', id: 'a3' }, { groupId: 'ga', index: 0 }, NOW);
  assert.deepEqual(plan.items.map((i) => i.id).sort(), ['a1', 'a2', 'a3']);
  assert.ok(plan.items.every((i) => i.updatedAt === NOW && i.groupId === 'ga'));
  assert.deepEqual(seq(apply(s, plan), 'w1', 'ga'), ['a3', 'a1', 'a2']);
  assert.deepEqual([plan.groups, plan.workspaces], [[], []]);
  assert.deepEqual(seq(apply(s, dropPlan(s, { kind: 'item', id: 'a1' }, { groupId: 'ga', index: 2 }, NOW)), 'w1', 'ga'), ['a2', 'a3', 'a1']);
});

test('dropPlan: move between groups of the same workspace, into and out of "no group"', () => {
  const s = mini();
  const cross = dropPlan(s, { kind: 'item', id: 'a1' }, { groupId: 'gb', index: 1 }, NOW);
  const crossed = apply(s, cross);
  assert.deepEqual(seq(crossed, 'w1', 'gb'), ['b1', 'a1']);
  assert.equal(crossed.items.find((/** @type {any} */ i) => i.id === 'a1').groupId, 'gb');
  assert.equal(crossed.items.find((/** @type {any} */ i) => i.id === 'a1').updatedAt, NOW);
  assert.deepEqual(cross.items.map((i) => i.id), ['a1'], 'only the dragged item changed: the end of the list needs no renumbering');
  // to the front of another group renumbers its items
  assert.deepEqual(seq(apply(s, dropPlan(s, { kind: 'item', id: 'a2' }, { groupId: 'gb', index: 0 }, NOW)), 'w1', 'gb'), ['a2', 'b1']);
  // into "no group"
  const out = apply(s, dropPlan(s, { kind: 'item', id: 'a2' }, { groupId: null, index: 0 }, NOW));
  assert.deepEqual(seq(out, 'w1', null), ['a2', 'u1']);
  assert.equal(out.items.find((/** @type {any} */ i) => i.id === 'a2').groupId, null);
  // out of "no group" into a group
  const into = apply(s, dropPlan(s, { kind: 'item', id: 'u1' }, { groupId: 'ga', index: 3 }, NOW));
  assert.deepEqual(seq(into, 'w1', 'ga'), ['a1', 'a2', 'a3', 'u1']);
  assert.deepEqual(seq(into, 'w1', null), []);
  // the result still validates
  for (const item of into.items) assert.deepEqual(validateItem(item, { groups: into.groups }), [], item.id);
});

test('dropPlan: reorder groups; items dangling in a deleted group count as "no group"', () => {
  const s = mini();
  const plan = dropPlan(s, { kind: 'group', id: 'gb' }, { index: 0 }, NOW);
  assert.deepEqual(plan.groups.map((g) => [g.id, g.order]).sort(), [['ga', 1], ['gb', 0]]);
  assert.deepEqual([plan.items, plan.workspaces], [[], []]);
  assert.deepEqual(apply(s, plan).groups.filter((/** @type {any} */ g) => g.workspaceId === 'w1').sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order).map((/** @type {any} */ g) => g.id), ['gb', 'ga']);
  // a deleted group's items are shown under "no group"; dropping one of them in place changes nothing
  const dangling = { ...s, groups: s.groups.map((g) => (g.id === 'gb' ? { ...g, deleted: true } : g)) };
  assert.deepEqual(dropPlan(dangling, { kind: 'item', id: 'b1' }, { groupId: null, index: 0 }, NOW), { workspaces: [], groups: [], items: [] }, 'b1 is already first among the ungrouped');
  const after = dropPlan(dangling, { kind: 'item', id: 'b1' }, { groupId: null, index: 1 }, NOW);
  assert.deepEqual(after.items.map((i) => [i.id, i.groupId, i.order]), [['b1', null, 1]], 'dropped after u1: b1 is placed last and its dead group reference is cleared');
});

test('dropPlan: a drop that changes nothing, and invalid drops, return no changes', () => {
  const s = mini();
  const none = { workspaces: [], groups: [], items: [] };
  assert.deepEqual(dropPlan(s, { kind: 'item', id: 'a1' }, { groupId: 'ga', index: 0 }, NOW), none, 'first item dropped at the front');
  assert.deepEqual(dropPlan(s, { kind: 'item', id: 'a2' }, { groupId: 'ga', index: 1 }, NOW), none, 'middle item dropped where it is');
  assert.deepEqual(dropPlan(s, { kind: 'item', id: 'a3' }, { groupId: 'ga', index: 99 }, NOW), none, 'last item dropped past the end');
  assert.deepEqual(dropPlan(s, { kind: 'group', id: 'ga' }, { index: 0 }, NOW), none);
  assert.deepEqual(dropPlan(s, { kind: 'item', id: 'nope' }, { groupId: 'ga', index: 0 }, NOW), none);
  assert.deepEqual(dropPlan(s, { kind: 'group', id: 'nope' }, { index: 0 }, NOW), none);
  assert.deepEqual(dropPlan(s, { kind: 'item', id: 'a1' }, { groupId: 'gx', index: 0 }, NOW), none, 'a group of another workspace');
  assert.deepEqual(dropPlan(s, { kind: 'item', id: 'a1' }, { groupId: 'gone', index: 0 }, NOW), none, 'an unknown group');
  const deletedItem = { ...s, items: s.items.map((i) => (i.id === 'a1' ? { ...i, deleted: true } : i)) };
  assert.deepEqual(dropPlan(deletedItem, { kind: 'item', id: 'a1' }, { groupId: 'ga', index: 0 }, NOW), none);
  // inputs are never mutated
  const before = JSON.stringify(s);
  dropPlan(s, { kind: 'item', id: 'a3' }, { groupId: 'gb', index: 0 }, NOW);
  dropPlan(s, { kind: 'group', id: 'gb' }, { index: 0 }, NOW);
  assert.equal(JSON.stringify(s), before);
});

test('renameWorkspace sets the name and the ungrouped label; a blank label means the default', () => {
  const ws = mini().workspaces[0];
  const named = renameWorkspace(ws, { name: ' Home ', ungroupedLabel: ' Misc ' }, NOW);
  assert.deepEqual([named.name, named.ungroupedLabel, named.updatedAt], ['Home', 'Misc', NOW]);
  assert.equal(renameWorkspace(named, { name: 'Home', ungroupedLabel: '   ' }, NOW).ungroupedLabel, null);
  assert.equal(ws.name, 'w1', 'the input is untouched');
  assert.equal(newWorkspace(snap(), 'X', NOW, 'ws-x').ungroupedLabel, null);
});