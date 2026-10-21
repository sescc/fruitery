// @ts-check
// Tray, close-to-tray and start with Windows (D16).

import { Tray, Menu, nativeImage, app } from 'electron';
import { fruitIcon } from '../lib/icon.js';

/** Generated app icon (no binary asset in the repo). */
export function appIcon() {
  return nativeImage.createFromBuffer(fruitIcon(32));
}

/**
 * @param {object} p
 * @param {any} p.win
 * @param {() => void} p.showWindow
 * @param {() => void} p.quit
 * @returns {{tray: any, destroy: () => void}}
 */
export function createTray({ win, showWindow, quit }) {
  const tray = new Tray(appIcon());
  tray.setToolTip('Fruitery');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Fruitery', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ]),
  );
  tray.on('click', () => {
    if (win.isVisible() && !win.isMinimized()) win.focus();
    else showWindow();
  });
  return { tray, destroy: () => tray.destroy() };
}

/**
 * Start with Windows: only the packaged app registers itself, started hidden in the tray. In
 * development the toggle is stored but not applied.
 * @param {boolean} autostart
 * @returns {{applied: boolean}}
 */
export function applyAutostart(autostart) {
  if (!app.isPackaged) return { applied: false };
  app.setLoginItemSettings({ openAtLogin: autostart === true, path: process.execPath, args: ['--hidden'] });
  return { applied: true };
}
