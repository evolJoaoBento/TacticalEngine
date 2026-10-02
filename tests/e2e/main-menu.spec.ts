import { expect, test, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * The main menu, played. The test server opens straight on the game, as every other suite needs, so
 * this one asks for the menu by address (`?menu`, `game/start.ts`).
 *
 * New Game is made the way a player makes it - a card clicked at every step - and Begin has to land
 * on a camp that is played only: the character just made, alone in the party, the company standing
 * round the fire, and no way into the editor. A save made there is found again under that game in
 * Load Game. Edit Game is the app as it always was.
 */

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

/** Drag the deck's top card off onto the table, `count` times, each to a spot of its own. */
async function dealOff(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const top = (await page.getByTestId('deck-top').boundingBox())!;
    await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
    await page.mouse.down();
    await page.mouse.move(top.x + top.width / 2 + 40, top.y + 20, { steps: 3 });
    await page.mouse.move(640 + i * 150, 420 + (i % 2) * 60, { steps: 6 });
    await page.mouse.up();
  }
}

/** How many of the table's cards have words running past them: none, however long, since they are set to fit. */
function spills(page: Page): Promise<number> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="new-game"] .deal-features, [data-testid="new-game"] .deal-face.is-domain .face-rules')]
    .filter((box) => box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1).length);
}

/** Where a mini stands on the page: the middle of its name plate, which sits at its feet. */
async function feetOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const plate = page.locator(`[data-testid="mini"][data-choice="${id}"]`);
  await expect(plate).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  // Once it has stopped moving: a line spreads as its wider figures arrive.
  let box = (await plate.boundingBox())!;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(120);
    const now = (await plate.boundingBox())!;
    const still = Math.abs(now.x - box.x) < 0.5 && Math.abs(now.y - box.y) < 0.5;
    box = now;
    if (still) break;
  }
  return { x: box.x + box.width / 2, y: box.y };
}

/** Take a mini up close as a player does: click the figure itself, standing on the table (seen from above, its base is just over its plate). */
async function inspectMini(page: Page, id: string): Promise<void> {
  const feet = await feetOf(page, id);
  await page.mouse.click(feet.x, feet.y - 30);
  await expect(page.getByTestId('mini-inspect')).toHaveAttribute('data-choice', id);
  await expect(page.getByTestId('mini-table')).toHaveAttribute('data-inspecting', id);
}

/** Choose a mini as a player does: take it up close, and Choose. */
async function pickMini(page: Page, id: string): Promise<void> {
  await inspectMini(page, id);
  await page.getByTestId('choose-card').click();
  await expect(page.locator('[data-testid="new-game"].is-idle')).not.toHaveAttribute('data-step', 'Model');
}

/** Keep the traits, and then the weapon and armour, as the class would have them, and go on to the name. */
async function keepTraits(page: Page): Promise<void> {
  const idle = page.locator('[data-testid="new-game"].is-idle');
  await expect(idle).toHaveAttribute('data-step', 'Traits');
  await page.getByTestId('choose-traits').click();
  for (let i = 0; i < 2; i++) {
    await expect(idle).toHaveAttribute('data-step', 'Equipment');
    await page.getByTestId('deck-top').click();
    await page.getByTestId('choose-card').click();
  }
  await expect(idle).toHaveAttribute('data-step', 'Name');
}

/** Choose a card as a player does: deal the deck off until it is on top, click it, and Choose. */
async function pick(page: Page, id: string): Promise<void> {
  const idle = page.locator('[data-testid="new-game"].is-idle');
  await expect(idle).toBeVisible();
  if ((await idle.getAttribute('data-step')) === 'Model') return pickMini(page, id);
  const top = page.getByTestId('deck-top');
  for (let i = 0; i < 20 && (await top.getAttribute('data-choice')) !== id; i++) {
    await dealOff(page, 1);
    // Gathered back into the deck now and then, so the table does not fill up.
    if ((await page.getByTestId('table-card').count()) >= 4) {
      await page.mouse.dblclick(40, 700);
      await expect(page.getByTestId('table-card')).toHaveCount(0);
      // What was dealt off went under: carry on dealing from the top.
    }
  }
  await expect(top).toHaveAttribute('data-choice', id);
  await top.click();
  await page.getByTestId('choose-card').click();
  await expect(idle).toBeVisible();
}

