// @ts-check
// A small form dialog built on <dialog>. While one is open the native site views are taken off the
// window (setOverlay), because they would otherwise paint above it.

import { h } from './dom.js';

/**
 * @typedef {object} FieldSpec
 * @property {string} key
 * @property {string} label
 * @property {'text' | 'password' | 'number' | 'date' | 'time' | 'checkbox' | 'select' | 'actions'} [type]  `actions` has no value: it draws `buttons` and a result line
 * @property {string} [section]       a heading drawn above this field (starts a section)
 * @property {string} [sectionHint]   a line of help under the heading
 * @property {{label: string, run: (values: Record<string, any>, helpers: DialogHelpers) => Promise<string>}[]} [buttons]  for `actions`: each press runs once and reports a short result
 * @property {unknown} [value]
 * @property {{value: string, label: string}[]} [options]
 * @property {string} [hint]
 * @property {string} [placeholder]
 * @property {boolean} [browse]      add a "Browse…" button that picks a program
 * @property {{label: string, disabledReason?: string, run: () => Promise<string>}} [action]  a button beside the field that runs once per press and reports a short result under it ("Refresh icon")
 * @property {(values: Record<string, any>) => boolean} [showIf]
 * @property {(values: Record<string, any>) => {value: string, label: string}[]} [optionsFor]  options that depend on other fields
 */

/** @typedef {{showErrors: (errors: Record<string, string>) => void, set: (key: string, value: string) => void, setHint: (key: string, text: string) => void}} DialogHelpers */

/**
 * @typedef {object} FormSpec
 * @property {string} title
 * @property {FieldSpec[]} fields
 * @property {string} [submitLabel]
 * @property {string} [focusKey]   the field to focus and scroll to when the form opens (default: the first)
 * @property {(values: Record<string, any>) => Record<string, string>} [validate]  sync checks; key -> message
 * @property {(values: Record<string, any>) => Promise<{errors?: Record<string, string>, formError?: string} | void>} onSubmit
 */

/** @type {((saved: boolean) => void) | null} the open form's finisher, if any */
let activeFinish = null;

/**
 * Open the form. Resolves true when saved, false when cancelled.
 * @param {any} ctx
 * @param {FormSpec} spec
 * @returns {Promise<boolean>}
 */
