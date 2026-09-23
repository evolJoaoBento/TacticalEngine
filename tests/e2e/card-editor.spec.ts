import { test, expect, type Page } from '@playwright/test';

/**
 * The Cards panel's preview: the card as the player will see it, redrawn as its author types.
 *
 * What the form writes is `demo.spec.ts`'s to check; this spec reads the face beside it, and
 * that the words on the face are the words the deck browser will read, since both are written.
 */

/** A 1x1 PNG, small enough to paste and real enough for the browser to decode. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function editingCards(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-abilities"]').click();
  return errors;
}

test('shows the card as the player will see it, and redraws it as its author types', async ({ page }) => {
  const errors = await editingCards(page);
  // `+ Card` asks for a name; nothing else in this test opens a dialog.
  page.on('dialog', (dialog) => void dialog.accept('Banner Cry'));
  const panel = page.locator('[data-testid="ability-panel"]');
  const face = panel.locator('[data-testid="card-preview"] .face');

  // The demo's own card, handed to Quim: drawn as the deck browser draws a granted card, with its words.
  await panel.locator('[data-ability="rally-the-line"]').click();
  await expect(face).toHaveClass(/face-granted/);
  await expect(face.locator('h3')).toHaveText('Rally the Line');
  await expect(face.locator('.face-domain')).toHaveText('Given');
  await expect(face.locator('.face-rules')).toContainText('Spend a Light');

  // A new card wears the name it was given, then whatever is typed, name and text.
  await panel.locator('[data-testid="add-ability"]').click();
  await expect(face.locator('h3')).toHaveText('Banner Cry');
  await panel.locator('[data-testid="ability-name"]').fill('Banner Call');
  await expect(face.locator('h3')).toHaveText('Banner Call');
  await expect(face.locator('.face-rules')).toHaveText('');
  await panel.locator('[data-testid="ability-text"]').fill('Raise the banner.');
  await expect(face.locator('.face-rules')).toHaveText('Raise the banner.');

  // Into a loadout: the level and recall a chosen card wears, and its domain, as the form has them.
  await panel.locator('[data-testid="card-grant-kind"]').selectOption('chosen');
  await expect(face).not.toHaveClass(/face-granted/);
  await expect(face.locator('.face-level b')).toHaveText('1');
  await panel.locator('[data-testid="card-level"]').fill('3');
  await expect(face.locator('.face-level b')).toHaveText('3');
  await expect(face.locator('.face-domain')).toHaveText(await panel.locator('[data-testid="card-domain"]').inputValue());

  // Art imported here is on the face at once, and given back.
  await expect(face.locator('.face-art > svg')).toBeVisible();
  await panel.getByTestId('art-file').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: PIXEL });
  await expect(face.locator('.face-art img')).toHaveAttribute('src', /^data:image\/jpeg/);
  await page.screenshot({ path: 'test-results/card-editor-preview.png' });
  await panel.getByTestId('clear-art').click();
  await expect(face.locator('.face-art > svg')).toBeVisible();

  // The words reached the card the player reads, not only the ability the bar reads.
  const written = await page.evaluate(() => {
    const project = JSON.parse(window.__engine!.exportProject()) as {
      cards: { id: string; name: string; text: string }[];
      abilities: { id: string; name: string; text: string }[];
    };
    return { card: project.cards.find((c) => c.id === 'banner-cry'), ability: project.abilities.find((a) => a.id === 'banner-cry') };
  });
  expect(written.card).toMatchObject({ name: 'Banner Call', text: 'Raise the banner.' });
  expect(written.ability).toMatchObject({ name: 'Banner Call', text: 'Raise the banner.' });

  // A card no ability sits on has a face too, and a script written onto a copy takes the card's
  // words with it: the form and the face agree from the first click.
  await panel.locator('[data-card="cut-purse-strings"]').click();
  await expect(face.locator('h3')).toHaveText('Cut Purse Strings');
  const printed = await panel.locator('[data-testid="card-text"]').inputValue();
  expect(printed).not.toBe('');
  await expect(face.locator('.face-rules')).toContainText(printed.split('\n')[0]!);
  await panel.locator('[data-testid="card-copy-pack"]').click();
  await panel.locator('[data-testid="card-add-script"]').click();
  await expect(panel.locator('[data-testid="ability-text"]')).toHaveValue(printed);
  await expect(face.locator('.face-rules')).toContainText(printed.split('\n')[0]!);

  expect(errors).toEqual([]);
});
