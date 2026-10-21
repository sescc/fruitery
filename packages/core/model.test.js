// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateItem, effectiveSleep, effectiveEdge, moveItem, userAgentOf, validateWorkspace, ungroupedLabelOf } from './model.js';
import { bucket } from './schedule.js';
import { makeItem, makeWorkspace, makeGroup, tokyo } from './fixtures.js';

/** @param {import('./model.js').ValidationError[]} errors */
const fields = (errors) => errors.map((e) => e.field);
/** @param {import('./model.js').ValidationError[]} errors @param {string} field */
const codeOf = (errors, field) => errors.find((e) => e.field === field)?.code;

// ---- Requirement: Item validation ------------------------------------------------------------

test('Valid web check-in: "Daily rewards" with a daily schedule has no errors', () => {
  assert.deepEqual(validateItem(makeItem({ name: 'Daily rewards', url: 'https://rewards.example.com', schedule: { type: 'daily' } })), []);
});

test('Several problems reported at once: empty name, ftp URL and reset time 25:00', () => {
  const errors = validateItem(makeItem({ name: '', url: 'ftp://x', resetTime: '25:00' }));
  assert.deepEqual(fields(errors).sort(), ['name', 'resetTime', 'url']);
  assert.equal(codeOf(errors, 'name'), 'required');
  assert.equal(codeOf(errors, 'url'), 'invalid-url');
  assert.equal(codeOf(errors, 'resetTime'), 'invalid-time');
});

test('Group from another workspace: a groupId error is reported', () => {
  const productivityGroup = makeGroup({ id: 'g-p', workspaceId: 'ws-productivity' });
  const item = makeItem({ workspaceId: 'ws-daily', groupId: 'g-p' });
  assert.deepEqual(validateItem(item, { groups: [productivityGroup] }), [{ field: 'groupId', code: 'group-workspace-mismatch' }]);
});

test('A group of the same workspace is accepted; no group checks without a groups list', () => {
  const item = makeItem({ groupId: 'g-1' });
  assert.deepEqual(validateItem(item, { groups: [makeGroup({ id: 'g-1', workspaceId: 'ws-daily' })] }), []);
  assert.deepEqual(validateItem(item), []);
});

test('A groupId that matches no supplied group is reported as group-not-found', () => {
  assert.deepEqual(validateItem(makeItem({ groupId: 'g-missing' }), { groups: [makeGroup()] }), [{ field: 'groupId', code: 'group-not-found' }]);
});

test('An empty or whitespace-only name is rejected', () => {
  assert.equal(codeOf(validateItem(makeItem({ name: '' })), 'name'), 'required');
  assert.equal(codeOf(validateItem(makeItem({ name: '   ' })), 'name'), 'required');
});

test('A web item lacking an http(s) URL is rejected; http and https are accepted', () => {
  assert.equal(codeOf(validateItem(makeItem({ url: null })), 'url'), 'required');
  assert.equal(codeOf(validateItem(makeItem({ url: '' })), 'url'), 'required');
  assert.equal(codeOf(validateItem(makeItem({ url: 'ftp://x' })), 'url'), 'invalid-url');
  assert.equal(codeOf(validateItem(makeItem({ url: 'javascript:alert(1)' })), 'url'), 'invalid-url');
  assert.equal(codeOf(validateItem(makeItem({ url: 'https://' })), 'url'), 'invalid-url');
  assert.equal(codeOf(validateItem(makeItem({ url: 'rewards.example.com' })), 'url'), 'invalid-url');
  assert.deepEqual(validateItem(makeItem({ url: 'http://localhost:8787/x?y=1#z' })), []);
  assert.deepEqual(validateItem(makeItem({ url: 'HTTPS://Example.com' })), []);
});

test('An app item lacks an application path -> appPath required; with a path it is valid without a URL', () => {
  const app = { kind: 'app', url: null };
  assert.equal(codeOf(validateItem(makeItem({ ...app, appPath: null })), 'appPath'), 'required');
  assert.equal(codeOf(validateItem(makeItem({ ...app, appPath: '  ' })), 'appPath'), 'required');
  assert.deepEqual(validateItem(makeItem({ ...app, appPath: 'C:\\Apps\\Tool.exe', fallbackUrl: 'https://example.com/web' })), []);
  assert.equal(codeOf(validateItem(makeItem({ ...app, appPath: 'C:\\x.exe', url: 'ftp://nope' })), 'url'), 'invalid-url');
});

