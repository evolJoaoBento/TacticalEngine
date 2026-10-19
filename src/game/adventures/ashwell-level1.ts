/** The Ashwell: the Lantern & Lye, and Level 1, the Throat (`docs/ASHWELL.md`) - its rooms, its people, its quest. */

import { sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import type { Effect } from '../../engine/script/schema';
import { GOLD } from '../demo-items';
import { HUB_ID, THROAT_ID, KENNEL_ID, SUMP_ID, QUEST_ID, KETCH_DIALOGUE, SUMP_KEY, WARDEN_ID, MARKET_ID, MARKET_QUEST, FURNACE_QUEST, sceneFromRows, passage, afterTheFight, kindsOf } from './ashwell-kit';

// ---------------------------------------------------------------------------------------------------------------
// The Lantern & Lye
// ---------------------------------------------------------------------------------------------------------------

/** The tavern over the well: the bar along the north, the well's ring in the middle, the door to the south. */
const HUB_ROWS = [
  '################',
  '#..............#',
  '#.cccccc.......#',
  '#..............#',
  '#......ccc.....#',
  '#......c.c.....#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#######..#######',
];

/** The well's mouth, in its ring. */
const WELL = { x: 8, y: 5 };

export function hub(): SceneDoc {
  return sceneSchema.parse({
    id: HUB_ID,
    name: 'The Lantern & Lye',
    intro: 'A low room that smells of lye and lamp oil. In the middle of the floor, ringed in cracked stone, the old well breathes grey ash up into the rafters.',
    ...sceneFromRows(HUB_ROWS, kindsOf('lantern')),
    spawns: [
      { x: 7, y: 9 },
      { x: 8, y: 9 },
      { x: 7, y: 10 },
      { x: 8, y: 10 },
    ],
    decos: [
      { id: 'mother-ketch', model: 'merchant', position: { x: 4, y: 1 }, rotation: 0, solid: true, function: { kind: 'interaction', dialogue: KETCH_DIALOGUE } },
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
      { id: 'body-on-the-bar', model: 'crate-prop', position: { x: 6, y: 1 }, rotation: 0, solid: true },
      { model: 'barrel-prop', position: { x: 13, y: 1 }, rotation: 0 },
      { model: 'barrel-prop', position: { x: 14, y: 2 }, rotation: 0.4 },
      { model: 'crate-prop', position: { x: 2, y: 8 }, rotation: 0.2 },
      { model: 'crate-prop', position: { x: 13, y: 8 }, rotation: -0.3 },
      { model: 'barrel-prop', position: { x: 13, y: 9 }, rotation: 0 },
      { model: 'wall-torch-prop', position: { x: 1, y: 4 }, rotation: Math.PI / 2 },
      { model: 'wall-torch-prop', position: { x: 14, y: 4 }, rotation: -Math.PI / 2 },
      { model: 'standing-torch-prop', position: { x: 6, y: 10 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 9, y: 10 }, rotation: 0 },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Level 1: the Throat
// ---------------------------------------------------------------------------------------------------------------

/**
 * The cistern under the town, three rooms of it - a fight in each, since a fight is everyone hostile in the room it
 * is in. The Throat itself: the Shaft Foot in the north-west, where the rope ends; the Long Gallery east of it, a
 * channel of black water between two ledges; the Wellrats' camp at its end. A passage south from the shaft goes down
 * to the Kennel, and one south from the camp to the Sump, the Warden's, with the Sump Gate in its east wall and the
 * stair down behind it. Each passage ends at a stair paired with one in the room below, so a party goes down one and
 * comes up the other where it went in.
 */
const THROAT_ROWS = [
  '##############################',
  '#......#######################',
  '#..,...........,.....#.......#',
  '#......~~~~~~~~~~~~~~.....c..#',
  '#.,....~~~~~~~~~~~~~~........#',
  '#......~~~~~~~~~~~~~~..c.....#',
  '#......,.........,...........#',
  '###..#################.......#',
  '###..#################..c....#',
  '###..###################..####',
  '###..###################..####',
  '##############################',
];

const KENNEL_ROWS = [
  '############',
  '###..#######',
  '###..#######',
  '#..........#',
  '#..........#',
  '#...,......#',
  '#..........#',
  '#.........,#',
  '#..........#',
  '#..........#',
  '############',
];

const SUMP_ROWS = [
  '##############',
  '#######..#####',
  '#######..#####',
  '#..........###',
  '#..........###',
  '#..~~~~....###',
  '#.~~~~~....###',
  '#..~~~~......#',
  '#..........###',
  '#....c.....###',
  '#..........###',
  '##############',
];

/** Where the Throat's ways out are, and the Sump's gate and stair. */
const STAIR_UP = { x: 1, y: 1 };
const GATE = { x: 11, y: 7 };
const STAIR_DOWN = { x: 12, y: 7 };

/**
 * The Sump's stair down: the first time, the end of Level 1 - Vane's second page, the quest done, a level gained - and
 * the way into Level 2, its quest begun; every time after, simply the way down to the Market.
 */
const DOWN: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'level-1-done' },
    then: [{ kind: 'goto', scene: MARKET_ID }],
    otherwise: [
      { kind: 'completeObjective', quest: QUEST_ID, objective: 'the-gate' },
      {
        kind: 'story',
        title: 'Entry 4,113',
        paragraphs: [
          'The stair goes down past the gate in a tight spiral, and at the bottom of the third turn it stops at a wall of bone - skulls set like bricks, mortared with ash - with a door cut in it. Pinned to the door at eye height is another page, the ink still wet.',
          '"They opened Annick\u2019s gate with Annick\u2019s key, which was taken from Annick, who did not give it. The Market has been told they are coming. Let them be polite. It costs nothing down here, and it buys a great deal."',
          'Before you can knock, the door is opened from the other side by somebody in a grey apron, who bows.',
        ],
        button: 'Go through',
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
        position: { x: 5, y: 1 },
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
                '"Annick’s people are at the end of the gallery. They will hear the water move. Annick himself is in the Sump, where it is deepest. He used to keep this well clean. He was proud of it."',
                'It is signed with a single initial, a V, very neat.',
              ],
              button: 'Tear it down',
            },
            { kind: 'setFlag', flag: 'read-vanes-page' },
          ],
        },
      },
      { model: 'rock-prop', position: { x: 4, y: 4 }, rotation: 0.6 },
      { model: 'barrel-prop', position: { x: 1, y: 5 }, rotation: 0 },
      // The Wellrats' camp.
      { id: 'wellrat-fire', model: 'camp-fire-prop', position: { x: 25, y: 4 }, rotation: 0, solid: true },
      { model: 'cart-prop', position: { x: 27, y: 2 }, rotation: 1.2 },
      { model: 'barrel-prop', position: { x: 28, y: 7 }, rotation: 0 },
      {
        id: 'wellrat-takings',
        model: 'crate-prop',
        position: { x: 28, y: 3 },
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
      passage('down-to-the-kennel', 'throat-kennel', { x: 3, y: 10 }, 0),
      passage('down-to-the-sump', 'throat-sump', { x: 24, y: 10 }, 0),
    ],
    encounters: [
      {
        id: 'wellrats',
        name: 'The Wellrats',
        // Where the gallery opens into the camp.
        triggerCells: [2, 3, 4, 5, 6].map((y) => ({ x: 22, y })),
        adversaries: [
          { id: 'wellrat-cutter-1', adversary: 'bandit-cutter', name: 'Wellrat Cutter', position: { x: 24, y: 3 } },
          { id: 'wellrat-cutter-2', adversary: 'bandit-cutter', name: 'Wellrat Cutter', position: { x: 24, y: 6 } },
          { id: 'wellrat-slinger', adversary: 'bandit-archer', name: 'Wellrat Slinger', position: { x: 27, y: 5 } },
        ],
      },
    ],
  });
}

