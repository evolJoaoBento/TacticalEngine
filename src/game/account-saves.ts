/**
 * The player's saves, kept on the server (`docs/SERVER.md`, phase 3: saves move to the server; the server's
 * side is `server/serve/src/saves.rs`).
 *
 * Signed in to a server that plays the game beside the page (`wire.ts`), a save is written by that game - the
 * server's game saves itself into the account's own folder, its own text (`Wire.save`), held to the page's.
 * The page asks the rest synchronously, as it always did of the browser's slots (`SaveShelf`): so the slots
 * and their texts are read from the server as the page opens, and kept here; a save goes into them at once,
 * and is taken back out if the server's game would not write it.
 *
 * The slots a browser kept before move up the first time it signs in, and the browser's copies are left
 * alone (`moveBrowserSaves`).
 */

import { SaveSlots, browserStore, mintSlotId, type SaveShelf, type SaveSlot, type SlotStore } from './save-slots';
import type { Wire } from './wire';

export const SAVES_URL = '/__saves';
const HEADER = 'x-tactical-save';
/** Set in a player's own browser storage once their browser's slots have moved up. */
const MOVED_KEY = 'tactical:saves-moved';

export type Send = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

const posting = (body: unknown): RequestInit => ({
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'content-type': 'application/json', [HEADER]: '1' },
  body: JSON.stringify(body),
});

export class AccountSaves implements SaveShelf {
  private refusal = 'The game could not be saved on the server.';

  constructor(
    private slots: SaveSlot[],
    private readonly texts: Map<string, string>,
    private readonly wire: () => Wire | null,
    private readonly send: Send = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  list(): SaveSlot[] {
    return [...this.slots].sort((a, b) => b.savedAt - a.savedAt);
  }

  has(id: string): boolean {
    return this.slots.some((slot) => slot.id === id);
  }

  read(id: string): string | null {
    return this.texts.get(id) ?? null;
  }

  /** The game saved by the server's game into a slot, listed at once; `null` when the server is not in step to. */
  write(text: string, name: string, where: string, id?: string, project?: string): SaveSlot | null {
    const slot: SaveSlot = { id: id ?? mintSlotId(this.now()), name, savedAt: this.now(), where, ...(project === undefined ? {} : { project }) };
    const saving = this.wire()?.save(slot, text) ?? null;
    if (saving === null) {
      this.refusal = 'The game could not be saved: the server is not playing it in step just now.';
      return null;
    }
    const was = { slot: this.slots.find((s) => s.id === slot.id), text: this.texts.get(slot.id) };
    this.put(slot, text);
    void saving.then((saved) => {
      const ours = this.slots.find((s) => s.id === slot.id);
      if (ours !== slot) return; // written over since
      if (saved !== null) {
        // What is on the server is the server's game's text, and its slot.
        this.put(saved.slot, saved.text);
        return;
      }
      this.slots = this.slots.filter((s) => s.id !== slot.id);
      this.texts.delete(slot.id);
      if (was.slot !== undefined && was.text !== undefined) this.put(was.slot, was.text);
    });
    return slot;
  }

  remove(id: string): boolean {
    if (!this.has(id)) return false;
    this.slots = this.slots.filter((slot) => slot.id !== id);
    this.texts.delete(id);
    void this.send(`${SAVES_URL}/remove`, posting({ id })).catch(() => undefined);
    return true;
  }

  refused(): string {
    return this.refusal;
  }

  private put(slot: SaveSlot, text: string): void {
    this.slots = [...this.slots.filter((s) => s.id !== slot.id), slot];
    this.texts.set(slot.id, text);
  }
}

/**
 * The slots this browser kept for the player, moved up to the server the first time - those the server has
 * not got - and the browser's copies left as they were. Whether they have moved (or there was nothing to move).
 */
export async function moveBrowserSaves(store: SlotStore, send: Send = fetch): Promise<boolean> {
  try {
    if (store.get(MOVED_KEY) !== null) return true;
    const browser = new SaveSlots(store);
    const saves = browser.list().flatMap((slot) => {
      const text = browser.read(slot.id);
      return text === null ? [] : [{ slot, text }];
    });
    if (saves.length > 0) {
      const taken = await send(`${SAVES_URL}/import`, posting({ saves }));
      if (!taken.ok) return false;
    }
    store.set(MOVED_KEY, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

/** The account's slots on the server, after this browser's have moved up; `null` if the server will not say. */
export async function listAccountSaves(account: string, send: Send = fetch, store: SlotStore = browserStore(account)): Promise<SaveSlot[] | null> {
  await moveBrowserSaves(store, send);
  try {
    const listed = await send(SAVES_URL, { credentials: 'same-origin' });
    if (!listed.ok) return null;
    const slots = await listed.json();
    return Array.isArray(slots) ? (slots as SaveSlot[]) : null;
  } catch {
    return null;
  }
}

/** The account's saves as the game keeps them: every slot and its text read now, so the page can ask at once. */
export async function loadAccountSaves(account: string, wire: () => Wire | null, send: Send = fetch, store: SlotStore = browserStore(account)): Promise<AccountSaves | null> {
  const slots = await listAccountSaves(account, send, store);
  if (slots === null) return null;
  const texts = new Map<string, string>();
  await Promise.all(
    slots.map(async (slot) => {
      try {
        const read = await send(`${SAVES_URL}/${encodeURIComponent(slot.id)}`, { credentials: 'same-origin' });
        if (read.ok) texts.set(slot.id, await read.text());
      } catch {
        // A save that will not come is not listed as one to load.
      }
    }),
  );
  return new AccountSaves(slots.filter((slot) => texts.has(slot.id)), texts, wire, send);
}
