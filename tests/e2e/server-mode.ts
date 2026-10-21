/**
 * The suite with its games played on a Rust server of its own (`npm run test:e2e:server`, `docs/SERVER.md`):
 * the tests' server starts one over a scratch folder, the page plays the engine built to WebAssembly with its
 * own game beside it as the shadow, and every intent goes up the wire to the server's game, which is the
 * one that counts. Read by `playwright.config.ts` and by the specs that hold the run to it.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/** Whether this run plays its games on the server. */
export const ON_SERVER = process.env['TACTICAL_E2E_SERVER'] === '1';
/** The server's scratch folder: its accounts, sessions and saves, never the repository's `data/`. */
export const SERVER_ROOT = join(tmpdir(), 'tactical-e2e-server');
/** The port it answers on, apart from a dev server's own (8430). */
export const SERVER_PORT = 8431;

/**
 * A page reloaded in the middle of a game, which had travelled from `from` to `to` carrying `carried`. Played the
 * ordinary way it opens a fresh game: back where the game begins, carrying nothing. Played on the server it comes
 * back to the game the server kept - still in `to`, still carrying - and is walked back to `from`, so whatever the
 * test does next (a load, say) has somewhere to bring the party back from.
 */
export async function reloadedFrom(page: Page, to: string, before: { vault: string; carried: unknown }): Promise<void> {
  const fresh = await page.evaluate(() => ({ scene: window.__engine!.sceneId(), carried: window.__engine!.carried() }));
  if (!ON_SERVER) {
    expect(fresh.scene).not.toBe(to);
    expect(fresh.carried).toEqual([]);
    return;
  }
  expect(fresh.scene).toBe(to);
  expect(fresh.carried).toEqual(before.carried);
  expect(await page.evaluate((vault: string) => window.__engine!.travelTo(vault), before.vault)).toBe(true);
  expect(await page.evaluate(() => window.__engine!.sceneId())).toBe(before.vault);
}
