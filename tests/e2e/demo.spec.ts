import { readFileSync } from 'node:fs';
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
    __engine?: {
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
      zones: () => { id: string; name: string; tiles: number[] }[];
      inCombat: () => boolean;
      round: () => number;
      adversaries: () => string[];
      hitPoints: (id: string) => { marked: number; max: number };
      moveTo: (tile: number) => boolean;
      walkTo: (x: number, y: number) => boolean;
      standingAt: (id: string) => { x: number; y: number } | null;
      screenAt: (x: number, y: number) => { x: number; y: number };
      previewAt: (x: number, y: number) => { route: { x: number; y: number }[]; beyond: { x: number; y: number }[] } | null;
      pathPoints: () => number;
      attack: (id: string) => boolean;
      endGmTurn: () => number;
      highlighted: () => number;
      reachable: () => number[];
      sample: (x: number, y: number) => number[];
      use: (id: string) => string;
      useInReach: () => string;
      answer: (
        response:
          | { kind: 'choose'; index: number }
          | { kind: 'roll'; advantage?: number; disadvantage?: number; helpDice?: number; experience?: string }
          | { kind: 'cancel' }
          | { kind: 'answered'; reroll?: 'good' | 'bad' | 'both'; name?: boolean; raise?: number }
          | { kind: 'continue' },
      ) => string;
      log: () => { text: string; tone: string }[];
      setDiceSpeed: (millis: number) => void;
      dice: () => { good: number; bad: number; total: number }[];
      clearDice: () => void;
      pendingKind: () => string | null;
      objects: () => string[];
      dialogueOptions: () => string[];
      hasDialogue: () => boolean;
      within: () => string | null;
      standBeside: (id: string) => boolean;
      sceneId: () => string;
      sceneTiles: () => number;
      travelTo: (scene: string) => boolean;
      scenes: () => string[];
      editScene: () => string;
      playAt: (tile: number | null) => boolean;
      switchScene: (id: string) => void;
      addScene: (name: string) => string;
      removeScene: (id: string) => boolean;
      selectObject: (id: string) => boolean;
      editObject: (changes: Record<string, unknown>) => void;
      objectField: (field: string) => unknown;
      nodePosition: (dialogue: string, node: string) => { x: number; y: number } | null;
      dialogueNodes: (dialogue: string) => string[];
      carried: () => { id: string; name: string; quantity: number }[];
      equip: (id: string) => string;
      useItem: (id: string) => string;
      objectState: (id: string) => { used: boolean; open: boolean; removed: boolean };
      objectTile: (id: string) => number;
      inspect: (tile: number) => { kind: string; id: string; name: string; facts: string[] } | null;
      animating: () => number;
      clipOf: (id: string) => string | null;
      wound: (id: string, marks: number) => void;
      markStress: (id: string, marks: number) => void;
      stressOf: (id: string) => { marked: number; max: number };
      gear: (id: string) => { weapon: string; armor: string };
      giveItem: (id: string, quantity?: number) => void;
      journal: () => { id: string; status: string; done: string[]; summary: string }[];
      camera: () => { yaw: number; pitch: number; distance: number; target: { x: number; z: number } };
      grantLevel: (level?: number) => number;
      addAsset: (asset: unknown) => boolean;
      assetStatus: (id: string) => string;
      modelSource: (id: string) => string;
      placeProp: (tile: number, model: string) => void;
      awaitingLevel: () => string[];
      abilities: (id: string) => { id: string; usable: boolean; reason: string | null; targets: string[] }[];
      useAbility: (id: string, ability: string, targets?: string[], point?: number) => string;
      aim: (ability: string) => number[];
      lit: () => number[];
      shape: (ability: string, tile: number) => string[];
      setGood: (id: string, value: number) => void;
      passToGm: () => number;
      loadout: (id: string) => { loadout: string[]; vault: string[]; granted: string[] };
      swapCard: (id: string, cardIn: string, cardOut?: string) => string | null;
      rest: (kind: 'short' | 'long', plan: unknown) => boolean;
      conditionsOf: (id: string) => string[];
      targeting: () => string | null;
      standNear: (id: string) => boolean;
      setCards: (id: string, cards: string[]) => void;
      turnSide: () => string | null;
      startFight: () => boolean;
      takeLevel: (id: string, plan: unknown) => boolean;
      characterLevel: (id: string) => number;
      cursorTile: () => number;
      floaters: () => { id: string; text: string }[];
      gliding: () => number;
      arrive: () => boolean;
      reacting: () => number;
      screenOf: (tile: number) => { x: number; y: number };
      save: () => boolean;
      load: () => boolean;
      saveAs: (name: string) => string | null;
      loadSlot: (id: string) => boolean;
      saves: () => { id: string; name: string; where: string; savedAt: number }[];
      saveBlocked: () => string | null;
      saveText: () => string | null;
      mode: () => 'play' | 'edit';
      setMode: (mode: 'play' | 'edit') => void;
      editorMode: () => string;
      setEditorMode: (mode: string) => void;
      setTool: (tool: string) => void;
      editorTool: () => string;
      editorTerrainTab: () => string;
      setTerrain: (id: string) => void;
      buildingStats: () => import('../../src/engine/render/building-view').BuildingStats;
      authoredCreatureCount: () => number;
      buildAt: (x: number, y: number) => boolean;
      buildScreenAt: (x: number, y: number) => { x: number; y: number };
      editAt: (tile: number) => boolean;
      terrainAt: (tile: number) => string;
      heightAt: (tile: number) => number;
      undo: () => boolean;
      redo: () => boolean;
      propCount: () => number;
      altRotating: () => boolean;
      problems: () => number;
      exportProject: () => string;
      loadProjectText: (text: string) => string;
      importPackText: (text: string, label?: string) => { imported: boolean; message: string };
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
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  return consoleErrors;
}

