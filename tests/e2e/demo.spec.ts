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
      use: (id: string) => string;
      useInReach: () => string;
      answer: (
        response:
          | { kind: 'choose'; index: number }
          | { kind: 'roll'; advantage?: number; disadvantage?: number; helpDice?: number }
          | { kind: 'cancel' }
          | { kind: 'continue' },
      ) => string;
      log: () => { text: string; tone: string }[];
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
      switchScene: (id: string) => void;
      addScene: (name: string) => string;
      removeScene: (id: string) => boolean;
      selectObject: (id: string) => boolean;
      editObject: (changes: Record<string, unknown>) => void;
      objectField: (field: string) => unknown;
      nodePosition: (dialogue: string, node: string) => { x: number; y: number } | null;
      dialogueNodes: (dialogue: string) => string[];
      carried: () => { id: string; name: string; quantity: number }[];
      journal: () => { id: string; status: string; done: string[] }[];
      camera: () => { yaw: number; pitch: number; distance: number; target: { x: number; z: number } };
      cursorTile: () => number;
      screenOf: (tile: number) => { x: number; y: number };
      save: () => boolean;
      load: () => boolean;
      saveBlocked: () => string | null;
      saveText: () => string | null;
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

test('uses the vault furniture the original map authored', async ({ page }) => {
  const consoleErrors = await boot(page);

  // The legacy map wrote a Finesse 12 on this chest, with a line of prose for
  // each way the roll can go. Every one of those fields imported cleanly and ran
  // nowhere until the use verb existed, so this is the test that it reaches play.
  const result = await page.evaluate(() => {
    const api = window.__polyheart!;
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
  expect(result.log.join(' ')).toMatch(/with (Hope|Fear)|critical/i);

  // And it stays used.
  expect(result.usedAgain).toBe('refused');

  expect(consoleErrors).toEqual([]);
});

test('shows the narrative log and the roll prompt on the page', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => {
    const api = window.__polyheart!;
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    api.use(chest);
  });

  // The prose and the prompt are on screen, not only in the journal.
  await expect(page.locator('[data-testid="log"]')).toBeVisible();
  const roll = page.getByRole('button', { name: /Roll finesse/i });
  await expect(roll).toBeVisible();

  await roll.click();
  await expect(page.locator('[data-testid="log"]')).toContainText(/Hope|Fear|critical/i);

  expect(consoleErrors).toEqual([]);
});

test('talks to the pillar, and the conversation is part of the saved project', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => {
    const api = window.__polyheart!;
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
  await expect(page.locator('[data-testid="log"]')).toContainText(/Hope|Fear|critical/i);

  // And the words themselves are document data: they survive Save JSON.
  const saved = await page.evaluate(() => window.__polyheart!.exportProject());
  expect(saved).toContain('the-listening-pillar');
  expect(saved).toContain('Three hundred years');

  expect(consoleErrors).toEqual([]);
});

test('hides a reply until the party knows what it is talking about', async ({ page }) => {
  const consoleErrors = await boot(page);

  const gated = await page.evaluate(() => {
    const api = window.__polyheart!;
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
    const api = window.__polyheart!;
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
    const api = window.__polyheart!;
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
    const api = window.__polyheart!;
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

  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  const panel = page.locator('#app');
  await expect(panel).toContainText('Scenes');
  await expect(panel).toContainText('The Sounding Pit');

  // Switching by clicking the scene's own button, not the debug handle.
  await page.getByRole('button', { name: /The Sounding Pit/ }).click();
  const editing = await page.evaluate(() => ({
    editScene: window.__polyheart!.editScene(),
    playing: window.__polyheart!.sceneId(),
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
    const api = window.__polyheart!;
    api.setMode('edit');
    api.setTool('interactable');
    // Somewhere the party can reach, in the open part of the vault.
    api.editAt(9 * 22 + 3);
  });

  const authored = await page.evaluate(() => {
    const api = window.__polyheart!;
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
        onSuccessWithHope: [{ kind: 'log', text: 'The lever gives with a crack.' }],
        onSuccessWithFear: [{ kind: 'log', text: 'The lever gives with a crack.' }],
        onFailureWithHope: [{ kind: 'log', text: 'The lever gives with a crack.' }],
        onFailureWithFear: [{ kind: 'log', text: 'The lever gives with a crack.' }],
      },
    });

    return { id, name: api.objectField('name'), flavor: api.objectField('flavor') };
  });

  expect(authored.name).toBe('A rusted lever');

  // Now play it: walk up to the thing that did not exist a moment ago and use it.
  const played = await page.evaluate((id: string) => {
    const api = window.__polyheart!;
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
    const api = window.__polyheart!;
    api.setMode('edit');
    api.selectObject(api.objects().find((id) => id.startsWith('chest'))!);
  });

  const panel = page.locator('#app');
  // The chest's authored roll is on screen, editable.
  await expect(panel).toContainText('The roll');
  await expect(panel).toContainText('Success with Hope');
  await expect(panel).toContainText('Flavour');

  // Editing the name in the panel reaches the document.
  const name = panel.locator('input').first();
  await name.fill('A very old chest');
  const stored = await page.evaluate(() => window.__polyheart!.objectField('name'));
  expect(stored).toBe('A very old chest');

  expect(consoleErrors).toEqual([]);
});