test('The fallback URL must be http(s) when present', () => {
  assert.equal(codeOf(validateItem(makeItem({ fallbackUrl: 'file:///etc/passwd' })), 'fallbackUrl'), 'invalid-url');
  assert.deepEqual(validateItem(makeItem({ fallbackUrl: 'https://example.com/web' })), []);
  assert.deepEqual(validateItem(makeItem({ fallbackUrl: null })), []);
});

test('The reset time must be a valid HH:MM', () => {
  for (const bad of ['25:00', '12:60', '4:00', '', 'noon', null]) {
    assert.equal(codeOf(validateItem(makeItem({ resetTime: bad })), 'resetTime'), 'invalid-time', String(bad));
  }
  assert.deepEqual(validateItem(makeItem({ resetTime: '23:59' })), []);
});

test('Schedule fields out of range are rejected', () => {
  const run = (/** @type {unknown} */ schedule) => validateItem(makeItem({ schedule }));
  assert.deepEqual(run({ type: 'weekly', weekday: 0 }), [{ field: 'schedule.weekday', code: 'out-of-range' }]);
  assert.deepEqual(run({ type: 'weekly', weekday: 8 }), [{ field: 'schedule.weekday', code: 'out-of-range' }]);
  assert.deepEqual(run({ type: 'weekly', weekday: 1.5 }), [{ field: 'schedule.weekday', code: 'out-of-range' }]);
  assert.deepEqual(run({ type: 'monthly', day: 0 }), [{ field: 'schedule.day', code: 'out-of-range' }]);
  assert.deepEqual(run({ type: 'monthly', day: 32 }), [{ field: 'schedule.day', code: 'out-of-range' }]);
  assert.deepEqual(run({ type: 'everyNDays', n: 0, startDate: '2026-10-01' }), [{ field: 'schedule.n', code: 'out-of-range' }]);
  assert.deepEqual(run({ type: 'everyNDays', n: 2.5, startDate: '2026-10-01' }), [{ field: 'schedule.n', code: 'out-of-range' }]);
  assert.deepEqual(run({ type: 'everyNDays', n: 3, startDate: '2026-02-30' }), [{ field: 'schedule.startDate', code: 'invalid-date' }]);
  assert.deepEqual(run({ type: 'everyNDays', n: 3, startDate: 'tomorrow' }), [{ field: 'schedule.startDate', code: 'invalid-date' }]);
  assert.deepEqual(run({ type: 'hourly' }), [{ field: 'schedule.type', code: 'invalid-value' }]);
  for (const ok of [{ type: 'daily' }, { type: 'weekly', weekday: 7 }, { type: 'monthly', day: 31 }, { type: 'everyNDays', n: 1, startDate: '2028-02-29' }, null]) {
    assert.deepEqual(run(ok), [], JSON.stringify(ok));
  }
});

test('Sleep minutes that are negative or not whole are rejected; 0 and null are valid', () => {
  assert.equal(codeOf(validateItem(makeItem({ sleepAfterMin: -1 })), 'sleepAfterMin'), 'out-of-range');
  assert.equal(codeOf(validateItem(makeItem({ sleepAfterMin: 2.5 })), 'sleepAfterMin'), 'out-of-range');
  assert.equal(codeOf(validateItem(makeItem({ sleepAfterMin: '10' })), 'sleepAfterMin'), 'out-of-range');
  assert.deepEqual(validateItem(makeItem({ sleepAfterMin: 0 })), []);
  assert.deepEqual(validateItem(makeItem({ sleepAfterMin: 15 })), []);
  assert.deepEqual(validateItem(makeItem({ sleepAfterMin: null })), []);
});

test('Device visibility must be all, desktop or phone', () => {
  assert.equal(codeOf(validateItem(makeItem({ devices: 'tablet' })), 'devices'), 'invalid-value');
  for (const ok of ['all', 'desktop', 'phone']) assert.deepEqual(validateItem(makeItem({ devices: ok })), []);
});

