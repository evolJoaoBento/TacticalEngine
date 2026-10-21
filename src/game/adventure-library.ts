/**
 * The adventures a player has imported, kept in the browser beside their games (`game-projects.ts`): a project file
 * brought in from the main menu's Adventures (`ui/Adventures.tsx`), or got from the Store (`store.ts`), offered by every camp's portal
 * (`adventure-portal.ts`) beside the ones this build writes, and begun there as a game of its own.
 *
 * One key per adventure and an index to list them by, the index holding what the portal's window and the menu show -
 * the name, and a line from its first room - so listing them reads no project. What its listed packs lay is left out,
 * as a game's is (`listed-packs.ts`).
 */

import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import { withoutPackEntries } from './listed-packs';
import type { SlotStore } from './save-slots';

const INDEX_KEY = 'tactical:adventures';
const PREFIX = 'tactical:adventure:';
/** The longest a blurb runs before it is cut. */
const BLURB_MOST = 220;

/** An adventure in the list: which, what it is called, a line on it, when it was brought in, and the Store listing it came from. */
export interface InstalledAdventure {
  id: string;
  name: string;
  blurb: string;
  installedAt: number;
  listing?: string;
}

/** What is said of an adventure: its first room's opening words, or how many rooms there are. */
export function blurbOf(project: ProjectDoc): string {
  const intro = project.scenes.find((scene) => scene.id === project.startScene)?.intro.trim() ?? '';
  if (intro === '') return project.scenes.length === 1 ? 'One room.' : `${project.scenes.length} rooms.`;
  return intro.length <= BLURB_MOST ? intro : `${intro.slice(0, BLURB_MOST - 1).trimEnd()}…`;
}

export class AdventureLibrary {
  constructor(
    private readonly store: SlotStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Newest first. */
  list(): InstalledAdventure[] {
    return this.readIndex().sort((a, b) => b.installedAt - a.installedAt);
  }

  /** An adventure's project, or null when it is not kept or no longer reads. */
  read(id: string): ProjectDoc | null {
    try {
      const text = this.store.get(PREFIX + id);
      if (text === null) return null;
      const parsed = projectSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Whether one got from this Store listing is kept. */
  hasListing(listing: string): boolean {
    return this.readIndex().some((adventure) => adventure.listing === listing);
  }

  /** Keep an adventure - another with its id replaced - and the listing it was got from, if any: false when the browser refused. */
  install(project: ProjectDoc, listing?: string): boolean {
    try {
      this.store.set(PREFIX + project.id, JSON.stringify(withoutPackEntries(project)));
      const kept = this.readIndex().filter((adventure) => adventure.id !== project.id);
      kept.push({ id: project.id, name: project.name.trim() === '' ? project.id : project.name, blurb: blurbOf(project), installedAt: this.now(), ...(listing === undefined ? {} : { listing }) });
      this.store.set(INDEX_KEY, JSON.stringify(kept));
      return true;
    } catch {
      // Half kept is not kept: the project's own key goes again, so nothing is left the index does not list.
      try {
        this.store.remove(PREFIX + project.id);
      } catch {
        // Nothing more to be done.
      }
      return false;
    }
  }

  remove(id: string): boolean {
    try {
      this.store.remove(PREFIX + id);
      this.store.set(INDEX_KEY, JSON.stringify(this.readIndex().filter((adventure) => adventure.id !== id)));
      return true;
    } catch {
      return false;
    }
  }

  private readIndex(): InstalledAdventure[] {
    try {
      const raw = this.store.get(INDEX_KEY);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((a): a is InstalledAdventure => typeof a?.id === 'string' && typeof a?.name === 'string' && typeof a?.blurb === 'string' && typeof a?.installedAt === 'number' && (a.listing === undefined || typeof a.listing === 'string'))
        : [];
    } catch {
      return [];
    }
  }
}

/**
 * A project file's text as an adventure: migrated and checked as a project opened by hand is - or why it is not one,
 * in words for the player. `taken` are the ids this build's own adventures have, which an import may not take.
 */
export function adventureFromText(text: string, taken: ReadonlySet<string>): ProjectDoc | string {
  try {
    const parsed = projectSchema.safeParse(migrateDocument(JSON.parse(text)));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue === undefined || issue.path.length === 0 ? '' : ` at ${issue.path.join('.')}`;
      return `That file is not a project the engine can play (${issue?.message ?? 'invalid'}${where}).`;
    }
    if (taken.has(parsed.data.id)) return `That is ${parsed.data.name.trim() === '' ? parsed.data.id : parsed.data.name}, which this build has already.`;
    return parsed.data;
  } catch {
    return 'That file is not a project the engine can play: it is not a project file at all.';
  }
}

/** A project file brought in - from a Store listing, if `listing` says which: its name, kept - or why not, in words for the player. */
export function importAdventure(library: AdventureLibrary, text: string, taken: ReadonlySet<string>, listing?: string): { imported: string } | { refused: string } {
  const project = adventureFromText(text, taken);
  if (typeof project === 'string') return { refused: project };
  if (!library.install(project, listing)) return { refused: 'This browser has no room left to keep it.' };
  return { imported: project.name.trim() === '' ? project.id : project.name };
}
