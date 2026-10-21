/** The Ashwell: Level 3, the Drowned Library (`docs/ASHWELL.md`) - its rooms, its people, its quest. */

import { sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import type { Effect } from '../../engine/script/schema';
import { COUNTING_ID, READING_ID, STACKS_ID, INDEX_ID, LIBRARY_QUEST, AUD_DIALOGUE, KINDLING, YOUR_PAGE, INK_WRAITH_ID, INDEX_BOSS_ID, NAVE_ID, FURNACE_QUEST, sceneFromRows, passage, afterTheFight, kindsOf, type Furniture } from './ashwell-kit';

// ---------------------------------------------------------------------------------------------------------------
// Level 3: the Drowned Library
// ---------------------------------------------------------------------------------------------------------------

/**
 * Vane's first archive, flooded when the sea came up: shelves standing in black water, pages drifting. Three rooms.
 * The Reading Room, where nobody fights: the wet stair up to the Counting House, and the Kindlers' fire on a reading
 * platform raised out of the water, Aud Brennock feeding it pages. Down a passage, the Wet Stacks, where the
 * ink-wraiths are. Below them, the Index - the catalogue of everyone Vane has filed, which hunts by name - and past it
 * the stair down, which opens only to a party carrying its own page.
 */
const READING_ROWS = [
  '####################',
  '#....SSS~~~~~SSS~~~#',
  '#....~~~~~~~~~~~~~~#',
  '#....~~SS~~~~~~SS~~#',
  '#....~~SS~~~~~~SS~~#',
  '#~~~~~~~~~^^^^^^~~~#',
  '#~SS~~~~~/^^^^^^~~S#',
  '#~SS~~~~~~^^^^^^~~S#',
  '#~~~~~~~~~~~/~~~~~~#',
  '#~SS~~SS~~~~~~~~...#',
  '#~~~~~~~~~~~~~~~...#',
  '################..##',
  '####################',
];

/**
 * Rows of shelves, waist-deep, with a dry walk along the north wall and down the middle; the satchel up on a ledge in
 * the north-east corner, a step above the water.
 */
const STACKS_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#.........../^^#',
  '#.SSS~SS..SS~SS#',
  '#~~~~~~~..~~~~~#',
  '#.SSS~SS..SS~SS#',
  '#..............#',
  '#.SSS~SS..SS~SS#',
  '#~~~~~~~~~~~~..#',
  '#############..#',
  '#############..#',
  '################',
];

/** The Library's shelves, in the water and out of it, taller than a man. */
const LIBRARY_FURNITURE: Readonly<Record<string, Furniture>> = {
  S: { kind: 'shelf', shape: 'block', height: 1.5 },
};

/**
 * A round room with a moat of black water, and in its middle, on an island of stone reached by a short stair from the
 * south, the catalogue: a cabinet of a thousand small drawers, taller than a house.
 */
const INDEX_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#..............#',
  '#..~~~~~~~~~~..#',
  '#..~^^DDDD^^~..#',
  '#..~^^DDDD^^~..#',
  '#..~^^^^^^^^~..#',
  '#..~~~~//~~~~..#',
  '#..............#',
  '#######..#######',
  '#######..#######',
  '################',
];

const INDEX_FURNITURE: Readonly<Record<string, Furniture>> = {
  D: { kind: 'drawers', shape: 'block', height: 3 },
};

/** What the party's page says has happened since, read off the flags its own deeds in the Library set. */
const THE_ENTRY_SINCE: Effect[] = [
  { kind: 'branch', when: { kind: 'flag', flag: 'found-our-own' }, then: [{ kind: 'log', text: 'At the foot of the page, newer ink: "They found the name they gave the Broker, filed under their own, and read it back. It was not the one any of them thought. I had hoped they would not look."', tone: 'narration' }] },
  { kind: 'branch', when: { kind: 'flag', flag: 'freed-annicks-name' }, then: [{ kind: 'log', text: 'At the foot of the page, newer ink: "They tore Annick’s card out of my Index and carried it off in a shirt. Whatever he answers to now, it is not mine to write, nor the Guild’s."', tone: 'narration' }] },
  { kind: 'branch', when: { kind: 'flag', flag: 'burned-the-index' }, then: [{ kind: 'log', text: 'At the foot of the page, newer ink, shakier than the rest: "They burnt my Index. I felt every card go."', tone: 'narration' }] },
];