test('New Game makes a character card by card and begins a camp, played; Load Game finds its save', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.goto('/?menu');
  const menu = page.getByTestId('main-menu');
  // Signed in where the games are played on the server, the menu says who, offers to sign out, and has the Store.
  await expect(menu.getByRole('button')).toHaveText(ON_SERVER ? [/Sign out/, /New Game/, /Load Game/, /Edit Game/, /Store/] : [/New Game/, /Load Game/, /Edit Game/]);
  await page.screenshot({ path: 'test-results/main-menu.png' });

  await page.getByTestId('menu-new').click();
  const table = page.getByTestId('new-game');
  const idle = page.locator('[data-testid="new-game"].is-idle');

  // The first deck: the ancestries, face up, one card seen at a time.
  await expect(idle).toHaveAttribute('data-step', 'Ancestry');
  await expect(page.getByTestId('deck')).toHaveAttribute('data-count', '18');
  await expect(page.getByTestId('table-tip')).toContainText('Double-click the table to gather them back');

  // Cards dragged off the deck lie where they are put; a double-click on the table gathers them.
  await dealOff(page, 3);
  await expect(page.getByTestId('table-card')).toHaveCount(3);
  await expect(page.getByTestId('deck')).toHaveAttribute('data-count', '15');
  // However long a card's words, all of them show on it.
  await expect.poll(() => spills(page)).toBe(0);
  await page.screenshot({ path: 'test-results/new-game-table.png' });
  // A card clicked is taken up close to be read; Esc, or a click off it, puts it back.
  const onTop = page.getByTestId('deck-top');
  const small = (await onTop.boundingBox())!;
  const lookedAt = (await onTop.getAttribute('data-choice'))!;
  await onTop.click();
  const inspect = page.getByTestId('card-inspect');
  await expect(inspect).toHaveAttribute('data-choice', lookedAt);
  // Where it was, the deck shows the next card, face up - not a blank.
  const next = page.getByTestId('deck-next');
  await expect(next).toBeVisible();
  expect(await next.getAttribute('data-choice')).not.toBe(lookedAt);
  await expect(next.locator('.deal-name')).not.toBeEmpty();
  await page.waitForTimeout(400);
  expect((await inspect.locator('.deal-look-card').boundingBox())!.height).toBeGreaterThan(small.height * 2);
  await expect(page.getByTestId('table-tip')).toContainText('put it back');
  await page.screenshot({ path: 'test-results/new-game-inspect-card.png' });
  await page.keyboard.press('Escape');
  await expect(inspect).toHaveCount(0);
  await page.getByTestId('table-card').first().click();
  await expect(inspect).toBeVisible();
  await page.mouse.click(1300, 120);
  await expect(inspect).toHaveCount(0);
  await page.mouse.dblclick(40, 700);
  await expect(page.getByTestId('table-card')).toHaveCount(0);
  await expect(idle.getByTestId('deck')).toHaveAttribute('data-count', '18');

  await pick(page, 'dwarf');
  await expect(page.locator('[data-testid="chosen-card"][data-step="Ancestry"]')).toHaveAttribute('data-choice', 'dwarf');
  // The company's six, standing on the table as minis in a line.
  await expect(page.getByTestId('mini')).toHaveCount(6);
  for (const id of ['quim', 'ganja']) await feetOf(page, id);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/new-game-company.png' });
  await pick(page, 'quim');
  await pick(page, 'ridgeborne');
  await pick(page, 'guardian');
  await pick(page, 'stalwart');
  // Two domain cards from one deck: the first chosen, the deck stays for the second.
  await expect(idle).toHaveAttribute('data-step', 'Domain cards');
  await expect.poll(() => spills(page)).toBe(0);
  await pick(page, 'bare-bones');
  await expect(idle).toHaveAttribute('data-step', 'Domain cards');
  await pick(page, 'get-back-up');

  // The traits: the starting spread on a sheet, laid where a Guardian leans. Two traded by a click on
  // each, two by dragging one onto the other.
  await expect(idle).toHaveAttribute('data-step', 'Traits');
  const token = (trait: string) => page.locator(`[data-testid="trait-token"][data-trait="${trait}"]`);
  await expect(token('strength')).toHaveAttribute('data-value', '2');
  await expect(token('knowledge')).toHaveAttribute('data-value', '0');
  await expect(page.getByTestId('suggested-traits')).toBeDisabled();
  // A Guardian casts nothing: what matters most is where the class leans, and it is underlined.
  await expect(page.locator('[data-testid="trait-board"] .trait-name.is-key')).toHaveText('Strength');
  await token('strength').click();
  await token('knowledge').click();
  await expect(token('strength')).toHaveAttribute('data-value', '0');
  await expect(token('knowledge')).toHaveAttribute('data-value', '2');
  await token('finesse').dragTo(token('agility'));
  await expect(token('finesse')).toHaveAttribute('data-value', '1');
  await expect(token('agility')).toHaveAttribute('data-value', '-1');
  await expect(page.getByTestId('suggested-traits')).toBeEnabled();
  await page.screenshot({ path: 'test-results/new-game-traits.png' });
  await page.getByTestId('choose-traits').click();

  // The equipment: the catalogue's own cards, a weapon and then armour, a Guardian's suggestion on top.
  await expect(idle).toHaveAttribute('data-step', 'Equipment');
  await expect(page.locator('.deal-title')).toContainText('Choose your weapon');
  await expect(page.getByTestId('deck-top')).toHaveAttribute('data-choice', 'primary-battleaxe');
  await pick(page, 'primary-broadsword');
  await expect(idle).toHaveAttribute('data-step', 'Equipment');
  await expect(page.locator('.deal-title')).toContainText('Choose your armor');
  await expect(page.getByTestId('deck-top')).toHaveAttribute('data-choice', 'armor-chainmail-armor');
  await page.screenshot({ path: 'test-results/new-game-equipment.png' });
  await pick(page, 'armor-gambeson-armor');
  await expect(idle).toHaveAttribute('data-step', 'Name');
  await expect(page.locator('[data-testid="chosen-card"][data-step="Equipment"]')).toHaveCount(2);
  await expect(page.locator('.deal-slot', { has: page.locator('[data-choice="primary-broadsword"]') }).locator('.deal-label')).toHaveText('Weapon');
  await expect(page.locator('.deal-slot', { has: page.locator('[data-choice="armor-gambeson-armor"]') }).locator('.deal-label')).toHaveText('Armor');
  // The sheet carries what was chosen.
  await expect(page.getByTestId('name-card').locator('.sheet-line', { hasText: 'Gear' })).toContainText('Broadsword');
  await expect(page.getByTestId('name-card').locator('.sheet-line', { hasText: 'Gear' })).toContainText('Gambeson');
  await expect(page.getByTestId('chosen-card')).toHaveCount(10);
  await expect(page.locator('[data-testid="chosen-card"][data-step="Traits"] [data-trait-slot="knowledge"] .trait-sticker')).toHaveText('+2');
  // The card in the row keeps its stickers, and its underline.
  await expect(page.locator('[data-testid="chosen-card"][data-step="Traits"] .trait-name.is-key')).toHaveText('Strength');
  await page.screenshot({ path: 'test-results/new-game-chosen.png' });

  await expect.poll(() => spills(page)).toBe(0);

  // A chosen card is inspected from the row, and chosen again: its sleeve comes off and its deck is
  // back, the class on top.
  await page.locator('[data-testid="chosen-card"][data-step="Class"]').click();
  await expect(page.getByTestId('card-inspect')).toHaveAttribute('data-choice', 'guardian');
  await page.getByTestId('choose-again').click();
  await expect(idle).toHaveAttribute('data-step', 'Class');
  await expect(page.getByTestId('deck-top')).toHaveAttribute('data-choice', 'guardian');
  await pick(page, 'guardian');

  // The last card: the name.
  await expect(page.getByTestId('name-card')).toBeVisible();
  await expect(page.getByTestId('begin-game')).toBeDisabled();
  await page.getByTestId('character-name').fill('Ash Ironvein');
  await page.getByTestId('begin-game').click();

  // The camp: played, the character alone in the party, the company round the fire.
  await page.waitForURL(/\?play&project=camp-ash-ironvein-/);
  await ready(page);
  const camp = await page.evaluate(() => {
    const api = window.__engine!;
    return { party: api.party(), mode: api.mode(), objects: api.objects() };
  });
  expect(camp.party).toEqual(['ash-ironvein']);
  expect(camp.mode).toBe('play');
  // The sheet has the traits as they were left on the table.
  // Kept in this browser under the player's own key (`userKey`): the bare one for nobody, or admin.
  const key = await page.evaluate(() => {
    const user = localStorage.getItem('tactical:current-user');
    const project = new URLSearchParams(location.search).get('project');
    return user === null || user === 'admin' ? `tactical:game:${project}` : `tactical:u:${user}:game:${project}`;
  });
  const hero = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).party[0] as { traits: unknown; primaryWeaponId: string; armorId: string }, key);
  expect(hero.traits).toEqual({ agility: -1, strength: 0, finesse: 1, instinct: 0, presence: 1, knowledge: 2 });
  // And the weapon and armour chosen at the table.
  const gear = { primary: hero.primaryWeaponId, armor: hero.armorId };
  expect(gear).toEqual({ primary: 'primary-broadsword', armor: 'armor-gambeson-armor' });
  await page.screenshot({ path: 'test-results/new-game-camp.png' });
  // No way into the editor: neither the key nor the driver opens it.
  await page.keyboard.press('Control+e');
  await page.evaluate(() => window.__engine!.setMode('edit'));
  expect(await page.evaluate(() => window.__engine!.mode())).toBe('play');
  await expect(page.getByTestId('top-bar')).toHaveCount(0);

  // A save of the camp, found again under the camp in Load Game.
  expect(await page.evaluate(() => window.__engine!.save())).toBe(true);
  await page.goto('/?menu');
  await page.getByTestId('menu-load').click();
  const game = page.locator('[data-testid="menu-load-list"] .menu-game').first();
  await expect(game).toContainText("Ash Ironvein's camp");
  await expect(game.getByTestId('menu-load-save')).toContainText('Quick save');
  await page.screenshot({ path: 'test-results/load-game.png' });
  await game.getByTestId('menu-load-save').click();
  await page.waitForURL(/load=/);
  await ready(page);
  expect(await page.evaluate(() => window.__engine!.party())).toEqual(['ash-ironvein']);

  // And the Demo Vault's own save, under the Demo Vault: played, and loaded as it opens.
  await page.goto('/?play');
  await ready(page);
  expect(await page.evaluate(() => window.__engine!.save())).toBe(true);
  await page.goto('/?menu');
  await page.getByTestId('menu-load').click();
  const vault = page.locator('[data-testid="menu-load-list"] .menu-game[data-game="demo"]');
  await expect(vault.getByTestId('menu-load-save')).toContainText('Quick save');
  // The camp's save is not listed under the vault.
  await expect(vault.getByTestId('menu-load-save')).toHaveCount(1);
  await vault.getByTestId('menu-load-save').click();
  await page.waitForURL(/\?play&load=quick/);
  await ready(page);
  expect(await page.evaluate(() => window.__engine!.party().length)).toBe(6);
  expect(await page.evaluate(() => window.__engine!.mode())).toBe('play');
  expect(errors).toEqual([]);
});

