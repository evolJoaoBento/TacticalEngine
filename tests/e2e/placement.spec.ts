import { expect, test } from '@playwright/test';

test('the right-side height ladder controls placement Z and follows the active tab', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  // The ladder follows what is being placed rather than which tab is open - there is no
  // second terrain tab left for it to follow. A kind that stacks goes down at a height, so
  // it is what brings the ladder out. Set here rather than assumed: the placer opens
  // holding a kind that stacks, so the ladder would be out either way.
  await page.evaluate(() => window.__engine!.setTerrain('block'));
  const height = page.getByTestId('placement-height');
  await expect(height).toBeVisible();
  const [controlBox, sideBox] = await Promise.all([
    height.boundingBox(),
    page.getByTestId('terrain-side').boundingBox(),
  ]);
  expect(controlBox).not.toBeNull();
  expect(sideBox).not.toBeNull();
  // Docked at the board's right edge: clear of the mode panel, but against it —
  // which fails if the ladder ever drifts back to the left of the board.
  expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(sideBox!.x);
  expect(sideBox!.x - (controlBox!.x + controlBox!.width)).toBeLessThan(40);

  // A rung a whole tile up is drawn, and clicking it jumps to that level. Kept
  // close to the centre so a shorter viewport, which fits fewer rungs, cannot
  // clip the rung this test clicks.
  await page.getByRole('button', { name: 'Z 1', exact: true }).click();
  await expect(page.getByLabel('Build level', { exact: true })).toHaveValue('1');
  await page.evaluate(() => window.__engine!.buildAt(4, 4));
  const scene = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0];
  expect(scene.buildingTiles['4,4,1']).toBeDefined();

  // The ladder re-centres on the new level, so its own rung is now the current one.
  await expect(page.getByTestId('height-ladder')).toHaveAttribute('aria-valuenow', '1');

  // Dragging scrubs, and the ladder moves with the pointer: pulling down brings
  // the levels above down to the selector, so the level climbs. Pixels are spent
  // against the shrinking rungs, so a short pull covers several quarter tiles.
  // This is the gesture the ladder exists for, and the only place the deferred
  // pointer capture and the guard on the click that trails a drag are exercised
  // together.
  const ladderBox = await page.getByTestId('height-ladder').boundingBox();
  expect(ladderBox).not.toBeNull();
  const midX = ladderBox!.x + ladderBox!.width / 2;
  const midY = ladderBox!.y + ladderBox!.height / 2;
  await page.mouse.move(midX, midY);
  await page.mouse.down();
  await page.mouse.move(midX, midY + 60, { steps: 6 });
  await page.mouse.up();
  const dragged = Number(await page.getByLabel('Build level', { exact: true }).inputValue());
  expect(dragged).toBeGreaterThan(1);

  // And it goes when what is in hand no longer needs it: a kind of ground is not something
  // the placer puts down at all, so there is no height to choose.
  await page.evaluate(() => window.__engine!.setTerrain('floor'));
  await expect(height).toHaveCount(0);
  await page.locator('[data-tab="props"]').click();
  await expect(page.getByTestId('placement-height')).toBeVisible();
  await page.screenshot({ path: 'test-results/right-height-ladder.png' });
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('a selected creature is re-skinned by its type and on its own, and it survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-combat').click();

  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('hound');
  await strip.locator('[data-item]').first().click();

  // Editor chrome floats over the board, so take a tile whose surface is
  // actually clickable rather than naming one and hoping.
  const spot = await page.evaluate(() => {
    const api = window.__engine!;
    for (let y = 3; y <= 6; y += 1) {
      for (let x = 3; x <= 6; x += 1) {
        const at = api.buildScreenAt(x, y);
        if (document.elementFromPoint(at.x, at.y)?.id === 'gl') return { x, y, at };
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();

  // Placing needs no panel, so the headless handle will do.
  await page.evaluate(({ x, y }) => window.__engine!.buildAt(x, y), spot!);
  await expect(page.getByTestId('selected-creature')).toHaveCount(0);

  // Selecting is a real click: that path is what re-renders the panel, and it is
  // what a designer actually does. `buildAt` applies the tool without drawing.
  await page.evaluate(() => window.__engine!.setTool('select'));
  await page.mouse.click(spot!.at.x, spot!.at.y);
  await expect(page.getByTestId('selected-creature')).toBeVisible();

  await page.getByTestId('type-model').selectOption('knight');
  await page.getByTestId('creature-model').selectOption('rogue');
  // The name commits on change, not on every keystroke — one rename is one undo
  // step — so the field has to lose focus before it takes.
  await page.getByTestId('creature-name').fill('Gorehide');
  await page.getByTestId('creature-name').blur();
  await page.screenshot({ path: 'test-results/creature-models.png' });

  const editing = await page.evaluate(() => window.__engine!.editScene());
  type Placed = { adversary: string; model?: string; name?: string; position: { x: number; y: number } };
  // The room comes with encounters of its own, so find the creature just placed
  // by where it stands rather than taking the first one in the list.
  const placedIn = (text: string): Placed => {
    const doc = JSON.parse(text);
    const scene = doc.scenes.find((s: { id: string }) => s.id === editing);
    const found = scene.encounters
      .flatMap((e: { adversaries: Placed[] }) => e.adversaries)
      .find((a: Placed) => a.position.x === spot!.x && a.position.y === spot!.y);
    expect(found).toBeDefined();
    return found as Placed;
  };

  const text = await page.evaluate(() => window.__engine!.exportProject());
  const placed = placedIn(text);
  // The type default and the one-creature override are stored apart, and the
  // creature's own override is what the panel put on the placement.
  expect(JSON.parse(text).adversaryModels[placed.adversary]).toBe('knight');
  expect(placed.model).toBe('rogue');
  expect(placed.name).toBe('Gorehide');

  // Clearing the override falls back to the type without disturbing it.
  await page.getByTestId('creature-model').selectOption('');
  const clearedText = await page.evaluate(() => window.__engine!.exportProject());
  expect(placedIn(clearedText).model).toBeUndefined();
  expect(JSON.parse(clearedText).adversaryModels[placed.adversary]).toBe('knight');

  expect(await page.evaluate((t) => window.__engine!.loadProjectText(t), text)).toBe('');
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('open tabs drive placement; edge walls overlap floors and preserve Z through undo and load', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  const strip = page.getByTestId('terrain-library');
  // The open tab puts the placement tool in hand, so none of them is on the rail.
  const placementTools = '[data-tool="prop"], [data-tool="interactable"], [data-tool="placeTile"]';
  await expect(page.locator(placementTools)).toHaveCount(0);
  // Strip cards are kinds of tile now, named by their terrain id: the `tile-<shape>` cards
  // went with the Structures tab they belonged to.
  // The room is laid from tiles already: counted over what it opened with, once every file the
  // ground is drawn with has come in - the dirt under the roads is a big file, and a count taken
  // before it lands grows by every road tile halfway through the test.
  await expect.poll(() => page.evaluate(() => {
    const api = window.__engine!;
    const palette = (JSON.parse(api.exportProject()) as { terrainPalette?: { model?: string }[] }).terrainPalette ?? [];
    return palette.every((kind) => kind.model === undefined || api.assetStatus(kind.model) === 'ready');
  }), { timeout: 60_000 }).toBe(true);
  const laid = await page.evaluate(() => window.__engine!.pieceModels());
  await strip.locator('[data-item="platform"]').click();
  await page.evaluate(() => window.__engine!.buildAt(8, 6));
  await strip.locator('[data-item="barrier"]').click();
  for (const edge of ['North', 'East', 'South', 'West']) {
    await page.getByLabel(`Wall ${edge}`, { exact: true }).click();
    await page.evaluate(() => window.__engine!.buildAt(8, 6));
  }
  // Counted off the models: both kinds name a file, so `BuildingView` skips them and the
  // box layer is empty by design. `pieceModels` is what says how many are standing.
  await expect.poll(() => page.evaluate(() => window.__engine!.pieceModels())).toBe(laid + 5);
  await page.getByLabel('Build level', { exact: true }).fill('2.25');
  await page.getByLabel('Piece height', { exact: true }).fill('3.5');
  await page.getByLabel('Piece height', { exact: true }).press('Tab');
  await page.evaluate(() => window.__engine!.buildAt(8, 6));
  const saved = await page.evaluate(() => window.__engine!.exportProject());
  const scene = JSON.parse(saved).scenes[0];
  expect(scene.buildingTiles['8,6,2.25']).toMatchObject({ height: 3.5, level: 2.25, shape: 'wall' });
  await page.evaluate(() => window.__engine!.undo());
  await expect.poll(() => page.evaluate(() => window.__engine!.pieceModels())).toBe(laid + 5);
  expect(await page.evaluate((s) => window.__engine!.loadProjectText(s), saved)).toBe('');
  await page.evaluate(() => {
    window.__engine!.setMode('edit');
    window.__engine!.setEditorMode('terrain');
  });
  await strip.locator('[data-tab="props"]').click();
  const before = await page.evaluate(() => window.__engine!.propCount());
  await page.evaluate(() => window.__engine!.buildAt(6, 6));
  expect(await page.evaluate(() => window.__engine!.propCount())).toBe(before + 1);
  await strip.locator('[data-tab="tiles"]').click();
  await expect(strip.locator('[data-tab="tiles"]')).toHaveClass(/ph-on/);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('creatures immediately appear in authored scenes, undo correctly, and enter play', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-combat').click();
  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('hound');
  await strip.locator('[data-item]').click();
  const before = await page.evaluate(() => window.__engine!.authoredCreatureCount());
  const at = await page.evaluate(() => window.__engine!.buildScreenAt(8, 6));
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(before + 1);
  const id = await page.evaluate(() => {
    const doc = JSON.parse(window.__engine!.exportProject());
    return doc.scenes[0].encounters.flatMap((e: { adversaries: { id: string; adversary: string }[] }) => e.adversaries)
      .find((a: { adversary: string }) => a.adversary === 'rot-hound').id as string;
  });
  await page.evaluate(() => window.__engine!.undo());
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(before);
  await page.evaluate(() => window.__engine!.redo());
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(before + 1);
  await page.screenshot({ path: 'test-results/creature-placement.png' });
  await page.evaluate(() => window.__engine!.setMode('play'));
  expect(await page.evaluate((id) => window.__engine!.tileOf(id), id)).toBe(6 * 44 + 8);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByLabel('Creature Z').fill('3.25');
  await page.getByLabel('Creature Z').press('Tab');
  await page.evaluate(() => window.__engine!.buildAt(-200, 400));
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(before + 2);
  await page.evaluate(() => window.__engine!.addScene('Empty room'));
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(0);
  expect(errors).toEqual([]);
});

test('a creature clicked onto raised ground lands on the tile under the cursor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-combat').click();
  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('hound');
  await strip.locator('[data-item]').click();
  // The plateau in the north-east corner. A flat plane through the board's
  // base projects to a different tile from this camera angle than the raised
  // surface does, which is the whole point of the test. Which of its tiles can
  // be clicked depends on where the editor's chrome falls — the Z ladder is
  // docked over the board's right edge — so take the first raised one whose
  // surface projects onto the canvas rather than naming a tile that chrome may
  // later cover.
  const plateau = await page.evaluate(() => {
    const api = window.__engine!;
    // The dais is blocks now, not raised ground: the rows and columns it stands on, off its edge.
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 19; x >= 17; x -= 1) {
        const tile = y * 44 + x;
        const point = api.screenOf(tile);
        if (document.elementFromPoint(point.x, point.y)?.id === 'gl') return tile;
      }
    }
    return -1;
  });
  expect(plateau).toBeGreaterThan(0);
  const placements = async (): Promise<{ id: string; position: { x: number; y: number } }[]> =>
    page.evaluate(() => (JSON.parse(window.__engine!.exportProject()) as {
      scenes: { encounters: { adversaries: { id: string; position: { x: number; y: number } }[] }[] }[];
    }).scenes[0]!.encounters.flatMap((e) => e.adversaries));
  const before = new Set((await placements()).map((a) => a.id));
  // `screenOf` projects the tile's real surface, not the build plane, so the
  // click lands where a designer aiming at the plateau would put it.
  const at = await page.evaluate((tile) => window.__engine!.screenOf(tile), plateau);
  await page.mouse.click(at.x, at.y);
  const added = (await placements()).filter((a) => !before.has(a.id));
  expect(added).toHaveLength(1);
  expect(added[0]!.position).toMatchObject({ x: plateau % 44, y: Math.floor(plateau / 44) });
  expect(errors).toEqual([]);
});

