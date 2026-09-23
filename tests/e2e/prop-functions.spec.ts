import { test, expect, type Page } from '@playwright/test';

/**
 * What a prop does, picked in the editor and played: a container that gives up its things one at a
 * time, a door that stands in the way until it swings open on its front-left edge, a trap whose
 * success is a function of its own, and a portal pair that refuses a third holder.
 *
 * Every prop here is put down with the Prop tool and told what it does through the Function picker
 * the Terrain panel shows for it - the same select a person uses.
 */

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
    window.__engine!.setTool('prop');
  });
  return errors;
}

/** Put a prop down at x, y on the vault's floor. Placing it selects it, so the panel shows it. */
async function place(page: Page, x: number, y: number): Promise<void> {
  expect(await page.evaluate((tile) => window.__engine!.editAt(tile), y * 44 + x)).toBe(true);
}

const idOfSelected = (page: Page): Promise<string> => page.evaluate(() => window.__engine!.objectField('id') as string);

test('None is chosen until something else is, and a container gives up what was put in it', async ({ page }) => {
  const errors = await editing(page);
  const picker = page.getByTestId('function');
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue('');

  await place(page, 3, 9);
  await picker.selectOption('container');
  await expect(page.getByTestId('container-items')).toBeVisible();
  // One at a time: the same thing added twice is two of it.
  await page.getByTestId('container-add').click();
  await page.getByTestId('container-add').click();
  const item = await page.getByTestId('container-pick').inputValue();
  await expect(page.locator(`[data-testid="container-items"] [data-item="${item}"]`)).toContainText('×2');
  const id = await idOfSelected(page);
  expect(id).toMatch(/-3-9$/);

  const opened = await page.evaluate((id) => {
    const api = window.__engine!;
    api.setMode('play');
    api.standBeside(id);
    return { used: api.use(id), window: api.container() };
  }, id);
  expect(opened.used).toBe('done');
  expect(opened.window).toEqual({ id, lines: [{ item, count: 2 }] });

  // Taken through the window a player sees.
  await expect(page.getByTestId('container')).toBeVisible();
  await page.getByTestId('container-take').first().click();
  expect(await page.evaluate(() => window.__engine!.container()?.lines)).toEqual([{ item, count: 1 }]);
  expect(await page.evaluate((item) => window.__engine!.take(item), item)).toBe(true);
  await expect(page.getByTestId('container-empty')).toBeVisible();
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a door swings open on its front-left edge when used, and shut again', async ({ page }) => {
  const errors = await editing(page);
  await place(page, 3, 9);
  await page.getByTestId('function').selectOption('door');
  const id = await idOfSelected(page);

  const shut = await page.evaluate((id) => {
    const api = window.__engine!;
    api.setMode('play');
    api.standBeside(id);
    return { open: api.objectState(id).open, angle: api.doorAngle(id) };
  }, id);
  expect(shut).toEqual({ open: false, angle: 0 });

  expect(await page.evaluate((id) => window.__engine!.use(id), id)).toBe('done');
  expect(await page.evaluate((id) => window.__engine!.objectState(id).open, id)).toBe(true);
  // The swing plays out over a moment, and ends a quarter turn round.
  await expect.poll(() => page.evaluate((id) => window.__engine!.doorAngle(id), id)).toBeCloseTo(-Math.PI / 2, 2);

  // A door is used again to shut it, and swings back.
  expect(await page.evaluate((id) => window.__engine!.use(id), id)).toBe('done');
  expect(await page.evaluate((id) => window.__engine!.objectState(id).open, id)).toBe(false);
  await expect.poll(() => page.evaluate((id) => window.__engine!.doorAngle(id), id)).toBeCloseTo(0, 2);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a trap asks for the roll it was set, and its success is a function of its own', async ({ page }) => {
  const errors = await editing(page);
  await place(page, 3, 9);
  await page.getByTestId('function').selectOption('trapped');
  await page.getByTestId('trapped-trait').selectOption('strength');
  await page.getByTestId('trapped-difficulty').fill('1');
  await page.getByTestId('trapped-difficulty').dispatchEvent('change');
  // Both ways it can go start at None, and it is not repeatable until it is ticked.
  await expect(page.getByTestId('success-function')).toHaveValue('');
  await expect(page.getByTestId('failure-function')).toHaveValue('');
  await expect(page.getByTestId('trapped-repeatable')).not.toBeChecked();
  await page.getByTestId('success-function').selectOption('container');
  await page.getByTestId('success-container-add').click();
  const item = await page.getByTestId('success-container-pick').inputValue();
  const id = await idOfSelected(page);

  const played = await page.evaluate((id) => {
    const api = window.__engine!;
    api.setMode('play');
    api.standBeside(id);
    const used = api.use(id);
    const asked = api.pendingKind();
    const answered = api.answer({ kind: 'roll' });
    return { used, asked, answered, window: api.container() };
  }, id);
  expect(played.used).toBe('waiting');
  expect(played.asked).toBe('check');
  expect(played.answered).toBe('done');
  // Difficulty 1 cannot be failed, so the success ran: the container it holds opened.
  expect(played.window).toEqual({ id, lines: [{ item, count: 1 }] });
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a portal pair is two: a third holder is asked for another id, and a pair carries the party across', async ({ page }) => {
  const errors = await editing(page);
  // The first is given a pair id by hand.
  await place(page, 3, 9);
  await page.getByTestId('function').selectOption('portal');
  await expect(page.getByTestId('portal-unpaired')).toBeVisible();
  await page.getByTestId('portal-pair').fill('ferry');
  await expect(page.getByTestId('portal-partner')).toContainText('Waiting for its other end');
  const near = await idOfSelected(page);

  // The next is put down as the panel stands, so it is placed as the other end.
  await place(page, 15, 9);
  await expect(page.getByTestId('portal-pair')).toHaveValue('ferry');
  await expect(page.getByTestId('portal-partner')).toContainText(`Paired with ${near}`);
  const far = await idOfSelected(page);

  // A third would be one too many, so it comes down with no pair, and is refused one as it is typed.
  await place(page, 9, 9);
  await expect(page.getByTestId('portal-unpaired')).toBeVisible();
  await page.getByTestId('portal-pair').fill('ferry');
  await expect(page.getByTestId('portal-taken')).toContainText('choose another id');
  expect(await page.evaluate(() => window.__engine!.objectField('id'))).not.toBe(far);
  await page.getByTestId('portal-pair').fill('ferry-back');
  await expect(page.getByTestId('portal-taken')).toHaveCount(0);

  const crossed = await page.evaluate(({ near, far }) => {
    const api = window.__engine!;
    api.setMode('play');
    api.standBeside(near);
    const who = api.selected()!;
    return { used: api.use(near), at: api.tileOf(who), far };
  }, { near, far });
  expect(crossed.used).toBe('done');
  // Blinked across, not walked: nobody is gliding over the room to get there.
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__engine!.gliding())).toBe(0);
  // And the camera goes with them: over where they came out.
  const came = await page.evaluate(() => { const at = window.__engine!.standingAt(window.__engine!.selected()!)!; return { x: at.x - 21.5, z: at.y - 15.5 }; });
  const looking = await page.evaluate(() => window.__engine!.camera().target);
  expect(Math.hypot(looking.x - came.x, looking.z - came.z)).toBeLessThan(0.1);
  // Stepped out beside the other end, across the room.
  const [ax, ay] = [crossed.at % 44, Math.floor(crossed.at / 44)];
  expect(Math.max(Math.abs(ax - 15), Math.abs(ay - 9))).toBeLessThanOrEqual(2);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a click on a thing out of reach walks up to it and uses it', async ({ page }) => {
  const errors = await editing(page);
  await place(page, 12, 20);
  await page.getByTestId('function').selectOption('container');
  await page.getByTestId('container-add').click();
  const id = await idOfSelected(page);

  const used = await page.evaluate((id) => {
    const api = window.__engine!;
    api.setMode('play');
    const who = api.selected()!;
    const before = api.tileOf(who);
    // The same as the board's click on it: walk up, then use.
    const status = api.approach(id);
    return { status, before, after: api.tileOf(who), open: api.container()?.id ?? null };
  }, id);
  expect(used.status).toBe('done');
  expect(used.after).not.toBe(used.before);
  // Stood within reach of it: one tile, diagonals counting.
  const [x, y] = [used.after % 44, Math.floor(used.after / 44)];
  expect(Math.max(Math.abs(x - 12), Math.abs(y - 20))).toBeLessThanOrEqual(1);
  expect(used.open).toBe(id);
  await expect(page.getByTestId('container')).toBeVisible();
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
