/** The Ashwell: Level 2, the Ossuary Market (`docs/ASHWELL.md`) - its rooms, its people, its quest. */

import { sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import type { Effect } from '../../engine/script/schema';
import { GOLD } from '../demo-items';
import { SUMP_ID, MARKET_ID, PIT_ID, COUNTING_ID, MARKET_QUEST, GRALE_DIALOGUE, SELA_DIALOGUE, GUILD_MARK, BONE_KEY, GHOUL_ID, BROKER_ID, READING_ID, LIBRARY_QUEST, sceneFromRows, passage, afterTheFight, kindsOf } from './ashwell-kit';

// ---------------------------------------------------------------------------------------------------------------
// Level 2: the Ossuary Market
// ---------------------------------------------------------------------------------------------------------------

/**
 * A market cut into an old charnel pit, the Quiet Guild's: they trade in bones, teeth and names, and they are polite,
 * and they buy everything. Three rooms, a fight in each that has one. The Market itself, where nobody fights: the bone
 * stair up to the Sump, the Guild's stalls, Factor Osk Dunmere's counter, and Usher Grale at the door to the Counting
 * House. East, a passage down to the Charnel Pit, where the dead the Guild has not sold yet come up hungry. South,
 * behind the Guild's door, the Counting House, where the Bone-Broker Sela Marrow sells the way down for a name.
 */
const MARKET_ROWS = [
  '########################',
  '#...####################',
  '#...####################',
  '#......................#',
  '#..c..c..c.....c..c..c.#',
  '#......................#',
  '#......................#',
  '#..c..c..c.....c..c..c.#',
  '#......................#',
  '#......................#',
  '#..........,...........#',
  '#......................#',
  '##########.#########..##',
  '##########.#########..##',
  '########################',
];

const PIT_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#..............#',
  '#..,,,....,,,..#',
  '#..,~~~~~~~~,..#',
  '#..,~~~~~~~~,..#',
  '#..,,,....,,,..#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

const COUNTING_ROWS = [
  '##############',
  '######..######',
  '######..######',
  '#............#',
  '#..c......c..#',
  '#............#',
  '#............#',
  '#....cccc....#',
  '#............#',
  '#............#',
  '######.#######',
  '######.#######',
  '##############',
];

/**
 * The wet stair past the Bone Door: the first time, the end of Level 2 - Vane's page, the quest done, a level gained -
 * and the way into Level 3, its quest begun; every time after, simply the way down to the Library.
 */
const LIBRARY_STAIR: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'level-2-done' },
    then: [{ kind: 'goto', scene: READING_ID }],
    otherwise: [
      { kind: 'completeObjective', quest: MARKET_QUEST, objective: 'the-way-down' },
      {
        kind: 'story',
        title: 'Entry 4,120',
        paragraphs: [
          'The stair below the Bone Door is cut through older stone, and it is wet. Twenty steps down, the water begins: black and still, with pages drifting in it like slow fish. Somewhere below, something is reading aloud.',
          'A page is pinned above the waterline, dry. "They were offered the Broker\u2019s terms, and the Factor\u2019s prices, and Grale\u2019s little errand in the pit. They took the errand first. People always do; it feels like earning. I have let the Library down to the knee for them. Mind the shelves. Mind what you read."',
        ],
        button: 'Wade in',
      },
      { kind: 'completeQuest', quest: MARKET_QUEST },
      { kind: 'levelUp' },
      { kind: 'setFlag', flag: 'level-2-done' },
      { kind: 'startQuest', quest: LIBRARY_QUEST },
      { kind: 'completeObjective', quest: LIBRARY_QUEST, objective: 'reach-the-library' },
      { kind: 'goto', scene: READING_ID },
    ],
  },
];

