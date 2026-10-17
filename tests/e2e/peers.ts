import { expect, type Browser, type Page } from './fixtures';

/**
 * A peer game in two browsers (`docs/PEER.md`), as the peer specs stand one up: the host's page and a guest's, the codes
 * carried between them through the boxes a player pastes into, the guest seated and the game started; and the waits
 * the specs share.
 */

/** A page's game up, at the table, the dice not waited for. */
export async function seated(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 30_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

export interface Peers {
  host: Page;
  guest: Page;
  names: { host: string; guest: string };
  hosts: string;
  guests: string;
  close: () => Promise<void>;
}

/** A peer game hosted by `page`, a guest invited into it from a browser of their own, seated, and started. */
export async function peers(page: Page, browser: Browser): Promise<Peers> {
  await page.goto('/?peer=host&as=Hana&ice=none');
  await seated(page);
  await expect(page.getByTestId('lobby')).toBeVisible();
  await page.getByTestId('peer-invite').click();
  const code = page.getByTestId('peer-invite-code');
  await expect(code).toHaveValue(/^TE1\./, { timeout: 15_000 });

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto('/?peer=join&as=Gus&ice=none');
  await expect(guest.getByTestId('peer-join')).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByTestId('peer-name')).toHaveValue('Gus');
  // Something that is not a code is said to be none, and the guest may paste again.
  await guest.getByTestId('peer-code').fill('hello');
  await guest.getByTestId('peer-make-reply').click();
  await expect(guest.getByTestId('peer-join-problem')).toContainText('not an invitation code');
  await guest.getByTestId('peer-code').fill(await code.inputValue());
  await guest.getByTestId('peer-make-reply').click();
  const reply = guest.getByTestId('peer-reply');
  await expect(reply).toHaveValue(/^TE1\./, { timeout: 15_000 });
  await guest.screenshot({ path: 'test-results/peer-reply.png' });

  await page.getByTestId('peer-invite-reply').fill(await reply.inputValue());
  await page.getByTestId('peer-invite-connect').click();
  await expect(page.getByTestId('peer-invite-said')).toContainText('Gus is at the table', { timeout: 30_000 });
  await seated(guest);

  // The lobby on both pages: who is at the table, the guest's seat taken by the guest, the game started by the host.
  for (const each of [page, guest]) await expect(each.getByTestId('lobby-members')).toHaveText('Hana (host) · Gus', { timeout: 15_000 });
  await expect(guest.getByTestId('lobby-waiting')).toContainText('Waiting for Hana to start the game.');
  await page.screenshot({ path: 'test-results/peer-lobby.png' });
  const party = await page.evaluate(() => window.__engine!.party());
  const [hosts, guests] = [party[0]!, party[1]!];
  await guest.locator(`[data-testid=lobby-seat][data-character="${guests}"] [data-testid=lobby-take]`).click();
  const guestId = await guest.evaluate(() => window.__table!.table()!.members.find((m) => m.name === 'Gus')!.id);
  await expect.poll(() => page.evaluate((c) => window.__table!.table()!.seats[c], guests), { timeout: 15_000 }).toBe(guestId);
  await page.getByTestId('lobby-start').click();
  for (const each of [page, guest]) await expect(each.getByTestId('lobby')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(guests);
  return { host: page, guest, names: { host: 'Hana', guest: 'Gus' }, hosts, guests, close: () => guestContext.close() };
}

/** Whatever the game asks, answered on the page that plays its character, the other saying whom it waits on. */
export async function settle(at: Peers): Promise<void> {
  const { host, guest } = at;
  let quiet = 0;
  for (let n = 0; n < 80 && quiet < 2; n++) {
    const kinds = await Promise.all([host, guest].map((each) => each.evaluate(() => window.__engine!.pendingKind())));
    if (kinds.every((kind) => kind === null)) {
      quiet++;
      await host.waitForTimeout(200);
      continue;
    }
    quiet = 0;
    const waits = await Promise.all([host, guest].map((each) => each.getByTestId('waiting-on').count()));
    const i = [0, 1].find((i) => kinds[i] !== null && waits[i] === 0);
    if (i === undefined) {
      await host.waitForTimeout(200);
      continue;
    }
    const [answering, other] = i === 0 ? [host, guest] : [guest, host];
    await expect(other.getByTestId('waiting-on')).toContainText(`Waiting for ${i === 0 ? at.names.host : at.names.guest}`, { timeout: 15_000 });
    await answering.bringToFront();
    await answering.evaluate((kind) => {
      const a = window.__engine!;
      a.answer(kind === 'check' ? { kind: 'roll' } : kind === 'rolled' ? { kind: 'answered' } : kind === 'dialogue' ? { kind: 'continue' } : { kind: 'choose', index: 0 });
    }, kinds[i]!);
    await host.waitForTimeout(200);
  }
  for (const each of [host, guest]) {
    await expect.poll(() => each.evaluate(() => window.__engine!.pendingKind()), { timeout: 15_000 }).toBeNull();
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
  }
}

export async function nothingParted(at: Peers): Promise<void> {
  for (const each of [at.host, at.guest]) {
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
    expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  }
}