/**
 * The sealed stair down from the Index, which opens to a party carrying its own page: the first time, the page read
 * aloud - and what it says they did in the Library - and the end of Level 3, the quest done, a level gained, and the
 * way into Level 4, its quest begun; every time after, simply the way down to the Furnace.
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
          'It is about all of you. It is in Vane’s small square hand, and it is right about everything so far: the rope, the water, Annick, the name you paid the Broker. It goes on past today. It says how each of you dies. Each account stops mid-sentence, as if he had been called away.',
          'The paper parts. Below, the stair is warm and dry, and the air smells of hot iron, and somebody is singing.',
        ],
        button: 'Go down',
      },
      ...THE_ENTRY_SINCE,
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
    intro: 'The water stands knee-deep between the shelves, black and still, and pages turn slowly in it like leaves. On a reading platform in the middle of the room, up out of the water, somebody has lit a fire.',
    light: 0.3,
    ...sceneFromRows(READING_ROWS, kindsOf('library'), LIBRARY_FURNITURE),
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
      // A page to read for what it hides, against Aud's advice: a Kindler's note on the Index, or a line that notices.
      {
        id: 'drifting-page',
        model: 'banner-prop',
        position: { x: 6, y: 2 },
        rotation: 0.4,
        solid: true,
        function: {
          kind: 'trapped',
          trait: 'knowledge',
          difficulty: 13,
          success: {
            kind: 'script',
            object: 'scripted',
            name: 'A page, drifting',
            effects: [
              {
                kind: 'story',
                title: 'A page, drifting',
                paragraphs: [
                  'It is not Vane’s hand. On the back of one of his pages, in pencil, a Kindler has written small: "It reads by the light of what burns. It finds you by your name, and it finds your name by looking. Keep out of its lamps when you go in, and it has to squint." It is signed T.A.',
                ],
                button: 'Let it drift',
              },
              { kind: 'setFlag', flag: 'knows-the-index' },
            ],
          },
          failure: {
            kind: 'script',
            object: 'scripted',
            name: 'A page, drifting',
            effects: [
              { kind: 'markStress', amount: 1, target: { kind: 'actor' } },
              { kind: 'log', text: 'You read a line before you can stop yourself - your own name, in Vane’s hand - and the page sinks. Up on the platform, Aud does not look round. "I said not to."', tone: 'bad' },
            ],
          },
        },
      },
      { id: 'aud-brennock', model: 'traveling-bard', position: { x: 13, y: 6 }, rotation: -Math.PI / 2, solid: true, function: { kind: 'interaction', dialogue: AUD_DIALOGUE } },
      { id: 'kindlers-fire', model: 'camp-fire-prop', position: { x: 12, y: 5 }, rotation: 0, solid: true },
      { model: 'fungril-male', position: { x: 10, y: 7 }, rotation: 0.6 },
      { model: 'crate-prop', position: { x: 14, y: 7 }, rotation: 0.2 },
      { model: 'standing-torch-prop', position: { x: 10, y: 5 }, rotation: 0 },
      { model: 'wall-torch-prop', position: { x: 4, y: 1 }, rotation: 0 },
      passage('down-to-the-stacks', 'reading-stacks', { x: 16, y: 11 }, 0),
    ],
  });
}

export function stacks(): SceneDoc {
  return sceneSchema.parse({
    id: STACKS_ID,
    name: 'The Wet Stacks',
    intro: 'Rows of shelves, waist-high in water, their books swollen shut. The ink has run out of them and hangs in the water in threads. The threads are moving against the current.',
    light: 0.2,
    ...sceneFromRows(STACKS_ROWS, kindsOf('library'), LIBRARY_FURNITURE),
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
          name: 'A drowned reader’s satchel',
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
      // The second page to read: the Kindlers the Index filed, and Aud's own card, not finished.
      {
        id: 'kindlers-shelf',
        model: 'banner-prop',
        position: { x: 1, y: 8 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'scripted',
          name: 'The Kindlers’ shelf',
          flavor: 'Seven cards tacked along the end of a shelf, above the water, each in Vane’s small square hand. Aud said not to read anything.',
          repeatable: true,
          effects: afterTheFight(
            'the-stacks',
            [
              {
                kind: 'story',
                title: 'The Kindlers',
                paragraphs: [
                  'Corran Vey, who carried the oil. Tilda Ashe, who could read in the dark, and should not have. Bram and Wat Fenwick, brothers, filed together. Nell Cord, who went back for Bram. Old Pask, who gave no other name and did not need one.',
                  'The seventh card is Aud Brennock’s, and it is not finished. Its last line is still wet: "She will burn until the Index does, and then she will stop."',
                ],
                button: 'Look away',
              },
              { kind: 'markStress', amount: 1, target: { kind: 'actor' } },
              { kind: 'setFlag', flag: 'read-auds-entry' },
              { kind: 'log', text: 'Out in the water, something turns over slowly, as if it had heard its name. Whoever read the cards marks a Stress.', tone: 'bad' },
            ],
            'Not with the ink moving between you and it.',
          ),
        },
      },
      { model: 'standing-torch-prop', position: { x: 1, y: 3 }, rotation: 0 },
      { model: 'wall-torch-prop', position: { x: 14, y: 7 }, rotation: -Math.PI / 2 },
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

/** What the catalogue holds besides the party's page: what the party gave up above, filed. */
const WHAT_IT_HOLDS: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'gave-our-own' },
    then: [
      { kind: 'log', text: 'Behind your page is one card more, in the Broker’s square hand: the name you gave her, filed under your own. You read it aloud, all of you together, and it is somebody’s again. One of you laughs out loud, and none of you will say who.', tone: 'good' },
      { kind: 'clearStress', amount: 2, target: { kind: 'party' } },
      { kind: 'setFlag', flag: 'found-our-own' },
    ],
  },
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'gave-annicks-name' },
    then: [
      {
        kind: 'branch',
        when: { kind: 'flag', flag: 'annick-named-living' },
        then: [{ kind: 'log', text: 'Two drawers along: HOBART ANNICK, WELL-KEEPER. LIVING. Under it, in the Broker’s hand: Guild property. The card is warm.', tone: 'narration' }],
        otherwise: [{ kind: 'log', text: 'Two drawers along: HOBART ANNICK, WELL-KEEPER. Under it, in the Broker’s hand: Guild property, by sale.', tone: 'narration' }],
      },
    ],
  },
  { kind: 'branch', when: { kind: 'flag', flag: 'read-auds-entry' }, then: [{ kind: 'log', text: 'Aud’s drawer stands open too, and you know the last line on her card without reading it: she will burn until the Index does, and then she will stop.', tone: 'narration' }] },
];

