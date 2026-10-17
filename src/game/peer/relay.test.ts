/**
 * The peer games' relay, from the page (`relay.ts`), and the host's room run over it (`peer-play.ts`, `openHostRoom`)
 * and a guest's page meeting the host there (`meetAtRoom`): the routes asked as `peer.rs` answers them, every
 * failure `null`, and the room opened again when it is gone.
 */

import { describe, expect, it } from 'vitest';
import { answerKnock, answerOf, knock, openRoom, relayAllowed, roomLink, roomOf, takeKnocks, waitForAnswer, type Fetch } from './relay';
import { closeHostRoom, hostRoomLink, meetAtRoom, onHostRoom, openHostRoom, prepareHost, ROOM_LOST_AFTER, type RoomHands } from './peer-play';

/** A fetch that answers from a table of routes, and says what it was asked. */
function fake(answers: Record<string, unknown>, asked: { url: string; init?: RequestInit }[] = []): Fetch {
  return (url, init) => {
    asked.push({ url, ...(init === undefined ? {} : { init }) });
    const said = answers[`${init?.method ?? 'GET'} ${url}`];
    if (said === undefined) return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'no such room' }) });
    if (said instanceof Error) return Promise.reject(said);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(said) });
  };
}

const R = 'a'.repeat(32);
const room = { room: R, secret: 's'.repeat(32) };

describe('the relay, from the page', () => {
  it('asks the routes the server answers, the page\'s header on each post and the secret on the host\'s', async () => {
    const asked: { url: string; init?: RequestInit }[] = [];
    const send = fake(
      {
        'POST /__peer/rooms': room,
        [`POST /__peer/rooms/${R}/knock`]: { knock: 'k1' },
        [`GET /__peer/rooms/${R}/knocks`]: { knocks: [{ knock: 'k1', code: 'TE1.g' }, { nonsense: true }] },
        [`POST /__peer/rooms/${R}/answers/k1`]: { ok: true },
        [`GET /__peer/rooms/${R}/answers/k1`]: { code: 'TE1.h' },
      },
      asked,
    );
    expect(await openRoom(send)).toEqual(room);
    expect(await knock(R, 'TE1.g', send)).toBe('k1');
    expect(await takeKnocks(room, send)).toEqual([{ knock: 'k1', code: 'TE1.g' }]);
    expect(await answerKnock(room, 'k1', 'TE1.h', send)).toBe(true);
    expect(await answerOf(R, 'k1', send)).toBe('TE1.h');
    const posted = asked.filter((a) => a.init?.method === 'POST');
    expect(posted.every((a) => (a.init!.headers as Record<string, string>)['x-tactical-save'] === '1')).toBe(true);
    expect((asked[2]!.init!.headers as Record<string, string>)['x-peer-secret']).toBe(room.secret);
    expect(JSON.parse(String(asked[1]!.init!.body))).toEqual({ code: 'TE1.g' });
  });

  it('is null wherever it fails: no server, refused, or gone', async () => {
    const none = fake({});
    expect(await openRoom(none)).toBeNull();
    expect(await knock(R, 'x', none)).toBeNull();
    expect(await takeKnocks(room, none)).toBeNull();
    expect(await answerKnock(room, 'k', 'x', none)).toBe(false);
    expect(await answerOf(R, 'k', none)).toBeUndefined();
    expect(await openRoom(fake({ 'POST /__peer/rooms': new Error('offline') }))).toBeNull();
  });

  it('waits for an answer, asking every so often, until it comes, the room goes, or the time is up', async () => {
    const waits: number[] = [];
    const wait = (ms: number): Promise<void> => {
      waits.push(ms);
      return Promise.resolve();
    };
    let asks = 0;
    const later: Fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ code: ++asks < 3 ? null : 'TE1.h' }) });
    expect(await waitForAnswer(R, 'k', { send: later, every: 10, within: 1000, wait })).toBe('TE1.h');
    expect(waits).toEqual([10, 10]);
    const never: Fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ code: null }) });
    expect(await waitForAnswer(R, 'k', { send: never, every: 10, within: 30, wait })).toBeNull();
    expect(await waitForAnswer(R, 'k', { send: fake({}), every: 10, within: 1000, wait })).toBeNull();
  });

  it('is asked only where a server is behind the page, unless turned off; its link and room read back', () => {
    expect(relayAllowed({ DEV: true, MODE: 'development' }, '?peer=host')).toBe(true);
    expect(relayAllowed({ DEV: false, MODE: 'server' }, '?peer=host')).toBe(true);
    expect(relayAllowed({ DEV: false, MODE: 'production' }, '?peer=host')).toBe(false);
    expect(relayAllowed({ DEV: true, MODE: 'development' }, '?peer=host&relay=off')).toBe(false);
    expect(roomLink(R, 'https://x.example')).toBe(`https://x.example/?peer=join&room=${R}`);
    expect(roomOf(`?peer=join&room=${R}`)).toBe(R);
    expect(roomOf('?peer=join&room=nope')).toBeNull();
  });
});

