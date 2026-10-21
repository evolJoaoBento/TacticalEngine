/**
 * Project plans: what the party can work at on a long rest (the SRD's Work on a Project downtime move).
 *
 * A plan is whatever the designer wants it to be - a blade to forge, a book to decipher, a ship to rebuild - and
 * it is only two things the engine cares about: how much work it takes (`work`: one unit for each Work on a
 * Project move a character spends on it, over as many long rests as that takes) and what finishing it does
 * (`reward`), written in the one effect vocabulary every other piece of content uses: new gear (`addItem`), an
 * item the story asks after later (`addItem` of a key or a trinket, `setFlag`), a quest begun (`startQuest`), a
 * page of story (`story`) - anything a script can do.
 *
 * The party comes by a plan through a `learnPlan` effect, wherever effects are: a reply in a conversation, a chest,
 * a blueprint whose `use` teaches it. What has been learned and how far the work has gone is not content: it lives
 * in `ScenarioState.projects`, beside the quests, and travels into a save.
 */

import { z } from 'zod';
import { contentIdSchema } from '../scene/primitives';
import { effectSchema } from '../script/schema';

export const projectPlanSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  /** What the journal says the project is. */
  description: z.string().default(''),
  /** How many Work on a Project moves it takes, all told. */
  work: z.number().int().min(1),
  /** What finishing it does, its finisher the `actor`. */
  get reward() {
    return z.array(effectSchema).default([]);
  },
});

export type ProjectPlan = z.infer<typeof projectPlanSchema>;
