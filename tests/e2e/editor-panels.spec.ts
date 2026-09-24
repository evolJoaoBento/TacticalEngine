import { test, expect, type Page } from '@playwright/test';

/**
 * The editor's authoring panels, clicked.
 *
 * The map tools are driven by `demo.spec.ts` through the handles. The panels a
 * designer actually lives in - party, items, abilities, code, quests, assets -
 * had never been opened by a spec at all, and they are the largest surface in
 * the app with no browser coverage.
 */

const PANELS = [
  { open: 'open-party', panel: 'party-panel', add: 'add-character', close: 'close-party' },
  { open: 'open-items', panel: 'item-panel', add: 'add-item', close: 'close-items' },
  { open: 'open-abilities', panel: 'ability-panel', add: 'add-ability', close: 'close-abilities' },
  { open: 'open-code', panel: 'code-panel', add: 'add-code', close: 'close-code' },
] as const;

async function editing(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    window.__engine!.setDiceSpeed(0);
    window.__engine!.setMode('edit');
  });
  return errors;
}

test('every authoring panel opens and reads as English', async ({ page }) => {
  const errors = await editing(page);
  expect(await page.evaluate(() => window.__engine!.mode())).toBe('edit');

  for (const { open, panel, close } of PANELS) {
    await page.locator('[data-testid="open-content"]').click();
    const button = page.locator(`[data-testid="${open}"]`);
    await expect(button, `${open} is on screen`).toBeVisible();
    await button.click();
    const body = page.locator(`[data-testid="${panel}"]`);
    await expect(body, `${panel} opened`).toBeVisible();
    const text = await body.innerText();
    console.log(`${panel}:`, JSON.stringify(text.slice(0, 220)));
    expect(text.length, `${panel} has something in it`).toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/editor-${panel}.png` });
    // Each panel has its own Close: the button that opened it does not toggle.
    await page.locator(`[data-testid="${close}"]`).click();
  }

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a model file picked in the panel rides inside the project, and its own clips can be chosen', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-models"]').click();
  await expect(page.locator('[data-testid="models-panel"]')).toBeVisible();

  // A real rigged file, chosen the way a designer chooses one.
  await page
    .locator('[data-testid="add-model"] input[type="file"]')
    .setInputFiles('tests/fixtures/models/Fox.glb');

  const row = page.locator('[data-asset="fox"]');
  await expect(row).toBeVisible();
  // Carried inside the document rather than referenced beside it, and reported
  // by weight because the bytes themselves would fill the panel.
  await expect(row).toContainText('embedded');
  const declared = JSON.parse(await page.evaluate(() => window.__engine!.exportProject()));
  expect(declared.assets.find((a: { id: string }) => a.id === 'fox').url.startsWith('data:')).toBe(true);

  // Once the file is here, the options are the clip names it actually carries.
  await page.waitForFunction(() => window.__engine!.assetStatus('fox') === 'ready', undefined, {
    timeout: 15_000,
  });
  const idle = page.locator('[data-testid="asset-clip-idle-fox"]');
  await expect(idle.locator('option[value="Survey"]')).toHaveCount(1);
  await idle.selectOption('Survey');

  const chosen = JSON.parse(await page.evaluate(() => window.__engine!.exportProject()));
  expect(chosen.assets.find((a: { id: string }) => a.id === 'fox').clips).toEqual({ idle: 'Survey' });

  // Choosing a clip must not cost the file. Rebuilding the library on a settings
  // change would drop the loaded template, blanking the status and the very list
  // the choice was made from — which is what this panel did before `retune`.
  await expect(page.locator('[data-testid="asset-status-fox"]')).toHaveText('ready');
  await expect(idle).toHaveValue('Survey');
  await expect(idle.locator('option[value="Run"]')).toHaveCount(1);

  await page.screenshot({ path: 'test-results/models-panel.png' });
  await page.locator('[data-testid="close-models"]').click();
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a model picked in this browser is there again after a reload, until it is removed', async ({ page }) => {
  const errors = await editing(page);
  const openModels = async (): Promise<void> => {
    await page.locator('[data-testid="open-content"]').click();
    await page.locator('[data-testid="open-models"]').click();
    await expect(page.locator('[data-testid="models-panel"]')).toBeVisible();
  };
  /** What the project declares right now, by id. */
  const declared = (): Promise<string[]> =>
    page.evaluate(() => (JSON.parse(window.__engine!.exportProject()) as { assets: { id: string }[] }).assets.map((a) => a.id));
  /**
   * Whether this browser's model store holds the fox yet. The panel shows a model the moment it is
   * added, and the store is written after, in the background: a reload straight after the panel
   * changes can beat the write on a busy machine, and then the test is of the race, not the memory.
   * Opened as `model-memory.ts` opens it, shelf and all, so asking never leaves a store it cannot use.
   */
  const remembered = (): Promise<boolean> =>
    page.evaluate(() => new Promise<boolean>((resolve) => {
      const request = indexedDB.open('tactical-engine', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('models')) request.result.createObjectStore('models', { keyPath: 'id' });
      };
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const database = request.result;
        const got = database.transaction('models', 'readonly').objectStore('models').get('fox');
        got.onsuccess = () => { database.close(); resolve(got.result !== undefined); };
        got.onerror = () => { database.close(); resolve(false); };
      };
    }));

  await openModels();
  await page.locator('[data-testid="add-model"] input[type="file"]').setInputFiles('tests/fixtures/models/Fox.glb');
  await expect(page.locator('[data-asset="fox"]')).toBeVisible();
  await expect.poll(remembered, { timeout: 15_000 }).toBe(true);

  // Closing the tab is what used to lose it: the file rides inside the project,
  // and the project itself is not kept.
  const reopen = async (): Promise<void> => {
    await page.reload();
    await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 30_000 });
    await page.evaluate(() => window.__engine!.setMode('edit'));
  };
  await reopen();
  await expect.poll(declared, { timeout: 15_000 }).toContain('fox');
  const url = await page.evaluate(
    () => (JSON.parse(window.__engine!.exportProject()) as { assets: { id: string; url: string }[] }).assets.find((a) => a.id === 'fox')!.url,
  );
  expect(url.startsWith('data:')).toBe(true);

  // And removed is removed: what this browser remembers is forgotten with it.
  await openModels();
  page.once('dialog', (dialog) => void dialog.accept());
  // The remove button by name, not "the only mini button in the row": it stopped being the
  // only one the moment a second was added beside it.
  await page.locator('[data-testid="asset-remove-fox"]').click();
  await expect(page.locator('[data-asset="fox"]')).toHaveCount(0);
  await expect.poll(remembered, { timeout: 15_000 }).toBe(false);
  await reopen();
  await page.waitForTimeout(1500);
  expect(await declared()).not.toContain('fox');

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a designer can add one of each thing, and the panel shows it', async ({ page }) => {
  const errors = await editing(page);

  // Every Add asks for a name with `window.prompt`, and Playwright dismisses a
  // dialog nobody is listening for - which reads exactly like a dead button.
  // Answering it is what makes this a test of the panel rather than of the
  // browser default.
  page.on('dialog', (d) => void d.accept('Newcomer'));

  // What the panel itself says, before and after - which is what a designer
  // has to go on.  is a different question: the demo's party
  // lives in sheets rather than in , so counting that
  // array would be counting the wrong thing.
  const grew: string[] = [];
  for (const { open, panel, add, close } of PANELS) {
    await page.locator('[data-testid="open-content"]').click();
    await page.locator(`[data-testid="${open}"]`).click();
    const body = page.locator(`[data-testid="${panel}"]`);
    await expect(body).toBeVisible();
    const before = await body.innerText();

    const button = page.locator(`[data-testid="${add}"]`);
    expect(await button.count(), `${add} is offered`).toBeGreaterThan(0);
    await button.first().click();
    // The panel redraws on its own tick, so read after it has had one.
    await page.waitForTimeout(150);
    const after = await body.innerText();
    if (after !== before) grew.push(panel);
    console.log(`${panel}:`, before.length, '->', after.length);

    await page.locator(`[data-testid="${close}"]`).click();
  }
  console.log('GREW:', JSON.stringify(grew));
  expect(grew, 'every Add button adds something the panel shows').toEqual(PANELS.map((p) => p.panel));

  // And what it wrote is a project the game takes back.
  const reloaded = await page.evaluate(() => {
    const a = window.__engine!;
    return a.loadProjectText(a.exportProject());
  });
  console.log('RELOADED:', JSON.stringify(reloaded));
  expect(reloaded.toLowerCase(), 'the project it wrote loads again').not.toContain('error');

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a scene added in the editor is in the project and can be switched to', async ({ page }) => {
  const errors = await editing(page);

  const made = await page.evaluate(() => {
    const a = window.__engine!;
    const before = a.scenes().length;
    const id = a.addScene('A cellar');
    a.switchScene(id);
    return { before, id, after: a.scenes().length, editing: a.editScene(), tiles: a.sceneTiles() };
  });
  console.log('SCENE:', JSON.stringify(made));

  expect(made.after).toBe(made.before + 1);
  expect(made.editing).toBe(made.id);
  expect(made.tiles, 'the new room has ground to build on').toBeGreaterThan(0);

  // Put a tile down in it, and it sticks. A piece stamped on the cell rather than a kind
  // written into the ground: the placer puts down structures, so what says it landed is the
  // new room's `buildingTiles` and not `terrainAt`, which reads the ground underneath and
  // is the same either side of the edit by design.
  const stamped = await page.evaluate((sceneId) => {
    const a = window.__engine!;
    const pieces = (): string[] => {
      const doc = JSON.parse(a.exportProject()) as {
        scenes: { id: string; buildingTiles?: Record<string, unknown> }[];
      };
      return Object.keys(doc.scenes.find((scene) => scene.id === sceneId)?.buildingTiles ?? {});
    };
    a.setMode('edit');
    a.setTool('placeTile');
    a.setTerrain('block');
    const ok = a.editAt(0);
    return { ok, at: pieces(), undone: a.undo(), afterUndo: pieces() };
  }, made.id);
  console.log('STAMPED:', JSON.stringify(stamped));
  expect(stamped.ok).toBe(true);
  expect(stamped.at).toEqual(['0,0,0']);
  // Undo puts it back, which is what makes a map tool safe to try.
  expect(stamped.undone).toBe(true);
  expect(stamped.afterUndo).toEqual([]);

  await page.screenshot({ path: 'test-results/editor-scene.png' });
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('play from here: the room being edited, gathered round a tile or on its spawns', async ({ page }) => {
  const errors = await editing(page);

  // A new room, and the party put down in it round tile 5, without walking there.
  const there = await page.evaluate(() => {
    const a = window.__engine!;
    const id = a.addScene('A cellar');
    a.switchScene(id);
    const ok = a.playAt(5);
    return { id, ok, mode: a.mode(), playing: a.sceneId(), tiles: a.party().map((p) => a.tileOf(p)), selected: a.selected() };
  });
  console.log('THERE:', JSON.stringify(there));
  expect(there.ok).toBe(true);
  expect(there.mode).toBe('play');
  expect(there.playing).toBe(there.id);
  expect(there.tiles.every((t) => t >= 0)).toBe(true);
  expect(new Set(there.tiles).size).toBe(there.tiles.length);
  await page.screenshot({ path: 'test-results/play-here.png' });

  // And the button: back in the editor looking at the first room, Play here
  // takes the party there on its spawns.
  const back = await page.evaluate(() => {
    const a = window.__engine!;
    a.setMode('edit');
    a.switchScene(a.scenes()[0]!);
    return a.scenes()[0]!;
  });
  await page.locator('[data-testid="play-here"]').click();
  const landed = await page.evaluate(() => {
    const a = window.__engine!;
    return { mode: a.mode(), playing: a.sceneId(), tiles: a.party().map((p) => a.tileOf(p)) };
  });
  console.log('LANDED:', JSON.stringify(landed));
  expect(landed.mode).toBe('play');
  expect(landed.playing).toBe(back);
  expect(landed.tiles.every((t) => t >= 0)).toBe(true);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a character added in the Party panel is standing with the party when Play is pressed', async ({ page }) => {
  const errors = await editing(page);
  page.on('dialog', (d) => void d.accept('Tamsin'));

  const before = await page.evaluate(() => window.__engine!.party());

  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-party"]').click();
  await expect(page.locator('[data-testid="party-panel"]')).toBeVisible();
  await page.locator('[data-testid="add-character"]').first().click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="close-party"]').click();

  // Nothing on the board yet: the panel wrote a sheet, and that is all it does.
  expect(await page.evaluate(() => window.__engine!.party())).toEqual(before);

  const played = await page.evaluate(() => {
    const a = window.__engine!;
    a.setMode('play');
    const party = a.party();
    const anchor = a.selected() ?? party[0]!;
    return {
      party,
      tile: a.tileOf('tamsin'),
      anchorTile: a.tileOf(anchor),
      log: a.log().slice(-3).map((l) => l.text),
    };
  });
  console.log('PLAYED:', JSON.stringify(played));

  expect(played.party, 'the newcomer is in the party').toEqual([...before, 'tamsin']);
  expect(played.tile, 'and standing on the board').not.toBe(-1);
  const away = Math.max(
    Math.abs((played.tile % 44) - (played.anchorTile % 44)),
    Math.abs(Math.floor(played.tile / 44) - Math.floor(played.anchorTile / 44)),
  );
  expect(away, 'beside whoever was selected').toBeLessThanOrEqual(1);
  expect(played.log.join(' | '), 'the log says so').toContain('Tamsin joins the party.');

  await page.screenshot({ path: 'test-results/editor-joined.png' });
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test("a model can keep its file's own pivot, from the Models panel, and one undo puts it back on its base", async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-models"]').click();
  await page.locator('[data-testid="add-model"] input[type="file"]').setInputFiles('tests/fixtures/models/Fox.glb');
  const pivot = page.getByTestId('asset-pivot-fox');
  // Seated is the default, and it says so beside the box.
  await expect(pivot).not.toBeChecked();
  const pivotOf = (): Promise<string | null> =>
    page.evaluate(() => (JSON.parse(window.__engine!.exportProject()) as { assets: { id: string; pivot?: string }[] }).assets.find((a) => a.id === 'fox')?.pivot ?? null);
  expect(await pivotOf()).toBeNull();

  await pivot.check();
  expect(await pivotOf()).toBe('file');
  await expect(page.locator('[data-asset="fox"]')).toContainText("Held where the file's origin is.");

  await page.locator('[data-testid="undo"]').click();
  expect(await pivotOf()).toBeNull();
  await expect(pivot).not.toBeChecked();
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the Models page keeps Close in view however far down its list is scrolled', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-models"]').click();
  const list = page.getByTestId('asset-list');
  // Long enough to scroll: every shipped model has a row.
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const close = page.getByTestId('close-models');
  await expect(close).toBeInViewport();
  // Not only drawn: the thing on top at its middle is the button, so a click reaches it.
  const box = (await close.boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="close-models"]') !== null, [box.x + box.width / 2, box.y + box.height / 2])).toBe(true);
  await close.click();
  await expect(page.getByTestId('models-panel')).toHaveCount(0);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test("a party start taken hold of in the Inspector shows that character's sheet, and edits it", async ({ page }) => {
  const errors = await editing(page);
  await page.getByTestId('mode-inspect').click();
  const { tile, name } = await page.evaluate(() => {
    const a = window.__engine!;
    const project = JSON.parse(a.exportProject()) as { party: { name: string }[]; scenes: { width: number; spawns: { x: number; y: number }[] }[] };
    const [scene] = project.scenes;
    const start = scene!.spawns[0]!;
    return { tile: start.y * scene!.width + start.x, name: project.party[0]!.name };
  });
  await page.evaluate((t) => window.__engine!.editAt(t), tile);
  const pane = page.getByTestId('start-inspector');
  await expect(pane).toBeVisible();
  // The Party panel's own form, for whoever begins on the first start: the first of the party.
  await expect(pane.getByTestId('character-name')).toHaveValue(name);
  await expect(pane.getByTestId('character-derived')).toBeVisible();
  await pane.getByTestId('character-name').fill('Renamed');
  await pane.getByTestId('character-name').blur();
  const renamed = await page.evaluate(() => (JSON.parse(window.__engine!.exportProject()) as { party: { name: string }[] }).party[0]!.name);
  expect(renamed).toBe('Renamed');

  // And the Party panel says the same, since it is the same sheet. Its way back is an arrow, not a word.
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-party"]').click();
  await expect(page.getByTestId('party-panel').getByTestId('character-name')).toHaveValue('Renamed');
  const back = page.getByTestId('close-party');
  await expect(back).toHaveAttribute('aria-label', 'Back');
  await expect(back).not.toContainText('Close');
  await back.click();
  await expect(page.getByTestId('party-panel')).toHaveCount(0);
  expect(errors).toEqual([]);
});
