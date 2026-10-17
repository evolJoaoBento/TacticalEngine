/**
 * The games the player signed in may join (`joinable-games.ts`): read from the server, anything it says that is not a
 * game left out, nothing at all when it cannot be asked; and how the menu words them.
 */

import { describe, expect, it } from 'vitest';
import { JOINABLE_URL, joinableLine, joinableSummary, listJoinable, type JoinableGame } from './joinable-games';

const kara: JoinableGame = { invite: 'abc', host: 'Kara', project: 'Demo Vault', players: 1, started: false, visibility: 'invite', kept: ['Violet'] };
const finn: JoinableGame = { invite: 'def', host: 'Finn', project: 'Demo Vault', players: 3, started: true, visibility: 'public', kept: [] };

describe('the games a player may join', () => {
  it('are what the server lists for the account signed in', async () => {
    const asked: string[] = [];
    const games = await listJoinable(async (url) => {
      asked.push(url);
      return {
        ok: true,
        json: async () => ({ games: [kara, finn, { ...finn, invite: '' }, { ...finn, visibility: 'everybody' }, { ...finn, players: '3' }, 'not a game'] }),
      };
    });
    expect(asked).toEqual([JOINABLE_URL]);
    expect(games).toEqual([kara, finn]);
  });

  it('are none when the server refuses, or cannot be reached', async () => {
    expect(await listJoinable(async () => ({ ok: false, json: async () => ({ games: [kara] }) }))).toEqual([]);
    expect(await listJoinable(async () => Promise.reject(new Error('offline')))).toEqual([]);
    expect(await listJoinable(async () => ({ ok: true, json: async () => ({}) }))).toEqual([]);
  });

  it('say who kept whom for the player, or whose game it is, who may find it and how far it has got', () => {
    expect(joinableLine(kara)).toBe('Kara kept Violet for you.');
    expect(joinableLine({ ...kara, kept: ['Violet', 'Scarlet', 'Pint'], started: true })).toBe('Kara kept Violet, Scarlet and Pint for you, and has begun.');
    expect(joinableLine(finn)).toBe("Finn's game, open to everybody · 3 at it, begun.");
    expect(joinableLine({ ...finn, visibility: 'friends', started: false, players: 1 })).toBe("Finn's game, for friends · 1 at it, gathering.");
  });

  it('are summed up under Play Together: a seat kept first, else how many', () => {
    expect(joinableSummary([finn, kara])).toBe('Kara has a game waiting for you');
    expect(joinableSummary([finn])).toBe('Finn has a game you can join');
    expect(joinableSummary([finn, { ...finn, invite: 'ghi' }])).toBe('2 games you can join');
    expect(joinableSummary([])).toBeNull();
  });
});
