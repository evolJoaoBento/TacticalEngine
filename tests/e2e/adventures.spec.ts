import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from './fixtures';

/**
 * Adventures (`ui/Adventures.tsx`, `adventure-library.ts`), played: a project file imported from the main menu - and a
 * file that is not one refused, saying why - offered by a camp's portal beside the Ashwell, begun there with the party
 * as it stands, and removed again from the menu, the game begun from it kept.
 */

const LICHGATE = resolve('tests/fixtures/adventure-lichgate.json');
/** A camp made for Wren: this build's own, kept in step by `adventure-portal.test.ts`. */
const CAMP = readFileSync(resolve('tests/fixtures/camp-wren.json'), 'utf8');

async function adventures(page: Page): Promise<void> {
  await page.goto('/?menu');
  await page.getByTestId('menu-adventures').click();
  await expect(page.getByTestId('menu-adventures-list')).toBeVisible();
}

test('an adventure imported from a file is offered at the camp’s portal, begun there, and removed from the menu', async ({ page }) => {
  test.setTimeout(180_000);
  await adventures(page);
  const list = page.getByTestId('menu-adventures-list');
  await expect(list.locator('[data-adventure]')).toHaveCount(1);
  await expect(list.locator('[data-adventure="the-ashwell"]')).toContainText('Built in');

  // Not a project: refused, and nothing kept.
  await page.getByTestId('menu-adventure-import').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"what": "a shopping list"}') });
  await expect(page.getByTestId('menu-adventure-said')).toContainText('That file is not a project the engine can play');
  await expect(list.locator('[data-adventure]')).toHaveCount(1);

  await page.getByTestId('menu-adventure-import').setInputFiles(LICHGATE);
  await expect(page.getByTestId('menu-adventure-said')).toHaveText("The Lichgate is in: every camp's portal offers it now.");
  await expect(list.locator('[data-adventure="the-lichgate"]')).toContainText('A churchyard gone to moss');
  await page.screenshot({ path: 'test-results/adventures-menu.png' });

  // A camp, and its portal: the Ashwell, and the Lichgate beside it.
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5, null, { timeout: 60_000 });
  expect(await page.evaluate((text) => window.__engine!.loadProjectText(text), CAMP)).toBe('');
  await page.waitForFunction(() => window.__engine?.sceneId() === 'camp', null, { timeout: 60_000 });
  await page.evaluate(() => {
    const a = window.__engine!;
    a.approach('adventure-portal');
    a.arrive();
  });
  const portal = page.getByTestId('container');
  await expect(portal).toHaveAttribute('data-container', 'adventure-portal');
  expect(await portal.locator('[data-adventure]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-adventure')))).toEqual(['the-ashwell', 'the-lichgate']);
  await portal.locator('[data-adventure="the-lichgate"] [data-testid="adventure-begin"]').click();
  await expect(page).toHaveURL(/[?&]play&project=the-lichgate-[a-z0-9]+$/);
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__engine!.sceneId())).toBe('lichgate-yard');
  expect(await page.evaluate(() => window.__engine!.party())).toEqual(['wren']);
  await expect(page.locator('.hud-card[data-member="wren"]')).toContainText('Wren');
  const begun = new URL(page.url()).searchParams.get('project')!;

  // Removed: gone from the list, and from the portal; the game begun from it is still in Load Game.
  await adventures(page);
  await list.locator('[data-adventure="the-lichgate"] [data-testid="menu-adventure-remove"]').click();
  await expect(page.getByTestId('menu-adventure-said')).toHaveText('The Lichgate is gone. Games begun from it are kept.');
  await expect(list.locator('[data-adventure]')).toHaveCount(1);
  await page.getByTestId('menu-back').click();
  await page.getByTestId('menu-load').click();
  await expect(page.locator(`[data-testid="menu-load-list"] [data-game="${begun}"] h2`)).toHaveText("The Lichgate (Wren's party)");
});
