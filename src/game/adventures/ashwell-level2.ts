/** The Ashwell: Level 2, the Ossuary Market (`docs/ASHWELL.md`) - its rooms, its people, its quest. */

import { sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import type { Effect } from '../../engine/script/schema';
import { GOLD } from '../demo-items';
import { SUMP_ID, MARKET_ID, PIT_ID, COUNTING_ID, MARKET_QUEST, GRALE_DIALOGUE, SELA_DIALOGUE, GUILD_MARK, BONE_KEY, GHOUL_ID, BROKER_ID, READING_ID, LIBRARY_QUEST, sceneFromRows, passage, afterTheFight, kindsOf, type Furniture } from './ashwell-kit';
import { KEEPERS_TOKEN, TAMS_RING } from './ashwell-level1';

/** What Level 2 adds: the Sexton who rings the bell, the dead it calls, the clerk who buys keepsakes. */
export const SEXTON_ID = 'pit-sexton';
export const BELL_CALLED_ID = 'bell-called';
export const SEXTON_DIALOGUE = 'sexton-mott';
export const CLERK_DIALOGUE = 'clerk-wenna';

// ---------------------------------------------------------------------------------------------------------------
// Level 2: the Ossuary Market
// ---------------------------------------------------------------------------------------------------------------

/**
 * A market cut into an old charnel pit, the Quiet Guild's: they trade in bones, teeth and names, and they are polite,
 * and they buy everything. Three rooms, a fight in each that has one. The Market itself, where nobody fights: the bone
 * stair up to the Sump, aisles of stalls under walls of stacked bone, the bell over the pit's mouth in the middle,
 * Factor Osk Dunmere's counter up on its dais, a clerk who buys keepsakes, and Usher Grale at the door to the Counting
 * House. South-east, a passage down to the Charnel Pit, where the dead the Guild has not sold yet come up hungry. South,
 * behind the Guild's door, the Counting House, where the Bone-Broker Sela Marrow sells the way down for a name.
 */
const MARKET_ROWS = [
  '##########################',
  '#...OOOOO.....OOOOO......#',
  '#........................#',
  '#..KKK..KKK......^^^^^^..#',
  '#................^^^^^^..#',
  '#..KKK..KKK......^^^^^^..#',
  '#..................//....#',
  '#.........c.cc...........#',
  '#.........c~~c...........#',
  '#.........c~~c...........#',
  '#.........cccc...........#',
  '#..KKK..KKK......KKK.....#',
  '#........................#',
  '#OO......................#',
  '##########.##########..###',
  '##########.##########..###',
  '##########################',
];

/** The market's furniture: stalls of planks, and the walls of stacked bone the Guild has not sold yet. */
const MARKET_FURNITURE: Readonly<Record<string, Furniture>> = {
  K: { kind: 'counter', shape: 'block', height: 0.75 },
  O: { kind: 'bones', shape: 'block', height: 1.25 },
};

/**
 * The burial pit under the market: drifts of bone heaped up the walls, a pool of black water in the middle, and in the
 * south-east a ledge where the bell-rope comes down through the ceiling - and the Sexton who pulls it - up a step.
 */
const PIT_ROWS = [
  '##################',
  '########..########',
  '########..########',
  '#OO,..........,OO#',
  '#O,....,,,,....,O#',
  '#,...~~~~~~~...,.#',
  '#....~~~~~~~.....#',
  '#,...~~~~~~~.....#',
  '#O,.....,,.......#',
  '#OO,.............#',
  '#O,..........^^^^#',
  '#,.........,/^^^^#',
  '#OO,,.......,^^^^#',
  '##################',
];

/** The drifts of bone up the pit's walls, higher than a man in the corners. */
const PIT_FURNITURE: Readonly<Record<string, Furniture>> = {
  O: { kind: 'bones', shape: 'block', height: 1 },
};

/**
 * A long, warm room of ledgers: shelves of them along the walls, the Broker's desk of jawbones before a dais she sits
 * on, steps at each end of it, and the Bone Door in the south wall.
 */
const COUNTING_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#SSSS......SSSS#',
  '#..............#',
  '#....^^^^^^....#',
  '#.../^^^^^^/...#',
  '#.....KKKK.....#',
  '#..............#',
  '#SS..........SS#',
  '#..............#',
  '#######.########',
  '#######.########',
  '################',
];

