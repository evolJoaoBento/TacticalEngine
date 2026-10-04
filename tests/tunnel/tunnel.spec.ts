import { test, expect } from '@playwright/test';
import { SERVER_PORT } from '../../playwright.tunnel.config';

/**
 * A friend, through a tunnel (`docs/HOSTING.md`, phase 5, slice 2): the page built for the Rust server, served
 * by it, reached at a public hostname through a proxy that rewrites `Host` (`tests/tunnel/`). The account was
 * made on the host's machine; from beyond it, admin's first password and a new account are refused, the private
 * card art stays home, and the game the friend opens plays on the server - every intent held to the server's
 * game, which is the one that counts.
 */

/** What the host does on their own machine: makes the friend's account. */
async function accountMadeAtHome(request: import('@playwright/test').APIRequestContext, name: string, password: string): Promise<void> {
  const home = `http://127.0.0.1:${SERVER_PORT}`;
  const made = await request.post(`${home}/__accounts/register`, { headers: { 'x-tactical-save': '1', origin: home }, data: { name, password } });
  expect(made.status(), await made.text()).toBe(200);
}

test('a friend signs in through the tunnel and plays on the server', async ({ page, request }) => {
  await accountMadeAtHome(request, 'Wren', 'hunter22');
  await page.goto('/');
  await expect(page.getByTestId('sign-in')).toBeVisible();

  // From beyond the host's machine: admin's first password, and an account made here, are refused; the
  // private card art is not handed on.
  const beyond = await page.evaluate(async () => {
    const post = (route: string, body: unknown) =>
      fetch(`/__accounts/${route}`, { method: 'POST', headers: { 'x-tactical-save': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
    const art = await fetch('/cards/a-soldiers-bond.jpg');
    return { admin: await post('login', { name: 'admin', password: 'admin' }), register: await post('register', { name: 'Stranger', password: 'hunter22' }), art: art.headers.get('content-type') ?? '' };
  });
  expect(beyond.admin).toBe(403);
  expect(beyond.register).toBe(403);
  expect(beyond.art).not.toContain('image');

  // The friend's own account, through the sign-in card.
  await page.getByTestId('sign-in-name').fill('Wren');
  await page.getByTestId('sign-in-password').fill('hunter22');
  await page.getByTestId('sign-in-go').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('menu-account')).toContainText('Wren');

  // The game, played on the server: the wire opened over the tunnel's websocket, and in step.
  await page.goto('/?play');
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in', null, { timeout: 30_000 });
  const played = await page.evaluate(() => {
    const a = window.__engine!;
    const before = a.selected();
    a.select(a.party().find((id) => id !== before)!);
    return { before, after: a.selected() };
  });
  expect(played.after).not.toBe(played.before);
  // The intent went up and came back in step: nothing parted.
  await page.waitForFunction(() => window.__replica?.server() === 'in', null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__replica!.count().parted)).toBe(0);
});