export function index(): SceneDoc {
  return sceneSchema.parse({
    id: INDEX_ID,
    name: 'The Index',
    intro: 'A round room with a moat of black water, and on an island in its middle a cabinet of a thousand small drawers, taller than a house. As you come in, every drawer slides open an inch, and something inside each one says a name.',
    light: 0.26,
    ...sceneFromRows(INDEX_ROWS, kindsOf('library'), INDEX_FURNITURE),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
    ],
    decos: [
      passage('up-from-the-index', 'stacks-index', { x: 7, y: 1 }, Math.PI),
      {
        id: 'catalogue-drawers',
        model: 'chest-prop',
        position: { x: 10, y: 7 },
        rotation: Math.PI,
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
              ...WHAT_IT_HOLDS,
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
                  {
                    label: 'Tear out Annick’s card, and leave the rest.',
                    available: { kind: 'flag', flag: 'gave-annicks-name' },
                    effects: [
                      { kind: 'setFlag', flag: 'freed-annicks-name' },
                      { kind: 'log', text: 'The card comes out of its drawer with a sound like a breath let go. You fold it into a shirt. The rest of the drawers go on whispering, a little louder, as if they had noticed.', tone: 'good' },
                    ],
                  },
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
      { model: 'standing-torch-prop', position: { x: 1, y: 9 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 14, y: 9 }, rotation: 0 },
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
  features: [{ name: 'Pulled Under', kind: 'action', text: 'Spend a Shadow to make an attack against a creature within Very Close range. On a hit, the target takes the attack’s damage and is Restrained until they break free.', costsGmResource: true }],
} as AdversaryDef;

/**
 * The Undertow Index: the catalogue of everyone Vane has filed, which hunts by name. A tier-2 solo, and the level's
 * boss. At the party's first roll it begins to read their entry aloud - a looping countdown (3), every action roll
 * turning the page, and every time it comes round the next line read and every one of them rolling not to flinch at
 * their own names. It reads faster with a name of theirs already filed, and slower if they knew to keep from its lamps.
 */
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
  features: [{ name: 'Reads You Aloud', kind: 'reaction', text: 'Reaction: the first time a PC makes an action roll in the Index, it begins to read the party’s entry aloud - a Loop Countdown (3) that ticks down whenever a PC makes an action roll. Each time it triggers, it reads the next line, and every PC makes an Instinct Reaction Roll (14); those who fail mark a Stress. It ends when the Index falls.', costsGmResource: false }],
} as AdversaryDef;

const READS_TEXT = 'Reaction: the first time a PC makes an action roll in the Index, it begins to read the party’s entry aloud - a Loop Countdown (3) that ticks down whenever a PC makes an action roll. Each time it triggers, it reads the next line, and every PC makes an Instinct Reaction Roll (14); those who fail mark a Stress. It ends when the Index falls.';
const PULLED_TEXT = 'Spend a Shadow to make an attack against a creature within Very Close range. On a hit, the target takes the attack’s damage and is Restrained until they break free.';

/** The line of the party's entry the Index reads, the first time round: what they did to Annick. */
const FIRST_LINE: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'annick-spared' },
    then: [{ kind: 'log', text: 'The Index reads: "...and at the Sump they talked the keeper Annick down off his doors, and took his key out of his hand, and left him to wipe his gate."', tone: 'bad' }],
    otherwise: [{ kind: 'log', text: 'The Index reads: "...and at the Sump they put the keeper Annick down among his doors, and took his key out of his box."', tone: 'bad' }],
  },
];

