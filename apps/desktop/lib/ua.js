// @ts-check
// User-agent presets (D65). Pure; the Electron default UA is passed in.

/** Firefox on Windows UA: keep the version in one place. */
export const FIREFOX_VERSION = '150.0';
export const FIREFOX_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${FIREFOX_VERSION}) Gecko/20100101 Firefox/${FIREFOX_VERSION}`;

/**
 * Remove the `Electron/x` token and the app-name token (`name/version` between "like Gecko)" and
 * "Chrome/") from Electron's default UA, leaving a plain Chrome UA.
 * @param {string} electronDefaultUA
 * @returns {string}
 */
export function stripElectronTokens(electronDefaultUA) {
  return electronDefaultUA
    .replace(/\sElectron\/\S+/g, '')
    .replace(/(like Gecko\))((?:\s+(?!Chrome\/)\S+\/\S+)+)(?=\s+Chrome\/)/, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The UA string for a preset.
 * - default -> Electron's UA unchanged (it passed Google sign-in, D65);
 * - chrome  -> Electron's UA without the Electron and app-name tokens;
 * - firefox -> a Firefox-on-Windows UA;
 * - custom  -> the string (falls back to the default when blank).
 * @param {'default' | 'chrome' | 'firefox' | 'custom'} preset
 * @param {string | null | undefined} custom
 * @param {string} electronDefaultUA
 * @returns {string}
 */
export function userAgentFor(preset, custom, electronDefaultUA) {
  switch (preset) {
    case 'chrome':
      return stripElectronTokens(electronDefaultUA);
    case 'firefox':
      return FIREFOX_UA;
    case 'custom':
      return typeof custom === 'string' && custom.trim() !== '' ? custom.trim() : electronDefaultUA;
    default:
      return electronDefaultUA;
  }
}
