// @ts-check
// Argument validation for every IPC handler (the UI is trusted code, but nothing is passed on
// unchecked). Each helper returns a clean value or throws TypeError('invalid-argument').

const MAX_ID = 200;
const MAX_PATCH_JSON = 400_000;

/** @returns {never} */
function bad() {
  throw new TypeError('invalid-argument');
}

/**
 * A short string id without control characters.
 * @param {unknown} v
 * @returns {string}
 */
export function idArg(v) {
  if (typeof v !== 'string' || v === '' || v.length > MAX_ID || /[\u0000-\u001f]/.test(v)) bad();
  return /** @type {string} */ (v);
}

/**
 * @param {unknown} v
 * @returns {string | null}
 */
export function optionalIdArg(v) {
  return v === null || v === undefined ? null : idArg(v);
}

/**
 * @template {string} T
 * @param {unknown} v
 * @param {readonly T[]} allowed
 * @returns {T}
 */
export function oneOf(v, allowed) {
  if (typeof v !== 'string' || !allowed.includes(/** @type {T} */ (v))) bad();
  return /** @type {T} */ (v);
}

/**
 * A short piece of text typed by the owner (an address), without line breaks.
 * @param {unknown} v
 * @param {number} [max]
 * @returns {string}
 */
export function textArg(v, max = 2100) {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f]/.test(v)) bad();
  return /** @type {string} */ (v);
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
export function boolArg(v) {
  if (typeof v !== 'boolean') bad();
  return /** @type {boolean} */ (v);
}

/**
 * @param {unknown} v
 * @returns {number}
 */
export function indexArg(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100_000) bad();
  return Math.trunc(/** @type {number} */ (v));
}

/**
 * A plain JSON-like object of bounded size (edit patches, layouts).
 * @param {unknown} v
 * @returns {Record<string, any>}
 */
export function objectArg(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) bad();
  let size;
  try {
    size = JSON.stringify(v).length;
  } catch {
    bad();
  }
  if (/** @type {number} */ (size) > MAX_PATCH_JSON) bad();
  return /** @type {Record<string, any>} */ (v);
}

/**
 * Pane rectangles from the UI: at most 8, finite numbers, ids or null.
 * @param {unknown} v
 * @returns {{paneId: string, itemId: string | null, x: number, y: number, w: number, h: number}[]}
 */
export function rectsArg(v) {
  if (!Array.isArray(v) || v.length > 8) bad();
  return /** @type {any[]} */ (v).map((r) => {
    if (r === null || typeof r !== 'object') bad();
    for (const k of ['x', 'y', 'w', 'h']) {
      if (typeof r[k] !== 'number' || !Number.isFinite(r[k]) || Math.abs(r[k]) > 100_000) bad();
    }
    return { paneId: idArg(r.paneId), itemId: optionalIdArg(r.itemId), x: r.x, y: r.y, w: Math.max(0, r.w), h: Math.max(0, r.h) };
  });
}

/**
 * Options of the native confirmation box.
 * @param {unknown} v
 * @returns {{message: string, detail: string, buttons: string[], cancelId: number}}
 */
export function confirmArg(v) {
  const o = objectArg(v);
  const text = (/** @type {unknown} */ s, /** @type {number} */ max) => {
    if (typeof s !== 'string' || s.length > max) bad();
    return /** @type {string} */ (s);
  };
  const buttons = Array.isArray(o.buttons) ? o.buttons : ['OK', 'Cancel'];
  if (buttons.length < 1 || buttons.length > 3) bad();
  const labels = buttons.map((b) => text(b, 40));
  const cancelId = Number.isInteger(o.cancelId) && o.cancelId >= 0 && o.cancelId < labels.length ? o.cancelId : labels.length - 1;
  return { message: text(o.message ?? '', 300), detail: o.detail === undefined ? '' : text(o.detail, 600), buttons: labels, cancelId };
}

/**
 * A focus change: a workspace id and a pane id, nothing else (never a tree).
 * @param {unknown} workspaceId
 * @param {unknown} paneId
 * @returns {{workspaceId: string, paneId: string}}
 */
export function focusPaneArgs(workspaceId, paneId) {
  return { workspaceId: idArg(workspaceId), paneId: idArg(paneId) };
}

/**
 * Which rejected change to discard: the entity kind as the API names it, and its id (null for settings).
 * @param {unknown} kind
 * @param {unknown} id
 * @returns {{kind: 'workspaces' | 'groups' | 'items' | 'settings', id: string | null}}
 */
export function syncDiscardArgs(kind, id) {
  const k = oneOf(kind, /** @type {const} */ (['workspaces', 'groups', 'items', 'settings']));
  return { kind: k, id: k === 'settings' ? null : idArg(id) };
}

/**
 * The four values of the Sync form. Each is a short single-line string (blank/absent = ''); their
 * meaning is checked by `planConfigure` so the UI gets field errors, not an exception.
 * @param {unknown} v
 * @returns {{baseUrl: string, clientId: string, secret: string, expiresOn: string}}
 */
export function syncConfigureArg(v) {
  const o = objectArg(v);
  /** @param {unknown} s */
  const text = (s) => (s === undefined || s === null ? '' : textArg(s, 600));
  return { baseUrl: text(o.baseUrl), clientId: text(o.clientId), secret: text(o.secret), expiresOn: text(o.expiresOn) };
}
