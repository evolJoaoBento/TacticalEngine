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
}

export const QUICK_SLOT = 'quick';
export const AUTO_SLOT = 'auto';

const INDEX_KEY = 'polyheart:saves';
const SLOT_PREFIX = 'polyheart:save:';

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
      return this.store.get(SLOT_PREFIX + id);
    } catch {
      return null;
    }
  }

  /**
   * Write a slot. A fixed id overwrites; a new id is minted when none is given.
   * Returns the slot as listed, or null when the store refused.
   */
  write(text: string, name: string, where: string, id?: string): SaveSlot | null {
    const slotId = id ?? `s${this.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const slot: SaveSlot = { id: slotId, name, savedAt: this.now(), where };
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
      this.store.set(INDEX_KEY, JSON.stringify(index.filter((entry) => entry.id !== id)));
      return true;
    } catch {
      return false;
    }
  }

  private readIndex(): SaveSlot[] {
    try {
      const raw = this.store.get(INDEX_KEY);
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

/** A store over `localStorage`, or a dead one when the browser refuses. */
export function browserStore(): SlotStore {
  return {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => window.localStorage.setItem(key, value),
    remove: (key) => window.localStorage.removeItem(key),
  };
}

/** A store over a `Map`, for tests. */
export function memoryStore(map = new Map<string, string>()): SlotStore {
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  };
}
