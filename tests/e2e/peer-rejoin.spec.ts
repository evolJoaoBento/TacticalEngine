import { test, expect, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';
import { nothingParted, peers, seated, type Peers } from './peers';

/**
 * A guest at a peer game coming back (`docs/PEER.md`) with no invitation from the host: the guest's page writes a code
 * of its own, the host pastes it in the players' panel and sends an answer back. Cut off in the same tab - the link
 * dropped as a network gone drops it - the guest plays on alone, the host's page shows them away, and once the codes
 * are carried the guest's game comes back where the host's is, nothing booted again; and with their page opened
 * again, the guest writes the code from the join screen, and comes back to their seat in the game going on. Each
 * plays on, seen on the other's page. Nothing parts. Played the ordinary way alone, as `peer.spec.ts` is.
 */

test.skip(ON_SERVER, 'a peer game has no server: the ordinary run plays it');

/** The host's own character walked somewhere; where it stands now, on the host's page. */
async function hostWalks(at: Peers): Promise<number> {
  await at.host.bringToFront();
  const went = await at.host.evaluate((id) => {
    const a = window.__engine!;
    a.select(id);
    const from = a.tileOf(id);
    // A few steps: near, so the walk is soon over.
    const away = (x: number): number => Math.abs((x % 44) - (from % 44)) + Math.abs(Math.floor(x / 44) - Math.floor(from / 44));
    const tiles = a.reachable().filter((t) => t !== from).sort((x, y) => away(x) - away(y));
    a.moveTo(tiles[Math.min(6, tiles.length - 1)]!);
    a.arrive();
    return a.tileOf(id);
  }, at.hosts);
  await at.host.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
  return went;
}

/** The guest's own walked, and the host's page stood where it leaves them. */
async function guestWalksSeen(at: Peers): Promise<void> {
  await at.guest.bringToFront();
  const walked = await at.guest.evaluate((id) => {
    const a = window.__engine!;
    const from = a.tileOf(id);
    const away = (x: number): number => Math.abs((x % 44) - (from % 44)) + Math.abs(Math.floor(x / 44) - Math.floor(from / 44));
    const tiles = a.reachable().filter((t) => t !== from).sort((x, y) => away(x) - away(y));
    a.moveTo(tiles[Math.min(10, tiles.length - 1)]!);
    a.arrive();
    return a.tileOf(id);
  }, at.guests);
  await at.guest.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
  await expect.poll(() => at.host.evaluate((id) => window.__engine!.tileOf(id), at.guests), { timeout: 15_000 }).toBe(walked);
}

/** The guest's code pasted in the host's players' panel, and the host's answer to send back. */
async function hostAnswers(host: Page, code: string): Promise<string> {
  await host.bringToFront();
  await host.keyboard.press('Escape');
  await host.getByTestId('peer-answer-paste').fill(code);
  await host.getByTestId('peer-answer-go').click();
  await expect(host.getByTestId('peer-answer-said')).toHaveText('Send this back to Gus:', { timeout: 15_000 });
  const answer = host.getByTestId('peer-answer-code');
  await expect(answer).toHaveValue(/^TE1\./);
  return answer.inputValue();
}

/** Whom the host's table has at the game now, by name. */
const here = (host: Page): Promise<string[]> =>
  host.evaluate(() => {
    const table = window.__table!.table()!;
    return (table.here ?? []).map((id) => table.members.find((m) => m.id === id)!.name).sort();
  });

test('a guest cut off comes back in the same tab: their code to the host, the answer back, the game where the host\'s is', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const at = await peers(page, browser);
  const { guest } = at;

  await guest.evaluate(() => window.__peer!.drop());
  await expect(guest.getByTestId('peer-lost')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => here(page), { timeout: 15_000 }).toEqual(['Hana']);
  // The host plays on: the guest's page, cut off, is not told.
  const before = await guest.evaluate((id) => window.__engine!.tileOf(id), at.hosts);
  const went = await hostWalks(at);
  expect(went).not.toBe(before);
  expect(await guest.evaluate((id) => window.__engine!.tileOf(id), at.hosts)).toBe(before);

  const code = guest.getByTestId('peer-lost-code');
  await expect(code).toHaveValue(/^TE1\./, { timeout: 15_000 });
  await guest.bringToFront();
  await guest.screenshot({ path: 'test-results/peer-lost.png' });
  const answer = await hostAnswers(page, await code.inputValue());
  await page.screenshot({ path: 'test-results/peer-answer.png' });
  await guest.getByTestId('peer-lost-answer').fill(answer);
  await guest.getByTestId('peer-lost-connect').click();
  await expect(guest.getByTestId('peer-lost')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('peer-answer-said')).toHaveText('Gus is at the table.', { timeout: 15_000 });
  await page.keyboard.press('Escape');

  // Back where the host's game is, the same player in the same seat.
  await expect.poll(() => guest.evaluate(() => window.__replica!.server()), { timeout: 30_000 }).toBe('in');
  await expect.poll(() => guest.evaluate((id) => window.__engine!.tileOf(id), at.hosts), { timeout: 15_000 }).toBe(went);
  await expect.poll(() => here(page), { timeout: 15_000 }).toEqual(['Gus', 'Hana']);
  expect(await guest.evaluate(() => window.__engine!.selected())).toBe(at.guests);
  await guestWalksSeen(at);
  await nothingParted(at);
  await at.close();
});

test("a guest whose page was opened again writes the code from the join screen, and is back in their seat", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const at = await peers(page, browser);
  const { guest } = at;
  const seatedAs = await page.evaluate((c) => window.__table!.table()!.seats[c], at.guests);

  await guest.reload();
  await expect(guest.getByTestId('peer-join')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => here(page), { timeout: 15_000 }).toEqual(['Hana']);
  await guest.getByTestId('peer-ask-first').click();
  const code = guest.getByTestId('peer-ask-code');
  await expect(code).toHaveValue(/^TE1\./, { timeout: 15_000 });
  const answer = await hostAnswers(page, await code.inputValue());
  await guest.getByTestId('peer-ask-answer').fill(answer);
  await guest.getByTestId('peer-ask-connect').click();
  await seated(guest);
  await page.keyboard.press('Escape');

  // The game going on, not a lobby: the guest's seat theirs still, their own selected.
  await expect(guest.getByTestId('lobby')).toHaveCount(0);
  expect(await page.evaluate((c) => window.__table!.table()!.seats[c], at.guests)).toBe(seatedAs);
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(at.guests);
  await expect.poll(() => here(page), { timeout: 15_000 }).toEqual(['Gus', 'Hana']);
  const went = await hostWalks(at);
  await expect.poll(() => guest.evaluate((id) => window.__engine!.tileOf(id), at.hosts), { timeout: 15_000 }).toBe(went);
  await guestWalksSeen(at);
  await nothingParted(at);
  await at.close();
});
