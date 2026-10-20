import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * The camp's portal at a shared game (`docs/SERVER.md`, `begin`): a camp hosted on the server, a guest joined with its
 * invitation and seated in a companion the host asked along. The window opens on both pages; the guest's says the host
 * chooses, and has no adventure to begin. The host begins the Ashwell, and both pages are in it - the same game, the
 * party that went through, the guest still playing their own - the host's address the game begun, the guest's still
 * the invitation. Nothing parts. Played on the server alone: the ordinary run has no server to share a game on.
 */

test.skip(!ON_SERVER, 'a shared game is played on the server: npm run test:e2e:server');

/** A camp made for Wren (`tests/fixtures/camp-wren.json`, kept in step by `adventure-portal.test.ts`). */
const CAMP = readFileSync(resolve('tests/fixtures/camp-wren.json'), 'utf8');

/** A page's game on the server, in step, at a table. */
async function atTable(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 30_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

test('the host begins an adventure at the camp’s portal, and everybody at the table goes through', async ({ page, browser, baseURL }) => {
  // The menu first, as a player comes: it is what tells the page who is signed in, whose games the adventure is kept among.
  await page.goto('/?menu');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.goto('/');
  await atTable(page);
  const first = await page.evaluate(() => window.__table!.table()!.game);
  expect(await page.evaluate((text) => window.__engine!.loadProjectText(text), CAMP)).toBe('');
  await page.waitForFunction((was) => window.__engine?.sceneId() === 'camp' && window.__replica?.server() === 'in' && (window.__table?.table()?.game ?? was) !== was, first, { timeout: 60_000 });
  const invite = await page.evaluate(() => window.__table!.table()!.invite);

  // A guest, in a browser and an account of their own, joined with the invitation.
  const guestContext = await browser.newContext();
  const guestName = `Ash${Date.now().toString(36).slice(-6)}`;
  const made = await guestContext.request.post('/__accounts/register', { headers: { 'x-tactical-save': '1', origin: baseURL! }, data: { name: guestName, password: 'played-on-the-server' } });
  expect(made.status(), await made.text()).toBe(200);
  const guestId = ((await made.json()) as { id: string }).id;
  const guest = await guestContext.newPage();
  await guest.goto(`/?join=${invite}`);
  await atTable(guest);
  expect(await guest.evaluate(() => window.__engine!.sceneId())).toBe('camp');
  await page.waitForFunction(() => window.__table!.table()!.members.length === 2, null, { timeout: 15_000 });

  // Quim asked along by the host, and seated for the guest.
  await page.evaluate(() => {
    const a = window.__engine!;
    a.approach('quim-figure');
    a.arrive();
  });
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toContain('Come with us.');
  await page.evaluate(() => window.__engine!.answer({ kind: 'choose', index: 0 }));
  await expect.poll(() => guest.evaluate(() => window.__engine!.party()), { timeout: 15_000 }).toEqual(['wren', 'quim']);
  expect(await page.evaluate((account) => window.__table!.seat('quim', account), guestId)).toBe(true);
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe('quim');

  // The portal used by the host: the window on both pages - the guest's saying who chooses, with nothing to begin.
  await page.evaluate(() => {
    const a = window.__engine!;
    a.select('wren');
    a.approach('adventure-portal');
    a.arrive();
  });
  const theirs = guest.getByTestId('container');
  await expect(theirs).toHaveAttribute('data-container', 'adventure-portal');
  const hostName = await page.evaluate(() => {
    const table = window.__table!.table()!;
    return table.members.find((member) => member.id === table.host)!.name;
  });
  await expect(theirs.getByTestId('adventure-chooser')).toContainText(`${hostName} chooses where it opens`);
  await expect(theirs.locator('[data-adventure]')).toHaveCount(0);
  await guest.screenshot({ path: 'test-results/portal-shared-guest.png' });
  const ours = page.getByTestId('container');
  await ours.locator('[data-adventure="the-ashwell"] [data-testid="adventure-begin"]').click();

  // Both in the Ashwell: the same game, the party that went through, the guest still playing Quim.
  for (const each of [page, guest]) {
    await expect.poll(() => each.evaluate(() => window.__engine!.sceneId()), { timeout: 30_000 }).toBe('lantern-and-lye');
    expect(await each.evaluate(() => window.__engine!.party())).toEqual(['wren', 'quim']);
    expect(await each.evaluate(() => window.__replica!.server())).toBe('in');
  }
  await expect(page).toHaveURL(/[?&]play&project=the-ashwell-[a-z0-9]+$/);
  await expect(guest).toHaveURL(new RegExp(`[?&]join=${invite}$`));
  expect(await page.evaluate(() => window.__table!.table()!.invite)).toBe(invite);
  expect(await guest.evaluate(() => window.__table!.table()!.seats)).toEqual({ quim: guestId });
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe('quim');
  await expect(guest.getByTestId('container')).toHaveCount(0);

  // And play goes on there: the guest walks Quim, and the host's page sees it.
  await guest.bringToFront();
  const to = await guest.evaluate(() => {
    const a = window.__engine!;
    const from = a.tileOf('quim');
    const reach = a.reachable();
    a.moveTo([from + 2, from - 2, from + 1, from - 1].find((tile) => reach.includes(tile))!);
    return a.tileOf('quim');
  });
  await guest.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__engine!.tileOf('quim')), { timeout: 15_000 }).toBe(to);
  await page.screenshot({ path: 'test-results/portal-shared-host.png' });
  for (const each of [page, guest]) expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  await guestContext.close();
});