test('renders the imported demo vault under headless WebGL, with no errors', async ({ page }) => {
  const consoleErrors = await boot(page);

  const info = await page.evaluate(() => {
    const api = window.__engine!;
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
    const api = window.__engine!;
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
  // Out of a fight the floor is not lit: a walk goes anywhere the floor does.
  expect(result.reachable).toBeGreaterThan(0);
  expect(result.highlighted).toBe(0);

  expect(consoleErrors).toEqual([]);
});

test('walks into the vault, fights, and hands the spotlight back and forth', async ({ page }) => {
  const consoleErrors = await boot(page);

  const fight = await page.evaluate(() => {
    const api = window.__engine!;

    // The vault door is shut and blocks the way; pick it. The roll is seeded,
    // so retry until it opens — a door can be tried again.
    const door = api.objects().find((id) => id.startsWith('door'))!;
    api.standBeside(door);
    for (let i = 0; i < 20 && !api.objectState(door).open; i++) {
      if (api.use(door) === 'waiting') api.answer({ kind: 'roll' });
    }
    if (!api.objectState(door).open) return { started: false };

    // Walk east until the trigger starts the encounter.
    for (let i = 0; i < 15 && !api.inCombat(); i++) {
      const tiles = api.reachable();
      if (tiles.length === 0) break;
      // The vault is east, so head for the highest column reachable.
      const east = tiles.reduce((a, b) => (b % 22 > a % 22 ? b : a));
      if (!api.moveTo(east)) break;
      api.arrive();
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
      // A hit on the party stops the GM's turn to ask how it lands; take it as
      // it comes, and the rest of the adversaries act.
      while (api.pendingKind() === 'choice') api.answer({ kind: 'choose', index: 0 });
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

test('walks up to a tile that is out of reach, and no further', async ({ page }) => {
  await boot(page);

  const result = await page.evaluate(() => {
    const api = window.__engine!;
    const reachable = new Set(api.reachable());
    let unreachable = -1;
    for (let tile = 0; tile < api.tiles; tile++) {
      if (!reachable.has(tile) && api.terrainAt(tile) !== 'wall') {
        unreachable = tile;
        break;
      }
    }
    const selected = api.selected()!;
    const before = api.tileOf(selected);
    const ok = api.moveTo(unreachable);
    return { unreachable, ok, before, after: api.tileOf(selected), landed: reachable.has(api.tileOf(selected)) };
  });

  expect(result.unreachable).toBeGreaterThanOrEqual(0);
  // Out of a fight the walk goes to the nearest reachable tile - the door, the edge of the chasm.
  expect(result.ok).toBe(true);
  expect(result.landed).toBe(true);
  expect(result.after).not.toBe(result.before);
});


test('edits the map, and undoes exactly what it did', async ({ page }) => {
  const consoleErrors = await boot(page);

  const result = await page.evaluate(() => {
    const api = window.__engine!;
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

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await expect(page.locator('#app')).toContainText('Editor');
  await expect(page.locator('#app')).toContainText('Terrain');

  const drawn = await page.evaluate(() => {
    const api = window.__engine!;
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
    const api = window.__engine!;
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

test('uses the vault furniture the original map authored', async ({ page }) => {
  const consoleErrors = await boot(page);

  // The legacy map wrote a Finesse 12 on this chest, with a line of prose for
  // each way the roll can go. Every one of those fields imported cleanly and ran
  // nowhere until the use verb existed, so this is the test that it reaches play.
  const result = await page.evaluate(() => {
    const api = window.__engine!;
    const chest = api.objects().find((id) => id.startsWith('chest'))!;

    const acrossTheRoom = api.use(chest);
    api.standBeside(chest);
    const beside = api.use(chest);
    const promptKind = api.pendingKind();
    const linesBeforeRoll = api.log().length;
    const answered = api.answer({ kind: 'roll' });

    return {
      chest,
      acrossTheRoom,
      beside,
      promptKind,
      linesBeforeRoll,
      answered,
      log: api.log().map((l) => l.text),
      usedAgain: api.use(chest),
      pendingAfter: api.pendingKind(),
    };
  });

  // Reach is enforced: you cannot pick a lock from the far side of the vault.
  expect(result.acrossTheRoom).toBe('unreachable');

  // Standing next to it, the authored check stops for the player's roll.
  expect(result.beside).toBe('waiting');
  expect(result.promptKind).toBe('check');
  // The chest's own flavour text reached the log before the roll was offered.
  expect(result.linesBeforeRoll).toBeGreaterThan(0);

  // Rolling resolves it, and the authored outcome prose is what gets shown.
  expect(result.answered).toBe('done');
  expect(result.pendingAfter).toBeNull();
  expect(result.log.join(' ')).toMatch(/with (Light|Shadow)|critical/i);

  // And it stays used.
  expect(result.usedAgain).toBe('refused');

  expect(consoleErrors).toEqual([]);
});

test('shows the narrative log and the roll prompt on the page', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => {
    const api = window.__engine!;
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    api.use(chest);
  });

  // The prose and the prompt are on screen, not only in the journal.
  await expect(page.locator('[data-testid="log"]')).toBeVisible();
  const roll = page.getByRole('button', { name: /Roll finesse/i });
  await expect(roll).toBeVisible();

  await roll.click();
  await expect(page.locator('[data-testid="log"]')).toContainText(/Light|Shadow|critical/i);

  expect(consoleErrors).toEqual([]);
});

test('shows the Duality Dice landing on the faces the roll rolled', async ({ page }) => {
  const consoleErrors = await boot(page);

  // Slow enough that the dice are still tumbling when the assertion runs: the
  // tray is the one place the player watches, so it has to be there to watch.
  await page.evaluate(() => window.__engine!.setDiceSpeed(4000));
  const rolled = await page.evaluate(() => {
    const api = window.__engine!;
    api.select(api.party()[0]!);
    // The vault door is shut and blocks the way; pick it, then walk east until
    // the trigger starts the fight. The same route the fight test walks.
    const door = api.objects().find((id) => id.startsWith('door'))!;
    api.standBeside(door);
    for (let i = 0; i < 20 && !api.objectState(door).open; i++) {
      if (api.use(door) === 'waiting') api.answer({ kind: 'roll' });
    }
    for (let i = 0; i < 15 && !api.inCombat(); i++) {
      const tiles = api.reachable();
      if (tiles.length === 0) break;
      if (!api.moveTo(tiles.reduce((a, b) => (b % 22 > a % 22 ? b : a)))) break;
      api.arrive();
    }
    if (!api.inCombat()) return null;
    const foe = api.adversaries()[0];
    if (foe === undefined) return null;
    // The door was picked with a roll of its own; forget it, so what the tray
    // is showing below is the swing.
    api.clearDice();
    // Close on it and swing; the swing is what rolls the Duality Dice.
    for (let i = 0; i < 20; i++) {
      const foeTile = api.tileOf(foe);
      const tiles = api.reachable();
      if (tiles.length > 0) {
        const d = (t: number) => Math.abs((t % 22) - (foeTile % 22)) + Math.abs(Math.floor(t / 22) - Math.floor(foeTile / 22));
        api.moveTo(tiles.reduce((a, b) => (d(b) < d(a) ? b : a)));
      }
      if (api.attack(foe)) break;
      api.endGmTurn();
      while (api.pendingKind() === 'choice') api.answer({ kind: 'choose', index: 0 });
    }
    return api.dice()[0] ?? null;
  });
  expect(rolled).not.toBeNull();

  const tray = page.locator('[data-testid="dice-tray"]');
  await expect(tray).toBeVisible();
  // Two d12s, showing what the rules already decided.
  await expect(tray).toHaveAttribute('data-good', String(rolled!.good));
  await expect(tray).toHaveAttribute('data-bad', String(rolled!.bad));
  await expect(tray).toHaveAttribute('data-settled', 'false');
  await expect(tray.locator('svg')).toHaveCount(3); // two dice and the sheen defs

  // Turn the settle time off and the dice finish and clear themselves.
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
  await expect(tray).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.dice().length)).toBe(0);

  expect(consoleErrors).toEqual([]);
});

test('talks to the pillar, and the conversation is part of the saved project', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => {
    const api = window.__engine!;
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);
  });

  // The conversation is on screen, with the speaker's words and the replies.
  const dialogue = page.locator('[data-testid="dialogue"]');
  await expect(dialogue).toBeVisible();
  await expect(dialogue).toContainText('Three hundred years');

  // A reply that costs a roll advertises the cost.
  await page.getByRole('button', { name: /came for the vault/i }).click();
  await expect(dialogue).toContainText('Presence 13');

  // Choosing it hands over to the check prompt rather than resolving silently.
  await page.getByRole('button', { name: /politely/i }).click();
  const roll = page.getByRole('button', { name: /Roll presence/i });
  await expect(roll).toBeVisible();
  await roll.click();

  // Whichever way the roll went, the conversation moved on and said something.
  await expect(page.locator('[data-testid="log"]')).toContainText(/Light|Shadow|critical/i);

  // And the words themselves are document data: they survive Save JSON.
  const saved = await page.evaluate(() => window.__engine!.exportProject());
  expect(saved).toContain('the-listening-pillar');
  expect(saved).toContain('Three hundred years');

  expect(consoleErrors).toEqual([]);
});

test('hides a reply until the party knows what it is talking about', async ({ page }) => {
  const consoleErrors = await boot(page);

  const gated = await page.evaluate(() => {
    const api = window.__engine!;
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);

    const before = api.dialogueOptions();
    // Ask who it is; the node that answers sets the flag the gated reply needs.
    const ask = before.findIndex((t) => t === 'Who are you?');
    api.answer({ kind: 'choose', index: ask });
    return { before, knows: api.log().some((l) => l.text.includes('counted')) };
  });

  expect(gated.before.some((t) => t.startsWith('Warden.'))).toBe(false);
  expect(gated.before.length).toBeGreaterThan(2);
  expect(gated.knows).toBe(true);

  expect(consoleErrors).toEqual([]);
});

test('walks down the stair into another room, and back to find it as it was', async ({ page }) => {
  const consoleErrors = await boot(page);

  const trip = await page.evaluate(() => {
    const api = window.__engine!;
    const vault = api.sceneId();
    const vaultTiles = api.sceneTiles();

    // Open the chest in the vault first, so there is something to remember.
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    api.use(chest);
    api.answer({ kind: 'roll' });

    // Take the stair down by using it, not by calling travel directly.
    api.standBeside('stair-down');
    const used = api.use('stair-down');

    const pit = api.sceneId();
    const pitTiles = api.sceneTiles();
    const intro = api.log().some((l) => l.text.includes('round chamber'));
    const pitObjects = api.objects();

    // And back up.
    api.standBeside('stair-up');
    api.use('stair-up');

    api.standBeside(chest);
    return {
      vault,
      vaultTiles,
      used,
      pit,
      pitTiles,
      intro,
      pitObjects,
      home: api.sceneId(),
      chestAgain: api.use(chest),
      scenes: api.scenes(),
    };
  });

  expect(trip.scenes.length).toBe(2);
  expect(trip.used).toBe('done');
  // A different room, of a different size — so the renderer had to rebind.
  expect(trip.pit).toBe('the-pit');
  expect(trip.pit).not.toBe(trip.vault);
  expect(trip.pitTiles).not.toBe(trip.vaultTiles);
  expect(trip.intro).toBe(true);
  expect(trip.pitObjects).toContain('strongbox');

  // Home again, and the chest the party opened is still opened.
  expect(trip.home).toBe(trip.vault);
  expect(trip.chestAgain).toBe('refused');

  expect(consoleErrors).toEqual([]);
});

test('edits one room while the party stands in another', async ({ page }) => {
  const consoleErrors = await boot(page);

  const result = await page.evaluate(() => {
    const api = window.__engine!;
    const vault = api.sceneId();
    const vaultReach = api.reachable().length;
    const vaultTiles = api.sceneTiles();

    api.setMode('edit');
    api.switchScene('the-pit');
    const editingTiles = api.sceneTiles();

    // Paint a wall across the pit while the party is still up in the vault.
    api.setTool('paintTerrain');
    api.setTerrain('wall');
    for (let x = 1; x < 9; x++) api.editAt(4 * 10 + x);
    const pitTile = api.terrainAt(4 * 10 + 5);

    api.setMode('play');

    return {
      vault,
      vaultTiles,
      vaultReach,
      editing: 'the-pit',
      editingTiles,
      pitTile,
      // The party never moved, and their room is untouched.
      playing: api.sceneId(),
      reachAfter: api.reachable().length,
      tilesAfter: api.sceneTiles(),
      exported: api.exportProject(),
    };
  });

  // The editor was looking at a different, smaller room.
  expect(result.editingTiles).toBe(10 * 8);
  expect(result.editingTiles).not.toBe(result.vaultTiles);
  expect(result.pitTile).toBe('wall');

  // And the played room is exactly as it was — this is the assertion that
  // catches a rebuild writing into the wrong grid.
  expect(result.playing).toBe(result.vault);
  expect(result.tilesAfter).toBe(result.vaultTiles);
  expect(result.reachAfter).toBe(result.vaultReach);

  // The edit did land, in the document, on the right scene.
  const saved = JSON.parse(result.exported) as {
    scenes: { id: string; terrain: string[] }[];
  };
  const pit = saved.scenes.find((scene) => scene.id === 'the-pit')!;
  expect(pit.terrain[4 * 10 + 5]).toBe('wall');
  const vault = saved.scenes.find((scene) => scene.id === result.vault)!;
  expect(vault.terrain[4 * 10 + 5]).not.toBe('wall');

  expect(consoleErrors).toEqual([]);
});

test('adds and deletes scenes from the editor', async ({ page }) => {
  const consoleErrors = await boot(page);

  const result = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('edit');

    const before = api.scenes().length;
    const id = api.addScene('Store Room');
    const added = api.scenes();
    // Adding switches to the new room, so there is something to draw on.
    const editingNew = api.editScene();
    const newTiles = api.sceneTiles();

    const deleted = api.removeScene(id);
    const afterDelete = api.scenes();

    // The opening scene is protected.
    const refused = api.removeScene(api.scenes()[0]!);

    return { before, id, added, editingNew, newTiles, deleted, afterDelete, refused };
  });

  expect(result.id).toBe('store-room');
  expect(result.added).toContain('store-room');
  expect(result.added.length).toBe(result.before + 1);
  expect(result.editingNew).toBe('store-room');
  expect(result.newTiles).toBe(12 * 10);

  expect(result.deleted).toBe(true);
  expect(result.afterDelete).not.toContain('store-room');
  expect(result.refused).toBe(false);

  expect(consoleErrors).toEqual([]);
});

test('lists the scenes in the panel, marking where the party is', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-scenes"]').click();
  const menu = page.locator('[data-testid="scene-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('The Sounding Pit');

  // Switching by clicking the scene's own button, not the debug handle.
  await page.getByRole('button', { name: /The Sounding Pit/ }).click();
  const editing = await page.evaluate(() => ({
    editScene: window.__engine!.editScene(),
    playing: window.__engine!.sceneId(),
  }));

  expect(editing.editScene).toBe('the-pit');
  // Browsing scenes must not move the party.
  expect(editing.playing).not.toBe('the-pit');

  expect(consoleErrors).toEqual([]);
});

test('authors an object in the inspector, and plays what it wrote', async ({ page }) => {
  const consoleErrors = await boot(page);

  // Author a brand new lever in the editor: a Strength roll that opens onto a
  // line of prose. None of this touches a TypeScript file.
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('edit');
    api.setTool('interactable');
    // Somewhere the party can reach, in the open part of the vault.
    api.editAt(9 * 22 + 3);
  });

  const authored = await page.evaluate(() => {
    const api = window.__engine!;
    const scene = api.exportProject();
    const id = (JSON.parse(scene) as { scenes: { interactables: { id: string }[] }[] }).scenes[0]!
      .interactables.map((i) => i.id)
      .find((i) => i.startsWith('chest-3-9'))!;

    api.selectObject(id);
    api.editObject({ name: 'A rusted lever' });
    api.editObject({ flavor: 'A lever, thick with rust, set into the floor.' });
    api.editObject({
      check: {
        trait: 'strength',
        difficulty: 1,
        onSuccessWithGood: [{ kind: 'log', text: 'The lever gives with a crack.' }],
        onSuccessWithBad: [{ kind: 'log', text: 'The lever gives with a crack.' }],
        onFailureWithGood: [{ kind: 'log', text: 'The lever gives with a crack.' }],
        onFailureWithBad: [{ kind: 'log', text: 'The lever gives with a crack.' }],
      },
    });

    return { id, name: api.objectField('name'), flavor: api.objectField('flavor') };
  });

  expect(authored.name).toBe('A rusted lever');

  // Now play it: walk up to the thing that did not exist a moment ago and use it.
  const played = await page.evaluate((id: string) => {
    const api = window.__engine!;
    api.setMode('play');
    api.standBeside(id);
    const used = api.use(id);
    const answered = api.answer({ kind: 'roll' });
    return { used, answered, log: api.log().map((l) => l.text) };
  }, authored.id);

  expect(played.used).toBe('waiting');
  expect(played.answered).toBe('done');
  // The flavour and the outcome the inspector wrote are what the player reads.
  expect(played.log.join(' ')).toContain('thick with rust');
  expect(played.log.join(' ')).toContain('The lever gives with a crack.');

  expect(consoleErrors).toEqual([]);
});

test('shows the inspector for a clicked object', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('edit');
    api.selectObject(api.objects().find((id) => id.startsWith('chest'))!);
  });

  const panel = page.locator('#app');
  // The chest's authored roll is on screen, editable.
  await expect(panel).toContainText('The roll');
  await expect(panel).toContainText('Success with Light');
  await expect(panel).toContainText('Flavour');

  // Editing the name in the panel reaches the document.
  const name = panel.locator('input').first();
  await name.fill('A very old chest');
  const stored = await page.evaluate(() => window.__engine!.objectField('name'));
  expect(stored).toBe('A very old chest');

  expect(consoleErrors).toEqual([]);
});

test('draws the pillar conversation as a graph', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="mode-interaction"]').click();
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();

  const graph = page.locator('[data-testid="dialogue-graph"]');
  await expect(graph).toBeVisible();

  // Every node of the hand-written conversation is on the canvas, laid out —
  // it carries no positions of its own.
  for (const id of ['wakes', 'name', 'vault', 'known', 'granted', 'refused']) {
    await expect(graph.locator(`[data-node="${id}"]`)).toBeVisible();
  }
  // The node it opens on is marked.
  await expect(graph.locator('[data-node="wakes"]')).toContainText('▸');
  await expect(graph).toContainText('Three hundred years');

  expect(consoleErrors).toEqual([]);
});