export function openForm(ctx, spec) {
  return new Promise((resolve) => {
    const dlg = /** @type {HTMLDialogElement} */ (document.getElementById('dialog'));
    if (activeFinish) activeFinish(false);
    if (dlg.open) dlg.close();
    /** @type {(value: string) => void} */
    let closeDialog = () => {};

    /** @type {Map<string, {field: FieldSpec, input: HTMLInputElement | HTMLSelectElement, wrap: HTMLElement, error: HTMLElement}>} */
    const controls = new Map();

    const read = () => {
      /** @type {Record<string, any>} */
      const v = {};
      for (const [key, c] of controls) v[key] = c.field.type === 'checkbox' ? /** @type {HTMLInputElement} */ (c.input).checked : c.input.value;
      return v;
    };

    const refresh = () => {
      const v = read();
      for (const c of controls.values()) {
        c.wrap.classList.toggle('hidden', c.field.showIf ? !c.field.showIf(v) : false);
        if (c.field.optionsFor && c.input instanceof HTMLSelectElement) {
          const opts = c.field.optionsFor(v);
          const current = c.input.value;
          if (JSON.stringify([...c.input.options].map((o) => o.value)) !== JSON.stringify(opts.map((o) => o.value))) {
            c.input.replaceChildren(...opts.map((o) => h('option', { value: o.value }, o.label)));
            c.input.value = opts.some((o) => o.value === current) ? current : (opts[0]?.value ?? '');
          }
        }
      }
    };

    /** @param {Record<string, string>} errors */
    const showErrors = (errors) => {
      for (const [key, c] of controls) {
        const msg = errors[key];
        c.wrap.classList.toggle('invalid', Boolean(msg));
        c.error.textContent = msg ?? '';
      }
      const first = [...controls.entries()].find(([k, c]) => errors[k] && !c.wrap.classList.contains('hidden'));
      first?.[1].input.focus();
    };

    /** @type {DialogHelpers} */
    const helpers = {
      showErrors,
      set: (key, value) => {
        const c = controls.get(key);
        if (c) { c.input.value = value; refresh(); }
      },
      setHint: (key, text) => {
        const el = controls.get(key)?.wrap.querySelector(':scope > .hint:not(.action-result)');
        if (el) el.textContent = text;
      },
    };

    const formError = h('div', { class: 'form-error', role: 'alert' });

    const fieldEls = spec.fields.map((f) => {
      const type = f.type ?? 'text';
      const id = `f-${f.key}`;
      const heading = f.section ? [h('h3', { class: 'section-title' }, f.section), f.sectionHint ? h('div', { class: 'hint' }, f.sectionHint) : null] : [];
      if (type === 'actions') {
        // no value: a hidden input keeps the control table uniform
        const hidden = /** @type {HTMLInputElement} */ (h('input', { id, type: 'hidden' }));
        const result = h('div', { class: 'hint action-result', role: 'status' });
        /** @type {HTMLElement[]} */
        const buttons = (f.buttons ?? []).map((b) => {
          const button = h('button', {
            type: 'button',
            class: 'small-btn',
            onclick: async () => {
              for (const el of buttons) /** @type {HTMLButtonElement} */ (el).disabled = true;
              result.textContent = 'Working…';
              try {
                result.textContent = await b.run(read(), helpers);
              } catch {
                result.textContent = 'That did not work.';
              } finally {
                for (const el of buttons) /** @type {HTMLButtonElement} */ (el).disabled = false;
              }
            },
          }, b.label);
          return button;
        });
        const wrap = h('div', { class: 'field' }, ...heading, h('div', { class: 'with-button' }, hidden, ...buttons), result);
        controls.set(f.key, { field: f, input: hidden, wrap, error: h('div', { class: 'error' }) });
        return wrap;
      }
      /** @type {HTMLInputElement | HTMLSelectElement} */
      let input;
      if (type === 'select') {
        input = /** @type {HTMLSelectElement} */ (h('select', { id, onchange: refresh }, ...(f.options ?? []).map((o) => h('option', { value: o.value }, o.label))));
        input.value = String(f.value ?? '');
      } else if (type === 'checkbox') {
        input = /** @type {HTMLInputElement} */ (h('input', { id, type: 'checkbox', checked: f.value === true, onchange: refresh }));
      } else {
        input = /** @type {HTMLInputElement} */ (h('input', { id, type, value: f.value === null || f.value === undefined ? '' : String(f.value), placeholder: f.placeholder, autocomplete: 'off', spellcheck: false, oninput: refresh }));
      }
      const error = h('div', { class: 'error' });
      const label = h('label', { class: 'label', for: id }, f.label);
      const result = h('div', { class: 'hint action-result', role: 'status' });
      /** @type {HTMLElement} */
      let control = input;
      if (f.browse) {
        control = h('div', { class: 'with-button' }, input, h('button', {
          type: 'button',
          class: 'small-btn',
          onclick: async () => {
            const r = await ctx.api.pickProgram();
            if (r.path) { input.value = r.path; refresh(); }
          },
        }, 'Browse…'));
      } else if (f.action) {
        const action = f.action;
        const button = h('button', {
          type: 'button',
          class: 'small-btn',
          disabled: Boolean(action.disabledReason),
          title: action.disabledReason ?? undefined,
          onclick: async () => {
            /** @type {HTMLButtonElement} */ (button).disabled = true;
            result.textContent = 'Working…';
            try {
              result.textContent = await action.run();
            } catch {
              result.textContent = 'That did not work.';
            } finally {
              /** @type {HTMLButtonElement} */ (button).disabled = false;
            }
          },
        }, action.label);
        control = h('div', { class: 'with-button' }, input, button);
      }
      const wrap = type === 'checkbox'
        ? h('div', { class: 'field check' }, input, label, f.hint ? h('div', { class: 'hint' }, f.hint) : null, error)
        : h('div', { class: 'field' }, ...heading, label, control, f.hint ? h('div', { class: 'hint' }, f.hint) : null, f.action ? result : null, error);
      controls.set(f.key, { field: f, input, wrap, error });
      return wrap;
    });

    const cancel = h('button', { type: 'button', class: 'small-btn', onclick: () => closeDialog('cancel') }, 'Cancel');
    const save = h('button', { type: 'submit', class: 'primary-btn' }, spec.submitLabel ?? 'Save');
    const form = h(
      'form',
      {
        method: 'dialog',
        novalidate: true,
        onsubmit: async (/** @type {Event} */ e) => {
          e.preventDefault();
          formError.textContent = '';
          const values = read();
          const local = spec.validate ? spec.validate(values) : {};
          showErrors(local);
          if (Object.keys(local).length > 0) return;
          /** @type {HTMLButtonElement} */ (save).disabled = true;
          try {
            const res = await spec.onSubmit(values);
            if (res?.errors && Object.keys(res.errors).length > 0) showErrors(res.errors);
            if (res?.formError) formError.textContent = res.formError;
            if (!res || (!res.formError && (!res.errors || Object.keys(res.errors).length === 0))) closeDialog('saved');
          } finally {
            /** @type {HTMLButtonElement} */ (save).disabled = false;
          }
        },
      },
      h('h2', {}, spec.title),
      h('div', { class: 'form-body' }, ...fieldEls),
      formError,
      h('div', { class: 'form-actions' }, cancel, save),
    );
    dlg.replaceChildren(form);
    refresh();

    // Finish exactly once. The dialog's own `close` event is dispatched as a later task (it can be
    // delayed, e.g. while the window is busy or occluded), so our own close paths finish directly and
    // the native overlay (site views) is never left off the window.
    let finished = false;
    const finish = (/** @type {boolean} */ saved) => {
      if (finished) return;
      finished = true;
      dlg.removeEventListener('close', onClose);
      if (activeFinish === finish) activeFinish = null;
      ctx.api.setOverlay(false);
      resolve(saved);
      dlg.replaceChildren();
    };
    // a stale close event of the previous dialog can arrive after this one has opened: ignore it
    const onClose = () => {
      if (!dlg.open) finish(dlg.returnValue === 'saved');
    };
    closeDialog = (/** @type {string} */ value) => {
      dlg.close(value);
      finish(value === 'saved');
    };
    dlg.addEventListener('close', onClose);
    activeFinish = finish;
    ctx.api.setOverlay(true);
    dlg.returnValue = '';
    dlg.showModal();
    const firstInput = (spec.focusKey ? controls.get(spec.focusKey)?.input : undefined) ?? [...controls.values()][0]?.input;
    firstInput?.focus();
    if (spec.focusKey) firstInput?.scrollIntoView({ block: 'center' });
  });
}