test('an ancestry with models of its own offers them, and the camp draws the one chosen', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.goto('/?menu');
  await page.getByTestId('menu-new').click();
  await pick(page, 'faun');
  // Its own two, and not the company's six: minis standing on the table.
  await expect(page.locator('[data-testid="new-game"].is-idle')).toHaveAttribute('data-step', 'Model');
  await expect(page.getByTestId('mini-table')).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('mini')).toHaveCount(2);
  await expect(page.getByTestId('table-tip')).toContainText('Pick up a mini');
  // Picked up by the figure and put down somewhere else: it stands where it was put.
  const home = await feetOf(page, 'faun-female');
  await page.mouse.move(home.x, home.y - 30);
  await page.mouse.down();
  await page.mouse.move(home.x + 20, home.y - 60, { steps: 3 });
  await expect(page.locator('[data-testid="mini"][data-choice="faun-female"]')).toHaveClass(/is-held/);
  await page.mouse.move(home.x + 330, home.y + 60, { steps: 10 });
  await page.mouse.up();
  const put = await feetOf(page, 'faun-female');
  expect(put.x - home.x).toBeGreaterThan(200);
  await page.screenshot({ path: 'test-results/new-game-minis.png' });
  // A double-click on the bare table lines them up again.
  await page.mouse.dblclick(60, 760);
  await expect.poll(async () => Math.abs((await feetOf(page, 'faun-female')).x - home.x)).toBeLessThan(4);
  // Clicked, it is taken up close, and turned left and right by dragging; up and down does nothing.
  await inspectMini(page, 'faun-male');
  const stage = page.getByTestId('mini-table');
  await expect(page.getByTestId('table-tip')).toContainText('Drag left or right to turn it');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/new-game-inspect.png' });
  await page.mouse.move(560, 300);
  await page.mouse.down();
  await page.mouse.move(760, 300, { steps: 8 });
  await page.mouse.up();
  const across = Number(await stage.getAttribute('data-turned'));
  expect(across).toBeGreaterThan(90);
  await page.mouse.move(560, 300);
  await page.mouse.down();
  await page.mouse.move(560, 420, { steps: 8 });
  await page.mouse.up();
  expect(Number(await stage.getAttribute('data-turned'))).toBe(across);
  await expect(page.getByTestId('mini-inspect')).toBeVisible();
  await page.screenshot({ path: 'test-results/new-game-inspect-turned.png' });
  // A click on the table away from it puts it back; Put back does too.
  await page.mouse.click(90, 420);
  await expect(page.getByTestId('mini-inspect')).toHaveCount(0);
  await expect(stage).not.toHaveAttribute('data-inspecting', /./);
  await inspectMini(page, 'faun-male');
  await page.getByTestId('put-back').click();
  await expect(page.getByTestId('mini-inspect')).toHaveCount(0);
  // Chosen, the table is swept away to the right - the dimming gone before its edge can be seen moving.
  await inspectMini(page, 'faun-male');
  await page.getByTestId('choose-card').click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/new-game-sweep.png' });
  await expect(page.locator('[data-testid="new-game"].is-idle')).toHaveAttribute('data-step', 'Community');
  // Chosen, its box in the row holds the mini as it is seen from above.
  const top = page.locator('[data-testid="chosen-card"][data-step="Model"] [data-testid="model-figure"]');
  await expect(top).toHaveAttribute('data-model', 'faun-male');
  await expect(top).toHaveAttribute('data-drawn', '1', { timeout: 30_000 });
  const drawing = () => top.evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) inked += 1;
    return { inked, url: canvas.toDataURL() };
  });
  expect((await drawing()).inked).toBeGreaterThan(500);
  await page.screenshot({ path: 'test-results/new-game-faun.png' });
  for (const id of ['wildborne', 'ranger', 'wayfinder', 'gifted-tracker', 'natures-tongue']) await pick(page, id);
  await keepTraits(page);
  await page.getByTestId('character-name').fill('Bramble');
  await page.getByTestId('begin-game').click();
  await page.waitForURL(/\?play&project=camp-bramble-/);
  await ready(page);
  expect(await page.evaluate(() => window.__engine!.party())).toEqual(['bramble']);
  await page.screenshot({ path: 'test-results/new-game-faun-camp.png' });
  expect(errors).toEqual([]);
});

