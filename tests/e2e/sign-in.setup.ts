import { expect, test as setup } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_ROOT } from './server-mode';

/**
 * Before any test, when the games are played on the server (`server-mode.ts`): the server up - it builds and
 * starts with the tests' server, which takes a minute or two the first time - the last run's accounts and
 * saves gone, and an account made and signed in to, as each test's will be (`fixtures.ts`).
 */
setup('the server the games are played on is up, and takes an account', async ({ request, baseURL }) => {
  setup.setTimeout(600_000);
  // Nobody signed in yet, the server up: 401. A 404 or a refused connection is the server still coming.
  await expect.poll(async () => (await request.get('/__accounts/me').catch(() => null))?.status() ?? 0, { timeout: 590_000, intervals: [1000] }).toBe(401);
  // The last run's accounts, sessions and saves gone; the server reads them afresh on every request.
  rmSync(join(SERVER_ROOT, 'data'), { recursive: true, force: true });
  const made = await request.post('/__accounts/register', {
    headers: { 'x-tactical-save': '1', origin: baseURL! },
    data: { name: 'tester', password: 'played-on-the-server' },
  });
  expect(made.status(), await made.text()).toBe(200);
  expect((await (await request.get('/__accounts/me')).json()).id).toBe('tester');
});
