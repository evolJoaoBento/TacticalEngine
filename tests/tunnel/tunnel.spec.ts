import { test, expect } from '@playwright/test';
import { SERVER_PORT } from '../../playwright.tunnel.config';

/**
 * A friend, through a tunnel (`docs/HOSTING.md`, phase 5, slice 2): the page built for the Rust server, served
 * by it, reached at a public hostname through a proxy that rewrites `Host` (`tests/tunnel/`). The account was
 * made on the host's machine; from beyond it, admin's first password and a new account with no player's invitation
 * are refused, the private card art stays home, and the game the friend opens plays on the server - every intent
 * held to the server's game, which is the one that counts. A friend with the host's invitation makes an account
 * through the tunnel, spending it; admin, at home, sees who invited whom and renews it.
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

test("a friend opens the host's invitation signed out, makes an account with it, joins, and changes their password", async ({ page, browser }) => {
  // The host, at home: an account, a game opened, its invitation read, and the host's own invitation for somebody new.
  const home = `http://127.0.0.1:${SERVER_PORT}`;
  const host = await browser.newContext();
  const made = await host.request.post(`${home}/__accounts/register`, { headers: { 'x-tactical-save': '1', origin: home }, data: { name: 'Hearth', password: 'hunter22' } });
  expect(made.status(), await made.text()).toBe(200);
  const hosting = await host.newPage();
  await hosting.goto(`${home}/?play`);
  await hosting.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 60_000 });
  const invite = await hosting.evaluate(() => window.__table!.table()!.invite);
  const code = ((await (await host.request.get(`${home}/__accounts/invitation`)).json()) as { code: string }).code;

  // The game's invitation alone, signed in to nothing: the card asks the friend to sign in, and makes no account.
  await page.goto(`/?join=${invite}`);
  const card = page.getByTestId('sign-in');
  await expect(card).toContainText('You have been invited to a game. Sign in to join it.');
  await expect(page.getByTestId('sign-in-go')).toHaveText('Sign in');
  await page.getByTestId('sign-in-switch').click();
  await page.getByTestId('sign-in-name').fill('Pip');
  await page.getByTestId('sign-in-password').fill('first-pass');
  await page.getByTestId('sign-in-go').click();
  await expect(page.getByTestId('sign-in-refused')).toHaveText("a new account needs a player's invitation");

  // With the host's own invitation too: the card on making an account, saying why.
  await page.goto(`/?invite=${code}&join=${invite}`);
  await expect(card).toContainText('You have been invited to a game.');
  await expect(page.getByTestId('sign-in-go')).toHaveText('Create account');
  await page.screenshot({ path: 'test-results/sign-in-invited.png' });
  await page.getByTestId('sign-in-name').fill('Pip');
  await page.getByTestId('sign-in-password').fill('first-pass');
  await page.getByTestId('sign-in-go').click();
  // Made, and in the host's game.
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__table!.table()!.members.map((m) => m.name))).toEqual(['Hearth', 'Pip']);
  // The host's invitation is spent on Pip: it makes nobody else's account.
  expect(await (await host.request.get(`${home}/__accounts/invitation`)).json()).toEqual({ code, usedBy: { id: 'pip', name: 'Pip' } });

  // Pip's own invitation, from the menu, to send somebody else.
  await page.goto('/?menu');
  await page.getByTestId('menu-invite').click();
  await expect(page.getByTestId('invite-own-link')).toHaveValue(/\/\?invite=[0-9a-f]{24}$/);
  await page.getByTestId('menu-back').click();

  // Admin, at home, sees who invited whom, and gives the host a new invitation.
  const admin = await browser.newContext();
  const adminPage = await admin.newPage();
  await adminPage.goto(`${home}/`);
  await adminPage.getByTestId('sign-in-name').fill('admin');
  await adminPage.getByTestId('sign-in-password').fill('admin');
  await adminPage.getByTestId('sign-in-go').click();
  await adminPage.getByTestId('menu-invite').click();
  const pipRow = adminPage.locator('[data-testid="invite-players"] li[data-player="pip"]');
  await expect(pipRow).toContainText('invited by Hearth');
  const hearthRow = adminPage.locator('[data-testid="invite-players"] li[data-player="hearth"]');
  await expect(hearthRow).toContainText('invitation spent');
  await adminPage.screenshot({ path: 'test-results/invitations-admin.png' });
  await hearthRow.getByTestId('invite-renew').click();
  await expect(adminPage.getByTestId('invite-said')).toHaveText('Hearth has a new invitation.');
  await expect(hearthRow).not.toContainText('invitation spent');
  const renewed = (await (await host.request.get(`${home}/__accounts/invitation`)).json()) as { code: string; usedBy: unknown };
  expect(renewed.usedBy).toBeNull();
  expect(renewed.code).not.toBe(code);
  await admin.close();

  // Their password changed from the menu: the old one signs in no more, the new one does.
  await page.goto('/?menu');
  await page.getByTestId('menu-password').click();
  await page.getByTestId('password-current').fill('first-pass');
  await page.getByTestId('password-next').fill('own-choice');
  await page.getByTestId('password-again').fill('own-choice');
  await page.getByTestId('password-go').click();
  await expect(page.getByTestId('password-changed')).toBeVisible();
  await page.screenshot({ path: 'test-results/change-password.png' });
  const signIn = (password: string) =>
    page.evaluate(
      (pass) => fetch('/__accounts/login', { method: 'POST', headers: { 'x-tactical-save': '1', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Pip', password: pass }) }).then((r) => r.status),
      password,
    );
  expect(await signIn('first-pass')).toBe(401);
  expect(await signIn('own-choice')).toBe(200);
  await host.close();
});
