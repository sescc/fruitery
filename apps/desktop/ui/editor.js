// @ts-check
// Editors: item (every field, schedule inputs, UA preset, inline validation), workspace, group, and
// the settings / device settings dialog. Validation uses core's validateItem; main re-validates.

import { validateItem, validateWorkspace } from '../../../packages/core/index.js';
import { openForm } from './dialogs.js';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** @param {string} code @param {string} field */
function messageFor(code, field) {
  if (code === 'required') return 'Required';
  if (code === 'invalid-url') return 'Enter an http:// or https:// address';
  if (code === 'unknown-token') return 'Unknown placeholder. Use {YYYY} {MM} {DD} or {googleEmail}';
  if (code === 'invalid-time') return 'Use HH:MM';
  if (code === 'invalid-date') return 'Enter a real date';
  if (code === 'out-of-range') return field === 'userAgent.custom' ? 'At most 512 characters' : field === 'ungroupedLabel' ? 'At most 40 characters' : 'Out of range';
  if (code === 'group-workspace-mismatch') return 'That group belongs to another workspace';
  if (code === 'group-not-found') return 'Unknown group';
  if (code === 'workspace-not-found') return 'Unknown workspace';
  if (code === 'invalid-value') return 'Invalid value';
  return code;
}

/** Map a validation field to the form key that shows it. @param {string} field */
function keyOfField(field) {
  switch (field) {
    case 'edge.mode': return 'edgeMode';
    case 'edge.profile': return 'edgeProfile';
    case 'userAgent.preset': return 'uaPreset';
    case 'userAgent.custom': return 'uaCustom';
    case 'schedule': return 'scheduleType';
    case 'schedule.type': return 'scheduleType';
    case 'schedule.weekday': return 'weekday';
    case 'schedule.day': return 'day';
    case 'schedule.n': return 'n';
    case 'schedule.startDate': return 'startDate';
    default: return field;
  }
}

/** @param {{field: string, code: string}[]} errors @returns {Record<string, string>} */
function errorsToMap(errors) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const e of errors) {
    const key = keyOfField(e.field);
    if (!(key in out)) out[key] = messageFor(e.code, e.field);
  }
  return out;
}

/**
 * Item draft from the form values (a plain item patch).
 * @param {Record<string, any>} v
 */
function itemFromValues(v) {
  /** @type {any} */
  let schedule = null;
  if (v.scheduleType === 'daily') schedule = { type: 'daily' };
  else if (v.scheduleType === 'weekly') schedule = { type: 'weekly', weekday: Number(v.weekday) };
  else if (v.scheduleType === 'monthly') schedule = { type: 'monthly', day: v.day === '' ? NaN : Number(v.day) };
  else if (v.scheduleType === 'everyNDays') schedule = { type: 'everyNDays', n: v.n === '' ? NaN : Number(v.n), startDate: v.startDate };
  const sleep = String(v.sleepAfterMin).trim();
  return {
    name: String(v.name).trim(),
    icon: String(v.icon).trim() || null,
    kind: v.kind,
    url: String(v.url).trim() || null,
    appPath: String(v.appPath).trim() || null,
    fallbackUrl: String(v.fallbackUrl).trim() || null,
    devices: v.devices,
    workspaceId: v.workspaceId,
    groupId: v.groupId || null,
    schedule,
    resetTime: v.resetTime,
    notify: v.notify === true,
    badge: v.badge === true,
    edge: { mode: v.edgeMode, profile: String(v.edgeProfile).trim() || null },
    isolate: v.isolate === true,
    persistSessionCookies: v.persistSessionCookies === true,
    sleepAfterMin: sleep === '' ? null : Number(sleep),
    userAgent: { preset: v.uaPreset, custom: v.uaPreset === 'custom' ? String(v.uaCustom) : null },
  };
}

/**
 * Add (itemId null) or edit an item.
 * @param {any} ctx
 * @param {string | null} itemId
 */