test('Edge mode must be inherit, never or always', () => {
  assert.equal(codeOf(validateItem(makeItem({ edge: { mode: 'sometimes', profile: null } })), 'edge.mode'), 'invalid-value');
  assert.equal(codeOf(validateItem(makeItem({ edge: undefined })), 'edge.mode'), 'invalid-value');
  for (const mode of ['inherit', 'never', 'always']) assert.deepEqual(validateItem(makeItem({ edge: { mode, profile: null } })), []);
  assert.equal(codeOf(validateItem(makeItem({ edge: { mode: 'always', profile: 7 } })), 'edge.profile'), 'invalid-value');
});

test('The kind must be web or app', () => {
  assert.equal(codeOf(validateItem(makeItem({ kind: 'cli' })), 'kind'), 'invalid-value');
});

test('A URL using an unknown placeholder is rejected (url and fallbackUrl); known placeholders pass', () => {
  assert.deepEqual(validateItem(makeItem({ url: 'https://x.test/{foo}' })), [{ field: 'url', code: 'unknown-token' }]);
  assert.deepEqual(validateItem(makeItem({ fallbackUrl: 'https://x.test/{DDD}' })), [{ field: 'fallbackUrl', code: 'unknown-token' }]);
  assert.deepEqual(validateItem(makeItem({ url: 'https://x.test/{YYYY}{MM}{DD}?u={googleEmail}' })), []);
});

test('Many errors are reported together, in one list', () => {
  const errors = validateItem(
    makeItem({ name: '', url: 'ftp://x/{nope}', fallbackUrl: 'gopher://y', resetTime: '99:99', devices: 'x', sleepAfterMin: -5, schedule: { type: 'weekly', weekday: 9 }, edge: { mode: 'x', profile: null } }),
  );
  assert.deepEqual(
    fields(errors).sort(),
    ['devices', 'edge.mode', 'fallbackUrl', 'name', 'resetTime', 'schedule.weekday', 'sleepAfterMin', 'url', 'url'].sort(),
  );
});

test('validateItem handles a non-object without throwing and does not mutate its input', () => {
  assert.deepEqual(validateItem(null), [{ field: 'item', code: 'required' }]);
  const item = makeItem({ name: '' });
  const copy = structuredClone(item);
  validateItem(item, { groups: [makeGroup()] });
  assert.deepEqual(item, copy);
});

// ---- Requirement: Sleep and Edge defaults resolve per item ------------------------------------

test('Inherited sleep: an item without its own sleep setting in a 10-minute workspace sleeps after 10', () => {
  assert.equal(effectiveSleep(makeItem({ sleepAfterMin: null }), makeWorkspace({ sleepAfterMin: 10 })), 10);
});

test('Never sleep in Productivity: workspace sleep 0 means never', () => {
  assert.equal(effectiveSleep(makeItem({ sleepAfterMin: null }), makeWorkspace({ sleepAfterMin: 0 })), 0);
});

test('An item with its own sleep setting overrides the workspace, including 0 = never', () => {
  assert.equal(effectiveSleep(makeItem({ sleepAfterMin: 3 }), makeWorkspace({ sleepAfterMin: 10 })), 3);
  assert.equal(effectiveSleep(makeItem({ sleepAfterMin: 0 }), makeWorkspace({ sleepAfterMin: 10 })), 0);
});

test('Edge profile fallback: mode always with no profile uses the device default "Profile 1"', () => {
  assert.deepEqual(effectiveEdge(makeItem({ edge: { mode: 'always', profile: null } }), makeWorkspace(), 'Profile 1'), { open: true, profile: 'Profile 1' });
});

test('Edge mode x item profile x device default matrix', () => {
  /** @type {Array<['inherit' | 'never' | 'always', boolean, string | null, string | null, boolean, string | null]>} */
  const cases = [
    // mode, workspace.openInEdge, item profile, device default, -> open, profile
    ['never', false, null, null, false, null],
    ['never', true, 'P2', 'P1', false, null],
    ['inherit', false, null, null, false, null],
    ['inherit', false, 'P2', 'P1', false, null],
    ['inherit', true, null, null, true, null],
    ['inherit', true, null, 'P1', true, 'P1'],
    ['inherit', true, 'P2', 'P1', true, 'P2'],
    ['inherit', true, 'P2', null, true, 'P2'],
    ['always', false, null, null, true, null],
    ['always', false, null, 'P1', true, 'P1'],
    ['always', false, 'P2', 'P1', true, 'P2'],
    ['always', true, 'P2', null, true, 'P2'],
    ['always', true, '', 'P1', true, 'P1'],
    ['always', true, null, '', true, null],
  ];
  for (const [mode, openInEdge, profile, device, open, expectedProfile] of cases) {
    assert.deepEqual(
      effectiveEdge(makeItem({ edge: { mode, profile } }), makeWorkspace({ openInEdge }), device),
      { open, profile: expectedProfile },
      `${mode} ws=${openInEdge} item=${profile} device=${device}`,
    );
  }
  assert.deepEqual(effectiveEdge(makeItem({ edge: { mode: 'always', profile: null } }), makeWorkspace(), undefined), { open: true, profile: null });
});

