// @ts-check
// Keyboard shortcuts handled in the main process for every webContents (they must work while a
// site has focus). Pure: maps an Electron `before-input-event` input to a command.

/** @typedef {'reload' | 'home' | 'back' | 'forward'} NavAction */
/** @typedef {{type: 'workspace', index: number} | {type: 'item', delta: 1 | -1} | {type: 'edit', source: 'ui' | 'site'} | {type: 'nav', action: NavAction}} Shortcut */

/**
 * Ctrl+1 .. Ctrl+9 select the 1st .. 9th workspace (index 0..8); Ctrl+Tab / Ctrl+Shift+Tab show
 * the next / previous item. F3 (no modifier) edits the entry that has focus: the source says whether
 * the key went to the app UI or to a site, so the UI knows whether its own focus counts.
 * Page navigation: F5 reloads, F6 goes home (the item's saved address), Alt+Left / Alt+Right go
 * back / forward. The hardware Back / Forward keys and the mouse side buttons are NOT mapped here:
 * Windows delivers them as `app-command` window events (see `appCommandAction`), and mapping both
 * routes could make one press move two steps. Anything else (including other Alt / Meta
 * combinations) is not ours.
 * @param {{type?: string, key?: string, control?: boolean, alt?: boolean, meta?: boolean, shift?: boolean}} input
 * @param {'ui' | 'site'} [source] which webContents received the key
 * @returns {Shortcut | null}
 */
export function shortcutFor(input, source = 'site') {
  if (!input || input.type !== 'keyDown') return null;
  const noMod = input.control !== true && input.alt !== true && input.meta !== true && input.shift !== true;
  if (noMod && input.key === 'F3') return { type: 'edit', source };
  if (noMod && input.key === 'F5') return { type: 'nav', action: 'reload' };
  if (noMod && input.key === 'F6') return { type: 'nav', action: 'home' };
  if (input.alt === true && input.control !== true && input.meta !== true && input.shift !== true) {
    if (input.key === 'ArrowLeft') return { type: 'nav', action: 'back' };
    if (input.key === 'ArrowRight') return { type: 'nav', action: 'forward' };
    return null;
  }
  if (input.control !== true || input.alt === true || input.meta === true) return null;
  if (input.key === 'Tab') return { type: 'item', delta: input.shift === true ? -1 : 1 };
  if (typeof input.key === 'string' && /^[1-9]$/.test(input.key) && input.shift !== true) {
    return { type: 'workspace', index: Number(input.key) - 1 };
  }
  return null;
}

/**
 * What a Windows `app-command` of the window means: the mouse's side buttons and the keyboard's
 * browser Back / Forward keys.
 * @param {unknown} command
 * @returns {'back' | 'forward' | null}
 */
export function appCommandAction(command) {
  if (command === 'browser-backward') return 'back';
  if (command === 'browser-forward') return 'forward';
  return null;
}
