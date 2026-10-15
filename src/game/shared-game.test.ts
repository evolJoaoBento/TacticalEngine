/**
 * The shared game as the page shows it (`shared-game.ts`): the table the wire is told, handed to whoever listens;
 * the host's seating sent through the wire; the invitation's address, and the one the page was opened with.
 */

import { describe, expect, it } from 'vitest';
import { answers, changeVisibility, chat, hosting, invitationLink, invitationOf, inviteFrom, lobbyAsked, membersLine, onChat, onSharedTable, plays, playsFor, say, seat, seatFor, seatable, sharedTable, start, started, tableOf, visibilityAsked, waitingOn } from './shared-game';
import type { ChatLine, SharedTable, Wire } from './wire';

const TABLE: SharedTable = { game: 'g', host: 'kara', invite: 'ab12', members: [{ id: 'kara', name: 'Kara' }], seats: {}, started: true };

/** As much of a wire as the table reads: told the table, and asked to seat. */
function wireTelling(you = 'kara'): { wire: Wire; tell: (table: SharedTable) => void; seated: [string, string | null][]; starts: number[]; found: string[]; hear: (chat: ChatLine[]) => void; said: string[] } {
  let heard: (table: SharedTable) => void = () => undefined;
  let hearChat: (chat: ChatLine[]) => void = () => undefined;
  const said: string[] = [];
  const seated: [string, string | null][] = [];
  const starts: number[] = [];
  const found: string[] = [];
  const wire = {
    you,
    onChat: (listener: (chat: ChatLine[]) => void) => {
      hearChat = listener;
    },
    say: (text: string) => {
      said.push(text);
      return Promise.resolve(text === 'too loud' ? 'refused' : null);
    },
    setVisibility: (visibility: string) => {
      found.push(visibility);
      return Promise.resolve(true);
    },
    startGame: () => {
      starts.push(1);
      return Promise.resolve(true);
    },
    onTable: (listener: (table: SharedTable) => void) => {
      heard = listener;
    },
    seat: (character: string, account: string | null) => {
      seated.push([character, account]);
      return Promise.resolve(true);
    },
  } as unknown as Wire;
  return { wire, tell: (table) => heard(table), seated, starts, found, hear: (lines) => hearChat(lines), said };
}

describe('who is at the table', () => {
  const table: SharedTable = {
    game: 'g',
    host: 'kara',
    invite: 'i',
    members: [
      { id: 'kara', name: 'Kara' },
      { id: 'finn', name: 'Finn' },
      { id: 'mira', name: 'Mira' },
    ],
    seats: {},
    started: false,
  };

  it('is listed with the host said, and whoever has gone away; a table that says nobody is here says nobody is away', () => {
    expect(membersLine({ ...table, here: ['finn'] })).toBe('Kara (host) (away) · Finn · Mira (away)');
    expect(membersLine({ ...table, here: ['kara', 'finn', 'mira'] })).toBe('Kara (host) · Finn · Mira');
    expect(membersLine(table)).toBe('Kara (host) · Finn · Mira');
  });
});