/**
 * A read-only panel on the same <dialog> (the sync "Needs attention" list). `build` fills the body and
 * returns a function that redraws it; the panel calls that function again whenever `ctx.ui.panelRefresh`
 * is run (app.js does so after every state update). Native site views are taken off the window while it
 * is open, exactly like a form (D84/D108): our own close paths release the overlay without waiting for
 * the dialog's late `close` event.
 * @param {any} ctx
 * @param {{title: string, closeLabel?: string, build: (body: HTMLElement, close: () => void) => (() => void)}} spec
 * @returns {Promise<void>} resolves when the panel is closed
 */
export function openPanel(ctx, spec) {
  return new Promise((resolve) => {
    const dlg = /** @type {HTMLDialogElement} */ (document.getElementById('dialog'));
    if (activeFinish) activeFinish(false);
    if (dlg.open) dlg.close();
    let finished = false;
    const finish = (/** @type {boolean} */ _saved) => {
      if (finished) return;
      finished = true;
      dlg.removeEventListener('close', onClose);
      if (activeFinish === finish) activeFinish = null;
      ctx.ui.panelRefresh = null;
      ctx.api.setOverlay(false);
      resolve();
      dlg.replaceChildren();
    };
    const onClose = () => {
      if (!dlg.open) finish(true);
    };
    const close = () => {
      dlg.close('closed');
      finish(true);
    };
    const body = h('div', { class: 'form-body panel-body' });
    const redraw = spec.build(body, close);
    ctx.ui.panelRefresh = redraw;
    dlg.replaceChildren(
      h(
        'form',
        { method: 'dialog', onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); close(); } },
        h('h2', {}, spec.title),
        body,
        h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'primary-btn' }, spec.closeLabel ?? 'Close')),
      ),
    );
    dlg.addEventListener('close', onClose);
    activeFinish = finish;
    ctx.api.setOverlay(true);
    dlg.returnValue = '';
    dlg.showModal();
  });
}
