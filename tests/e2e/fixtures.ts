/**
 * Playwright, as the specs use it - and, when the games are played on the server (`server-mode.ts`), each
 * test's browser signed in to an account of its own before its page loads: its own game on the server, its
 * own saves there, as each test's browser has storage of its own when they are kept in the browser. Played the
 * ordinary way, this is Playwright and nothing else.
 */

import { test as base } from '@playwright/test';
import { ON_SERVER } from './server-mode';

export * from '@playwright/test';

/** Accounts made by this run, one a test: a name of the run's own and a count. */
const RUN = Date.now().toString(36).slice(-5);
let made = 0;

export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    if (ON_SERVER) {
      const made_ = await context.request.post('/__accounts/register', {
        headers: { 'x-tactical-save': '1', origin: baseURL! },
        data: { name: `t${RUN}${(made++).toString(36)}`, password: 'played-on-the-server' },
      });
      if (made_.status() !== 200) throw new Error(`no account for this test: ${made_.status()} ${await made_.text()}`);
    }
    await use(context);
  },
});
