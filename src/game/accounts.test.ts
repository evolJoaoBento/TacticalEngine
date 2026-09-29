/**
 * Who is signed in, as the page knows it (`accounts.ts`), and each player's games and saves kept apart
 * (`browserStore` in `save-slots.ts`): admin and nobody keep the keys as they always were, so what was
 * saved before there were accounts is admin's.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentUser, rememberUser, signIn, signOut, userKey, whoAmI } from './accounts';
import { SaveSlots, browserStore } from './save-slots';

/** A `localStorage` over a map, as the browser's would be. */
function storage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

beforeEach(() => {
  const local = storage();
  Object.assign(globalThis, { localStorage: local, window: { localStorage: local } });
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

const answer = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('who is signed in', () => {
  it('is an account, nobody, or - a server that keeps none - anybody', async () => {
    expect(await whoAmI(answer(200, { id: 'ash', name: 'Ash', admin: false }))).toEqual({ id: 'ash', name: 'Ash', admin: false });
    expect(await whoAmI(answer(401, { reason: 'nobody' }))).toBeNull();
    expect(await whoAmI(answer(404, {}))).toBe('none');
    expect(await whoAmI(async () => { throw new Error('offline'); })).toBe('none');
  });

  it('is remembered in this browser on signing in, and forgotten on signing out', async () => {
    expect(currentUser()).toBeNull();
    const signed = await signIn('Ash', 'hunter2', false, answer(200, { id: 'ash', name: 'Ash', admin: false }));
    expect(signed).toEqual({ id: 'ash', name: 'Ash', admin: false });
    expect(currentUser()).toBe('ash');
    await signOut(answer(200, {}));
    expect(currentUser()).toBeNull();
  });

  it('is not changed by a refusal, which says why', async () => {
    expect(await signIn('Ash', 'wrong', false, answer(401, { reason: 'that name and password do not match' }))).toEqual({ refused: 'that name and password do not match' });
    expect(currentUser()).toBeNull();
  });
});

describe('each player’s games and saves', () => {
  it('are kept under their own keys; admin and nobody keep the keys as they always were', () => {
    expect(userKey('tactical:games', 'ash')).toBe('tactical:u:ash:games');
    expect(userKey('tactical:games', 'admin')).toBe('tactical:games');
    expect(userKey('tactical:games', null)).toBe('tactical:games');
  });

  it('are not another player’s', () => {
    rememberUser('ash');
    new SaveSlots(browserStore()).write('{}', 'Ash’s', 'the camp');
    rememberUser('bramble');
    expect(new SaveSlots(browserStore()).list()).toEqual([]);
    new SaveSlots(browserStore()).write('{}', 'Bramble’s', 'the vault');
    expect(new SaveSlots(browserStore()).list().map((slot) => slot.name)).toEqual(['Bramble’s']);
    rememberUser('ash');
    expect(new SaveSlots(browserStore()).list().map((slot) => slot.name)).toEqual(['Ash’s']);
    // What was saved before there were accounts is admin's.
    rememberUser(null);
    new SaveSlots(browserStore()).write('{}', 'Before', 'the vault');
    rememberUser('admin');
    expect(new SaveSlots(browserStore()).list().map((slot) => slot.name)).toEqual(['Before']);
  });
});
