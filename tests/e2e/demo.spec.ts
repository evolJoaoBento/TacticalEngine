import { test, expect, type Page } from '@playwright/test';

/**
 * The demo page, driven end to end in a real browser.
 *
 * This is also the project's WebGL canary — it keeps the original spike's checks
 * (WebGL2 available, pixels actually non-uniform, no console errors) and adds the
 * thing the spike could not: that engine state and what is on screen stay in step
 * when the player does something.
 */

declare global {
  interface Window {
    __polyheart?: {
      webgl2: boolean;
      frames: number;
      errors: string[];
      tiles: number;
      entities: number;
      leaderTile: () => number;
      highlighted: () => number;
      moveTo: (tile: number) => boolean;
      reachable: () => number[];
      sample: (x: number, y: number) => number[];
    };
  }
}

async function boot(page: Page): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  return consoleErrors;
}

test('renders the imported demo vault under headless WebGL, with no errors', async ({ page }) => {
  const consoleErrors = await boot(page);

  const info = await page.evaluate(() => {
    const api = window.__polyheart!;
    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    return {
      webgl2: api.webgl2,
      errors: api.errors,
      tiles: api.tiles,
      entities: api.entities,
      samples: [
        api.sample(2, 2),
        api.sample(canvas.width >> 1, canvas.height >> 1),
        api.sample(canvas.width >> 2, canvas.height >> 1),
        api.sample(canvas.width - 3, canvas.height - 3),
      ],
    };
  });

  expect(info.webgl2).toBe(true);
  expect(info.errors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  // The demo map is the legacy 22x16 vault, with a party and its adversaries.
  expect(info.tiles).toBe(22 * 16);
  expect(info.entities).toBeGreaterThan(2);

  // Something was actually drawn: the frame is not one flat colour.
  const distinct = new Set(info.samples.map((s) => s.join(',')));
  expect(distinct.size).toBeGreaterThan(1);
});

test('previews where the leader can walk, and walks there on a click', async ({ page }) => {
  const consoleErrors = await boot(page);

  const before = await page.evaluate(() => {
    const api = window.__polyheart!;
    return {
      tile: api.leaderTile(),
      highlighted: api.highlighted(),
      reachable: api.reachable(),
    };
  });

  // The movement preview is painted, and it is a real subset of the map.
  expect(before.highlighted).toBeGreaterThan(1);
  expect(before.highlighted).toBe(before.reachable.length);
  expect(before.highlighted).toBeLessThan(22 * 16);
  expect(before.reachable).toContain(before.tile);

  // Walk to the furthest tile still in reach.
  const moved = await page.evaluate((current: number) => {
    const api = window.__polyheart!;
    const destination = api.reachable().filter((t) => t !== current).pop()!;
    return { ok: api.moveTo(destination), destination, after: api.leaderTile() };
  }, before.tile);

  expect(moved.ok).toBe(true);
  expect(moved.after).toBe(moved.destination);
  expect(moved.after).not.toBe(before.tile);

  // The preview follows the leader rather than going stale.
  const after = await page.evaluate(() => {
    const api = window.__polyheart!;
    return { highlighted: api.highlighted(), reachable: api.reachable() };
  });
  expect(after.reachable).toContain(moved.after);
  expect(after.highlighted).toBe(after.reachable.length);
  expect(after.reachable).not.toEqual(before.reachable);

  expect(consoleErrors).toEqual([]);
});

test('refuses a move to a tile that is out of reach', async ({ page }) => {
  await boot(page);

  const result = await page.evaluate(() => {
    const api = window.__polyheart!;
    const reachable = new Set(api.reachable());
    let unreachable = -1;
    for (let tile = 0; tile < api.tiles; tile++) {
      if (!reachable.has(tile)) {
        unreachable = tile;
        break;
      }
    }
    const before = api.leaderTile();
    return { unreachable, ok: api.moveTo(unreachable), before, after: api.leaderTile() };
  });

  expect(result.unreachable).toBeGreaterThanOrEqual(0);
  expect(result.ok).toBe(false);
  expect(result.after).toBe(result.before);
});