export async function openItemEditor(ctx, itemId) {
  const snap = ctx.snap();
  const existing = itemId ? ctx.itemById(itemId) : null;
  if (itemId && !existing) return false;
  const wsId = existing?.workspaceId ?? ctx.activeWorkspaceId();
  const sched = existing?.schedule ?? null;
  const ua = existing?.userAgent ?? { preset: 'default', custom: null };
  const workspaces = ctx.workspaces();
  /** @param {string} workspaceId */
  const groupOptions = (workspaceId) => [
    { value: '', label: '(no group)' },
    ...snap.groups
      .filter((/** @type {any} */ g) => !g.deleted && g.workspaceId === workspaceId)
      .sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order)
      .map((/** @type {any} */ g) => ({ value: g.id, label: g.name })),
  ];
  const liveGroups = snap.groups.filter((/** @type {any} */ g) => !g.deleted);

  return openForm(ctx, {
    title: existing ? `Edit ${existing.name}` : 'Add item',
    fields: [
      { key: 'name', label: 'Name', value: existing?.name ?? '' },
      {
        key: 'icon',
        label: 'Icon (optional, one emoji or letter)',
        value: existing?.icon ?? '',
        hint: 'Leave blank to use the site’s own icon; “Refresh icon” fetches it again now.',
        action: {
          label: 'Refresh icon',
          disabledReason: existing ? undefined : 'Save the item first',
          run: async () => {
            const r = await ctx.api.refreshIcon(existing?.id);
            if (!r.ok) return 'Could not look for an icon.';
            return r.found ? 'Icon updated.' : 'No icon found for this site.';
          },
        },
      },
      { key: 'kind', label: 'Kind', type: 'select', value: existing?.kind ?? 'web', options: [{ value: 'web', label: 'Web site' }, { value: 'app', label: 'Native program (falls back to an address)' }] },
      { key: 'url', label: 'Address', value: existing?.url ?? '', placeholder: 'https://…', hint: 'Placeholders: {YYYY} {MM} {DD} {googleEmail}', showIf: (v) => v.kind === 'web' },
      { key: 'appPath', label: 'Program', value: existing?.appPath ?? '', browse: true, showIf: (v) => v.kind === 'app' },
      { key: 'fallbackUrl', label: 'Fallback address', value: existing?.fallbackUrl ?? '', placeholder: 'https://…', hint: 'Opens in a pane when the program is missing', showIf: (v) => v.kind === 'app' },
      { key: 'workspaceId', label: 'Workspace', type: 'select', value: wsId, options: workspaces.map((/** @type {any} */ w) => ({ value: w.id, label: w.name })), hint: existing ? 'Moving keeps the history and leaves the group' : undefined },
      { key: 'groupId', label: 'Group', type: 'select', value: existing?.groupId ?? '', options: groupOptions(wsId), optionsFor: (v) => groupOptions(v.workspaceId) },
      { key: 'devices', label: 'Shown on', type: 'select', value: existing?.devices ?? 'all', options: [{ value: 'all', label: 'All devices' }, { value: 'desktop', label: 'Desktop only' }, { value: 'phone', label: 'Phone only' }] },
      {
        key: 'scheduleType',
        label: 'Check-in schedule',
        type: 'select',
        value: sched?.type ?? 'none',
        options: [{ value: 'none', label: 'None (a plain link)' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'everyNDays', label: 'Every N days' }],
      },
      { key: 'weekday', label: 'Weekday', type: 'select', value: String(sched?.weekday ?? 1), options: WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d })), showIf: (v) => v.scheduleType === 'weekly' },
      { key: 'day', label: 'Day of month (1-31, clamped to the month end)', type: 'number', value: sched?.day ?? 1, showIf: (v) => v.scheduleType === 'monthly' },
      { key: 'n', label: 'Every N days', type: 'number', value: sched?.n ?? 3, showIf: (v) => v.scheduleType === 'everyNDays' },
      { key: 'startDate', label: 'Counting from', type: 'date', value: sched?.startDate ?? '', showIf: (v) => v.scheduleType === 'everyNDays' },
      { key: 'resetTime', label: 'Day resets at', type: 'time', value: existing?.resetTime ?? '00:00', showIf: (v) => v.scheduleType !== 'none' },
      { key: 'notify', label: 'Allow notifications', type: 'checkbox', value: existing?.notify ?? false },
      { key: 'badge', label: 'Show the count from the page title ("(3) …")', type: 'checkbox', value: existing?.badge ?? false },
      { key: 'edgeMode', label: 'Open in Microsoft Edge', type: 'select', value: existing?.edge.mode ?? 'inherit', options: [{ value: 'inherit', label: 'Follow the workspace' }, { value: 'never', label: 'Never (show in a pane)' }, { value: 'always', label: 'Always' }] },
      { key: 'edgeProfile', label: 'Edge profile folder (blank = this PC’s default)', value: existing?.edge.profile ?? '', placeholder: 'Profile 2', showIf: (v) => v.edgeMode !== 'never' },
      { key: 'isolate', label: 'Isolated logins (own cookies, not shared)', type: 'checkbox', value: existing?.isolate ?? false },
      { key: 'persistSessionCookies', label: 'Extend short logins', type: 'checkbox', value: existing?.persistSessionCookies ?? true, hint: 'Only affects logins a site would end when the app closes; a site’s own long-lived logins are unaffected.' },
      { key: 'sleepAfterMin', label: 'Unload when unused for (minutes, 0 = never, blank = workspace setting)', type: 'number', value: existing?.sleepAfterMin ?? '' },
      { key: 'uaPreset', label: 'Browser identity', type: 'select', value: ua.preset, options: [{ value: 'default', label: 'App default' }, { value: 'chrome', label: 'Chrome' }, { value: 'firefox', label: 'Firefox' }, { value: 'custom', label: 'Custom' }], hint: 'Takes effect the next time the page loads' },
      { key: 'uaCustom', label: 'Custom user-agent string', value: ua.custom ?? '', showIf: (v) => v.uaPreset === 'custom' },
    ],
    validate: (values) => {
      const draft = { ...itemFromValues(values), id: existing?.id ?? 'new', order: existing?.order ?? 0, updatedAt: 0, deleted: false };
      const errors = errorsToMap(validateItem(/** @type {any} */ (draft), { groups: liveGroups }));
      if (values.kind === 'app' && !errors.appPath && String(values.appPath).trim() === '') errors.appPath = 'Required';
      return errors;
    },
    onSubmit: async (values) => {
      const item = itemFromValues(values);
      if (existing && item.workspaceId !== existing.workspaceId) {
        const moved = await ctx.api.moveItem(existing.id, item.workspaceId);
        if (!('ok' in moved)) return { formError: 'Could not move the item to that workspace.' };
      }
      const res = await ctx.api.upsert({ items: [existing ? { id: existing.id, ...item } : item] });
      if (res.errors) {
        return { errors: errorsToMap(res.errors.map((/** @type {any} */ e) => ({ field: e.field, code: e.code }))) };
      }
      return undefined;
    },
  });
}

