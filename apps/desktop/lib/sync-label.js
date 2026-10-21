// @ts-check
// What the sync status chip, its tooltip, the tick notice and the "Needs attention" list say. Pure: no DOM,
// no clock (the time formatter and `nowMs` are parameters), so every wording is unit tested.

/** The notice shown while waiting ticks are held because the Worker is too old to file them by the time they were made. */
export const TICKS_HELD_TEXT = 'Queued ticks wait for a Worker update (npm run deploy:web)';

/** Shorter than this, a "syncing" flight is not shown (it would flicker every minute). */
export const SYNCING_SHOW_AFTER_MS = 500;

/**
 * @typedef {object} SyncInfo  the `sync` part of the state (see main/sync-settings.js `SyncStatus`)
 * @property {string} status
 * @property {boolean} [configured]
 * @property {boolean} [connected]
 * @property {number | null} [lastSyncAt]
 * @property {number} [pending]
 * @property {{kind: string, id: string | null, name: string, errors: {field: string, code: string}[]}[]} [rejected]
 * @property {{id: string, itemId: string, name: string, periodKey: string, reason: string, at: number}[]} [droppedTicks]  waiting ticks the server refused
 * @property {boolean} [ticksHeld]  waiting ticks are held until the Worker is updated
 */
/**
 * @typedef {object} SyncLabel
 * @property {'synced' | 'syncing' | 'offline' | 'not-connected' | 'error' | 'expiring' | 'expired'} kind
 * @property {string} icon     one character for the chip
 * @property {'ok' | 'busy' | 'warn' | 'bad' | 'idle'} tone
 * @property {string} tooltip
 * @property {number} badge    a count to draw on the chip (0 = none)
 * @property {boolean} attention  something needs attention (rejected changes, dropped ticks, held ticks): the chip opens the "Needs attention" list
 */

/** @param {number} ms */
const defaultFormat = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Chip icon, tone and tooltip for a status.
 * - synced: "Synced <time>"; syncing; offline; not connected; `error:<reason>` as "Sync error: <reason>";
 *   `expiring:<n>` as "Access key expires in n days" ("today" for 0, "in 1 day" for 1); expired.
 * - The badge is the number of changes waiting while the status is not synced, else the number of
 *   rejected changes. Rejected changes also turn an ok chip to a warning, and are named in the tooltip.
 * @param {SyncInfo | null | undefined} sync
 * @param {(ms: number) => string} [formatTime]
 * @returns {SyncLabel}
 */
export function syncLabel(sync, formatTime = defaultFormat) {
  const status = sync?.status ?? 'not-connected';
  const pending = Math.max(0, sync?.pending ?? 0);
  const rejected = (sync?.rejected?.length ?? 0) + (sync?.droppedTicks?.length ?? 0);
  const held = sync?.ticksHeld === true;
  /** @type {Omit<SyncLabel, 'badge' | 'attention'>} */
  let base;
  if (status === 'synced') {
    const t = typeof sync?.lastSyncAt === 'number' ? ` ${formatTime(sync.lastSyncAt)}` : '';
    base = { kind: 'synced', icon: '✓', tone: 'ok', tooltip: `Synced${t}` };
  } else if (status === 'syncing') {
    base = { kind: 'syncing', icon: '↻', tone: 'busy', tooltip: 'Syncing…' };
  } else if (status === 'offline') {
    base = { kind: 'offline', icon: '⊘', tone: 'warn', tooltip: 'Offline — edits and ticks are kept and sent later' };
  } else if (status === 'expired') {
    base = { kind: 'expired', icon: '!', tone: 'bad', tooltip: 'Access key expired — create a new one (see Settings → Sync)' };
  } else if (status.startsWith('expiring:')) {
    const n = Number(status.slice('expiring:'.length));
    const when = n === 0 ? 'today' : n === 1 ? 'in 1 day' : `in ${n} days`;
    base = { kind: 'expiring', icon: '!', tone: 'warn', tooltip: `Access key expires ${when}` };
  } else if (status.startsWith('error:')) {
    base = { kind: 'error', icon: '!', tone: 'bad', tooltip: `Sync error: ${status.slice('error:'.length)}` };
  } else {
    base = { kind: 'not-connected', icon: '○', tone: 'idle', tooltip: 'Not connected — enter the access key in Settings → Sync' };
  }
  const notes = [];
  if (pending > 0 && base.kind !== 'synced') notes.push(`${pending} ${pending === 1 ? 'change' : 'changes'} waiting to be sent`);
  if (rejected > 0) notes.push(`${rejected} ${rejected === 1 ? 'change needs' : 'changes need'} attention`);
  if (held) notes.push('queued ticks wait for a Worker update');
  const tone = (rejected > 0 || held) && base.tone === 'ok' ? 'warn' : base.tone;
  const badge = base.kind !== 'synced' && pending > 0 ? pending : rejected + (held ? 1 : 0);
  return { ...base, tone, tooltip: notes.length > 0 ? `${base.tooltip} · ${notes.join(' · ')}` : base.tooltip, badge, attention: rejected > 0 || held };
}