describe("the host's room", () => {
  it('opens where it may, answers every knock taken, and opens another once the room has gone', async () => {
    const opened: string[] = [];
    let knocksAt = 0;
    const answered: string[] = [];
    const left: string[] = [];
    let gone = false;
    const hands: RoomHands = {
      openRoom: () => {
        opened.push('r');
        return Promise.resolve({ room: `${'b'.repeat(31)}${opened.length}`, secret: 's' });
      },
      takeKnocks: () => Promise.resolve(gone ? null : ++knocksAt === 1 ? [{ knock: 'k1', code: 'TE1.g' }] : []),
      answerKnock: (_at, knocked, code) => {
        left.push(`${knocked}:${code}`);
        return Promise.resolve(true);
      },
      answerGuest: (code) => {
        answered.push(code);
        return Promise.resolve({ who: { id: 'g', name: 'Gus' }, code: 'TE1.h', joined: Promise.resolve({ id: 'g', name: 'Gus' }) });
      },
      every: 5,
    };
    // No table: nothing to open a room for.
    expect(await openHostRoom(hands, true)).toBe(false);
    prepareHost({ respond: () => ({ ok: null }) });
    expect(await openHostRoom(hands, false)).toBe(false);
    const links: (string | null)[] = [];
    onHostRoom((link) => links.push(link));
    expect(await openHostRoom(hands, true)).toBe(true);
    expect(hostRoomLink()).toMatch(/\?peer=join&room=b{31}1$/);
    await expect.poll(() => left).toEqual(['k1:TE1.h']);
    expect(answered).toEqual(['TE1.g']);
    // Gone: a few failures in a row, and another room - another link.
    gone = true;
    await expect.poll(() => opened.length, { timeout: 2000 }).toBe(2);
    expect(links.at(-1)).toMatch(/room=b{31}2$/);
    expect(links).toContain(null);
    expect(ROOM_LOST_AFTER).toBeGreaterThan(1);
    closeHostRoom();
    expect(hostRoomLink()).toBeNull();
  });
});

describe("a guest's page meeting the host at a room", () => {
  const asking = (accepted: RTCDataChannel | Error): Parameters<typeof meetAtRoom>[3] => () =>
    Promise.resolve({ code: 'TE1.g', accept: () => (accepted instanceof Error ? Promise.reject(accepted) : Promise.resolve(accepted)), close: () => undefined });
  const channel = {} as RTCDataChannel;

  it('leaves its code, takes the answer, and opens the channel', async () => {
    const send: Fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 'TE1.h' }) });
    expect(await meetAtRoom(R, { send, every: 1, wait: () => Promise.resolve() }, () => Promise.resolve('k1'), asking(channel))).toBe(channel);
  });

  it('is null when the room is gone, nobody answers, or the channel never opens', async () => {
    const quick = { every: 1, within: 3, wait: () => Promise.resolve() };
    expect(await meetAtRoom(R, quick, () => Promise.resolve(null), asking(channel))).toBeNull();
    const silent: Fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ code: null }) });
    expect(await meetAtRoom(R, { ...quick, send: silent }, () => Promise.resolve('k1'), asking(channel))).toBeNull();
    const answers: Fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 'TE1.h' }) });
    expect(await meetAtRoom(R, { ...quick, send: answers }, () => Promise.resolve('k1'), asking(new Error('failed')))).toBeNull();
  });
});