test('with card art on the machine, every card New Game deals wears its picture', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The art is not the repository's: this serves an index of its own, and one picture for every file.
  const pictures = ['ancestry-clank', 'community-highborne', 'class-guardian', 'subclass-stalwart', 'bare-bones'];
  await page.route('**/cards/index.json', (route) => route.fulfill({ json: Object.fromEntries(pictures.map((id) => [id, `${id}.png`])) }));
  const dot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgHAFX2hFQAAAABJRU5ErkJggg==', 'base64');
  await page.route('**/cards/*.png', (route) => route.fulfill({ contentType: 'image/png', body: dot }));
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.goto('/?menu');
  await page.getByTestId('menu-new').click();
  const art = (id: string) => page.locator(`[data-testid="deck-top"][data-choice="${id}"] [data-testid="choice-art"]`);
  await expect(art('clank')).toHaveAttribute('src', /ancestry-clank\.png$/);
  // An ancestry with no picture is its words, with nothing drawn where a picture would be.
  await expect(page.locator('[data-testid="new-game"].is-idle')).toBeVisible();
  await dealOff(page, 1);
  await expect(page.getByTestId('deck-top')).toHaveAttribute('data-choice', 'drakona');
  await expect(page.locator('[data-testid="deck-top"] [data-testid="choice-art"]')).toHaveCount(0);
  await page.mouse.dblclick(40, 700);
  await pick(page, 'clank');
  await pick(page, 'quim');
  await expect(art('highborne')).toHaveAttribute('src', /community-highborne\.png$/);
  await pick(page, 'highborne');
  // A class wears its banner.
  await expect(art('bard')).toHaveCount(0);
  const idle = page.locator('[data-testid="new-game"].is-idle');
  await pick(page, 'guardian');
  await expect(page.locator('[data-testid="chosen-card"][data-step="Class"] img.deal-banner')).toHaveAttribute('src', /class-guardian\.png$/);
  await expect(art('stalwart')).toHaveAttribute('src', /subclass-stalwart\.png$/);
  await pick(page, 'stalwart');
  // And the domain cards wear theirs, as they do in the game.
  await expect(idle).toHaveAttribute('data-step', 'Domain cards');
  for (let i = 0; i < 20 && (await page.getByTestId('deck-top').getAttribute('data-choice')) !== 'bare-bones'; i++) {
    await dealOff(page, 1);
    if ((await page.getByTestId('table-card').count()) >= 4) await page.mouse.dblclick(40, 700);
  }
  await expect(page.locator('[data-testid="deck-top"][data-choice="bare-bones"] .face-art img')).toHaveAttribute('src', /bare-bones\.png$/);
  expect(errors).toEqual([]);
});

test('Edit Game is the app with its editor; the settings lead back to the menu', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?menu');
  await page.getByTestId('menu-edit').click();
  await page.waitForURL(/\?edit/);
  await ready(page);
  expect(await page.evaluate(() => window.__engine!.mode())).toBe('edit');
  await expect(page.getByTestId('top-bar')).toBeVisible();
  // Played from the editor, Esc opens the settings, and they go back to the menu.
  await page.evaluate(() => window.__engine!.setMode('play'));
  // The play screen is up before the key is pressed; the settings start listening for Esc in an effect
  // after it is drawn, which on a loaded machine is a moment later - so Esc is pressed until they open.
  await expect(page.getByTestId('action-bar')).toBeVisible();
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('user-settings')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByTestId('to-main-menu').click();
  await page.waitForURL(/\?menu/);
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});
