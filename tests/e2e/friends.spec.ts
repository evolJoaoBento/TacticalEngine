import { test, expect, type Browser } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * Friends (`docs/SERVER.md`, phase 6, slice 2), from the main menu of two players' pages, each in a browser of its
 * own and signed in to an account of its own: one asks the other by name; the other's menu says somebody is asking,
 * and they accept; each lists the other; one removes the other, and neither lists anybody. The server keeps the
 * friends, so this is played on the server alone.
 */

test.skip(!ON_SERVER, 'friends are kept by the server: npm run test:e2e:server');

/** A player of their own: an account made, its browser signed in to it, on the menu. */
async function player(browser: Browser, baseURL: string, name: string) {
  const context = await browser.newContext();
  const made = await context.request.post('/__accounts/register', { headers: { 'x-tactical-save': '1', origin: baseURL }, data: { name, password: 'played-on-the-server' } });
  expect(made.status(), await made.text()).toBe(200);
  const page = await context.newPage();
  await page.goto('/?menu');
  await expect(page.getByTestId('menu-account')).toContainText(name);
  return { context, page };
}

test('a player asks another by name, who accepts; each lists the other, until one removes the other', async ({ browser, baseURL }) => {
  const stamp = Date.now().toString(36).slice(-5);
  const [askingName, askedName] = [`ash${stamp}`, `bay${stamp}`];
  const asking = await player(browser, baseURL!, askingName);
  const asked = await player(browser, baseURL!, askedName);

  // Asking: nobody of a name refused, then the other by theirs.
  await asking.page.getByTestId('menu-friends').click();
  await asking.page.getByTestId('friend-name').fill('nobody-of-that-name');
  await asking.page.getByTestId('friend-ask').click();
  await expect(asking.page.getByTestId('friend-refused')).toHaveText('there is no player of that name');
  await asking.page.getByTestId('friend-name').fill(askedName);
  await asking.page.getByTestId('friend-ask').click();
  await expect(asking.page.getByTestId('friend-asked')).toContainText(askedName);

  // Asked: the menu says so; accepted, each lists the other.
  await asked.page.reload();
  await expect(asked.page.getByTestId('menu-friends')).toHaveText('Friends (1)');
  await asked.page.getByTestId('menu-friends').click();
  await expect(asked.page.getByTestId('friends-asking')).toContainText(askingName);
  await asked.page.screenshot({ path: 'test-results/friends-asking.png' });
  await asked.page.getByTestId('friend-accept').click();
  await expect(asked.page.getByTestId('friend')).toHaveText(new RegExp(askingName));
  await expect(asked.page.getByTestId('friends-asking')).toHaveCount(0);
  await expect(asked.page.getByTestId('menu-friends')).toHaveText('Friends');
  await asking.page.reload();
  await asking.page.getByTestId('menu-friends').click();
  await expect(asking.page.getByTestId('friend')).toHaveText(new RegExp(askedName));

  // Removed by one, gone for both.
  await asking.page.getByTestId('friend-remove').click();
  await expect(asking.page.getByTestId('friend')).toHaveCount(0);
  await asked.page.reload();
  await asked.page.getByTestId('menu-friends').click();
  await expect(asked.page.getByTestId('friends-list')).toContainText('None yet');
  await asking.context.close();
  await asked.context.close();
});