describe('what is said at the table', () => {
  it('is what the wire is told, handed to whoever listens, said through it, and nothing without a server', async () => {
    const { wire, hear, said } = wireTelling();
    const heard: ChatLine[][] = [];
    const stop = onChat((lines) => heard.push(lines));
    tableOf(wire);
    expect(chat()).toEqual([]);
    const line: ChatLine = { from: 'finn', name: 'Finn', text: 'Ready.', at: 1 };
    hear([line]);
    expect(chat()).toEqual([line]);
    expect(heard.at(-1)).toEqual([line]);
    expect(await say('On my way.')).toBeNull();
    expect(await say('too loud')).toBe('refused');
    expect(said).toEqual(['On my way.', 'too loud']);
    // No server: nothing said, and nothing to say it to.
    tableOf(null);
    expect(chat()).toEqual([]);
    expect(await say('anybody?')).toBe('not at a game');
    stop();
  });
});

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
  it("says what the page plays and which questions are its to answer, as the engine's seats do", () => {
    const party = { game: 'g', host: 'kara', invite: 'i', members: [{ id: 'kara', name: 'Kara' }, { id: 'finn', name: 'Finn' }], seats: { mira: 'finn' }, started: true };
    // No table: everything is the page's.
    tableOf(null);
    expect(playsFor('mira')).toBe(true);
    expect(answers({ for: 'mira' })).toBe(true);
    expect(waitingOn({ for: 'mira' }, (id) => id)).toBeNull();
    // The host: whoever nobody is seated in, and a question about nobody in particular - not the guest's.
    const host = wireTelling('kara');
    tableOf(host.wire);
    host.tell(party);
    expect(playsFor('arty')).toBe(true);
    expect(playsFor('mira')).toBe(false);
    expect(answers({ for: null })).toBe(true);
    expect(answers(null)).toBe(true);
    expect(answers({ for: 'mira' })).toBe(false);
    expect(waitingOn({ for: 'mira' }, (id) => `the ${id}`)).toBe('Waiting for Finn to answer for the mira.');
    // The guest: their own, and nothing else - a question about nobody in particular waits on the host.
    const guest = wireTelling('finn');
    tableOf(guest.wire);
    guest.tell(party);
    expect(playsFor('mira')).toBe(true);
    expect(playsFor('arty')).toBe(false);
    expect(answers({ for: 'arty' })).toBe(false);
    expect(waitingOn({ for: 'arty' }, (id) => id)).toBe('Waiting for Kara to answer for arty.');
    expect(waitingOn({ for: null }, (id) => id)).toBe('Waiting for Kara.');
    expect(waitingOn({ for: 'mira' }, (id) => id)).toBeNull();
    tableOf(null);
  });

  it('gathers in a lobby before the host starts it: nobody plays anybody, and the players take their own seats', async () => {
    const lobby: SharedTable = { game: 'g', host: 'kara', invite: 'i', members: [{ id: 'kara', name: 'Kara' }, { id: 'finn', name: 'Finn' }], seats: { mira: 'finn' }, started: false };
    expect(plays({ you: 'kara', host: 'kara', seats: {}, started: false }, 'arty')).toBe(false);
    expect(plays({ you: 'kara', host: 'kara', seats: {} }, 'arty')).toBe(true);
    // At no table the game has always started, and no seat is anybody's to take.
    tableOf(null);
    expect(started()).toBe(true);
    expect(seatFor('arty')).toBeNull();
    expect(await start()).toBe(false);
    // The guest: a seat nobody has to take, their own to leave, another's neither.
    const guest = wireTelling('finn');
    tableOf(guest.wire);
    guest.tell(lobby);
    expect(started()).toBe(false);
    expect(playsFor('mira')).toBe(false);
    expect(answers({ for: 'mira' })).toBe(false);
    expect(seatFor('arty')).toBe('take');
    expect(seatFor('mira')).toBe('leave');
    guest.tell({ ...lobby, seats: { mira: 'kara' } });
    expect(seatFor('mira')).toBeNull();
    // A seat a save hosted again keeps for a player not back yet is nobody else's to take.
    guest.tell({ ...lobby, kept: { arty: { id: 'pip', name: 'Pip' } } });
    expect(seatFor('arty')).toBeNull();
    expect(seatFor('scarlet')).toBe('take');
    // Started: the host's to say again, and the guest plays their own.
    guest.tell({ ...lobby, started: true });
    expect(started()).toBe(true);
    expect(seatFor('arty')).toBeNull();
    expect(playsFor('mira')).toBe(true);
    // The host chooses for anybody, at any time, and starts it through the wire.
    const host = wireTelling('kara');
    tableOf(host.wire);
    host.tell(lobby);
    expect(seatFor('mira')).toBe('choose');
    expect(seatFor('arty')).toBe('choose');
    expect(await start()).toBe(true);
    expect(host.starts).toEqual([1]);
    // Who may find it, said through the wire.
    expect(await changeVisibility('public')).toBe(true);
    expect(host.found).toEqual(['public']);
    tableOf(null);
    expect(await changeVisibility('friends')).toBe(false);
  });

  it('is hosted by asking at the address, and joined with the link the host sent or the invitation alone', () => {
    expect(lobbyAsked('?play&host')).toBe(true);
    expect(lobbyAsked('?play&host=friends')).toBe(true);
    expect(lobbyAsked('?play')).toBe(false);
    // Found by whoever the address says; by its invitation alone for anything else.
    expect(visibilityAsked('?play&host=public')).toBe('public');
    expect(visibilityAsked('?play&host=friends')).toBe('friends');
    expect(visibilityAsked('?play&host')).toBe('invite');
    expect(visibilityAsked('?play&host=everybody')).toBe('invite');
    const invite = '0123456789abcdef0123456789abcdef';
    expect(inviteFrom(` https://friends.example/?join=${invite} `)).toBe(invite);
    expect(inviteFrom(invite)).toBe(invite);
    expect(inviteFrom('https://friends.example/?play')).toBeNull();
    expect(inviteFrom('not an invitation')).toBeNull();
    expect(inviteFrom('')).toBeNull();
  });
});