export function kennel(): SceneDoc {
  return sceneSchema.parse({
    id: KENNEL_ID,
    name: 'The Kennel',
    intro: 'The passage opens on a low, wet room that stinks of old meat. The floor is gnawed bone from wall to wall, and something in the far corner is breathing.',
    ...sceneFromRows(KENNEL_ROWS, kindsOf('throat')),
    spawns: [
      { x: 4, y: 1 },
      { x: 4, y: 2 },
    ],
    decos: [
      passage('up-from-the-kennel', 'throat-kennel', { x: 3, y: 1 }, Math.PI),
      { model: 'rock-prop', position: { x: 9, y: 4 }, rotation: 2.1 },
      { model: 'crate-prop', position: { x: 1, y: 9 }, rotation: 0 },
      {
        id: 'kennel-chest',
        model: 'chest-prop',
        position: { x: 2, y: 9 },
        rotation: 0,
        solid: true,
        function: { kind: 'container', items: [{ item: 'consumable-minor-health-potion', count: 2 }, { item: GOLD, count: 12 }] },
      },
    ],
    encounters: [
      {
        id: 'the-kennel',
        name: 'The Kennel',
        // The foot of the passage.
        triggerCells: [3, 4].map((x) => ({ x, y: 3 })),
        adversaries: [
          { id: 'kennel-hounds', adversary: 'rot-hound', name: 'Kennel Hounds', position: { x: 6, y: 6 } },
          { id: 'thing-in-the-wet', adversary: 'fen-lurker', name: 'The Thing in the Wet', position: { x: 9, y: 8 } },
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
    ...sceneFromRows(SUMP_ROWS, kindsOf('throat')),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
    ],
    decos: [
      passage('up-from-the-sump', 'throat-sump', { x: 7, y: 1 }, Math.PI),
      { model: 'standing-torch-prop', position: { x: 1, y: 4 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 10, y: 4 }, rotation: 0 },
      {
        id: 'wardens-strongbox',
        model: 'chest-prop',
        position: { x: 9, y: 10 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'chest',
          name: 'The Warden’s strongbox',
          flavor: 'An iron box chained to the floor with well-chain. Annick kept the keys to everything.',
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
        // The foot of the passage from the camp.
        triggerCells: [7, 8].map((x) => ({ x, y: 3 })),
        adversaries: [
          { id: 'hob-annick', adversary: WARDEN_ID, name: 'Hob Annick, the Cistern Warden', model: 'bandit-captain', position: { x: 8, y: 8 } },
          { id: 'lamp-moths', adversary: 'grave-moth', name: 'Lamp Moths', position: { x: 4, y: 4 } },
          { id: 'sump-cutter', adversary: 'bandit-cutter', name: 'Wellrat Cutter', position: { x: 3, y: 9 } },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Its people
// ---------------------------------------------------------------------------------------------------------------

/** Hob Annick, once Hallowmere's well-keeper, now the Wellrats' chief: a leader, and the level's boss. */
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
  features: [],
} as AdversaryDef;

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
