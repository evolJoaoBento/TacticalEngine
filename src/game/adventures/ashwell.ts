/**
 * The Ashwell (`docs/ASHWELL.md`): a grim megadungeon of the engine's own, in five levels under the drowned town of
 * Hallowmere, built in code as a project document - the hub, the Lantern & Lye, and Level 1, the Throat, so far.
 *
 * Its maps are drawn as rows of characters (`sceneFromRows`): a wall, a floor, black water, rubble, a low wall to
 * crouch behind. Its people, its quest and its fights are written out below. It is played with the demo's party and
 * everything their cards need, begun from the main menu (**The Ashwell**), which keeps it as a game of its own.
 */

import { buildingKey, type BuildingTile } from '../../engine/scene/building';
import { projectSchema, sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import type { Effect } from '../../engine/script/schema';
import { SRD_CONDITIONS } from '../../engine/content/conditions';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../../engine/content/pack/starter';
import { DEMO_ITEMS, GOLD } from '../demo-items';
import { DEMO_TERRAIN } from '../demo-scenes';
import { DEMO_CODE, DEMO_PROJECT_ABILITIES, DEMO_PROJECT_CARDS } from '../demo-code';
import { DEMO_WEAPONS, PARTY_SHEETS } from '../demo-rules';
import { SHIPPED_MODELS } from '../project-open';

export const ASHWELL_ID = 'the-ashwell';
export const HUB_ID = 'lantern-and-lye';
export const THROAT_ID = 'the-throat';
export const KENNEL_ID = 'the-kennel';
export const SUMP_ID = 'the-sump';
export const QUEST_ID = 'down-the-ashwell';
export const KETCH_DIALOGUE = 'mother-ketch';
export const SUMP_KEY = 'sump-key';
export const WARDEN_ID = 'cistern-warden';

/** What each character of a map is. */
export type Cell = 'wall' | 'floor' | 'water' | 'rubble' | 'cover';

/** The characters a map is drawn in. */
export const LEGEND: Readonly<Record<string, Cell>> = { '#': 'wall', '.': 'floor', '~': 'water', ',': 'rubble', c: 'cover' };

/** How many blocks a wall stands, and where a floor's top is. */
const WALL_BLOCKS = 2;
const FLOOR_TOP = 0.25;

/**
 * A room drawn as rows of characters (`LEGEND`), as a scene's ground: every cell a floor piece - stone, or rubble,
 * which is slow - with a wall's blocks or a low wall stood on it, on bedrock; black water left as ground, below the
 * floor's top and slow to wade. The bedrock is dark, as the water is: the ground's colours blend from cell to cell,
 * and a lawn's green under the stone showed round every pool. Throws on a row of the wrong length or a character the legend has not got.
 */
export function sceneFromRows(rows: readonly string[]): Pick<SceneDoc, 'width' | 'height' | 'terrain' | 'heights' | 'buildingTiles'> {
  const width = rows[0]?.length ?? 0;
  const height = rows.length;
  const terrain: string[] = [];
  const pieces: Record<string, BuildingTile> = {};
  const put = (x: number, y: number, level: number, tile: string, shape: string): void => {
    const piece: BuildingTile = { x, y, level, shape, material: 'stone', rotation: 0, tile };
    pieces[buildingKey(piece)] = piece;
  };
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y} is ${row.length} wide, not ${width}`);
    [...row].forEach((char, x) => {
      const cell = LEGEND[char];
      if (cell === undefined) throw new Error(`"${char}" at ${x},${y} is not in the legend`);
      terrain.push(cell === 'water' ? 'black-water' : 'bedrock');
      if (cell === 'water') return;
      put(x, y, 0, cell === 'rubble' ? 'road' : 'flagstone', 'floor');
      if (cell === 'wall') for (let n = 0; n < WALL_BLOCKS; n++) put(x, y, FLOOR_TOP + n, 'rampart', 'block');
      if (cell === 'cover') put(x, y, FLOOR_TOP, 'barrier', 'wall');
    });
  });
  return { width, height, terrain, heights: terrain.map(() => 0), buildingTiles: pieces };
}

/** The kinds of tile it is laid with: the demo's, the bedrock under the stone, and the black water of the cistern. */
const PALETTE: NonNullable<ProjectDoc['terrainPalette']> = [
  ...DEMO_TERRAIN,
  { id: 'bedrock', name: 'Bedrock', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#26272b' },
  { id: 'black-water', name: 'Black Water', passable: true, cost: 2, providesCover: false, blocksSight: false, color: '#16242a' },
];

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

function hub(): SceneDoc {
  return sceneSchema.parse({
    id: HUB_ID,
    name: 'The Lantern & Lye',
    intro: 'A low room that smells of lye and lamp oil. In the middle of the floor, ringed in cracked stone, the old well breathes grey ash up into the rafters.',
    ...sceneFromRows(HUB_ROWS),
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

/** A stair down a passage, paired with the one at the other end: a step through either comes out by the other. */
function passage(id: string, pair: string, position: { x: number; y: number }, rotation: number): SceneDoc['decos'][number] {
  return { id, model: 'stone-stairs', position, rotation, solid: true, function: { kind: 'portal', pair } };
}

/** The way down, and the end of the level: Vane's second page, the quest done, a level gained, and the climb back. */
const DOWN: Effect[] = [
  { kind: 'completeObjective', quest: QUEST_ID, objective: 'the-gate' },
  {
    kind: 'story',
    title: 'Entry 4,113',
    paragraphs: [
      'The stair goes down past the gate in a tight spiral, and at the bottom of the third turn it stops at a wall of bone - skulls set like bricks, mortared with ash. Pinned to it at eye height is another page, the ink still wet.',
      '"They opened Annick’s gate with Annick’s key, which was taken from Annick, who did not give it. The Market is not ready for them yet. I will tell them when it is. Let them go up, and wash, and be afraid in the light for a while. It improves the writing."',
      'You climb back up the Throat with the Warden’s blood drying on your boots. Behind you, very faintly, someone is turning a page.',
    ],
    button: 'Climb back up',
  },
  { kind: 'completeQuest', quest: QUEST_ID },
  { kind: 'levelUp' },
  { kind: 'goto', scene: HUB_ID },
];

/** A chest that waits for a fight to be over: what it gives, or what is said while the fight is not. */
function afterTheFight(encounter: string, gives: Effect[], meanwhile: string): Effect[] {
  return [
    {
      kind: 'branch',
      when: { kind: 'encounter', id: encounter, state: 'ended' },
      then: [...gives, { kind: 'markUsed' }],
      otherwise: [{ kind: 'log', text: meanwhile, tone: 'bad' }],
    },
  ];
}

function throat(): SceneDoc {
  return sceneSchema.parse({
    id: THROAT_ID,
    name: 'The Throat',
    intro: 'The rope ends on a heap of what fell before you: boots, a lantern, a hand. Water drips somewhere ahead in the dark, and the ash hangs in the air like breath on a cold morning.',
    ...sceneFromRows(THROAT_ROWS),
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

function kennel(): SceneDoc {
  return sceneSchema.parse({
    id: KENNEL_ID,
    name: 'The Kennel',
    intro: 'The passage opens on a low, wet room that stinks of old meat. The floor is gnawed bone from wall to wall, and something in the far corner is breathing.',
    ...sceneFromRows(KENNEL_ROWS),
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

function sump(): SceneDoc {
  return sceneSchema.parse({
    id: SUMP_ID,
    name: 'The Sump',
    intro: 'The cistern’s deepest chamber. Lamps hang from chains over black water, and moths the size of hands turn in their smoke. On a platform of stacked doors sits a broad man wrapped in rusted chain.',
    ...sceneFromRows(SUMP_ROWS),
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
        function: { kind: 'script', object: 'portal', name: 'The stair down', flavor: 'A tight spiral, going down. The ash is thicker here.', effects: DOWN },
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
// Its people, its quest and what it pays
// ---------------------------------------------------------------------------------------------------------------

/** Hob Annick, once Hallowmere's well-keeper, now the Wellrats' chief: a leader, and the level's boss. */
const CISTERN_WARDEN: AdversaryDef = {
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

const KETCH: ProjectDoc['dialogues'][number] = {
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
        { text: 'We came back up. There is a stair, past the Sump, and it goes on.', available: { kind: 'quest', quest: QUEST_ID, status: 'completed' }, goto: 'after' },
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
  ],
} as ProjectDoc['dialogues'][number];

const QUEST: ProjectDoc['quests'][number] = {
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

/** The level's few things of its own: the gate's key, and what its two chests pay out. */
const ITEMS: ProjectDoc['items'] = [
  { id: SUMP_KEY, name: 'Sump Gate Key', kind: 'key', description: 'A heavy iron key on a loop of well-chain, black with handling.', stackable: false, use: [] },
] as ProjectDoc['items'];

const LOOT: ProjectDoc['lootTables'] = [
  {
    id: 'wellrat-takings',
    rolls: 2,
    entries: [
      { item: GOLD, quantity: { min: 4, max: 12 }, weight: 4 },
      { item: 'consumable-minor-stamina-potion', quantity: 1, weight: 2 },
      { item: 'consumable-minor-health-potion', quantity: 1, weight: 2 },
    ],
  },
  {
    id: 'wardens-hoard',
    rolls: 2,
    entries: [
      { item: GOLD, quantity: { min: 15, max: 30 }, weight: 4 },
      { item: 'secondary-round-shield', quantity: 1, weight: 1 },
      { item: 'armor-chainmail-armor', quantity: 1, weight: 1 },
      { item: 'consumable-minor-health-potion', quantity: 1, weight: 2 },
    ],
  },
] as ProjectDoc['lootTables'];

/** What it keeps of the demo's things: its gold, its draught and the arms its party carry - none of the vault's story. */
const KEPT_ITEMS = new Set([GOLD, 'healing-draught', 'longsword', 'round-shield']);

/** The party that goes down: four of the demo's company. */
const PARTY = PARTY_SHEETS.slice(0, 4);

/** The Ashwell, as a project: the hub and the levels built so far, the demo's party, and everything their cards need. */
export function ashwellProject(): ProjectDoc {
  return projectSchema.parse({
    id: ASHWELL_ID,
    name: 'The Ashwell',
    terrainPalette: PALETTE,
    scenes: [hub(), throat(), kennel(), sump()],
    dialogues: [KETCH],
    items: [...DEMO_ITEMS.filter((item) => KEPT_ITEMS.has(item.id)), ...ITEMS],
    lootTables: LOOT,
    quests: [QUEST],
    adversaries: [CISTERN_WARDEN],
    cards: [...DEMO_PROJECT_CARDS],
    abilities: [...STARTER_ABILITIES, ...DEMO_PROJECT_ABILITIES],
    code: [...DEMO_CODE],
    conditionDefs: [...STARTER_CONDITIONS, ...SRD_CONDITIONS.filter((c) => !STARTER_CONDITIONS.some((s) => s.id === c.id))],
    party: [...PARTY],
    assets: [...SHIPPED_MODELS],
    weapons: [...DEMO_WEAPONS],
    startScene: HUB_ID,
  });
}
