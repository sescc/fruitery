// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED, periodKey } from '../../../packages/core/index.js';
import { listModel, nextDueId, nextDueForItem, iconChoice, shouldOfferTick, cycle, badgeTotal, layoutOrDefault, visibleItems, liveWorkspaces, editTarget } from '../lib/viewmodel.js';

const NOON = Date.UTC(2026, 9, 12, 12, 0, 0); // a Monday
const snap = () => /** @type {any} */ ({ ...structuredClone(SEED), completions: [] });

test('the Daily list: groups in order, progress, and the example schedules that are not due go to Not due', () => {
  const m = listModel(snap(), 'ws-daily', NOON);
  assert.deepEqual(m.sections.map((s) => s.name), ['Study', 'Perks', 'Fun']);
  const learning = m.sections[0];
  assert.deepEqual(learning.rows.map((r) => r.item.id), ['it-language', 'it-coding']);
  assert.equal(learning.total, 2);
  assert.equal(learning.done, 0);
  // Monday: the weekly (Monday) item is due; the every-3-days item (start 2026-01-01) is due on day multiples
  assert.ok(m.order.includes('it-weekly-bonus'));
  assert.equal(m.basketFull, false);
});

test('a weekly item of another weekday and a not-yet-started every-N-days item go to Not due with their next date', () => {
  const s = snap();
  s.items.find((/** @type {any} */ i) => i.id === 'it-weekly-bonus').schedule = { type: 'weekly', weekday: 3 };
  s.items.find((/** @type {any} */ i) => i.id === 'it-every-3-days').schedule = { type: 'everyNDays', n: 3, startDate: '2030-01-01' };
  // ticked on Thursday the 8th: still the same weekly period on Monday the 12th, but not today
  s.completions.push({ itemId: 'it-weekly-bonus', periodKey: '2026-10-07', doneAt: Date.UTC(2026, 9, 8, 12) });
  const m = listModel(s, 'ws-daily', NOON);
  assert.deepEqual(m.notDue.map((r) => r.item.id).sort(), ['it-every-3-days', 'it-weekly-bonus']);
  const weekly = m.notDue.find((r) => r.item.id === 'it-weekly-bonus');
  assert.equal(weekly?.nextDue, '2026-10-14');
  assert.equal(m.notDue.find((r) => r.item.id === 'it-every-3-days')?.nextDue, '2030-01-01');
  // Not due items are not in the sections, but are last in the cycle order
  assert.ok(!m.sections.some((sec) => sec.rows.some((r) => r.item.id === 'it-weekly-bonus')));
  assert.deepEqual(m.order.slice(-2).sort(), ['it-every-3-days', 'it-weekly-bonus']);
});

test('ticking every due item makes the basket full; one still due does not', () => {
  const s = snap();
  s.items.find((/** @type {any} */ i) => i.id === 'it-every-3-days').schedule = null;
  const dueIds = listModel(s, 'ws-daily', NOON).sections.flatMap((sec) => sec.rows).filter((r) => r.bucket === 'due').map((r) => r.item.id);
  assert.ok(dueIds.length >= 5);
  const tick = (/** @type {string} */ id) => {
    const it = s.items.find((/** @type {any} */ i) => i.id === id);
    s.completions.push({ itemId: id, periodKey: periodKey(it.schedule, NOON, 'UTC', it.resetTime), doneAt: NOON });
  };
  for (const id of dueIds.slice(0, -1)) tick(id);
  assert.equal(listModel(s, 'ws-daily', NOON).basketFull, false);
  tick(dueIds[dueIds.length - 1]);
  const full = listModel(s, 'ws-daily', NOON);
  assert.equal(full.basketFull, true);
  assert.equal(full.sections[0].done, 2);
});

test('a workspace without scheduled items never shows Basket full', () => {
  assert.equal(listModel(snap(), 'ws-productivity', NOON).basketFull, false);
});

test('ungrouped items form one section: unnamed when there are no groups, the label of the workspace (default "Default") when there are', () => {
  const p = listModel(snap(), 'ws-productivity', NOON);
  assert.equal(p.sections.length, 1);
  assert.equal(p.sections[0].name, '');
  assert.equal(p.sections[0].id, null);
  const s = snap();
  s.items.find((/** @type {any} */ i) => i.id === 'it-word-game').groupId = null;
  const d = listModel(s, 'ws-daily', NOON);
  assert.equal(d.sections[d.sections.length - 1].name, 'Default');
});

test('no section name is ever null, undefined or the text "null": no groups -> unnamed (the UI draws no header); with groups -> its label last (default "Default")', () => {
  const names = (/** @type {any} */ m) => m.sections.map((/** @type {any} */ s) => s.name);
  const noGroups = listModel(snap(), 'ws-productivity', NOON);
  assert.deepEqual(names(noGroups), ['']);
  const withGroups = listModel(snap(), 'ws-daily', NOON);
  const s = snap();
  s.items.find((/** @type {any} */ i) => i.id === 'it-word-game').groupId = null;
  const mixed = listModel(s, 'ws-daily', NOON);
  assert.equal(names(mixed).at(-1), 'Default');
  for (const m of [noGroups, withGroups, mixed]) {
    for (const n of names(m)) assert.ok(typeof n === 'string' && n !== 'null' && n !== 'undefined');
  }
  // a workspace with groups but nothing ungrouped has no label section at all
  assert.ok(!names(withGroups).includes('Default'));
});

