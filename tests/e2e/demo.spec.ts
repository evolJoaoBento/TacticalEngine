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
      mode: () => 'play' | 'edit';
      setMode: (mode: 'play' | 'edit') => void;
      setTool: (tool: string) => void;
      setTerrain: (id: string) => void;
      editAt: (tile: number) => boolean;
      terrainAt: (tile: number) => string;
      heightAt: (tile: number) => number;
      undo: () => boolean;
      redo: () => boolean;
      propCount: () => number;
      problems: () => number;
      exportProject: () => string;
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


test('edits the map, and undoes exactly what it did', async ({ page }) => {
  const consoleErrors = await boot(page);

  const result = await page.evaluate(() => {
    const api = window.__polyheart!;
    api.setMode('edit');

    // Paint a wall over open ground.
    const tile = 3 * 22 + 3;
    const before = api.terrainAt(tile);
    api.setTool('paintTerrain');
    api.setTerrain('wall');
    const painted = api.editAt(tile);
    const after = api.terrainAt(tile);

    // Raise the ground next to it.
    api.setTool('raise');
    const heightBefore = api.heightAt(tile + 1);
    api.editAt(tile + 1);
    const heightAfter = api.heightAt(tile + 1);

    // Drop a prop.
    api.setTool('prop');
    const propsBefore = api.propCount();
    api.editAt(tile + 2);
    const propsAfter = api.propCount();

    // Undo all three.
    api.undo();
    api.undo();
    api.undo();

    return {
      mode: api.mode(),
      painted,
      before,
      after,
      heightBefore,
      heightAfter,
      propsBefore,
      propsAfter,
      terrainRestored: api.terrainAt(tile),
      heightRestored: api.heightAt(tile + 1),
      propsRestored: api.propCount(),
    };
  });

  expect(result.mode).toBe('edit');
  expect(result.painted).toBe(true);
  expect(result.before).not.toBe('wall');
  expect(result.after).toBe('wall');
  expect(result.heightAfter).toBe(result.heightBefore + 1);
  expect(result.propsAfter).toBe(result.propsBefore + 1);

  // Undo put the document back exactly.
  expect(result.terrainRestored).toBe(result.before);
  expect(result.heightRestored).toBe(result.heightBefore);
  expect(result.propsRestored).toBe(result.propsBefore);

  expect(consoleErrors).toEqual([]);
});

test('shows the editor panel and keeps the scene renderable while editing', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await expect(page.locator('#app')).toContainText('Editor');
  await expect(page.locator('#app')).toContainText('Terrain');

  const drawn = await page.evaluate(() => {
    const api = window.__polyheart!;
    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    const middle = (): number[] => api.sample(canvas.width >> 1, canvas.height >> 1);

    // Paint a block over the middle of the map, and read the same pixel either
    // side of it. Asserting only that the frame is non-uniform passed happily
    // while the brush was writing terrain the renderer never showed, because the
    // imported per-tile tint outranked it.
    const before = middle();
    api.setTool('paintTerrain');
    api.setTerrain('wall');
    for (let y = 4; y < 12; y++) for (let x = 6; x < 16; x++) api.editAt(y * 22 + x);
    const after = middle();

    return {
      before,
      after,
      samples: [api.sample(2, 2), middle(), api.sample(canvas.width >> 2, canvas.height >> 1)],
      exported: api.exportProject().length,
    };
  });

  // The paint reached the screen, not just the document.
  expect(drawn.after).not.toEqual(drawn.before);
  expect(new Set(drawn.samples.map((s) => s.join(','))).size).toBeGreaterThan(1);
  // The edited project still serialises.
  expect(drawn.exported).toBeGreaterThan(100);
  expect(consoleErrors).toEqual([]);
});

test('returns to play with the edited map underfoot', async ({ page }) => {
  const consoleErrors = await boot(page);

  const result = await page.evaluate(() => {
    const api = window.__polyheart!;
    const selected = api.selected()!;
    const start = api.tileOf(selected);

    // Wall in the tile immediately east of the party, then play again.
    api.setMode('edit');
    api.setTool('paintTerrain');
    api.setTerrain('wall');
    api.editAt(start + 1);
    api.setMode('play');

    return {
      mode: api.mode(),
      walled: api.terrainAt(start + 1),
      canWalkIntoWall: api.reachable().includes(start + 1),
      reachable: api.reachable().length,
    };
  });

  expect(result.mode).toBe('play');
  expect(result.walled).toBe('wall');
  // The pathfinder is reading the edited terrain, not the imported terrain.
  expect(result.canWalkIntoWall).toBe(false);
  expect(result.reachable).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
});