test('a prop can be placed across a block of tiles, chosen in the panel', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => {
    window.__engine!.setMode('edit');
    window.__engine!.setTool('prop');
  });

  // The sizes are offered in the prop panel, and one of them is on to begin with.
  const sizes = page.getByTestId('prop-spans');
  await expect(sizes).toBeVisible();
  await expect(sizes.locator('button')).toHaveCount(7);
  await expect(sizes.locator('[data-span="1"]')).toHaveClass(/ph-on/);

  await sizes.locator('[data-span="3"]').click();
  await expect(sizes.locator('[data-span="3"]')).toHaveClass(/ph-on/);

  const before = await page.evaluate(() => window.__engine!.propCount());
  const at = await page.evaluate(() => window.__engine!.buildScreenAt(10, 10));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await page.evaluate(() => window.__engine!.propCount())).toBe(before + 1);

  // One prop in the document, carrying the size, anchored at the tile that was clicked.
  const placed = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0].decos.at(-1);
  expect(placed.span).toBe(3);
  expect(placed.position).toEqual({ x: 10, y: 10 });

  // A click elsewhere in the block is a click on that prop: it turns rather than putting a second
  // one down, which is the whole of what covering a block has to mean. Aimed at the middle of the
  // block rather than its far corner: (12, 12) is the vault's west wall, four blocks tall, and a
  // pointer there hits the top of the wall and reads as the tile behind it.
  const inside = await page.evaluate(() => window.__engine!.buildScreenAt(11, 11));
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await page.evaluate(() => window.__engine!.propCount())).toBe(before + 1);
  const turned = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0].decos.at(-1);
  expect(turned.rotation).toBeGreaterThan(0);
  // The same prop, still anchored and sized as it was: turned, not replaced.
  expect(turned.position).toEqual({ x: 10, y: 10 });
  expect(turned.span).toBe(3);

  // Back to one tile, and the document says nothing about the size of an ordinary prop.
  await sizes.locator('[data-span="1"]').click();
  const plain = await page.evaluate(() => window.__engine!.buildScreenAt(20, 20));
  await page.mouse.move(plain.x, plain.y);
  await page.mouse.down();
  await page.mouse.up();
  const ordinary = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0].decos.at(-1);
  expect(ordinary.position).toEqual({ x: 20, y: 20 });
  expect(Object.hasOwn(ordinary, 'span')).toBe(false);
  await page.screenshot({ path: 'test-results/prop-span.png' });
});

