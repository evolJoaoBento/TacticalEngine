import { test, expect, type Page } from '@playwright/test';

/**
 * What a party does between fights: take the level they earned, rest, and put
 * on what they found.
 *
 * These have unit coverage and had never been driven as a player - clicked,
 * with the panels on screen. The pit pass left three Level up buttons unpressed
 * and this is the spec that presses one.
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

test('the level they earned is taken by clicking it', async ({ page }) => {
  const errors = await ready(page);
  await throughTheCampaign(page);

  const before = await page.evaluate(() => {
    const a = window.__polyheart!;
    return { level: a.characterLevel('kara'), waiting: a.awaitingLevel(), hp: a.hitPoints('kara') };
  });
  console.log('EARNED:', JSON.stringify(before));
  expect(before.waiting, 'the strongbox handed the party a level').toContain('kara');

  // The button on Kara's card, which the pit pass left unpressed.
  await page.locator('[data-testid="hud"] [data-testid="level-up-button"]').first().click();
  const panel = page.locator('[data-testid="level-up"]');
  await expect(panel).toBeVisible();
  console.log('PANEL:', JSON.stringify(await panel.innerText()));
  await page.screenshot({ path: 'test-results/level-up.png' });

  // Spend the level on two *different* advancements. Taking the same one twice
  // is a real thing the panel refuses - both picks default to the same trait,
  // and it says "agility is already marked" rather than letting it through -
  // so a slot apiece is what a player would click.
  const options = page.locator('[data-testid="level-up"] [data-pick]');
  await options.nth(1).click();
  await options.nth(2).click();
  await expect(page.locator('[data-testid="picks"]')).toBeVisible();

  const issues = page.locator('[data-testid="level-issues"]');
  console.log('ISSUES:', (await issues.count()) > 0 ? await issues.innerText() : 'none');
  // Level 2 grants a new Experience and the panel will not let the level be
  // taken until it is named - it says so, in those words, which is how this
  // test found out. A player types something; so does this.
  await page.locator('[data-testid="experience"]').fill('Survived the vault');
  await page.locator('[data-testid="take-level"]').click();
  const post = page.locator('[data-testid="level-issues"]');
  console.log('AFTER ISSUES:', (await post.count()) > 0 ? await post.innerText() : 'none');

  const after = await page.evaluate(() => {
    const a = window.__polyheart!;
    return { level: a.characterLevel('kara'), waiting: a.awaitingLevel(), hp: a.hitPoints('kara'), log: a.log().slice(-3).map((l) => l.text) };
  });
  console.log('TAKEN:', JSON.stringify(after));

  expect(after.level, 'the level went on the sheet').toBe(before.level + 1);
  expect(after.waiting, 'and the card stopped asking').not.toContain('kara');
  await page.screenshot({ path: 'test-results/level-taken.png' });
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a rest is taken from the panel, and puts something back', async ({ page }) => {
  const errors = await ready(page);
  await throughTheCampaign(page);

  // Something to heal: a rest that restores nothing proves nothing.
  await page.evaluate(() => {
    const a = window.__polyheart!;
    a.wound('kara', 2);
    a.markStress('kara', 2);
  });
  const hurt = await page.evaluate(() => {
    const a = window.__polyheart!;
    return { hp: a.hitPoints('kara'), stress: a.stressOf('kara') };
  });
  expect(hurt.hp.marked).toBeGreaterThan(0);

  await page.locator('[data-testid="open-rest"]').click();
  const panel = page.locator('[data-testid="rest"]');
  await expect(panel).toBeVisible();
  console.log('REST PANEL:', JSON.stringify(await panel.innerText()));
  await page.screenshot({ path: 'test-results/rest.png' });

  await page.locator('[data-testid="rest-long"]').click();
  await page.locator('[data-testid="take-rest"]').click();

  const rested = await page.evaluate(() => {
    const a = window.__polyheart!;
    return { hp: a.hitPoints('kara'), stress: a.stressOf('kara'), log: a.log().slice(-4).map((l) => l.text) };
  });
  console.log('RESTED:', JSON.stringify(rested, null, 1));

  // A long rest puts everything back, which is the one rest with no dice in it.
  expect(rested.hp.marked).toBeLessThan(hurt.hp.marked);
  expect(rested.stress.marked).toBeLessThanOrEqual(hurt.stress.marked);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('what the strongbox paid out can be put on', async ({ page }) => {
  const errors = await ready(page);
  await throughTheCampaign(page);

  const before = await page.evaluate(() => {
    const a = window.__polyheart!;
    return { gear: a.gear('kara'), carried: a.carried().map((i) => i.name) };
  });
  console.log('CARRYING:', JSON.stringify(before));
  // The pit's strongbox pays out a round shield, among other things. The table
  // rolls three of five weighted entries, so nothing in it is guaranteed on its
  // own -- this is deterministic because the scene seeds its RNG with a constant
  // and the campaign walk above is fixed, which also means a change to any
  // earlier roll can move it.
  expect(before.carried.join(' ')).toMatch(/shield/i);

  // The Equip button beside it in the pack.
  const equip = page.locator('[data-testid="pack"] [data-testid="equip"]');
  await expect(equip.first()).toBeVisible();
  await equip.first().click();

  const after = await page.evaluate(() => {
    const a = window.__polyheart!;
    return {
      gear: a.gear('kara'),
      hud: a.party().map((id) => a.gear(id).armor),
      carried: a.carried().map((i) => i.name),
      log: a.log().slice(-2).map((l) => l.text),
    };
  });
  console.log('WEARING:', JSON.stringify(after));
  await page.screenshot({ path: 'test-results/equipped.png' });

  // Something changed hands, and the log says so rather than showing an id.
  //
  // Not the gear line: `gearOf` reports the primary weapon and the armour, and this table
  // pays out neither kind. It pays a longsword Kara already carries and a round shield,
  // which is a secondary the readout does not show, so equipping either moves nothing the
  // gear line can see. What the equip demonstrably does is log it and empty the row.
  expect(after.log.join(' ')).toMatch(/takes up|puts on/);
  expect(after.carried.length).toBeLessThan(before.carried.length);
  // And whatever it reads as, it reads as English.
  expect(after.gear.armor).not.toMatch(/-/);
  expect(after.gear.weapon).not.toMatch(/-/);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