const COUNTING_FURNITURE: Readonly<Record<string, Furniture>> = {
  S: { kind: 'shelf', shape: 'wall', height: 1.75 },
  K: { kind: 'bones', shape: 'block', height: 0.75 },
};

/** What Vane's page below the Bone Door says the key cost: whose name went into the ledger, or that none did. */
const WHAT_IT_COST: readonly (readonly [string, string])[] = [
  ['gave-grales-name', 'Under it, newer ink: "They sold the Broker her own usher. Grale will be weighed by noon. I did not see that coming, and I see most things. I have given them a line of their own for it."'],
  ['gave-ketchs-name', 'Under it, newer ink: "They gave the Broker Margery Ketch’s name. She will not miss it for a week, and then she will miss it every day, and not know what it is she misses."'],
  ['gave-our-own', 'Under it, newer ink: "They gave the Broker one of their own. Each of them has been wondering, since, whether it was theirs. It was not the one they think."'],
  ['annick-named-living', 'Under it, newer ink: "They gave the Broker the name of a man they spared that morning. He is wiping his gate as I write, and he cannot think what he is called. Mercy, it seems, gives change."'],
  ['gave-annicks-name', 'Under it, newer ink: "They gave the Broker a dead man’s name and she took it. Clever. I have marked them down as clever, which is not the same thing as wise."'],
  ['broker-fought', 'Under it, newer ink: "They took the key off the Broker’s people, over the Broker. The Guild does not forget a debt. It does not know how."'],
];

/** The page's last word, read off the first of `WHAT_IT_COST` the party has earned. */
function whatItCost(rest: readonly (readonly [string, string])[]): Effect[] {
  const [first, ...others] = rest;
  if (first === undefined) return [];
  return [{ kind: 'branch', when: { kind: 'flag', flag: first[0] }, then: [{ kind: 'log', text: first[1], tone: 'narration' }], otherwise: whatItCost(others) }];
}

/**
 * The wet stair past the Bone Door: the first time, the end of Level 2 - Vane's page, and what he says the key cost,
 * the quest done, a level gained - and the way into Level 3, its quest begun; every time after, simply the way down to
 * the Library.
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
          'A page is pinned above the waterline, dry. "They were offered the Broker’s terms, and the Factor’s prices, and Grale’s little errand in the pit. They took the errand first. People always do; it feels like earning. I have let the Library down to the knee for them. Mind the shelves. Mind what you read."',
        ],
        button: 'Wade in',
      },
      ...whatItCost(WHAT_IT_COST),
      { kind: 'completeQuest', quest: MARKET_QUEST },
      { kind: 'levelUp' },
      { kind: 'setFlag', flag: 'level-2-done' },
      { kind: 'startQuest', quest: LIBRARY_QUEST },
      { kind: 'completeObjective', quest: LIBRARY_QUEST, objective: 'reach-the-library' },
      { kind: 'goto', scene: READING_ID },
    ],
  },
];

/** The market bell, over the pit's mouth: silent, or a bell and no more once its rope is cut. */
const BELL: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'pit-cleared' },
    then: [{ kind: 'log', text: 'The bell hangs still over the pit’s mouth, its rope cut short. A clerk going past touches it for luck, out of habit, and looks disappointed.', tone: 'narration' }],
    otherwise: [{ kind: 'log', text: 'A bronze bell in a frame of thighbones, over a hole in the floor that goes down into the dark. Its rope runs down the hole. Nobody stands near it, and nobody looks at it.', tone: 'narration' }],
  },
];