test('a prop previews before it is placed, is edited after, and its settings can be saved as a remix', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => {
    window.__engine!.setMode('edit');
    window.__engine!.setTool('prop');
  });
  const sizes = page.getByTestId('prop-spans');
  await sizes.locator('[data-span="4"]').click();

  // Hovering shows the prop that would go down, at the size it would go down at, before any
  // click: half see-through, so the ground it would cover can still be read under it.
  const at = await page.evaluate(() => window.__engine!.buildScreenAt(6, 20));
  await page.mouse.move(at.x, at.y, { steps: 6 });
  await expect.poll(async () => page.evaluate(() => window.__engine!.propGhost()?.span ?? 0), { timeout: 15_000 }).toBe(4);
  expect(await page.evaluate(() => window.__engine!.propGhost()!.id)).toBe('crate-prop');

  await page.mouse.down();
  await page.mouse.up();
  const placed = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0].decos.at(-1);
  expect(placed.span).toBe(4);

  // Placing took hold of it, so the panel is aimed at that prop: the size buttons now change it.
  await expect(page.getByTestId('prop-chosen')).toContainText('you placed or clicked');
  await sizes.locator('[data-span="2"]').click();
  const resized = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0].decos.at(-1);
  expect(resized.span).toBe(2);
  expect(resized.position).toEqual(placed.position);

  // Select takes hold of a prop too, and a prop held that way has the same settings to change:
  // picking one up with Select and finding no way to resize it is what made this a bug.
  await page.evaluate(() => window.__engine!.setTool('select'));
  const on = await page.evaluate(() => window.__engine!.buildScreenAt(6, 20));
  await page.mouse.move(on.x, on.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(sizes).toBeVisible();
  await expect(sizes.locator('[data-span="2"]')).toHaveClass(/ph-on/);
  await expect(page.getByTestId('prop-chosen')).toContainText('you placed or clicked');

  // And carrying it does not shrink it: the lift stretches what it holds about the size it
  // already is, which for a prop drawn across a block is not one tile.
  const away = await page.evaluate(() => window.__engine!.buildScreenAt(9, 22));
  await page.mouse.move(on.x, on.y);
  await page.mouse.down();
  await page.mouse.move(away.x, away.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const carried = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0].decos.at(-1);
  expect(carried.span, 'the prop shrank when it was picked up').toBe(2);
  await page.evaluate(() => window.__engine!.setTool('prop'));

  // Saved as a remix, it joins the Props strip with its settings on it.
  await page.getByTestId('prop-save-remix').click();
  const strip = page.getByTestId('terrain-library');
  const remix = strip.locator('.ph-card', { hasText: 'remix' }).first();
  await expect(remix).toBeVisible();
  await expect(remix).toContainText('Crate Prop 2×2');

  // Set something else by hand, then take the remix up: it brings its size back with it.
  await sizes.locator('[data-span="5"]').click();
  await remix.click();
  await expect(sizes.locator('[data-span="2"]')).toHaveClass(/ph-on/);
  const far = await page.evaluate(() => window.__engine!.buildScreenAt(14, 24));
  await page.mouse.move(far.x, far.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
  const fromRemix = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0].decos.at(-1);
  expect(fromRemix).toMatchObject({ model: 'crate-prop', span: 2, position: { x: 14, y: 24 } });

  // Forgetting the remix leaves what was placed from it exactly where it is.
  await page.getByTestId('prop-remove-remix').click();
  await expect(strip.locator('.ph-card', { hasText: 'remix' })).toHaveCount(0);
  const after = JSON.parse(await page.evaluate(() => window.__engine!.exportProject()));
  expect(after.scenes[0].decos.at(-1)).toMatchObject({ model: 'crate-prop', span: 2 });
  expect(after.propPresets).toBeUndefined();

  // And back in play there is no ghost left standing on the board.
  await page.evaluate(() => window.__engine!.setMode('play'));
  await expect.poll(async () => page.evaluate(() => window.__engine!.propGhost())).toBeNull();
});

