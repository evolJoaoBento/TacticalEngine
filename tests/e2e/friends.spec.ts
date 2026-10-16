import { test, expect, type Browser } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * Friends (`docs/SERVER.md`, phase 6, slice 2), from the main menu of two players' pages, each in a browser of its
 * own and signed in to an account of its own: one asks the other by name; the other's menu says somebody is asking,
 * and they accept; each lists the other; they write each other (slice 6), what is unread said on the menu and read
 * as it is shown, an answer coming without a reload - each told the other's doing at once, nothing reloaded; each sees
 * whether the other is around - online on the menu, in
 * a game once at one; written to during that game, the game's page says so at once, and its friends are the menu's,
 * read and answered over the table, the other's going from a game of their own said at once too; one removes the other, and neither lists anybody. The server keeps the friends, so this is
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

  // Asked: the menu says so at once, told over the socket it listens on; accepted, each lists the other, at once too.
  await expect(asked.page.getByTestId('menu-friends')).toHaveText('Friends (1)', { timeout: 3_000 });
  await asked.page.getByTestId('menu-friends').click();
  await expect(asked.page.getByTestId('friends-asking')).toContainText(askingName);
  await asked.page.screenshot({ path: 'test-results/friends-asking.png' });
  await asked.page.getByTestId('friend-accept').click();
  await expect(asked.page.getByTestId('friend')).toHaveText(new RegExp(askingName));
  await expect(asked.page.getByTestId('friends-asking')).toHaveCount(0);
  await expect(asked.page.getByTestId('menu-friends')).toHaveText('Friends');
  await expect(asking.page.getByTestId('friend')).toHaveText(new RegExp(askedName), { timeout: 3_000 });
  // The other, on the menu a moment ago, is online.
  await expect(asking.page.getByTestId('friend')).toHaveAttribute('data-presence', 'online');
  await expect(asking.page.getByTestId('friend-presence')).toHaveText('· online');

  // Written to: the writer sees it; the other's menu says so at once, and the friend's line how much.
  await asked.page.getByTestId('friend-write').click();
  const askedChat = asked.page.getByTestId('friend-chat');
  await expect(askedChat).toContainText('Nothing written yet.');
  await askedChat.getByTestId('chat-input').fill('  Are you free on Friday?  ');
  await askedChat.getByTestId('chat-send').click();
  await expect(askedChat.getByTestId('chat-line')).toHaveText([`${askedName} Are you free on Friday?`]);
  await expect(askedChat.getByTestId('chat-input')).toHaveValue('');
  await expect(asking.page.getByTestId('menu-friends')).toHaveText('Friends (1)', { timeout: 3_000 });
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
  // Written to with the conversation open at the game: told at once, well before it would ask again
  // (`CONVERSATION_EVERY`, from when it was opened).
  await askingChat.getByTestId('chat-input').fill('Bring the dice.');
  await askingChat.getByTestId('chat-send').click();
  await expect(playingChat.getByTestId('chat-line').last()).toHaveText(`${askingName} Bring the dice.`, { timeout: 1_500 });
  await playingChat.getByTestId('chat-input').fill('Rolling now.');
  await playingChat.getByTestId('chat-send').click();
  await expect(askingChat.getByTestId('chat-line').last()).toHaveText(`${askedName} Rolling now.`);
  await asked.page.screenshot({ path: 'test-results/friends-in-play.png' });
  await asked.page.keyboard.press('Escape');
  await expect(asked.page.getByTestId('friends-sheet')).toHaveCount(0);
  await expect(asked.page.getByTestId('user-settings')).toHaveCount(0);
  await expect(friendsInPlay).toHaveText('Friends');
  // Shut, the button asked just now and not again for a while (`FRIENDS_EVERY`): written to, it says so at once.
  await askingChat.getByTestId('chat-input').fill('Still there?');
  await askingChat.getByTestId('chat-send').click();
  await expect(friendsInPlay).toHaveText('Friends (1)', { timeout: 3_000 });
  // And the list on the sheet, opened just now, at once too.
  await friendsInPlay.click();
  const onTheSheet = asked.page.getByTestId('friends-sheet').getByTestId('friend-write');
  await expect(onTheSheet).toHaveText('Messages (1)');
  await askingChat.getByTestId('chat-input').fill('Hello?');
  await askingChat.getByTestId('chat-send').click();
  await expect(onTheSheet).toHaveText('Messages (2)', { timeout: 3_000 });
  await asked.page.keyboard.press('Escape');
  // The friend comes to a game of their own, and goes: the list on the sheet, opened between, told the going at once.
  await asking.page.goto('/?play');
  await asking.page.waitForFunction(() => window.__replica?.server() === 'in', null, { timeout: 60_000 });
  await friendsInPlay.click();
  const around = asked.page.getByTestId('friends-sheet').getByTestId('friend-presence');
  await expect(around).toHaveText('· in a game');
  await asking.page.goto('/?menu');
  await expect(around).toHaveText('· online', { timeout: 3_000 });
  await asked.page.keyboard.press('Escape');
  await asking.page.getByTestId('menu-friends').click();
  await asked.page.goto('/?menu');

  // Removed by one, gone for both - the other's list, open on the menu, told at once.
  await asked.page.getByTestId('menu-friends').click();
  await expect(asked.page.getByTestId('friend')).toHaveText(new RegExp(askingName));
  await asking.page.getByTestId('friend-remove').click();
  await expect(asking.page.getByTestId('friend')).toHaveCount(0);
  await expect(asked.page.getByTestId('friends-list')).toContainText('None yet', { timeout: 3_000 });
  await asking.context.close();
  await asked.context.close();
});