test('draws the pillar conversation as a graph', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__polyheart!.setMode('edit'));
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

  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();

  const before = await page.evaluate(() =>
    window.__polyheart!.nodePosition('the-listening-pillar', 'vault'),
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
    window.__polyheart!.nodePosition('the-listening-pillar', 'vault'),
  );
  expect(after).not.toBeNull();

  // Eight pointer moves, one undo.
  await page.evaluate(() => window.__polyheart!.undo());
  const undone = await page.evaluate(() =>
    window.__polyheart!.nodePosition('the-listening-pillar', 'vault'),
  );
  expect(undone).toBeNull();

  expect(consoleErrors).toEqual([]);
});

test('writes a new reply in the graph and hears it in play', async ({ page }) => {
  const consoleErrors = await boot(page);

  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();

  const graph = page.locator('[data-testid="dialogue-graph"]');

  // Add a node, then a reply on the opening node that leads to it.
  await graph.getByRole('button', { name: '+ Node' }).click();
  const nodes = await page.evaluate(() =>
    window.__polyheart!.dialogueNodes('the-listening-pillar'),
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
  const exported = await page.evaluate(() => window.__polyheart!.exportProject());
  expect(exported).toContain('Say nothing, and wait.');
  expect(exported).toContain('The stone says nothing more.');

  // ...and in the player's mouth.
  const options = await page.evaluate(() => {
    const api = window.__polyheart!;
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
    const api = window.__polyheart!;
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
    const api = window.__polyheart!;
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
  await page.evaluate(() => window.localStorage.removeItem('polyheart:save'));

  // Nothing saved yet, so there is nothing to go back to.
  await expect(page.locator('[data-testid="load"]')).toBeDisabled();

  const before = await page.evaluate(() => {
    const api = window.__polyheart!;
    const vault = api.sceneId();
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    api.use(chest);
    api.answer({ kind: 'roll' });
    api.travelTo('the-pit');
    return {
      vault,
      carried: api.carried(),
      scene: api.sceneId(),
      tiles: api.party().map((id) => api.tileOf(id)),
    };
  });
  expect(before.carried.length).toBeGreaterThan(0);
  expect(before.scene).toBe('the-pit');

  // Save through the button a player would actually press.
  await page.locator('[data-testid="save"]').click();
  await expect(page.locator('[data-testid="log"]')).toContainText('Saved.');

  // A real reload: a new page, a new engine, and nothing but storage between.
  await page.reload();
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  const fresh = await page.evaluate(() => ({
    scene: window.__polyheart!.sceneId(),
    carried: window.__polyheart!.carried(),
  }));
  expect(fresh.scene).not.toBe('the-pit');
  expect(fresh.carried).toEqual([]);

  await page.locator('[data-testid="load"]').click();
  const after = await page.evaluate(() => {
    const api = window.__polyheart!;
    return {
      carried: api.carried(),
      scene: api.sceneId(),
      tiles: api.party().map((id) => api.tileOf(id)),
    };
  });

  expect(after.scene).toBe('the-pit');
  expect(after.carried).toEqual(before.carried);
  expect(after.tiles).toEqual(before.tiles);

  // Upstairs, the chest the party emptied before saving is still empty: using it
  // is refused rather than offering the lock roll again. That is the room the
  // save was *not* being played in, restored.
  const upstairs = await page.evaluate((vault: string) => {
    const api = window.__polyheart!;
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
    const api = window.__polyheart!;
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);
  });
  expect(await page.evaluate(() => window.__polyheart!.hasDialogue())).toBe(true);
  await expect(save).toBeDisabled();
  expect(await page.evaluate(() => window.__polyheart!.saveBlocked())).toMatch(/conversation/);

  expect(consoleErrors).toEqual([]);
});

test('opens a quest in the journal when the pillar wakes', async ({ page }) => {
  const consoleErrors = await boot(page);

  // No journal until there is something in it.
  await expect(page.locator('[data-testid="journal"]')).toHaveCount(0);

  const journal = await page.evaluate(() => {
    const api = window.__polyheart!;
    const before = api.journal();
    const pillar = api.objects().find((id) => id.startsWith('pillar'))!;
    api.standBeside(pillar);
    api.use(pillar);
    return { before, after: api.journal(), log: api.log().map((l) => l.text) };
  });
  expect(journal.before).toEqual([]);
  expect(journal.after).toEqual([{ id: 'the-wardens-word', status: 'active', done: [] }]);
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
  await page.evaluate(() => window.__polyheart!.setMode('edit'));

  await page.locator('[data-quest="the-wardens-word"]').click();
  const editor = page.locator('[data-testid="quest-editor"]');
  await expect(editor).toBeVisible();

  // Rename the quest and rewrite its first step, the way an author would.
  await editor.locator('[data-field="name"]').fill('The Word Below');
  await editor.locator('[data-objective="win-the-word"] input').fill('Talk the Warden round.');
  await editor.locator('button', { hasText: '+ Step' }).click();

  // Back in play, the journal shows what was written.
  const journal = await page.evaluate(() => {
    const api = window.__polyheart!;
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
  await page.evaluate(() => window.__polyheart!.setMode('edit'));

  // A second quest, so switching between them means something.
  page.once('dialog', (dialog) => void dialog.accept('Another errand'));
  await page.locator('button', { hasText: '+ Quest' }).click();

  await page.evaluate(() => {
    const api = window.__polyheart!;
    api.selectObject(api.objects().find((id) => id.startsWith('chest'))!);
  });
  const list = page.locator('[data-testid="object-effects"]');
  await list.locator('[data-role="add-effect"]').selectOption('completeObjective');

  const fresh = await page.evaluate(() => {
    const effects = window.__polyheart!.objectField('effects') as { kind: string }[];
    return effects[effects.length - 1];
  });
  expect(fresh).toEqual({ kind: 'completeObjective', quest: 'the-wardens-word', objective: 'win-the-word' });

  // Switch the quest: the objective must not stay pointed at the old quest's step.
  const row = list.locator('[data-effect]').last();
  await row.locator('select').first().selectOption('another-errand');
  const switched = await page.evaluate(() => {
    const effects = window.__polyheart!.objectField('effects') as { kind: string }[];
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

  const start = await page.evaluate(() => window.__polyheart!.camera());

  // Left drag: turns, does not move the target.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 30, { steps: 6 });
  await page.mouse.up();
  const turned = await page.evaluate(() => window.__polyheart!.camera());
  expect(turned.yaw).not.toBeCloseTo(start.yaw);
  expect(turned.target).toEqual(start.target);

  // Right drag: moves the target, keeps the angle.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 80, cy + 40, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  const panned = await page.evaluate(() => window.__polyheart!.camera());
  expect(panned.yaw).toBeCloseTo(turned.yaw);
  expect(Math.hypot(panned.target.x - turned.target.x, panned.target.z - turned.target.z)).toBeGreaterThan(0.5);

  // Wheel: changes the distance only.
  await page.mouse.wheel(0, -600);
  const zoomed = await page.evaluate(() => window.__polyheart!.camera());
  expect(zoomed.distance).toBeLessThan(panned.distance);
  expect(zoomed.yaw).toBeCloseTo(panned.yaw);

  // A press that stays put is still a click: it selects or walks, and the log
  // shows something happened rather than the camera absorbing it.
  const before = await page.evaluate(() => {
    const api = window.__polyheart!;
    api.setMode('play');
    return { tile: api.tileOf(api.selected()!), log: api.log().length };
  });
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  // Hover over another party member's tile: the cursor marks it, and a still
  // click there selects them rather than being eaten as a drag.
  const target = await page.evaluate(() => window.__polyheart!.tileOf(window.__polyheart!.party()[1]!));
  const at = await page.evaluate((tile) => window.__polyheart!.screenOf(tile), target);
  await page.mouse.move(at.x, at.y);
  expect(await page.evaluate(() => window.__polyheart!.cursorTile())).toBe(target);
  await page.mouse.down();
  await page.mouse.up();
  const selected = await page.evaluate(() => window.__polyheart!.selected());
  expect(selected).toBe(await page.evaluate(() => window.__polyheart!.party()[1]));
  expect(before.tile).toBeDefined();

  expect(consoleErrors).toEqual([]);
});

test('shows the party in a HUD with pips, and clicking a card selects', async ({ page }) => {
  const consoleErrors = await boot(page);
  const hud = page.locator('[data-testid="hud"]');
  await expect(hud).toBeVisible();
  const party = await page.evaluate(() => window.__polyheart!.party());
  await expect(hud.locator('[data-member]')).toHaveCount(party.length);
  await expect(hud.locator('[data-member][data-selected="true"]')).toHaveCount(1);

  await hud.locator(`[data-member="${party[2]}"]`).click();
  expect(await page.evaluate(() => window.__polyheart!.selected())).toBe(party[2]);
  await expect(hud.locator(`[data-member="${party[2]}"]`)).toHaveAttribute('data-selected', 'true');

  // The pips agree with the engine.
  const hp = await page.evaluate((id) => window.__polyheart!.hitPoints(id), party[2]!);
  const pips = hud.locator(`[data-member="${party[2]}"] [data-testid="hp"]`);
  await expect(pips).toHaveAttribute('data-max', String(hp.max));
  await expect(pips).toHaveAttribute('data-marked', String(hp.marked));

  expect(consoleErrors).toEqual([]);
});

test('reads the dice out in the log', async ({ page }) => {
  const consoleErrors = await boot(page);
  const line = await page.evaluate(() => {
    const api = window.__polyheart!;
    const chest = api.objects().find((id) => id.startsWith('chest'))!;
    api.standBeside(chest);
    api.use(chest);
    api.answer({ kind: 'roll' });
    return api.log().map((l) => l.text).find((t) => t.startsWith('Hope '));
  });
  expect(line).toMatch(/^Hope \d+ \+ Fear \d+ .*= \d+ vs \d+\. (A critical success|Success|Failure)/);
  expect(consoleErrors).toEqual([]);
});
