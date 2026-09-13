import { test, expect, type Page } from '@playwright/test';

/**
 * Importing a pack: content somebody else wrote, brought into the project being edited, and
 * played. `window.__engine`'s type is declared once, in `demo.spec.ts`.
 */

const CARD = {
  id: 'lantern-oath',
  name: 'Lantern Oath',
  source: { kind: 'granted', characters: ['kara'] },
  text: 'Kara lifts a lantern and swears by it.',
  effects: [{ kind: 'log', text: 'The lantern oath is sworn.' }],
};

const WRAITH = {
  id: 'glass-wraith',
  name: 'Glass Wraith',
  tier: 1,
  role: 'skulk',
  difficulty: 12,
  thresholds: { major: 6, severe: 11 },
  hitPoints: 4,
  stress: 3,
  attackName: 'Shard',
  attackModifier: { count: 0, sides: 0, modifier: 1 },
  attackRange: 'melee',
  attackDamage: { count: 1, sides: 8, modifier: 1, types: ['magic'] },
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

test('a pack picked under Project brings creatures to place and cards to play, as one undo', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__engine!.setMode('edit'));

  let said = '';
  page.once('dialog', (dialog) => {
    said = dialog.message();
    void dialog.accept();
  });
  await page.getByTestId('open-project').click();
  await page
    .getByTestId('import-pack')
    .locator('input')
    .setInputFiles({
      name: 'lanterns.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ formatVersion: 2, adversaries: [WRAITH], abilities: [CARD] })),
    });
  // A version-2 pack whose card was handed to Kara the old way: format version 3 reads it as a
  // card of its own, granted to her, with the ability sitting on it -- so a card arrives too.
  await expect.poll(() => said).toBe('Imported lanterns.json: 1 card, 1 adversary, 1 ability.');

  // The Combat strip offers the creature the pack brought.
  await page.getByTestId('mode-combat').click();
  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('wraith');
  await expect(strip.locator('[data-item="glass-wraith"]')).toBeVisible();

  // And play reads the card.
  const played = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('play');
    const offered = api.abilities('kara').map((a) => a.id);
    return { offered, status: api.useAbility('kara', 'lantern-oath') };
  });
  expect(played.offered).toContain('lantern-oath');
  expect(played.status).toBe('done');
  await expect(page.locator('[data-testid="log"]')).toContainText('The lantern oath is sworn.');

  // One step back takes the whole pack with it.
  const undone = await page.evaluate(() => {
    const api = window.__engine!;
    api.undo();
    const project = JSON.parse(api.exportProject()) as { abilities: { id: string }[]; adversaries: { id: string }[] };
    return { cards: project.abilities.map((a) => a.id), creatures: project.adversaries.map((a) => a.id) };
  });
  expect(undone.cards).not.toContain('lantern-oath');
  expect(undone.creatures).not.toContain('glass-wraith');
});

test('a file that is not a pack is refused, and the project is left as it was', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const api = window.__engine!;
    api.setMode('edit');
    const before = api.exportProject();
    const notJson = api.importPackText('{ this is not json', 'broken.json');
    const notPack = api.importPackText(JSON.stringify({ hello: 'world' }), 'hello.json');
    return { notJson, notPack, unchanged: api.exportProject() === before };
  });

  expect(result.notJson).toEqual({ imported: false, message: 'Could not import broken.json: it is not JSON' });
  expect(result.notPack.imported).toBe(false);
  expect(result.notPack.message).toMatch(/none of the lists a pack is made of/);
  expect(result.unchanged).toBe(true);
});
