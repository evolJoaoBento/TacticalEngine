import { test, expect, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * A conversation at a shared game (`docs/SERVER.md`, phase 5), in two browsers: the host's page and a guest's, each
 * signed in to an account of its own. The host's character opens the Warden's pillar: the host's page has the
 * conversation to answer; the guest's shows it, held - whom it waits on said, the replies shut - and the guest's walk
 * waits on it too. The host sets it aside with Tab: gone from both pages, the one talking marked on both, and the
 * guest walks, the host's page told. Brought back by the host selecting the talker, it is on both pages again where it
 * was; answered to its end by a click on the host's page, it is gone from both. Nothing parts. Played on the server
 * alone: the ordinary run has no server to share a game on.
 */

test.skip(!ON_SERVER, 'a shared game is played on the server: npm run test:e2e:server');

/** A page up, its game on the server, and the dice not waited for. */
async function playing(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 30_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

/** Somebody's walk to ground beside them they can reach, drawn to its end, the page brought to the front first. */
async function walk(page: Page, who: string): Promise<{ from: number; to: number }> {
  await page.bringToFront();
  const walked = await page.evaluate((id) => {
    const a = window.__engine!;
    const from = a.tileOf(id);
    const reach = a.reachable();
    const near = [from + 2, from - 2, from + 1, from - 1].find((tile) => reach.includes(tile));
    if (near !== undefined) a.moveTo(near);
    return { from, to: a.tileOf(id) };
  }, who);
  await page.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
  return walked;
}

test("a conversation at a shared game is its talker's player's: the other waits on it, and it is set aside and brought back by them alone", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await playing(page, '/');
  const invite = await page.evaluate(() => window.__table!.table()!.invite);
  const guestContext = await browser.newContext();
  const made = await guestContext.request.post('/__accounts/register', {
    headers: { 'x-tactical-save': '1', origin: baseURL! },
    data: { name: `talker${Date.now().toString(36).slice(-6)}`, password: 'played-on-the-server' },
  });
  expect(made.status(), await made.text()).toBe(200);
  const guestId = ((await made.json()) as { id: string }).id;
  const guest = await guestContext.newPage();
  await playing(guest, `/?join=${invite}`);
  await page.waitForFunction(() => window.__table!.table()!.members.length === 2, null, { timeout: 15_000 });
  const party = await page.evaluate(() => window.__engine!.party());
  const [talker, guests] = [party[0]!, party[1]!];
  expect(await page.evaluate(([character, account]) => window.__table!.seat(character!, account!), [guests, guestId])).toBe(true);
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(guests);
  const host = await page.evaluate(() => {
    const table = window.__table!.table()!;
    return table.members.find((member) => member.id === table.host)!.name;
  });

  // The host's character opens the Warden's pillar: the host's page has it to answer, the replies open.
  await page.bringToFront();
  await page.evaluate((id) => {
    const a = window.__engine!;
    const pillar = a.objects().find((o) => o.includes('pillar'))!;
    a.select(id);
    a.standBeside(pillar);
    a.use(pillar);
  }, talker);
  const hostTalk = page.getByTestId('dialogue');
  await expect(hostTalk).toContainText('The carving in the pillar opens its eyes.');
  await expect(hostTalk.getByTestId('dialogue-held')).toHaveCount(0);
  await expect(hostTalk.getByRole('button', { name: 'Who are you?', exact: true })).toBeEnabled();

  // The guest's page shows it, held: whom it waits on, the replies shut. And the guest's walk waits on it.
  await guest.bringToFront();
  const guestTalk = guest.getByTestId('dialogue');
  await expect(guestTalk).toContainText('The carving in the pillar opens its eyes.', { timeout: 15_000 });
  await expect(guestTalk.getByTestId('dialogue-held')).toHaveText(new RegExp(`^Waiting for ${host} to answer for .+\\.$`));
  await expect(guestTalk.getByRole('button', { name: 'Who are you?', exact: true })).toBeDisabled();
  await guest.screenshot({ path: 'test-results/shared-talk-waiting.png' });
  const held = await walk(guest, guests);
  expect(held.to).toBe(held.from);

  // Tab on the host's page: set aside - gone from both, the one talking marked on both - and the guest walks.
  await page.bringToFront();
  await page.keyboard.press('Tab');
  await expect(hostTalk).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.selected())).not.toBe(talker);
  await expect(page.getByTestId('hud-talking')).toHaveCount(1);
  await guest.bringToFront();
  await expect(guestTalk).toHaveCount(0, { timeout: 15_000 });
  await expect(guest.getByTestId('hud-talking')).toHaveCount(1);
  await guest.screenshot({ path: 'test-results/shared-talk-aside.png' });
  const walked = await walk(guest, guests);
  expect(walked.to).not.toBe(walked.from);
  await page.bringToFront();
  await expect.poll(() => page.evaluate((id) => window.__engine!.tileOf(id), guests), { timeout: 15_000 }).toBe(walked.to);

  // The host selects the talker again: brought back where it was, on both pages.
  await page.evaluate((id) => window.__engine!.select(id), talker);
  await expect(hostTalk).toContainText('The carving in the pillar opens its eyes.');
  await expect(page.getByTestId('hud-talking')).toHaveCount(0);
  await guest.bringToFront();
  await expect(guestTalk.getByTestId('dialogue-held')).toHaveText(new RegExp(`^Waiting for ${host}`), { timeout: 15_000 });
  await expect(guest.getByTestId('hud-talking')).toHaveCount(0);

  // Answered to its end by a click on the host's page: gone from both, nobody talking.
  await page.bringToFront();
  await hostTalk.getByRole('button', { name: '[Say nothing and walk away.]', exact: true }).click();
  for (let n = 0; n < 10 && (await page.evaluate(() => window.__engine!.pendingKind())) !== null; n++) {
    await page.evaluate(() => window.__engine!.answer({ kind: 'continue' }));
    await page.waitForTimeout(200);
  }
  await expect(hostTalk).toHaveCount(0);
  await guest.bringToFront();
  await expect(guestTalk).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => guest.evaluate(() => window.__engine!.pendingKind()), { timeout: 15_000 }).toBeNull();
  await expect(guest.getByTestId('hud-talking')).toHaveCount(0);

  // Nothing parted on either page.
  for (const each of [page, guest]) {
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
    expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  }
  await guestContext.close();
});
