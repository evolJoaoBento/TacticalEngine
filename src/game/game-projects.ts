/**
 * The games New Game starts, kept in the browser.
 *
 * A new game is a project of its own - a camp with the character just made in it - and nothing
 * writes project files but the editor's Save, so it is kept where the saves are: `localStorage`,
 * one key per project and an index to list them by. The main menu's Load Game lists them beside the
 * saves made of them, and `?project=<id>` opens one (`project-store.ts`). What its listed packs lay
 * is left out, as it is from a file (`listed-packs.ts`).
 */

import type { ProjectDoc } from '../engine/scene/schema';
import { withoutPackEntries } from './listed-packs';
import type { SlotStore } from './save-slots';

const INDEX_KEY = 'tactical:games';
const PREFIX = 'tactical:game:';

/** A game in the list: which project, what it is called, and when it was begun. */
export interface StoredGame {
  id: string;
  name: string;
  startedAt: number;
}

export class GameProjects {
  constructor(
    private readonly store: SlotStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Newest first. */
  list(): StoredGame[] {
    return this.readIndex().sort((a, b) => b.startedAt - a.startedAt);
  }

  /** A game's project, as text, or null. */
  read(id: string): string | null {
    try {
      return this.store.get(PREFIX + id);
    } catch {
      return null;
    }
  }

  /** Keep a project; false when the browser refused. The first write of an id is when it began. */
  write(project: ProjectDoc): boolean {
    try {
      this.store.set(PREFIX + project.id, JSON.stringify(withoutPackEntries(project)));
      const index = this.readIndex();
      const was = index.find((game) => game.id === project.id);
      const kept = index.filter((game) => game.id !== project.id);
      kept.push({ id: project.id, name: project.name, startedAt: was?.startedAt ?? this.now() });
      this.store.set(INDEX_KEY, JSON.stringify(kept));
      return true;
    } catch {
      return false;
    }
  }

  remove(id: string): boolean {
    try {
      this.store.remove(PREFIX + id);
      this.store.set(INDEX_KEY, JSON.stringify(this.readIndex().filter((game) => game.id !== id)));
      return true;
    } catch {
      return false;
    }
  }

  private readIndex(): StoredGame[] {
    try {
      const raw = this.store.get(INDEX_KEY);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((game): game is StoredGame => typeof game?.id === 'string' && typeof game?.name === 'string' && typeof game?.startedAt === 'number')
        : [];
    } catch {
      return [];
    }
  }
}
