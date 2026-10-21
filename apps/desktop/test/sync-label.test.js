// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncLabel, createSyncingGate, tickNotice, describeRejected, describeDroppedTick, TICKS_HELD_TEXT, SYNCING_SHOW_AFTER_MS } from '../lib/sync-label.js';

const fmt = (/** @type {number} */ ms) => `t${ms}`;
const label = (/** @type {any} */ sync) => syncLabel(sync, fmt);

test('synced: "Synced <time>", or just "Synced" before the first sync', () => {
  const l = label({ status: 'synced', lastSyncAt: 1234 });
  assert.deepEqual([l.kind, l.icon, l.tone, l.tooltip, l.badge, l.attention], ['synced', '✓', 'ok', 'Synced t1234', 0, false]);
  assert.equal(label({ status: 'synced', lastSyncAt: null }).tooltip, 'Synced');
});

test('every other status has its own icon, tone and wording', () => {
  assert.deepEqual([label({ status: 'syncing' }).kind, label({ status: 'syncing' }).tooltip], ['syncing', 'Syncing…']);
  assert.equal(label({ status: 'offline' }).tooltip, 'Offline — edits and ticks are kept and sent later');
  assert.equal(label({ status: 'offline' }).tone, 'warn');
  assert.equal(label({ status: 'not-connected' }).tooltip, 'Not connected — enter the access key in Settings → Sync');
  assert.equal(label({ status: 'not-connected' }).tone, 'idle');
  assert.equal(label({ status: 'error:service-token-not-allowed' }).tooltip, 'Sync error: service-token-not-allowed');
  assert.equal(label({ status: 'error:service-token-not-allowed' }).kind, 'error');
  assert.equal(label({ status: 'error:http-400' }).tone, 'bad');
  assert.equal(label({ status: 'expired' }).tooltip, 'Access key expired — create a new one (see Settings → Sync)');
  assert.equal(label({ status: 'expired' }).tone, 'bad');
  const icons = new Set(['synced', 'syncing', 'offline', 'not-connected', 'error:x', 'expiring:3', 'expired'].map((s) => label({ status: s }).kind));
  assert.equal(icons.size, 7, 'seven distinct kinds');
});

test('expiring: today, 1 day, many days, and the 14 day edge', () => {
  assert.equal(label({ status: 'expiring:0' }).tooltip, 'Access key expires today');
  assert.equal(label({ status: 'expiring:1' }).tooltip, 'Access key expires in 1 day');
  assert.equal(label({ status: 'expiring:2' }).tooltip, 'Access key expires in 2 days');
  assert.equal(label({ status: 'expiring:14' }).tooltip, 'Access key expires in 14 days');
  assert.equal(label({ status: 'expiring:14' }).kind, 'expiring');
  assert.equal(label({ status: 'expiring:0' }).tone, 'warn');
});

test('missing or unknown status reads as not connected', () => {
  assert.equal(syncLabel(null, fmt).kind, 'not-connected');
  assert.equal(syncLabel(undefined, fmt).kind, 'not-connected');
  assert.equal(label({ status: 'idle' }).kind, 'not-connected');
});

test('the badge counts waiting changes unless synced; rejected changes count and warn even when synced', () => {
  assert.equal(label({ status: 'offline', pending: 3 }).badge, 3);
  assert.match(label({ status: 'offline', pending: 3 }).tooltip, /3 changes waiting to be sent/);
  assert.match(label({ status: 'offline', pending: 1 }).tooltip, /1 change waiting to be sent/);
  assert.equal(label({ status: 'synced', pending: 2, lastSyncAt: 1 }).badge, 0, 'synced hides the count');
  const rejected = [{ kind: 'items', id: 'a', name: 'A', errors: [{ field: 'url', code: 'invalid-url' }] }];
  const l = label({ status: 'synced', pending: 1, lastSyncAt: 1, rejected });
  assert.equal(l.attention, true);
  assert.equal(l.badge, 1);
  assert.equal(l.tone, 'warn');
  assert.match(l.tooltip, /1 change needs attention/);
  assert.match(label({ status: 'synced', lastSyncAt: 1, rejected: [...rejected, ...rejected] }).tooltip, /2 changes need attention/);
});

test('the syncing gate hides a flight shorter than 500 ms and shows a longer one', () => {
  const g = createSyncingGate();
  assert.equal(g.apply('synced', 0), 'synced');
  assert.equal(g.apply('syncing', 1000), 'synced', 'a flight just started keeps the settled status');
  assert.equal(g.wait(1000), SYNCING_SHOW_AFTER_MS);
  assert.equal(g.apply('syncing', 1300), 'synced');
  assert.equal(g.wait(1300), 200);
  assert.equal(g.apply('syncing', 1500), 'syncing', 'after 500 ms it shows');
  assert.equal(g.wait(1500), null);
  assert.equal(g.apply('synced', 1600), 'synced');
  assert.equal(g.apply('syncing', 5000), 'synced', 'the next flight starts its own count');
});

