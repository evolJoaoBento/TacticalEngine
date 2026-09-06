/**
 * The demo's one quest, authored as document data through the real schema.
 *
 * It threads through content that already exists: the pillar conversation
 * starts it, winning the Warden's word ticks the first step, and the strongbox
 * downstairs ticks the second and closes it. Placeholder fiction, like the rest
 * of the demo.
 */

import { questSchema, type QuestDef } from '../engine/content/quests';

export const WARDENS_WORD_QUEST = 'the-wardens-word';
export const OBJECTIVE_WIN_THE_WORD = 'win-the-word';
export const OBJECTIVE_OPEN_THE_STRONGBOX = 'open-the-strongbox';

export const DEMO_QUESTS: readonly QuestDef[] = [
  {
    id: WARDENS_WORD_QUEST,
    name: "The Warden's Word",
    summary:
      'Something in the pillar has kept this vault for three hundred years. It knows a word that opens what is below.',
    objectives: [
      { id: OBJECTIVE_WIN_THE_WORD, text: 'Get the word out of the Warden.' },
      { id: OBJECTIVE_OPEN_THE_STRONGBOX, text: 'Open the strongbox in the pit.' },
    ],
  },
].map((quest) => questSchema.parse(quest));