/** The second time round: what they paid the Broker, the most particular first (as `WHAT_IT_COST` above). */
const SECOND_LINES: readonly (readonly [string, string])[] = [
  ['gave-grales-name', 'The Index reads: "...and paid the Broker with her own usher, and did not stay to watch him weighed."'],
  ['gave-ketchs-name', 'The Index reads: "...and paid the Broker with Margery Ketch, who has buried more of them than anyone."'],
  ['gave-our-own', 'The Index reads: "...and paid the Broker with one of their own, and do not know which, and I do." It says the name. None of you can hear it.'],
  ['annick-named-living', 'The Index reads: "...and paid the Broker with the keeper they had spared that morning."'],
  ['gave-annicks-name', 'The Index reads: "...and paid the Broker with a dead man, which is cheap, and clever."'],
  ['broker-fought', 'The Index reads: "...and took the Broker’s key off her people, over her."'],
];

function secondLine(rest: readonly (readonly [string, string])[]): Effect[] {
  const [first, ...others] = rest;
  if (first === undefined) return [{ kind: 'log', text: 'The Index reads: "...and came down the wet stair into my Library."', tone: 'bad' }];
  return [{ kind: 'branch', when: { kind: 'flag', flag: first[0] }, then: [{ kind: 'log', text: first[1], tone: 'bad' }], otherwise: secondLine(others) }];
}

/** Every time after: how they end, which it has not finished writing. */
const LAST_LINE: Effect = { kind: 'log', text: 'The Index reads how one of you dies. It stops mid-sentence, and starts on another of you, nearer.', tone: 'bad' };

/** The countdown the Index reads by: the next line of the party's entry each time round, and their own names in it. */
function readsAloud(start: string): Effect {
  return {
    kind: 'countdown',
    countdown: 'the-index-reads',
    name: 'The reading',
    start,
    advance: 'standard',
    loop: 'reset',
    onDeath: 'end',
    effects: [
      { kind: 'addVar', name: 'index-read', by: 1 },
      {
        kind: 'branch',
        when: { kind: 'var', name: 'index-read', op: '==', value: 1 },
        then: FIRST_LINE,
        otherwise: [{ kind: 'branch', when: { kind: 'var', name: 'index-read', op: '==', value: 2 }, then: secondLine(SECOND_LINES), otherwise: [LAST_LINE] }],
      },
      { kind: 'reactionRoll', difficulty: 14, trait: 'instinct', targets: { kind: 'party' }, onFail: [{ kind: 'markStress', amount: 1, target: { kind: 'hit' } }] },
    ],
  };
}