/**
 * Add (wsId null) or edit a workspace.
 * @param {any} ctx
 * @param {string | null} wsId
 */
export async function openWorkspaceEditor(ctx, wsId) {
  const existing = wsId ? ctx.workspaces().find((/** @type {any} */ w) => w.id === wsId) : null;
  if (wsId && !existing) return false;
  return openForm(ctx, {
    title: existing ? `Edit ${existing.name}` : 'Add workspace',
    fields: [
      { key: 'name', label: 'Name', value: existing?.name ?? '' },
      { key: 'icon', label: 'Icon (optional, one emoji or letter)', value: existing?.icon ?? '' },
      { key: 'sleepAfterMin', label: 'Unload sites unused for (minutes, 0 = never)', type: 'number', value: existing?.sleepAfterMin ?? 10 },
      { key: 'openInEdge', label: 'Open its items in Microsoft Edge by default', type: 'checkbox', value: existing?.openInEdge ?? false },
      { key: 'ungroupedLabel', label: 'Name for items without a group', value: existing?.ungroupedLabel ?? '', placeholder: 'Default', hint: 'Shown above those items when the workspace has groups. At most 40 characters; blank = Default.' },
    ],
    validate: (v) => {
      /** @type {Record<string, string>} */
      const e = {};
      if (String(v.name).trim() === '') e.name = 'Required';
      const n = String(v.sleepAfterMin).trim();
      if (n === '' || !Number.isInteger(Number(n)) || Number(n) < 0) e.sleepAfterMin = 'A whole number, 0 or more';
      const label = String(v.ungroupedLabel).trim();
      if (validateWorkspace({ name: 'x', ungroupedLabel: label === '' ? null : label }).length > 0) e.ungroupedLabel = 'At most 40 characters';
      return e;
    },
    onSubmit: async (v) => {
      const patch = { ...(existing ? { id: existing.id } : {}), name: String(v.name).trim(), icon: String(v.icon).trim() || null, sleepAfterMin: Number(v.sleepAfterMin), openInEdge: v.openInEdge === true, ungroupedLabel: String(v.ungroupedLabel).trim() || null };
      const res = await ctx.api.upsert({ workspaces: [patch] });
      if (res.errors) return { errors: errorsToMap(res.errors.map((/** @type {any} */ e) => ({ field: e.field, code: e.code }))) };
      if (!existing) await ctx.actions.selectWorkspace(res.ids.workspaces[0]);
      return undefined;
    },
  });
}

