import { expect, test } from '@playwright/test';

test('Alt + mouse rotates placement without stamping or panning', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  await page.getByLabel('Build X', { exact: true }).fill('40');
  await page.getByLabel('Build Y', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await page.getByTestId('build-wall').click();
  const at = await page.evaluate(() => window.__polyheart!.buildScreenAt(40, 20));
  const camera = await page.evaluate(() => window.__polyheart!.camera());
  await page.mouse.move(at.x, at.y);
  const north = await page.evaluate(() => window.__polyheart!.buildScreenAt(40, 19));
  const west = await page.evaluate(() => window.__polyheart!.buildScreenAt(39, 20));
  const east = await page.evaluate(() => window.__polyheart!.buildScreenAt(41, 20));
  await page.keyboard.down('Alt');
  await page.mouse.move(at.x + 5, at.y);
  await expect(page.getByTestId('build-rotate')).toContainText('0°');
  await page.mouse.move(west.x, west.y, { steps: 5 });
  await expect(page.getByTestId('build-rotate')).toContainText('90°');
  await page.mouse.move(east.x, east.y, { steps: 5 });
  await expect(page.getByTestId('build-rotate')).toContainText('270°');
  await page.mouse.move(north.x, north.y, { steps: 5 });
  await expect(page.getByTestId('build-rotate')).toContainText('0°');
  // Both painting and right-drag camera movement are suppressed during rotation.
  await page.mouse.down();
  await page.mouse.move(west.x, west.y, { steps: 5 });
  await page.mouse.up();
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(west.x, west.y, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect(page.getByTestId('build-rotate')).toContainText('90°');
  expect(await page.evaluate(() => window.__polyheart!.buildingStats().tiles)).toBe(0);
  expect(await page.evaluate(() => window.__polyheart!.camera())).toEqual(camera);
  await page.screenshot({ path: 'test-results/alt-placement-rotation.png' });
  await page.keyboard.up('Alt');
  await page.mouse.click(at.x, at.y);
  const saved = await page.evaluate(() => {
    const api = window.__polyheart!;
    return { text: api.exportProject(), scene: api.editScene() };
  });
  const scene = JSON.parse(saved.text).scenes.find((s: { id: string }) => s.id === saved.scene);
  expect(scene.buildingTiles['40,20,0']).toMatchObject({ shape: 'wall', rotation: 1 });
  expect(await page.evaluate(() => window.__polyheart!.undo())).toBe(true);
  expect(await page.evaluate(() => window.__polyheart!.buildingStats().tiles)).toBe(0);
  expect(await page.evaluate(() => window.__polyheart!.redo())).toBe(true);
  expect(await page.evaluate((text) => window.__polyheart!.loadProjectText(text), saved.text)).toBe('');
  expect(await page.evaluate(() => window.__polyheart!.errors)).toEqual([]);
});

test('Alt chooses the facing of new props and blur ends a rotation gesture', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  await page.evaluate(() => {
    window.__polyheart!.setMode('edit');
    window.__polyheart!.setTool('prop');
  });
  const at = await page.evaluate(() => window.__polyheart!.buildScreenAt(10, 10));
  const west = await page.evaluate(() => window.__polyheart!.buildScreenAt(9, 10));
  const east = await page.evaluate(() => window.__polyheart!.buildScreenAt(11, 10));
  await page.mouse.move(at.x, at.y);
  const before = await page.evaluate(() => window.__polyheart!.propCount());
  await page.keyboard.down('Alt');
  await page.mouse.move(west.x, west.y, { steps: 5 });
  await expect(page.getByTestId('prop-rotate')).toContainText('90°');
  expect(await page.evaluate(() => window.__polyheart!.propCount())).toBe(before);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Alt');
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Alt');
  await page.mouse.move(east.x, east.y, { steps: 5 });
  await expect(page.getByTestId('prop-rotate')).toContainText('270°');
  await page.keyboard.up('Alt');
  const placed = await page.evaluate(() => {
    const api = window.__polyheart!;
    api.buildAt(40, 20);
    const scene = JSON.parse(api.exportProject()).scenes.find((s: { id: string }) => s.id === api.editScene());
    return scene.decos.find((d: { position: { x: number; y: number } }) => d.position.x === 40 && d.position.y === 20);
  });
  expect(placed.rotation).toBeCloseTo(3 * Math.PI / 2);
  expect(await page.evaluate(() => window.__polyheart!.errors)).toEqual([]);
});

