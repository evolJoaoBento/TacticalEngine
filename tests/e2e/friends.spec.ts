import { test, expect, type Browser } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * Friends (`docs/SERVER.md`, phase 6, slice 2), from the main menu of two players' pages, each in a browser of its
 * own and signed in to an account of its own: one asks the other by name; the other's menu says somebody is asking,
 * and they accept; each lists the other; they write each other (slice 6), what is unread said on the menu and read
 * as it is shown, an answer coming without a reload; each sees whether the other is around - online on the menu, in
 * a game once at one; written to during that game, the game's page says so, and its friends are the menu's, read and
 * answered over the table; one removes the other, and neither lists anybody. The server keeps the friends, so this is
 * played on the server alone.
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
  // The other, on the menu a moment ago, is online.
  await expect(asking.page.getByTestId('friend')).toHaveAttribute('data-presence', 'online');
  await expect(asking.page.getByTestId('friend-presence')).toHaveText('· online');

  // Written to: the writer sees it; the other's menu says so, and the friend's line how much.
  await asked.page.getByTestId('friend-write').click();
  const askedChat = asked.page.getByTestId('friend-chat');
  await expect(askedChat).toContainText('Nothing written yet.');
  await askedChat.getByTestId('chat-input').fill('  Are you free on Friday?  ');
  await askedChat.getByTestId('chat-send').click();
  await expect(askedChat.getByTestId('chat-line')).toHaveText([`${askedName} Are you free on Friday?`]);
  await expect(askedChat.getByTestId('chat-input')).toHaveValue('');
  await asking.page.reload();
  await expect(asking.page.getByTestId('menu-friends')).toHaveText('Friends (1)');
  await asking.page.getByTestId('menu-friends').click();
  await expect(asking.page.getByTestId('friend-write')).toHaveText('Messages (1)');
  // Shown, it is read: nothing unread once back on the list.
  await asking.page.getByTestId('friend-write').click();
  const askingChat = asking.page.getByTestId('friend-chat');
  await expect(askingChat.getByTestId('chat-line')).toHaveText([`${askedName} Are you free on Friday?`]);
  await expect(asking.page.getByTestId('friend-messages-presence')).toHaveText('· online');
  await expect(asking.page.getByTestId('menu-friends')).toHaveText('Friends');
  // Answered: the other's open conversation has it without a reload.
  await askingChat.getByTestId('chat-input').fill('I am. Bring the dice.');
  await askingChat.getByTestId('chat-send').click();
  await expect(askedChat.getByTestId('chat-line')).toHaveText([`${askedName} Are you free on Friday?`, `${askingName} I am. Bring the dice.`]);
  await asked.page.screenshot({ path: 'test-results/friends-messages.png' });
  await asking.page.getByTestId('friend-messages-back').click();
  await expect(asking.page.getByTestId('friend-write')).toHaveText('Messages');
  // The other goes to play, alone: the friends' list, asked again in a while, says so.
  await asked.page.goto('/?play');
  await expect(asking.page.getByTestId('friend-presence')).toHaveText('· in a game', { timeout: 25_000 });
  // Written to during the game: the game's page says so, and its friends are the menu's - read and answered over the
  // table, shut with Escape, which opens no settings behind them.
  await asking.page.getByTestId('friend-write').click();
  await askingChat.getByTestId('chat-input').fill('Ready to roll?');
  await askingChat.getByTestId('chat-send').click();
  const friendsInPlay = asked.page.getByTestId('play-friends');
  await expect(friendsInPlay).toHaveText('Friends (1)', { timeout: 25_000 });
  await asked.page.screenshot({ path: 'test-results/friends-in-play-waiting.png' });
  await friendsInPlay.click();
  await expect(asked.page.getByTestId('friends-sheet').getByTestId('friend-write')).toHaveText('Messages (1)');
  await asked.page.getByTestId('friend-write').click();
  const playingChat = asked.page.getByTestId('friend-chat');
  await expect(playingChat.getByTestId('chat-line').last()).toHaveText(`${askingName} Ready to roll?`);
  await playingChat.getByTestId('chat-input').fill('Rolling now.');
  await playingChat.getByTestId('chat-send').click();
  await expect(askingChat.getByTestId('chat-line').last()).toHaveText(`${askedName} Rolling now.`);
  await asked.page.screenshot({ path: 'test-results/friends-in-play.png' });
  await asked.page.keyboard.press('Escape');
  await expect(asked.page.getByTestId('friends-sheet')).toHaveCount(0);
  await expect(asked.page.getByTestId('user-settings')).toHaveCount(0);
  await expect(friendsInPlay).toHaveText('Friends');
  await asking.page.getByTestId('friend-messages-back').click();
  await asked.page.goto('/?menu');

  // Removed by one, gone for both.
  await asking.page.getByTestId('friend-remove').click();
  await expect(asking.page.getByTestId('friend')).toHaveCount(0);
  await asked.page.reload();
  await asked.page.getByTestId('menu-friends').click();
  await expect(asked.page.getByTestId('friends-list')).toContainText('None yet');
  await asking.context.close();
  await asked.context.close();
});