export function market(): SceneDoc {
  return sceneSchema.parse({
    id: MARKET_ID,
    name: 'The Ossuary Market',
    intro: 'Lamps of yellow fat burn along stalls of stacked bone. People in grey aprons weigh teeth on little brass scales and write in ledgers, and nobody raises their voice. Somewhere a bell hangs silent on a rope.',
    ...sceneFromRows(MARKET_ROWS, kindsOf('market')),
    spawns: [
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
      { x: 2, y: 2 },
    ],
    decos: [
      {
        id: 'bone-stair-up',
        model: 'stone-stairs',
        position: { x: 2, y: 1 },
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'portal', name: 'The bone stair', flavor: 'Up, through the Bone Door, to the Sump.', repeatable: true, effects: [{ kind: 'goto', scene: SUMP_ID }] },
      },
      {
        id: 'second-page',
        model: 'banner-prop',
        position: { x: 6, y: 3 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'scripted',
          name: 'A page, pinned to a stall',
          flavor: 'Somebody has pinned a page to the first stall with a finger bone. The stallholder has not touched it.',
          effects: [
            {
              kind: 'story',
              title: 'Entry 4,118',
              paragraphs: [
                '"The Factor will offer them a fair price for anything, and an unfair one for what they need. Usher Grale will offer them work. The Broker will offer them the way down, and name her price, and it will not be gold."',
                '"They will try to find a third way. There is always a third way. It is usually worse."',
              ],
              button: 'Leave it pinned',
            },
          ],
        },
      },
      {
        id: 'factor-dunmere',
        model: 'merchant',
        position: { x: 12, y: 5 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'shop',
          shop: {
            currency: GOLD,
            buysAt: 40,
            stock: [
              { item: 'consumable-minor-health-potion', price: 12 },
              { item: 'consumable-minor-stamina-potion', price: 12 },
              { item: 'armor-chainmail-armor', price: 60, count: 1 },
              { item: 'secondary-round-shield', price: 25, count: 1 },
            ],
          },
        },
      },
      { id: 'usher-grale', model: 'wandering-hedge-priest', position: { x: 9, y: 11 }, rotation: Math.PI, solid: true, function: { kind: 'interaction', dialogue: GRALE_DIALOGUE } },
      {
        id: 'guild-door',
        model: 'door-prop',
        position: { x: 10, y: 12 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'door',
          name: 'The Guild’s door',
          flavor: 'A door of fitted shoulder blades, polished by hands. The Counting House is behind it.',
          requiresKey: GUILD_MARK,
          lockedText: 'Usher Grale clears his throat. "The Counting House is for those the Guild has marked, friend."',
          effects: [{ kind: 'log', text: 'Grale’s mark is enough. The door swings in without a sound.', tone: 'good' }, { kind: 'remove' }],
        },
      },
      passage('down-to-the-counting-house', 'market-counting', { x: 10, y: 13 }, 0),
      passage('down-to-the-pit', 'market-pit', { x: 20, y: 13 }, 0),
      { model: 'cart-prop', position: { x: 17, y: 9 }, rotation: 0.4 },
      { model: 'crate-prop', position: { x: 20, y: 5 }, rotation: 0.2 },
      { model: 'barrel-prop', position: { x: 21, y: 6 }, rotation: 0 },
      { model: 'crate-prop', position: { x: 4, y: 9 }, rotation: -0.4 },
      { model: 'pillar-prop', position: { x: 13, y: 8 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 8, y: 6 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 16, y: 6 }, rotation: 0 },
      { model: 'banner-prop', position: { x: 22, y: 3 }, rotation: 0 },
    ],
  });
}