const KNOWS = { kind: 'flag', flag: 'knows-the-index' } as const;
const OURS = { kind: 'flag', flag: 'gave-our-own' } as const;

/** The features above that act, as the cards their stat blocks print, and what each does. */
export const LEVEL_THREE_CARDS: ProjectDoc['cards'] = [
  { id: 'wraith-pulled-under', name: 'Pulled Under', grant: { kind: 'adversary', adversaries: [INK_WRAITH_ID] }, text: PULLED_TEXT, features: [] },
  { id: 'index-reads-you-aloud', name: 'Reads You Aloud', grant: { kind: 'adversary', adversaries: [INDEX_BOSS_ID] }, text: READS_TEXT, features: [] },
] as ProjectDoc['cards'];

type Ability = ProjectDoc['abilities'][number];

export const LEVEL_THREE_ABILITIES: ProjectDoc['abilities'] = [
  {
    id: 'wraith-pulled-under',
    name: 'Pulled Under',
    source: { card: 'wraith-pulled-under' },
    text: PULLED_TEXT,
    cost: { bad: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        range: 'veryClose',
        onHit: [
          { kind: 'applyCondition', condition: 'restrained', target: { kind: 'hit' } },
          { kind: 'log', text: 'The ink wraps round and pulls down, into the water, where the reading is.', tone: 'bad' },
        ],
      },
    ],
  } as Ability,
  {
    id: 'index-reads-you-aloud',
    name: 'Reads You Aloud',
    source: { card: 'index-reads-you-aloud' },
    text: READS_TEXT,
    // As the Sexton's bell: a reaction to the party's first roll, which costs the GM nothing and waits for no spotlight.
    kind: 'reaction',
    trigger: 'partyRolled',
    cost: {},
    uses: { count: 1, per: 'scene' },
    target: { kind: 'self' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Every drawer in the Index slides open at once, and it begins to read aloud. It is reading about you.', tone: 'bad' },
      { kind: 'branch', when: OURS, then: [{ kind: 'log', text: 'It has one of your names already - the one you gave the Broker, filed - and it reads the faster for it.', tone: 'bad' }] },
      { kind: 'branch', when: KNOWS, then: [{ kind: 'log', text: 'You keep out of the lamplight, as the Kindler’s page said, and it has to squint to read you.', tone: 'good' }] },
      // Three, a step slower for those who knew to keep from its lamps, a step faster with a name of theirs filed.
      {
        kind: 'branch',
        when: KNOWS,
        then: [{ kind: 'branch', when: OURS, then: [readsAloud('3')], otherwise: [readsAloud('4')] }],
        otherwise: [{ kind: 'branch', when: OURS, then: [readsAloud('2')], otherwise: [readsAloud('3')] }],
      },
    ],
  } as Ability,
];

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
        { text: 'The Broker has one of our names.', available: { kind: 'all', of: [OURS, { kind: 'not', of: { kind: 'objectiveDone', quest: LIBRARY_QUEST, objective: 'the-index' } }] }, goto: 'filed' },
        { text: 'We read your card, in the Stacks.', available: { kind: 'all', of: [{ kind: 'flag', flag: 'read-auds-entry' }, { kind: 'not', of: { kind: 'flag', flag: 'told-aud' } }] }, goto: 'entry' },
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
    {
      id: 'filed',
      lines: [
        { speaker: 'Aud Brennock', text: 'Then it’s in the Index. Whatever’s given up down here ends up filed - that’s what the Guild sells it for.' },
        { speaker: 'Aud Brennock', text: 'Find your drawer, when the thing’s down. Read it back. A name read aloud by its own people is theirs again. That’s the one thing he can’t stop.' },
      ],
      choices: [{ text: '[Leave her to the fire.]' }],
    },
    {
      id: 'entry',
      lines: [
        { text: 'Aud feeds the fire a page before she answers.' },
        { speaker: 'Aud Brennock', text: 'I read it the first night, before I knew better. "She will burn until the Index does, and then she will stop."' },
        { speaker: 'Aud Brennock', text: 'It isn’t a threat. It’s the kindest thing he ever wrote. Don’t let it decide anything for you.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'told-aud' }],
      choices: [{ text: '[Leave her to the fire.]' }],
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