/**
 * Add (groupId null, in the active workspace) or rename a group.
 * @param {any} ctx
 * @param {string | null} groupId
 */
export async function openGroupEditor(ctx, groupId) {
  const existing = groupId ? ctx.snap().groups.find((/** @type {any} */ g) => g.id === groupId && !g.deleted) : null;
  if (groupId && !existing) return false;
  return openForm(ctx, {
    title: existing ? 'Rename group' : 'Add group',
    fields: [{ key: 'name', label: 'Name', value: existing?.name ?? '' }],
    validate: (v) => (String(v.name).trim() === '' ? { name: 'Required' } : {}),
    onSubmit: async (v) => {
      const patch = existing ? { id: existing.id, name: String(v.name).trim() } : { workspaceId: ctx.activeWorkspaceId(), name: String(v.name).trim() };
      const res = await ctx.api.upsert({ groups: [patch] });
      if (res.errors) return { errors: errorsToMap(res.errors.map((/** @type {any} */ e) => ({ field: e.field, code: e.code }))) };
      return undefined;
    },
  });
}

/** @param {string} code */
function syncFieldMessage(code) {
  switch (code) {
    case 'required': return 'Required';
    case 'invalid-url': return 'Enter an address like https://your-worker.example.com';
    case 'not-https': return 'The address must start with https://';
    case 'credentials': return 'Leave out any user name or password';
    case 'path': return 'Use just the address, without a path';
    case 'query-or-hash': return 'Use just the address, without ? or #';
    case 'whitespace': return 'No spaces';
    case 'too-long': return 'At most 256 characters';
    case 'invalid-date': return 'Enter a real date';
    case 'retype-required': return 'Type the secret again when the address or client id changes';
    case 'encryption-unavailable': return 'This PC cannot encrypt the secret (Windows secure storage is unavailable)';
    case 'write-failed': return 'The secret could not be stored';
    default: return 'Invalid value';
  }
}

/** What "Test connection" reports. @param {string} reason */
function syncReasonText(reason) {
  if (reason === 'not-connected') return 'no access key is stored on this PC. Enter it and save.';
  if (reason === 'offline') return 'the Worker cannot be reached. Check the address and your connection.';
  if (reason === 'access-key-refused') return 'the access key was refused.';
  if (reason.startsWith('http-')) return `the Worker answered ${reason.replace('http-', 'HTTP ')}.`;
  return `the Worker refused it (reason: ${reason}).`;
}

/** Sync form errors by form key. @param {{field: string, code: string}[]} errors @returns {Record<string, string>} */
function syncErrorsToMap(errors) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const e of errors) map[`sync${e.field.charAt(0).toUpperCase()}${e.field.slice(1)}`] = syncFieldMessage(e.code);
  return map;
}

/** @param {{connected: boolean, configured: boolean}} st */
const secretHint = (st) => (st.connected ? 'Stored ✓. Leave empty to keep it. It is never shown again.' : st.configured ? 'Not stored on this PC. Enter the access key again.' : 'The access key’s secret.');
/** @param {{clientIdTail: string | null}} st */
const clientIdHint = (st) => (st.clientIdTail ? `Stored, ending …${st.clientIdTail}. Leave empty to keep it.` : 'The access key’s client id.');

/**
 * Settings (timezone, Google email), this PC's device settings (Edge profile, autostart) and the
 * Sync connection. The Sync secret is only sent in; the UI is never told it (only a "stored" flag).
 * @param {any} ctx
 * @param {{section?: 'sync'}} [opts]  `sync`: open scrolled to the Sync section
 */