export function pit(): SceneDoc {
  return sceneSchema.parse({
    id: PIT_ID,
    name: 'The Charnel Pit',
    intro: 'The old burial pit under the market. Bones are heaped against the walls in drifts, and a pool of black water fills the middle. A bell-rope hangs down from a hole in the ceiling. The heaps are moving.',
    ...sceneFromRows(PIT_ROWS, kindsOf('market')),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
    ],
    decos: [
      passage('up-from-the-pit', 'market-pit', { x: 7, y: 1 }, Math.PI),
      {
        id: 'bell-rope',
        model: 'banner-prop',
        position: { x: 13, y: 9 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'scripted',
          name: 'The bell-rope',
          flavor: 'A rope of braided hair, running up through the ceiling to the market bell. Every time it rings, they come up.',
          repeatable: true,
          effects: afterTheFight(
            'the-pit',
            [
              { kind: 'setFlag', flag: 'pit-cleared' },
              { kind: 'completeObjective', quest: MARKET_QUEST, objective: 'clear-the-pit' },
              { kind: 'log', text: 'You cut the rope high, where nobody will reach to tie it again. Upstairs, the bell is a bell.', tone: 'good' },
            ],
            'You will not get near the rope with the dead between you and it.',
          ),
        },
      },
      { model: 'rock-prop', position: { x: 2, y: 9 }, rotation: 0.3 },
      { model: 'rock-prop', position: { x: 14, y: 3 }, rotation: 1.4 },
      { model: 'withering-tree-prop', position: { x: 1, y: 3 }, rotation: 2.2 },
    ],
    encounters: [
      {
        id: 'the-pit',
        name: 'The Charnel Pit',
        triggerCells: [7, 8].map((x) => ({ x, y: 3 })),
        adversaries: [
          { id: 'pit-ghoul-1', adversary: GHOUL_ID, name: 'Pit Ghoul', model: 'fen-lurker', position: { x: 4, y: 8 } },
          { id: 'pit-ghoul-2', adversary: GHOUL_ID, name: 'Pit Ghoul', model: 'fen-lurker', position: { x: 11, y: 8 } },
          { id: 'pit-ghoul-3', adversary: GHOUL_ID, name: 'Pit Ghoul', model: 'fen-lurker', position: { x: 13, y: 5 } },
          { id: 'bone-rats', adversary: 'rot-hound', name: 'Bone-Rats', position: { x: 2, y: 5 } },
        ],
      },
    ],
  });
}

/** Sela Marrow and her people: whoever turns, all of them do. */
const BROKERS = ['sela-marrow', 'guild-bonecutter-1', 'guild-bonecutter-2', 'guild-tallyman'];

