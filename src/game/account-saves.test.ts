/**
 * The player's saves on the server, as the page keeps them (`account-saves.ts`): a browser's slots moved up the
 * first time and left where they were; the account's slots and texts read as the page opens; a save listed at
 * once and given to the server's game to write, the server's text kept when it has, the slot as it was when it
 * would not; and a save removed.
 */

import { describe, expect, it } from 'vitest';
import { AccountSaves, SAVES_URL, listAccountSaves, loadAccountSaves, moveBrowserSaves, type Send } from './account-saves';
import { SaveSlots, memoryStore, type SaveSlot } from './save-slots';
import type { Wire } from './wire';

/** A server's saves routes over a map, every request recorded. */
function server(saves: Map<string, { slot: SaveSlot; text: string }> = new Map(), refuse = false) {
  const asked: { url: string; body: unknown }[] = [];
  const send: Send = async (url, init) => {
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown);
    asked.push({ url, body });
    const answer = (status: number, value: unknown) => ({ ok: status === 200, status, json: async () => value, text: async () => (typeof value === 'string' ? value : JSON.stringify(value)) });
    if (refuse) return answer(500, { reason: 'down' });
    if (url === SAVES_URL) return answer(200, [...saves.values()].map((s) => s.slot));
    if (url === `${SAVES_URL}/import`) {
      let imported = 0;
      for (const save of (body as { saves: { slot: SaveSlot; text: string }[] }).saves) {
        if (saves.has(save.slot.id)) continue;
        saves.set(save.slot.id, save);
        imported++;
      }
      return answer(200, { imported });
    }
    if (url === `${SAVES_URL}/remove`) return answer(saves.delete((body as { id: string }).id) ? 200 : 404, {});
    const save = saves.get(decodeURIComponent(url.slice(SAVES_URL.length + 1)));
    return save === undefined || save.text === '' ? answer(404, {}) : answer(200, save.text);
  };
  return { send, asked, saves };
}

const slot = (id: string, savedAt: number, project?: string): SaveSlot => ({ id, name: id, savedAt, where: 'The camp', ...(project === undefined ? {} : { project }) });

/** A wire whose server's game saves when told, or will not. */
function wire(answer: 'saves' | 'refuses' | 'not in step') {
  const told: { slot: { id: string }; text: string }[] = [];
  let resolve: (value: { slot: SaveSlot; text: string } | null) => void = () => undefined;
  const fake = {
    save: (s: SaveSlot, text: string) => {
      if (answer === 'not in step') return null;
      told.push({ slot: s, text });
      return new Promise<{ slot: SaveSlot; text: string } | null>((r) => (resolve = r));
    },
  } as unknown as Wire;
  return { wire: fake, told, answer: (value: { slot: SaveSlot; text: string } | null) => resolve(value) };
}