// ---- Requirement: Moving an item to another workspace ------------------------------------------

test('Move keeps history: id unchanged, ticks still apply, group cleared', () => {
  const item = makeItem({ id: 'it-gcal', workspaceId: 'ws-productivity', groupId: 'g-x', updatedAt: 5 });
  const moved = moveItem(item, 'ws-daily', 1000);
  assert.equal(moved.id, 'it-gcal');
  assert.equal(moved.workspaceId, 'ws-daily');
  assert.equal(moved.groupId, null);
  assert.equal(moved.updatedAt, 1000);
  // ticks are keyed by item id, so they still apply to the moved item
  const completions = [{ itemId: 'it-gcal', periodKey: '2026-10-12', doneAt: tokyo('2026-10-12T09:00') }];
  assert.equal(bucket(moved, completions, tokyo('2026-10-12T15:00'), 'Asia/Tokyo'), 'done');
});

test('moveItem does not mutate the input and keeps every other field', () => {
  const item = makeItem({ workspaceId: 'ws-productivity', groupId: 'g-x', edge: { mode: 'always', profile: 'P' } });
  const copy = structuredClone(item);
  const moved = moveItem(item, 'ws-daily', 99);
  assert.deepEqual(item, copy);
  assert.deepEqual({ ...moved, workspaceId: item.workspaceId, groupId: item.groupId, updatedAt: item.updatedAt }, item);
  assert.notEqual(moved.edge, item.edge);
});

test('Moving to the current workspace keeps the group and does not bump updatedAt', () => {
  const item = makeItem({ workspaceId: 'ws-daily', groupId: 'g-1', updatedAt: 5 });
  const moved = moveItem(item, 'ws-daily', 1000);
  assert.deepEqual(moved, item);
  assert.notEqual(moved, item);
});

// ---- Requirement: User agent preset ------------------------------------------------------------

test('Missing preset: an item without userAgent has no error and is treated as default', () => {
  const item = makeItem();
  assert.equal('userAgent' in item, false);
  assert.deepEqual(validateItem(item), []);
  assert.deepEqual(userAgentOf(item), { preset: 'default', custom: null });
  assert.deepEqual(validateItem(makeItem({ userAgent: null })), []);
  assert.deepEqual(userAgentOf(makeItem({ userAgent: null })), { preset: 'default', custom: null });
});

test('Custom without a string: an empty, blank or missing custom string is a userAgent.custom error', () => {
  for (const custom of ['', '   ', null, undefined]) {
    const errors = validateItem(makeItem({ userAgent: { preset: 'custom', custom } }));
    assert.deepEqual(errors, [{ field: 'userAgent.custom', code: 'required' }], String(custom));
  }
});

test('Custom UA: up to 512 characters is accepted, 513 is out of range', () => {
  assert.deepEqual(validateItem(makeItem({ userAgent: { preset: 'custom', custom: 'x'.repeat(512) } })), []);
  assert.deepEqual(validateItem(makeItem({ userAgent: { preset: 'custom', custom: 'x'.repeat(513) } })), [{ field: 'userAgent.custom', code: 'out-of-range' }]);
});

test('Preset enum: default, chrome, firefox and custom are accepted; anything else is an invalid-value', () => {
  for (const preset of ['default', 'chrome', 'firefox']) assert.deepEqual(validateItem(makeItem({ userAgent: { preset, custom: null } })), [], preset);
  assert.deepEqual(validateItem(makeItem({ userAgent: { preset: 'custom', custom: 'Mozilla/5.0 test' } })), []);
  for (const bad of [{ preset: 'safari', custom: null }, { preset: '', custom: null }, { custom: 'x' }, { preset: 5, custom: null }, 'chrome', ['chrome']]) {
    assert.deepEqual(validateItem(makeItem({ userAgent: /** @type {any} */ (bad) })), [{ field: 'userAgent.preset', code: 'invalid-value' }], JSON.stringify(bad));
  }
});

