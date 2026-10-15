import { test, expect, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * A shared game (`docs/SERVER.md`, phase 5, slices 3 to 5), played on the server by two pages: the host's, which
 * opened it, and a guest's, opened with its invitation (`?join=`) in a browser of its own, signed in to an account
 * of its own. Each page's intents are played on the server's one game and pushed to the other, which is stood
 * where it says, the walk drawn; the host says who plays whom, and the guest is told. Each plays their own: the
 * guest nobody until seated, then the one they were seated in, each with a selection of their own; a question is
 * put to whoever plays the character it is about, and the other page says whom it waits on. Nothing parts. And a
 * game hosted from the menu's Play Together, a lobby: the guest joins with the link pasted there, takes a seat,
 * and the host starts it; the game's saves the host's alone. Hosted again from that save, the game waits for the
 * guest in their own Play Together, joined with no link sent.
 * Played on the server alone: the ordinary run has no server to share a game on.
 */

test.skip(!ON_SERVER, 'a shared game is played on the server: npm run test:e2e:server');

/** A page up, its game on the server, and the dice not waited for. */
async function playing(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 30_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

/**
 * Somebody walked a couple of tiles across ground they can reach, and the walk drawn to its end - the page
 * brought to the front first, as each player's is on their own screen.
 */
async function walked(page: Page, who: string): Promise<number> {
  await page.bringToFront();
  const to = await page.evaluate((id) => {
    const a = window.__engine!;
    a.select(id);
    const from = a.tileOf(id);
    const reach = a.reachable();
    const near = [from + 2, from - 2, from + 1, from - 1].find((tile) => reach.includes(tile))!;
    a.moveTo(near);
    return a.tileOf(id);
  }, who);
  await page.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
  return to;
}

test('two pages share one game on the server: each plays their own, and each one\'s intents reach the other', async ({ page, browser, baseURL }) => {
  await playing(page, '/');
  const invite = await page.evaluate(() => window.__table!.table()!.invite);
  expect(invite).toMatch(/^[0-9a-f]{32}$/);

  // The guest: a browser of their own, signed in to an account of their own, opened with the invitation.
  const guestContext = await browser.newContext();
  const made = await guestContext.request.post('/__accounts/register', {
    headers: { 'x-tactical-save': '1', origin: baseURL! },
    data: { name: `guest${Date.now().toString(36).slice(-6)}`, password: 'played-on-the-server' },
  });
  expect(made.status(), await made.text()).toBe(200);
  const guestId = ((await made.json()) as { id: string }).id;
  const guest = await guestContext.newPage();
  await playing(guest, `/?join=${invite}`);

  // Both pages told who is at the game.
  await page.waitForFunction(() => window.__table!.table()!.members.length === 2, null, { timeout: 15_000 });
  expect(await guest.evaluate(() => window.__table!.table()!.members.map((m) => m.id))).toContain(guestId);
  const party = await page.evaluate(() => window.__engine!.party());
  expect(await guest.evaluate(() => window.__engine!.party())).toEqual(party);

  // The host walks: the guest's page stood where the server's game is.
  const hostWalker = party[0]!;
  const there = await walked(page, hostWalker);
  await expect.poll(() => guest.evaluate((id) => window.__engine!.tileOf(id), hostWalker), { timeout: 15_000 }).toBe(there);

  // The guest plays nobody yet: nobody selected, and the host's not theirs to select.
  expect(await guest.evaluate(() => window.__engine!.selected())).toBeNull();
  expect(await guest.evaluate((id) => window.__engine!.select(id), hostWalker)).toBe(false);

  // The host says who plays whom; the guest is told, and has their own selected. The guest may not say.
  const guestWalker = party[1]!;
  expect(await page.evaluate(([character, account]) => window.__table!.seat(character!, account!), [guestWalker, guestId])).toBe(true);
  await expect.poll(() => guest.evaluate(() => window.__table!.table()!.seats), { timeout: 15_000 }).toEqual({ [guestWalker]: guestId });
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(guestWalker);
  expect(await guest.evaluate((character) => window.__table!.seat(character, null), guestWalker)).toBe(false);

  // The guest walks their own: the host's page stood where that leaves the game, its own selection kept.
  const moved = await walked(guest, guestWalker);
  await expect.poll(() => page.evaluate((id) => window.__engine!.tileOf(id), guestWalker), { timeout: 15_000 }).toBe(moved);
  expect(await page.evaluate(() => window.__engine!.selected())).toBe(hostWalker);
  // And the host may not select the guest's.
  expect(await page.evaluate((id) => window.__engine!.select(id), guestWalker)).toBe(false);

  // The host's tries a door, which asks for a roll: the host is asked; the guest's page says whom it waits on.
  await page.bringToFront();
  const door = await page.evaluate(() => {
    const a = window.__engine!;
    const door = a.objects().find((o) => o.includes('door')) ?? a.objects()[0]!;
    a.standBeside(door);
    return a.use(door) === 'waiting' ? door : null;
  });
  expect(door, 'a door that asks for a roll').not.toBeNull();
  await expect(page.getByTestId('check-prompt')).toBeVisible();
  await guest.bringToFront();
  await expect(guest.getByTestId('waiting-on')).toContainText('to answer for');
  await expect(guest.getByTestId('check-prompt')).toHaveCount(0);
  // Answered by the host, it is gone from both - each answer waited for outside the page, where the server's
  // answer can come back between them.
  await page.bringToFront();
  expect(await page.evaluate(() => window.__replica!.count().parted)).toBe(0);
  await page.evaluate(() => window.__engine!.answer({ kind: 'roll' }));
  for (let n = 0; n < 20; n++) {
    const kind = await page.evaluate(() => window.__engine!.pendingKind());
    if (kind === null) break;
    if (kind === 'choice') await page.evaluate(() => window.__engine!.answer({ kind: 'choose', index: 0 }));
    await page.waitForTimeout(200);
  }
  await expect(page.getByTestId('check-prompt')).toHaveCount(0);
  await expect.poll(() => guest.evaluate(() => window.__engine!.pendingKind()), { timeout: 15_000 }).toBeNull();
  await expect(guest.getByTestId('waiting-on')).toHaveCount(0);

  // The Players section in the settings: the invitation, and the seats - the host's to change.
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('players')).toBeVisible();
  await expect(page.getByTestId('invite-link')).toHaveValue(new RegExp(`\\?join=${invite}$`));
  await expect(page.locator(`[data-testid="seat"][data-character="${guestWalker}"]`)).toHaveValue(guestId);
  await expect(page.locator(`[data-testid="seat"][data-character="${guestWalker}"]`)).toBeEnabled();
  await guest.bringToFront();
  await guest.keyboard.press('Escape');
  await expect(guest.locator(`[data-testid="seat"][data-character="${guestWalker}"]`)).toBeDisabled();

  // Nothing parted on either page: every answer held to what the page predicted, or another's intent between.
  for (const each of [page, guest]) {
    // Stood where the game is once whatever crossed the last intent is answered - a page part-way there is no parting.
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
    expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  }
  await guestContext.close();
});

/** A page opened on a game, ready: its game on the server, and the dice not waited for. */
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 30_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

test('a game hosted from the menu is a lobby: friends join with the link, take their seats, and it starts together', async ({ page, browser, baseURL }) => {
  // The host: Play Together, the demo hosted.
  await page.goto('/?menu');
  await page.getByTestId('menu-together').click();
  await page.locator('[data-testid="menu-together-list"]').getByTestId('menu-play-demo').click();
  // Found by the host's friends, as Play Together offers it first.
  await page.waitForURL(/\?play&host=friends$/);
  await ready(page);
  const lobby = page.getByTestId('lobby');
  await expect(lobby).toBeVisible();
  await expect(lobby.getByTestId('lobby-start')).toBeVisible();
  const link = await lobby.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/\?join=[0-9a-f]{32}$/);
  // And for somebody with no account yet: the host's own invitation with the game's, which makes theirs and brings them.
  await expect(lobby.getByTestId('invite-new-link')).toHaveValue(new RegExp(`/\\?invite=[0-9a-f]{24}&join=${link.split('join=')[1]}$`));
  // Nobody plays anybody before it starts: the host no more than anybody.
  const party = await page.evaluate(() => window.__engine!.party());
  expect(await page.evaluate(() => window.__engine!.selected())).toBeNull();
  expect(await page.evaluate((id) => window.__engine!.select(id), party[0]!)).toBe(false);

  // The guest: an account of their own, the link pasted into Play Together - a wrong one refused first.
  const guestContext = await browser.newContext();
  const made = await guestContext.request.post('/__accounts/register', {
    headers: { 'x-tactical-save': '1', origin: baseURL! },
    data: { name: `guest${Date.now().toString(36).slice(-6)}`, password: 'played-on-the-server' },
  });
  expect(made.status(), await made.text()).toBe(200);
  const guestId = ((await made.json()) as { id: string }).id;
  const guest = await guestContext.newPage();
  await guest.goto('/?menu');
  await guest.getByTestId('menu-together').click();
  await guest.getByTestId('menu-join-link').fill('https://example.com/?play');
  await guest.getByTestId('menu-join').click();
  await expect(guest.getByTestId('menu-join-refused')).toBeVisible();
  await guest.screenshot({ path: 'test-results/menu-together.png' });
  await guest.getByTestId('menu-join-link').fill(link);
  await guest.getByTestId('menu-join').click();
  await guest.waitForURL(/\?join=/);
  await ready(guest);
  const guestLobby = guest.getByTestId('lobby');
  await expect(guestLobby.getByTestId('lobby-waiting')).toContainText('to start the game');
  await expect(guestLobby.getByTestId('lobby-start')).toHaveCount(0);
  await expect(lobby.getByTestId('lobby-members')).toContainText('(host)');
  await expect.poll(() => page.evaluate(() => window.__table!.table()!.members.length), { timeout: 15_000 }).toBe(2);

  // The guest takes a seat nobody has: the host sees it; the guest may leave it, but take none of another's.
  const theirs = party[1]!;
  await guestLobby.locator(`[data-testid="lobby-seat"][data-character="${theirs}"]`).getByTestId('lobby-take').click();
  await expect.poll(() => page.evaluate(() => window.__table!.table()!.seats), { timeout: 15_000 }).toEqual({ [theirs]: guestId });
  await expect(guestLobby.locator(`[data-testid="lobby-seat"][data-character="${theirs}"]`).getByTestId('lobby-leave')).toBeVisible();
  await expect(lobby.locator(`[data-testid="lobby-seat"][data-character="${theirs}"] [data-testid="seat"]`)).toHaveValue(guestId);
  expect(await guest.evaluate(() => window.__engine!.selected())).toBeNull();
  await page.screenshot({ path: 'test-results/lobby-host.png' });
  await guest.screenshot({ path: 'test-results/lobby-guest.png' });

  // The host starts it: the lobby gone from both, each with their own selected.
  await page.bringToFront();
  await lobby.getByTestId('lobby-start').click();
  await expect(lobby).toHaveCount(0);
  await expect(guestLobby).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(party[0]);
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(theirs);

  // Played: the guest walks their own, and the host's page is stood where it leaves the game.
  const moved = await walked(guest, theirs);
  await expect.poll(() => page.evaluate((id) => window.__engine!.tileOf(id), theirs), { timeout: 15_000 }).toBe(moved);

  // A rest is the party's: the guest calls one with their own character's moves; the host's page asks the host to
  // agree, then to choose their own; once the host is ready it is taken on both.
  await guest.bringToFront();
  await guest.getByTestId('open-rest').click();
  const guestRest = guest.getByTestId('rest');
  await expect(guestRest.getByTestId('take-rest')).toHaveText('Call a rest');
  await expect(guestRest.locator('[data-rest-member]')).toHaveCount(1);
  await guestRest.getByTestId('take-rest').click();
  await expect(guestRest.getByTestId('rest-waiting')).toBeVisible();
  await page.bringToFront();
  const hostRest = page.getByTestId('rest');
  await expect(hostRest.getByTestId('rest-called')).toContainText('called a short rest', { timeout: 15_000 });
  await page.screenshot({ path: 'test-results/rest-vote.png' });
  await hostRest.getByTestId('rest-agree').click();
  await expect(hostRest.locator(`[data-rest-status="${theirs}"]`)).not.toContainText('choosing');
  await expect(hostRest.locator('[data-rest-member]')).toHaveCount(party.length - 1);
  await hostRest.getByTestId('rest-ready').click();
  await expect(hostRest).toHaveCount(0);
  await expect(guestRest).toHaveCount(0, { timeout: 15_000 });
  expect(await guest.evaluate(() => window.__engine!.log().map((l) => l.text).join('\n'))).toMatch(/The GM gains \d+ Shadow/);

  // The host keeps the game's saves: the guest's page saves nothing.
  expect(await guest.evaluate(() => window.__engine!.saveBlocked())).toBe("The host keeps this game's saves.");
  expect(await page.evaluate(() => window.__engine!.saveBlocked())).toBeNull();
  await guest.keyboard.press('Escape');
  await expect(guest.getByTestId('save')).toBeDisabled();
  await expect(guest.getByTestId('save')).toHaveAttribute('title', "The host keeps this game's saves.");

  for (const each of [page, guest]) {
    // Stood where the game is once whatever crossed the rest is answered - a page part-way there is no parting.
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
    expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  }

  // The host saves: the save keeps who played whom, on the server.
  await page.bringToFront();
  const slot = await page.evaluate(() => window.__engine!.saveAs('Our evening'));
  expect(slot).not.toBeNull();
  const seatsSaved = async (): Promise<unknown> => ((await (await page.request.get('/__saves')).json()) as { id: string; seats?: Record<string, string> }[]).find((s) => s.id === slot)?.seats;
  await expect.poll(seatsSaved, { timeout: 15_000 }).toEqual({ [theirs]: guestId });
  await guest.close();

  // Next time: the host hosts that save. The guest's seat is kept for them until they are back.
  await page.goto(`/?play&load=${slot}&host`);
  await ready(page);
  await expect(lobby).toBeVisible();
  await expect(lobby.locator(`[data-testid="lobby-seat"][data-character="${theirs}"]`).getByTestId('lobby-kept')).toContainText('Kept for');
  await page.screenshot({ path: 'test-results/lobby-kept.png' });
  const again = new URL(await lobby.getByTestId('invite-link').inputValue());
  // The guest back, sent no link: Play Together has the game waiting for them, and joins it - seated in their own
  // at once, nothing to take.
  const back = await guestContext.newPage();
  await back.goto('/?menu');
  await expect(back.getByTestId('menu-together')).toContainText('has a game waiting for you');
  await back.getByTestId('menu-together').click();
  // Among whatever else they may join - another test's public game - the one keeping their seat.
  const waiting = back.getByTestId('menu-joinable').filter({ hasText: 'for you.' });
  await expect(waiting).toHaveCount(1);
  await expect(waiting).toContainText('kept');
  await back.screenshot({ path: 'test-results/menu-waiting.png' });
  await waiting.getByTestId('menu-joinable-join').click();
  await back.waitForURL((url) => url.search === again.search);
  await ready(back);
  await expect.poll(() => back.evaluate(() => window.__table!.table()!.seats), { timeout: 15_000 }).toEqual({ [theirs]: guestId });
  await expect(back.getByTestId('lobby').locator(`[data-testid="lobby-seat"][data-character="${theirs}"]`).getByTestId('lobby-leave')).toBeVisible();
  await expect(lobby.getByTestId('lobby-kept')).toHaveCount(0);
  await page.bringToFront();
  await lobby.getByTestId('lobby-start').click();
  await expect.poll(() => back.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(theirs);
  for (const each of [page, back]) expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  await guestContext.close();
});
