// @ts-check
// The ONLY preload (Law 1): it exposes the IPC contract to the app UI as `window.fruitery`.
// Site views get no preload at all. Sandboxed preloads can require only 'electron'.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * @param {string} channel
 * @returns {(...args: unknown[]) => Promise<any>}
 */
const call = (channel) => (...args) => ipcRenderer.invoke(`fruitery:${channel}`, ...args);

/**
 * @param {string} channel
 * @returns {(cb: (payload: any) => void) => () => void}
 */
const subscribe = (channel) => (cb) => {
  /** @param {unknown} _e @param {unknown} payload */
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(`fruitery:${channel}`, listener);
  return () => ipcRenderer.removeListener(`fruitery:${channel}`, listener);
};

contextBridge.exposeInMainWorld('fruitery', {
  // state
  getState: call('getState'),
  onState: subscribe('state'),
  onCommand: subscribe('command'),
  onShortcut: subscribe('shortcut'),
  // views
  show: call('show'),
  setLayout: call('setLayout'),
  focusPane: call('focusPane'),
  setPaneRects: call('setPaneRects'),
  selectWorkspace: call('selectWorkspace'),
  navigate: call('navigate'),
  setOverlay: call('setOverlay'),
  // ticks and edits
  tick: call('tick'),
  untick: call('untick'),
  upsert: call('upsert'),
  reorder: call('reorder'),
  moveItem: call('moveItem'),
  remove: call('remove'),
  saveSettings: call('saveSettings'),
  saveDevice: call('saveDevice'),
  // sync settings (the secret is only ever sent in, never returned)
  syncStatus: call('syncStatus'),
  syncConfigure: call('syncConfigure'),
  syncTest: call('syncTest'),
  syncDisconnect: call('syncDisconnect'),
  syncDiscard: call('syncDiscard'),
  syncDismissTickNotice: call('syncDismissTickNotice'),
  // effects
  openInEdge: call('openInEdge'),
  copyAddress: call('copyAddress'),
  navigateTo: call('navigateTo'),
  openPageInEdge: call('openPageInEdge'),
  getIcon: call('getIcon'),
  refreshIcon: call('refreshIcon'),
  contextMenu: call('contextMenu'),
  confirm: call('confirm'),
  pickProgram: call('pickProgram'),
});
