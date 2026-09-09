import { test, expect, type Page } from '@playwright/test';

/**
 * A campaign put down and picked up, in a browser.
 *
 * Save and load have unit tests and had never been round-tripped as a player -
 * clicked, from the buttons, with the game reloading over the top. The save
 * also carries a bounded log now, which was changed without anybody watching a
 * real save come back.
 */

async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__polyheart!.setDiceSpeed(0));
  return errors;
}

/** Talk the Warden round, go down to the pit and open the strongbox. */
async function throughTheCampaign(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = window.__polyheart!;
    for (const id of a.objects()) {
      a.standBeside(id);
      a.use(id);
      if (!a.hasDialogue()) {
        while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
        continue;
      }
      for (let i = 0; i < 12 && a.hasDialogue(); i++) {
        if (a.dialogueOptions().length === 0) {
          a.answer({ kind: 'continue' });
          continue;
        }
        a.answer({ kind: 'choose', index: 0 });
        while (a.pendingKind() === 'check') a.answer({ kind: 'roll' });
      }
      break;
    }
    const pit = a.scenes().find((s) => s !== a.sceneId());
    if (pit !== undefined) a.travelTo(pit);
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    a.standBeside('strongbox');
    a.use('strongbox');
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
  });
}

test('a campaign put down comes back the way it was left', async ({ page }) => {
  const errors = await ready(page);
  await throughTheCampaign(page);

  const left = await page.evaluate(() => {
    const a = window.__polyheart!;
    return {
      scene: a.sceneId(),
      carried: a.carried().map((i) => i.name).sort(),
      journal: a.journal(),
      blocked: a.saveBlocked(),
      logLines: a.log().length,
    };
  });
  console.log('LEFT:', JSON.stringify(left));
  expect(left.blocked, 'nothing is in the way of a save here').toBeNull();

  // Save from the button a player would use.
  await page.locator('[data-testid="save"]').click();
  const slots = await page.evaluate(() => window.__polyheart!.saves());
  console.log('SLOTS:', JSON.stringify(slots));
  expect(slots.length, 'the save is in a slot').toBeGreaterThan(0);

  // Wreck the game: go back up, spend the loot, hurt somebody.
  await page.evaluate(() => {
    const a = window.__polyheart!;
    const other = a.scenes().find((s) => s !== a.sceneId());
    if (other !== undefined) a.travelTo(other);
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    a.wound('kara', 3);
  });
  const wrecked = await page.evaluate(() => {
    const a = window.__polyheart!;
    return { scene: a.sceneId(), hp: a.hitPoints('kara').marked };
  });
  console.log('WRECKED:', JSON.stringify(wrecked));
  expect(wrecked.scene).not.toBe(left.scene);

  // And pick it up again. Load is two clicks: the button opens the list of
  // saved games, and a slot in the list is the one that loads.
  await page.locator('[data-testid="load"]').click();
  const list = page.locator('[data-testid="saves"]');
  await expect(list).toBeVisible();
  console.log('SAVES PANEL:', JSON.stringify(await list.innerText()));
  await list.locator('[data-save="quick"] [data-testid="load-slot"]').click();
  const back = await page.evaluate(() => {
    const a = window.__polyheart!;
    return {
      scene: a.sceneId(),
      carried: a.carried().map((i) => i.name).sort(),
      journal: a.journal(),
      hp: a.hitPoints('kara').marked,
      logLines: a.log().length,
    };
  });
  console.log('BACK:', JSON.stringify(back));
  await page.screenshot({ path: 'test-results/save-load.png' });

  // The room, the pack and the quest are where they were left.
  expect(back.scene).toBe(left.scene);
  expect(back.carried).toEqual(left.carried);
  expect(back.journal).toEqual(left.journal);
  expect(back.hp, 'the wound after the save is gone').toBe(0);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the save carries the tail of the log, not the whole campaign', async ({ page }) => {
  const errors = await ready(page);
  await throughTheCampaign(page);

  // `saveText` reads the quick slot, so write one first - the same button a
  // player presses.
  await page.locator('[data-testid="save"]').click();

  const sizes = await page.evaluate(() => {
    const a = window.__polyheart!;
    const before = (a.saveText() ?? '').length;
    const lines = a.log().length;
    return { before, lines };
  });
  console.log('SAVE SIZE:', JSON.stringify(sizes));
  expect(sizes.before, 'a save was written').toBeGreaterThan(0);

  const capped = await page.evaluate(() => {
    const a = window.__polyheart!;
    const text = a.saveText() ?? '{}';
    const save = JSON.parse(text) as { log: unknown[] };
    return { logInSave: save.log.length, logInGame: a.log().length };
  });
  console.log('CAPPED:', JSON.stringify(capped));

  // Whatever the campaign wrote, the save carries at most the cap - and every
  // line it does carry is one the game still has.
  expect(capped.logInSave).toBeLessThanOrEqual(200);
  expect(capped.logInSave).toBeLessThanOrEqual(capped.logInGame);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a named save sits beside the autosave and loads on its own', async ({ page }) => {
  const errors = await ready(page);
  await throughTheCampaign(page);

  const named = await page.evaluate(() => window.__polyheart!.saveAs('After the strongbox'));
  console.log('NAMED:', JSON.stringify(named));
  expect(named, 'the named save was written').not.toBeNull();

  const slots = await page.evaluate(() => window.__polyheart!.saves());
  console.log('SLOTS:', JSON.stringify(slots));
  expect(slots.some((s) => s.name === 'After the strongbox')).toBe(true);

  // The panel lists it by its name, not by its id.
  const panel = page.locator('[data-testid="saves"]');
  if ((await panel.count()) > 0) {
    const text = await panel.innerText();
    console.log('SAVES PANEL:', JSON.stringify(text));
    expect(text).toContain('After the strongbox');
    for (const slot of slots) expect(text).not.toContain(slot.id);
  }

  // Wreck it, then load that slot by name.
  await page.evaluate(() => window.__polyheart!.wound('kara', 3));
  const loaded = await page.evaluate(() => {
    const a = window.__polyheart!;
    const slot = a.saves().find((s) => s.name === 'After the strongbox');
    const ok = slot === undefined ? false : a.loadSlot(slot.id);
    return { ok, hp: a.hitPoints('kara').marked, scene: a.sceneId() };
  });
  console.log('LOADED:', JSON.stringify(loaded));
  expect(loaded.ok).toBe(true);
  expect(loaded.hp).toBe(0);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
