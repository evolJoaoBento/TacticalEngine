/**
 * A rest as the page offers it (`rest-call.ts`): whether the page's player rests alone - one click - or calls a rest
 * the others agree to; whether they are asked to agree; whether they may call it off; and whose each character is.
 */

import { describe, expect, it } from 'vitest';
import { playersOf, restView } from './rest-call';
import { tableOf } from './shared-game';
import type { RestCall } from './demo-abilities';
import type { SharedTable, Wire } from './wire';

const TABLE: SharedTable = {
  game: 'g',
  host: 'kara',
  invite: 'i',
  members: [
    { id: 'kara', name: 'Kara' },
    { id: 'finn', name: 'Finn' },
  ],
  seats: { violet: 'finn' },
  started: true,
};

/** The page at the table as `you`. */
function at(you: string, table: SharedTable = TABLE): void {
  let heard: (table: SharedTable) => void = () => undefined;
  tableOf({ you, onTable: (listener: (table: SharedTable) => void) => (heard = listener) } as unknown as Wire);
  heard(table);
}

const party = ['quim', 'violet', 'scarlet'];
const nameOf = (id: string): string => id.toUpperCase();
const called: RestCall = { kind: 'short', by: 'kara', voters: ['kara', 'finn'], agreed: ['kara'], moves: { quim: [{ kind: 'prepare' }, { kind: 'prepare' }] } };

describe('a rest, as the page offers it', () => {
  it('is one click for a player alone - at no table, or playing everybody', () => {
    tableOf(null);
    expect(playersOf(party)).toEqual(['']);
    expect(restView(null, party, nameOf)).toMatchObject({ alone: true, toVote: false, party: party.map((id) => ({ id, name: id.toUpperCase(), mine: true })) });
    expect(restView(null, party, nameOf, 2).shortRests).toBe(2);
    at('kara', { ...TABLE, seats: {} });
    expect(restView(null, party, nameOf).alone).toBe(true);
    tableOf(null);
  });

  it('is called and agreed to by everybody who plays a character, each choosing their own', () => {
    at('kara');
    expect(playersOf(party)).toEqual(['kara', 'finn']);
    const host = restView(called, party, nameOf);
    expect(host.alone).toBe(false);
    expect(host.toVote).toBe(false);
    expect(host.mayCancel).toBe(true);
    expect(host.party.map((m) => m.mine)).toEqual([true, false, true]);
    expect(host.playerOf('kara')).toBe('You');
    at('finn');
    const guest = restView(called, party, nameOf);
    expect(guest.toVote).toBe(true);
    expect(guest.mayCancel).toBe(false);
    expect(guest.party.filter((m) => m.mine).map((m) => m.id)).toEqual(['violet']);
    expect(guest.playerOf('kara')).toBe('Kara');
    // Agreed: no longer asked; and the one who called it may call it off.
    expect(restView({ ...called, agreed: ['kara', 'finn'] }, party, nameOf).toVote).toBe(false);
    expect(restView({ ...called, by: 'finn' }, party, nameOf).mayCancel).toBe(true);
    // A watcher, seated in nobody, plays nobody and is not asked.
    at('pip', { ...TABLE, members: [...TABLE.members, { id: 'pip', name: 'Pip' }] });
    const watcher = restView(called, party, nameOf);
    expect(watcher.toVote).toBe(false);
    expect(watcher.party.some((m) => m.mine)).toBe(false);
    tableOf(null);
  });
});
