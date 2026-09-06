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
 * Two moments refuse to save, both because the thing being asked for holds live
 * objects with no serialisable form: a fight (`EncounterRunner` owns action
 * tokens, whose turn it is, and a reference to the scene it started in) and a
 * script waiting on an answer (a paused `ScriptRunner`, mid-conversation). A
 * save is a checkpoint between beats.
 */

import { z } from 'zod';

import { enterSavedScene, inCombat, type DemoScene } from './demo-scene';
import { logToneSchema } from '../engine/script/schema';
import {
  restoreScenario,
  scenarioSnapshot,
  scenarioSnapshotSchema,
} from '../engine/script/world';
import { sceneSnapshotSchema } from '../engine/scene/state';

export const saveSchema = z.object({
  /** Bumped when the shape changes, so an old save fails at the door. */
  formatVersion: z.literal(1),
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
  log: z.array(z.object({ text: z.string(), tone: logToneSchema })),
});

export type SaveGame = z.infer<typeof saveSchema>;

/** Why a save was refused, or `null` when it can go ahead. */
export function saveBlockedBy(demo: DemoScene): string | null {
  if (inCombat(demo)) return 'Not in the middle of a fight.';
  if (demo.pending !== null) return 'Not in the middle of a conversation.';
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
    formatVersion: 1,
    projectId: demo.project.id,
    sceneId: demo.scene.id,
    rng: demo.rng.save(),
    scenario: scenarioSnapshot(demo.scenario),
    scenes,
    selected: demo.party.selected,
    log: demo.log.map((line) => ({ ...line })),
  };
}

/** A save as text, ready for a file or `localStorage`. `null` when refused. */
export function serialiseSave(demo: DemoScene): string | null {
  const save = saveGame(demo);
  return save === null ? null : JSON.stringify(save);
}

export type LoadResult = { ok: true } | { ok: false; reason: string };

/**
 * Put a saved campaign back into a live `DemoScene`.
 *
 * The scenario is refilled in place rather than replaced: every
 * `SceneScriptWorld` built so far points at that object, and handing back a new
 * one would leave the room writing flags nobody reads.
 */
export function loadGame(demo: DemoScene, save: SaveGame): LoadResult {
  if (save.projectId !== demo.project.id) {
    return { ok: false, reason: `this save belongs to project "${save.projectId}"` };
  }
  const current = save.scenes[save.sceneId];
  if (current === undefined) {
    return { ok: false, reason: `the save has no state for scene "${save.sceneId}"` };
  }

  restoreScenario(demo.scenario, save.scenario);
  if (!enterSavedScene(demo, save.sceneId, current)) {
    return { ok: false, reason: `this project has no scene "${save.sceneId}"` };
  }

  demo.snapshots.clear();
  for (const [id, snapshot] of Object.entries(save.scenes)) {
    if (id !== save.sceneId) demo.snapshots.set(id, snapshot);
  }
  demo.rng.restore(save.rng);
  demo.log.length = 0;
  for (const line of save.log) demo.log.push({ ...line });
  if (save.selected !== null && demo.party.members().includes(save.selected)) {
    demo.party.select(save.selected);
  }
  return { ok: true };
}

/** Parse and load in one step, reporting a malformed save rather than throwing. */
export function loadGameText(demo: DemoScene, text: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'this is not a save file' };
  }
  const result = saveSchema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: 'this save is damaged or from an older build' };
  return loadGame(demo, result.data);
}
