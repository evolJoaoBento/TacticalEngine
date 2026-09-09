/**
 * Quests: what the party has been asked to do, and how far they have got.
 *
 * A quest is a name, a summary, and a flat list of objectives. Deliberately
 * flat — no objective depends on another, none is hidden until an earlier one
 * is done, and there are no stages with their own summary text. Those are real
 * things a BG3-style journal does and they are not here yet; what is here is the
 * spine every one of them hangs off: a quest the scripts can start, tick and
 * finish, and a journal the player can read.
 *
 * Progress is not content. It lives in `ScenarioState.quests`, alongside the
 * flags and the pack, and travels with the party between rooms and into a save.
 */

import { z } from 'zod';

import { contentIdSchema } from '../scene/primitives';

export const questObjectiveSchema = z.object({
  id: contentIdSchema,
  /** What the journal shows for this step. */
  text: z.string().min(1),
  /**
   * Kept out of the journal until revealed — by a `revealObjective` effect, or
   * by being completed. This is how a quest unfolds rather than listing its
   * whole plot on the first page.
   */
  hidden: z.boolean().default(false),
  /**
   * What the journal says about the quest once this step is done - the story
   * having turned. The journal shows the summary of the latest done step that
   * has one, and the quest's own summary until any does. Empty is "nothing
   * changes here", which most steps are.
   */
  summary: z.string().default(''),
});

export const questSchema = z
  .object({
    id: contentIdSchema,
    name: z.string().min(1),
    summary: z.string().default(''),
    objectives: z.array(questObjectiveSchema).min(1),
  })
  .superRefine((quest, ctx) => {
    const seen = new Set<string>();
    quest.objectives.forEach((objective, i) => {
      if (seen.has(objective.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['objectives', i, 'id'],
          message: `duplicate objective id "${objective.id}"`,
        });
      }
      seen.add(objective.id);
    });
  });

export type QuestObjective = z.infer<typeof questObjectiveSchema>;
export type QuestDef = z.infer<typeof questSchema>;

/** Where a quest stands. A quest with no record is not started. */
export const questStatusSchema = z.enum(['active', 'completed', 'failed']);
export type QuestStatus = z.infer<typeof questStatusSchema>;

/** The status a condition can ask about — the three above plus "not yet". */
export const questQuerySchema = z.enum(['inactive', 'active', 'completed', 'failed']);
export type QuestQuery = z.infer<typeof questQuerySchema>;

/**
 * The summary the journal shows for a quest as it stands: the latest done
 * step's, in the quest's own order, that has one; the opening summary until
 * then. A step done out of order still counts by its place in the list, so
 * the journal reads as far into the story as the party has got.
 */
export function journalSummary(quest: QuestDef, progress: { done: ReadonlySet<string> }): string {
  let summary = quest.summary;
  for (const objective of quest.objectives) {
    if (objective.summary !== '' && progress.done.has(objective.id)) summary = objective.summary;
  }
  return summary;
}

/** One quest's progress, as the campaign holds it. */
export interface QuestProgress {
  status: QuestStatus;
  /** Objective ids ticked off. */
  done: Set<string>;
  /** Hidden objectives brought into the journal. A done objective is always shown. */
  revealed: Set<string>;
}
