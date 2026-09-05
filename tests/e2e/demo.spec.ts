import { test, expect, type Page } from '@playwright/test';

/**
 * The demo page, driven end to end in a real browser.
 *
 * This is also the project's WebGL canary — it keeps the original spike's checks
 * (WebGL2 available, pixels actually non-uniform, no console errors) and adds what
 * the spike could not: that engine state and what is on screen stay in step while
 * someone plays.
 */

declare global {
  interface Window {
    __polyheart?: {
      webgl2: boolean;
      frames: number;
      errors: string[];
      tiles: number;
      entities: number;
      decos: number;
      missingModels: () => string[];
      party: () => string[];
      selected: () => string | null;
      select: (id: string) => boolean;
      selectNext: () => string | null;
      tileOf: (id: string) => number;
      inCombat: () => boolean;
      round: () => number;
      adversaries: () => string[];
      hitPoints: (id: string) => { marked: number; max: number };
      moveTo: (tile: number) => boolean;
      attack: (id: string) => boolean;
      endGmTurn: () => number;
      highlighted: () => number;
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
      decos: api.decos,
      missingModels: api.missingModels(),
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
  expect(info.entities).toBeGreaterThan(3);
  // Every deco got a model, and none fell back to the placeholder.
  expect(info.decos).toBe(19);
  expect(info.missingModels).toEqual([]);

  // Something was actually drawn: the frame is not one flat colour.
  expect(new Set(info.samples.map((s) => s.join(','))).size).toBeGreaterThan(1);
});

test('selects between party members and moves the one in control', async ({ page }) => {
  const consoleErrors = await boot(page);

  const result = await page.evaluate(() => {
    const api = window.__polyheart!;
    const party = api.party();
    const first = api.selected();

    // Cycling moves control to someone else.
    const next = api.selectNext();
    const before = api.tileOf(next!);

    // Walking the newly selected member moves *them*.
    const destination = api.reachable().filter((t) => t !== before).pop()!;
    const moved = api.moveTo(destination);

    return {
      party,
      first,
      next,
      moved,
      after: api.tileOf(next!),
      destination,
      othersMoved: party.filter((id) => id !== next).map((id) => api.tileOf(id)),
      highlighted: api.highlighted(),
      reachable: api.reachable().length,
    };
  });

  expect(result.party.length).toBeGreaterThan(1);
  expect(result.next).not.toBe(result.first);
  expect(result.moved).toBe(true);
  expect(result.after).toBe(result.destination);
  // Out of combat the rest of the party follows, so nobody is left behind.
  expect(new Set(result.othersMoved).size).toBe(result.othersMoved.length);
  // The preview follows the selection rather than going stale.
  expect(result.highlighted).toBe(result.reachable);

  expect(consoleErrors).toEqual([]);
});

test('walks into the vault, fights, and hands the spotlight back and forth', async ({ page }) => {
  const consoleErrors = await boot(page);

  const fight = await page.evaluate(() => {
    const api = window.__polyheart!;

    // Walk east until the trigger starts the encounter.
    for (let i = 0; i < 15 && !api.inCombat(); i++) {
      const tiles = api.reachable();
      if (tiles.length === 0) break;
      // The vault is east, so head for the highest column reachable.
      const east = tiles.reduce((a, b) => (b % 22 > a % 22 ? b : a));
      if (!api.moveTo(east)) break;
    }
    if (!api.inCombat()) return { started: false };

    const foe = api.adversaries()[0]!;
    const before = api.hitPoints(foe);
    let attacks = 0;
    let gmTurns = 0;

    for (let i = 0; i < 40; i++) {
      if (!api.inCombat()) break;
      // Close on the target, then swing.
      const tiles = api.reachable();
      const foeTile = api.tileOf(foe);
      if (tiles.length > 0) {
        const closest = tiles.reduce((a, b) => {
          const d = (t: number) => Math.abs((t % 22) - (foeTile % 22)) + Math.abs(Math.floor(t / 22) - Math.floor(foeTile / 22));
          return d(b) < d(a) ? b : a;
        });
        api.moveTo(closest);
      }
      if (api.attack(foe)) attacks++;
      const acted = api.endGmTurn();
      if (acted > 0) gmTurns++;
    }

    return {
      started: true,
      attacks,
      gmTurns,
      round: api.round(),
      damageDone: api.hitPoints(foe).marked - before.marked,
      partyHurt: api.party().reduce((n, id) => n + api.hitPoints(id).marked, 0),
    };
  });

  expect(fight.started).toBe(true);
  // The party actually connected, and the GM actually answered.
  expect(fight.attacks!).toBeGreaterThan(0);
  expect(fight.gmTurns!).toBeGreaterThan(0);
  expect(fight.round!).toBeGreaterThan(1);
  expect(fight.damageDone! + fight.partyHurt!).toBeGreaterThan(0);

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
    const selected = api.selected()!;
    const before = api.tileOf(selected);
    return { unreachable, ok: api.moveTo(unreachable), before, after: api.tileOf(selected) };
  });

  expect(result.unreachable).toBeGreaterThanOrEqual(0);
  expect(result.ok).toBe(false);
  expect(result.after).toBe(result.before);
});
