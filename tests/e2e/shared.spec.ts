import { test, expect, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * A shared game (`docs/SERVER.md`, phase 5, slices 3 and 4), played on the server by two pages: the host's, which
 * opened it, and a guest's, opened with its invitation (`?join=`) in a browser of its own, signed in to an account
 * of its own. Each page's intents are played on the server's one game and pushed to the other, which is stood
 * where it says, the walk drawn; the host says who plays whom, and the guest is told. Each plays their own: the
 * guest nobody until seated, then the one they were seated in, each with a selection of their own; a question is
 * put to whoever plays the character it is about, and the other page says whom it waits on. Nothing parts.
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
    expect(await each.evaluate(() => window.__replica!.server())).toBe('in');
    expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  }
  await guestContext.close();
});