export function countingHouse(): SceneDoc {
  // They start out on nobody's side, and talk: Sela's dialogue, whoever is spoken to.
  const talks = { kind: 'friendly', dialogue: SELA_DIALOGUE } as const;
  return sceneSchema.parse({
    id: COUNTING_ID,
    name: 'The Counting House',
    intro: 'A long, warm room of ledgers. A woman with bone rings on every finger sits behind a desk of stacked jawbones, writing. She does not look up. "Sit, if you like. Stand, if you are not staying."',
    ...sceneFromRows(COUNTING_ROWS, kindsOf('market')),
    spawns: [
      { x: 7, y: 1 },
      { x: 7, y: 2 },
    ],
    decos: [
      passage('up-from-the-counting-house', 'market-counting', { x: 6, y: 1 }, Math.PI),
      {
        id: 'brokers-ledger-box',
        model: 'chest-prop',
        position: { x: 12, y: 9 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'chest',
          name: 'The Broker’s ledger-box',
          flavor: 'An iron box of contracts, sealed with wax and teeth.',
          repeatable: true,
          effects: [
            {
              kind: 'branch',
              when: { kind: 'flag', flag: 'broker-fought' },
              then: afterTheFight(
                'the-broker',
                [
                  { kind: 'giveKey', key: BONE_KEY },
                  { kind: 'completeObjective', quest: MARKET_QUEST, objective: 'the-broker' },
                  { kind: 'revealObjective', quest: MARKET_QUEST, objective: 'the-way-down' },
                  { kind: 'loot', table: 'brokers-box' },
                  { kind: 'log', text: 'Among the contracts is a key carved from a single long bone: the Bone Door’s.', tone: 'good' },
                ],
                'Sela Marrow’s people stand between you and her box.',
              ),
              otherwise: [{ kind: 'log', text: 'A Guild clerk looks at your hand on the box until you take it off.', tone: 'bad' }],
            },
          ],
        },
      },
      {
        id: 'bone-door',
        model: 'door-prop',
        position: { x: 6, y: 10 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'door',
          name: 'The Bone Door',
          flavor: 'A narrow door of yellowed bone with a keyhole like a marrow canal. Wet air comes under it.',
          requiresKey: BONE_KEY,
          lockedText: 'It does not move. The Broker has the key, and the Broker sells things.',
          effects: [{ kind: 'log', text: 'The bone key turns smooth as a joint. The door opens on a stair going down into the wet.', tone: 'good' }, { kind: 'remove' }],
        },
      },
      {
        id: 'library-stair',
        model: 'stone-stairs',
        position: { x: 6, y: 11 },
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'portal', name: 'The wet stair', flavor: 'Down, into water and the sound of reading.', repeatable: true, effects: LIBRARY_STAIR },
      },
      { model: 'standing-torch-prop', position: { x: 1, y: 3 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 12, y: 3 }, rotation: 0 },
      { model: 'crate-prop', position: { x: 1, y: 9 }, rotation: 0.1 },
      { model: 'barrel-prop', position: { x: 12, y: 6 }, rotation: 0 },
    ],
    encounters: [
      {
        id: 'the-broker',
        name: 'The Bone-Broker',
        // Begun by her answer, not by a step: a fight here is one the party chose.
        startsOnTrigger: false,
        adversaries: [
          { id: 'sela-marrow', adversary: BROKER_ID, name: 'Sela Marrow, the Bone-Broker', model: 'faerie-female', position: { x: 7, y: 8 }, interaction: talks },
          { id: 'guild-bonecutter-1', adversary: 'bandit-cutter', name: 'Guild Bonecutter', position: { x: 4, y: 8 }, interaction: talks },
          { id: 'guild-bonecutter-2', adversary: 'bandit-cutter', name: 'Guild Bonecutter', position: { x: 10, y: 8 }, interaction: talks },
          { id: 'guild-tallyman', adversary: 'bandit-archer', name: 'Guild Tallyman', position: { x: 7, y: 9 }, interaction: talks },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Its people
// ---------------------------------------------------------------------------------------------------------------

/** The dead the Guild has not sold yet, come up from the pit when the bell rings: a tier-2 standard. */
export const PIT_GHOUL: AdversaryDef = {
  id: GHOUL_ID,
  name: 'Pit Ghoul',
  tier: 2,
  role: 'standard',
  description: 'Grey, wet, long in the arm. It wears what it was buried in, and it is still hungry.',
  motivesAndTactics: 'Come up when the bell rings. Drag the nearest down into the bone heaps. Eat.',
  difficulty: 14,
  thresholds: { major: 8, severe: 16 },
  hitPoints: 5,
  stress: 3,
  attackName: 'Grave Claws',
  attackModifier: { count: 0, sides: 0, modifier: 2 },
  attackRange: 'melee',
  attackDamage: { count: 1, sides: 10, modifier: 1, types: ['physical'] },
  experiences: [],
  features: [],
} as AdversaryDef;

/** Sela Marrow, the Bone-Broker: the Quiet Guild's seller of ways down, and the level's boss if it comes to that. */
export const BONE_BROKER: AdversaryDef = {
  id: BROKER_ID,
  name: 'Bone-Broker',
  tier: 2,
  role: 'leader',
  description: 'A narrow woman with bone rings on every finger and ink on every knuckle. She writes while she fights.',
  motivesAndTactics: 'Keep the books. Let the Bonecutters close in. Hook the one who insulted her and drag them to the desk.',
  difficulty: 15,
  thresholds: { major: 10, severe: 20 },
  hitPoints: 7,
  stress: 5,
  attackName: 'Bone Hook',
  attackModifier: { count: 0, sides: 0, modifier: 3 },
  attackRange: 'veryClose',
  attackDamage: { count: 1, sides: 12, modifier: 2, types: ['physical'] },
  experiences: [{ name: 'Knows what everything is worth', modifier: 3 }],
  features: [],
} as AdversaryDef;

export const GRALE: ProjectDoc['dialogues'][number] = {
  id: GRALE_DIALOGUE,
  start: 'greet',
  nodes: [
    {
      id: 'greet',
      lines: [
        { text: 'A soft old man in a grey apron, standing by a door of fitted shoulder blades. He bows.' },
        { speaker: 'Usher Grale', text: 'Welcome to the Market, friends. Keep your voices down, if you would. The dead are sleeping, and the living are counting.' },
      ],
      choices: [
        { text: 'What is this place?', goto: 'market' },
        { text: 'We want to go further down.', goto: 'down', available: { kind: 'not', of: { kind: 'objectiveDone', quest: MARKET_QUEST, objective: 'speak-to-the-guild' } } },
        { text: 'The rope is cut. The bell will not ring again.', available: { kind: 'all', of: [{ kind: 'flag', flag: 'pit-cleared' }, { kind: 'not', of: { kind: 'hasKey', key: GUILD_MARK } }] }, goto: 'mark' },
        { text: '[Leave him to his door.]' },
      ],
    },
    {
      id: 'market',
      lines: [
        { speaker: 'Usher Grale', text: 'The Quiet Guild buys what comes down the well, and sells it back up, in a manner of speaking. Bone meal for the marsh farms. Teeth for the dice-makers. Names, for those who want them.' },
        { speaker: 'Usher Grale', text: 'We are not cruel, friends. We are thrifty. Nothing down here goes to waste, and nobody here goes hungry. Except the pit.' },
      ],
      choices: [
        { text: 'We want to go further down.', goto: 'down', available: { kind: 'not', of: { kind: 'objectiveDone', quest: MARKET_QUEST, objective: 'speak-to-the-guild' } } },
        { text: '[Leave him to his door.]' },
      ],
    },
    {
      id: 'down',
      lines: [
        { speaker: 'Usher Grale', text: 'The way down is the Broker’s to sell. The Broker sees only those the Guild has marked, and the Guild marks only the useful.' },
        { speaker: 'Usher Grale', text: 'Here is something useful. The market bell rings when it likes, and every time it rings, the pit gives up its dead, and they come up hungry. Go down and cut its rope, and I will mark you myself.' },
      ],
      onEnter: [{ kind: 'completeObjective', quest: MARKET_QUEST, objective: 'speak-to-the-guild' }],
      choices: [{ text: '[Go to the pit.]' }],
    },
    {
      id: 'mark',
      lines: [
        { text: 'Grale takes the nearest hand and presses his thumb into the back of it, wet with something grey. It leaves a print that does not wash off.' },
        { speaker: 'Usher Grale', text: 'The Broker will see you now. Do not haggle. She enjoys it.' },
      ],
      onEnter: [{ kind: 'giveKey', key: GUILD_MARK }],
      choices: [{ text: '[Go to the door.]' }],
    },
  ],
} as ProjectDoc['dialogues'][number];

/** Whether the Broker has been dealt with, either way. */
const DEALT = { kind: 'any', of: [{ kind: 'flag', flag: 'broker-dealt' }, { kind: 'flag', flag: 'broker-fought' }] } as const;
/** What paying her does, whatever was paid. */
const PAID: Effect[] = [
  { kind: 'setFlag', flag: 'broker-dealt' },
  { kind: 'giveKey', key: BONE_KEY },
  { kind: 'completeObjective', quest: MARKET_QUEST, objective: 'the-broker' },
  { kind: 'revealObjective', quest: MARKET_QUEST, objective: 'the-way-down' },
];

export const SELA: ProjectDoc['dialogues'][number] = {
  id: SELA_DIALOGUE,
  start: 'terms',
  nodes: [
    {
      id: 'terms',
      lines: [
        { speaker: 'Sela Marrow', text: 'You want the Bone Door. Everybody who gets this far wants the Bone Door.' },
        { speaker: 'Sela Marrow', text: 'The price is a name. Not a word. A name, given up. Whoever it belonged to, the Guild owns it after, and what the Guild owns it keeps.' },
      ],
      choices: [
        { text: 'Take Mother Ketch’s name.', available: { kind: 'not', of: DEALT }, goto: 'ketch' },
        { text: 'Take one of ours.', available: { kind: 'not', of: DEALT }, goto: 'ours' },
        { text: 'Hob Annick is dead. Take his.', detail: 'Presence 14', available: { kind: 'not', of: DEALT }, check: { trait: 'presence', difficulty: 14, gotoOnSuccess: 'annick', gotoOnFailure: 'insulted' } },
        { text: 'We will take the key instead.', available: { kind: 'not', of: DEALT }, goto: 'fight' },
        { text: '[Nod, and go.]' },
      ],
    },
    {
      id: 'ketch',
      lines: [
        { text: 'Sela dips her pen and writes, in a small square hand: Margery Ketch. She blots it.' },
        { speaker: 'Sela Marrow', text: 'The woman at the Lantern. She has buried a great many of ours. Thank you.' },
        { text: 'She takes a key carved from a single long bone out of a drawer and lays it on the desk.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'gave-ketchs-name' }, ...PAID],
      choices: [{ text: '[Take the key.]' }],
    },
    {
      id: 'ours',
      lines: [
        { text: 'Sela turns the ledger round and holds out the pen. One of you takes it and writes a name. Afterwards, none of you can say whose it was, and all of you feel the gap where it went.' },
        { speaker: 'Sela Marrow', text: 'There. That did not hurt. It will.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'gave-our-own' }, { kind: 'markStress', amount: 2, target: { kind: 'party' } }, ...PAID],
      choices: [{ text: '[Take the key.]' }],
    },
    {
      id: 'annick',
      lines: [
        { text: 'Sela looks up for the first time. Then she laughs, once, and writes: Hobart Annick, well-keeper.' },
        { speaker: 'Sela Marrow', text: 'He was never going to use it again, was he. Cheap, but clever. I like clever.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'gave-annicks-name' }, ...PAID],
      choices: [{ text: '[Take the key.]' }],
    },
    {
      id: 'insulted',
      lines: [
        { speaker: 'Sela Marrow', text: 'The dead are cheap, and you thought I would not know it. That is the only insult I do not forgive twice.' },
      ],
      choices: [
        { text: 'Then take one of ours.', goto: 'ours' },
        { text: 'Then we take the key.', goto: 'fight' },
      ],
    },
    {
      id: 'fight',
      lines: [
        { text: 'Sela closes the ledger gently, as if a child were asleep in it.' },
        { speaker: 'Sela Marrow', text: 'Then I will write you down myself.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'broker-fought' }, { kind: 'setAttitude', attitude: 'hostile', target: { kind: 'entities', ids: [...BROKERS] } }],
      choices: [{ text: '[Draw steel.]' }],
    },
  ],
} as ProjectDoc['dialogues'][number];

export const MARKET_QUEST_DEF: ProjectDoc['quests'][number] = {
  id: MARKET_QUEST,
  name: 'The Ossuary Market',
  summary: 'Below the Sump is a market of bones, where the Quiet Guild buys and sells the dead. The way further down is the Bone-Broker’s to sell.',
  objectives: [
    { id: 'reach-the-market', text: 'Go down through the bone door into the Market.', hidden: false, summary: 'You came down into the Ossuary Market.' },
    { id: 'speak-to-the-guild', text: 'Find out who sells the way down.', hidden: false, summary: 'Usher Grale wants the pit’s bell-rope cut before the Guild will mark you.' },
    { id: 'clear-the-pit', text: 'Cut the bell-rope in the Charnel Pit.', hidden: false, summary: 'The bell is only a bell now.' },
    { id: 'the-broker', text: 'Get the Bone Door’s key from Sela Marrow, the Bone-Broker.', hidden: false, summary: 'The Broker’s key is yours, and you know what it cost.' },
    { id: 'the-way-down', text: 'Open the Bone Door and take the stair down.', hidden: true, summary: 'Below the Market, the stair goes down into water.' },
  ],
};