/**
 * Keeps a short "syncing" from showing: until a flight has lasted `delayMs`, the chip keeps the last
 * settled status. With no settled status yet (the very first flight) it shows "syncing" at once.
 * @param {number} [delayMs]
 */
export function createSyncingGate(delayMs = SYNCING_SHOW_AFTER_MS) {
  /** @type {string | null} */
  let settled = null;
  /** @type {number | null} */
  let since = null;
  return {
    /**
     * @param {string} status the real status
     * @param {number} nowMs
     * @returns {string} the status to show
     */
    apply(status, nowMs) {
      if (status !== 'syncing') {
        settled = status;
        since = null;
        return status;
      }
      if (settled === null) return 'syncing';
      since ??= nowMs;
      return nowMs - since >= delayMs ? 'syncing' : settled;
    },
    /** @param {number} nowMs @returns {number | null} ms until a running flight becomes visible, else null */
    wait(nowMs) {
      return since !== null && nowMs - since < delayMs ? delayMs - (nowMs - since) : null;
    },
  };
}

/**
 * The line shown in the list when ticking is not possible, or null.
 * @param {SyncInfo | null | undefined} sync
 * @param {boolean | undefined} ticksEnabled
 * @returns {string | null}
 */
export function tickNotice(sync, ticksEnabled) {
  if (ticksEnabled !== false) return null;
  if (sync?.status === 'expired') return 'Ticking needs a new access key';
  if (sync?.configured && !sync.connected) return 'Ticking needs the access key';
  return 'Ticking needs a connection';
}

const KIND_NAME = /** @type {Record<string, string>} */ ({ items: 'Item', groups: 'Group', workspaces: 'Workspace', settings: 'Settings' });
const FIELD_NAME = /** @type {Record<string, string>} */ ({
  name: 'Name', url: 'Address', fallbackUrl: 'Fallback address', appPath: 'Program', resetTime: 'Day reset time', sleepAfterMin: 'Unload time',
  devices: 'Shown on', kind: 'Kind', groupId: 'Group', workspaceId: 'Workspace', ungroupedLabel: 'Name for items without a group', timezone: 'Timezone',
  googleEmail: 'Google email', 'edge.mode': 'Open in Edge', 'edge.profile': 'Edge profile', 'userAgent.preset': 'Browser identity', 'userAgent.custom': 'Custom user-agent',
  schedule: 'Schedule', 'schedule.n': 'Every N days', 'schedule.day': 'Day of month', 'schedule.weekday': 'Weekday', 'schedule.startDate': 'Counting from', 'schedule.type': 'Schedule',
});
const CODE_TEXT = /** @type {Record<string, string>} */ ({
  required: 'is required', 'invalid-url': 'is not a valid web address', 'unknown-token': 'uses an unknown placeholder', 'invalid-time': 'is not a valid time',
  'out-of-range': 'is out of range', 'invalid-value': 'has an invalid value', 'invalid-type': 'has the wrong type', 'invalid-date': 'is not a real date',
  'invalid-timezone': 'is not a known timezone', 'group-not-found': 'refers to a group that no longer exists', 'group-workspace-mismatch': 'belongs to another workspace',
});

/**
 * One readable sentence for a rejected change.
 * @param {{kind: string, name: string, errors: {field: string, code: string}[]}} r
 * @returns {{title: string, reasons: string[]}}
 */
export function describeRejected(r) {
  const reasons = r.errors.map((e) => `${FIELD_NAME[e.field] ?? e.field} ${CODE_TEXT[e.code] ?? `was refused (${e.code})`}`);
  return { title: `${KIND_NAME[r.kind] ?? r.kind}: ${r.name}`, reasons: reasons.length > 0 ? reasons : ['was refused by the server'] };
}

/**
 * One readable sentence for a waiting tick the server refused.
 * @param {{name: string, periodKey: string, reason: string}} n
 * @returns {{title: string, reason: string}}
 */
export function describeDroppedTick(n) {
  const title = `Tick dropped: ${n.name}`;
  switch (n.reason) {
    case 'tick-too-old': return { title, reason: `The tick for ${n.periodKey} waited more than 48 hours and was too old to send.` };
    case 'tick-in-future': return { title, reason: `The tick for ${n.periodKey} was ahead of the Worker's clock. Check this PC's clock.` };
    case 'period-not-allowed': return { title, reason: `Taking back the tick for ${n.periodKey} was not allowed: it is more than one period back.` };
    default: return { title, reason: `The Worker refused the tick for ${n.periodKey}.` };
  }
}