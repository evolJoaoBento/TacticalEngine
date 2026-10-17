import type { WebSocketRoute } from '@playwright/test';
import { test, expect, type Browser } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * A connection to the server dropped (`play-socket.ts`): the menu's, which listens for its friends' doings
 * (`friends.ts`, `listenForFriends`), is opened again of itself, and a friend's request told at once after; a game's
 * page, sending nothing, notices its own go (`wire.ts`, `Transport.onClose`), connects again of itself and plays on in
 * step. Each socket is held by the test (`routeWebSocket`) and closed from the page's side, as a network that drops it
 * would - or left open with nothing let through it either way, as a network that leaves it half open would, which the
 * page knows by the server's beat stopping (`play.rs`, `BEAT_EVERY`; five seconds on the tests' server). The sockets
 * are the server's, so this is played on the server alone.
 */

test.skip(!ON_SERVER, 'the sockets are to the server: npm run test:e2e:server');

/** An account made for a browser of its own, signed in to it. */
async function signedIn(browser: Browser, baseURL: string, name: string) {
  const context = await browser.newContext();
  const made = await context.request.post('/__accounts/register', { headers: { 'x-tactical-save': '1', origin: baseURL }, data: { name, password: 'played-on-the-server' } });
  expect(made.status(), await made.text()).toBe(200);
  return context;
}

/** A player's page at `where`, every socket it opens to the server's games held by the test, in the order opened. */
async function player(browser: Browser, baseURL: string, name: string, where: string) {
  const context = await signedIn(browser, baseURL, name);
  const page = await context.newPage();
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket('**/__play', (socket) => {
    socket.connectToServer();
    sockets.push(socket);
  });
  await page.goto(where);
  return { context, page, sockets };
}

test("the menu's listening, dropped, is opened again of itself, and a friend's request told at once after", async ({ browser, baseURL }) => {
  const stamp = Date.now().toString(36).slice(-5);
  const askedName = `cal${stamp}`;
  const asked = await player(browser, baseURL!, askedName, '/?menu');
  await expect(asked.page.getByTestId('menu-account')).toContainText(askedName);
  await expect.poll(() => asked.sockets.length).toBe(1);
  // Dropped: opened again after the shortest wait, nothing done on the page.
  await asked.sockets[0]!.close();
  await expect.poll(() => asked.sockets.length, { timeout: 5_000 }).toBe(2);
  // Asked as a friend by another: the menu says so at once, told over the socket opened again.
  const asking = await signedIn(browser, baseURL!, `dee${stamp}`);
  const ask = await asking.request.post('/__friends/ask', { headers: { 'x-tactical-save': '1', origin: baseURL!, 'content-type': 'application/json' }, data: { name: askedName } });
  expect(ask.status(), await ask.text()).toBe(200);
  await expect(asked.page.getByTestId('menu-friends')).toHaveText('Friends (1)', { timeout: 3_000 });
  await asking.close();
  await asked.context.close();
});

test("a game's page, its connection dropped while it sends nothing, connects again of itself and plays on in step", async ({ browser, baseURL }) => {
  const stamp = Date.now().toString(36).slice(-5);
  const playing = await player(browser, baseURL!, `eve${stamp}`, '/?play');
  await playing.page.waitForFunction(() => window.__replica?.server() === 'in', null, { timeout: 60_000 });
  expect(playing.sockets.length).toBe(1);
  // Dropped while the page sends nothing: noticed, connected again, and back at the game the server kept.
  await playing.sockets[0]!.close();
  await expect.poll(() => playing.sockets.length, { timeout: 5_000 }).toBe(2);
  await expect.poll(() => playing.page.evaluate(() => window.__replica!.server()), { timeout: 10_000 }).toBe('in');
  // And it plays on: an intent sent up the connection there is now, answered, nothing parted.
  await playing.page.evaluate(() => window.__engine!.selectNext());
  await expect.poll(() => playing.page.evaluate(() => window.__replica!.server()), { timeout: 10_000 }).toBe('in');
  expect(await playing.page.evaluate(() => window.__replica!.count().parted)).toBe(0);
  expect(playing.sockets.length).toBe(2);
  await playing.context.close();
});

test("a game's page that stops hearing the server's beat - its connection left half open - closes it and connects again", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36).slice(-5);
  const context = await signedIn(browser, baseURL!, `fin${stamp}`);
  const page = await context.newPage();
  const sockets: WebSocketRoute[] = [];
  let beaten = 0;
  // The first socket lets everything through until the server's first beat, and nothing at all after, either way;
  // the browser's own socket to the server still answers its pings, so only the page can tell.
  await page.routeWebSocket('**/__play', (socket) => {
    const server = socket.connectToServer();
    const first = sockets.push(socket) === 1;
    let deaf = false;
    server.onMessage((message) => {
      if (deaf) return;
      socket.send(message);
      if (first && String(message).includes('"beat"')) {
        beaten++;
        deaf = true;
      }
    });
    socket.onMessage((message) => {
      if (!deaf) server.send(message);
    });
  });
  await page.goto('/?play');
  await page.waitForFunction(() => window.__replica?.server() === 'in', null, { timeout: 60_000 });
  await expect.poll(() => beaten, { timeout: 15_000 }).toBe(1);
  expect(sockets.length).toBe(1);
  // Three beats gone by unheard: the page closes it, connects again, and is back at the game the server kept.
  await expect.poll(() => sockets.length, { timeout: 30_000 }).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
  await page.evaluate(() => window.__engine!.selectNext());
  await expect.poll(() => page.evaluate(() => window.__replica!.server()), { timeout: 10_000 }).toBe('in');
  expect(await page.evaluate(() => window.__replica!.count().parted)).toBe(0);
  await context.close();
});
