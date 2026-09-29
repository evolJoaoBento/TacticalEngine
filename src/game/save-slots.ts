/**
 * Named save slots over a key-value store.
 *
 * `save.ts` knows how to turn a campaign into text and back; this knows where
 * the texts go. A store is injected — `localStorage` in the browser, a `Map`
 * in a test — and every touch is guarded, because `localStorage` throws
 * outright in some contexts and a failure has to read as "no saves" rather
 * than take the page down.
 *
 * An index under one key lists the slots; each slot's text lives under its own
 * key, so listing saves does not parse every save. The quick slot and the
 * autosave slot have fixed ids and are overwritten; a named save gets a fresh
 * id every time.
 */

import { currentUser, userKey } from './accounts';

export interface SlotStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface SaveSlot {
  id: string;
  name: string;
  /** Milliseconds since the epoch. */
  savedAt: number;
  /** A line for the list: where the party was. */
  where: string;
  /**
   * The project the save is of, so the main menu's Load Game can open the right one. Left out by
   * saves written before it was recorded, which were all of the demo (`DEFAULT_SAVE_PROJECT`).
   */
  project?: string;
}

/** The project a save that does not say is of: the only one there was when saves did not say. */
export const DEFAULT_SAVE_PROJECT = 'demo';

/**
 * A fixed slot - the quick save, the autosave - for one project: its own, so a camp's quick save
 * never writes over the demo's. The demo keeps the bare name, which its saves always had.
 */
export const projectSlot = (slot: string, project: string): string => (project === DEFAULT_SAVE_PROJECT ? slot : `${slot}-${project}`);

/** The project a slot is a save of. */
export const projectOfSlot = (slot: SaveSlot): string => slot.project ?? DEFAULT_SAVE_PROJECT;

export const QUICK_SLOT = 'quick';
export const AUTO_SLOT = 'auto';

const INDEX_KEY = 'tactical:saves';
const SLOT_PREFIX = 'tactical:save:';

/**
 * The keys this app wrote before it was renamed.
 *
 * **Read, never written.** A campaign somebody saved under the old name keeps opening, and their
 * next save moves it forward on its own — so there is no migration step to run, nothing to get
 * half-done, and no version flag to keep.
 *
 * `remove` clears both. Clearing only the new key would let a deleted save come back from under the
 * old one on the very next read, which looks like the delete button not working.
 */
const LEGACY_INDEX_KEY = 'polyheart:saves';
const LEGACY_SLOT_PREFIX = 'polyheart:save:';

export class SaveSlots {
  private readonly store: SlotStore;
  private readonly now: () => number;

  constructor(store: SlotStore, now: () => number = () => Date.now()) {
    this.store = store;
    this.now = now;
  }

  /** Every slot, newest first. Empty when the store is unreadable. */
  list(): SaveSlot[] {
    return this.readIndex().sort((a, b) => b.savedAt - a.savedAt);
  }

  has(id: string): boolean {
    return this.readIndex().some((slot) => slot.id === id);
  }

  /** The saved text for a slot, or null. */
  read(id: string): string | null {
    try {
      return this.store.get(SLOT_PREFIX + id) ?? this.store.get(LEGACY_SLOT_PREFIX + id);
    } catch {
      return null;
    }
  }

  /**
   * Write a slot. A fixed id overwrites; a new id is minted when none is given.
   * Returns the slot as listed, or null when the store refused.
   */
  write(text: string, name: string, where: string, id?: string, project?: string): SaveSlot | null {
    const slotId = id ?? `s${this.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const slot: SaveSlot = { id: slotId, name, savedAt: this.now(), where, ...(project === undefined ? {} : { project }) };
    try {
      this.store.set(SLOT_PREFIX + slotId, text);
      const index = this.readIndex().filter((entry) => entry.id !== slotId);
      index.push(slot);
      this.store.set(INDEX_KEY, JSON.stringify(index));
      return slot;
    } catch {
      return null;
    }
  }

  remove(id: string): boolean {
    try {
      const index = this.readIndex();
      if (!index.some((entry) => entry.id === id)) return false;
      this.store.remove(SLOT_PREFIX + id);
      // Both, or a save written under the old name returns on the next read.
      this.store.remove(LEGACY_SLOT_PREFIX + id);
      this.store.set(INDEX_KEY, JSON.stringify(index.filter((entry) => entry.id !== id)));
      return true;
    } catch {
      return false;
    }
  }

  private readIndex(): SaveSlot[] {
    try {
      const raw = this.store.get(INDEX_KEY) ?? this.store.get(LEGACY_INDEX_KEY);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is SaveSlot =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as SaveSlot).id === 'string' &&
          typeof (entry as SaveSlot).name === 'string' &&
          typeof (entry as SaveSlot).savedAt === 'number',
      );
    } catch {
      return [];
    }
  }
}

/**
 * A store over `localStorage`, each player's keys apart from every other's (`userKey`, `accounts.ts`):
 * the games and saves a store holds are the signed-in player's own. Admin, and nobody signed in, keep
 * the keys as they always were.
 */
export function browserStore(user: string | null = currentUser()): SlotStore {
  return {
    get: (key) => window.localStorage.getItem(userKey(key, user)),
    set: (key, value) => window.localStorage.setItem(userKey(key, user), value),
    remove: (key) => window.localStorage.removeItem(userKey(key, user)),
  };
}

/** A store over `localStorage` shared by every player: what belongs to the browser, not to one of them (imported card art). */
export function sharedBrowserStore(): SlotStore {
  return browserStore(null);
}

/** A store over a `Map`, for tests. */
export function memoryStore(map = new Map<string, string>()): SlotStore {
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  };
}