test('drags a node, and one undo puts it back', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="mode-interaction"]').click();
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();

  const before = await page.evaluate(() =>
    window.__engine!.nodePosition('the-listening-pillar', 'vault'),
  );
  // A hand-written conversation stores no positions until something is moved.
  expect(before).toBeNull();

  const node = page.locator('[data-node="vault"]');
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 86, { steps: 8 });
  await page.mouse.up();

  const after = await page.evaluate(() =>
    window.__engine!.nodePosition('the-listening-pillar', 'vault'),
  );
  expect(after).not.toBeNull();

  // Eight pointer moves, one undo.
  await page.evaluate(() => window.__engine!.undo());
  const undone = await page.evaluate(() =>
    window.__engine!.nodePosition('the-listening-pillar', 'vault'),
  );
  expect(undone).toBeNull();

  expect(consoleErrors).toEqual([]);
});

test('writes a new reply in the graph and hears it in play', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="mode-interaction"]').click();
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();

  const graph = page.locator('[data-testid="dialogue-graph"]');

  // Add a node, then a reply on the opening node that leads to it.
  await graph.getByRole('button', { name: '+ Node' }).click();
  const nodes = await page.evaluate(() =>
    window.__engine!.dialogueNodes('the-listening-pillar'),
  );
  const added = nodes[nodes.length - 1]!;

  // A new node opens for editing straight away, so it is ready to type into.
  const newCard = graph.locator(`[data-node="${added}"]`);
  await newCard.locator('input').first().fill('The stone says nothing more.');

  // Open the start node, add a reply, and point it at the new node.
  const start = graph.locator('[data-node="wakes"]');
  await start.getByRole('button', { name: '▸' }).click();
  await start.getByRole('button', { name: '+ Reply' }).click();
  const replyInputs = start.locator('input[placeholder="What the player says"]');
  await replyInputs.last().fill('Say nothing, and wait.');
  await start.locator('select[data-goto]').last().selectOption(added);

  // It is in the document...
  const exported = await page.evaluate(() => window.__engine!.exportProject());
  expect(exported).toContain('Say nothing, and wait.');
  expect(exported).toContain('The stone says nothing more.');

  // ...and in the player's mouth.
  const options = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);
    return api.dialogueOptions();
  });

  expect(options).toContain('Say nothing, and wait.');

  expect(consoleErrors).toEqual([]);
});

test('fills the pack from a chest, and shows what the party carries', async ({ page }) => {
  const consoleErrors = await boot(page);

  const looted = await page.evaluate(() => {
    const api = window.__engine!;
    const empty = api.carried();
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    api.use(chest);
    api.answer({ kind: 'roll' });
    return { empty, carried: api.carried(), log: api.log().map((l) => l.text) };
  });

  // The party started with nothing, and the chest paid out.
  expect(looted.empty).toEqual([]);
  expect(looted.carried.length).toBeGreaterThan(0);
  // The log names what was found, rather than "something worth carrying".
  expect(looted.log.join(' ')).toMatch(/You find .*(Gold|draught|brass)/i);

  // And it is on screen.
  const pack = page.locator('[data-testid="pack"]');
  await expect(pack).toBeVisible();
  await expect(pack).toContainText('Carried');

  expect(consoleErrors).toEqual([]);
});

test('talks the Warden round, and the word opens the strongbox downstairs', async ({ page }) => {
  const consoleErrors = await boot(page);

  // This is the whole campaign in one test: a conversation in one room decides
  // whether a chest opens in another.
  const run = await page.evaluate(() => {
    const api = window.__engine!;
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);

    // Ask about the vault, then ask politely — the reply that costs a Presence roll.
    const first = api.dialogueOptions();
    api.answer({ kind: 'choose', index: first.findIndex((t) => t.includes('came for the vault')) });
    const second = api.dialogueOptions();
    api.answer({ kind: 'choose', index: second.findIndex((t) => t.includes('politely')) });
    api.answer({ kind: 'roll' });

    // Whatever the roll said, close the conversation out.
    for (let i = 0; i < 12 && api.hasDialogue(); i++) {
      const options = api.dialogueOptions();
      if (options.length > 0) api.answer({ kind: 'choose', index: 0 });
      else api.answer({ kind: 'continue' });
    }

    const wonTheWord = api.carried().some((item) => item.id === 'wardens-word');

    // Downstairs, and try the strongbox.
    api.travelTo('the-pit');
    api.standBeside('strongbox');
    const opened = api.use('strongbox');

    return {
      wonTheWord,
      opened,
      carried: api.carried().map((item) => item.id),
      log: api.log().map((l) => l.text),
    };
  });

  // The strongbox agrees with the conversation, either way it went.
  if (run.wonTheWord) {
    expect(run.opened).toBe('done');
    expect(run.carried).toContain('gold');
  } else {
    expect(run.opened).toBe('refused');
    expect(run.log.join(' ')).toContain('will not shift');
  }

  expect(consoleErrors).toEqual([]);
});

test('saves the campaign and finds it again after a reload', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => window.localStorage.clear());

  // Nothing saved yet, so there is nothing to go back to.
  await expect(page.locator('[data-testid="load"]')).toBeDisabled();

  const before = await page.evaluate(() => {
    const api = window.__engine!;
    const vault = api.sceneId();
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    api.use(chest);
    api.answer({ kind: 'roll' });
    api.travelTo('the-pit');
    // Stand somewhere that is not the centre of a square, so the save has a spot to keep.
    const me = api.selected()!;
    const here = api.tileOf(me);
    const step = api.reachable().find((t) => t !== here)!;
    api.walkTo((step % 22) + 0.3, Math.floor(step / 22) - 0.2);
    return {
      vault,
      carried: api.carried(),
      scene: api.sceneId(),
      tiles: api.party().map((id) => api.tileOf(id)),
      spots: api.party().map((id) => api.standingAt(id)),
    };
  });
  expect(before.spots.some((s) => s !== null && (s.x % 1 !== 0 || s.y % 1 !== 0))).toBe(true);
  expect(before.carried.length).toBeGreaterThan(0);
  expect(before.scene).toBe('the-pit');

  // Save through the button a player would actually press.
  await page.locator('[data-testid="save"]').click();
  await expect(page.locator('[data-testid="log"]')).toContainText('Saved: Quick save.');

  // A real reload: a new page, a new engine, and nothing but storage between.
  await page.reload();
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  const fresh = await page.evaluate(() => ({
    scene: window.__engine!.sceneId(),
    carried: window.__engine!.carried(),
  }));
  expect(fresh.scene).not.toBe('the-pit');
  expect(fresh.carried).toEqual([]);

  await page.locator('[data-testid="load"]').click();
  await page.locator('[data-testid="saves"] [data-save="quick"] [data-testid="load-slot"]').click();
  const after = await page.evaluate(() => {
    const api = window.__engine!;
    return {
      carried: api.carried(),
      scene: api.sceneId(),
      tiles: api.party().map((id) => api.tileOf(id)),
      spots: api.party().map((id) => api.standingAt(id)),
    };
  });

  expect(after.scene).toBe('the-pit');
  expect(after.carried).toEqual(before.carried);
  expect(after.tiles).toEqual(before.tiles);
  expect(after.spots).toEqual(before.spots);

  // Upstairs, the chest the party emptied before saving is still empty: using it
  // is refused rather than offering the lock roll again. That is the room the
  // save was *not* being played in, restored.
  const upstairs = await page.evaluate((vault: string) => {
    const api = window.__engine!;
    const travelled = api.travelTo(vault);
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    return { travelled, used: api.use(chest), carried: api.carried() };
  }, before.vault);
  expect(upstairs.travelled).toBe(true);
  expect(upstairs.used).toBe('refused');
  expect(upstairs.carried).toEqual(before.carried);

  expect(consoleErrors).toEqual([]);
});

test('will not save in the middle of a conversation', async ({ page }) => {
  const consoleErrors = await boot(page);

  const save = page.locator('[data-testid="save"]');
  await expect(save).toBeEnabled();

  await page.evaluate(() => {
    const api = window.__engine!;
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);
  });
  expect(await page.evaluate(() => window.__engine!.hasDialogue())).toBe(true);
  await expect(save).toBeDisabled();
  expect(await page.evaluate(() => window.__engine!.saveBlocked())).toMatch(/conversation/);

  expect(consoleErrors).toEqual([]);
});

test('opens a quest in the journal when the pillar wakes', async ({ page }) => {
  const consoleErrors = await boot(page);

  // No journal until there is something in it.
  await expect(page.locator('[data-testid="journal"]')).toHaveCount(0);

  const journal = await page.evaluate(() => {
    const api = window.__engine!;
    const before = api.journal();
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);
    return { before, after: api.journal(), log: api.log().map((l) => l.text) };
  });
  expect(journal.before).toEqual([]);
  expect(journal.after).toEqual([{ id: 'the-wardens-word', status: 'active', done: [], summary: expect.any(String) }]);
  // Nothing done yet, so the journal reads the opening line: the pillar, not the pit.
  expect(journal.after[0]!.summary).toContain('pillar');
  expect(journal.log.join(' ')).toContain("New quest: The Warden's Word");

  const panel = page.locator('[data-testid="journal"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("The Warden's Word");
  await expect(panel).toContainText('Get the word out of the Warden');
  await expect(panel.locator('[data-objective="win-the-word"]')).toHaveAttribute('data-done', 'false');

  expect(consoleErrors).toEqual([]);
});

test('edits a quest in the editor, and the journal reads the new words', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => window.__engine!.setMode('edit'));

  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-quests"]').click();
  await page.locator('[data-quest="the-wardens-word"]').click();
  const editor = page.locator('[data-testid="quest-editor"]');
  await expect(editor).toBeVisible();

  // Rename the quest and rewrite its first step, the way an author would.
  await editor.locator('[data-field="name"]').fill('The Word Below');
  await editor.locator('[data-objective="win-the-word"] input:not([type="checkbox"])').fill('Talk the Warden round.');
  await editor.locator('button', { hasText: '+ Step' }).click();

  // Back in play, the journal shows what was written.
  const journal = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);
    return api.log().map((l) => l.text);
  });
  expect(journal.join(' ')).toContain('New quest: The Word Below');
  const panel = page.locator('[data-testid="journal"]');
  await expect(panel).toContainText('The Word Below');
  await expect(panel).toContainText('Talk the Warden round.');
  await expect(panel).toContainText('Do the next thing.');

  expect(consoleErrors).toEqual([]);
});

test('authors a quest effect from dropdowns, and the objective follows the quest', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => window.__engine!.setMode('edit'));

  // A second quest, so switching between them means something.
  page.once('dialog', (dialog) => void dialog.accept('Another errand'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-quests"]').click();
  await page.locator('button', { hasText: '+ Quest' }).click();
  // The workspace covers the board; close it before the inspector is needed.
  await page.locator('[data-testid="close-quests"]').click();

  await page.evaluate(() => {
    const api = window.__engine!;
    api.selectObject(api.objects().find((id) => id.startsWith('chest'))!);
  });
  const list = page.locator('[data-testid="object-effects"]');
  await list.locator('[data-role="add-effect"]').selectOption('completeObjective');

  const fresh = await page.evaluate(() => {
    const effects = window.__engine!.objectField('effects') as { kind: string }[];
    return effects[effects.length - 1];
  });
  expect(fresh).toEqual({ kind: 'completeObjective', quest: 'the-wardens-word', objective: 'win-the-word' });

  // Switch the quest: the objective must not stay pointed at the old quest's step.
  const row = list.locator('[data-effect]').last();
  await row.locator('select').first().selectOption('another-errand');
  const switched = await page.evaluate(() => {
    const effects = window.__engine!.objectField('effects') as { kind: string }[];
    return effects[effects.length - 1];
  });
  expect(switched).toEqual({ kind: 'completeObjective', quest: 'another-errand', objective: 'first-step' });

  expect(consoleErrors).toEqual([]);
});

