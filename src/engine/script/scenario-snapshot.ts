/**
 * The scenario as a save and a board carry it (`ScenarioState`, `world.ts`): flattened to JSON, read back, and put
 * back in place. Taken out of `world.ts`, which is longer than a reader can follow; it re-exports them.
 */

import { z } from 'zod';
import { questStatusSchema } from '../content/quests';
import { runningCountdownSchema } from './countdowns';
import { scriptValueSchema } from './schema';
import type { ScenarioState } from './world';
import { runningZoneSchema } from './zones';

/**
 * A JSON-safe `ScenarioState` — the `Set` and the `Map` flattened.
 *
 * Items are pairs rather than an object so an item id is never quietly coerced
 * into a property name, and so the order the party picked things up in survives
 * a round trip.
 */
export const scenarioSnapshotSchema = z.object({
  variables: z.record(z.string(), scriptValueSchema),
  flags: z.array(z.string()),
  items: z.array(z.tuple([z.string(), z.number().int().min(0)])),
  actorId: z.string().nullable(),
  /**
   * Defaulted, so a save written before quests existed still loads. A save
   * format is a promise to every file already on disk.
   */
  quests: z
    .array(
      z.object({
        quest: z.string(),
        status: questStatusSchema,
        done: z.array(z.string()),
        revealed: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  partyLevel: z.number().int().min(1).max(10).default(1),
  abilityUses: z.array(z.tuple([z.string(), z.number().int().min(0)])).default([]),
  abilityTokens: z.array(z.tuple([z.string(), z.number().int().min(0)])).default([]),
  /** Defaulted like the rest: a save written before countdowns existed loads. */
  countdowns: z.array(runningCountdownSchema).default([]),
  zones: z.array(runningZoneSchema).default([]),
  /** The project plans learned and the work done on each: written only once one is learned. */
  projects: z.array(z.tuple([z.string(), z.number().int().min(0)])).optional(),
});

export type ScenarioSnapshot = z.infer<typeof scenarioSnapshotSchema>;

export function scenarioSnapshot(scenario: ScenarioState): ScenarioSnapshot {
  return {
    variables: { ...scenario.variables },
    flags: [...scenario.flags],
    items: [...scenario.items].map(([id, quantity]) => [id, quantity] as [string, number]),
    actorId: scenario.actorId,
    quests: [...scenario.quests].map(([quest, progress]) => ({
      quest,
      status: progress.status,
      done: [...progress.done],
      revealed: [...progress.revealed],
    })),
    partyLevel: scenario.partyLevel,
    abilityUses: [...scenario.abilityUses].map(([key, used]) => [key, used] as [string, number]),
    abilityTokens: [...scenario.abilityTokens].map(([key, held]) => [key, held] as [string, number]),
    countdowns: [...scenario.countdowns.values()].map((countdown) => ({
      ...countdown,
      effects: [...countdown.effects],
    })),
    zones: [...scenario.zones.values()].map((zone) => ({ ...zone })),
    // Only once a plan is learned, so a scenario without one reads exactly as it always did.
    ...(scenario.projects.size > 0 ? { projects: [...scenario.projects].map(([plan, done]) => [plan, done] as [string, number]) } : {}),
  };
}

/**
 * Refill a scenario from a snapshot, **in place**.
 *
 * In place, not replaced: every `SceneScriptWorld` built so far holds a reference
 * to this object, so handing back a new one would leave the live scene writing
 * flags nobody reads.
 */
export function restoreScenario(scenario: ScenarioState, snapshot: ScenarioSnapshot): void {
  for (const name of Object.keys(scenario.variables)) delete scenario.variables[name];
  Object.assign(scenario.variables, snapshot.variables);
  scenario.flags.clear();
  for (const flag of snapshot.flags) scenario.flags.add(flag);
  scenario.items.clear();
  for (const [id, quantity] of snapshot.items) scenario.items.set(id, quantity);
  scenario.actorId = snapshot.actorId;
  scenario.quests.clear();
  for (const entry of snapshot.quests) {
    scenario.quests.set(entry.quest, {
      status: entry.status,
      done: new Set(entry.done),
      revealed: new Set(entry.revealed),
    });
  }
  scenario.partyLevel = snapshot.partyLevel;
  scenario.abilityUses.clear();
  for (const [key, used] of snapshot.abilityUses) scenario.abilityUses.set(key, used);
  scenario.abilityTokens.clear();
  for (const [key, held] of snapshot.abilityTokens ?? []) scenario.abilityTokens.set(key, held);
  scenario.countdowns.clear();
  for (const countdown of snapshot.countdowns ?? []) scenario.countdowns.set(countdown.id, countdown);
  scenario.zones.clear();
  for (const zone of snapshot.zones ?? []) scenario.zones.set(zone.id, zone);
  scenario.projects.clear();
  for (const [plan, done] of snapshot.projects ?? []) scenario.projects.set(plan, done);
}