test('the syncing gate shows the very first flight at once, and a short flight that ends is never shown', () => {
  const g = createSyncingGate();
  assert.equal(g.apply('syncing', 0), 'syncing', 'nothing settled yet');
  assert.equal(g.apply('offline', 100), 'offline');
  assert.equal(g.apply('syncing', 200), 'offline');
  assert.equal(g.apply('offline', 300), 'offline');
  assert.equal(g.wait(300), null);
});

test('the tick notice: none when ticking works, three wordings otherwise', () => {
  assert.equal(tickNotice({ status: 'synced' }, true), null);
  assert.equal(tickNotice({ status: 'synced' }, undefined), null);
  assert.equal(tickNotice({ status: 'offline', configured: true, connected: true }, false), 'Ticking needs a connection');
  assert.equal(tickNotice({ status: 'error:email-mismatch', configured: true, connected: true }, false), 'Ticking needs a connection');
  assert.equal(tickNotice({ status: 'not-connected', configured: true, connected: false }, false), 'Ticking needs the access key');
  assert.equal(tickNotice({ status: 'expired', configured: true, connected: true }, false), 'Ticking needs a new access key');
  assert.equal(tickNotice(null, false), 'Ticking needs a connection');
});

test('describeRejected: names the entity and says each problem in words', () => {
  const d = describeRejected({ kind: 'items', name: 'My site', errors: [{ field: 'url', code: 'invalid-url' }, { field: 'groupId', code: 'group-not-found' }] });
  assert.equal(d.title, 'Item: My site');
  assert.deepEqual(d.reasons, ['Address is not a valid web address', 'Group refers to a group that no longer exists']);
  assert.equal(describeRejected({ kind: 'settings', name: 'Settings', errors: [{ field: 'timezone', code: 'invalid-timezone' }] }).reasons[0], 'Timezone is not a known timezone');
  assert.equal(describeRejected({ kind: 'workspaces', name: 'W', errors: [{ field: 'name', code: 'required' }] }).title, 'Workspace: W');
  assert.equal(describeRejected({ kind: 'groups', name: 'G', errors: [] }).title, 'Group: G');
});

test('describeRejected: unknown fields and codes are still shown, never hidden', () => {
  assert.deepEqual(describeRejected({ kind: 'items', name: 'X', errors: [{ field: 'mystery', code: 'odd' }] }).reasons, ['mystery was refused (odd)']);
  assert.deepEqual(describeRejected({ kind: 'items', name: 'X', errors: [] }).reasons, ['was refused by the server']);
});

test('dropped ticks and a held queue need attention: badge, tone, tooltip and the chip target', () => {
  const dropped = [{ id: 'a', itemId: 'x', name: 'X', periodKey: '2026-10-10', reason: 'tick-too-old', at: 1 }];
  const l = label({ status: 'synced', lastSyncAt: 1, droppedTicks: dropped });
  assert.deepEqual([l.attention, l.badge, l.tone], [true, 1, 'warn']);
  assert.match(l.tooltip, /1 change needs attention/);
  const held = label({ status: 'synced', lastSyncAt: 1, ticksHeld: true, pending: 2 });
  assert.deepEqual([held.attention, held.badge, held.tone], [true, 1, 'warn']);
  assert.match(held.tooltip, /queued ticks wait for a Worker update/);
  const all = label({ status: 'synced', lastSyncAt: 1, ticksHeld: true, droppedTicks: dropped, rejected: [{ kind: 'items', id: 'a', name: 'A', errors: [] }] });
  assert.equal(all.badge, 3, 'rejected + dropped + the held notice');
  assert.equal(label({ status: 'synced', lastSyncAt: 1, ticksHeld: false, droppedTicks: [] }).attention, false);
});

test('waiting ticks count in the offline badge like other waiting changes', () => {
  const l = label({ status: 'offline', pending: 3 });
  assert.equal(l.badge, 3);
  assert.match(l.tooltip, /^Offline — edits and ticks are kept and sent later · 3 changes waiting to be sent$/);
});

test('the held-queue notice has its fixed wording', () => {
  assert.equal(TICKS_HELD_TEXT, 'Queued ticks wait for a Worker update (npm run deploy:web)');
});

test('describeDroppedTick: each reason in words, unknown reasons still shown', () => {
  const n = (reason) => ({ name: 'My site', periodKey: '2026-10-10', reason });
  assert.deepEqual(describeDroppedTick(n('tick-too-old')), { title: 'Tick dropped: My site', reason: 'The tick for 2026-10-10 waited more than 48 hours and was too old to send.' });
  assert.match(describeDroppedTick(n('tick-in-future')).reason, /ahead of the Worker's clock/);
  assert.match(describeDroppedTick(n('period-not-allowed')).reason, /more than one period back/);
  assert.match(describeDroppedTick(n('refused')).reason, /refused the tick for 2026-10-10/);
});

test('the tick notice appears only when ticking is impossible: no key or an expired key', () => {
  assert.equal(tickNotice({ status: 'offline', configured: true, connected: true }, true), null, 'offline ticks are queued');
  assert.equal(tickNotice({ status: 'not-connected', configured: true, connected: false }, false), 'Ticking needs the access key');
  assert.equal(tickNotice({ status: 'expired', configured: true, connected: true }, false), 'Ticking needs a new access key');
});