test('a prop marked solid stops a walk across the whole block it covers', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setDiceSpeed(0);
    api.select('kara');
  });
  const from = (await page.evaluate(() => window.__engine!.standingAt('kara')))!;
  // Open ground a few tiles off, well clear of the party, inside the block a prop will cover.
  const block = { x: Math.round(from.x) + 3, y: Math.round(from.y) + 2 };
  const middle = { x: block.x + 1, y: block.y + 1 };

  await page.evaluate(() => {
    window.__engine!.setMode('edit');
    window.__engine!.setTool('prop');
  });
  const sizes = page.getByTestId('prop-spans');
  await sizes.locator('[data-span="3"]').click();
  const at = await page.evaluate((to) => window.__engine!.buildScreenAt(to.x, to.y), block);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  const scenery = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0].decos.at(-1);
  expect(scenery.span).toBe(3);
  expect(Object.hasOwn(scenery, 'solid'), 'a prop is scenery until somebody says otherwise').toBe(false);

  // Scenery: the party walks over it as if it were painted on the floor.
  await page.evaluate(() => window.__engine!.setMode('play'));
  const walked = await page.evaluate((to) => {
    const api = window.__engine!;
    api.select('kara');
    api.walkTo(to.x, to.y);
    return api.standingAt('kara')!;
  }, middle);
  expect(Math.hypot(walked.x - middle.x, walked.y - middle.y), 'scenery should not stop a walk').toBeLessThan(0.75);

  // Off it again before it becomes an obstacle. Nothing can find a way off a barred tile, so a
  // character standing where a prop is made solid is walled in where they stand - an authoring
  // foot-gun rather than a rule, but it is what would be being measured here otherwise.
  await page.evaluate((home) => window.__engine!.walkTo(home.x, home.y), from);

  // Now say it is an obstacle. The same tile is no longer somewhere anybody can stand.
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('prop-solid').click();
  await expect(page.getByTestId('prop-solid')).toHaveClass(/ph-on/);
  const solid = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0].decos.at(-1);
  expect(solid.solid).toBe(true);

  await page.evaluate(() => window.__engine!.setMode('play'));
  const stopped = await page.evaluate((to) => {
    const api = window.__engine!;
    api.select('kara');
    api.walkTo(to.x, to.y);
    return api.standingAt('kara')!;
  }, middle);
  const inside = stopped.x >= solid.position.x - 0.5 && stopped.x <= solid.position.x + 2.5
    && stopped.y >= solid.position.y - 0.5 && stopped.y <= solid.position.y + 2.5;
  expect(inside, `walked onto a solid prop at ${stopped.x},${stopped.y}`).toBe(false);

  // Every corner of the block, not only its middle: the whole thing is the obstacle.
  for (const corner of [{ x: solid.position.x, y: solid.position.y }, { x: solid.position.x + 2, y: solid.position.y + 2 }]) {
    const ended = await page.evaluate((to) => {
      const api = window.__engine!;
      api.walkTo(to.x, to.y);
      return api.standingAt('kara')!;
    }, corner);
    expect(Math.hypot(ended.x - corner.x, ended.y - corner.y), `stood on ${corner.x},${corner.y}`).toBeGreaterThan(0.6);
  }
});

