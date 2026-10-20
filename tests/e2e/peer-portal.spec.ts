import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { invited, seated } from './peers';

/**
 * The camp's portal at a peer game (`docs/PEER.md`, `begin`): a camp the host's page keeps the game of, a guest invited
 * by code and seated in a companion the host asked along. The host begins the Ashwell at the portal - the guest's window
 * saying the host chooses - and both pages are in it, at the same table, the guest still playing their own, the host's
 * address still the peer game's. Nothing parts. Played from a static build too (`playwright.static.config.ts`).
 */

/** A camp made for Wren (`tests/fixtures/camp-wren.json`, kept in step by `adventure-portal.test.ts`). */
const CAMP = readFileSync(resolve('tests/fixtures/camp-wren.json'), 'utf8');

test('a peer game at a camp: the host begins an adventure at the portal, and the guest goes through with them', async ({ page, browser }) => {
  test.setTimeout(180_000);
  // The camp among the host's browser's games, as New Game keeps one (`game-projects.ts`), for the peer game to be of.
  await page.goto('/?menu');
  const camp = await page.evaluate((text) => {
    const id = (JSON.parse(text) as { id: string }).id;
    const user = localStorage.getItem('tactical:current-user');
    const key = (k: string): string => (user === null || user === 'admin' ? k : `tactical:u:${user}:${k.slice('tactical:'.length)}`);
    localStorage.setItem(key(`tactical:game:${id}`), text);
    localStorage.setItem(key('tactical:games'), JSON.stringify([{ id, name: "Wren's camp", startedAt: 1 }]));
    return id;
  }, CAMP);
  await page.goto(`/?play&project=${camp}&peer=host&as=Hana&ice=none`);
  await seated(page);
  expect(await page.evaluate(() => window.__engine!.sceneId())).toBe('camp');
  const { guest, close } = await invited(page, browser, 'Gus');
  await page.getByTestId('lobby-start').click();
  for (const each of [page, guest]) await expect(each.getByTestId('lobby')).toHaveCount(0, { timeout: 15_000 });

  // Quim asked along by the host, and seated for the guest.
  await page.evaluate(() => {
    const a = window.__engine!;
    a.approach('quim-figure');
    a.arrive();
  });
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toContain('Come with us.');
  await page.evaluate(() => window.__engine!.answer({ kind: 'choose', index: 0 }));
  await expect.poll(() => guest.evaluate(() => window.__engine!.party()), { timeout: 15_000 }).toEqual(['wren', 'quim']);
  const gus = await page.evaluate(() => window.__table!.table()!.members.find((member) => member.name === 'Gus')!.id);
  expect(await page.evaluate((account) => window.__table!.seat('quim', account), gus)).toBe(true);
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe('quim');

  // The portal: the guest's window says who chooses; the host begins the Ashwell.
  await page.evaluate(() => {
    const a = window.__engine!;
    a.select('wren');
    a.approach('adventure-portal');
    a.arrive();
  });
  await expect(guest.getByTestId('adventure-chooser')).toContainText('Hana chooses where it opens');
  await page.getByTestId('container').locator('[data-adventure="the-ashwell"] [data-testid="adventure-begin"]').click();

  for (const each of [page, guest]) {
    await expect.poll(() => each.evaluate(() => window.__engine!.sceneId()), { timeout: 30_000 }).toBe('lantern-and-lye');
    expect(await each.evaluate(() => window.__engine!.party())).toEqual(['wren', 'quim']);
  }
  await expect(page).toHaveURL(/[?&]peer=host&as=Hana&ice=none&play&project=the-ashwell-[a-z0-9]+$/);
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe('quim');

  // Play goes on at the same table: the guest walks Quim, and the host's page sees it.
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
  await guest.screenshot({ path: 'test-results/peer-portal.png' });
  for (const each of [page, guest]) {
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
    expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  }
  await close();
});