test('A non-custom preset ignores a stray custom string', () => {
  assert.deepEqual(validateItem(makeItem({ userAgent: { preset: 'chrome', custom: 'x'.repeat(2000) } })), []);
});

test('userAgentOf returns the preset (as a copy) and falls back to default for unusable values', () => {
  const ua = { preset: /** @type {const} */ ('custom'), custom: 'MyAgent/1.0' };
  const out = userAgentOf(makeItem({ userAgent: ua }));
  assert.deepEqual(out, ua);
  assert.notEqual(out, ua);
  assert.deepEqual(userAgentOf(makeItem({ userAgent: { preset: 'firefox', custom: null } })), { preset: 'firefox', custom: null });
  assert.deepEqual(userAgentOf(makeItem({ userAgent: { preset: 'chrome' } })), { preset: 'chrome', custom: null });
  assert.deepEqual(userAgentOf(makeItem({ userAgent: /** @type {any} */ ({ preset: 'safari', custom: null }) })), { preset: 'default', custom: null });
});

test('moveItem keeps the user agent and does not share its object', () => {
  const item = makeItem({ userAgent: { preset: 'custom', custom: 'A/1' } });
  const moved = moveItem(item, 'ws-other', 5);
  assert.deepEqual(moved.userAgent, { preset: 'custom', custom: 'A/1' });
  assert.notEqual(moved.userAgent, item.userAgent);
  assert.equal('userAgent' in moveItem(makeItem(), 'ws-other', 5), false);
});

// ---- Requirement: Workspace validation and the ungrouped label -------------------------------------

test('Workspace: a valid workspace has no errors; the label is optional', () => {
  const ws = makeWorkspace();
  assert.deepEqual(validateWorkspace(ws), []);
  assert.deepEqual(validateWorkspace({ ...ws, ungroupedLabel: null }), []);
  assert.deepEqual(validateWorkspace({ ...ws, ungroupedLabel: 'Misc' }), []);
  assert.deepEqual(validateWorkspace({ ...ws, ungroupedLabel: 'x'.repeat(40) }), []);
});

test('Workspace: a blank or missing name is required', () => {
  for (const name of ['', '   ', undefined, 5]) {
    assert.deepEqual(validateWorkspace(makeWorkspace({ name: /** @type {any} */ (name) })), [{ field: 'name', code: 'required' }], String(name));
  }
  assert.deepEqual(validateWorkspace(null), [{ field: 'workspace', code: 'required' }]);
});

test('Workspace: the ungrouped label must be non-blank text of at most 40 characters when set', () => {
  assert.deepEqual(validateWorkspace(makeWorkspace({ ungroupedLabel: '' })), [{ field: 'ungroupedLabel', code: 'required' }]);
  assert.deepEqual(validateWorkspace(makeWorkspace({ ungroupedLabel: '   ' })), [{ field: 'ungroupedLabel', code: 'required' }]);
  assert.deepEqual(validateWorkspace(makeWorkspace({ ungroupedLabel: 'x'.repeat(41) })), [{ field: 'ungroupedLabel', code: 'out-of-range' }]);
  assert.deepEqual(validateWorkspace(makeWorkspace({ ungroupedLabel: /** @type {any} */ (7) })), [{ field: 'ungroupedLabel', code: 'invalid-value' }]);
  // name and label problems are reported together
  assert.deepEqual(fields(validateWorkspace(makeWorkspace({ name: '', ungroupedLabel: ' ' }))).sort(), ['name', 'ungroupedLabel']);
});

test('ungroupedLabelOf: the trimmed label, else "Default"', () => {
  assert.equal(ungroupedLabelOf(makeWorkspace()), 'Default');
  assert.equal(ungroupedLabelOf(makeWorkspace({ ungroupedLabel: null })), 'Default');
  assert.equal(ungroupedLabelOf(makeWorkspace({ ungroupedLabel: '  ' })), 'Default');
  assert.equal(ungroupedLabelOf(makeWorkspace({ ungroupedLabel: ' Misc ' })), 'Misc');
  assert.equal(ungroupedLabelOf(null), 'Default');
  assert.equal(ungroupedLabelOf(undefined), 'Default');
});