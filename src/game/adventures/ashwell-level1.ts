/** The Ashwell: the Lantern & Lye, and Level 1, the Throat (`docs/ASHWELL.md`) - its rooms, its people, its quest. */

import { sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import type { Effect } from '../../engine/script/schema';
import { GOLD } from '../demo-items';
import { HUB_ID, THROAT_ID, KENNEL_ID, SUMP_ID, QUEST_ID, KETCH_DIALOGUE, SUMP_KEY, WARDEN_ID, MARKET_ID, MARKET_QUEST, FURNACE_QUEST, sceneFromRows, passage, afterTheFight, kindsOf, type Furniture } from './ashwell-kit';

/** What Level 1 adds to the adventure's things: the Warden's old token, hidden by the shaft, and Tam Ketch's ring. */
export const KEEPERS_TOKEN = 'keepers-token';
export const TAMS_RING = 'tams-ring';
export const LAMP_MOTH_ID = 'lamp-moth';
export const NAILS_DIALOGUE = 'nails';
export const ANNICK_DIALOGUE = 'hob-annick';

export const LEVEL_ONE_ITEMS: ProjectDoc['items'] = [
  { id: KEEPERS_TOKEN, name: 'The Keeper’s Token', kind: 'trinket', description: 'A brass disc on a leather thong, stamped HALLOWMERE WELL - KEEPER. Somebody hid it behind a loose stone at the foot of the shaft, as if it were worth more than the wages.', stackable: false, use: [] },
  { id: TAMS_RING, name: 'A Wedding Band', kind: 'trinket', description: 'A plain copper ring, worn thin, scratched inside: T. & M. It was in the Kennel, among the bones.', stackable: false, use: [] },
] as ProjectDoc['items'];

// ---------------------------------------------------------------------------------------------------------------
// The Lantern & Lye
// ---------------------------------------------------------------------------------------------------------------

/**
 * The tavern over the well: shelves on the north wall and the bar before them, Ketch between; the hearth in the north-
 * east corner, its stones round a fire; the well's ring in the middle, open to the south; two tables; the door south.
 */
const HUB_ROWS = [
  '##################',
  '#SSSSSSS.....FFF.#',
  '#................#',
  '#KKKKKKK.........#',
  '#................#',
  '#.......ccc......#',
  '#.......c.c......#',
  '#................#',
  '#..TT........TT..#',
  '#................#',
  '#................#',
  '#................#',
  '########..########',
];

/** The tavern's furniture: shelves against the north wall, the bar, the hearth's stones, the tables. */
const HUB_FURNITURE: Readonly<Record<string, Furniture>> = {
  S: { kind: 'shelf', shape: 'wall', height: 1.75 },
  K: { kind: 'counter', shape: 'block', height: 0.75 },
  F: { kind: 'furnace', shape: 'block', height: 1.5 },
  T: { kind: 'counter', shape: 'block', height: 0.5 },
};

/** The well's mouth, in its ring; the hearth's fire, before its stones. */
const WELL = { x: 9, y: 6 };
const HEARTH = { x: 14, y: 2 };

/** A night by the hearth, for five gold: everybody's wounds and fears eased, as far as one night goes. */
const HEARTH_REST: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'hasItem', item: GOLD, quantity: 5 },
    then: [
      { kind: 'removeItem', item: GOLD, quantity: 5 },
      { kind: 'heal', amount: 3, target: { kind: 'party' } },
      { kind: 'clearStress', amount: 2, target: { kind: 'party' } },
      { kind: 'log', text: 'Ketch takes the coins without counting them and banks the fire. You sleep in your boots, and wake stiff, and better.', tone: 'good' },
    ],
    otherwise: [{ kind: 'log', text: '"Five for the fire and the floor," says Ketch, without looking up. "I don’t keep the dead for free either."', tone: 'narration' }],
  },
];

/** The slate by the door, read: everybody who went down - and what the party’s doings have made of it. */
const SLATE: Effect[] = [
  { kind: 'log', text: 'Forty-one names in close chalk, and three wiped to a grey smear: the ones who came back. Yours are at the bottom.', tone: 'narration' },
  { kind: 'branch', when: { kind: 'flag', flag: 'gave-ketchs-name' }, then: [{ kind: 'log', text: 'At the top, where the first name on the slate should be - the one who began it - the chalk has been rubbed away, and nobody has written it in again.', tone: 'bad' }] },
  { kind: 'branch', when: { kind: 'flag', flag: 'returned-the-ring' }, then: [{ kind: 'log', text: 'Halfway down, beside TAM KETCH, somebody has drawn a small careful ring.', tone: 'narration' }] },
  { kind: 'branch', when: { kind: 'flag', flag: 'sold-the-ring' }, then: [{ kind: 'log', text: 'Ketch is wearing a copper ring on her thumb, new. She bought it off the Guild’s pedlar on market day, for forty, and she has not said a word about it to you.', tone: 'bad' }] },
  { kind: 'branch', when: { kind: 'flag', flag: 'annick-spared' }, then: [{ kind: 'log', text: 'HOB ANNICK has been chalked again at the bottom, in a hand that is not Ketch’s: the Warden came up.', tone: 'good' }] },
  { kind: 'branch', when: { kind: 'flag', flag: 'ending-burned' }, then: [{ kind: 'log', text: 'It has been wiped clean, edge to edge. A smear of chalk remains in one corner, as if somebody started a name and forgot it.', tone: 'narration' }] },
];

