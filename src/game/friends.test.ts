/**
 * A player's friends as the page asks the server for them (`friends.ts`): read, asked, answered and removed - each
 * write sent from the page, each answered with the friends as they stand after, or why not. And what friends write
 * each other: a conversation read, written to, and read up to a message, with what is unread counted.
 */

import { describe, expect, it } from 'vitest';
import { FRIENDS_URL, answerFriend, askFriend, onPlayingAs, playAs, playingAs, presenceWord, readConversation, readFriends, readUpTo, removeFriend, unreadOf, writeTo } from './friends';

const answer = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const wren = { id: 'wren', name: 'Wren' };

describe('friends', () => {
  it('are read for the player signed in, anything that is not a person left out; none for nobody', async () => {
    const asked: string[] = [];
    const read = await readFriends(async (url) => {
      asked.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ friends: [wren, { id: 3 }, { name: 'Nobody' }], asking: [], asked: 'nobody', unread: { wren: 2, pip: 0, moth: 'many' }, online: { wren: 'playing', pip: 'online', moth: 'asleep', finn: 1 } }),
      };
    });
    expect(asked).toEqual([FRIENDS_URL]);
    expect(read).toEqual({ friends: [wren], asking: [], asked: [], unread: { wren: 2 }, online: { wren: 'playing', pip: 'online' } });
    expect(await readFriends(answer(200, { friends: [] }))).toEqual({ friends: [], asking: [], asked: [], unread: {}, online: {} });
    expect(await readFriends(answer(401, { reason: 'sign in first' }))).toBeNull();
    expect(await readFriends(async () => Promise.reject(new Error('offline')))).toBeNull();
  });

  it('are asked, answered and removed from the page, and the friends after are what comes back', async () => {
    const sent: unknown[] = [];
    const recording = async (url: string, init?: RequestInit) => {
      sent.push({ url, method: init?.method, page: (init?.headers as Record<string, string>)['x-tactical-save'], body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200, json: async () => ({ friends: [wren], asking: [], asked: [], unread: {}, online: {} }) };
    };
    expect(await askFriend('Wren', recording)).toEqual({ friends: [wren], asking: [], asked: [], unread: {}, online: {} });
    await answerFriend('wren', false, recording);
    await removeFriend('wren', recording);
    expect(sent).toEqual([
      { url: '/__friends/ask', method: 'POST', page: '1', body: { name: 'Wren' } },
      { url: '/__friends/answer', method: 'POST', page: '1', body: { from: 'wren', accept: false } },
      { url: '/__friends/remove', method: 'POST', page: '1', body: { id: 'wren' } },
    ]);
  });

  it('say why not', async () => {
    expect(await askFriend('nobody', answer(404, { reason: 'there is no player of that name' }))).toEqual({ refused: 'there is no player of that name' });
    expect(await removeFriend('wren', async () => Promise.reject(new Error('offline')))).toEqual({ refused: 'the server could not be reached' });
  });

  it("count what friends have written unread: one friend's, or every friend's", () => {
    const view = { friends: [wren], asking: [], asked: [], unread: { wren: 2, pip: 3 }, online: {} };
    expect([unreadOf(view, 'wren'), unreadOf(view, 'moth'), unreadOf(view), unreadOf(null)]).toEqual([2, 0, 5, 0]);
  });

  it('say whether a friend is around: in a game, online, or nothing', () => {
    expect([presenceWord('playing'), presenceWord('online'), presenceWord(undefined)]).toEqual(['in a game', 'online', null]);
  });

  it('write to a friend, read what they wrote, and read it up to a message, from the page', async () => {
    const said = { n: 4, from: 'wren', text: 'Hello', at: 1000 };
    const sent: unknown[] = [];
    const recording = async (url: string, init?: RequestInit) => {
      sent.push(init?.method === 'POST' ? { url, page: (init.headers as Record<string, string>)['x-tactical-save'], body: JSON.parse(String(init.body)) } : { url });
      const body = url.endsWith('/read') ? { friends: [wren], asking: [], asked: [], unread: {}, online: {} } : { with: wren, messages: [said, { n: 5, from: 'wren' }, 'nothing'] };
      return { ok: true, status: 200, json: async () => body };
    };
    expect(await readConversation('wren', recording)).toEqual({ with: wren, messages: [said] });
    expect(await writeTo('wren', 'Hello', recording)).toEqual({ with: wren, messages: [said] });
    expect(await readUpTo('wren', 4, recording)).toEqual({ friends: [wren], asking: [], asked: [], unread: {}, online: {} });
    expect(sent).toEqual([
      { url: '/__friends/messages/wren' },
      { url: '/__friends/say', page: '1', body: { to: 'wren', text: 'Hello' } },
      { url: '/__friends/read', page: '1', body: { id: 'wren', upTo: 4 } },
    ]);
    // Nobody's friend, or no server: nothing to read; refused, why.
    expect(await readConversation('moth', answer(404, { reason: "you can only read a friend's messages" }))).toBeNull();
    expect(await readConversation('wren', async () => Promise.reject(new Error('offline')))).toBeNull();
    expect(await writeTo('moth', 'Hi', answer(404, { reason: 'you can only write to a friend' }))).toEqual({ refused: 'you can only write to a friend' });
  });

  it("knows whom the game's page plays as - whose friends it shows - and tells whoever asked to be told", () => {
    expect(playingAs()).toBeNull();
    const told: unknown[] = [];
    const stop = onPlayingAs((player) => told.push(player));
    // The account as the server says it: its id and name, nothing else kept.
    playAs({ id: 'wren', name: 'Wren', admin: false } as { id: string; name: string });
    expect(playingAs()).toEqual({ id: 'wren', name: 'Wren' });
    playAs(null);
    stop();
    playAs({ id: 'pip', name: 'Pip' });
    expect(told).toEqual([{ id: 'wren', name: 'Wren' }, null]);
    expect(playingAs()).toEqual({ id: 'pip', name: 'Pip' });
    playAs(null);
  });
});