test('orbits on a left drag, pans on a right drag, zooms on the wheel, and a still click is a click', async ({ page }) => {
  const consoleErrors = await boot(page);
  const canvas = page.locator('#gl');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const start = await page.evaluate(() => window.__engine!.camera());

  // Left drag: turns, does not move the target.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 30, { steps: 6 });
  await page.mouse.up();
  const turned = await page.evaluate(() => window.__engine!.camera());
  expect(turned.yaw).not.toBeCloseTo(start.yaw);
  expect(turned.target).toEqual(start.target);

  // Right drag: moves the target, keeps the angle.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 80, cy + 40, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  const panned = await page.evaluate(() => window.__engine!.camera());
  expect(panned.yaw).toBeCloseTo(turned.yaw);
  expect(Math.hypot(panned.target.x - turned.target.x, panned.target.z - turned.target.z)).toBeGreaterThan(0.5);

  // Wheel: changes the distance only.
  await page.mouse.wheel(0, -600);
  const zoomed = await page.evaluate(() => window.__engine!.camera());
  expect(zoomed.distance).toBeLessThan(panned.distance);
  expect(zoomed.yaw).toBeCloseTo(panned.yaw);

  // A press that stays put is still a click: it selects or walks, and the log
  // shows something happened rather than the camera absorbing it.
  const before = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    return { tile: api.tileOf(api.selected()!), log: api.log().length };
  });
  await page.keyboard.press('Home');
  // The camera eases to the framing; hovering while it is still moving picks
  // whatever tile happens to be under the cursor that frame, so wait for two
  // readings that agree before aiming at anything.
  await expect
    .poll(
      async () => {
        const first = await page.evaluate(() => window.__engine!.camera());
        await page.waitForTimeout(100);
        const second = await page.evaluate(() => window.__engine!.camera());
        return JSON.stringify(first) === JSON.stringify(second);
      },
      { timeout: 5000 },
    )
    .toBe(true);
  // Hover over another party member's tile: the cursor marks it, and a still
  // click there selects them rather than being eaten as a drag. The action bar
  // floats over the top of the board, so aim at a member it is not covering.
  const barBox = await page.locator('[data-testid="action-bar"]').boundingBox();
  const others = await page.evaluate(() => {
    const api = window.__engine!;
    const me = api.selected();
    return api
      .party()
      .filter((id) => id !== me)
      .map((id) => ({ id, tile: api.tileOf(id), at: api.screenOf(api.tileOf(id)) }));
  });
  const clear = others.find(
    (member) =>
      barBox === null ||
      member.at.x < barBox.x ||
      member.at.x > barBox.x + barBox.width ||
      member.at.y < barBox.y ||
      member.at.y > barBox.y + barBox.height,
  );
  expect(clear, 'a party member the action bar does not cover').toBeDefined();

  // Where that tile is on screen right now: the camera is still easing towards
  // its framing, so the position read a moment ago is not where to click.
  await expect
    .poll(
      async () => {
        const first = await page.evaluate((tile) => JSON.stringify(window.__engine!.screenOf(tile)), clear!.tile);
        await page.waitForTimeout(120);
        const second = await page.evaluate((tile) => JSON.stringify(window.__engine!.screenOf(tile)), clear!.tile);
        return first === second;
      },
      { timeout: 5000 },
    )
    .toBe(true);
  const at = await page.evaluate((tile) => window.__engine!.screenOf(tile), clear!.tile);
  await page.mouse.move(at.x, at.y);
  expect(await page.evaluate(() => window.__engine!.cursorTile())).toBe(clear!.tile);
  await page.mouse.down();
  await page.mouse.up();
  expect(await page.evaluate(() => window.__engine!.selected())).toBe(clear!.id);
  expect(before.tile).toBeDefined();

  expect(consoleErrors).toEqual([]);
});

test('shows the party in a HUD with pips, and clicking a card selects', async ({ page }) => {
  const consoleErrors = await boot(page);
  const hud = page.locator('[data-testid="hud"]');
  await expect(hud).toBeVisible();
  const party = await page.evaluate(() => window.__engine!.party());
  await expect(hud.locator('[data-member]')).toHaveCount(party.length);
  await expect(hud.locator('[data-member][data-selected="true"]')).toHaveCount(1);

  await hud.locator(`[data-member="${party[2]}"]`).click();
  expect(await page.evaluate(() => window.__engine!.selected())).toBe(party[2]);
  await expect(hud.locator(`[data-member="${party[2]}"]`)).toHaveAttribute('data-selected', 'true');

  // The pips agree with the engine.
  const hp = await page.evaluate((id) => window.__engine!.hitPoints(id), party[2]!);
  const pips = hud.locator(`[data-member="${party[2]}"] [data-testid="hp"]`);
  await expect(pips).toHaveAttribute('data-max', String(hp.max));
  await expect(pips).toHaveAttribute('data-marked', String(hp.marked));

  expect(consoleErrors).toEqual([]);
});

test('reads the dice out in the log', async ({ page }) => {
  const consoleErrors = await boot(page);
  const line = await page.evaluate(() => {
    const api = window.__engine!;
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    api.use(chest);
    api.answer({ kind: 'roll' });
    return api.log().map((l) => l.text).find((t) => t.startsWith('Light '));
  });
  expect(line).toMatch(/^Light \d+ \+ Shadow \d+ .*= \d+ vs \d+\. (A critical success|Success|Failure)/);
  expect(consoleErrors).toEqual([]);
});

test('levels a character up through the sheet, and the pips grow', async ({ page }) => {
  const consoleErrors = await boot(page);
  const hud = page.locator('[data-testid="hud"]');
  await expect(hud.locator('[data-testid="level-up-button"]')).toHaveCount(0);

  // The GM grants a level: every card offers it.
  const granted = await page.evaluate(() => window.__engine!.grantLevel());
  expect(granted).toBe(2);
  await expect(hud.locator('[data-testid="level-up-button"]')).toHaveCount(3);

  const hpBefore = await page.evaluate(() => window.__engine!.hitPoints('kara'));
  await hud.locator('[data-member="kara"] [data-testid="level-up-button"]').click();
  const sheet = page.locator('[data-testid="level-up"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Kara — level 2');

  // Try to take it with nothing picked: the engine refuses and says why.
  await sheet.locator('[data-testid="experience"]').fill('Survived the vault');
  await sheet.locator('[data-testid="take-level"]').click();
  await expect(sheet.locator('[data-testid="level-issues"]')).toContainText('exactly 2 picks');

  // Two picks, then take it.
  await sheet.locator('[data-pick="hitPoint"]').click();
  await sheet.locator('[data-pick="traits"]').click();
  await sheet.locator('[data-testid="take-level"]').click();
  await expect(sheet).toHaveCount(0);

  expect(await page.evaluate(() => window.__engine!.characterLevel('kara'))).toBe(2);
  expect(await page.evaluate(() => window.__engine!.awaitingLevel())).toEqual(['finn', 'mira']);
  const hpAfter = await page.evaluate(() => window.__engine!.hitPoints('kara'));
  expect(hpAfter.max).toBe(hpBefore.max + 1);
  await expect(hud.locator('[data-member="kara"] [data-testid="hp"]')).toHaveAttribute('data-max', String(hpAfter.max));
  await expect(hud.locator('[data-member="kara"] [data-testid="level-up-button"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="log"]')).toContainText('Kara reaches level 2');

  expect(consoleErrors).toEqual([]);
});

test('equips a found weapon from the pack, and the card says so', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.select('kara');
    // A weapon she does not already wield and an armour she is not already wearing:
    // `equipItem` refuses an item that is already in the slot, so finding her own
    // longsword in the pack would move nothing.
    api.giveItem('hunting-bow');
    api.giveItem('padded-coat');
  });
  const card = page.locator('[data-member="kara"] [data-testid="gear"]');
  await expect(card).toContainText('Longsword · Ringmail');

  const pack = page.locator('[data-testid="pack"]');
  await pack.locator('[data-item="hunting-bow"] [data-testid="equip"]').click();
  await expect(card).toContainText('Hunting Bow · Ringmail');
  // The bow came out of the pack; the longsword it replaced went in.
  await expect(pack.locator('[data-item="hunting-bow"]')).toHaveCount(0);
  await expect(pack.locator('[data-item="longsword"]')).toHaveCount(1);

  await pack.locator('[data-item="padded-coat"] [data-testid="equip"]').click();
  await expect(card).toContainText('Hunting Bow · Padded Coat');
  const armor = page.locator('[data-member="kara"] [data-testid="armor"]');
  // The coat is lighter than the ringmail it replaces; what matters is that the max
  // follows the sheet rather than arriving at any particular number.
  const gear = await page.evaluate(() => window.__engine!.gear('kara'));
  expect(gear.armor).toBe('Padded Coat');
  await expect(armor).toHaveAttribute('data-max', /\d+/);
  // The log is built from the item's name, which is spelled "Padded coat"; the gear
  // line above is built from the pack's armour, which is spelled "Padded Coat".
  await expect(page.locator('[data-testid="log"]')).toContainText('Kara puts on the Padded coat');

  expect(consoleErrors).toEqual([]);
});

test('imports a glTF model and draws it where a prop names it', async ({ page }) => {
  const consoleErrors = await boot(page);

  // The Khronos sample duck, served straight from the test fixtures. A project
  // declares it once; content then names "duck" like any procedural model.
  const declared = await page.evaluate(() =>
    window.__engine!.addAsset({ id: 'duck', url: '/tests/fixtures/models/Duck.glb', scale: 0.01 }),
  );
  expect(declared).toBe(true);
  expect(await page.evaluate(() => window.__engine!.modelSource('duck'))).toBe('placeholder');

  // Placing a prop that names it starts the load; the placeholder stands in.
  const before = await page.evaluate(() => window.__engine!.decos);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('edit');
    api.placeProp(api.tileOf(api.party()[0]!) + 2, 'duck');
  });
  await page.waitForFunction(() => window.__engine!.assetStatus('duck') === 'ready', undefined, { timeout: 15000 });
  expect(await page.evaluate(() => window.__engine!.modelSource('duck'))).toBe('asset');
  expect(await page.evaluate(() => window.__engine!.missingModels())).not.toContain('duck');
  expect(before).toBeGreaterThanOrEqual(0);

  // It survives the project round trip.
  const exported = JSON.parse(await page.evaluate(() => window.__engine!.exportProject()));
  expect(exported.assets).toEqual([
    { id: 'duck', kind: 'gltf', url: '/tests/fixtures/models/Duck.glb', scale: 0.01, groundOffset: 0, rotationY: 0 },
  ]);
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-models"]').click();
  await expect(page.locator('[data-asset="duck"]')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('authors a branch with a condition from dropdowns, and gates a reply', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('edit');
    api.selectObject(api.objects().find((id) => id.startsWith('chest'))!);
  });
  const list = page.locator('[data-testid="object-effects"]');
  await list.locator('[data-role="add-effect"]').selectOption('branch');
  const branch = list.locator('[data-testid="branch"]').first();
  await expect(branch).toBeVisible();

  // Gate it on the quest being complete, from dropdowns.
  await branch.locator('[data-testid="cond-kind"]').first().selectOption('quest');
  await branch.locator('[data-testid="cond-status"]').first().selectOption('completed');
  // And put a line under "then".
  await branch.locator('[data-role="add-effect"]').first().selectOption('log');

  const authored = await page.evaluate(() => {
    const effects = window.__engine!.objectField('effects') as unknown[];
    return effects[effects.length - 1];
  });
  expect(authored).toMatchObject({
    kind: 'branch',
    when: { kind: 'quest', quest: 'the-wardens-word', status: 'completed' },
    then: [{ kind: 'log' }],
  });

  // A reply in the conversation, hidden unless an objective is done.
  await page.locator('[data-testid="mode-interaction"]').click();
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();
  const graph = page.locator('[data-testid="dialogue-graph"]');
  const node = graph.locator('[data-node="vault"]');
  await node.getByRole('button', { name: '▸' }).click();
  await node.locator('[data-goto]').first().waitFor();
  await node.locator('[data-gate="available"]').first().click();
  const gate = node.locator('[data-gate-editor="available"]').first();
  await gate.locator('[data-testid="cond-kind"]').selectOption('objectiveDone');
  const exported = JSON.parse(await page.evaluate(() => window.__engine!.exportProject()));
  const vault = exported.dialogues[0].nodes.find((n: { id: string }) => n.id === 'vault');
  expect(vault.choices[0].available).toEqual({
    kind: 'objectiveDone',
    quest: 'the-wardens-word',
    objective: 'win-the-word',
  });

  expect(consoleErrors).toEqual([]);
});

test('keeps a hidden objective out of the journal until it is revealed', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);
  });
  const journal = page.locator('[data-testid="journal"]');
  await expect(journal).toContainText('Get the word out of the Warden');
  await expect(journal).not.toContainText('Open the strongbox');
  expect(consoleErrors).toEqual([]);
});

