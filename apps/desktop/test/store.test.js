// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../main/store.js';
import { SEED, bucket, removalPlan } from '../../../packages/core/index.js';
import { leaf, split } from '../lib/layout.js';

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0);

/** @returns {string} */
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fruitery-store-'));
}

/** @param {string} dir @param {{t?: {v: number}, seedText?: string | null}} [o] */
function open(dir, o = {}) {
  const clock = o.t ?? { v: T0 };
  let n = 0;
  return { store: openStore(dir, { now: () => clock.v, seedText: o.seedText ?? null, genId: () => `gen-${++n}` }), clock };
}

/** @param {any} r */
const ok = (r) => {
  assert.ok(r && r.ok, JSON.stringify(r));
  return r;
};

test('first run without a personal seed uses the example set and writes both files', () => {
  const dir = tmp();
  const { store } = open(dir);
  assert.equal(store.origin(), 'example-seed');
  assert.equal(store.snapshot().items.length, SEED.items.length);
  assert.equal(store.snapshot().completions.length, 0);
  assert.ok(fs.existsSync(path.join(dir, 'cache.json')));
  assert.ok(fs.existsSync(path.join(dir, 'device.json')));
  assert.equal(store.device().activeWorkspaceId, 'ws-productivity');
  assert.equal(fs.existsSync(path.join(dir, 'cache.json.tmp')), false);
});

test('first run with a valid personal seed uses it; an invalid one falls back to the example', () => {
  const local = structuredClone(/** @type {any} */ (SEED));
  local.workspaces[0].name = 'Mine';
  const a = open(tmp(), { seedText: JSON.stringify(local) });
  assert.equal(a.store.origin(), 'local-seed');
  assert.equal(a.store.snapshot().workspaces[0].name, 'Mine');
  const b = open(tmp(), { seedText: '{"broken": true}' });
  assert.equal(b.store.origin(), 'example-seed');
});

test('the seed applies only once: an existing cache is loaded, not re-seeded', () => {
  const dir = tmp();
  const a = open(dir);
  ok(a.store.upsert({ workspaces: [{ id: 'ws-daily', name: 'Renamed' }] }));
  const local = structuredClone(/** @type {any} */ (SEED));
  local.workspaces[0].name = 'Other seed';
  const b = open(dir, { seedText: JSON.stringify(local) });
  assert.equal(b.store.origin(), 'cache');
  assert.equal(b.store.snapshot().workspaces.find((w) => w.id === 'ws-daily')?.name, 'Renamed');
});

test('a corrupt cache.json is moved aside and the app falls back to the seed', () => {
  const dir = tmp();
  open(dir);
  fs.writeFileSync(path.join(dir, 'cache.json'), '{ truncated');
  const { store } = open(dir);
  assert.equal(store.origin(), 'example-seed');
  const aside = fs.readdirSync(dir).filter((f) => /^cache\.corrupt-\d+\.json$/.test(f));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), '{ truncated');
  assert.ok(store.notes().length > 0);
  // a structurally wrong (but valid JSON) cache is treated the same way
  fs.writeFileSync(path.join(dir, 'cache.json'), JSON.stringify({ workspaces: 'nope' }));
  assert.equal(open(dir).store.origin(), 'example-seed');
});

test('a corrupt device.json is moved aside and replaced by defaults', () => {
  const dir = tmp();
  open(dir);
  fs.writeFileSync(path.join(dir, 'device.json'), 'not json');
  const { store } = open(dir);
  assert.equal(store.device().autostart, false);
  assert.equal(store.device().closeToTray, true);
  assert.ok(fs.readdirSync(dir).some((f) => /^device\.corrupt-\d+\.json$/.test(f)));
});

test('tick is idempotent per period and the bucket becomes done; a new day is due again', () => {
  const dir = tmp();
  const { store, clock } = open(dir);
  const first = /** @type {any} */ (ok(store.tick('it-word-game')));
  assert.equal(first.created, true);
  const again = /** @type {any} */ (ok(store.tick('it-word-game')));
  assert.equal(again.created, false);
  assert.equal(again.completion.doneAt, first.completion.doneAt);
  assert.equal(store.snapshot().completions.length, 1);
  const item = store.snapshot().items.find((i) => i.id === 'it-word-game');
  assert.ok(item);
  assert.equal(bucket(item, store.snapshot().completions, clock.v, 'UTC'), 'done');
  clock.v += 24 * 3600_000;
  assert.equal(bucket(item, store.snapshot().completions, clock.v, 'UTC'), 'due');
  assert.equal(/** @type {any} */ (ok(store.tick('it-word-game'))).created, true);
  assert.equal(store.snapshot().completions.length, 2);
});

test('untick removes the current period tick only; ticks survive a restart', () => {
  const dir = tmp();
  const { store, clock } = open(dir);
  ok(store.tick('it-word-game'));
  clock.v += 24 * 3600_000;
  ok(store.tick('it-word-game'));
  assert.equal(/** @type {any} */ (ok(store.untick('it-word-game'))).removed, 1);
  assert.equal(store.snapshot().completions.length, 1);
  assert.equal(/** @type {any} */ (ok(store.untick('it-word-game'))).removed, 0);
  const re = open(dir, { t: clock });
  assert.equal(re.store.snapshot().completions.length, 1);
});