test('a prop keeps its size, its solidity and its remixes when the project is saved and opened again', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => {
    window.__engine!.setMode('edit');
    window.__engine!.setTool('prop');
  });

  // A prop with every setting turned away from its default, and the settings kept as a remix.
  await page.getByTestId('prop-spans').locator('[data-span="3"]').click();
  await page.getByTestId('prop-solid').click();
  await page.getByTestId('prop-rotate').click();
  const at = await page.evaluate(() => window.__engine!.buildScreenAt(6, 20));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.getByTestId('prop-save-remix').click();

  const saved = await page.evaluate(() => window.__engine!.exportProject());
  const before = JSON.parse(saved);
  const placed = before.scenes[0].decos.at(-1);
  expect(placed).toMatchObject({ model: 'crate-prop', span: 3, solid: true, position: { x: 6, y: 20 } });
  expect(placed.rotation).toBeGreaterThan(0);
  expect(before.propPresets).toHaveLength(1);
  expect(before.propPresets[0]).toMatchObject({ model: 'crate-prop', span: 3, solid: true });

  // Opened again, exactly as opening the file would: the document is not a lossy round trip.
  // Every one of these is an optional field, and an optional field is the kind a serialiser
  // quietly drops - so what is asserted is the whole of what was written, not that it parsed.
  expect(await page.evaluate((text) => window.__engine!.loadProjectText(text), saved)).toBe('');
  const after = JSON.parse(await page.evaluate(() => window.__engine!.exportProject()));
  expect(after.scenes[0].decos.at(-1)).toEqual(placed);
  expect(after.propPresets).toEqual(before.propPresets);

  // The remix is offered in the strip again, and still brings its settings with it.
  const strip = page.getByTestId('terrain-library');
  await page.evaluate(() => window.__engine!.setTool('prop'));
  const remix = strip.locator('.ph-card', { hasText: 'remix' }).first();
  await expect(remix).toContainText('Crate Prop 3×3 · solid');
  await remix.click();
  await expect(page.getByTestId('prop-spans').locator('[data-span="3"]')).toHaveClass(/ph-on/);
  await expect(page.getByTestId('prop-solid')).toHaveClass(/ph-on/);

  // And the reloaded prop is still an obstacle, which is the part a document could carry and
  // the room could still get wrong: the bars are built from the document when the room is.
  await page.evaluate(() => window.__engine!.setMode('play'));
  const stopped = await page.evaluate(() => {
    const api = window.__engine!;
    api.setDiceSpeed(0);
    api.select('kara');
    api.walkTo(7, 21);
    return api.standingAt('kara')!;
  });
  const inside = stopped.x >= 5.5 && stopped.x <= 8.5 && stopped.y >= 19.5 && stopped.y <= 22.5;
  expect(inside, `walked into a reloaded solid prop at ${stopped.x},${stopped.y}`).toBe(false);
});

