// @ts-check
// Worker entry point. `run_worker_first = ["/api/*"]` sends only API calls here; everything else is
// served from the static assets binding. Access has already gated the whole Worker at the edge.

import { handle } from './api.js';

export default {
  /**
   * @param {Request} request
   * @param {import('./api.js').Env & {ASSETS?: {fetch: (r: Request) => Promise<Response>}}} env
   * @param {{access?: import('./auth.js').AccessBinding} | undefined} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handle(request, env, { now: Date.now(), fetch: (input, init) => fetch(input, init), access: ctx?.access });
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