test('tick errors: unknown, unscheduled, deleted, not yet started', () => {
  const { store } = open(tmp());
  assert.deepEqual(store.tick('nope'), { error: 'not-found' });
  assert.deepEqual(store.tick('it-mail'), { error: 'not-scheduled' });
  assert.deepEqual(store.untick('it-mail'), { error: 'not-scheduled' });
  ok(store.upsert({ items: [{ id: 'it-word-game', schedule: { type: 'everyNDays', n: 3, startDate: '2030-01-01' } }] }));
  assert.deepEqual(store.tick('it-word-game'), { error: 'not-started' });
  ok(store.remove('item', 'it-word-game'));
  assert.deepEqual(store.tick('it-word-game'), { error: 'not-found' });
  assert.equal(store.snapshot().completions.length, 0);
});

test('the period follows the settings timezone and the item reset time', () => {
  const { store, clock } = open(tmp());
  ok(store.upsert({ settings: { timezone: 'Asia/Tokyo' } }));
  ok(store.upsert({ items: [{ id: 'it-word-game', resetTime: '04:00' }] }));
  clock.v = Date.UTC(2026, 9, 11, 18, 0, 0); // 03:00 on the 12th in Tokyo, still the 11th before the 04:00 reset
  const c = /** @type {any} */ (ok(store.tick('it-word-game')));
  assert.equal(c.completion.periodKey, '2026-10-11');
});

test('upsert: an invalid web item (empty URL) is rejected with the field, and nothing is saved', () => {
  const { store } = open(tmp());
  const before = JSON.stringify(store.snapshot());
  const r = /** @type {any} */ (store.upsert({ items: [{ id: 'it-notes', url: '' }] }));
  assert.ok(r.errors);
  assert.deepEqual(r.errors.find((/** @type {any} */ e) => e.field === 'url'), { kind: 'item', id: 'it-notes', field: 'url', code: 'required' });
  assert.equal(JSON.stringify(store.snapshot()), before);
});

test('upsert is all-or-nothing: one bad entity rejects the batch', () => {
  const { store } = open(tmp());
  const before = JSON.stringify(store.snapshot());
  const r = /** @type {any} */ (store.upsert({
    workspaces: [{ id: 'ws-daily', name: 'Fine' }],
    items: [{ id: 'new1', workspaceId: 'ws-daily', name: 'x', kind: 'web', url: 'ftp://nope' }],
  }));
  assert.ok(r.errors?.some((/** @type {any} */ e) => e.field === 'url' && e.code === 'invalid-url'));
  assert.equal(JSON.stringify(store.snapshot()), before);
});

test('upsert adds an item with defaults, a generated id, and last place among its siblings', () => {
  const { store, clock } = open(tmp());
  const r = /** @type {any} */ (ok(store.upsert({ items: [{ workspaceId: 'ws-productivity', name: 'Notes', url: 'https://example.com/notes' }] })));
  assert.deepEqual(r.ids.items, ['gen-1']);
  const it = store.snapshot().items.find((i) => i.id === 'gen-1');
  assert.ok(it);
  assert.equal(it.order, 4);
  assert.equal(it.updatedAt, clock.v);
  assert.equal(it.persistSessionCookies, true);
  assert.deepEqual(it.edge, { mode: 'inherit', profile: null });
  assert.equal(it.schedule, null);
});

test('upsert edits an item by id, stamps updatedAt, and ignores unknown keys and `deleted`', () => {
  const { store, clock } = open(tmp());
  clock.v += 5000;
  ok(store.upsert({ items: [{ id: 'it-notes', name: 'Keep notes', deleted: true, hack: 1, userAgent: { preset: 'firefox', custom: null } }] }));
  const it = /** @type {any} */ (store.snapshot().items.find((i) => i.id === 'it-notes'));
  assert.equal(it.name, 'Keep notes');
  assert.equal(it.deleted, false);
  assert.equal('hack' in it, false);
  assert.equal(it.updatedAt, clock.v);
  assert.deepEqual(it.userAgent, { preset: 'firefox', custom: null });
  assert.equal(it.url, 'https://notes.example.org');
});

test('upsert validates the user agent (custom needs a string) and unknown URL tokens', () => {
  const { store } = open(tmp());
  const r1 = /** @type {any} */ (store.upsert({ items: [{ id: 'it-notes', userAgent: { preset: 'custom', custom: '' } }] }));
  assert.ok(r1.errors.some((/** @type {any} */ e) => e.field === 'userAgent.custom'));
  const r2 = /** @type {any} */ (store.upsert({ items: [{ id: 'it-notes', url: 'https://x.example/{nope}' }] }));
  assert.ok(r2.errors.some((/** @type {any} */ e) => e.code === 'unknown-token'));
});

test('upsert checks groups: a group of another workspace is rejected; a group needs a live workspace and a name', () => {
  const { store } = open(tmp());
  const r = /** @type {any} */ (store.upsert({ items: [{ id: 'it-notes', groupId: 'g-fun' }] }));
  assert.ok(r.errors.some((/** @type {any} */ e) => e.field === 'groupId' && e.code === 'group-workspace-mismatch'));
  const g = /** @type {any} */ (store.upsert({ groups: [{ workspaceId: 'nowhere', name: ' ' }] }));
  assert.ok(g.errors.some((/** @type {any} */ e) => e.field === 'name'));
  assert.ok(g.errors.some((/** @type {any} */ e) => e.field === 'workspaceId'));
});

test('upsert settings: timezone and Google email are validated; a blank email clears it', () => {
  const { store } = open(tmp());
  assert.ok(/** @type {any} */ (store.upsert({ settings: { timezone: 'Mars/Base' } })).errors);
  assert.ok(/** @type {any} */ (store.upsert({ settings: { googleEmail: 'not an email' } })).errors);
  ok(store.upsert({ settings: { googleEmail: ' me@example.com ' } }));
  assert.equal(store.snapshot().settings.googleEmail, 'me@example.com');
  ok(store.upsert({ settings: { googleEmail: '' } }));
  assert.equal(store.snapshot().settings.googleEmail, null);
});

