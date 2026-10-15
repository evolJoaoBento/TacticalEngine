/**
 * A player's friends as the page asks the server for them (`friends.ts`): read, asked, answered and removed - each
 * write sent from the page, each answered with the friends as they stand after, or why not.
 */

import { describe, expect, it } from 'vitest';
import { FRIENDS_URL, answerFriend, askFriend, readFriends, removeFriend } from './friends';

const answer = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const wren = { id: 'wren', name: 'Wren' };

describe('friends', () => {
  it('are read for the player signed in, anything that is not a person left out; none for nobody', async () => {
    const asked: string[] = [];
    const read = await readFriends(async (url) => {
      asked.push(url);
      return { ok: true, status: 200, json: async () => ({ friends: [wren, { id: 3 }, { name: 'Nobody' }], asking: [], asked: 'nobody' }) };
    });
    expect(asked).toEqual([FRIENDS_URL]);
    expect(read).toEqual({ friends: [wren], asking: [], asked: [] });
    expect(await readFriends(answer(401, { reason: 'sign in first' }))).toBeNull();
    expect(await readFriends(async () => Promise.reject(new Error('offline')))).toBeNull();
  });

  it('are asked, answered and removed from the page, and the friends after are what comes back', async () => {
    const sent: unknown[] = [];
    const recording = async (url: string, init?: RequestInit) => {
      sent.push({ url, method: init?.method, page: (init?.headers as Record<string, string>)['x-tactical-save'], body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200, json: async () => ({ friends: [wren], asking: [], asked: [] }) };
    };
    expect(await askFriend('Wren', recording)).toEqual({ friends: [wren], asking: [], asked: [] });
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
});
