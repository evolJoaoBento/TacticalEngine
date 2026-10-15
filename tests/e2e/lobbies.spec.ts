import { test, expect, type Browser, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * Lobbies anybody opens (`docs/SERVER.md`, phase 6, slice 3), on the server: a player hosts a game for their friends
 * from Play Together; their friend finds it there and joins with no link, a stranger does not see it - until the host
 * opens it to everybody. When the host's page goes and does not come back, the running of the game is handed on to
 * the friend still at it, who starts it. Each player in a browser of their own, signed in to an account of their own.
 */

test.skip(!ON_SERVER, 'lobbies are the server’s: npm run test:e2e:server');

const HEADERS = (baseURL: string) => ({ 'x-tactical-save': '1', origin: baseURL });

/** A player of their own: an account made, its browser signed in to it, on the menu. */
async function player(browser: Browser, baseURL: string, name: string) {
  const context = await browser.newContext();
  const made = await context.request.post('/__accounts/register', { headers: HEADERS(baseURL), data: { name, password: 'played-on-the-server' } });
  expect(made.status(), await made.text()).toBe(200);
  const id = ((await made.json()) as { id: string }).id;
  const page = await context.newPage();
  await page.goto('/?menu');
  await expect(page.getByTestId('menu-account')).toContainText(name);
  return { context, page, id, name };
}

/** A page up on its game, which the server plays and whose table it has been told. */
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 30_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

test('a lobby is found by whoever its host lets find it, and handed on when its host is gone', async ({ browser, baseURL }) => {
  const stamp = Date.now().toString(36).slice(-5);
  const host = await player(browser, baseURL!, `host${stamp}`);
  const friend = await player(browser, baseURL!, `pal${stamp}`);
  const stranger = await player(browser, baseURL!, `odd${stamp}`);
  // The host and the friend are friends.
  expect((await host.context.request.post('/__friends/ask', { headers: HEADERS(baseURL!), data: { name: friend.name } })).status()).toBe(200);
  expect((await friend.context.request.post('/__friends/answer', { headers: HEADERS(baseURL!), data: { from: host.id, accept: true } })).status()).toBe(200);

  // Hosted for friends, from Play Together.
  await host.page.getByTestId('menu-together').click();
  await expect(host.page.getByTestId('menu-findable')).toHaveValue('friends');
  await host.page.locator('[data-testid="menu-together-list"]').getByTestId('menu-play-demo').click();
  await host.page.waitForURL(/\?play&host=friends$/);
  await ready(host.page);
  const lobby = host.page.getByTestId('lobby');
  await expect(lobby.getByTestId('lobby-findable')).toHaveValue('friends');

  // The friend finds it in Play Together, and joins it with no link.
  await friend.page.reload();
  await friend.page.getByTestId('menu-together').click();
  const found = friend.page.getByTestId('menu-joinable').filter({ hasText: `${host.name}'s game` });
  await expect(found).toHaveCount(1);
  await expect(found).toContainText('for friends · 1 at it, gathering.');
  await friend.page.screenshot({ path: 'test-results/menu-joinable.png' });
  await found.getByTestId('menu-joinable-join').click();
  await friend.page.waitForURL(/\?join=/);
  await ready(friend.page);
  await expect.poll(() => friend.page.evaluate(() => window.__table!.table()!.members.map((m) => m.id))).toEqual([host.id, friend.id]);
  await expect(friend.page.getByTestId('lobby').getByTestId('lobby-findable-said')).toHaveText("The host's friends");

  // A stranger does not see it - until the host opens it to everybody.
  await stranger.page.getByTestId('menu-together').click();
  await expect(stranger.page.getByTestId('menu-joinable').filter({ hasText: `${host.name}'s game` })).toHaveCount(0);
  await host.page.bringToFront();
  await lobby.getByTestId('lobby-findable').selectOption('public');
  await expect.poll(() => friend.page.evaluate(() => window.__table!.table()!.visibility)).toBe('public');
  await expect(friend.page.getByTestId('lobby').getByTestId('lobby-findable-said')).toHaveText('Everybody');
  await stranger.page.reload();
  await stranger.page.getByTestId('menu-together').click();
  await expect(stranger.page.getByTestId('menu-joinable').filter({ hasText: `${host.name}'s game, open to everybody` })).toHaveCount(1);

  // The host's page goes, and does not come back: the game is the friend's to run, and they start it.
  await host.page.close();
  await expect.poll(() => friend.page.evaluate(() => window.__table!.table()!.host), { timeout: 20_000 }).toBe(friend.id);
  await friend.page.bringToFront();
  const theirs = friend.page.getByTestId('lobby');
  await expect(theirs.getByTestId('lobby-start')).toBeVisible();
  await friend.page.screenshot({ path: 'test-results/lobby-handed-on.png' });
  await theirs.getByTestId('lobby-start').click();
  await expect(theirs).toHaveCount(0);
  // The friend now plays everybody nobody is seated in: a character selected, and nothing parted.
  await expect.poll(() => friend.page.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).not.toBeNull();
  await expect.poll(() => friend.page.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
  expect(await friend.page.evaluate(() => window.__replica!.count().parted)).toBe(0);
  for (const each of [host, friend, stranger]) await each.context.close();
});