test('a workspace can name its ungrouped items: trimmed, blank = default (null), over 40 characters or not a string is rejected', () => {
  const { store } = open(tmp());
  const label = () => /** @type {any} */ (store.snapshot().workspaces.find((w) => w.id === 'ws-daily')).ungroupedLabel;
  ok(store.upsert({ workspaces: [{ id: 'ws-daily', ungroupedLabel: '  Loose ends ' }] }));
  assert.equal(label(), 'Loose ends');
  ok(store.upsert({ workspaces: [{ id: 'ws-daily', ungroupedLabel: '   ' }] }));
  assert.equal(label(), null);
  ok(store.upsert({ workspaces: [{ id: 'ws-daily', ungroupedLabel: 'x'.repeat(40) }] }));
  const tooLong = /** @type {any} */ (store.upsert({ workspaces: [{ id: 'ws-daily', ungroupedLabel: 'x'.repeat(41) }] }));
  assert.deepEqual(tooLong.errors.map((/** @type {any} */ e) => [e.field, e.code]), [['ungroupedLabel', 'out-of-range']]);
  const notString = /** @type {any} */ (store.upsert({ workspaces: [{ id: 'ws-daily', ungroupedLabel: 5 }] }));
  assert.ok(notString.errors.some((/** @type {any} */ e) => e.field === 'ungroupedLabel' && e.code === 'invalid-value'));
  assert.equal(label(), 'x'.repeat(40), 'a rejected edit saves nothing');
  const w = /** @type {any} */ (ok(store.upsert({ workspaces: [{ name: 'New one' }] })));
  assert.equal(/** @type {any} */ (store.snapshot().workspaces.find((x) => x.id === w.ids.workspaces[0])).ungroupedLabel, null);
});

test('workspaces and groups can be added and renamed', () => {
  const { store } = open(tmp());
  const w = /** @type {any} */ (ok(store.upsert({ workspaces: [{ name: 'Reading' }] })));
  const wsId = w.ids.workspaces[0];
  const ws = store.snapshot().workspaces.find((x) => x.id === wsId);
  assert.ok(ws);
  assert.equal(ws.order, 2);
  assert.equal(ws.sleepAfterMin, 10);
  const g = /** @type {any} */ (ok(store.upsert({ groups: [{ workspaceId: wsId, name: 'Books' }] })));
  ok(store.upsert({ groups: [{ id: g.ids.groups[0], name: 'Long reads' }] }));
  assert.equal(store.snapshot().groups.find((x) => x.id === g.ids.groups[0])?.name, 'Long reads');
  assert.ok(/** @type {any} */ (store.upsert({ workspaces: [{ id: wsId, name: '' }] })).errors);
});

test('reorder by drag: the third item of a group goes first and stays first after a restart', () => {
  const dir = tmp();
  const { store } = open(dir);
  const names = () => store.snapshot().items.filter((i) => i.groupId === 'g-fun' && !i.deleted).sort((a, b) => a.order - b.order).map((i) => i.id);
  assert.deepEqual(names(), ['it-word-game', 'it-weekly-bonus', 'it-every-3-days']);
  ok(store.reorder('item', 'g-fun', 'it-every-3-days', 0));
  assert.deepEqual(names(), ['it-every-3-days', 'it-word-game', 'it-weekly-bonus']);
  assert.deepEqual(names(), open(dir).store.snapshot().items.filter((i) => i.groupId === 'g-fun').sort((a, b) => a.order - b.order).map((i) => i.id));
});

test('reorder of an item into another group of the same workspace joins it; a foreign group is refused', () => {
  const { store } = open(tmp());
  ok(store.reorder('item', 'g-perks', 'it-word-game', 1));
  const it = store.snapshot().items.find((i) => i.id === 'it-word-game');
  assert.equal(it?.groupId, 'g-perks');
  assert.equal(it?.order, 1);
  const rewards = store.snapshot().items.filter((i) => i.groupId === 'g-perks').sort((a, b) => a.order - b.order).map((i) => i.id);
  assert.deepEqual(rewards, ['it-rewards', 'it-word-game', 'it-monthly-shop']);
  assert.deepEqual(store.reorder('item', 'nope', 'it-word-game', 0), { error: 'bad-parent' });
  assert.deepEqual(store.reorder('item', null, 'it-word-game', /** @type {any} */ ('x')), { error: 'bad-index' });
  // dropping out of every group
  ok(store.reorder('item', null, 'it-word-game', 0));
  assert.equal(store.snapshot().items.find((i) => i.id === 'it-word-game')?.groupId, null);
  assert.deepEqual(store.reorder('item', 'g-study', 'it-mail', 0), { error: 'bad-parent' });
});

test('reorder workspaces and groups', () => {
  const { store } = open(tmp());
  ok(store.reorder('workspace', null, 'ws-daily', 0));
  assert.deepEqual(store.snapshot().workspaces.sort((a, b) => a.order - b.order).map((w) => w.id), ['ws-daily', 'ws-productivity']);
  ok(store.reorder('group', 'ws-daily', 'g-fun', 0));
  assert.deepEqual(store.snapshot().groups.sort((a, b) => a.order - b.order).map((g) => g.id), ['g-fun', 'g-study', 'g-perks']);
  assert.deepEqual(store.reorder('group', 'ws-productivity', 'g-fun', 0), { error: 'bad-parent' });
  assert.deepEqual(store.reorder('workspace', null, 'ghost', 0), { error: 'not-found' });
});