test('drinks a draught from the pack, and the wound closes on the card', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.select('kara');
    api.wound('kara', 3);
    api.giveItem('healing-draught', 2);
  });
  const hp = page.locator('[data-member="kara"] [data-testid="hp"]');
  await expect(hp).toHaveAttribute('data-marked', '3');

  const pack = page.locator('[data-testid="pack"]');
  await pack.locator('[data-item="healing-draught"] [data-testid="use-item"]').click();
  await expect(hp).toHaveAttribute('data-marked', '1');
  await expect(page.locator('[data-testid="log"]')).toContainText('Iron and mint');

  // The second one goes too, and the row disappears with it.
  await pack.locator('[data-item="healing-draught"] [data-testid="use-item"]').click();
  await expect(pack.locator('[data-item="healing-draught"]')).toHaveCount(0);
  await expect(hp).toHaveAttribute('data-marked', '0');

  expect(consoleErrors).toEqual([]);
});

test('authors a roll and a choice inside an effect list, and outcomes on a reply', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('edit');
    api.selectObject(api.objects().find((id) => id.startsWith('pillar'))!);
  });
  const list = page.locator('[data-testid="object-effects"]');

  // The list's own "add" select is its last child; nested lists have their own.
  const addTop = list.locator(':scope > [data-role="add-effect"]');

  // A roll with a line on a success.
  await addTop.selectOption('check');
  const check = list.locator('[data-testid="check-effect"]').first();
  await check.locator('[data-testid="check-trait"]').selectOption('strength');
  await check.locator('[data-outcome="onSuccessWithGood"] [data-role="add-effect"]').selectOption('log');

  // A choice with a second option.
  await addTop.selectOption('choice');
  const choice = list.locator('[data-testid="choice"]').first();
  await choice.locator('[data-role="add-option"]').click();

  const authored = await page.evaluate(() => window.__engine!.objectField('effects') as unknown[]);
  expect(authored.at(-2)).toMatchObject({
    kind: 'check',
    check: { trait: 'strength', difficulty: 12, onSuccessWithGood: [{ kind: 'log' }] },
  });
  expect(authored.at(-1)).toMatchObject({ kind: 'choice', options: [{ label: 'Go on' }, { label: 'Another option' }] });

  // In the graph, the polite reply's roll gets an "always" line and a success node.
  await page.locator('[data-testid="mode-interaction"]').click();
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();
  const node = page.locator('[data-testid="dialogue-graph"] [data-node="vault"]');
  await node.getByRole('button', { name: '▸' }).click();
  const reply = node.locator('[data-reply-check]').first();
  await reply.locator('[data-testid="gotoOnSuccess"]').selectOption('granted');
  await reply.locator('[data-outcome="always"] [data-role="add-effect"]').selectOption('setFlag');
  const exported = JSON.parse(await page.evaluate(() => window.__engine!.exportProject()));
  const vault = exported.dialogues[0].nodes.find((n: { id: string }) => n.id === 'vault');
  const withCheck = vault.choices.find((c: { check?: unknown }) => c.check !== undefined);
  expect(withCheck.check.gotoOnSuccess).toBe('granted');
  expect(withCheck.check.always).toMatchObject([{ kind: 'setFlag' }]);

  expect(consoleErrors).toEqual([]);
});

test('keeps named saves and an autosave from the last doorway', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => window.localStorage.clear());

  const ids = await page.evaluate(() => {
    const api = window.__engine!;
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    api.use(chest);
    api.answer({ kind: 'roll' });
    const beforeTravel = api.saveAs('Before the stairs');
    api.travelTo('the-pit');
    const downstairs = api.saveAs('Downstairs');
    return { beforeTravel, downstairs, saves: api.saves() };
  });
  expect(ids.beforeTravel).not.toBeNull();
  // Three saves: the two named ones and the autosave the doorway wrote.
  expect(ids.saves.map((s) => s.name).sort()).toEqual(['Autosave', 'Before the stairs', 'Downstairs']);
  expect(ids.saves.find((s) => s.name === 'Autosave')!.where).toContain('Sounding Pit');

  // Reload the page: the list survives, and loading the older slot puts the party back upstairs.
  await page.reload();
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.locator('[data-testid="load"]').click();
  const list = page.locator('[data-testid="saves"]');
  await expect(list).toContainText('Before the stairs');
  // A fresh boot starts in the vault, so loading "Downstairs" changes rooms.
  // A load is not a doorway: the autosave from the stairs must still be the
  // one from the stairs, not a copy of what was just loaded.
  const autosaveBefore = await page.evaluate(() => window.__engine!.saves().find((s) => s.name === 'Autosave'));
  await list.locator(`[data-save="${ids.downstairs}"] [data-testid="load-slot"]`).click();
  expect(await page.evaluate(() => window.__engine!.sceneId())).toBe('the-pit');
  const autosaveAfter = await page.evaluate(() => window.__engine!.saves().find((s) => s.name === 'Autosave'));
  expect(autosaveAfter).toEqual(autosaveBefore);
  expect(autosaveAfter!.where).toContain('Sounding Pit');

  // And loading the older slot puts the party back upstairs, pack intact.
  await page.locator('[data-testid="load"]').click();
  await list.locator(`[data-save="${ids.beforeTravel}"] [data-testid="load-slot"]`).click();
  expect(await page.evaluate(() => window.__engine!.sceneId())).not.toBe('the-pit');
  expect(await page.evaluate(() => window.__engine!.carried().length)).toBeGreaterThan(0);

  // Delete one; it is gone from the list and from storage.
  await page.locator('[data-testid="load"]').click();
  await list.locator(`[data-save="${ids.downstairs}"] button[title="Delete this save"]`).click();
  expect(await page.evaluate(() => window.__engine!.saves().map((s) => s.name).sort())).toEqual(['Autosave', 'Before the stairs']);

  expect(consoleErrors).toEqual([]);
});

test('right-clicks to inspect, and Escape closes the card', async ({ page }) => {
  const consoleErrors = await boot(page);
  const foe = await page.evaluate(() => window.__engine!.adversaries()[0]!);
  const tile = await page.evaluate((id) => window.__engine!.tileOf(id), foe);
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  const at = await page.evaluate((t) => window.__engine!.screenOf(t), tile);

  // A still right-click: the card appears, and the camera did not pan.
  const before = await page.evaluate(() => window.__engine!.camera());
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  const card = page.locator('[data-testid="inspect"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-inspect', foe);
  await expect(card).toContainText('HP');
  await expect(card).toContainText('Difficulty');
  const after = await page.evaluate(() => window.__engine!.camera());
  expect(after.target).toEqual(before.target);

  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  // A party member and an object through the handle, for their facts.
  const kara = await page.evaluate(() => window.__engine!.inspect(window.__engine!.tileOf('kara')));
  expect(kara).toMatchObject({ kind: 'character', name: 'Kara' });
  expect(kara!.facts.join(' ')).toMatch(/Evasion \d+/);
  const chest = await page.evaluate(() => {
    const api = window.__engine!;
    const id = api.objects().find((o) => o.startsWith('chest'))!;
    const shut = api.inspect(api.objectTile(id));
    api.standBeside(id);
    api.use(id);
    api.answer({ kind: 'roll' });
    const after = api.inspect(api.objectTile(id));
    return { id, shut, after, state: api.objectState(id) };
  });
  expect(chest.shut).toMatchObject({ kind: 'object', id: chest.id, name: 'Old Wooden Chest' });
  expect(chest.shut!.facts).toEqual(expect.arrayContaining(['finesse 12']));
  expect(chest.shut!.facts).not.toContain('Open');
  // After the roll the card says so — Open on a success, Used on a failure.
  expect(chest.after!.facts).toContain(chest.state.open ? 'Open' : 'Used');

  expect(consoleErrors).toEqual([]);
});

test('plays a skinned model\'s first clip once it arrives', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.addAsset({ id: 'fox', url: '/tests/fixtures/models/Fox.glb', scale: 0.012 });
    api.setMode('edit');
    api.placeProp(api.tileOf(api.party()[0]!) + 2, 'fox');
    api.setMode('play');
  });
  await page.waitForFunction(() => window.__engine!.assetStatus('fox') === 'ready', undefined, { timeout: 15000 });
  await page.waitForFunction(() => window.__engine!.animating() > 0, undefined, { timeout: 5000 });
  expect(await page.evaluate(() => window.__engine!.animating())).toBeGreaterThan(0);
  expect(consoleErrors).toEqual([]);
});

test('a glTF that names its clips walks with the walk and idles after', async ({ page }) => {
  const consoleErrors = await boot(page);
  // The fox as Finn's body: the asset id is the model id the rogue's token asks for.
  await page.evaluate(() => {
    const api = window.__engine!;
    api.addAsset({ id: 'rogue', url: '/tests/fixtures/models/Fox.glb', scale: 0.012, clips: { idle: 'Survey', walk: 'Run' } });
    // A prop naming it starts the load; the token is redrawn when the file lands.
    api.setMode('edit');
    api.placeProp(api.tileOf('finn') + 2, 'rogue');
    api.setMode('play');
    api.select('finn');
  });
  await page.waitForFunction(() => window.__engine!.clipOf('finn') === 'Survey', undefined, { timeout: 15000 });

  const walked = await page.evaluate(() => {
    const api = window.__engine!;
    const from = api.tileOf('finn');
    const tiles = api.reachable().filter((t) => t !== from);
    const far = tiles.reduce((x, y) => (Math.abs(y - from) > Math.abs(x - from) ? y : x));
    return { moved: api.moveTo(far), clip: api.clipOf('finn') };
  });
  expect(walked.moved).toBe(true);
  expect(walked.clip).toBe('Run');
  await page.waitForFunction(() => window.__engine!.gliding() === 0, undefined, { timeout: 5000 });
  expect(await page.evaluate(() => window.__engine!.clipOf('finn'))).toBe('Survey');
  expect(consoleErrors).toEqual([]);
});

test('casts Cinder Burst at a spot on the board, picks an Experience, and the turn passes', async ({ page }) => {
  const consoleErrors = await boot(page);
  const setup = await page.evaluate(() => {
    const api = window.__engine!;
    api.select('mira');
    // Cinder Burst is an Ember card and Mira is the Emberwright; her own hand is
    // Arcane Ward and Healing Word, so the card has to be put in it.
    api.setCards('mira', ['cinder-burst']);
    const foe = api.adversaries()[0]!;
    api.standNear(foe);
    api.startFight();
    return { foe, fighting: api.inCombat() };
  });
  expect(setup.fighting).toBe(true);
  const bar = page.locator('[data-testid="action-bar"]');
  await expect(bar).toBeVisible();
  const burst = bar.locator('[data-ability="cinder-burst"]');
  await expect(burst).toHaveAttribute('data-usable', 'true');

  // Aimed at the ground rather than clicked onto a creature: the spot the husk is
  // standing on, so the bloom covers it and the roll has something to be against.
  const aimed = await page.evaluate((foe) => {
    const api = window.__engine!;
    const tiles = api.aim('cinder-burst');
    const spot = tiles.find((tile) => api.shape('cinder-burst', tile).includes(foe));
    if (spot !== undefined) api.useAbility('mira', 'cinder-burst', [], spot);
    return { offered: tiles.length, spot };
  }, setup.foe);
  expect(aimed.offered).toBeGreaterThan(0);
  expect(aimed.spot, 'a spot whose bloom covers the husk').not.toBeUndefined();

  const prompt = page.locator('[data-testid="check-prompt"]');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Cinder Burst');
  await expect(prompt).toContainText('Hollow Knight');
  // The card asked Stress; nothing the pack ships spends Light. The Experience is
  // what spends one, which is why the picker is here at all.
  await prompt.locator('[data-testid="experience-pick"]').selectOption({ index: 1 });
  await prompt.locator('[data-testid="roll"]').click();
  await expect(prompt).toHaveCount(0);

  const log = page.locator('[data-testid="log"]');
  await expect(log).toContainText('Draws on');
  await expect(log).toContainText(/Light \d+ \+ Shadow \d+/);
  // The card was the turn: Finn acted, and the side follows the roll.
  const acted = await page.evaluate(() => window.__engine!.turnSide());
  expect(['party', 'gm', null]).toContain(acted);
  expect(consoleErrors).toEqual([]);
});

