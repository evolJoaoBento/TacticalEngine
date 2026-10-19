/** The Ashwell: Level 3, the Drowned Library (`docs/ASHWELL.md`) - its rooms, its people, its quest. */

import { sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import type { Effect } from '../../engine/script/schema';
import { COUNTING_ID, READING_ID, STACKS_ID, INDEX_ID, LIBRARY_QUEST, AUD_DIALOGUE, KINDLING, YOUR_PAGE, INK_WRAITH_ID, INDEX_BOSS_ID, NAVE_ID, FURNACE_QUEST, sceneFromRows, passage, afterTheFight, kindsOf } from './ashwell-kit';

// ---------------------------------------------------------------------------------------------------------------
// Level 3: the Drowned Library
// ---------------------------------------------------------------------------------------------------------------

/**
 * Vane's first archive, flooded when the sea came up: shelves standing in black water, pages drifting. Three rooms.
 * The Reading Room, where nobody fights: the wet stair up to the Counting House, and the Kindlers' fire on a reading
 * platform, Aud Brennock feeding it pages. Down a passage, the Wet Stacks, where the ink-wraiths are. Below them, the
 * Index - the catalogue of everyone Vane has filed, which hunts by name - and past it the stair down, which opens only
 * to a party carrying its own page.
 */
const READING_ROWS = [
  '####################',
  '#...################',
  '#....~~~~~~~~~~~~~~#',
  '#..c.~~#~~~#~~~#~~~#',
  '#....~~~~~~~~~~~~~~#',
  '#~~~~~~~~......~~~~#',
  '#~~#~~~~~..c...~~#~#',
  '#~~~~~~~~......~~~~#',
  '#~~#~~~~~~~~~~~~~#~#',
  '#~~~~~~~~~~~~~~~~~~#',
  '#~~~~~~~~~~~~~~~...#',
  '################..##',
  '####################',
];

const STACKS_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#..............#',
  '#.##.##..##.##.#',
  '#~~~~~~..~~~~~~#',
  '#.##.##..##.##.#',
  '#..............#',
  '#.##.##..##.##.#',
  '#~~~~~~~~~~~~..#',
  '#############..#',
  '#############..#',
  '################',
];

const INDEX_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#..............#',
  '#..~~~~~~~~~~..#',
  '#..~........~..#',
  '#..~..cccc..~..#',
  '#..~........~..#',
  '#..~~~~..~~~~..#',
  '#..............#',
  '#######..#######',
  '#######..#######',
  '################',
];

/**
 * The sealed stair down from the Index, which opens to a party carrying its own page: the first time, the page read
 * aloud and the end of Level 3 - the quest done, a level gained - and the way into Level 4, its quest begun; every time
 * after, simply the way down to the Furnace.
 */
const FURNACE_STAIR: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'level-3-done' },
    then: [{ kind: 'goto', scene: NAVE_ID }],
    otherwise: [
      { kind: 'completeObjective', quest: LIBRARY_QUEST, objective: 'read-your-page' },
      {
        kind: 'story',
        title: 'Your entry',
        paragraphs: [
          'The stair is sealed with a skin of wet paper, and it will not tear. It parts only when the page you took from the Index is held up to it and read aloud. So somebody reads it.',
          'It is about all of you. It is in Vane\u2019s small square hand, and it is right about everything so far: the rope, the water, Annick, the name you paid the Broker. It goes on past today. It says how each of you dies. Each account stops mid-sentence, as if he had been called away.',
          'The paper parts. Below, the stair is warm and dry, and the air smells of hot iron, and somebody is singing.',
        ],
        button: 'Go down',
      },
      { kind: 'markStress', amount: 1, target: { kind: 'party' } },
      { kind: 'completeQuest', quest: LIBRARY_QUEST },
      { kind: 'levelUp' },
      { kind: 'setFlag', flag: 'level-3-done' },
      { kind: 'startQuest', quest: FURNACE_QUEST },
      { kind: 'completeObjective', quest: FURNACE_QUEST, objective: 'reach-the-furnace' },
      { kind: 'goto', scene: NAVE_ID },
    ],
  },
];