test('moveItem keeps the id and history, clears the group and lands last among ungrouped items', () => {
  const { store } = open(tmp());
  ok(store.tick('it-word-game'));
  ok(store.moveItem('it-word-game', 'ws-productivity'));
  const it = store.snapshot().items.find((i) => i.id === 'it-word-game');
  assert.equal(it?.workspaceId, 'ws-productivity');
  assert.equal(it?.groupId, null);
  const ungrouped = store.snapshot().items.filter((i) => i.workspaceId === 'ws-productivity' && i.groupId === null).sort((a, b) => a.order - b.order);
  assert.equal(ungrouped[ungrouped.length - 1].id, 'it-word-game');
  assert.deepEqual(ungrouped.map((i) => i.order), [0, 1, 2, 3, 4]);
  assert.equal(store.snapshot().completions.filter((c) => c.itemId === 'it-word-game').length, 1);
  assert.deepEqual(store.moveItem('it-word-game', 'ghost'), { error: 'workspace-not-found' });
  assert.deepEqual(store.moveItem('ghost', 'ws-daily'), { error: 'not-found' });
});

test('remove: an item is tombstoned (kept, deleted: true) and leaves the layouts', () => {
  const { store } = open(tmp());
  ok(store.setLayout('ws-daily', split(leaf('p1', 'it-word-game'), 'p1', 'row', 'p2', 'it-language').tree, 'p1'));
  ok(store.remove('item', 'it-word-game'));
  const it = store.snapshot().items.find((i) => i.id === 'it-word-game');
  assert.equal(it?.deleted, true);
  const layout = /** @type {any} */ (store.device().layouts['ws-daily']);
  assert.equal(layout.a.itemId, null);
  assert.equal(layout.b.itemId, 'it-language');
  assert.deepEqual(store.remove('item', 'it-word-game'), { error: 'not-found' });
});

test('remove: a group sends its items to no group; a workspace takes its groups and items; the last workspace stays', () => {
  const { store } = open(tmp());
  ok(store.remove('group', 'g-fun'));
  assert.equal(store.snapshot().groups.find((g) => g.id === 'g-fun')?.deleted, true);
  assert.equal(store.snapshot().items.find((i) => i.id === 'it-word-game')?.groupId, null);
  ok(store.setActiveWorkspace('ws-daily'));
  ok(store.remove('workspace', 'ws-daily'));
  assert.ok(store.snapshot().items.filter((i) => i.workspaceId === 'ws-daily').every((i) => i.deleted));
  assert.equal(store.device().activeWorkspaceId, 'ws-productivity');
  assert.deepEqual(store.remove('workspace', 'ws-productivity'), { error: 'last-workspace' });
  assert.deepEqual(store.remove('thing', 'x'), { error: 'bad-kind' });
});

test('remove applies exactly the changes core removalPlan decides, and nothing else', () => {
  for (const [kind, id] of /** @type {const} */ ([['item', 'it-word-game'], ['group', 'g-fun'], ['workspace', 'ws-daily']])) {
    const { store, clock } = open(tmp());
    clock.v = T0 + 5000;
    const before = store.snapshot();
    const plan = /** @type {any} */ (removalPlan(before, kind, id, clock.v));
    assert.ok(plan.changed, kind);
    ok(store.remove(kind, id));
    const after = store.snapshot();
    const changedIds = new Set(['workspaces', 'groups', 'items'].flatMap((k) => plan.changed[k].map((/** @type {any} */ e) => `${k}:${e.id}`)));
    for (const k of /** @type {const} */ (['workspaces', 'groups', 'items'])) {
      assert.equal(after[k].length, before[k].length, `${k}: no entity added or dropped`);
      for (const entity of after[k]) {
        const planned = plan.changed[k].find((/** @type {any} */ e) => e.id === entity.id);
        const original = before[k].find((/** @type {any} */ e) => e.id === entity.id);
        assert.deepEqual(entity, planned ?? original, `${k}:${entity.id}`);
      }
    }
    assert.ok(changedIds.size > 0);
  }
  // the plan's refusals come back with the same codes
  const { store } = open(tmp());
  ok(store.remove('workspace', 'ws-daily'));
  assert.deepEqual(store.remove('workspace', 'ws-productivity'), { error: 'last-workspace' });
  assert.deepEqual(store.remove('group', 'g-nope'), { error: 'not-found' });
});

test('edits persist across a restart', () => {
  const dir = tmp();
  const a = open(dir);
  ok(a.store.upsert({ items: [{ workspaceId: 'ws-daily', name: 'Added', url: 'https://example.com/added' }] }));
  ok(a.store.remove('item', 'it-notes'));
  const b = open(dir);
  assert.ok(b.store.snapshot().items.some((i) => i.name === 'Added'));
  assert.equal(b.store.snapshot().items.find((i) => i.id === 'it-notes')?.deleted, true);
});

test('device: layouts and the active workspace/item persist; invalid layouts and unknown ids are refused or dropped', () => {
  const dir = tmp();
  const a = open(dir);
  const two = /** @type {any} */ (split(leaf('p1', 'it-gcal'), 'p1', 'row', 'p2', 'it-mail')).tree;
  ok(a.store.setLayout('ws-productivity', two, 'p2'));
  ok(a.store.setActiveWorkspace('ws-daily'));
  a.store.setActiveItem('ws-daily', 'it-word-game');
  assert.deepEqual(a.store.setLayout('ws-productivity', { type: 'junk' }, null), { error: 'bad-layout' });
  assert.deepEqual(a.store.setLayout('ghost', two, null), { error: 'workspace-not-found' });
  assert.deepEqual(a.store.setActiveWorkspace('ghost'), { error: 'workspace-not-found' });
  const b = open(dir);
  assert.deepEqual(b.store.device().layouts['ws-productivity'], two);
  assert.equal(b.store.device().focusedPaneByWorkspace['ws-productivity'], 'p2');
  assert.equal(b.store.device().activeWorkspaceId, 'ws-daily');
  assert.equal(b.store.device().activeItemByWorkspace['ws-daily'], 'it-word-game');
});