export async function openSettings(ctx, opts = {}) {
  const { settings } = ctx.snap();
  const device = ctx.state.device;
  const zones = ['UTC', ...Intl.supportedValuesOf('timeZone').filter((/** @type {string} */ z) => z !== 'UTC')];
  if (!zones.includes(settings.timezone)) zones.unshift(settings.timezone);
  const sync = await ctx.api.syncStatus();
  const initial = { baseUrl: sync.baseUrl ?? '', expiresOn: sync.expiresOn ?? '' };
  /** @param {Record<string, any>} v */
  const syncValues = (v) => ({ baseUrl: String(v.syncBaseUrl), clientId: String(v.syncClientId), secret: String(v.syncSecret), expiresOn: String(v.syncExpiresOn) });
  /** Save only when something was changed or typed. @param {Record<string, any>} v */
  const syncDirty = (v) => String(v.syncBaseUrl).trim() !== initial.baseUrl || String(v.syncExpiresOn).trim() !== initial.expiresOn || String(v.syncClientId).trim() !== '' || String(v.syncSecret).trim() !== '';
  /** @param {import('./dialogs.js').DialogHelpers} helpers */
  const refreshSyncHints = async (helpers) => {
    const st = await ctx.api.syncStatus();
    helpers.setHint('syncClientId', clientIdHint(st));
    helpers.setHint('syncSecret', secretHint(st));
  };
  return openForm(ctx, {
    title: 'Settings',
    focusKey: opts.section === 'sync' ? 'syncBaseUrl' : undefined,
    fields: [
      { key: 'timezone', label: 'Timezone (decides when a day starts)', type: 'select', value: settings.timezone, options: zones.map((z) => ({ value: z, label: z })) },
      { key: 'googleEmail', label: 'Google account email (fills {googleEmail} in addresses)', value: settings.googleEmail ?? '', placeholder: 'name@example.com' },
      { key: 'edgeProfile', label: 'Edge profile folder on this PC (blank = Edge’s default)', value: device.edgeProfile ?? '', placeholder: 'Profile 2' },
      { key: 'autostart', label: 'Start with Windows (hidden in the tray)', type: 'checkbox', value: device.autostart, hint: ctx.state.meta.packaged ? undefined : 'Saved now; it takes effect in the packaged app.' },
      { key: 'syncBaseUrl', section: 'Sync', sectionHint: 'Setup guide: docs/desktop/general/sync-setup.md', label: 'Worker address', value: initial.baseUrl, placeholder: 'https://your-worker.example.com' },
      { key: 'syncClientId', label: 'Client ID', value: '', placeholder: sync.clientIdTail ? `…${sync.clientIdTail}` : '', hint: clientIdHint(sync) },
      { key: 'syncSecret', label: 'Client secret', type: 'password', value: '', hint: secretHint(sync) },
      { key: 'syncExpiresOn', label: 'Expiry date (recommended: shows a warning 14 days before)', type: 'date', value: initial.expiresOn },
      {
        key: 'syncActions',
        type: 'actions',
        label: '',
        buttons: [
          {
            label: 'Test connection',
            run: async (v, helpers) => {
              if (syncDirty(v)) {
                const saved = await ctx.api.syncConfigure(syncValues(v));
                if (!saved.ok) {
                  helpers.showErrors(syncErrorsToMap(saved.errors));
                  return 'Fix the marked fields first.';
                }
                helpers.showErrors({});
                initial.baseUrl = String(v.syncBaseUrl).trim();
                initial.expiresOn = String(v.syncExpiresOn).trim();
                helpers.set('syncClientId', '');
                helpers.set('syncSecret', '');
                await refreshSyncHints(helpers);
              }
              const res = await ctx.api.syncTest();
              return res.ok ? 'Connected ✓' : `Not connected: ${syncReasonText(res.reason)}`;
            },
          },
          {
            label: 'Disconnect',
            run: async (_v, helpers) => {
              const answer = await ctx.api.confirm({
                message: 'Disconnect this PC from sync?',
                detail: 'The stored access key is deleted from this PC. Your lists stay as they are.',
                buttons: ['Disconnect', 'Cancel'],
                cancelId: 1,
              });
              if (answer.response !== 0) return '';
              await ctx.api.syncDisconnect();
              helpers.set('syncClientId', '');
              helpers.set('syncSecret', '');
              helpers.set('syncExpiresOn', '');
              initial.expiresOn = '';
              await refreshSyncHints(helpers);
              return 'Disconnected. The access key was deleted from this PC.';
            },
          },
        ],
      },
    ],
    validate: (v) => {
      const email = String(v.googleEmail).trim();
      return email !== '' && !/^[^\s@]+@[^\s@]+$/.test(email) ? { googleEmail: 'Enter an email address' } : {};
    },
    onSubmit: async (v) => {
      if (syncDirty(v)) {
        const saved = await ctx.api.syncConfigure(syncValues(v));
        if (!saved.ok) return { errors: syncErrorsToMap(saved.errors) };
      }
      const email = String(v.googleEmail).trim();
      const res = await ctx.api.saveSettings({ timezone: v.timezone, googleEmail: email === '' ? null : email });
      if (res.errors) return { errors: errorsToMap(res.errors.map((/** @type {any} */ e) => ({ field: e.field, code: e.code }))) };
      await ctx.api.saveDevice({ edgeProfile: String(v.edgeProfile).trim() || null, autostart: v.autostart === true });
      return undefined;
    },
  });
}
