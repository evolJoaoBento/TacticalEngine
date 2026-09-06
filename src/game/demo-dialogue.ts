/**
 * The demo's one conversation.
 *
 * Written as document data — it parses through `dialogueSchema` exactly as a
 * file loaded from disk would, so this is a worked example of what an author
 * writes, not a special case the engine understands.
 *
 * It exercises the three things a CRPG conversation needs and a straight line of
 * text does not: a reply hidden until you know something, a reply that costs a
 * roll and branches on the outcome, and effects that outlast the conversation.
 */

import { dialogueSchema, type Dialogue } from '../engine/dialogue/schema';
import { OBJECTIVE_OPEN_THE_STRONGBOX, OBJECTIVE_WIN_THE_WORD, WARDENS_WORD_QUEST } from './demo-quests';

export const PILLAR_DIALOGUE_ID = 'the-listening-pillar';

/** The flag the pillar sets, and the gated reply reads. */
export const KNOWS_THE_NAME = 'knows-the-wardens-name';

export const PILLAR_DIALOGUE: Dialogue = dialogueSchema.parse({
  id: PILLAR_DIALOGUE_ID,
  start: 'wakes',
  nodes: [
    {
      id: 'wakes',
      onEnter: [{ kind: 'startQuest', quest: WARDENS_WORD_QUEST }],
      lines: [
        { text: 'The carving in the pillar opens its eyes.' },
        {
          speaker: 'The Warden',
          text: 'Three hundred years, and the first thing through that door is a thief with a lantern.',
        },
      ],
      choices: [
        {
          text: 'We are not thieves. We came for the vault.',
          goto: 'vault',
        },
        {
          text: 'Who are you?',
          goto: 'name',
        },
        {
          text: 'Warden. I know what you are.',
          // Hidden entirely until the party has learned the name elsewhere, which
          // is the whole point of a gated reply: it rewards knowing.
          available: { kind: 'flag', flag: KNOWS_THE_NAME },
          goto: 'known',
        },
        {
          text: '[Say nothing and walk away.]',
          effects: [{ kind: 'log', text: 'The eyes close again.', tone: 'narration' }],
        },
      ],
    },
    {
      id: 'name',
      lines: [
        {
          speaker: 'The Warden',
          text: 'I was left here to keep count. I have counted very carefully.',
        },
      ],
      choices: [
        {
          text: 'Count of what?',
          goto: 'vault',
        },
      ],
      onEnter: [{ kind: 'setFlag', flag: KNOWS_THE_NAME }],
    },
    {
      id: 'vault',
      lines: [
        {
          speaker: 'The Warden',
          text: 'The door does not open for the living. It never did. But it might open for the polite.',
        },
      ],
      choices: [
        {
          text: 'Then let us ask it politely.',
          detail: 'Presence 13',
          check: {
            trait: 'presence',
            difficulty: 13,
            onSuccessWithHope: [
              { kind: 'log', text: 'Something in the stone unclenches.', tone: 'hope' },
              { kind: 'giveKey', key: 'wardens-word' },
              { kind: 'completeObjective', quest: WARDENS_WORD_QUEST, objective: OBJECTIVE_WIN_THE_WORD },
              { kind: 'revealObjective', quest: WARDENS_WORD_QUEST, objective: OBJECTIVE_OPEN_THE_STRONGBOX },
            ],
            onSuccessWithFear: [
              { kind: 'log', text: 'It yields — and something deeper in the vault notices.', tone: 'fear' },
              { kind: 'giveKey', key: 'wardens-word' },
              { kind: 'completeObjective', quest: WARDENS_WORD_QUEST, objective: OBJECTIVE_WIN_THE_WORD },
              { kind: 'revealObjective', quest: WARDENS_WORD_QUEST, objective: OBJECTIVE_OPEN_THE_STRONGBOX },
            ],
            onFailureWithHope: [
              { kind: 'log', text: 'The Warden is unmoved, but not unkind.', tone: 'narration' },
            ],
            onFailureWithFear: [
              { kind: 'log', text: 'The eyes narrow. You have been counted.', tone: 'fear' },
            ],
            gotoOnSuccess: 'granted',
            gotoOnFailure: 'refused',
          },
        },
        {
          text: 'We will find our own way in.',
          goto: 'refused',
        },
      ],
    },
    {
      id: 'known',
      lines: [
        { speaker: 'The Warden', text: 'Then you know what I am owed. Ask, and ask well.' },
      ],
      goto: 'vault',
    },
    {
      id: 'granted',
      lines: [
        { speaker: 'The Warden', text: 'Go on, then. Mind the third step; it remembers.' },
      ],
    },
    {
      id: 'refused',
      lines: [{ speaker: 'The Warden', text: 'Then we are done talking.' }],
    },
  ],
});

export const DEMO_DIALOGUES: readonly Dialogue[] = [PILLAR_DIALOGUE];
