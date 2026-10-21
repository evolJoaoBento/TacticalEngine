/** The Ashwell: Level 5, the Ledger Throne (`docs/ASHWELL.md`) - its room, Orsolde Vane, and the three ways it ends. */

import { sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import type { Effect } from '../../engine/script/schema';
import { HALL_ID, HUB_ID, INK_WRAITH_ID, THRONE_ID, THRONE_QUEST, VANE_DIALOGUE, VANE_ID, sceneFromRows, kindsOf, type Furniture } from './ashwell-kit';
import { LOSSES, type Remembered } from './ashwell-level4';

// ---------------------------------------------------------------------------------------------------------------
// Level 5: the Ledger Throne
// ---------------------------------------------------------------------------------------------------------------

/**
 * A quiet room, warm and lamplit, at the bottom of everything: shelves of finished ledgers along every wall, a ring of
 * low reading screens, and inside it, up two steps on a dais, the ledger on its lectern, eleven thousand entries long,
 * and Orsolde Vane writing in it. He does not fight unless the party makes him, and the only thing that makes him is
 * a hand on the ledger to burn it. Three endings - burn it, take the pen, or leave him to it - each written up, each
 * sending the party up to Ketch, who is different afterwards in a way that depends on which.
 */
const THRONE_ROWS = [
  '######################',
  '#...SSSSSS....SSSSSS.#',
  '#....................#',
  '#S..................S#',
  '#S.....RRR//RRR.....S#',
  '#S.....R^^^^^^R.....S#',
  '#S.....R^^^^^^R.....S#',
  '#S.....R^^^^^^R.....S#',
  '#S.....R^^^^^^R.....S#',
  '#S.....R^^^^^^R.....S#',
  '#S.....RRR//RRR.....S#',
  '#S..................S#',
  '#....................#',
  '#...SSSSSS....SSSSSS.#',
  '######################',
];

/** The finished ledgers, shelved to the ceiling, and the ring of low wooden reading screens round the dais. */
const THRONE_FURNITURE: Readonly<Record<string, Furniture>> = {
  S: { kind: 'shelf', shape: 'block', height: 1.75 },
  R: { kind: 'counter', shape: 'block', height: 0.5 },
};

/** Vane and the Written, his drowned and burnt, who stand with him if it comes to that. */
const ARCHIVE = ['orsolde-vane', 'the-written-1', 'the-written-2', 'the-written-3'];

/** Every ending's last steps: the quest done, the Ashwell ended, and the climb back to the Lantern for good. */
function ending(flag: string, story: { title: string; paragraphs: string[] }, after: Effect[] = []): Effect[] {
  return [
    { kind: 'setFlag', flag },
    { kind: 'setFlag', flag: 'ashwell-ended' },
    { kind: 'completeObjective', quest: THRONE_QUEST, objective: 'the-ledger' },
    { kind: 'story', ...story, button: 'Climb back up' },
    ...after,
    { kind: 'completeQuest', quest: THRONE_QUEST },
    { kind: 'goto', scene: HUB_ID },
  ];
}

/** What becomes of Ilsabet Vane's entry, the one he never finished, if the party asked after her. */
const ILSABET = (text: string): Effect => ({ kind: 'branch', when: { kind: 'flag', flag: 'heard-of-ilsabet' }, then: [{ kind: 'log', text, tone: 'narration' }] });

/** The ledger burnt: everyone in it forgotten, as they were going to be. */
const BURNT = ending(
  'ending-burned',
  {
    title: 'Ash',
    paragraphs: [
      'It takes a long time to catch. Eleven thousand entries, and the paper is good. When it goes, it goes all at once, and the room is full of names for a breath - every one of them said aloud by nobody - and then of smoke, and then of nothing in particular.',
      'Vane sits down on the floor beside the lectern with his pen still in his hand. He is not writing. After a while he says, to nobody, "I had the most terrible feeling I had forgotten someone." Then he does not say anything else.',
      'You climb all the way up. The air in the well is clear, and cold, and smells of salt marsh and nothing else at all.',
    ],
  },
  [
    { kind: 'branch', when: { kind: 'flag', flag: 'gave-ketchs-name' }, then: [{ kind: 'log', text: 'Somewhere far above, a woman scrubbing a bar stops, and says her own name aloud, and is surprised by it.', tone: 'good' }] },
    ILSABET('Ilsabet Vane’s unfinished entry goes up with the rest. He watches that one go, and only that one.'),
  ],
);

/** The pen taken: the ledger kept, by the party now. */
const PEN = ending(
  'ending-took-the-pen',
  {
    title: 'The Pen',
    paragraphs: [
      'He holds it out to you as if it were hot. It is not heavy. It is the lightest thing you have ever held, and the moment it is in your hand you know three hundred names you did not know before, and how each of them ended, and that somebody ought to write it down.',
      '"There," says Vane. "There. Oh, that is better." He sits back in his chair and closes his eyes and, after a little while, you write him down too: four lines, and one of them is about his hands.',
      'You climb back up to the Lantern, because you live there now, more or less. Every evening one of you goes down the rope with a lamp. You take it in turns. You do not talk about it.',
    ],
  },
  [ILSABET('The first thing you write with it is the last line of Ilsabet Vane’s entry. It is not very long. It does not need to be.')],
);

/** Vane left to it: nothing ended, and the well still breathing. */
const LEFT = ending(
  'ending-left-him',
  {
    title: 'The Rope',
    paragraphs: [
      'You leave him writing. He does not look up. At the door you hear the pen stop, and start again, and you understand that he has begun your entries, and that he means to finish them properly this time.',
      'You climb all the way back up through the Furnace and the Library and the Market and the Throat, and the ash comes up the well with you, warm, smelling of paper and of people you used to know.',
      'Ketch is chalking a name on the slate when you come in. She looks at you, and at the well, and does not ask.',
    ],
  },
  [ILSABET('At the door you look back. He has turned to the front of the ledger, to the one entry he never finished, and he is sitting very still with the pen over it.')],
);

/** The ledger on its lectern: not to be touched while he will not allow it; burnt, or left, once he cannot stop it. */
const LEDGER: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'ashwell-ended' },
    then: [{ kind: 'log', text: 'The lectern is empty. Whatever was going to happen here has happened.', tone: 'narration' }],
    otherwise: [
      {
        kind: 'branch',
        when: { kind: 'encounter', id: 'the-archivist', state: 'ended' },
        then: [
          {
            kind: 'choice',
            title: 'The ledger',
            body: 'It lies open where he fell, eleven thousand and forty-one entries, the last one yours and unfinished. Nobody is going to stop you now.',
            options: [
              { label: 'Burn it.', effects: BURNT },
              { label: 'Leave it, and go.', effects: LEFT },
            ],
          },
        ],
        otherwise: [{ kind: 'log', text: 'Vane looks up from the page, mildly. "Not yet, I think. Talk to me first."', tone: 'narration' }],
      },
    ],
  },
];

