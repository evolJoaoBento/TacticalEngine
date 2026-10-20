/**
 * Editing the project's sheets: the party, and the companions waiting to be asked into it (`joinParty`). The Party
 * panel writes both (`ui/PartyPanel.tsx`), in one form (`ui/SheetEditor.tsx`).
 */

import type { ProjectDoc } from '../engine/scene/schema';
import type { Edit } from './session';

/**
 * A sheet as the project holds it. The interface in `character/sheet.ts` has
 * readonly arrays; what a document carries, and what an edit writes back, is
 * the parsed shape.
 */
export type PartySheet = ProjectDoc['party'][number];

/**
 * Which list of sheets an edit writes: the party, or the companions waiting to be asked into it (`joinParty`). One
 * id may be in both - a companion who has joined - so every edit names its list.
 */
export type SheetList = 'party' | 'companions';

/** Add a character. Their id is what a spawn, a granted card and a save name. */
export function addSheet(sheet: PartySheet, list: SheetList = 'party'): Edit {
  return {
    label: `Add ${sheet.name || sheet.id}`,
    apply(project) {
      project[list].push(sheet);
    },
    undo(project) {
      // By id: an edit since puts a new object in its place.
      const at = project[list].map((s) => s.id).lastIndexOf(sheet.id);
      if (at >= 0) project[list].splice(at, 1);
    },
  };
}

/**
 * Remove a character.
 *
 * The document changes now; the board catches up when Play is pressed
 * (`syncRoster`), and not in the middle of a fight: pulling somebody out from
 * under a spotlight that may be on them is not an edit, it is a crash.
 */
export function removeSheet(characterId: string, list: SheetList = 'party'): Edit {
  let removed: { index: number; sheet: PartySheet } | null = null;
  return {
    label: list === 'party' ? 'Remove from the party' : 'Remove a companion',
    apply(project) {
      removed = null;
      const index = project[list].findIndex((s) => s.id === characterId);
      if (index < 0) return;
      removed = { index, sheet: project[list][index]! };
      project[list].splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project[list].splice(removed.index, 0, removed.sheet);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/**
 * Edit a sheet. Typing into one field coalesces into one undo step.
 *
 * Undo puts back only the fields this edit wrote. The party is the one list
 * the *game* also writes — a level taken at the table, a card recalled — and
 * restoring the whole sheet would quietly undo that too, hours later, from a
 * panel that never knew about it.
 */
export function updateSheet(characterId: string, changes: Partial<PartySheet>, list: SheetList = 'party'): Edit {
  let before: Partial<PartySheet> = {};
  const current: Partial<PartySheet> = { ...changes };
  const edit: Edit = {
    label: 'Edit a character',
    mergeKey: `sheet:${list}:${characterId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project[list].findIndex((s) => s.id === characterId);
      if (index < 0) return;
      const sheet = project[list][index]!;
      before = Object.fromEntries(Object.keys(current).map((key) => [key, sheet[key as keyof PartySheet]]));
      project[list][index] = { ...sheet, ...current };
    },
    undo(project) {
      const index = project[list].findIndex((s) => s.id === characterId);
      if (index >= 0) project[list][index] = { ...project[list][index]!, ...before };
    },
    absorb(other) {
      const next = (other as Edit & { __sheet?: Partial<PartySheet> }).__sheet;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __sheet: Partial<PartySheet> }).__sheet = current;
  return edit;
}