export function hub(): SceneDoc {
  return sceneSchema.parse({
    id: HUB_ID,
    name: 'The Lantern & Lye',
    intro: 'A low room that smells of lye and lamp oil. In the middle of the floor, ringed in cracked stone, the old well breathes grey ash up into the rafters.',
    light: 0.5,
    ...sceneFromRows(HUB_ROWS, kindsOf('lantern'), HUB_FURNITURE),
    spawns: [
      { x: 8, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 11 },
      { x: 9, y: 11 },
    ],
    decos: [
      { id: 'mother-ketch', model: 'merchant', position: { x: 4, y: 2 }, rotation: Math.PI, solid: true, function: { kind: 'interaction', dialogue: KETCH_DIALOGUE } },
      {
        id: 'the-well',
        model: 'stone-stairs',
        position: WELL,
        rotation: Math.PI,
        solid: true,
        function: {
          kind: 'script',
          object: 'portal',
          name: 'The well',
          flavor: 'A rope runs down from the winch into the ash. Warm air comes up it, and the smell of burnt paper.',
          blocksMovement: true,
          repeatable: true,
          effects: [
            {
              kind: 'branch',
              when: { kind: 'flag', flag: 'ketch-spoke' },
              then: [{ kind: 'completeObjective', quest: QUEST_ID, objective: 'go-down' }, { kind: 'goto', scene: THROAT_ID }],
              otherwise: [{ kind: 'log', text: 'Mother Ketch looks up from the body on the bar. "Not on my rope, you don’t. Not till you’ve heard me."', tone: 'narration' }],
            },
          ],
        },
      },
      { id: 'body-on-the-bar', model: 'crate-prop', position: { x: 6, y: 3 }, rotation: 0.1, solid: true },
      {
        id: 'ketchs-shelf',
        model: 'crate-prop',
        position: { x: 8, y: 1 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'shop',
          shop: {
            currency: GOLD,
            stock: [
              { item: 'consumable-minor-health-potion', price: 10 },
              { item: 'consumable-minor-stamina-potion', price: 10 },
              { item: 'healing-draught', price: 20, count: 2 },
            ],
          },
        },
      },
      {
        id: 'the-hearth',
        model: 'camp-fire-prop',
        position: HEARTH,
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'scripted', name: 'The hearth', flavor: 'Banked coals, and the floor in front of them worn smooth by people sleeping in their boots.', repeatable: true, effects: HEARTH_REST },
      },
      {
        id: 'ketchs-slate',
        model: 'banner-prop',
        position: { x: 6, y: 11 },
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'scripted', name: 'Ketch’s slate', flavor: 'A slate by the door, chalked close with names.', repeatable: true, effects: SLATE },
      },
      { model: 'barrel-prop', position: { x: 16, y: 1 }, rotation: 0 },
      { model: 'barrel-prop', position: { x: 16, y: 10 }, rotation: 0.4 },
      { model: 'barrel-prop', position: { x: 16, y: 11 }, rotation: 0 },
      { model: 'crate-prop', position: { x: 1, y: 10 }, rotation: 0.2 },
      { model: 'crate-prop', position: { x: 1, y: 11 }, rotation: -0.3 },
      { model: 'wall-torch-prop', position: { x: 1, y: 6 }, rotation: Math.PI / 2 },
      { model: 'wall-torch-prop', position: { x: 16, y: 6 }, rotation: -Math.PI / 2 },
      { model: 'standing-torch-prop', position: { x: 7, y: 11 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 10, y: 11 }, rotation: 0 },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Level 1: the Throat
// ---------------------------------------------------------------------------------------------------------------

/**
 * The cistern under the town, three rooms of it - a fight in each, since a fight is everyone hostile in the room it
 * is in. The Throat itself: the Shaft Foot in the north-west, a heap of what fell, raised, where the rope ends, with a
 * stair down off it each way; the Long Gallery east of it, a channel of black water between a ledge and a slope of
 * rubble and old boards - the ledge broken half way along, to be jumped or waded round; the Wellrats' camp at its end,
 * their slinger up on a barricade of stacked rubble. A passage south from the shaft goes down to the Kennel, and one
 * south from the camp to the Sump. Each passage ends at a stair paired with one in the room below.
 */
const THROAT_ROWS = [
  '################################',
  '#^^^^#################.........#',
  '#^^^^/.......~~...............##',
  '#^^^^#.......~~.........^^^...##',
  '#./..#~~~~~~~~~~~~~~~~..^^^....#',
  '#....#~~~~~~~~~~~~~~~~.../.....#',
  '#....#~~~~~~~~~~~~~~~~.........#',
  '#....#,,,===,,,,===,,,.........#',
  '##..###################........#',
  '##..#####################..#####',
  '##..#####################..#####',
  '##..#####################..#####',
  '##..#####################..#####',
  '################################',
];

const KENNEL_ROWS = [
  '##############',
  '###..#########',
  '###..#########',
  '#............#',
  '#....~~~~~...#',
  '#...~~~~~~~..#',
  '#...~~~~~~~..#',
  '#....~~~~~...#',
  '#..,.........#',
  '#==..........#',
  '#==.....,....#',
  '##############',
];

/** The Sump: a walk round its pool, the platform of stacked doors in the middle reached by boards, the gate east. */
const SUMP_ROWS = [
  '###################',
  '########..#########',
  '########..#########',
  '#...............###',
  '#..~~~~~~~~~~~..###',
  '#..~~~~~~~~~~~..###',
  '#..~~~~BBBB~~~..###',
  '#.====/BBBB/===...#',
  '#..~~~~BBBB~~~..###',
  '#..~~~~~~~~~~~..###',
  '#...............###',
  '#....c..........###',
  '#...............###',
  '###################',
];

/** Where the Throat's ways out are, and the Sump's gate and stair. */
const STAIR_UP = { x: 1, y: 1 };
const GATE = { x: 16, y: 7 };
const STAIR_DOWN = { x: 17, y: 7 };

/**
 * The Sump's stair down: the first time, the end of Level 1 - Vane's second page, the quest done, a level gained - and
 * the way into Level 2, its quest begun; every time after, simply the way down to the Market. The page knows whether
 * Annick gave the key or had it taken.
 */
const DOWN: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'level-1-done' },
    then: [{ kind: 'goto', scene: MARKET_ID }],
    otherwise: [
      { kind: 'completeObjective', quest: QUEST_ID, objective: 'the-gate' },
      {
        kind: 'branch',
        when: { kind: 'flag', flag: 'annick-spared' },
        then: [
          {
            kind: 'story',
            title: 'Entry 4,113',
            paragraphs: [
              'The stair goes down past the gate in a tight spiral, and at the bottom of the third turn it stops at a wall of bone - skulls set like bricks, mortared with ash - with a door cut in it. Pinned to the door at eye height is another page, the ink still wet.',
              '"They opened Annick’s gate with Annick’s key, which Annick gave them. He has never given anybody anything. I have had to start his entry again, and I do not like starting again. The Market has been told they are coming. Let them be polite."',
              'Before you can knock, the door is opened from the other side by somebody in a grey apron, who bows.',
            ],
            button: 'Go through',
          },
        ],
        otherwise: [
          {
            kind: 'story',
            title: 'Entry 4,113',
            paragraphs: [
              'The stair goes down past the gate in a tight spiral, and at the bottom of the third turn it stops at a wall of bone - skulls set like bricks, mortared with ash - with a door cut in it. Pinned to the door at eye height is another page, the ink still wet.',
              '"They opened Annick’s gate with Annick’s key, which was taken from Annick, who did not give it. The Market has been told they are coming. Let them be polite. It costs nothing down here, and it buys a great deal."',
              'Before you can knock, the door is opened from the other side by somebody in a grey apron, who bows.',
            ],
            button: 'Go through',
          },
        ],
      },
      { kind: 'completeQuest', quest: QUEST_ID },
      { kind: 'levelUp' },
      { kind: 'setFlag', flag: 'level-1-done' },
      { kind: 'startQuest', quest: MARKET_QUEST },
      { kind: 'completeObjective', quest: MARKET_QUEST, objective: 'reach-the-market' },
      { kind: 'goto', scene: MARKET_ID },
    ],
  },
];