test('with Select in hand the ladder raises what it took hold of: a prop, as one undo step', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  // A prop down on open ground, then Select from the rail, pressed on it.
  const at = 20 * 44 + 6;
  const count = await page.evaluate((tile) => {
    const api = window.__engine!;
    api.setTool('prop');
    api.editAt(tile);
    return api.propCount();
  }, at);
  await page.locator('[data-testid="tool-rail"] [data-tool="select"]').click();
  await page.evaluate((tile) => window.__engine!.editAt(tile), at);

  const height = page.getByTestId('placement-height');
  await expect(height).toBeVisible();
  // It reads the prop's own height, not the plane's.
  await expect(height.getByLabel('Selected Z')).toHaveValue('0');
  for (let i = 0; i < 4; i++) await height.getByRole('button', { name: 'Raise build level' }).click();
  const z = (): Promise<number | undefined> => page.evaluate((n) => (JSON.parse(window.__engine!.exportProject()) as { scenes: { decos: { position: { z?: number } }[] }[] }).scenes[0]!.decos[n - 1]!.position.z, count);
  expect(await z()).toBe(1);
  await expect(height.getByLabel('Selected Z')).toHaveValue('1');
  await page.locator('[data-testid="undo"]').click();
  expect(await z()).toBe(0.75);
});