/**
 * The page the Furnace took, kept on Vane's desk as he said: whoever's name it was reads it, and what the fire took
 * with it comes back.
 */
function burntPage(party: Remembered): Effect[] {
  return [
    ...party.map((member, at): Effect => ({
      kind: 'branch',
      when: { kind: 'flag', flag: `burnt-${member.id}` },
      then: [
        { kind: 'log', text: `Under an inkwell on Vane’s desk is the page from the Furnace, ${member.name}’s name on it in ${member.name}’s own hand, scorched at the edges. ${member.name} reads it, and it all comes back: ${LOSSES[at % LOSSES.length]}.`, tone: 'good' },
        { kind: 'clearStress', amount: 3, target: { kind: 'entity', id: member.id } },
        { kind: 'setFlag', flag: 'took-back-the-page' },
      ],
    })),
    { kind: 'markUsed' },
  ];
}

export function throne(party: Remembered): SceneDoc {
  // They all stand on nobody's side, and Vane talks for all of them.
  const talks = { kind: 'friendly', dialogue: VANE_DIALOGUE } as const;
  return sceneSchema.parse({
    id: THRONE_ID,
    name: 'The Ledger Throne',
    intro: 'A warm, quiet room of shelves and lamps, like a good study in a good house. In the middle, inside a ring of low reading screens and up two steps, a small old man in a moth-eaten coat sits at a lectern the size of an altar, writing. He finishes the line before he looks up.',
    light: 0.5,
    ...sceneFromRows(THRONE_ROWS, kindsOf('lantern'), THRONE_FURNITURE),
    spawns: [
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
    decos: [
      {
        id: 'quiet-stair-up',
        model: 'stone-stairs',
        position: { x: 1, y: 1 },
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'portal', name: 'The last stair', flavor: 'Up, past the Name Furnace, and on up to the Lantern a very long way above.', repeatable: true, effects: [{ kind: 'goto', scene: HALL_ID }] },
      },
      {
        id: 'the-ledger',
        model: 'pillar-prop',
        position: { x: 10, y: 7 },
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'scripted', name: 'The ledger', flavor: 'A book as long as a coffin, open on a lectern. The ink on the last page is wet.', repeatable: true, effects: LEDGER },
      },
      {
        id: 'the-burnt-page',
        model: 'banner-prop',
        position: { x: 13, y: 6 },
        rotation: -Math.PI / 2,
        solid: true,
        function: { kind: 'script', object: 'scripted', name: 'A scorched page, on the desk', flavor: 'A page under an inkwell, scorched at the edges. The hand on it is not Vane’s.', repeatable: true, effects: burntPage(party) },
      },
      { model: 'standing-torch-prop', position: { x: 8, y: 5 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 13, y: 9 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 2, y: 4 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 19, y: 4 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 2, y: 11 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 19, y: 11 }, rotation: 0 },
      { model: 'crate-prop', position: { x: 20, y: 2 }, rotation: 0.2 },
    ],
    encounters: [
      {
        id: 'the-archivist',
        name: 'The Archivist',
        // Begun only by a hand on the ledger: a fight here is one the party chose.
        startsOnTrigger: false,
        adversaries: [
          { id: 'orsolde-vane', adversary: VANE_ID, name: 'Orsolde Vane, the Sallow Archivist', model: 'wandering-hedge-priest', position: { x: 11, y: 7 }, interaction: talks },
          { id: 'the-written-1', adversary: INK_WRAITH_ID, name: 'The Written', model: 'briar-wraith', position: { x: 4, y: 8 }, interaction: talks },
          { id: 'the-written-2', adversary: INK_WRAITH_ID, name: 'The Written', model: 'briar-wraith', position: { x: 17, y: 8 }, interaction: talks },
          { id: 'the-written-3', adversary: INK_WRAITH_ID, name: 'The Written', model: 'briar-wraith', position: { x: 10, y: 12 }, interaction: talks },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Its people
// ---------------------------------------------------------------------------------------------------------------

const WRITES_TEXT = 'Reaction: the first time a PC makes an action roll against the Archive, Vane writes the room around him. The floor within Close range of him becomes his page - a PC standing on it is Vulnerable - and he begins to finish their entries: a Loop Countdown (3) that ticks down whenever a PC makes an action roll. Each time it triggers, the PC nearest him takes 2d6 direct magic damage. It ends when he falls.';
const MARGINS_TEXT = 'Reaction, twice a scene: when Vane marks Hit Points, one of the Written climbs up out of the margins within Close range of him.';

/**
 * Orsolde Vane, the Sallow Archivist: old and small and not a fighter, until his ledger is threatened. A tier-3 solo,
 * and the last boss. He writes the room around him - the floor his page, and every entry he finishes a wound - and
 * hurt, he calls the Written up out of the margins.
 */
export const ORSOLDE_VANE: AdversaryDef = {
  id: VANE_ID,
  name: 'Sallow Archivist',
  tier: 3,
  role: 'solo',
  description: 'A small old man in a moth-eaten coat with ink to the second knuckle. When he fights, he writes, and the room does what he writes.',
  motivesAndTactics: 'Protect the ledger. Write the nearest of them down, mid-sentence. Call the Written up out of the margins.',
  difficulty: 17,
  thresholds: { major: 18, severe: 34 },
  hitPoints: 10,
  stress: 6,
  attackName: 'Finished Entry',
  attackModifier: { count: 0, sides: 0, modifier: 5 },
  attackRange: 'close',
  attackDamage: { count: 3, sides: 8, modifier: 4, types: ['magic'] },
  experiences: [{ name: 'Has written everyone down', modifier: 4 }],
  features: [
    { name: 'Writes the Room', kind: 'reaction', text: WRITES_TEXT, costsGmResource: false },
    { name: 'Out of the Margins', kind: 'reaction', text: MARGINS_TEXT, costsGmResource: false },
  ],
} as AdversaryDef;

/** The features above, as the cards Vane's stat block prints, and what each does. */
export const LEVEL_FIVE_CARDS: ProjectDoc['cards'] = [
  { id: 'vane-writes-the-room', name: 'Writes the Room', grant: { kind: 'adversary', adversaries: [VANE_ID] }, text: WRITES_TEXT, features: [] },
  { id: 'vane-out-of-the-margins', name: 'Out of the Margins', grant: { kind: 'adversary', adversaries: [VANE_ID] }, text: MARGINS_TEXT, features: [] },
] as ProjectDoc['cards'];

type Ability = ProjectDoc['abilities'][number];

export const LEVEL_FIVE_ABILITIES: ProjectDoc['abilities'] = [
  {
    id: 'vane-writes-the-room',
    name: 'Writes the Room',
    source: { card: 'vane-writes-the-room' },
    text: WRITES_TEXT,
    // As the Sexton's bell: a reaction to the party's first roll, which costs the GM nothing and waits for no spotlight.
    kind: 'reaction',
    trigger: 'partyRolled',
    cost: {},
    uses: { count: 1, per: 'scene' },
    target: { kind: 'self' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Vane takes up the pen again and writes the room. The floor round the lectern is a page now, and you are standing on his lines.', tone: 'bad' },
      { kind: 'zone', zone: 'his-page', name: 'His Page', condition: 'vulnerable', at: 'actor', band: 'close', side: 'adversaries', onDeath: 'end' },
      {
        kind: 'countdown',
        countdown: 'vane-writes',
        name: 'The entry',
        start: '3',
        advance: 'standard',
        loop: 'reset',
        onDeath: 'end',
        effects: [
          { kind: 'log', text: 'Vane finishes an entry - the nearest of you, mid-sentence - and blots it.', tone: 'bad' },
          { kind: 'damage', dice: '2d6', type: 'magic', direct: true, target: { kind: 'allies', range: 'veryFar', nearest: 1 } },
        ],
      },
    ],
  } as Ability,
  {
    id: 'vane-out-of-the-margins',
    name: 'Out of the Margins',
    source: { card: 'vane-out-of-the-margins' },
    text: MARGINS_TEXT,
    kind: 'reaction',
    trigger: 'tookHitPoints',
    cost: {},
    uses: { count: 2, per: 'scene' },
    target: { kind: 'self' },
    inCombatOnly: true,
    effects: [
      { kind: 'summon', adversary: INK_WRAITH_ID, count: '1', range: 'close' },
      { kind: 'log', text: 'Ink runs out of the margin of the nearest shelf, and stands up, and is one of the Written.', tone: 'bad' },
    ],
  } as Ability,
];

/**
 * What Vane reads back from the party's entry, when they ask for the pen: the keeping they did on the way down, each a
 * mark in their favour. Three, and the pen is theirs on their record; fewer, and it is their word against it.
 */
const KEPT: readonly (readonly [string, string])[] = [
  ['annick-spared', '"...talked the keeper Annick down off his doors, and he wipes his gate still."'],
  ['returned-the-ring', '"...brought Tam Ketch’s ring up out of the Kennel, and put it in his wife’s hand."'],
  ['mott-talked', '"...let the Sexton off his rope, rather than off his ledge."'],
  ['found-our-own', '"...found the name they sold the Broker, in my Index, and read it back."'],
  ['freed-annicks-name', '"...tore Annick’s card out of the Index and carried it off in a shirt."'],
  ['told-aud', '"...read Aud Brennock’s card, and told her so, and let her decide."'],
  ['choir-led-up', '"...sent the Choir up the well."'],
  ['took-back-the-page', '"...took back the page the Furnace had, off my own desk."'],
  ['heard-of-ilsabet', '"...asked after Ilsabet."'],
];
/** How many marks the pen asks. */
export const PEN_ASKS = 3;

export const VANE: ProjectDoc['dialogues'][number] = {
  id: VANE_DIALOGUE,
  start: 'greet',
  nodes: [
    {
      id: 'greet',
      lines: [
        { speaker: 'Orsolde Vane', text: 'You came. Do sit - no, of course not, you have been sitting on stairs for a week. Eleven thousand and forty-one. I have left a space for you at the bottom of the page. I trust that is all right.' },
      ],
      onEnter: [
        { kind: 'completeObjective', quest: THRONE_QUEST, objective: 'hear-vane' },
        { kind: 'branch', when: { kind: 'flag', flag: 'read-vanes-page' }, then: [{ kind: 'log', text: '"You tore down my first page, in the Throat, and read it," he says. "Nobody reads the first one. I took it as encouragement."', tone: 'narration' }] },
      ],
      choices: [
        { text: 'Why do you keep it?', goto: 'why' },
        { text: 'What happens to them if we burn it?', goto: 'burn-what' },
        { text: 'You took Ketch’s name.', available: { kind: 'flag', flag: 'gave-ketchs-name' }, goto: 'ketch' },
        { text: 'We burnt your Index.', available: { kind: 'flag', flag: 'burned-the-index' }, goto: 'index' },
        { text: 'Ketch says you came down the winter your wife died.', available: { kind: 'all', of: [{ kind: 'flag', flag: 'knows-vanes-name' }, { kind: 'not', of: { kind: 'flag', flag: 'heard-of-ilsabet' } }] }, goto: 'ilsabet' },
        { text: 'We have decided.', goto: 'decide' },
        { text: '[Leave him writing, for now.]' },
      ],
    },
    {
      id: 'why',
      lines: [
        { speaker: 'Orsolde Vane', text: 'Because somebody has to remember them, and nobody does. Margery Ketch’s husband: four lines, and two of them are about his hands. Without me he is a stone in a field. With me he is a man who was good with barrels.' },
        { speaker: 'Orsolde Vane', text: 'I did not think it would need so much fire. I thought it would be paper and patience.' },
      ],
      choices: [
        { text: 'What happens to them if we burn it?', goto: 'burn-what' },
        { text: 'We have decided.', goto: 'decide' },
      ],
    },
    {
      id: 'burn-what',
      lines: [
        { speaker: 'Orsolde Vane', text: 'Then nobody is written. Everyone in it goes back to being forgotten, which is what they were going to be anyway, before me. The town stops breathing ash. Ketch’s slate will be very clean.' },
        { text: 'He says it without heat. He has thought about it a great deal.' },
      ],
      choices: [
        { text: 'Why do you keep it?', goto: 'why' },
        { text: 'We have decided.', goto: 'decide' },
      ],
    },
    {
      id: 'ketch',
      lines: [
        { speaker: 'Orsolde Vane', text: 'I know. It is in here now, in her own hand, very small. She will forget it before she misses it. Most of them do.' },
      ],
      choices: [{ text: 'We have decided.', goto: 'decide' }],
    },
    {
      id: 'index',
      lines: [
        { speaker: 'Orsolde Vane', text: 'Yes. I felt it go. Four hundred streets of people I cannot find any more. I am told that is what it is to be old.' },
      ],
      choices: [{ text: 'We have decided.', goto: 'decide' }],
    },
    {
      id: 'decide',
      lines: [{ speaker: 'Orsolde Vane', text: 'Have you. Well. Go on, then.' }],
      choices: [
        { text: 'Give us the pen.', goto: 'pen-ask' },
        { text: 'Keep writing. We are leaving.', goto: 'leave' },
        { text: 'We are going to burn the ledger.', goto: 'refused' },
      ],
    },
    {
      id: 'pen',
      lines: [{ text: 'Vane looks at the pen in his hand for a long moment, as if he had not known it was there.' }],
      choices: [{ text: '[Take it.]', effects: PEN }],
    },
    {
      id: 'leave',
      lines: [{ speaker: 'Orsolde Vane', text: 'Yes. Yes, that is probably kindest. Mind the lamps on the way up.' }],
      choices: [{ text: '[Go.]', effects: LEFT }],
    },
    {
      id: 'refused',
      lines: [
        { text: 'He puts the pen down very carefully, the first time he has put it down since you came in.' },
        { speaker: 'Orsolde Vane', text: 'No. I am sorry. Not that. Anything but that.' },
        { text: 'All round the room, in the margins of the shelves, the Written stand up.' },
      ],
      onEnter: [{ kind: 'setAttitude', attitude: 'hostile', target: { kind: 'entities', ids: [...ARCHIVE] } }],
      choices: [{ text: '[Draw steel.]' }],
    },
    {
      id: 'ilsabet',
      lines: [
        { text: 'The pen stops.' },
        { speaker: 'Orsolde Vane', text: 'Ilsabet. Yes. She was the first entry, and she is the only one I never finished. Forty years, and I could not think of the last line. Everybody else’s comes so easily.' },
        { speaker: 'Orsolde Vane', text: 'I came down to find it. There is a great deal of paper between me and it now.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'heard-of-ilsabet' }],
      choices: [{ text: 'We have decided.', goto: 'decide' }, { text: '[Leave him writing, for now.]' }],
    },
    {
      id: 'pen-ask',
      lines: [
        { text: 'Vane turns back through the ledger a long way, to your entry, and reads it with a finger under the line - not aloud, and then, here and there, aloud.' },
        { speaker: 'Orsolde Vane', text: 'Somebody has to keep it. The question is only whether you are keepers.' },
      ],
      onEnter: [
        { kind: 'setVar', name: 'kept', value: 0 },
        ...KEPT.map(([flag, said]): Effect => ({ kind: 'branch', when: { kind: 'flag', flag }, then: [{ kind: 'addVar', name: 'kept', by: 1 }, { kind: 'log', text: said, tone: 'good' }] })),
      ],
      choices: [
        // On their record: what they kept on the way down.
        { text: 'Then you know what we kept.', available: { kind: 'var', name: 'kept', op: '>=', value: PEN_ASKS }, goto: 'pen' },
        // Or on their word, which is harder.
        { text: 'Trust us with it.', detail: 'Presence 16', check: { trait: 'presence', difficulty: 16, gotoOnSuccess: 'pen', gotoOnFailure: 'not-yet' } },
        { text: '[Think again.]', goto: 'decide' },
      ],
    },
    {
      id: 'not-yet',
      lines: [
        { speaker: 'Orsolde Vane', text: 'No. I am sorry. Not on what you say - on what you did, and you did not do enough of the keeping kind. You would put it down in a week, and they would all be lost twice.' },
      ],
      choices: [
        { text: 'Keep writing. We are leaving.', goto: 'leave' },
        { text: 'We are going to burn the ledger.', goto: 'refused' },
      ],
    },
  ],
} as ProjectDoc['dialogues'][number];

export const THRONE_QUEST_DEF: ProjectDoc['quests'][number] = {
  id: THRONE_QUEST,
  name: 'The Ledger Throne',
  summary: 'At the bottom of everything, Orsolde Vane is writing. He has left a space for you.',
  objectives: [
    { id: 'reach-the-throne', text: 'Go down the last stair.', hidden: false, summary: 'You came to the bottom of the Ashwell.' },
    { id: 'hear-vane', text: 'Hear what Orsolde Vane has to say.', hidden: false, summary: 'He has been waiting a long time to say it.' },
    { id: 'the-ledger', text: 'Decide what becomes of the ledger.', hidden: false, summary: 'It is decided.' },
  ],
};