export function throat(): SceneDoc {
  return sceneSchema.parse({
    id: THROAT_ID,
    name: 'The Throat',
    intro: 'The rope ends on a heap of what fell before you: boots, a lantern, a hand. Water drips somewhere ahead in the dark, and the ash hangs in the air like breath on a cold morning.',
    light: 0.3,
    ...sceneFromRows(THROAT_ROWS, kindsOf('throat')),
    spawns: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ],
    decos: [
      {
        id: 'rope-up',
        model: 'stone-stairs',
        position: STAIR_UP,
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'portal', name: 'The rope up', flavor: 'The rope you came down, swaying a little. The Lantern is up there, and light.', repeatable: true, effects: [{ kind: 'goto', scene: HUB_ID }] },
      },
      {
        id: 'first-page',
        model: 'banner-prop',
        position: { x: 6, y: 3 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'scripted',
          name: 'A page, nailed up',
          flavor: 'A sheet of good paper, nailed to the wet stone at eye height. It is dry.',
          effects: [
            {
              kind: 'story',
              title: 'Entry 4,112',
              paragraphs: [
                '"They came down in good order. They checked the rope twice. One of them was afraid of the water and did not say so, and one of them saw, and said nothing either, which was kind, and will not help."',
                '"Annick’s people are at the end of the gallery. They will hear the water move. Annick himself is in the Sump, where it is deepest. He used to keep this well clean. He was proud of it. He hid the proof of it somewhere at the foot of the shaft, the night he went down for good, and he has forgotten where."',
                'It is signed with a single initial, a V, very neat.',
              ],
              button: 'Tear it down',
            },
            { kind: 'setFlag', flag: 'read-vanes-page' },
          ],
        },
      },
      // The keeper's token, behind a loose stone at the shaft's foot: an Instinct roll to see which stone, once.
      {
        id: 'loose-stone',
        model: 'rock-prop',
        position: { x: 1, y: 6 },
        rotation: 0.6,
        solid: true,
        function: {
          kind: 'trapped',
          trait: 'instinct',
          difficulty: 12,
          success: {
            kind: 'script',
            object: 'chest',
            name: 'A loose stone',
            effects: [
              { kind: 'addItem', item: KEEPERS_TOKEN, quantity: 1 },
              { kind: 'log', text: 'One stone in the wall is drier than the rest. Behind it, wrapped in oilcloth, a brass token on a thong: HALLOWMERE WELL - KEEPER.', tone: 'good' },
            ],
          },
          failure: { kind: 'script', object: 'chest', name: 'A loose stone', effects: [{ kind: 'log', text: 'Wet stone, and more wet stone. Whatever was hidden here, it stays hidden.', tone: 'narration' }] },
        },
      },
      { model: 'standing-torch-prop', position: { x: 4, y: 4 }, rotation: 0 },
      { model: 'barrel-prop', position: { x: 1, y: 7 }, rotation: 0 },
      { model: 'wall-torch-prop', position: { x: 10, y: 2 }, rotation: 0 },
      { model: 'wall-torch-prop', position: { x: 19, y: 2 }, rotation: 0 },
      { model: 'rock-prop', position: { x: 8, y: 7 }, rotation: 1.4 },
      // The Wellrats' camp.
      { id: 'wellrat-fire', model: 'camp-fire-prop', position: { x: 27, y: 6 }, rotation: 0, solid: true },
      { model: 'cart-prop', position: { x: 29, y: 2 }, rotation: 1.2 },
      { model: 'barrel-prop', position: { x: 30, y: 7 }, rotation: 0 },
      { model: 'barrel-prop', position: { x: 23, y: 8 }, rotation: 0.6 },
      { model: 'crate-prop', position: { x: 22, y: 1 }, rotation: 0.3 },
      {
        id: 'wellrat-takings',
        model: 'crate-prop',
        position: { x: 29, y: 4 },
        rotation: 0.3,
        solid: true,
        function: {
          kind: 'script',
          object: 'chest',
          name: 'The Wellrats’ takings',
          flavor: 'Boots, belts, rings with the fingers still in them, sorted into piles by somebody careful.',
          repeatable: true,
          effects: afterTheFight('wellrats', [{ kind: 'completeObjective', quest: QUEST_ID, objective: 'break-the-wellrats' }, { kind: 'loot', table: 'wellrat-takings' }, { kind: 'log', text: 'You take what is worth taking. It was all somebody’s.', tone: 'narration' }], 'Not with the Wellrats watching you do it.'),
        },
      },
      // The passages down.
      passage('down-to-the-kennel', 'throat-kennel', { x: 2, y: 12 }, 0),
      passage('down-to-the-sump', 'throat-sump', { x: 26, y: 12 }, 0),
    ],
    encounters: [
      {
        id: 'wellrats',
        name: 'The Wellrats',
        // Half way down the gallery, where the water carries the sound to the camp.
        triggerCells: [16, 17].flatMap((x) => [2, 3, 4, 5, 6, 7].map((y) => ({ x, y }))),
        adversaries: [
          { id: 'wellrat-cutter-1', adversary: 'bandit-cutter', name: 'Wellrat Cutter', position: { x: 23, y: 3 } },
          { id: 'wellrat-cutter-2', adversary: 'bandit-cutter', name: 'Wellrat Cutter', position: { x: 23, y: 6 } },
          { id: 'wellrat-slinger', adversary: 'bandit-archer', name: 'Wellrat Slinger', position: { x: 25, y: 3 } },
          // Nails keeps the count of what the Wellrats take; she would sooner live than keep it.
          { id: 'nails', adversary: 'bandit-cutter', name: 'Nails, who keeps the count', position: { x: 28, y: 5 }, interaction: { kind: 'threshold', dialogue: NAILS_DIALOGUE, percent: 60 } },
        ],
      },
    ],
  });
}