test('the ungrouped header uses the workspace label (core ungroupedLabelOf); blank or absent = Default; with no named group there is still no header', () => {
  const s = snap();
  s.items.find((/** @type {any} */ i) => i.id === 'it-word-game').groupId = null;
  const labelOf = (/** @type {any} */ label) => {
    s.workspaces.find((/** @type {any} */ w) => w.id === 'ws-daily').ungroupedLabel = label;
    return listModel(s, 'ws-daily', NOON).sections.at(-1)?.name;
  };
  assert.equal(labelOf('Loose ends'), 'Loose ends');
  assert.equal(labelOf('  Spaced  '), 'Spaced');
  assert.equal(labelOf(null), 'Default');
  assert.equal(labelOf(''), 'Default');
  assert.equal(labelOf(undefined), 'Default');
  s.workspaces.find((/** @type {any} */ w) => w.id === 'ws-productivity').ungroupedLabel = 'Loose ends';
  assert.deepEqual(listModel(s, 'ws-productivity', NOON).sections.map((/** @type {any} */ x) => x.name), [''], 'no named group: no header, whatever the label');
});
test('phone-only items and deleted items are not listed', () => {
  const s = snap();
  s.items.find((/** @type {any} */ i) => i.id === 'it-mail').devices = 'phone';
  s.items.find((/** @type {any} */ i) => i.id === 'it-notes').deleted = true;
  assert.deepEqual(visibleItems(s, 'ws-productivity').map((i) => i.id), ['it-gcal', 'it-tasks']);
});

test('nextDueId: the next due item after the current one in list order, wrapping, null when none', () => {
  const m = listModel(snap(), 'ws-daily', NOON);
  const dueFlat = m.sections.flatMap((s) => s.rows).filter((r) => r.bucket === 'due').map((r) => r.item.id);
  assert.equal(nextDueId(m, dueFlat[0]), dueFlat[1]);
  assert.equal(nextDueId(m, dueFlat[dueFlat.length - 1]), dueFlat[0]);
  assert.equal(nextDueId(m, null), dueFlat[0]);
  assert.equal(nextDueId(m, 'not-in-list'), dueFlat[0]);
  const only = { sections: [{ id: null, name: '', collapsed: false, done: 0, total: 1, rows: [{ item: /** @type {any} */ ({ id: 'x' }), bucket: /** @type {const} */ ('due'), nextDue: null }] }] };
  assert.equal(nextDueId(only, 'x'), null);
});

test('nextDueForItem (Done / Next): the next due item of the item\'s own workspace, wrapping, never itself, null when nothing else is due', () => {
  const s = snap();
  const m = listModel(s, 'ws-daily', NOON);
  const dueFlat = m.sections.flatMap((x) => x.rows).filter((r) => r.bucket === 'due').map((r) => r.item.id);
  assert.ok(dueFlat.length >= 3);
  assert.equal(nextDueForItem(s, dueFlat[0], NOON), dueFlat[1]);
  assert.equal(nextDueForItem(s, dueFlat[dueFlat.length - 1], NOON), dueFlat[0], 'wraps to the first');
  // an item that is not due itself (ticked) still finds the next due one after it
  const done = dueFlat[0];
  const it = s.items.find((/** @type {any} */ i) => i.id === done);
  s.completions.push({ itemId: done, periodKey: periodKey(it.schedule, NOON, 'UTC', it.resetTime), doneAt: NOON });
  assert.equal(nextDueForItem(s, done, NOON), dueFlat[1]);
  // the item's workspace decides, not the selected one: an unscheduled item of Productivity has no due Daily neighbour order
  assert.equal(nextDueForItem(s, 'it-gcal', NOON), null, 'a workspace without check-ins has nothing due');
  assert.equal(nextDueForItem(s, 'nope', NOON), null);
  // the last due item: nothing else
  for (const id of dueFlat.slice(1)) {
    const x = s.items.find((/** @type {any} */ i) => i.id === id);
    s.completions.push({ itemId: id, periodKey: periodKey(x.schedule, NOON, 'UTC', x.resetTime), doneAt: NOON });
  }
  assert.equal(nextDueForItem(s, dueFlat[1], NOON), null);
});