test('setFocusedPane: a leaf of the stored layout is focused and persisted; the tree is never touched (D131)', () => {
  const dir = tmp();
  const a = open(dir);
  const two = /** @type {any} */ (split(leaf('p1', 'it-gcal'), 'p1', 'row', 'p2', 'it-mail')).tree;
  ok(a.store.setLayout('ws-productivity', two, 'p1'));
  const before = JSON.stringify(a.store.device().layouts);
  assert.deepEqual(a.store.setFocusedPane('ws-productivity', 'p2'), { ok: true });
  assert.equal(a.store.device().focusedPaneByWorkspace['ws-productivity'], 'p2');
  assert.equal(JSON.stringify(a.store.device().layouts), before, 'the layout is exactly as it was');
  assert.equal(open(dir).store.device().focusedPaneByWorkspace['ws-productivity'], 'p2', 'persisted');
});

test('setFocusedPane: an unknown pane or workspace is refused and changes nothing', () => {
  const { store } = open(tmp());
  const two = /** @type {any} */ (split(leaf('p1', 'it-gcal'), 'p1', 'row', 'p2', 'it-mail')).tree;
  ok(store.setLayout('ws-productivity', two, 'p1'));
  const before = JSON.stringify(store.device());
  assert.deepEqual(store.setFocusedPane('ws-productivity', 'p9'), { error: 'pane-not-found' });
  assert.deepEqual(store.setFocusedPane('ws-productivity', /** @type {any} */ (null)), { error: 'pane-not-found' });
  assert.deepEqual(store.setFocusedPane('ghost', 'p1'), { error: 'workspace-not-found' });
  assert.equal(JSON.stringify(store.device()), before);
});

test('setFocusedPane: the pane must exist in main\'s layout, so a stale pane id from the UI cannot resurrect a closed split', () => {
  const { store } = open(tmp());
  const two = /** @type {any} */ (split(leaf('p1', 'it-gcal'), 'p1', 'row', 'p2', 'it-mail')).tree;
  ok(store.setLayout('ws-productivity', two, 'p2'));
  ok(store.setLayout('ws-productivity', leaf('p1', 'it-gcal'), 'p1')); // main closed the split meanwhile
  assert.deepEqual(store.setFocusedPane('ws-productivity', 'p2'), { error: 'pane-not-found' });
  assert.equal(store.device().layouts['ws-productivity'].type, 'leaf', 'still the single pane');
  assert.equal(store.device().focusedPaneByWorkspace['ws-productivity'], 'p1');
});

test('setFocusedPane: focusing the focused pane again writes nothing; a workspace with no stored layout has the default pane p1', () => {
  const dir = tmp();
  const { store } = open(dir);
  const deviceFile = path.join(dir, 'device.json');
  assert.deepEqual(store.setFocusedPane('ws-daily', 'p1'), { ok: true });
  assert.equal(store.device().focusedPaneByWorkspace['ws-daily'], 'p1');
  assert.equal('ws-daily' in store.device().layouts, false, 'no layout is invented');
  fs.utimesSync(deviceFile, new Date(1_000_000), new Date(1_000_000));
  assert.deepEqual(store.setFocusedPane('ws-daily', 'p1'), { ok: true });
  assert.equal(fs.statSync(deviceFile).mtimeMs, 1_000_000, 'no write for the same pane');
});

test('updateDevice keeps only known, well-typed keys', () => {
  const { store } = open(tmp());
  const d = store.updateDevice(/** @type {any} */ ({ edgeProfile: ' Profile 2 ', autostart: true, bogus: 1, windowBounds: { width: 1200, height: 800, x: 10, y: 20, maximized: true } }));
  assert.equal(d.edgeProfile, 'Profile 2');
  assert.equal(d.autostart, true);
  assert.equal('bogus' in d, false);
  assert.deepEqual(d.windowBounds, { width: 1200, height: 800, x: 10, y: 20, maximized: true });
  // a blank profile clears it; unusable values keep what was stored
  assert.equal(store.updateDevice(/** @type {any} */ ({ edgeProfile: '', autostart: 'yes', windowBounds: { width: 10, height: 10 } })).edgeProfile, null);
  assert.equal(store.device().autostart, true);
  assert.deepEqual(store.device().windowBounds, { width: 1200, height: 800, x: 10, y: 20, maximized: true });
  assert.equal(store.updateDevice({ windowBounds: null }).windowBounds, null);
});

test('listWidth: default 270, saved clamped to 180..600, junk keeps the stored value, survives a restart, sanitised on load', () => {
  const dir = tmp();
  const a = open(dir);
  assert.equal(a.store.device().listWidth, 270);
  assert.equal(a.store.updateDevice({ listWidth: 333.4 }).listWidth, 333);
  assert.equal(a.store.updateDevice({ listWidth: 5 }).listWidth, 180);
  assert.equal(a.store.updateDevice({ listWidth: 99999 }).listWidth, 600);
  a.store.updateDevice({ listWidth: 400 });
  assert.equal(a.store.updateDevice(/** @type {any} */ ({ listWidth: 'wide' })).listWidth, 400);
  assert.equal(a.store.updateDevice(/** @type {any} */ ({ autostart: true })).listWidth, 400, 'other patches keep it');
  assert.equal(open(dir).store.device().listWidth, 400);
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ listWidth: 12 }));
  assert.equal(open(dir).store.device().listWidth, 180);
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ listWidth: 'x' }));
  assert.equal(open(dir).store.device().listWidth, 270);
});