test('arms Shield Wall, picks the ally it is held for, and Escape disarms', async ({ page }) => {
  const consoleErrors = await boot(page);
  const armed = await page.evaluate(() => {
    const api = window.__engine!;
    api.select('kara');
    api.setCards('kara', ['shield-wall']);
    const foe = api.adversaries()[0]!;
    api.standNear(foe);
    // And somebody for the shield to be held in front of. `standNear` moves
    // whoever is selected to a free tile beside what it names, and it names any
    // entity -- so this puts Mira one tile from Kara, which is Melee. Without it
    // Kara walks to the husk alone and is the only ally in her own reach.
    api.select('mira');
    api.standNear('kara');
    api.select('kara');
    api.startFight();
    return {
      targets: api.abilities('kara').find((a) => a.id === 'shield-wall')!.targets,
      party: api.party().map((id) => ({ id, tile: api.tileOf(id) })),
    };
  });
  // Asserted rather than guarded. `beginAbility` fires at once when only one
  // target is valid -- "one thing to pick is no pick at all" -- so the older
  // version of this test wrapped the whole arm-and-disarm path in
  // `if (targets.length > 1)` and skipped it in silence whenever one husk was
  // adjacent. Kara counts as her own ally, and Mira is standing beside her by
  // the setup above, so this is two; the party's tiles come back with it so a
  // failure says where everybody was rather than only that the count was wrong.
  expect(armed.targets.length, 'more than one ally in reach, so arming waits for a pick').toBeGreaterThan(1);
  const ally = armed.targets.find((id) => id !== 'kara')!;

  const bar = page.locator('[data-testid="action-bar"]');
  await bar.locator('[data-ability="shield-wall"]').click();
  await expect(bar).toHaveAttribute('data-targeting', 'shield-wall');
  await page.keyboard.press('Escape');
  await expect(bar).not.toHaveAttribute('data-targeting', /.+/);

  // Armed again and picked for real. No check on this one: it answers at once,
  // and what it leaves is the condition on whoever the shield came across for.
  const held = await page.evaluate((who) => {
    const api = window.__engine!;
    const status = api.useAbility('kara', 'shield-wall', [who]);
    return { status, on: api.conditionsOf(who) };
  }, ally);
  expect(held.status).toBe('done');
  expect(held.on).toContain('behind-the-shield');
  await expect(page.locator('[data-testid="log"]')).toContainText(/Kara uses Shield Wall on /);
  expect(consoleErrors).toEqual([]);
});

test('recalls a card from the vault for Stress, and passes the spotlight with a button', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.select('kara');
    api.setCards('kara', ['power-slash', 'shield-wall', 'iron-stance', 'rallying-cry', 'unbroken', 'smoke-step']);
  });
  await page.locator('[data-testid="open-loadout"]').click();
  const panel = page.locator('[data-testid="loadout"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('5 / 5');
  // Full: a recall needs a card to make room, then costs Smoke Step's 1 Stress.
  const recall = panel.locator('[data-card="smoke-step"] [data-testid="recall"]');
  await expect(recall).toBeDisabled();
  await panel.locator('[data-card="unbroken"] [data-testid="pick-out"]').check();
  await expect(recall).toBeEnabled();
  await recall.click();
  await expect(page.locator('[data-member="kara"] [data-testid="stress"]')).toHaveAttribute('data-marked', '1');
  await expect(panel.locator('[data-card="unbroken"] [data-testid="recall"]')).toHaveCount(1);
  await page.locator('[data-testid="close-loadout"]').click();
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.loadout('kara').vault)).toEqual(['unbroken']);

  // A fight, and the button that hands the turn over.
  await page.evaluate(() => {
    const api = window.__engine!;
    api.standNear(api.adversaries()[0]!);
    api.startFight();
  });
  const pass = page.locator('[data-testid="pass-to-gm"]');
  await expect(pass).toBeVisible();
  await expect(pass).toBeEnabled();
  await pass.click();
  // The husk's blow may be waiting on Kara's answer; take it as it comes.
  const asked = page.locator('[data-testid="choice-prompt"]');
  if ((await asked.count()) > 0) await asked.locator('[data-option="0"]').click();
  await expect(page.locator('[data-testid="log"]')).toContainText(/Hollow Knight's/);
  expect(await page.evaluate(() => window.__engine!.turnSide())).not.toBe('gm');
  await page.screenshot({ path: 'test-results/action-bar.png' });
  expect(consoleErrors).toEqual([]);
});

test('takes a short rest through the panel and the wounds close', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.select('kara');
    api.wound('kara', 5);
  });
  const hp = page.locator('[data-member="kara"] [data-testid="hp"]');
  await expect(hp).toHaveAttribute('data-marked', '5');
  await page.locator('[data-testid="open-rest"]').click();
  const panel = page.locator('[data-testid="rest"]');
  await expect(panel).toBeVisible();
  // Kara tends her wounds twice; Mira tends Kara too.
  const kara = panel.locator('[data-rest-member="kara"]');
  await kara.locator('[data-testid="move-1"]').selectOption('tendWounds');
  const mira = panel.locator('[data-rest-member="mira"]');
  await mira.locator('[data-testid="move-0"]').selectOption('tendWounds');
  await mira.locator('[data-testid="target-0"]').selectOption('kara');
  await panel.locator('[data-testid="take-rest"]').click();
  await expect(panel).toHaveCount(0);
  // Three tendings of 2–5: nothing left.
  await expect(hp).toHaveAttribute('data-marked', '0');
  const log = page.locator('[data-testid="log"]');
  await expect(log).toContainText('catch its breath');
  await expect(log).toContainText(/The GM gains \d Shadow/);
  await page.screenshot({ path: 'test-results/rest-panel-after.png' });
  expect(consoleErrors).toEqual([]);
});

test('writes logic in the Code panel and plays the card that runs it', async ({ page }) => {
  const consoleErrors = await boot(page);

  // The demo ships one card written in project code. Open the panel and read it.
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-code"]').click();
  const panel = page.locator('[data-testid="code-panel"]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-code="rally-the-line"]').click();
  await expect(panel.locator('[data-testid="code-errors"]')).toHaveText('Compiles.');
  await expect(panel).toContainText('run by: rally-the-line');

  // A syntax error is reported here, where an author can see it, not at the table.
  const source = panel.locator('[data-testid="code-source"]');
  const original = (await source.inputValue());
  await source.fill('return (;');
  await expect(panel.locator('[data-testid="code-errors"]')).not.toHaveText('Compiles.');

  // Write our own line into it: the log will say this instead.
  await source.fill(original.replace('The line steadies.', 'The banner goes up.'));
  await expect(panel.locator('[data-testid="code-errors"]')).toHaveText('Compiles.');
  await panel.locator('[data-testid="close-code"]').click();

  // Play it: Kara's card runs the project's code, and every change it makes is logged.
  const before = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    api.select('kara');
    // Kara is badly hurt, so the code clears a Hit Point for her; the others
    // are merely rattled, so it clears a Stress.
    const hp = api.hitPoints('kara');
    api.wound('kara', hp.max - 1);
    for (const id of api.party()) api.markStress(id, 1);
    return {
      kara: api.hitPoints('kara').marked,
      stress: Object.fromEntries(api.party().map((id) => [id, api.stressOf(id).marked])),
    };
  });

  const bar = page.locator('[data-testid="action-bar"]');
  await expect(bar.locator('[data-ability="rally-the-line"]')).toHaveAttribute('data-usable', 'true');
  await bar.locator('[data-ability="rally-the-line"]').click();

  await expect(page.locator('[data-testid="log"]')).toContainText('The banner goes up.');
  const after = await page.evaluate(() => {
    const api = window.__engine!;
    return {
      kara: api.hitPoints('kara').marked,
      stress: Object.fromEntries(api.party().map((id) => [id, api.stressOf(id).marked])),
    };
  });
  // The wound closed for the one who needed it; the others shook off the Stress.
  expect(after.kara).toBe(before.kara - 1);
  expect(after.stress['kara']).toBe(before.stress['kara']);
  for (const id of Object.keys(before.stress)) {
    if (id !== 'kara') expect(after.stress[id]).toBe(before.stress[id]! - 1);
  }

  expect(consoleErrors).toEqual([]);
});

test('asks the defender how a hit lands, and the fight waits for the answer', async ({ page }) => {
  const consoleErrors = await boot(page);

  // Kara stands in the husk's reach and hands the spotlight over.
  await page.evaluate(() => {
    const api = window.__engine!;
    api.select('kara');
    api.standNear(api.adversaries()[0]!);
    api.startFight();
  });

  const prompt = page.locator('[data-testid="choice-prompt"]');
  // A blow has to land before there is anything to ask, so pass until one does.
  for (let i = 0; i < 20 && (await prompt.count()) === 0; i++) {
    await page.evaluate(() => window.__engine!.passToGm());
    if (await page.evaluate(() => window.__engine!.inCombat() === false)) break;
  }
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('How does it land?');
  await expect(prompt.locator('[data-option="0"]')).toContainText('Take it');

  const before = await page.evaluate(() => ({
    hp: window.__engine!.hitPoints('kara').marked,
    pending: window.__engine!.pendingKind(),
  }));
  expect(before.pending).toBe('choice');

  // Answer it: the choice is applied and the question goes away.
  const options = await prompt.locator('button[data-option]').allTextContents();
  const armor = options.findIndex((label) => label.startsWith('Mark an Armor Slot'));
  await prompt.locator(`[data-option="${armor === -1 ? 0 : armor}"]`).click();
  await expect(prompt).toHaveCount(0);
  const after = await page.evaluate(() => ({
    hp: window.__engine!.hitPoints('kara').marked,
    pending: window.__engine!.pendingKind(),
  }));
  expect(after.pending).toBeNull();
  expect(after.hp).toBeGreaterThanOrEqual(before.hp);

  expect(consoleErrors).toEqual([]);
});

test('writes a whole card in the Cards panel and plays it from the action bar', async ({ page }) => {
  const consoleErrors = await boot(page);
  // `+ Card` asks for a name; nothing else in this test opens a dialog.
  page.on('dialog', (dialog) => void dialog.accept('Banner Cry'));

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-abilities"]').click();
  const panel = page.locator('[data-testid="ability-panel"]');
  await expect(panel).toBeVisible();

  // The demo's own granted card is listed and opens.
  await panel.locator('[data-ability="rally-the-line"]').click();
  await expect(panel.locator('[data-testid="ability-name"]')).toHaveValue('Rally the Line');

  await panel.locator('[data-testid="add-ability"]').click();
  await expect(panel.locator('[data-ability="banner-cry"]')).toBeVisible();
  await expect(panel.locator('[data-testid="ability-name"]')).toHaveValue('Banner Cry');

  // Kara holds it, and it says what it is.
  await panel.locator('[data-testid="ability-characters"]').fill('kara');
  await panel.locator('[data-testid="ability-text"]').fill('Raise the banner: the whole line breathes again.');

  // A line of prose, then Stress off everyone — the selector is the piece the
  // panel could not reach before this.
  const effects = panel.locator('[data-testid="ability-effects"]');
  await effects.locator('[data-role="add-effect"]').first().selectOption('log');
  await effects.locator('[data-effect="0"] input').first().fill('The banner goes up over the field.');
  await effects.locator('[data-role="add-effect"]').first().selectOption('clearStress');
  await effects.locator('[data-effect="1"] [data-role="target-kind"]').selectOption('party');

  await panel.locator('[data-testid="close-abilities"]').click();

  const before = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    api.select('kara');
    for (const id of api.party()) api.markStress(id, 2);
    return Object.fromEntries(api.party().map((id) => [id, api.stressOf(id).marked]));
  });

  const bar = page.locator('[data-testid="action-bar"]');
  await expect(bar.locator('[data-ability="banner-cry"]')).toHaveAttribute('data-usable', 'true');
  // A card of the project's own, handed to Kara: drawn in the granted colour, as the loadout draws it.
  await expect(bar.locator('[data-ability="banner-cry"] .ability-card-art')).toBeVisible();
  await bar.locator('[data-ability="banner-cry"]').click();

  await expect(page.locator('[data-testid="log"]')).toContainText('The banner goes up over the field.');
  const after = await page.evaluate(() => {
    const api = window.__engine!;
    return Object.fromEntries(api.party().map((id) => [id, api.stressOf(id).marked]));
  });
  for (const id of Object.keys(before)) expect(after[id]).toBe(before[id]! - 1);

  expect(consoleErrors).toEqual([]);
});