export function readingRoom(): SceneDoc {
  return sceneSchema.parse({
    id: READING_ID,
    name: 'The Reading Room',
    intro: 'The water stands knee-deep between the shelves, black and still, and pages turn slowly in it like leaves. On a reading platform in the middle of the room, somebody has lit a fire.',
    ...sceneFromRows(READING_ROWS, kindsOf('library')),
    spawns: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 1 },
    ],
    decos: [
      {
        id: 'wet-stair-up',
        model: 'stone-stairs',
        position: { x: 1, y: 1 },
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'portal', name: 'The wet stair', flavor: 'Up, through the Bone Door, to the Counting House.', repeatable: true, effects: [{ kind: 'goto', scene: COUNTING_ID }] },
      },
      {
        id: 'third-page',
        model: 'banner-prop',
        position: { x: 1, y: 4 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'scripted',
          name: 'A page, on a reading desk',
          flavor: 'A page lies open on a reading desk above the waterline, weighted with a stone. It is the only dry thing in the room.',
          effects: [
            {
              kind: 'story',
              title: 'Entry 4,127',
              paragraphs: [
                '"The Kindlers came to burn me. That was nine of them. The Index has filed six. Aud Brennock is still burning things on the reading platform, and I have let her, because the way she does it is beautiful, and because she is nearly finished."',
                '"The party will want the stair. The stair wants their page. Their page is in the Index. Everything is in the Index."',
              ],
              button: 'Put the stone back',
            },
          ],
        },
      },
      { id: 'aud-brennock', model: 'traveling-bard', position: { x: 13, y: 6 }, rotation: -Math.PI / 2, solid: true, function: { kind: 'interaction', dialogue: AUD_DIALOGUE } },
      { id: 'kindlers-fire', model: 'camp-fire-prop', position: { x: 12, y: 5 }, rotation: 0, solid: true },
      { model: 'fungril-male', position: { x: 10, y: 7 }, rotation: 0.6 },
      { model: 'crate-prop', position: { x: 14, y: 7 }, rotation: 0.2 },
      { model: 'standing-torch-prop', position: { x: 10, y: 5 }, rotation: 0 },
      passage('down-to-the-stacks', 'reading-stacks', { x: 16, y: 11 }, 0),
    ],
  });
}

export function stacks(): SceneDoc {
  return sceneSchema.parse({
    id: STACKS_ID,
    name: 'The Wet Stacks',
    intro: 'Rows of shelves, waist-high in water, their books swollen shut. The ink has run out of them and hangs in the water in threads. The threads are moving against the current.',
    ...sceneFromRows(STACKS_ROWS, kindsOf('library')),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
    ],
    decos: [
      passage('up-from-the-stacks', 'reading-stacks', { x: 7, y: 1 }, Math.PI),
      passage('down-to-the-index', 'stacks-index', { x: 13, y: 11 }, 0),
      {
        id: 'drowned-satchel',
        model: 'chest-prop',
        position: { x: 14, y: 3 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'chest',
          name: 'A drowned reader\u2019s satchel',
          flavor: 'A leather satchel on a high shelf, above the water. Its owner is not far off, and is ink now.',
          repeatable: true,
          effects: afterTheFight(
            'the-stacks',
            [
              { kind: 'completeObjective', quest: LIBRARY_QUEST, objective: 'clear-the-stacks' },
              { kind: 'loot', table: 'drowned-satchel' },
              { kind: 'log', text: 'Whoever carried it was careful: everything in it is dry.', tone: 'narration' },
            ],
            'The ink in the water is still moving. Not yet.',
          ),
        },
      },
      { model: 'withering-tree-prop', position: { x: 1, y: 3 }, rotation: 1.1 },
    ],
    encounters: [
      {
        id: 'the-stacks',
        name: 'The Wet Stacks',
        triggerCells: [7, 8].map((x) => ({ x, y: 3 })),
        adversaries: [
          { id: 'ink-wraith-1', adversary: INK_WRAITH_ID, name: 'Ink-Wraith', model: 'briar-wraith', position: { x: 2, y: 7 } },
          { id: 'ink-wraith-2', adversary: INK_WRAITH_ID, name: 'Ink-Wraith', model: 'briar-wraith', position: { x: 13, y: 7 } },
          { id: 'ink-wraith-3', adversary: INK_WRAITH_ID, name: 'Ink-Wraith', model: 'briar-wraith', position: { x: 8, y: 9 } },
          { id: 'paper-moths', adversary: 'grave-moth', name: 'Paper Moths', position: { x: 4, y: 5 } },
        ],
      },
    ],
  });
}