test('iconChoice: typed emoji or letter, then the site icon, then the first letter', () => {
  assert.deepEqual(iconChoice({ name: 'Mail', icon: '🍎' }, true), { kind: 'text', text: '🍎' });
  assert.deepEqual(iconChoice({ name: 'Mail', icon: '  M  ' }, false), { kind: 'text', text: 'M' });
  assert.deepEqual(iconChoice({ name: 'Mail', icon: null }, true), { kind: 'image' });
  assert.deepEqual(iconChoice({ name: 'Mail', icon: '   ' }, true), { kind: 'image' });
  assert.deepEqual(iconChoice({ name: ' mail', icon: null }, false), { kind: 'letter', text: 'M' });
  assert.deepEqual(iconChoice({ name: '🍎 apples' }, false), { kind: 'letter', text: '🍎' });
  assert.deepEqual(iconChoice({ name: '   ' }, false), { kind: 'letter', text: '?' });
});

test('shouldOfferTick: only a scheduled item that is still due', () => {
  assert.equal(shouldOfferTick({ schedule: { type: 'daily' } }, 'due'), true);
  assert.equal(shouldOfferTick({ schedule: { type: 'daily' } }, 'done'), false);
  assert.equal(shouldOfferTick({ schedule: { type: 'daily' } }, 'notDue'), false);
  assert.equal(shouldOfferTick({ schedule: null }, 'due'), false);
  assert.equal(shouldOfferTick({ schedule: null }, null), false);
  assert.equal(shouldOfferTick(null, 'due'), false);
  assert.equal(shouldOfferTick(undefined, 'due'), false);
});

test('cycle wraps in both directions and starts at an end when the current item is unknown', () => {
  assert.equal(cycle(['a', 'b', 'c'], 'a', 1), 'b');
  assert.equal(cycle(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(cycle(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(cycle(['a', 'b', 'c'], null, 1), 'a');
  assert.equal(cycle(['a', 'b', 'c'], 'zzz', -1), 'c');
  assert.equal(cycle([], 'a', 1), null);
});

test('badge totals sum only items with the badge option on, per workspace', () => {
  const s = snap();
  s.items.find((/** @type {any} */ i) => i.id === 'it-mail').badge = true;
  s.items.find((/** @type {any} */ i) => i.id === 'it-tasks').badge = false;
  const badges = { 'it-mail': 4, 'it-tasks': 9, 'it-word-game': 2 };
  assert.equal(badgeTotal(s, 'ws-productivity', badges), 4 + 0 + 0 + 0 + (s.items.find((/** @type {any} */ i) => i.id === 'it-gcal').badge ? 0 : 0));
  assert.equal(badgeTotal(s, 'ws-daily', badges), 0);
});

test('layoutOrDefault: the stored layout, else a single pane with the last shown item', () => {
  const stored = { type: /** @type {const} */ ('leaf'), paneId: 'p9', itemId: 'a' };
  assert.deepEqual(layoutOrDefault({ layouts: { w: stored }, activeItemByWorkspace: {} }, 'w'), stored);
  assert.deepEqual(layoutOrDefault({ layouts: {}, activeItemByWorkspace: { w: 'it' } }, 'w'), { type: 'leaf', paneId: 'p1', itemId: 'it' });
  assert.deepEqual(layoutOrDefault({ layouts: {}, activeItemByWorkspace: {} }, 'w'), { type: 'leaf', paneId: 'p1', itemId: null });
});

test('liveWorkspaces are in rail order and skip deleted ones', () => {
  const s = snap();
  s.workspaces.push({ id: 'ws-x', name: 'X', icon: null, order: -1, sleepAfterMin: 0, openInEdge: false, updatedAt: 0, deleted: false });
  s.workspaces.push({ id: 'ws-gone', name: 'G', icon: null, order: 5, sleepAfterMin: 0, openInEdge: false, updatedAt: 0, deleted: true });
  assert.deepEqual(liveWorkspaces(s).map((w) => w.id), ['ws-x', 'ws-productivity', 'ws-daily']);
});

test('editTarget (F3): the focused UI entry wins; else the focused pane item; else nothing', () => {
  assert.deepEqual(editTarget({ kind: 'group', id: 'g1' }, 'it1'), { kind: 'group', id: 'g1' });
  assert.deepEqual(editTarget({ kind: 'workspace', id: 'w1' }, null), { kind: 'workspace', id: 'w1' });
  assert.deepEqual(editTarget({ kind: 'item', id: 'i2' }, 'it1'), { kind: 'item', id: 'i2' });
  assert.deepEqual(editTarget(null, 'it1'), { kind: 'item', id: 'it1' });
  assert.deepEqual(editTarget(undefined, 'it1'), { kind: 'item', id: 'it1' });
  assert.equal(editTarget(null, null), null);
  assert.equal(editTarget(null, ''), null);
  assert.equal(editTarget(undefined, undefined), null);
  // an unusable focus falls back to the pane item
  assert.deepEqual(editTarget({ kind: 'dialog', id: 'x' }, 'it1'), { kind: 'item', id: 'it1' });
  assert.deepEqual(editTarget({ kind: 'item', id: '' }, 'it1'), { kind: 'item', id: 'it1' });
});