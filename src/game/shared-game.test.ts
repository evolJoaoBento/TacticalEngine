/**
 * The shared game as the page shows it (`shared-game.ts`): the table the wire is told, handed to whoever listens;
 * the host's seating sent through the wire; the invitation's address, and the one the page was opened with.
 */

import { describe, expect, it } from 'vitest';
import { hosting, invitationLink, invitationOf, onSharedTable, seat, seatable, sharedTable, tableOf } from './shared-game';
import type { SharedTable, Wire } from './wire';

const TABLE: SharedTable = { game: 'g', host: 'kara', invite: 'ab12', members: [{ id: 'kara', name: 'Kara' }], seats: {} };

/** As much of a wire as the table reads: told the table, and asked to seat. */
function wireTelling(): { wire: Wire; tell: (table: SharedTable) => void; seated: [string, string | null][] } {
  let heard: (table: SharedTable) => void = () => undefined;
  const seated: [string, string | null][] = [];
  const wire = {
    you: 'kara',
    onTable: (listener: (table: SharedTable) => void) => {
      heard = listener;
    },
    seat: (character: string, account: string | null) => {
      seated.push([character, account]);
      return Promise.resolve(true);
    },
  } as unknown as Wire;
  return { wire, tell: (table) => heard(table), seated };
}

describe('the shared game, as the page shows it', () => {
  it('is the table the wire is told, handed to whoever listens, and none without a server', async () => {
    const { wire, tell, seated } = wireTelling();
    const told: (SharedTable | null)[] = [];
    const stop = onSharedTable((table) => told.push(table));
    tableOf(wire, () => [{ id: 'kara', name: 'Quim' }]);
    expect(sharedTable()).toBeNull();
    expect(hosting()).toBe(false);
    tell(TABLE);
    expect(sharedTable()).toEqual(TABLE);
    // The page plays as the host, as the server says who it plays as.
    expect(hosting()).toBe(true);
    tell({ ...TABLE, host: 'finn' });
    expect(hosting()).toBe(false);
    tell(TABLE);
    expect(seatable()).toEqual([{ id: 'kara', name: 'Quim' }]);
    // The host's word on who plays whom goes through the wire.
    expect(await seat('kara', 'finn')).toBe(true);
    expect(seated).toEqual([['kara', 'finn']]);
    // A page with no server: no table, and nobody seated.
    tableOf(null);
    expect(sharedTable()).toBeNull();
    expect(await seat('kara', 'finn')).toBe(false);
    stop();
    tell(TABLE);
    expect(told).toEqual([null, TABLE, { ...TABLE, host: 'finn' }, TABLE, null]);
  });

  it('is joined at the page\'s own address with the invitation, read back as the page opens', () => {
    expect(invitationLink('ab 12', 'https://friends.example')).toBe('https://friends.example/?join=ab%2012');
    expect(invitationOf('?join=ab%2012')).toBe('ab 12');
    expect(invitationOf('?join=')).toBeNull();
    expect(invitationOf('?play')).toBeNull();
  });
});