export function market(): SceneDoc {
  return sceneSchema.parse({
    id: MARKET_ID,
    name: 'The Ossuary Market',
    intro: 'Lamps of yellow fat burn along stalls under walls of stacked bone. People in grey aprons weigh teeth on little brass scales and write in ledgers, and nobody raises their voice. In the middle of it all, a bell hangs silent over a hole in the floor.',
    light: 0.42,
    ...sceneFromRows(MARKET_ROWS, kindsOf('market'), MARKET_FURNITURE),
    spawns: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
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
        position: { x: 6, y: 2 },
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
        position: { x: 19, y: 4 },
        rotation: Math.PI,
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
      { id: 'the-market-bell', model: 'pillar-prop', position: { x: 11, y: 7 }, rotation: 0, solid: true, function: { kind: 'script', object: 'scripted', name: 'The market bell', flavor: 'A bronze bell in a frame of thighbones, over the pit’s mouth.', repeatable: true, effects: BELL } },
      { id: 'clerk-wenna', model: 'traveling-bard', position: { x: 18, y: 12 }, rotation: Math.PI, solid: true, function: { kind: 'interaction', dialogue: CLERK_DIALOGUE } },
      { id: 'usher-grale', model: 'wandering-hedge-priest', position: { x: 9, y: 13 }, rotation: Math.PI, solid: true, function: { kind: 'interaction', dialogue: GRALE_DIALOGUE } },
      {
        id: 'guild-door',
        model: 'door-prop',
        position: { x: 10, y: 14 },
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
      passage('down-to-the-counting-house', 'market-counting', { x: 10, y: 15 }, 0),
      passage('down-to-the-pit', 'market-pit', { x: 21, y: 15 }, 0),
      { model: 'standing-torch-prop', position: { x: 8, y: 7 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 15, y: 10 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 23, y: 3 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 2, y: 12 }, rotation: 0 },
      { model: 'wall-torch-prop', position: { x: 12, y: 1 }, rotation: 0 },
      { model: 'wall-torch-prop', position: { x: 24, y: 13 }, rotation: -Math.PI / 2 },
      { model: 'cart-prop', position: { x: 22, y: 9 }, rotation: 0.4 },
      { model: 'crate-prop', position: { x: 23, y: 6 }, rotation: 0.2 },
      { model: 'barrel-prop', position: { x: 24, y: 7 }, rotation: 0 },
      { model: 'crate-prop', position: { x: 4, y: 9 }, rotation: -0.4 },
      { model: 'barrel-prop', position: { x: 5, y: 9 }, rotation: 0 },
      { model: 'banner-prop', position: { x: 22, y: 2 }, rotation: 0 },
    ],
  });
}