export function kennel(): SceneDoc {
  return sceneSchema.parse({
    id: KENNEL_ID,
    name: 'The Kennel',
    intro: 'The passage opens on a low, wet room that stinks of old meat. The floor is gnawed bone from wall to wall, the middle of it a pool gone black, and something in the water is breathing.',
    light: 0.22,
    ...sceneFromRows(KENNEL_ROWS, kindsOf('throat')),
    spawns: [
      { x: 4, y: 1 },
      { x: 4, y: 2 },
    ],
    decos: [
      passage('up-from-the-kennel', 'throat-kennel', { x: 3, y: 1 }, Math.PI),
      { model: 'standing-torch-prop', position: { x: 5, y: 3 }, rotation: 0 },
      { model: 'rock-prop', position: { x: 11, y: 4 }, rotation: 2.1 },
      { model: 'rock-prop', position: { x: 9, y: 9 }, rotation: 0.4 },
      { model: 'crate-prop', position: { x: 1, y: 8 }, rotation: 0 },
      {
        id: 'kennel-chest',
        model: 'chest-prop',
        position: { x: 1, y: 10 },
        rotation: 0,
        solid: true,
        function: { kind: 'container', items: [{ item: 'consumable-minor-health-potion', count: 2 }, { item: GOLD, count: 12 }, { item: TAMS_RING, count: 1 }] },
      },
    ],
    encounters: [
      {
        id: 'the-kennel',
        name: 'The Kennel',
        // The foot of the passage.
        triggerCells: [3, 4].map((x) => ({ x, y: 3 })),
        adversaries: [
          { id: 'kennel-hounds', adversary: 'rot-hound', name: 'Kennel Hounds', position: { x: 3, y: 8 } },
          { id: 'thing-in-the-wet', adversary: 'fen-lurker', name: 'The Thing in the Wet', position: { x: 8, y: 5 } },
        ],
      },
    ],
  });
}