export function index(): SceneDoc {
  return sceneSchema.parse({
    id: INDEX_ID,
    name: 'The Index',
    intro: 'A round room with a moat of black water, and in its middle a cabinet of a thousand small drawers, taller than a house. As you come in, every drawer slides open an inch, and something inside each one says a name.',
    ...sceneFromRows(INDEX_ROWS, kindsOf('library')),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
    ],
    decos: [
      passage('up-from-the-index', 'stacks-index', { x: 7, y: 1 }, Math.PI),
      {
        id: 'catalogue-drawers',
        model: 'pillar-prop',
        position: { x: 9, y: 5 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'chest',
          name: 'The catalogue',
          flavor: 'A thousand small drawers, each with a name on a brass card. Yours are here. So is everybody’s.',
          repeatable: true,
          effects: afterTheFight(
            'the-index',
            [
              { kind: 'giveKey', key: YOUR_PAGE },
              { kind: 'completeObjective', quest: LIBRARY_QUEST, objective: 'the-index' },
              { kind: 'revealObjective', quest: LIBRARY_QUEST, objective: 'read-your-page' },
              { kind: 'log', text: 'In the drawer with your names on it is a single page, folded once: yours. You take it.', tone: 'good' },
              {
                kind: 'choice',
                title: 'The catalogue',
                body: 'The drawers stand open, every name in Hallowmere filed in them, the dead and the not yet. Aud’s tinder is in your pocket.',
                options: [
                  {
                    label: 'Burn it.',
                    detail: 'Aud’s tinder',
                    available: { kind: 'hasItem', item: KINDLING },
                    effects: [
                      { kind: 'removeItem', item: KINDLING },
                      { kind: 'setFlag', flag: 'burned-the-index' },
                      { kind: 'log', text: 'The cards go up like dry leaves. For a long moment the room is full of names said aloud, all at once, and then of nothing. Somewhere above, a great many people forget a great many things.', tone: 'narration' },
                    ],
                  },
                  { label: 'Leave it.', effects: [{ kind: 'log', text: 'You shut the drawer with your names in it. The rest go on whispering.', tone: 'narration' }] },
                ],
              },
            ],
            'The Index knows your names, and it is not done saying them.',
          ),
        },
      },
      {
        id: 'furnace-stair',
        model: 'stone-stairs',
        position: { x: 7, y: 11 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'portal',
          name: 'The sealed stair',
          flavor: 'A stair going down, sealed with a skin of wet paper that will not tear. Warm air presses up against it.',
          requiresKey: YOUR_PAGE,
          lockedText: 'The paper does not tear. Written across it, very small: "Bring your page."',
          repeatable: true,
          effects: FURNACE_STAIR,
        },
      },
      { model: 'standing-torch-prop', position: { x: 1, y: 3 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 14, y: 3 }, rotation: 0 },
    ],
    encounters: [
      {
        id: 'the-index',
        name: 'The Undertow Index',
        triggerCells: [7, 8].map((x) => ({ x, y: 3 })),
        adversaries: [
          { id: 'undertow-index', adversary: INDEX_BOSS_ID, name: 'The Undertow Index', model: 'stone-golem', position: { x: 7, y: 7 } },
          { id: 'index-wraith-1', adversary: INK_WRAITH_ID, name: 'Ink-Wraith', model: 'briar-wraith', position: { x: 2, y: 9 } },
          { id: 'index-wraith-2', adversary: INK_WRAITH_ID, name: 'Ink-Wraith', model: 'briar-wraith', position: { x: 13, y: 9 } },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Its people
// ---------------------------------------------------------------------------------------------------------------

/** The drowned recorded dead: ink that remembers being a person, and wants to be read aloud. A tier-2 skulk. */
export const INK_WRAITH: AdversaryDef = {
  id: INK_WRAITH_ID,
  name: 'Ink-Wraith',
  tier: 2,
  role: 'skulk',
  description: 'A drowned reader’s shape in threads of black ink, trailing words. Up close, the words are its own name, over and over.',
  motivesAndTactics: 'Drift unseen through the water. Wrap whoever reads a spine. Pull them under to read to.',
  difficulty: 14,
  thresholds: { major: 8, severe: 16 },
  hitPoints: 4,
  stress: 3,
  attackName: 'Drowning Ink',
  attackModifier: { count: 0, sides: 0, modifier: 2 },
  attackRange: 'veryClose',
  attackDamage: { count: 1, sides: 8, modifier: 3, types: ['magic'] },
  experiences: [],
  features: [],
} as AdversaryDef;

/** The Undertow Index: the catalogue of everyone Vane has filed, which hunts by name. A tier-2 solo, and the level's boss. */
export const UNDERTOW_INDEX: AdversaryDef = {
  id: INDEX_BOSS_ID,
  name: 'Undertow Index',
  tier: 2,
  role: 'solo',
  description: 'A cabinet of a thousand drawers, taller than a house, that walks on its own lower drawers. Every drawer has a name on it, and it says them.',
  motivesAndTactics: 'Say the name of whoever it means to strike. File the fallen. Never let a drawer be shut.',
  difficulty: 15,
  thresholds: { major: 12, severe: 24 },
  hitPoints: 9,
  stress: 4,
  attackName: 'Card Lash',
  attackModifier: { count: 0, sides: 0, modifier: 3 },
  attackRange: 'close',
  attackDamage: { count: 2, sides: 8, modifier: 3, types: ['physical'] },
  experiences: [{ name: 'Knows your name', modifier: 3 }],
  features: [],
} as AdversaryDef;

export const AUD: ProjectDoc['dialogues'][number] = {
  id: AUD_DIALOGUE,
  start: 'fire',
  nodes: [
    {
      id: 'fire',
      lines: [
        { text: 'A woman sits by the fire on the reading platform, feeding it pages one at a time. Half her face is covered in small black handwriting, and as you watch, a new line writes itself along her jaw.' },
        { speaker: 'Aud Brennock', text: 'Don’t read anything. Not a spine, not a label. It notices.' },
      ],
      choices: [
        { text: 'Who are you?', goto: 'who' },
        { text: 'What are you burning?', goto: 'burning' },
        { text: 'We are going deeper.', available: { kind: 'not', of: { kind: 'hasItem', item: KINDLING } }, goto: 'deeper' },
        { text: 'The Index is ash.', available: { kind: 'flag', flag: 'burned-the-index' }, goto: 'ash' },
        { text: 'We left the Index standing.', available: { kind: 'all', of: [{ kind: 'objectiveDone', quest: LIBRARY_QUEST, objective: 'the-index' }, { kind: 'not', of: { kind: 'flag', flag: 'burned-the-index' } }] }, goto: 'whole' },
        { text: '[Leave her to the fire.]' },
      ],
    },
    {
      id: 'who',
      lines: [
        { speaker: 'Aud Brennock', text: 'Aud Brennock. We came down to burn the ledger. The Kindlers, we called ourselves, as if a name would help. There were nine of us.' },
        { speaker: 'Aud Brennock', text: 'The Index found six. It finds you by your name, you see, and we all had one.' },
      ],
      onEnter: [{ kind: 'completeObjective', quest: LIBRARY_QUEST, objective: 'meet-the-kindlers' }],
      choices: [
        { text: 'What are you burning?', goto: 'burning' },
        { text: 'We are going deeper.', available: { kind: 'not', of: { kind: 'hasItem', item: KINDLING } }, goto: 'deeper' },
        { text: '[Leave her to the fire.]' },
      ],
    },
    {
      id: 'burning',
      lines: [
        { speaker: 'Aud Brennock', text: 'Whatever comes to hand. Every page burnt is somebody he can’t finish writing. He hates it.' },
        { text: 'She feeds the fire another page. The writing on her face goes on writing.' },
        { speaker: 'Aud Brennock', text: 'Good.' },
      ],
      choices: [
        { text: 'We are going deeper.', available: { kind: 'not', of: { kind: 'hasItem', item: KINDLING } }, goto: 'deeper' },
        { text: '[Leave her to the fire.]' },
      ],
    },
    {
      id: 'deeper',
      lines: [
        { speaker: 'Aud Brennock', text: 'Through the Stacks, then, and down to the Index. It’s a catalogue. Everyone he’s filed, and everyone he means to. When it’s down, it can be burnt. All of it.' },
        { speaker: 'Aud Brennock', text: 'Mind - everyone in it goes too. Not the people. What’s remembered of them. Think about that before you strike the light.' },
        { text: 'She presses a twist of oilcloth into your hand: a tinderbox, and a rag soaked in lamp oil.' },
      ],
      onEnter: [
        { kind: 'completeObjective', quest: LIBRARY_QUEST, objective: 'meet-the-kindlers' },
        { kind: 'addItem', item: KINDLING },
      ],
      choices: [{ text: '[Take the tinder.]' }],
    },
    {
      id: 'ash',
      lines: [
        { text: 'Aud touches her jaw. The writing there has stopped, mid-word.' },
        { speaker: 'Aud Brennock', text: 'Then I can stop too.' },
        { text: 'She lies down by the fire with her head on a book, and does not get up again, and does not need to.' },
      ],
      choices: [{ text: '[Leave her by the fire.]' }],
    },
    {
      id: 'whole',
      lines: [
        { speaker: 'Aud Brennock', text: 'Then it’ll find the other two of us, sooner or later. That’s all right. Somebody ought to be read.' },
        { speaker: 'Aud Brennock', text: 'Go on down. Don’t look back at me.' },
      ],
      choices: [{ text: '[Go.]' }],
    },
  ],
} as ProjectDoc['dialogues'][number];

export const LIBRARY_QUEST_DEF: ProjectDoc['quests'][number] = {
  id: LIBRARY_QUEST,
  name: 'The Drowned Library',
  summary: 'Below the Market is Vane’s first archive, flooded when the sea came up. The way further down opens only to a party carrying its own page.',
  objectives: [
    { id: 'reach-the-library', text: 'Go down the wet stair into the Library.', hidden: false, summary: 'You waded into the Drowned Library.' },
    { id: 'meet-the-kindlers', text: 'Find out who lit the fire on the reading platform.', hidden: false, summary: 'Aud Brennock, the last of the Kindlers, is burning what she can.' },
    { id: 'clear-the-stacks', text: 'Get through the Wet Stacks.', hidden: false, summary: 'The ink in the Stacks is only ink again.' },
    { id: 'the-index', text: 'Take your page from the Undertow Index.', hidden: false, summary: 'You hold your own page, in Vane’s hand.' },
    { id: 'read-your-page', text: 'Read your page at the sealed stair.', hidden: true, summary: 'You read how it ends. It does not end yet.' },
  ],
};
