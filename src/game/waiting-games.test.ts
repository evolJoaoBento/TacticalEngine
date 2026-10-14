/**
 * The games waiting for the player signed in (`waiting-games.ts`): read from the server, anything it says that is
 * not a game left out, and nothing at all when it cannot be asked.
 */

import { describe, expect, it } from 'vitest';
import { WAITING_URL, listWaiting, waitingLine, type WaitingGame } from './waiting-games';

const kara: WaitingGame = { invite: 'abc', host: 'Kara', project: 'Demo Vault', characters: ['Violet'], started: false };

describe('the games waiting for a player', () => {
  it('are what the server lists for the account signed in', async () => {
    const asked: string[] = [];
    const games = await listWaiting(async (url) => {
      asked.push(url);
      return { ok: true, json: async () => ({ games: [kara, { invite: '', host: 'Nobody', project: '', characters: [], started: false }, 'not a game'] }) };
    });
    expect(asked).toEqual([WAITING_URL]);
    expect(games).toEqual([kara]);
  });

  it('are none when the server refuses, or cannot be reached', async () => {
    expect(await listWaiting(async () => ({ ok: false, json: async () => ({ games: [kara] }) }))).toEqual([]);
    expect(await listWaiting(async () => Promise.reject(new Error('offline')))).toEqual([]);
    expect(await listWaiting(async () => ({ ok: true, json: async () => ({}) }))).toEqual([]);
  });

  it('say whose game it is and who is kept there', () => {
    expect(waitingLine(kara)).toBe('Kara kept Violet for you.');
    expect(waitingLine({ ...kara, characters: ['Violet', 'Scarlet', 'Pint'], started: true })).toBe('Kara kept Violet, Scarlet and Pint for you, and has begun.');
  });
});
