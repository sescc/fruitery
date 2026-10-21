// @ts-check
// Test helper: loads the pure PWA modules (apps/web/public/view.js and editor-model.js) with their
// `./core/...` imports (a build-time copy of packages/core in dist/) redirected to the real
// packages/core, so the source tree is testable without running the build.

import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const CORE_DIR = resolve(import.meta.dirname, '../../../packages/core');
const PUBLIC_URL = pathToFileURL(resolve(import.meta.dirname, '../public')).href + '/';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('./core/') && context.parentURL?.startsWith(PUBLIC_URL)) {
      return { url: pathToFileURL(resolve(CORE_DIR, specifier.slice('./core/'.length))).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

/** @type {typeof import('../public/view.js')} */
export const view = await import(`${PUBLIC_URL}view.js`);
/** @type {typeof import('../public/editor-model.js')} */
export const editorModel = await import(`${PUBLIC_URL}editor-model.js`);
