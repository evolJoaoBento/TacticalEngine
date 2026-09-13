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

test('undoing an import in play takes it out of the running game at once, and redo puts it back', async ({ page }) => {
  await boot(page);
  // A passive handed to Kara: it changes a number her sheet is derived with, which is what the
  // running game keeps until something rebuilds it.
  const STEADY = {
    id: 'lantern-steadiness',
    name: 'Lantern Steadiness',
    source: { kind: 'granted', characters: ['kara'] },
    kind: 'passive',
    text: 'The lantern steadies her: two more Stress she can carry.',
    modifiers: [{ stat: 'stress', bonus: 2 }],
  };
  const read = () =>
    page.evaluate(() => {
      const api = window.__engine!;
      return { max: api.stressOf('kara').max, granted: api.loadout('kara').granted.includes('lantern-steadiness') };
    });
  const before = await read();
  expect(before.granted).toBe(false);

  const imported = await page.evaluate(
    (pack) => window.__engine!.importPackText(JSON.stringify(pack), 'steady.json'),
    { formatVersion: 2, abilities: [STEADY] },
  );
  expect(imported.imported).toBe(true);
  const after = { max: before.max + 2, granted: true };
  expect(await read()).toEqual(after);

  // Undone in play, the game gives it back now -- not on the next trip through the editor.
  expect(await page.evaluate(() => window.__engine!.undo())).toBe(true);
  expect(await read()).toEqual(before);
  expect(await page.evaluate(() => window.__engine!.redo())).toBe(true);
  expect(await read()).toEqual(after);

  // Mid-fight it is refused, as the import itself would be: nothing is rebuilt under the turn order.
  expect(await page.evaluate(() => window.__engine!.startFight())).toBe(true);
  expect(await page.evaluate(() => window.__engine!.undo())).toBe(false);
  expect(await read()).toEqual(after);
  const kept = await page.evaluate(() =>
    (JSON.parse(window.__engine!.exportProject()) as { abilities: { id: string }[] }).abilities.some((a) => a.id === 'lantern-steadiness'),
  );
  expect(kept).toBe(true);
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

test('the pack the build ships imports from where it is served, and its circle burns in a fight', async ({ page }) => {
  await boot(page);
  // Fetched from the server as a player would open it, so a pack left out of `public/` fails here.
  const text = await page.evaluate(async () => (await fetch('/packs/ember-spells.json')).text());
  const imported = await page.evaluate((pack) => window.__engine!.importPackText(pack, 'ember-spells.json'), text);
  expect(imported).toEqual({ imported: true, message: 'Imported ember-spells.json: 3 cards, 3 abilities, 2 conditions.' });

  const drawn = await page.evaluate(() => {
    const api = window.__engine!;
    api.setCards('mira', ['biting-circle']);
    api.select('mira');
    api.standNear(api.adversaries()[0]!);
    api.startFight();
    const offered = api.abilities('mira').map((a) => a.id);
    return { offered, status: api.useAbility('mira', 'biting-circle'), zones: api.zones().map((z) => z.name) };
  });
  expect(drawn.offered).toContain('biting-circle');
  expect(drawn.status).toBe('done');
  // Its condition came in with the pack: the engine no longer carries it.
  expect(drawn.zones).toContain('Biting Circle');
  await expect(page.locator('[data-testid="log"]')).toContainText('A circle burns itself into the floor');
});
