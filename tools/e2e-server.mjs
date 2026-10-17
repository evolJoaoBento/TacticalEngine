/**
 * The e2e suite with its games played on a Rust server of its own (`tests/e2e/server-mode.ts`):
 *
 *   npm run test:e2e:server [-- <playwright arguments>]
 *
 * The same as `npm run test:e2e` with `TACTICAL_E2E_SERVER=1` set - which a script cannot set itself on every
 * shell this repository is run from - and whatever else is given passed through to Playwright.
 */

import { spawnSync } from 'node:child_process';

const run = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, TACTICAL_E2E_SERVER: '1' },
});
process.exit(run.status ?? 1);