test('no temp file is left behind after many writes', () => {
  const dir = tmp();
  const { store } = open(dir);
  for (let i = 0; i < 5; i++) ok(store.upsert({ items: [{ id: 'it-notes', name: `n${i}` }] }));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('sync: defaults to all null, is sanitised, never holds a secret, and survives a restart', () => {
  const dir = tmp();
  const a = open(dir);
  assert.deepEqual(a.store.device().sync, { baseUrl: null, clientId: null, expiresOn: null });
  const set = a.store.updateDevice({ sync: { baseUrl: 'https://example.com/', clientId: ' abc.access ', expiresOn: '2027-01-01', secret: 'leak' } });
  assert.deepEqual(set.sync, { baseUrl: 'https://example.com', clientId: 'abc.access', expiresOn: '2027-01-01' });
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, 'device.json'), 'utf8')).sync).includes('leak'), false);
  assert.deepEqual(open(dir).store.device().sync, set.sync, 'survives a restart');
  assert.deepEqual(a.store.updateDevice({ autostart: true }).sync, set.sync, 'other patches keep it');
  assert.deepEqual(a.store.updateDevice(/** @type {any} */ ({ sync: 'junk' })).sync, set.sync, 'a non-object keeps the stored value');
  assert.deepEqual(a.store.updateDevice({ sync: { baseUrl: 'ftp://x', clientId: 'a b', expiresOn: '2026-02-30' } }).sync, { baseUrl: null, clientId: null, expiresOn: null }, 'unusable parts become null');
});

test('sync: an old device.json without it loads fine; junk in the file is cleaned on load', () => {
  const dir = tmp();
  open(dir);
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ listWidth: 300, autostart: true }));
  const old = open(dir).store.device();
  assert.deepEqual(old.sync, { baseUrl: null, clientId: null, expiresOn: null });
  assert.equal(old.listWidth, 300);
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ sync: { baseUrl: 'https://example.com', clientId: 'abc.access', expiresOn: 'soon' } }));
  assert.deepEqual(open(dir).store.device().sync, { baseUrl: 'https://example.com', clientId: 'abc.access', expiresOn: null });
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ sync: [1, 2] }));
  assert.deepEqual(open(dir).store.device().sync, { baseUrl: null, clientId: null, expiresOn: null });
});

test('approvedPrograms: default [], sanitised, not lost by other patches, survives a restart, old file loads', () => {
  const dir = tmp();
  const a = open(dir);
  assert.deepEqual(a.store.device().approvedPrograms, []);
  assert.deepEqual(a.store.updateDevice({ approvedPrograms: [' C:\\a.exe ', 'c:/A.EXE', '', 5, 'D:\\b.exe'] }).approvedPrograms, ['C:\\a.exe', 'D:\\b.exe']);
  assert.deepEqual(a.store.updateDevice({ autostart: true }).approvedPrograms, ['C:\\a.exe', 'D:\\b.exe'], 'other patches keep it');
  assert.deepEqual(a.store.updateDevice(/** @type {any} */ ({ approvedPrograms: 'junk' })).approvedPrograms, ['C:\\a.exe', 'D:\\b.exe'], 'a non-list keeps the stored value');
  assert.deepEqual(open(dir).store.device().approvedPrograms, ['C:\\a.exe', 'D:\\b.exe'], 'survives a restart');
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ listWidth: 300 }));
  assert.deepEqual(open(dir).store.device().approvedPrograms, [], 'an old device.json without it loads fine');
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ approvedPrograms: { a: 1 } }));
  assert.deepEqual(open(dir).store.device().approvedPrograms, [], 'junk in the file becomes []');
});

test('pinnedItemId / pinnedCollapsed: default, updated, survives a restart, and a deleted item drops the pin', () => {
  const dir = tmp();
  const a = open(dir);
  assert.equal(a.store.device().pinnedItemId, null);
  assert.equal(a.store.device().pinnedCollapsed, false);
  // pin a live item and collapse it
  assert.equal(a.store.updateDevice({ pinnedItemId: 'it-word-game', pinnedCollapsed: true }).pinnedItemId, 'it-word-game');
  assert.equal(a.store.device().pinnedCollapsed, true);
  // an unknown item is dropped on sanitize
  assert.equal(a.store.updateDevice({ pinnedItemId: 'no-such-item' }).pinnedItemId, null);
  // other patches keep the pin
  a.store.updateDevice({ pinnedItemId: 'it-word-game' });
  assert.equal(a.store.updateDevice({ autostart: true }).pinnedItemId, 'it-word-game');
  // survives a restart
  assert.equal(open(dir).store.device().pinnedItemId, 'it-word-game');
  // deleting the pinned item drops the pin on the next sanitize (remove calls cleanDevice)
  ok(a.store.remove('item', 'it-word-game'));
  assert.equal(a.store.device().pinnedItemId, null);
});

test('diskCacheMB: default 200, clamped 50..1024, kept by other patches, survives a restart', () => {
  const dir = tmp();
  const a = open(dir);
  assert.equal(a.store.device().diskCacheMB, 200);
  assert.equal(a.store.updateDevice({ diskCacheMB: 150 }).diskCacheMB, 150);
  assert.equal(a.store.updateDevice({ diskCacheMB: 5 }).diskCacheMB, 50);
  assert.equal(a.store.updateDevice({ diskCacheMB: 100000 }).diskCacheMB, 1024);
  assert.equal(a.store.updateDevice({ autostart: true }).diskCacheMB, 1024, 'other patches keep it');
  assert.equal(open(dir).store.device().diskCacheMB, 1024, 'survives a restart');
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ listWidth: 300 }));
  assert.equal(open(dir).store.device().diskCacheMB, 200, 'an old device.json without it loads with the default');
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ diskCacheMB: 'junk' }));
  assert.equal(open(dir).store.device().diskCacheMB, 200, 'junk becomes the default');
});