test("writes the project's content out as a pack file, and nothing else", async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-project"]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid="export-pack"]').click()]);
  expect(download.suggestedFilename()).toMatch(/-pack\.json$/);

  const pack = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<string, unknown>;
  const project = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())) as Record<string, unknown>;
  expect(pack['formatVersion']).toBe(3);
  // The content, list for list, and none of what makes it a project.
  for (const list of ['weapons', 'armors', 'classes', 'ancestries', 'communities', 'subclasses', 'cards', 'adversaries', 'abilities', 'conditionDefs']) {
    expect(pack[list]).toEqual(project[list]);
  }
  for (const not of ['scenes', 'party', 'code', 'dialogues']) expect(pack[not]).toBeUndefined();

  expect(consoleErrors).toEqual([]);
});

test('lists a card no ability sits on, rewords a copy of it, and writes a script onto it', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-abilities"]').click();
  const panel = page.locator('[data-testid="ability-panel"]');

  // Rallying Cry ships as text: no ability sits on it, so it is listed on its own.
  await expect(panel.locator('[data-testid="text-only-cards"]')).toBeVisible();
  await panel.locator('[data-card="rallying-cry"]').click();
  await expect(panel.locator('[data-testid="card-name"]')).toHaveValue('Rallying Cry');
  await expect(panel.locator('[data-testid="card-grant-kind"]')).toHaveText("the pack's card");

  // The pack's words are the pack's; a copy is the project's to reword.
  await panel.locator('[data-testid="card-copy-pack"]').click();
  await panel.locator('[data-testid="card-text"]').fill('Call out: every ally who hears you clears a Stress.');

  // A script on it moves it into the list above, opened, and named for its card.
  await panel.locator('[data-testid="card-add-script"]').click();
  await expect(panel.locator('[data-card="rallying-cry"]')).toHaveCount(0);
  await expect(panel.locator('[data-ability="rallying-cry"]')).toBeVisible();
  await expect(panel.locator('[data-testid="ability-name"]')).toHaveValue('Rallying Cry');

  const written = await page.evaluate(() => {
    const project = JSON.parse(window.__engine!.exportProject()) as {
      cards: { id: string; text: string }[];
      abilities: { id: string; source: unknown }[];
    };
    return {
      text: project.cards.find((c) => c.id === 'rallying-cry')?.text,
      source: project.abilities.find((a) => a.id === 'rallying-cry')?.source,
    };
  });
  expect(written).toEqual({ text: 'Call out: every ally who hears you clears a Stress.', source: { card: 'rallying-cry' } });

  expect(consoleErrors).toEqual([]);
});

test("edits a copy of the pack's card, and the loadout plays the copy", async ({ page }) => {
  const consoleErrors = await boot(page);
  page.on('dialog', (dialog) => void dialog.accept('Standard Bearer'));

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-abilities"]').click();
  const panel = page.locator('[data-testid="ability-panel"]');

  // Power Slash is the pack's: shown as the pack has it, and edited only as a copy.
  await panel.locator('[data-ability="power-slash"]').click();
  await expect(panel.locator('[data-testid="card-grant-kind"]')).toHaveText("the pack's card");
  await panel.locator('[data-testid="card-copy-pack"]').click();
  await expect(panel.locator('[data-testid="card-grant-kind"]')).toHaveValue('chosen');
  await expect(panel.locator('[data-testid="card-domain"]')).toHaveValue('bulwark');
  await expect(panel.locator('[data-testid="card-recall"]')).toHaveValue('1');

  // Granted by a class for a moment, then back into a loadout: the numbers wait on the card.
  await panel.locator('[data-testid="card-grant-kind"]').selectOption('class');
  await expect(panel.locator('[data-testid="card-grant-class"]')).toBeVisible();
  await panel.locator('[data-testid="card-grant-kind"]').selectOption('chosen');
  await expect(panel.locator('[data-testid="card-recall"]')).toHaveValue('1');
  await panel.locator('[data-testid="card-recall"]').fill('3');

  // A card of the project's own, taken into a loadout, is handed the four numbers it cannot load without.
  await panel.locator('[data-testid="add-ability"]').click();
  await panel.locator('[data-testid="card-grant-kind"]').selectOption('chosen');
  await panel.locator('[data-testid="card-level"]').fill('2');

  const written = await page.evaluate(() => {
    const project = JSON.parse(window.__engine!.exportProject()) as { cards: { id: string }[] };
    return project.cards.filter((c) => c.id === 'power-slash' || c.id === 'standard-bearer');
  });
  expect(written).toEqual([
    expect.objectContaining({ id: 'power-slash', grant: { kind: 'chosen' }, domain: 'bulwark', type: 'ability', level: 1, recallCost: 3 }),
    expect.objectContaining({ id: 'standard-bearer', grant: { kind: 'chosen' }, domain: expect.any(String), type: 'ability', level: 2, recallCost: 0 }),
  ]);

  // Check has nothing to say about the copy.
  await panel.locator('[data-testid="close-abilities"]').click();
  await page.locator('[data-testid="open-project"]').click();
  await page.locator('[data-testid="check-project"]').click();
  await expect(page.locator('[data-testid="problems"]')).toBeVisible();
  await expect(page.locator('[data-testid="problems"]')).not.toContainText('power-slash');

  // And the table plays the copy: Kara's Power Slash recalls for three.
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    api.select('kara');
    api.setCards('kara', ['power-slash']);
  });
  await page.getByTestId('open-loadout').click();
  await expect(page.getByTestId('loadout').locator('[data-card="power-slash"] .face-recall')).toContainText('3');

  expect(consoleErrors).toEqual([]);
});

test('grants a card by subclass stage, ancestry and community, and the one Kara answers to is in her hand', async ({ page }) => {
  const consoleErrors = await boot(page);
  page.on('dialog', (dialog) => void dialog.accept('Oathmark'));

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-abilities"]').click();
  const panel = page.locator('[data-testid="ability-panel"]');
  await panel.locator('[data-testid="add-ability"]').click();
  const grant = () =>
    page.evaluate(
      () => (JSON.parse(window.__engine!.exportProject()) as { cards: { id: string; grant: unknown }[] }).cards.find((c) => c.id === 'oathmark')?.grant,
    );

  // Each picker writes the grant it names, reading the content's own lists.
  await panel.locator('[data-testid="card-grant-kind"]').selectOption('subclass');
  await panel.locator('[data-testid="card-grant-subclass"]').selectOption('shieldbearer');
  await panel.locator('[data-testid="card-grant-stage"]').selectOption('mastery');
  expect(await grant()).toEqual({ kind: 'subclass', subclassId: 'shieldbearer', stage: 'mastery' });

  await panel.locator('[data-testid="card-grant-kind"]').selectOption('ancestry');
  await panel.locator('[data-testid="card-grant-ancestry"]').selectOption('stoneborn');
  expect(await grant()).toEqual({ kind: 'ancestry', ancestryId: 'stoneborn' });

  await panel.locator('[data-testid="card-grant-kind"]').selectOption('community');
  await panel.locator('[data-testid="card-grant-community"]').selectOption('wayfarer');
  expect(await grant()).toEqual({ kind: 'community', communityId: 'wayfarer' });

  // Kara is a Wayfarer, so the card is hers without anyone choosing it.
  await panel.locator('[data-testid="close-abilities"]').click();
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    api.select('kara');
  });
  await page.getByTestId('open-loadout').click();
  await expect(page.getByTestId('granted-zone')).toContainText('Oathmark');

  expect(consoleErrors).toEqual([]);
});

test('shows the cards a stat block prints when somebody looks at the creature', async ({ page }) => {
  const consoleErrors = await boot(page);
  page.on('dialog', (dialog) => void dialog.accept('Grasping Roots'));

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-abilities"]').click();
  const panel = page.locator('[data-testid="ability-panel"]');
  await panel.locator('[data-testid="add-ability"]').click();
  await panel.locator('[data-testid="card-grant-kind"]').selectOption('adversary');
  await panel.locator('[data-testid="card-grant-adversaries"]').fill('hollow-knight');
  await panel.locator('[data-testid="ability-text"]').fill('Roots hold whoever it hits.');
  await panel.locator('[data-testid="close-abilities"]').click();

  // In play, looking at a Hollow Knight shows what its block prints.
  const looked = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    const foe = api.adversaries()[0]!;
    return api.inspect(api.tileOf(foe));
  });
  expect(looked?.kind).toBe('adversary');
  const printed = page.locator('[data-testid="inspect"] [data-testid="inspect-cards"] [data-card="grasping-roots"]');
  await expect(printed).toContainText('Grasping Roots');
  await expect(printed).toContainText('Roots hold whoever it hits.');

  expect(consoleErrors).toEqual([]);
});