export function sump(): SceneDoc {
  return sceneSchema.parse({
    id: SUMP_ID,
    name: 'The Sump',
    intro: 'The cistern’s deepest chamber. Lamps hang from chains over black water, and moths the size of hands turn in their smoke. On a platform of stacked doors sits a broad man wrapped in rusted chain.',
    light: 0.3,
    ...sceneFromRows(SUMP_ROWS, kindsOf('throat')),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
      { x: 9, y: 2 },
    ],
    decos: [
      passage('up-from-the-sump', 'throat-sump', { x: 9, y: 1 }, Math.PI),
      // The lamps on their chains, at the platform's corners.
      { model: 'standing-torch-prop', position: { x: 7, y: 6 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 10, y: 8 }, rotation: 0 },
      { model: 'wall-torch-prop', position: { x: 1, y: 3 }, rotation: Math.PI / 2 },
      { model: 'wall-torch-prop', position: { x: 15, y: 10 }, rotation: -Math.PI / 2 },
      { model: 'barrel-prop', position: { x: 1, y: 12 }, rotation: 0.3 },
      { model: 'crate-prop', position: { x: 14, y: 12 }, rotation: 0.8 },
      {
        id: 'wardens-strongbox',
        model: 'chest-prop',
        position: { x: 10, y: 6 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'chest',
          name: 'The Warden’s strongbox',
          flavor: 'An iron box chained to the platform with well-chain. Annick kept the keys to everything.',
          repeatable: true,
          effects: afterTheFight(
            'the-warden',
            [
              { kind: 'giveKey', key: SUMP_KEY },
              { kind: 'completeObjective', quest: QUEST_ID, objective: 'the-warden' },
              { kind: 'revealObjective', quest: QUEST_ID, objective: 'the-gate' },
              { kind: 'loot', table: 'wardens-hoard' },
              { kind: 'log', text: 'Under a tray of tarnished rings is a key on a loop of chain, black with handling: the Sump Gate’s.', tone: 'good' },
            ],
            'The Warden is between you and his box, and he means to stay there.',
          ),
        },
      },
      {
        id: 'sump-gate',
        model: 'door-prop',
        position: GATE,
        rotation: Math.PI / 2,
        solid: true,
        function: {
          kind: 'script',
          object: 'door',
          name: 'The Sump Gate',
          flavor: 'An iron grate across a narrow stair going down. Warm air comes up through it.',
          requiresKey: SUMP_KEY,
          lockedText: 'The grate is locked, and the lock is good. Annick kept the key.',
          effects: [
            { kind: 'log', text: 'The key turns hard. The grate swings in, and the stair beyond goes down into ash.', tone: 'good' },
            { kind: 'remove' },
          ],
        },
      },
      {
        id: 'stair-down',
        model: 'stone-stairs',
        position: STAIR_DOWN,
        rotation: -Math.PI / 2,
        solid: true,
        function: { kind: 'script', object: 'portal', name: 'The stair down', flavor: 'A tight spiral, going down. The ash is thicker here.', repeatable: true, effects: DOWN },
      },
    ],
    encounters: [
      {
        id: 'the-warden',
        name: 'The Cistern Warden',
        // The foot of the passage from the camp, and the water's edge before it.
        triggerCells: [7, 8, 9, 10].flatMap((x) => [3, 4].map((y) => ({ x, y }))),
        adversaries: [
          { id: 'hob-annick', adversary: WARDEN_ID, name: 'Hob Annick, the Cistern Warden', model: 'bandit-captain', position: { x: 8, y: 7 }, interaction: { kind: 'threshold', dialogue: ANNICK_DIALOGUE, percent: 50 } },
          { id: 'lamp-moths', adversary: LAMP_MOTH_ID, name: 'Lamp Moths', position: { x: 4, y: 3 } },
          { id: 'lamp-moths-2', adversary: LAMP_MOTH_ID, name: 'Lamp Moths', position: { x: 13, y: 3 } },
          { id: 'sump-cutter', adversary: 'bandit-cutter', name: 'Wellrat Cutter', position: { x: 3, y: 11 } },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Its people
// ---------------------------------------------------------------------------------------------------------------

/**
 * Hob Annick, once Hallowmere's well-keeper, now the Wellrats' chief: a leader, and the level's boss. Relentless - he
 * is spotlighted twice in a GM turn, the second for a Shadow - and his chain drags whoever it catches to a stop.
 */
export const CISTERN_WARDEN: AdversaryDef = {
  id: WARDEN_ID,
  name: 'Cistern Warden',
  tier: 1,
  role: 'leader',
  description: 'A broad man gone grey with ash, wrapped in rusted well-chain he wears like a mantle and swings like a flail.',
  motivesAndTactics: 'Keep the Sump. Send the Wellrats in first. Wrap the strongest in chain and drag them into the deep water.',
  difficulty: 13,
  thresholds: { major: 7, severe: 13 },
  hitPoints: 7,
  stress: 4,
  attackName: 'Well-Chain',
  attackModifier: { count: 0, sides: 0, modifier: 2 },
  attackRange: 'veryClose',
  attackDamage: { count: 1, sides: 10, modifier: 2, types: ['physical'] },
  experiences: [{ name: 'Knows every inch of the cistern', modifier: 2 }],
  features: [
    { name: 'Relentless (2)', kind: 'passive', text: 'The Warden can be spotlighted up to two times per GM turn. Spend a Shadow as usual to spotlight him.', costsGmResource: false },
    { name: 'Drag Under', kind: 'action', text: 'Lash a creature within Close range with the well-chain. On a hit it takes the chain’s damage and is Restrained until it breaks free.', costsGmResource: true },
  ],
} as AdversaryDef;

/** Lamp moths: pale, hand-sized, many. Minion (3) - any damage puts one down, and every 3 more puts down another. */
export const LAMP_MOTH: AdversaryDef = {
  id: LAMP_MOTH_ID,
  name: 'Lamp Moths',
  tier: 1,
  role: 'minion',
  description: 'Pale moths the size of a hand, fat on lamp smoke, that settle on a face like a wet cloth.',
  motivesAndTactics: 'Put out the lights. Smother whoever carries one.',
  difficulty: 9,
  thresholds: { major: 4, severe: 8 },
  hitPoints: 1,
  stress: 1,
  attackName: 'Smother',
  attackModifier: { count: 0, sides: 0, modifier: 0 },
  attackRange: 'melee',
  attackDamage: { count: 1, sides: 4, modifier: 0, types: ['physical'] },
  experiences: [],
  features: [{ name: 'Minion (3)', kind: 'passive', text: 'The moths are defeated when they take any damage. For every 3 damage a PC deals to them, defeat an additional Minion within range the attack would succeed against.', costsGmResource: false }],
} as AdversaryDef;

/** The Warden's chain, as a card his stat block prints, and what it does: the GM plays it for a Shadow. */
export const WARDEN_CARDS: ProjectDoc['cards'] = [
  { id: 'warden-drag-under', name: 'Drag Under', grant: { kind: 'adversary', adversaries: [WARDEN_ID] }, text: 'Lash a creature within Close range with the well-chain. On a hit it takes the chain’s damage and is Restrained until it breaks free.', features: [] },
] as ProjectDoc['cards'];

export const WARDEN_ABILITIES: ProjectDoc['abilities'] = [
  {
    id: 'warden-drag-under',
    name: 'Drag Under',
    source: { card: 'warden-drag-under' },
    text: 'Lash a creature within Close range with the well-chain. On a hit it takes the chain’s damage and is Restrained until it breaks free.',
    cost: { bad: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        range: 'close',
        onHit: [
          { kind: 'applyCondition', condition: 'restrained', target: { kind: 'hit' } },
          { kind: 'log', text: 'The chain wraps and pulls tight.', tone: 'bad' },
        ],
      },
    ],
  },
] as ProjectDoc['abilities'];

/** Nails, who keeps the Wellrats' count: wounded past three fifths of her blood, she would sooner talk - and she knows what Annick was. */
export const NAILS: ProjectDoc['dialogues'][number] = {
  id: NAILS_DIALOGUE,
  start: 'drops',
  nodes: [
    {
      id: 'drops',
      lines: [
        { text: 'The small one with the tally-board throws her blade into the water and puts both hands up.' },
        { speaker: 'Nails', text: 'Enough. I keep the count, that’s all. I don’t fight for Annick. I count for him.' },
      ],
      choices: [
        { text: 'Tell us about Annick.', goto: 'annick' },
        { text: 'Then you can count your last.', effects: [{ kind: 'setAttitude', attitude: 'hostile' }] },
      ],
    },
    {
      id: 'annick',
      lines: [
        { speaker: 'Nails', text: 'He was the keeper. Kept this well so clean you could drink out of it, and he’d tell you so. He still goes and wipes the gate, mornings, and doesn’t know why.' },
        { speaker: 'Nails', text: 'If you’ve anything of his from before - anything with the keeping on it - show him. He might remember who he was. Or he’ll kill you. It’s about even.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'nails-talked' }],
      choices: [{ text: '[Let her go.]', effects: [{ kind: 'log', text: 'Nails picks up her tally-board and walks off into the dark the way you came, counting under her breath.', tone: 'narration' }] }],
    },
  ],
} as ProjectDoc['dialogues'][number];

/**
 * Hob Annick at half his blood: he would sooner bargain. Shown his old token - or told by Nails what he was -
 * he remembers, and gives the key; otherwise there is only the end of it.
 */
export const ANNICK: ProjectDoc['dialogues'][number] = {
  id: ANNICK_DIALOGUE,
  start: 'kneels',
  nodes: [
    {
      id: 'kneels',
      lines: [
        { text: 'Annick goes down on one knee on the doors, the chain slack in his hands. His breath comes out grey.' },
        { speaker: 'Hob Annick', text: 'Enough. You’ll have my box and my gate and my whole wet hole, will you? Go on, then. Finish it.' },
      ],
      choices: [
        {
          text: 'You kept this well clean, once.',
          available: { kind: 'any', of: [{ kind: 'hasItem', item: KEEPERS_TOKEN }, { kind: 'flag', flag: 'nails-talked' }] },
          goto: 'keeper',
        },
        { text: 'Then die on your doors.', effects: [{ kind: 'setAttitude', attitude: 'hostile' }] },
      ],
    },
    {
      id: 'keeper',
      lines: [
        { text: 'He looks at you for a long time. Then he looks at the water, as if he had not seen it before.' },
        { speaker: 'Hob Annick', text: 'Clean enough to drink. I did that. Every morning, the gate and the steps, and the town drank it. Where did it go?' },
        { text: 'He takes a key from round his neck on a loop of chain and holds it out to you without getting up.' },
        { speaker: 'Hob Annick', text: 'Gate’s that way. I’ll wipe it after you. Somebody ought to.' },
      ],
      onEnter: [
        { kind: 'giveKey', key: SUMP_KEY },
        { kind: 'completeObjective', quest: QUEST_ID, objective: 'the-warden' },
        { kind: 'revealObjective', quest: QUEST_ID, objective: 'the-gate' },
        { kind: 'setFlag', flag: 'annick-spared' },
      ],
      choices: [{ text: '[Take the key.]' }],
    },
  ],
} as ProjectDoc['dialogues'][number];

export const KETCH: ProjectDoc['dialogues'][number] = {
  id: KETCH_DIALOGUE,
  start: 'slate',
  nodes: [
    {
      id: 'slate',
      lines: [
        { text: 'A woman in a leather apron is scrubbing grey ash off a body laid out on the bar. She does not stop.' },
        { speaker: 'Mother Ketch', text: 'You’re for the well. I can tell by the boots. Everybody’s for the well.' },
      ],
      choices: [
        { text: 'What is down there?', goto: 'below' },
        { text: 'Who are you?', goto: 'who' },
        { text: 'We are going down.', goto: 'down' },
        { text: 'We came back up. There is a stair, past the Sump, and it goes on.', available: { kind: 'all', of: [{ kind: 'quest', quest: QUEST_ID, status: 'completed' }, { kind: 'not', of: { kind: 'quest', quest: MARKET_QUEST, status: 'completed' } }] }, goto: 'after' },
        { text: 'We have been to the Market under the Sump.', available: { kind: 'all', of: [{ kind: 'quest', quest: MARKET_QUEST, status: 'completed' }, { kind: 'not', of: { kind: 'flag', flag: 'gave-ketchs-name' } }] }, goto: 'guild' },
        { text: 'We have been to the Market under the Sump.', available: { kind: 'all', of: [{ kind: 'quest', quest: MARKET_QUEST, status: 'completed' }, { kind: 'flag', flag: 'gave-ketchs-name' }] }, goto: 'sold' },
        { text: 'We came up from the Furnace.', available: { kind: 'all', of: [{ kind: 'quest', quest: FURNACE_QUEST, status: 'completed' }, { kind: 'not', of: { kind: 'flag', flag: 'ashwell-ended' } }] }, goto: 'furnace' },
        { text: 'It is over. We burnt his ledger.', available: { kind: 'flag', flag: 'ending-burned' }, goto: 'clean' },
        { text: 'It is over. We kept his ledger.', available: { kind: 'flag', flag: 'ending-took-the-pen' }, goto: 'kept' },
        { text: 'It is over. We left him to it.', available: { kind: 'flag', flag: 'ending-left-him' }, goto: 'left' },
        { text: 'We found this in the Kennel.', available: { kind: 'all', of: [{ kind: 'hasItem', item: TAMS_RING }, { kind: 'not', of: { kind: 'flag', flag: 'returned-the-ring' } }] }, goto: 'ring' },
        { text: '[Leave her to her work.]' },
      ],
    },
    {
      id: 'who',
      lines: [
        { speaker: 'Mother Ketch', text: 'Ketch. I keep the Lantern, and I keep the slate.' },
        { text: 'She nods at a slate by the door, chalked close with names.' },
        { speaker: 'Mother Ketch', text: 'Forty-one since the stone cracked. I chalk them when they go down and wipe them when they come up. I’ve wiped three.' },
      ],
      choices: [
        { text: 'What is down there?', goto: 'below' },
        { text: 'Chalk us up. We are going down.', goto: 'down' },
      ],
    },
    {
      id: 'below',
      lines: [
        { speaker: 'Mother Ketch', text: 'The old cistern first. The Throat, we called it, when it held water. Now it holds Wellrats - our own, gone down for the dead men’s boots and never come up for air.' },
        { speaker: 'Mother Ketch', text: 'Their chief was the well-keeper. Hob Annick. He’ll be wearing his chain. He always liked his chain.' },
        { speaker: 'Mother Ketch', text: 'Past him there’s a grate, and past the grate a stair, and past the stair nobody’s said. Nobody’s been in a state to.' },
      ],
      choices: [
        { text: 'Who leaves the pages?', goto: 'pages' },
        { text: 'We are going down.', goto: 'down' },
      ],
    },
    {
      id: 'pages',
      lines: [
        { speaker: 'Mother Ketch', text: 'You’ve heard about the pages, then. Nobody leaves them. They’re just there, when you get there, saying what you did.' },
        { speaker: 'Mother Ketch', text: 'Old Vane kept the town’s book of the dead, before. Births on the left page, deaths on the right. He went down the well the winter his wife did. I always thought that was grief.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'knows-vanes-name' }],
      choices: [{ text: 'We are going down.', goto: 'down' }],
    },
    {
      id: 'down',
      lines: [
        { text: 'She wipes her hands, takes up the chalk, and writes your names on the slate, one under another. Then she presses two small stoppered bottles into the nearest hand.' },
        { speaker: 'Mother Ketch', text: 'Take those. I’d sooner wash you whole.' },
      ],
      onEnter: [
        { kind: 'startQuest', quest: QUEST_ID },
        { kind: 'setFlag', flag: 'ketch-spoke' },
        { kind: 'addItem', item: 'consumable-minor-health-potion', quantity: 2 },
      ],
      choices: [{ text: '[Go to the well.]' }],
    },
    {
      id: 'after',
      lines: [
        { text: 'Ketch looks at you a long moment, then goes to the slate and wipes your names off it, one by one.' },
        { speaker: 'Mother Ketch', text: 'Then it goes on. They always do. Rest. Eat something. It’ll keep.' },
      ],
      choices: [{ text: '[Sit down by the fire.]' }],
    },
    {
      id: 'ring',
      lines: [
        { text: 'She stops scrubbing. She takes the ring off your palm without touching your hand, and turns it to read the inside.' },
        { speaker: 'Mother Ketch', text: 'T and M. Tam and me. He went down the first winter, after his teeth went for a debt.' },
        { text: 'She puts it on her own thumb, the only finger it will go over, and goes back to scrubbing.' },
        { speaker: 'Mother Ketch', text: 'There’s a bottle under the bar. Take it. Don’t thank me, it’s not for you.' },
      ],
      onEnter: [
        { kind: 'removeItem', item: TAMS_RING, quantity: 1 },
        { kind: 'addItem', item: 'healing-draught', quantity: 1 },
        { kind: 'setFlag', flag: 'returned-the-ring' },
      ],
      choices: [{ text: '[Leave her to it.]' }],
    },
    {
      id: 'guild',
      lines: [
        { speaker: 'Mother Ketch', text: 'The Quiet Guild. They bought my husband\u2019s teeth, the winter he went down. Paid fair, too. I spent it on his stone.' },
        { speaker: 'Mother Ketch', text: 'Don\u2019t owe them anything. They never forget a debt, and they never let you forget one either.' },
      ],
      choices: [{ text: '[Sit down by the fire.]' }],
    },
    {
      id: 'sold',
      lines: [
        { speaker: 'Mother Ketch', text: 'Funny thing. I went to chalk the slate this morning and I couldn\u2019t remember my own name. Had to read it off the licence over the door.' },
        { text: 'She looks at you for a long time.' },
        { speaker: 'Mother Ketch', text: 'You\u2019d tell me. If you knew why.' },
      ],
      choices: [{ text: '[Say nothing.]' }],
    },
    {
      id: 'furnace',
      lines: [
        { text: 'Ketch counts you as you come in, the way she always does. She gets to the end and frowns, and counts again.' },
        { speaker: 'Mother Ketch', text: 'Sorry. Thought there was - no. Thought I remembered something. It\u2019s the ash. It gets in your head.' },
        { text: 'She wipes the slate. There is a name on it you do not remember chalking, and then there isn\u2019t.' },
      ],
      choices: [{ text: '[Sit down by the fire.]' }],
    },
    {
      id: 'clean',
      lines: [
        { text: 'Ketch is standing at the slate with a cloth in one hand. It is clean from edge to edge.' },
        { speaker: 'Mother Ketch', text: 'Funny. I can\u2019t think what I kept that for. There\u2019s chalk all up my sleeve.' },
        { text: 'She looks at the well for a long while.' },
        { speaker: 'Mother Ketch', text: 'It\u2019s stopped, hasn\u2019t it. The ash.' },
      ],
      choices: [{ text: '[Sit down by the fire.]' }],
    },
    {
      id: 'kept',
      lines: [
        { speaker: 'Mother Ketch', text: 'You\u2019ll be going down tonight, then. And tomorrow.' },
        { text: 'She does not ask what for. She fills a lamp and sets it by the rope.' },
        { speaker: 'Mother Ketch', text: 'I\u2019ll leave it lit.' },
      ],
      choices: [{ text: '[Sit down by the fire.]' }],
    },
    {
      id: 'left',
      lines: [
        { text: 'Ketch chalks a name on the slate, and then, after a moment, another.' },
        { speaker: 'Mother Ketch', text: 'Then I\u2019ll keep my slate, and he\u2019ll keep his. Somebody ought to.' },
      ],
      choices: [{ text: '[Sit down by the fire.]' }],
    },
  ],
} as ProjectDoc['dialogues'][number];

export const QUEST: ProjectDoc['quests'][number] = {
  id: QUEST_ID,
  name: 'Down the Ashwell',
  summary: 'The well under the Lantern & Lye has begun to breathe ash, and nobody who goes down comes back right. Mother Ketch has chalked your names on her slate.',
  objectives: [
    { id: 'go-down', text: 'Climb down the well into the Throat.', hidden: false, summary: 'You went down the rope into the old cistern.' },
    { id: 'break-the-wellrats', text: 'Deal with the Wellrats at the end of the Long Gallery.', hidden: false, summary: 'The Wellrats’ camp is yours, and their takings.' },
    { id: 'the-warden', text: 'Take the Sump Gate’s key from the Cistern Warden.', hidden: false, summary: 'Hob Annick kept the keys to everything. Now you do.' },
    { id: 'the-gate', text: 'Open the Sump Gate and find the way down.', hidden: true, summary: 'The stair goes on down, to a wall of bone and another page.' },
  ],
};