// ---------------------------------------------------------------------------------------------
// ticks without a connection (offline-ticks)

test('queueTick: the completion appears at once, a tick op is queued, and the answer says pending', () => {
  const { store } = open(tmp());
  const r = /** @type {any} */ (store.queueTick('it-word-game'));
  assert.deepEqual([r.ok, r.created, r.pending], [true, true, true]);
  assert.deepEqual(store.snapshot().completions, [{ itemId: 'it-word-game', periodKey: '2026-10-12', doneAt: T0 }]);
  assert.deepEqual(store.tickOutbox(), [{ op: 'tick', itemId: 'it-word-game', periodKey: '2026-10-12', doneAt: T0 }]);
});

test('queueTick: the time is this PC\'s clock moved by the server offset, and so is the period (a PC 20 minutes ahead, just before midnight)', () => {
  const dir = tmp();
  const t = { v: Date.UTC(2026, 9, 12, 23, 50, 0) }; // this PC says 23:50 on the 12th ...
  const { store } = open(dir, { t });
  assert.equal(store.applyRemote({ workspaces: store.snapshot().workspaces, groups: store.snapshot().groups, items: store.snapshot().items, settings: store.snapshot().settings, completions: [], serverNow: t.v - 20 * 60000 }).ok, true);
  assert.equal(store.serverClockOffset(), -20 * 60000, 'the server is 20 minutes behind this PC');
  const r = /** @type {any} */ (store.queueTick('it-word-game'));
  assert.equal(r.completion.doneAt, t.v - 20 * 60000);
  assert.equal(r.completion.periodKey, '2026-10-12');
  const ahead = open(tmp(), { t: { v: Date.UTC(2026, 9, 12, 0, 10, 0) } });
  ahead.store.applyRemote({ workspaces: ahead.store.snapshot().workspaces, groups: ahead.store.snapshot().groups, items: ahead.store.snapshot().items, settings: ahead.store.snapshot().settings, completions: [], serverNow: ahead.clock.v - 20 * 60000 });
  assert.equal(/** @type {any} */ (ahead.store.queueTick('it-word-game')).completion.periodKey, '2026-10-11', 'by the server\'s clock it is still the 11th');
});

test('queueTick: an existing completion is returned without a new op; unknown, unscheduled and not-started items answer like the local tick', () => {
  const { store } = open(tmp());
  ok(store.tick('it-word-game'));
  const again = /** @type {any} */ (store.queueTick('it-word-game'));
  assert.deepEqual([again.ok, again.created, again.pending], [true, false, false]);
  assert.deepEqual(store.tickOutbox(), []);
  assert.deepEqual(store.queueTick('nope'), { error: 'not-found' });
  assert.deepEqual(store.queueTick('it-tasks'), { error: 'not-scheduled' });
  ok(store.upsert({ items: [{ id: 'it-every-3-days', schedule: { type: 'everyNDays', n: 3, startDate: '2027-01-01' } }] }));
  assert.deepEqual(store.queueTick('it-every-3-days'), { error: 'not-started' });
});

test('queueUntick: the completion disappears at once; the removal is queued; a waiting tick is cancelled instead; nothing to remove does nothing', () => {
  const { store } = open(tmp());
  // a completion that came from the server
  store.snapshot().completions.push({ itemId: 'it-word-game', periodKey: '2026-10-12', doneAt: T0 - 1000 });
  const r = /** @type {any} */ (store.queueUntick('it-word-game'));
  assert.deepEqual([r.ok, r.removed, r.pending], [true, 1, true]);
  assert.deepEqual(store.snapshot().completions, []);
  assert.deepEqual(store.tickOutbox(), [{ op: 'untick', itemId: 'it-word-game', periodKey: '2026-10-12' }]);
  // ticking again cancels the waiting untick, no tick op is added
  ok(store.queueTick('it-word-game'));
  assert.deepEqual(store.tickOutbox(), []);
  assert.equal(store.snapshot().completions.length, 1);
  // tick then untick of the same period: nothing left
  ok(store.queueUntick('it-word-game'));
  ok(store.queueTick('it-language'));
  ok(store.queueUntick('it-language'));
  assert.deepEqual(store.tickOutbox().map((o) => `${o.op}:${o.itemId}`), ['untick:it-word-game']);
  assert.deepEqual(store.queueUntick('it-coding'), { ok: true, removed: 0 });
  assert.deepEqual(store.queueUntick('nope'), { error: 'not-found' });
});

test('the tick queue is capped at 500 ops; a tick beyond that is refused and changes nothing', () => {
  const dir = tmp();
  const { store } = open(dir);
  const ops = Array.from({ length: 500 }, (_, i) => ({ op: /** @type {const} */ ('tick'), itemId: `x${i}`, periodKey: '2026-10-12', doneAt: T0 }));
  store.setTickOutbox(ops);
  assert.deepEqual(store.queueTick('it-word-game'), { error: 'ticks-need-connection' });
  assert.equal(store.tickOutbox().length, 500);
  assert.deepEqual(store.snapshot().completions, []);
});