export function pit(): SceneDoc {
  return sceneSchema.parse({
    id: PIT_ID,
    name: 'The Charnel Pit',
    intro: 'The old burial pit under the market. Bones are heaped up the walls in drifts, and a pool of black water fills the middle. On a ledge in the far corner a man in a grey apron has both hands on a rope that runs up through the ceiling. The heaps are moving.',
    light: 0.24,
    ...sceneFromRows(PIT_ROWS, kindsOf('market'), PIT_FURNITURE),
    spawns: [
      { x: 9, y: 1 },
      { x: 8, y: 2 },
      { x: 9, y: 2 },
    ],
    decos: [
      passage('up-from-the-pit', 'market-pit', { x: 8, y: 1 }, Math.PI),
      {
        id: 'bell-rope',
        model: 'banner-prop',
        position: { x: 16, y: 11 },
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
              { kind: 'setFlag', flag: 'knows-the-bell' },
              { kind: 'completeObjective', quest: MARKET_QUEST, objective: 'clear-the-pit' },
              { kind: 'log', text: 'You cut the rope high, where nobody will reach to tie it again. Upstairs, the bell is a bell.', tone: 'good' },
              { kind: 'log', text: 'Knotted into the rope at the height of a man’s hands is a strip of Guild paper, many times folded: ONE RINGING - ONE TOOTH - A.G. It is stamped with the Usher’s seal.', tone: 'narration' },
            ],
            'You will not get near the rope with the dead between you and it.',
          ),
        },
      },
      { model: 'rock-prop', position: { x: 3, y: 10 }, rotation: 0.3 },
      { model: 'rock-prop', position: { x: 14, y: 3 }, rotation: 1.4 },
      { model: 'withering-tree-prop', position: { x: 1, y: 6 }, rotation: 2.2 },
      { model: 'standing-torch-prop', position: { x: 14, y: 12 }, rotation: 0 },
      { model: 'wall-torch-prop', position: { x: 7, y: 3 }, rotation: 0 },
    ],
    encounters: [
      {
        id: 'the-pit',
        name: 'The Charnel Pit',
        triggerCells: [8, 9].flatMap((x) => [3, 4].map((y) => ({ x, y }))),
        adversaries: [
          { id: 'pit-ghoul-1', adversary: GHOUL_ID, name: 'Pit Ghoul', model: 'fen-lurker', position: { x: 4, y: 8 } },
          { id: 'pit-ghoul-2', adversary: GHOUL_ID, name: 'Pit Ghoul', model: 'fen-lurker', position: { x: 12, y: 4 } },
          { id: 'bone-rats', adversary: 'rot-hound', name: 'Bone-Rats', position: { x: 2, y: 5 } },
          { id: 'sexton-mott', adversary: SEXTON_ID, name: 'Sexton Mott', model: 'wandering-hedge-priest', position: { x: 14, y: 11 }, interaction: { kind: 'threshold', dialogue: SEXTON_DIALOGUE, percent: 50 } },
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
    intro: 'A long, warm room of ledgers, shelved to the ceiling. Up on a dais behind a desk of stacked jawbones, a woman with bone rings on every finger sits writing. She does not look up. "Sit, if you like. Stand, if you are not staying."',
    light: 0.55,
    ...sceneFromRows(COUNTING_ROWS, kindsOf('market'), COUNTING_FURNITURE),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
      { x: 7, y: 2 },
    ],
    decos: [
      passage('up-from-the-counting-house', 'market-counting', { x: 7, y: 1 }, Math.PI),
      {
        id: 'brokers-ledger-box',
        model: 'chest-prop',
        position: { x: 14, y: 10 },
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
        position: { x: 7, y: 11 },
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
        position: { x: 7, y: 12 },
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'portal', name: 'The wet stair', flavor: 'Down, into water and the sound of reading.', repeatable: true, effects: LIBRARY_STAIR },
      },
      { model: 'standing-torch-prop', position: { x: 1, y: 4 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 14, y: 4 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 4, y: 5 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 11, y: 5 }, rotation: 0 },
      { model: 'crate-prop', position: { x: 1, y: 10 }, rotation: 0.1 },
      { model: 'barrel-prop', position: { x: 14, y: 8 }, rotation: 0 },
    ],
    encounters: [
      {
        id: 'the-broker',
        name: 'The Bone-Broker',
        // Begun by her answer, not by a step: a fight here is one the party chose.
        startsOnTrigger: false,
        adversaries: [
          { id: 'sela-marrow', adversary: BROKER_ID, name: 'Sela Marrow, the Bone-Broker', model: 'faerie-female', position: { x: 7, y: 5 }, interaction: talks },
          { id: 'guild-bonecutter-1', adversary: 'bandit-cutter', name: 'Guild Bonecutter', position: { x: 3, y: 8 }, interaction: talks },
          { id: 'guild-bonecutter-2', adversary: 'bandit-cutter', name: 'Guild Bonecutter', position: { x: 12, y: 8 }, interaction: talks },
          { id: 'guild-tallyman', adversary: 'bandit-archer', name: 'Guild Tallyman', position: { x: 9, y: 6 }, interaction: talks },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Its people
// ---------------------------------------------------------------------------------------------------------------

/** The dead the Guild has not sold yet, come up from the pit when the bell rings: a tier-2 standard that feeds. */
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
  features: [{ name: 'Feed', kind: 'action', text: 'Spend a Shadow to bite a creature within Melee range. On a hit, the Ghoul clears a Hit Point.', costsGmResource: true }],
} as AdversaryDef;

/**
 * Sexton Mott, who pulls the bell-rope: Grale pays him a tooth a ringing. The bell is a countdown he starts at the
 * party's first roll in the pit - every action roll the party makes swings it, and every fourth, two more of the dead
 * climb out of the heaps near him. It stops when he falls, or when he stops; at half his blood he would rather stop.
 */
export const PIT_SEXTON: AdversaryDef = {
  id: SEXTON_ID,
  name: 'Pit Sexton',
  tier: 2,
  role: 'support',
  description: 'A thick man in a grey apron gone black at the hem, with rope-burnt hands and a mallet through his belt.',
  motivesAndTactics: 'Keep ringing. Stay on the ledge. Let the dead do the work.',
  difficulty: 12,
  thresholds: { major: 7, severe: 14 },
  hitPoints: 6,
  stress: 3,
  attackName: 'Bell Mallet',
  attackModifier: { count: 0, sides: 0, modifier: 1 },
  attackRange: 'melee',
  attackDamage: { count: 1, sides: 8, modifier: 1, types: ['physical'] },
  experiences: [{ name: 'Knows when the dead are listening', modifier: 2 }],
  features: [{ name: 'The Bell', kind: 'reaction', text: 'Reaction: the first time a PC makes an action roll in the pit, the Sexton rings the market bell - a Loop Countdown (4) that ticks down whenever a PC makes an action roll. Each time it triggers, two Risen Corpses climb out of the heaps within Close range of the Sexton. It ends when he falls.', costsGmResource: false }],
} as AdversaryDef;

/** What the bell calls up: the freshest dead, one blow from down. Minion (4). */
export const BELL_CALLED: AdversaryDef = {
  id: BELL_CALLED_ID,
  name: 'Risen Corpse',
  tier: 2,
  role: 'minion',
  description: 'The newest of the pit’s dead, still in their shoes, climbing out of the heaps at the sound of the bell.',
  motivesAndTactics: 'Go toward the warm. Hold on.',
  difficulty: 11,
  thresholds: { major: 6, severe: 12 },
  hitPoints: 1,
  stress: 1,
  attackName: 'Clutch',
  attackModifier: { count: 0, sides: 0, modifier: 0 },
  attackRange: 'melee',
  attackDamage: { count: 0, sides: 0, modifier: 3, types: ['physical'] },
  experiences: [],
  features: [{ name: 'Minion (4)', kind: 'passive', text: 'The dead are defeated when they take any damage. For every 4 damage a PC deals to them, defeat an additional Minion within range the attack would succeed against.', costsGmResource: false }],
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
  features: [
    { name: 'Momentum', kind: 'reaction', text: 'When the Broker makes a successful attack against a PC, gain a Shadow.', costsGmResource: false },
    { name: 'Call in the Debt', kind: 'action', text: 'Spend 2 Shadow to spotlight up to two of the Guild within Far range of the Broker.', costsGmResource: true },
  ],
} as AdversaryDef;

/** The features above that act, as the cards their stat blocks print, and what each does. */
export const LEVEL_TWO_CARDS: ProjectDoc['cards'] = [
  { id: 'ghoul-feed', name: 'Feed', grant: { kind: 'adversary', adversaries: [GHOUL_ID] }, text: 'Spend a Shadow to bite a creature within Melee range. On a hit, the Ghoul clears a Hit Point.', features: [] },
  { id: 'sexton-the-bell', name: 'The Bell', grant: { kind: 'adversary', adversaries: [SEXTON_ID] }, text: 'Reaction: the first time a PC makes an action roll in the pit, the Sexton rings the market bell - a Loop Countdown (4) that ticks down whenever a PC makes an action roll. Each time it triggers, two Risen Corpses climb out of the heaps within Close range of the Sexton. It ends when he falls.', features: [] },
  { id: 'broker-call-in-the-debt', name: 'Call in the Debt', grant: { kind: 'adversary', adversaries: [BROKER_ID] }, text: 'Spend 2 Shadow to spotlight up to two of the Guild within Far range of the Broker.', features: [] },
] as ProjectDoc['cards'];

type Ability = ProjectDoc['abilities'][number];

export const LEVEL_TWO_ABILITIES: ProjectDoc['abilities'] = [
  {
    id: 'ghoul-feed',
    name: 'Feed',
    source: { card: 'ghoul-feed' },
    text: 'Spend a Shadow to bite a creature within Melee range. On a hit, the Ghoul clears a Hit Point.',
    cost: { bad: 1 },
    target: { kind: 'creature', range: 'melee' },
    inCombatOnly: true,
    effects: [{ kind: 'attack', range: 'melee', onHit: [{ kind: 'heal', amount: 1, target: { kind: 'actor' } }, { kind: 'log', text: 'The ghoul feeds, and its wounds close a little.', tone: 'bad' }] }],
  } as Ability,
  {
    id: 'sexton-the-bell',
    name: 'The Bell',
    source: { card: 'sexton-the-bell' },
    text: 'Reaction: the first time a PC makes an action roll in the pit, the Sexton rings the market bell - a Loop Countdown (4) that ticks down whenever a PC makes an action roll. Each time it triggers, two Risen Corpses climb out of the heaps within Close range of the Sexton. It ends when he falls.',
    // A reaction to the party's first roll, not an action: it costs the GM nothing, and does not wait for his spotlight.
    kind: 'reaction',
    trigger: 'partyRolled',
    cost: {},
    uses: { count: 1, per: 'scene' },
    target: { kind: 'self' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Mott leans his whole weight on the rope. Overhead, through the stone, the market bell begins to swing.', tone: 'bad' },
      {
        kind: 'countdown',
        countdown: 'the-market-bell',
        name: 'The market bell',
        start: '4',
        advance: 'standard',
        loop: 'reset',
        onDeath: 'end',
        effects: [
          {
            kind: 'branch',
            // Talked down, he has let go of the rope: the bell swings itself still.
            when: { kind: 'flag', flag: 'mott-talked' },
            then: [{ kind: 'log', text: 'The bell swings once more on its own, and nobody pulls it, and it stops.', tone: 'narration' }],
            otherwise: [
              { kind: 'summon', adversary: BELL_CALLED_ID, count: '2', range: 'close' },
              { kind: 'log', text: 'The bell speaks. The heaps by the ledge heave, and two more of the dead stand up out of them.', tone: 'bad' },
            ],
          },
        ],
      },
    ],
  } as Ability,
  {
    id: 'broker-call-in-the-debt',
    name: 'Call in the Debt',
    source: { card: 'broker-call-in-the-debt' },
    text: 'Spend 2 Shadow to spotlight up to two of the Guild within Far range of the Broker.',
    cost: { bad: 2 },
    target: { kind: 'self' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Sela taps her pen twice on the desk. Her people move as one.', tone: 'bad' },
      { kind: 'spotlight', count: '2' },
    ],
  } as Ability,
];

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
        { text: 'Your sexton rings the bell. You pay him to.', available: { kind: 'all', of: [{ kind: 'flag', flag: 'knows-the-bell' }, { kind: 'not', of: { kind: 'flag', flag: 'confronted-grale' } }] }, goto: 'bell' },
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
    {
      id: 'bell',
      lines: [
        { text: 'Grale looks at the strip of paper for a long moment. Then he folds his hands.' },
        { speaker: 'Usher Grale', text: 'Thrift, friends. The marsh wants meal, and the dead want nothing. Mott rings, they come up, they are put down again, and the Guild sells what is left. I sent you because the pit had got ahead of him.' },
        { speaker: 'Usher Grale', text: 'The Broker would not see it so. She is particular about where things come from.' },
        { text: 'He takes a purse from inside his apron and holds it out, low, where the stalls cannot see it.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'confronted-grale' }],
      choices: [
        { text: 'Take the purse.', effects: [{ kind: 'addItem', item: GOLD, quantity: 25 }, { kind: 'setFlag', flag: 'took-grales-purse' }, { kind: 'log', text: 'Grale bows a little lower than before. "Thrift," he says again, to nobody.', tone: 'narration' }] },
        { text: '[Leave it in his hand.]', effects: [{ kind: 'log', text: 'Grale puts the purse away. He does not look at you again.', tone: 'narration' }] },
      ],
    },
  ],
} as ProjectDoc['dialogues'][number];

/** Sexton Mott at half his blood: he lets go of the rope, and says who pays him to pull it. */
export const SEXTON: ProjectDoc['dialogues'][number] = {
  id: SEXTON_DIALOGUE,
  start: 'lets-go',
  nodes: [
    {
      id: 'lets-go',
      lines: [
        { text: 'The man on the ledge lets go of the rope and puts both arms over his head.' },
        { speaker: 'Sexton Mott', text: 'Don’t! I only ring it. Grale pays a tooth a ringing. They come up, the stall-boys put them down, and it’s meal for the marsh by Thursday.' },
      ],
      choices: [
        { text: 'Then stop ringing it.', available: { kind: 'not', of: { kind: 'flag', flag: 'mott-talked' } }, goto: 'stops' },
        { text: 'Ring your last, then.', available: { kind: 'not', of: { kind: 'flag', flag: 'mott-talked' } }, effects: [{ kind: 'setAttitude', attitude: 'hostile' }] },
        { text: '[Leave him on his ledge.]', available: { kind: 'flag', flag: 'mott-talked' } },
      ],
    },
    {
      id: 'stops',
      lines: [
        { speaker: 'Sexton Mott', text: 'Stopped. See? Stopped.' },
        { speaker: 'Sexton Mott', text: 'The Broker doesn’t know. She buys the meal off Grale and thinks it’s honest dying. She’d have him weighed. Don’t tell her it was me told you.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'mott-talked' }, { kind: 'setFlag', flag: 'knows-the-bell' }],
      choices: [{ text: '[Let him sit.]' }],
    },
  ],
} as ProjectDoc['dialogues'][number];

/** Clerk Wenna, at a stall by the Guild's door: she buys keepsakes - and what Level 1 gave the party is a keepsake. */
export const CLERK: ProjectDoc['dialogues'][number] = {
  id: CLERK_DIALOGUE,
  start: 'scale',
  nodes: [
    {
      id: 'scale',
      lines: [
        { text: 'A girl in a grey apron too big for her weighs teeth on a brass scale, one at a time, and writes each down.' },
        { speaker: 'Clerk Wenna', text: 'Buying, not selling. Teeth, rings, keepsakes. The Guild pays fair for what can’t be eaten.' },
      ],
      choices: [
        { text: 'Sell her the wedding band.', detail: '30 gold', available: { kind: 'hasItem', item: TAMS_RING }, goto: 'ring' },
        { text: 'Sell her the keeper’s token.', detail: '8 gold', available: { kind: 'hasItem', item: KEEPERS_TOKEN }, goto: 'token' },
        { text: 'What does the Guild do with them?', goto: 'what' },
        { text: '[Leave her to her scale.]' },
      ],
    },
    {
      id: 'ring',
      lines: [
        { text: 'She reads the inside of it under the lamp. T. & M.' },
        { speaker: 'Clerk Wenna', text: 'Sweet. Thirty. Somebody up top will buy it back one day, not knowing what it is. They always do.' },
      ],
      onEnter: [{ kind: 'removeItem', item: TAMS_RING, quantity: 1 }, { kind: 'addItem', item: GOLD, quantity: 30 }, { kind: 'setFlag', flag: 'sold-the-ring' }],
      choices: [{ text: '[Take the coin.]' }],
    },
    {
      id: 'token',
      lines: [{ speaker: 'Clerk Wenna', text: 'Brass. Eight. Nobody wants a keeper any more.' }],
      onEnter: [{ kind: 'removeItem', item: KEEPERS_TOKEN, quantity: 1 }, { kind: 'addItem', item: GOLD, quantity: 8 }],
      choices: [{ text: '[Take the coin.]' }],
    },
    {
      id: 'what',
      lines: [
        { speaker: 'Clerk Wenna', text: 'Sells them back up. A pedlar takes a tray to Hallowmere every market day. People buy back what they lost and never ask how it got to the stall.' },
        { speaker: 'Clerk Wenna', text: 'Mother Ketch buys most. She’s good custom.' },
      ],
      choices: [{ text: '[Leave her to her scale.]' }],
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
const SPARED = { kind: 'flag', flag: 'annick-spared' } as const;

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
        // A dead man's name, which she may take for a living one: only while he is dead.
        { text: 'Hob Annick is dead. Take his.', detail: 'Presence 14', available: { kind: 'all', of: [{ kind: 'not', of: DEALT }, { kind: 'not', of: SPARED }] }, check: { trait: 'presence', difficulty: 14, gotoOnSuccess: 'annick', gotoOnFailure: 'insulted' } },
        { text: 'We will take the key instead.', available: { kind: 'not', of: DEALT }, goto: 'fight' },
        { text: 'Take Usher Grale’s. He rings your pit bell for bone.', available: { kind: 'all', of: [{ kind: 'not', of: DEALT }, { kind: 'flag', flag: 'knows-the-bell' }, { kind: 'not', of: { kind: 'flag', flag: 'took-grales-purse' } }] }, goto: 'grale' },
        { text: 'Take Hob Annick’s. He gave us his key; he can spare his name.', available: { kind: 'all', of: [{ kind: 'not', of: DEALT }, SPARED] }, goto: 'annick-living' },
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
    {
      id: 'grale',
      lines: [
        { text: 'Sela puts down her pen. For a moment she is very still.' },
        { speaker: 'Sela Marrow', text: 'I had wondered why the meal was so cheap this year.' },
        { text: 'She writes, in the same small square hand: Aldous Grale, usher. Then she rings a little bell on the desk, and somebody in a grey apron goes out quickly.' },
        { speaker: 'Sela Marrow', text: 'The Guild owns what it is owed. Go down. I will see to the door myself.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'gave-grales-name' }, ...PAID],
      choices: [{ text: '[Take the key.]' }],
    },
    {
      id: 'annick-living',
      lines: [
        { text: 'Sela writes: Hobart Annick, well-keeper. Then she looks at what she has written, and adds, smaller: living.' },
        { speaker: 'Sela Marrow', text: 'A living name is a real price. He will wake tomorrow and not know what to answer to. You spared him, and now you have spent him. That is how the Guild began.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'gave-annicks-name' }, { kind: 'setFlag', flag: 'annick-named-living' }, ...PAID],
      choices: [{ text: '[Take the key.]' }],
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