describe('the player\'s saves on the server', () => {
  it('moves a browser\'s slots up the first time, those the server has not got, and leaves the browser\'s', async () => {
    const store = memoryStore();
    const browser = new SaveSlots(store, () => 10);
    browser.write('{"a":1}', 'Quick save', 'The camp', 'quick', 'camp');
    browser.write('{"b":2}', 'Before the vault', 'The vault', 's1');
    const { send, asked, saves } = server(new Map([['quick', { slot: slot('quick', 99), text: '{"server":1}' }]]));
    expect(await moveBrowserSaves(store, send)).toBe(true);
    expect(asked.map((a) => a.url)).toEqual([`${SAVES_URL}/import`]);
    expect((asked[0]!.body as { saves: { slot: SaveSlot; text: string }[] }).saves).toEqual([
      { slot: { id: 'quick', name: 'Quick save', savedAt: 10, where: 'The camp', project: 'camp' }, text: '{"a":1}' },
      { slot: { id: 's1', name: 'Before the vault', savedAt: 10, where: 'The vault' }, text: '{"b":2}' },
    ]);
    expect(saves.get('quick')!.text).toBe('{"server":1}');
    expect(saves.get('s1')!.text).toBe('{"b":2}');
    // Left in the browser, and not moved again.
    expect(browser.list().length).toBe(2);
    expect(await moveBrowserSaves(store, send)).toBe(true);
    expect(asked.length).toBe(1);
    // A server that would not take them: tried again the next time.
    const fresh = memoryStore();
    new SaveSlots(fresh).write('{}', 'x', 'y', 'quick');
    const down = server(new Map(), true);
    expect(await moveBrowserSaves(fresh, down.send)).toBe(false);
    expect(await moveBrowserSaves(fresh, server().send)).toBe(true);
  });

  it('reads the account\'s slots and their texts as the page opens', async () => {
    // `gone` is listed, but its text will not come: not a save the page can load, so not listed to load.
    const { send } = server(new Map([['quick', { slot: slot('quick', 5), text: '{"q":1}' }], ['s2', { slot: slot('s2', 9, 'camp'), text: '{"n":2}' }], ['gone', { slot: slot('gone', 7), text: '' }]]));
    expect(await listAccountSaves('kara', send, memoryStore())).toEqual([slot('quick', 5), slot('s2', 9, 'camp'), slot('gone', 7)]);
    const saves = (await loadAccountSaves('kara', () => null, send, memoryStore()))!;
    expect(saves.list().map((s) => s.id)).toEqual(['s2', 'quick']);
    expect(saves.has('gone')).toBe(false);
    expect(saves.read('quick')).toBe('{"q":1}');
    expect(saves.has('s2')).toBe(true);
    expect(saves.read('nope')).toBeNull();
    expect(await loadAccountSaves('kara', () => null, server(new Map(), true).send, memoryStore())).toBeNull();
  });

  it('lists a save at once, keeps the server\'s text when its game has written it, and puts the slot back when it would not', async () => {
    const { send } = server();
    const saving = wire('saves');
    const saves = new AccountSaves([slot('quick', 1)], new Map([['quick', '{"old":1}']]), () => saving.wire, send, () => 50);
    const written = saves.write('{"page":1}', 'Quick save', 'The vault', 'quick', 'camp')!;
    expect(written).toEqual({ id: 'quick', name: 'Quick save', savedAt: 50, where: 'The vault', project: 'camp' });
    expect(saving.told).toEqual([{ slot: written, text: '{"page":1}' }]);
    expect(saves.read('quick')).toBe('{"page":1}');
    saving.answer({ slot: { ...written, savedAt: 51 }, text: '{"server":1}' });
    await Promise.resolve();
    await Promise.resolve();
    expect(saves.read('quick')).toBe('{"server":1}');
    expect(saves.list()[0]!.savedAt).toBe(51);
    // A fresh slot, minted here, that the server's game would not write: gone again.
    const named = saves.write('{"page":2}', 'Named', 'The vault')!;
    expect(named.id).toMatch(/^s/);
    expect(saves.has(named.id)).toBe(true);
    saving.answer(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(saves.has(named.id)).toBe(false);
    // The quick save written over, refused: the one before it back.
    saves.write('{"page":3}', 'Quick save', 'The camp', 'quick');
    saving.answer(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(saves.read('quick')).toBe('{"server":1}');
  });

  it('says so when the server is not in step to save, and removes a slot there too', async () => {
    const { send, asked } = server(new Map([['s1', { slot: slot('s1', 1), text: '{}' }]]));
    const saves = new AccountSaves([slot('s1', 1)], new Map([['s1', '{}']]), () => wire('not in step').wire, send);
    expect(saves.write('{}', 'Quick save', 'x', 'quick')).toBeNull();
    expect(saves.refused()).toMatch(/not playing it in step/);
    expect(saves.has('quick')).toBe(false);
    const nobody = new AccountSaves([], new Map(), () => null, send);
    expect(nobody.write('{}', 'Quick save', 'x', 'quick')).toBeNull();
    expect(saves.remove('s1')).toBe(true);
    expect(saves.has('s1')).toBe(false);
    expect(saves.remove('s1')).toBe(false);
    await Promise.resolve();
    expect(asked).toEqual([{ url: `${SAVES_URL}/remove`, body: { id: 's1' } }]);
  });
});