test('the tick queue, notices and offset survive a restart; an old or damaged cache loads empty', () => {
  const dir = tmp();
  const a = open(dir);
  ok(a.store.queueTick('it-word-game'));
  a.store.addTickNotice({ itemId: 'it-language', name: 'Language', periodKey: '2026-10-10', reason: 'tick-too-old', at: T0 });
  const b = open(dir);
  assert.equal(b.store.tickOutbox().length, 1);
  assert.equal(b.store.tickNotices().length, 1);
  const cacheFile = path.join(dir, 'cache.json');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  for (const key of ['tickOutbox', 'tickNotices', 'serverClockOffset']) delete cache[key];
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  const old = open(dir);
  assert.deepEqual([old.store.tickOutbox(), old.store.tickNotices(), old.store.serverClockOffset()], [[], [], 0]);
  const junk = { ...cache, tickOutbox: [1, null, { op: 'tick' }, { op: 'tick', itemId: 'a', periodKey: 'soon', doneAt: 1 }, { op: 'tick', itemId: 'a', periodKey: '2026-10-12', doneAt: 'x' }, { op: 'wat', itemId: 'a', periodKey: '2026-10-12' },
    { op: 'tick', itemId: 'a', periodKey: '2026-10-12', doneAt: 5 }, { op: 'untick', itemId: 'a', periodKey: '2026-10-12' }, { op: 'untick', itemId: 'b', periodKey: '2026-10-12', extra: 1 }],
    tickNotices: [null, { id: 1 }, { id: 'n1', itemId: 'a', name: 'A', periodKey: '2026-10-12', reason: 'x', at: 1 }], serverClockOffset: 'big' };
  fs.writeFileSync(cacheFile, JSON.stringify(junk));
  const s = open(dir).store;
  assert.deepEqual(s.tickOutbox(), [{ op: 'tick', itemId: 'a', periodKey: '2026-10-12', doneAt: 5 }, { op: 'untick', itemId: 'b', periodKey: '2026-10-12' }], 'one op per item and period, malformed ones dropped');
  assert.deepEqual(s.tickNotices().map((n) => n.id), ['n1']);
  assert.equal(s.serverClockOffset(), 0);
  fs.writeFileSync(cacheFile, JSON.stringify({ ...cache, tickOutbox: 'x', tickNotices: 5 }));
  assert.deepEqual(open(dir).store.tickOutbox(), []);
});

test('applyRemote keeps a waiting tick that the server lacks and a waiting untick hides the server\'s completion', () => {
  const { store } = open(tmp());
  const s = store.snapshot();
  const remote = (/** @type {any[]} */ completions) => ({ workspaces: s.workspaces, groups: s.groups, items: s.items, settings: s.settings, completions, serverNow: T0 });
  ok(store.queueTick('it-word-game'));
  store.snapshot().completions.push({ itemId: 'it-language', periodKey: '2026-10-12', doneAt: 1 });
  ok(store.queueUntick('it-language'));
  assert.equal(store.applyRemote(remote([{ itemId: 'it-language', periodKey: '2026-10-12', doneAt: 1 }, { itemId: 'it-coding', periodKey: '2026-10-12', doneAt: 2 }])).ok, true);
  assert.deepEqual(store.snapshot().completions.map((c) => c.itemId).sort(), ['it-coding', 'it-word-game']);
  // once the queue is empty the server's history is the truth
  store.setTickOutbox([]);
  store.applyRemote(remote([{ itemId: 'it-coding', periodKey: '2026-10-12', doneAt: 2 }]));
  assert.deepEqual(store.snapshot().completions.map((c) => c.itemId), ['it-coding']);
});

test('applyRemote learns the server clock offset, ignores small jitter, and writes only when something changed', () => {
  const dir = tmp();
  const { store } = open(dir);
  const s = store.snapshot();
  const state = (/** @type {number} */ serverNow) => ({ workspaces: s.workspaces, groups: s.groups, items: s.items, settings: s.settings, completions: [], serverNow });
  store.applyRemote(state(T0 + 5 * 60000));
  assert.equal(store.serverClockOffset(), 5 * 60000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'cache.json'), 'utf8')).serverClockOffset, 5 * 60000, 'persisted even though the data did not change');
  fs.utimesSync(path.join(dir, 'cache.json'), new Date(1_000_000), new Date(1_000_000));
  store.applyRemote(state(T0 + 5 * 60000 + 1500)); // jitter of 1.5 s
  assert.equal(store.serverClockOffset(), 5 * 60000);
  assert.equal(fs.statSync(path.join(dir, 'cache.json')).mtimeMs, 1_000_000, 'no write for jitter');
  store.applyRemote(/** @type {any} */ ({ ...state(T0), serverNow: undefined }));
  assert.equal(store.serverClockOffset(), 5 * 60000, 'no serverNow: the offset is kept');
});

test('tick notices: added, capped at 20 (oldest out), dismissed by id, cleared', () => {
  const { store } = open(tmp());
  for (let i = 0; i < 25; i++) store.addTickNotice({ itemId: `i${i}`, name: `Item ${i}`, periodKey: '2026-10-10', reason: 'tick-too-old', at: T0 + i });
  assert.equal(store.tickNotices().length, 20);
  assert.equal(store.tickNotices()[0].itemId, 'i5');
  const id = store.tickNotices()[3].id;
  assert.equal(store.dismissTickNotice(id), true);
  assert.equal(store.dismissTickNotice(id), false);
  assert.equal(store.tickNotices().length, 19);
  store.clearTickNotices();
  assert.deepEqual(store.tickNotices(), []);
});

test('local-only mode is unchanged: tick and untick still work without any queue', () => {
  const { store } = open(tmp());
  ok(store.tick('it-word-game'));
  ok(store.untick('it-word-game'));
  assert.deepEqual(store.tickOutbox(), []);
});