test('builds outside the board, stacks, rotates, erases and restores saved tiles', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  await expect(page.locator('[data-tab="tiles"]')).toHaveClass(/ph-on/);
  await page.getByLabel('Build X', { exact: true }).fill('-900000');
  await page.getByLabel('Build Y', { exact: true }).fill('900000');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  const at = await page.evaluate(() => window.__polyheart!.buildScreenAt(-900000, 900000));
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.__polyheart!.buildingStats().tiles)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__polyheart!.buildingStats().residentChunks)).toBe(1);

  await page.getByRole('button', { name: 'Raise build level', exact: true }).click();
  await page.getByTestId('build-stairs').click();
  await page.getByTestId('build-rotate').click();
  // Use the same public controller path to stamp an upper level.
  expect(await page.evaluate(() => window.__polyheart!.buildAt(-900000, 900000))).toBe(true);
  const saved = await page.evaluate(() => window.__polyheart!.exportProject());
  const sceneId = await page.evaluate(() => window.__polyheart!.editScene());
  const scene = JSON.parse(saved).scenes.find((s: { id: string }) => s.id === sceneId);
  expect(scene.buildingTiles['-900000,900000,0'].shape).toBe('block');
  expect(scene.buildingTiles['-900000,900000,0.25']).toMatchObject({ shape: 'stairs', rotation: 1 });
  expect(scene.terrain.length).toBe(scene.width * scene.height);

  await page.locator('[data-tool="eraseTile"]').click();
  await page.evaluate(() => window.__polyheart!.buildAt(-900000, 900000));
  expect(await page.evaluate(() => window.__polyheart!.buildingStats().tiles)).toBe(1);
  await page.evaluate(() => window.__polyheart!.undo());
  expect(await page.evaluate(() => window.__polyheart!.buildingStats().tiles)).toBe(2);
  await page.evaluate(() => window.__polyheart!.redo());
  expect(await page.evaluate(() => window.__polyheart!.buildingStats().tiles)).toBe(1);
  const loadResult = await page.evaluate((text) => window.__polyheart!.loadProjectText(text), saved);
  expect(loadResult).toBe('');
  expect(await page.evaluate(() => window.__polyheart!.buildingStats().tiles)).toBe(2);
  expect(errors).toEqual([]);
});

test('renders a stacked build with a brush, level controls and bounded LOD', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  await page.getByLabel('Build X', { exact: true }).fill('40');
  await page.getByLabel('Build Y', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await page.locator('[data-brush="5"]').click();
  await page.getByTestId('build-floor').click();
  await page.evaluate(() => {
    const api = window.__polyheart!;
    for (const x of [35, 40, 45]) {
      for (const y of [15, 20, 25]) api.buildAt(x, y);
    }
  });
  await page.locator('[data-brush="1"]').click();
  await page.getByTestId('build-block').click();
  for (let level = 0; level < 3; level++) {
    await page.getByLabel('Build level', { exact: true }).fill(String(level));
    await page.getByLabel('Build level', { exact: true }).press('Tab');
    // The room's four walls, with a gap in the east one for the stairs.
    await page.evaluate(() => {
      const api = window.__polyheart!;
      for (let x = 33; x <= 47; x++) {
        api.buildAt(x, 13);
        api.buildAt(x, 27);
      }
      for (let y = 14; y < 27; y++) {
        api.buildAt(33, y);
        if (y < 19 || y > 21) api.buildAt(47, y);
      }
    });
  }
  await page.getByTestId('build-stairs').click();
  await page.getByLabel('Build level', { exact: true }).fill('0');
  await page.getByLabel('Build level', { exact: true }).press('Tab');
  await page.evaluate(() => window.__polyheart!.buildAt(45, 20));
  await page.getByRole('button', { name: 'Raise build level', exact: true }).click();
  await page.evaluate(() => window.__polyheart!.buildAt(45, 21));
  await page.getByRole('button', { name: 'Raise build level', exact: true }).click();
  await page.evaluate(() => window.__polyheart!.buildAt(45, 22));
  await expect.poll(() => page.evaluate(() => window.__polyheart!.buildingStats().instances)).toBeGreaterThan(100);
  const stats = await page.evaluate(() => window.__polyheart!.buildingStats());
  expect(stats.residentChunks).toBeLessThanOrEqual(96);
  expect(stats.triangles).toBeGreaterThan(0);
  await page.mouse.move(640, 360);
  await page.screenshot({ path: 'test-results/building-editor.png' });
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => window.__polyheart!.errors)).toEqual([]);
});
