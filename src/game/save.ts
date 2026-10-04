/**
 * Saving and loading a campaign in progress.
 *
 * A save is *state over a project*, not a copy of one: it names the project it
 * belongs to and carries only what play changed — where the party stands, what
 * it is carrying, which flags are set, how each room was left, and where the
 * dice had got to. Edit the map after saving and the save follows the new map,
 * which is what you want while a campaign is still being written and worth
 * knowing before someone reports it as a bug.
 *
 * Fights and paused scripts refuse to save because the thing being asked for holds live
 * objects with no serialisable form: a fight (`EncounterRunner` owns action
 * tokens, whose turn it is, and a reference to the scene it started in) and a
 * script waiting on an answer (a paused `ScriptRunner`, mid-conversation). A
 * save is a checkpoint between beats. An approaching ambush also refuses: its
 * delayed encounter is not part of the save and would otherwise be lost.
 */

import { z } from 'zod';

import { type DemoScene } from './demo-scene';
import { inCombat } from './moment';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { logToneSchema } from '../engine/script/schema';
import { scenarioSnapshot, scenarioSnapshotSchema } from '../engine/script/world';
import { sceneSnapshotSchema } from '../engine/scene/state';
import { CURRENT_FORMAT_VERSION } from '../engine/scene/migrate';
import { talkingAside } from './talks';

export const saveSchema = z.object({
  /**
   * Bumped when a persisted name changes. Both known versions are accepted: a save is migrated
   * at the door before this schema sees it, and one from a newer build is refused there rather
   * than guessed at.
   */
  formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  /** The project this save is state for. Loading it into another is refused. */
  projectId: z.string(),
  /** The room being played when the game was put down. */
  sceneId: z.string(),
  /**
   * Where the dice had got to. Without this a reload re-rolls the same numbers
   * the session already spent, and a replay diverges from the save it came from.
   */
  rng: z.number(),
  scenario: scenarioSnapshotSchema,
  /** Every visited room, the current one included. */
  scenes: z.record(z.string(), sceneSnapshotSchema),
  /** Whose turn it is to be clicked on. */
  selected: z.string().nullable(),
  /**
   * The party's sheets, levels taken included. Defaulted so an older save
   * loads with the project's level-1 sheets. Shape-checked here; the content
   * ids inside are checked by `deriveCharacter` on load, and a sheet that
   * names gear the project does not have refuses the load rather than
   * fighting unarmed by surprise.
   */
  sheets: z.array(characterSheetSchema).default([]),
  /**
   * The narrative log, most recent last and no longer than SAVED_LOG_LINES.
   *
   * A campaign writes a line for every swing, every roll and every door, and a
   * save that carried all of them would grow without limit for the sake of
   * scrollback nobody reads twice. The tail is what a player picking the game
   * up wants: where they were and what just happened.
   */
  log: z.array(z.object({ text: z.string(), tone: logToneSchema })),
});

/**
 * How much scrollback a save carries.
 *
 * The live log is not trimmed to match: four callers read it by index - the
 * lines a use added are `log.slice(before)` - and trimming under them would
 * hand somebody else's lines back. Bounding the save is what was actually
 * costing anything, a save being the thing that is written to disk and
 * rewritten every time the party changes rooms.
 */
export const SAVED_LOG_LINES = 200;

export type SaveGame = z.infer<typeof saveSchema>;

/** Why a save was refused, or `null` when it can go ahead. */
export function saveBlockedBy(demo: DemoScene): string | null {
  if (inCombat(demo)) return 'Not in the middle of a fight.';
  if (demo.ambush !== null) return 'Not while the party is approaching an ambush.';
  if (demo.pending !== null || talkingAside(demo).length > 0) return 'Not in the middle of a conversation.';
  return null;
}

/** A save of the campaign as it stands, or `null` when this moment refuses. */
export function saveGame(demo: DemoScene): SaveGame | null {
  if (saveBlockedBy(demo) !== null) return null;

  const scenes: Record<string, z.infer<typeof sceneSnapshotSchema>> = {};
  for (const [id, snapshot] of demo.snapshots) scenes[id] = snapshot;
  // `snapshots` holds the rooms already left; the one being played is only in
  // the live state, and leaving it out would reload into a pristine room.
  scenes[demo.scene.id] = demo.state.snapshot();

  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    projectId: demo.project.id,
    sceneId: demo.scene.id,
    rng: demo.rng.save(),
    scenario: scenarioSnapshot(demo.scenario),
    scenes,
    selected: demo.party.selected,
    // Parsed rather than spread: a deep copy in the save's own shape.
    sheets: [...demo.sheets.values()].map((sheet) => characterSheetSchema.parse(sheet)),
    log: demo.log.slice(-SAVED_LOG_LINES).map((line) => ({ ...line })),
  };
}

/** A save as text, ready for a file or `localStorage`. `null` when refused. */
export function serialiseSave(demo: DemoScene): string | null {
  const save = saveGame(demo);
  return save === null ? null : JSON.stringify(save);
}

export type LoadResult = { ok: true } | { ok: false; reason: string };
