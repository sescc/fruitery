// @ts-check
// Tiny DOM builder. Text is always set as text (never as HTML) and styles through the CSSOM, so the
// strict CSP (no inline script, no inline style attributes) holds.

/**
 * @param {string} tag
 * @param {Record<string, any>} [props]  class, dataset, style, on<event> handlers, or element properties / attributes
 * @param {...any} children              nodes, strings, numbers, arrays (flattened); null / false are skipped
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'for') /** @type {HTMLLabelElement} */ (el).htmlFor = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'object') /** @type {any} */ (el)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/**
 * Re-render an element only when its signature changed.
 * @param {HTMLElement} el
 * @param {unknown} signature
 * @param {() => void} render
 * @returns {boolean} true when it rendered
 */
export function renderIfChanged(el, signature, render) {
  const sig = JSON.stringify(signature);
  const holder = /** @type {any} */ (el);
  if (holder.__sig === sig) return false;
  holder.__sig = sig;
  render();
  return true;
}

/**
 * Entries that F3 can edit carry `data-edit-kind` and `data-edit-id`. Before an element's children are
 * replaced, remember which of them had keyboard focus; the returned function puts the focus back on
 * the same entry afterwards (a re-render must not drop the keyboard focus).
 * @param {HTMLElement} el
 * @returns {() => void} restore
 */
export function captureEditFocus(el) {
  const active = /** @type {HTMLElement | null} */ (document.activeElement);
  const entry = active && el.contains(active) ? /** @type {HTMLElement | null} */ (active.closest('[data-edit-kind]')) : null;
  if (!entry) return () => {};
  const kind = entry.dataset.editKind ?? '';
  const id = entry.dataset.editId ?? '';
  return () => {
    for (const cand of el.querySelectorAll('[data-edit-kind]')) {
      const c = /** @type {HTMLElement} */ (cand);
      if (c.dataset.editKind === kind && c.dataset.editId === id) {
        c.focus({ preventScroll: true });
        return;
      }
    }
  };
}