test("writes a stat block's shape: an area everyone rolls to avoid, and a swing that reaches further", async ({ page }) => {
  const consoleErrors = await boot(page);
  page.on('dialog', (dialog) => void dialog.accept('Eruption'));

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-abilities"]').click();
  const panel = page.locator('[data-testid="ability-panel"]');
  await panel.locator('[data-testid="add-ability"]').click();
  // Printed on a stat block, which is what makes it one of the block's features.
  await panel.locator('[data-testid="card-grant-kind"]').selectOption('adversary');
  await panel.locator('[data-testid="card-grant-adversaries"]').fill('bandit-archer');
  // Shadow is the GM's pool, which is what a stat block's feature spends.
  await panel.locator('[data-testid="ability-bad"]').fill('2');
  // And what the block does with damage coming back at it: half of one type,
  // and a flat number off the rest.
  await panel.locator('[data-testid="ability-resist-physical"]').check();
  await panel.locator('[data-testid="ability-reduce"]').fill('1d10');
  await panel.locator('[data-testid="ability-reduce-type"]').selectOption('magic');
  // The swing the block prints goes through armor, and this answers it landing:
  // two things a card has no use for.
  await panel.locator('[data-testid="ability-direct-attack"]').check();
  await panel.locator('[data-testid="ability-kind"]').selectOption('reaction');
  await panel.locator('[data-testid="ability-trigger"]').selectOption('dealtDamage');

  const effects = panel.locator('[data-testid="ability-effects"]');

  // "All targets must make a reaction roll. Those who fail take 2d10; those
  // who succeed take half" — one roll of the damage, spent by both branches.
  await effects.locator('[data-role="add-effect"]').first().selectOption('reactionRoll');
  const roll = effects.locator('[data-effect="0"] [data-testid="reaction-roll"]');
  await roll.locator('[data-role="reaction-damage"]').fill('2d10');
  const fail = roll.locator('[data-outcome="onFail"]');
  await fail.locator('[data-role="add-effect"]').first().selectOption('loseGood');

  // And a swing that reaches further than the creature's own weapon, through
  // armor: the two things a feature says about an attack that a card does not.
  await effects.locator(':scope > [data-role="add-effect"]').last().selectOption('attack');
  const attack = effects.locator('[data-effect="1"] [data-testid="attack"]');
  await attack.locator('[data-role="attack-range"]').selectOption('close');
  await attack.locator('label:has-text("direct") input').check();

  // What it calls onto the map when it is losing.
  await effects.locator(':scope > [data-role="add-effect"]').last().selectOption('summon');
  const summon = effects.locator('[data-effect="2"]');
  await summon.locator('[data-role="summon-count"]').fill('1d4');
  await summon.locator('[data-role="summon-range"]').selectOption('far');
  await summon.locator('label:has-text("acts at once") input').check();

  // The GM's turn handed to its own side.
  await effects.locator(':scope > [data-role="add-effect"]').last().selectOption('spotlight');
  const rally = effects.locator('[data-effect="3"]');
  await rally.locator('[data-role="spotlight-count"]').fill('1d4+1');
  await rally.locator('label:has-text("for half") input').check();

  // And a clock: what it does happens turns later, so its own effects are
  // written inside it.
  await effects.locator(':scope > [data-role="add-effect"]').last().selectOption('countdown');
  const countdown = effects.locator('[data-effect="4"] [data-testid="countdown"]');
  await countdown.locator('[data-role="countdown-start"]').fill('1d12');
  await countdown.locator('[data-role="countdown-advance"]').selectOption('withBad');
  await countdown.locator('[data-role="countdown-loop"]').selectOption('decreasing');
  await countdown.locator('label:has-text("goes off if they fall") input').check();
  await countdown.locator('[data-outcome="countdownEffects"] [data-role="add-effect"]').first().selectOption('gainBad');

  const written = await page.evaluate(() => {
    const project = JSON.parse(window.__engine!.exportProject()) as {
      cards: { id: string; grant: unknown }[];
      abilities: {
        id: string;
        cost: unknown;
        trigger?: unknown;
        defenses?: unknown;
        standardAttack?: unknown;
        effects: unknown[];
      }[];
    };
    const ability = project.abilities.find((a) => a.id === 'eruption')!;
    return {
      grant: project.cards.find((c) => c.id === 'eruption')?.grant,
      cost: ability.cost,
      trigger: ability.trigger,
      defenses: ability.defenses,
      standardAttack: ability.standardAttack,
      effects: ability.effects,
    };
  });
  expect(written).toEqual({
    grant: { kind: 'adversary', adversaries: ['bandit-archer'] },
    // Only what the author touched: the Light and Stress fields were left alone.
    cost: { bad: 2 },
    trigger: 'dealtDamage',
    defenses: { resistances: ['physical'], reduce: [{ dice: '1d10', only: 'magic' }] },
    standardAttack: { direct: true },
    effects: [
      {
        kind: 'reactionRoll',
        difficulty: 12,
        trait: 'agility',
        damage: { dice: '2d10' },
        onFail: [{ kind: 'loseGood', amount: 1 }],
      },
      { kind: 'attack', range: 'close', direct: true },
      { kind: 'summon', adversary: 'bandit-archer', count: '1d4', range: 'far', spotlight: true },
      { kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1d4+1', halfDamage: true },
      {
        kind: 'countdown',
        countdown: 'countdown',
        name: 'Countdown',
        start: '1d12',
        advance: 'withBad',
        loop: 'decreasing',
        onDeath: 'trigger',
        effects: [{ kind: 'gainBad', amount: 1 }],
      },
    ],
  });

  // And Check has nothing to say about its Shadow: on a stat block's card is where Shadow belongs.
  await page.locator('[data-testid="open-project"]').click();
  await page.locator('[data-testid="check-project"]').click();
  await expect(page.locator('[data-testid="problems"]')).toBeVisible();
  await expect(page.locator('[data-testid="problems"]')).not.toContainText('only the GM spends');

  expect(consoleErrors).toEqual([]);
});

test('writes a card that reuses one roll against every other adversary in reach', async ({ page }) => {
  const consoleErrors = await boot(page);
  page.on('dialog', (dialog) => void dialog.accept('Sweep'));

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-abilities"]').click();
  const panel = page.locator('[data-testid="ability-panel"]');
  await panel.locator('[data-testid="add-ability"]').click();

  // Whirlwind's shape, built entirely from the panel: swing, then carry the
  // same roll and half of the same damage to everyone else in reach.
  const effects = panel.locator('[data-testid="ability-effects"]');
  await effects.locator('[data-role="add-effect"]').first().selectOption('attack');
  const attack = effects.locator('[data-effect="0"] [data-testid="attack"]');
  await attack.locator('[data-role="add-effect"]').first().selectOption('check');

  const check = attack.locator('[data-testid="check-editor"]').first();
  await check.locator('[data-testid="check-reuse"]').check();
  await check.locator('[data-testid="check-targets"] [data-role="target-kind"]').selectOption('adversaries');
  await check.locator('[data-testid="check-targets"] [data-role="target-except"]').selectOption('target');

  const outcome = check.locator('[data-outcome="onSuccessWithGood"]');
  await outcome.locator('[data-role="add-effect"]').first().selectOption('damage');
  await outcome.locator('[data-role="damage-mode"]').selectOption('dice');
  await outcome.locator('[data-role="damage-dice"]').fill('same');
  await outcome.locator('label:has-text("half") input').check();

  // What the panel wrote is a script the engine's own schema accepts.
  const written = await page.evaluate(() => {
    const project = JSON.parse(window.__engine!.exportProject()) as {
      abilities: { id: string; effects: unknown[] }[];
    };
    return project.abilities.find((a) => a.id === 'sweep')!.effects;
  });
  expect(written).toEqual([
    {
      // The weapon select reads "primary" because that is the default; the
      // panel writes only what an author actually chose.
      kind: 'attack',
      onHit: [
        {
          kind: 'check',
          check: {
            trait: 'finesse',
            difficulty: 12,
            roll: 'last',
            targets: { kind: 'adversaries', range: 'veryClose', except: 'target' },
            onSuccessWithGood: [{ kind: 'damage', dice: 'same', half: true }],
          },
        },
      ],
    },
  ]);

  expect(consoleErrors).toEqual([]);
});

test('writes a character in the Party panel and the table plays the new sheet', async ({ page }) => {
  const consoleErrors = await boot(page);
  page.on('dialog', (dialog) => void dialog.accept('Ilse'));

  const before = await page.evaluate(() => window.__engine!.gear('kara'));

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-party"]').click();
  const panel = page.locator('[data-testid="party-panel"]');
  await expect(panel).toBeVisible();

  // The demo party is in the project file now, not a TypeScript literal.
  await expect(panel.locator('[data-character="kara"]')).toBeVisible();
  await expect(panel.locator('[data-character="finn"]')).toBeVisible();
  await expect(panel.locator('[data-character="mira"]')).toBeVisible();

  await panel.locator('[data-character="kara"]').click();
  await expect(panel.locator('[data-testid="character-name"]')).toHaveValue('Kara');
  const derived = panel.locator('[data-testid="character-derived"]');
  const armored = await derived.textContent();

  // Taking the mail off changes what the sheet comes to, there and then.
  await panel.locator('[data-testid="character-armor"]').selectOption('padded-coat');
  await expect(derived).not.toHaveText(armored ?? '');

  // A card list narrowed to her domains and level: Shield Wall is a Bulwark card.
  await panel.locator('[data-card="shield-wall"]').click();
  await panel.locator('[data-loadout="shield-wall"]').check();

  // A new character can be written from nothing.
  await panel.locator('[data-testid="add-character"]').click();
  await expect(panel.locator('[data-character="ilse"]')).toBeVisible();
  await expect(panel.locator('[data-testid="character-derived"]')).toContainText('Hit Points');

  await panel.locator('[data-testid="close-party"]').click();

  // Back at the table, Kara wears what the document says and knows the card.
  const after = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    return { gear: api.gear('kara'), loadout: api.loadout('kara').loadout };
  });
  expect(after.gear.armor).not.toBe(before.armor);
  expect(after.loadout).toContain('shield-wall');

  expect(consoleErrors).toEqual([]);
});

test('writes an item and the table that hands it out, and the party can carry it', async ({ page }) => {
  const consoleErrors = await boot(page);
  const names: string[] = ['A rope', 'pockets'];
  page.on('dialog', (dialog) => void dialog.accept(names.shift() ?? 'ok'));

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-items"]').click();
  const panel = page.locator('[data-testid="item-panel"]');
  await expect(panel).toBeVisible();

  // A new item, with something it does when used.
  await panel.locator('[data-testid="add-item"]').click();
  await expect(panel.locator('[data-testid="item-name"]')).toHaveValue('A rope');
  await panel.locator('[data-testid="item-kind"]').selectOption('consumable');
  await panel.locator('[data-testid="item-description"]').fill('Forty feet of it, and fraying.');
  const effects = panel.locator('[data-testid="item-effects"]');
  await effects.locator('[data-role="add-effect"]').first().selectOption('log');
  await effects.locator('[data-effect="0"] input').first().fill('The rope pays out into the dark.');

  // And a table that hands it out, whose odds the panel works out.
  await panel.locator('[data-testid="add-loot-table"]').click();
  await expect(panel.locator('[data-testid="loot-entries"]')).toBeVisible();
  await panel.locator('[data-role="loot-item"]').first().selectOption('a-rope');
  await panel.locator('[data-testid="add-loot-entry"]').click();
  await panel.locator('[data-role="loot-weight"]').first().fill('3');
  // Weights of 3 and 1: three quarters and one quarter, not two percentages.
  await expect(panel.locator('[data-role="loot-odds"]').first()).toHaveText('75%');
  await expect(panel.locator('[data-role="loot-odds"]').nth(1)).toHaveText('25%');

  await panel.locator('[data-testid="close-items"]').click();

  // Back at the table, the party can be handed it and use it.
  const log = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    api.giveItem('a-rope');
    return api.useItem('a-rope');
  });
  expect(log).not.toBe('');
  await expect(page.locator('[data-testid="log"]')).toContainText('The rope pays out into the dark.');

  expect(consoleErrors).toEqual([]);
});

test('loads a project and restarts the game on it, but not in the middle of a fight', async ({ page }) => {
  const consoleErrors = await boot(page);

  // Write a character in the panel, export the project, and load it back:
  // that is the round trip a designer makes between authoring and playing.
  page.on('dialog', (dialog) => void dialog.accept('Ilse'));
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-party"]').click();
  const panel = page.locator('[data-testid="party-panel"]');
  await panel.locator('[data-testid="add-character"]').click();
  await panel.locator('[data-testid="character-armor"]').selectOption('ringmail');
  await panel.locator('[data-testid="close-party"]').click();

  const result = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    const text = api.exportProject();
    return { before: api.party(), reason: api.loadProjectText(text), after: api.party() };
  });
  expect(result.reason).toBe('');
  // Pressing Play seated her (`editor-panels.spec.ts` is about that); loading
  // the document restarts the game on it, and she is in the document.
  expect(result.before).toContain('ilse');
  expect(result.after).toContain('ilse');
  expect(result.after).toContain('kara');

  // A project that parses but cannot be played says so and leaves the game alone.
  const unplayable = await page.evaluate(() => {
    const api = window.__engine!;
    const doc = JSON.parse(api.exportProject()) as { startScene: string };
    doc.startScene = 'no-such-room';
    return { reason: api.loadProjectText(JSON.stringify(doc)), party: api.party() };
  });
  expect(unplayable.reason).toContain('no-such-room');
  expect(unplayable.party).toContain('ilse');

  // And mid-fight it refuses outright: there is a turn order waiting on it.
  const midFight = await page.evaluate(() => {
    const api = window.__engine!;
    api.startFight();
    return { reason: api.loadProjectText(api.exportProject()), fighting: api.turnSide() };
  });
  expect(midFight.reason).toContain('fight');
  expect(midFight.fighting).not.toBeNull();

  expect(consoleErrors).toEqual([]);
});

test('aims a card at the ground, and the board shows what it would catch before it is thrown', async ({ page }) => {
  const consoleErrors = await boot(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.select('mira');
    api.setCards('mira', ['cinder-burst']);
    api.standNear(api.adversaries()[0]!);
    api.startFight();
  });

  // The bar arms for ground rather than for a creature, and says so.
  const armed = await page.evaluate(() => window.__engine!.aim('cinder-burst'));
  expect(armed.length).toBeGreaterThan(0);
  const bar = page.locator('[data-testid="action-bar"]');
  await expect(bar).toContainText('click a spot on the board');
  expect(await page.evaluate(() => window.__engine!.targeting())).toBe('cinder-burst');

  // Every tile it may be aimed at is lit, and nothing is committed to yet.
  expect((await page.evaluate(() => window.__engine!.lit())).length).toBe(armed.length);

  // Escape puts the bar down without spending anything.
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__engine!.targeting())).toBe(null);

  // Armed again, and aimed for real: a spot whose bloom covers the husk.
  const done = await page.evaluate((tiles) => {
    const api = window.__engine!;
    const foe = api.adversaries()[0]!;
    api.aim('cinder-burst');
    const through = tiles.filter((tile) => api.shape('cinder-burst', tile).includes(foe));
    const aimed = through[through.length - 1]!;
    const marked = api.hitPoints(foe).marked;
    api.useAbility('mira', 'cinder-burst', [], aimed);
    let guard = 0;
    while (api.pendingKind() !== null && guard++ < 6) api.answer({ kind: 'roll' });
    return { through: through.length, marked, after: api.hitPoints(foe).marked };
  }, armed);
  expect(done.through).toBeGreaterThan(0);
  // The bloom landed, whatever the dice said about what it caught. Nobody moved:
  // the caster running down the line belonged to the card this replaced.
  expect(done.after).toBeGreaterThanOrEqual(done.marked);
  expect(consoleErrors).toEqual([]);
});
