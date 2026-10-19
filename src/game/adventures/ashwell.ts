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
export const MARKET_ID = 'ossuary-market';
export const PIT_ID = 'charnel-pit';
export const COUNTING_ID = 'counting-house';
export const MARKET_QUEST = 'the-ossuary-market';
export const GRALE_DIALOGUE = 'usher-grale';
export const SELA_DIALOGUE = 'sela-marrow';
export const GUILD_MARK = 'guild-mark';
export const BONE_KEY = 'bone-key';
export const GHOUL_ID = 'pit-ghoul';
export const BROKER_ID = 'bone-broker';

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

/** The level's ends: the way down past the Bone Door, closing the level with Vane's page, a level and the climb back. */
const LIBRARY_STAIR: Effect[] = [
  { kind: 'completeObjective', quest: MARKET_QUEST, objective: 'the-way-down' },
  {
    kind: 'story',
    title: 'Entry 4,120',
    paragraphs: [
      'The stair below the Bone Door is cut through older stone, and it is wet. Twenty steps down, the water begins: black and still, up to the ceiling, with pages drifting in it like slow fish. Something down there is reading aloud.',
      'A page is pinned above the waterline, dry. "They were offered the Broker’s terms, and the Factor’s prices, and Grale’s little errand in the pit. They took the errand first. People always do; it feels like earning. The Library will drain when I have finished reading to it. Go up. Come back. I will have your pages ready."',
      'You climb. Through the Market, where the Guild nods to you now; through the Sump, through the Throat, up the rope, into the Lantern’s light. Ketch looks at your faces and puts the kettle on.',
    ],
    button: 'Climb back up',
  },
  { kind: 'completeQuest', quest: MARKET_QUEST },
  { kind: 'levelUp' },
  { kind: 'goto', scene: HUB_ID },
];

function market(): SceneDoc {
  return sceneSchema.parse({
    id: MARKET_ID,
    name: 'The Ossuary Market',
    intro: 'Lamps of yellow fat burn along stalls of stacked bone. People in grey aprons weigh teeth on little brass scales and write in ledgers, and nobody raises their voice. Somewhere a bell hangs silent on a rope.',
    ...sceneFromRows(MARKET_ROWS),
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

function pit(): SceneDoc {
  return sceneSchema.parse({
    id: PIT_ID,
    name: 'The Charnel Pit',
    intro: 'The old burial pit under the market. Bones are heaped against the walls in drifts, and a pool of black water fills the middle. A bell-rope hangs down from a hole in the ceiling. The heaps are moving.',
    ...sceneFromRows(PIT_ROWS),
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

function countingHouse(): SceneDoc {
  // They start out on nobody's side, and talk: Sela's dialogue, whoever is spoken to.
  const talks = { kind: 'friendly', dialogue: SELA_DIALOGUE } as const;
  return sceneSchema.parse({
    id: COUNTING_ID,
    name: 'The Counting House',
    intro: 'A long, warm room of ledgers. A woman with bone rings on every finger sits behind a desk of stacked jawbones, writing. She does not look up. "Sit, if you like. Stand, if you are not staying."',
    ...sceneFromRows(COUNTING_ROWS),
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
        function: { kind: 'script', object: 'portal', name: 'The wet stair', flavor: 'Down, into water and the sound of reading.', effects: LIBRARY_STAIR },
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
// Its people, its quests and what they pay
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
        { text: 'We came back up. There is a stair, past the Sump, and it goes on.', available: { kind: 'all', of: [{ kind: 'quest', quest: QUEST_ID, status: 'completed' }, { kind: 'not', of: { kind: 'quest', quest: MARKET_QUEST, status: 'completed' } }] }, goto: 'after' },
        { text: 'We have been to the Market under the Sump.', available: { kind: 'all', of: [{ kind: 'quest', quest: MARKET_QUEST, status: 'completed' }, { kind: 'not', of: { kind: 'flag', flag: 'gave-ketchs-name' } }] }, goto: 'guild' },
        { text: 'We have been to the Market under the Sump.', available: { kind: 'all', of: [{ kind: 'quest', quest: MARKET_QUEST, status: 'completed' }, { kind: 'flag', flag: 'gave-ketchs-name' }] }, goto: 'sold' },
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

/** The dead the Guild has not sold yet, come up from the pit when the bell rings: a tier-2 standard. */
const PIT_GHOUL: AdversaryDef = {
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
const BONE_BROKER: AdversaryDef = {
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

const GRALE: ProjectDoc['dialogues'][number] = {
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

const SELA: ProjectDoc['dialogues'][number] = {
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

const MARKET_QUEST_DEF: ProjectDoc['quests'][number] = {
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

/** The adventure's few things of its own: the keys, and what its chests pay out. */
const ITEMS: ProjectDoc['items'] = [
  { id: SUMP_KEY, name: 'Sump Gate Key', kind: 'key', description: 'A heavy iron key on a loop of well-chain, black with handling.', stackable: false, use: [] },
  { id: GUILD_MARK, name: 'The Guild\u2019s Mark', kind: 'key', description: 'A grey thumbprint on the back of a hand, from Usher Grale. It does not wash off.', stackable: false, use: [] },
  { id: BONE_KEY, name: 'Bone Key', kind: 'key', description: 'A key carved from a single long bone, smooth as a joint: the Bone Door\u2019s.', stackable: false, use: [] },
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
  {
    id: 'brokers-box',
    rolls: 2,
    entries: [
      { item: GOLD, quantity: { min: 30, max: 60 }, weight: 4 },
      { item: 'armor-chainmail-armor', quantity: 1, weight: 1 },
      { item: 'consumable-minor-health-potion', quantity: 2, weight: 2 },
    ],
  },
] as ProjectDoc['lootTables'];

/** What it keeps of the demo's things: its gold, its draught and the arms its party carry - none of the vault's story. */
const KEPT_ITEMS = new Set([GOLD, 'healing-draught', 'longsword', 'round-shield']);

/** The party that goes down: four of the demo's company. */
const PARTY = PARTY_SHEETS.slice(0, 4);

/** The Ashwell, as a project: the hub and the levels built so far (two), the demo's party, and everything their cards need. */
export function ashwellProject(): ProjectDoc {
  return projectSchema.parse({
    id: ASHWELL_ID,
    name: 'The Ashwell',
    terrainPalette: PALETTE,
    scenes: [hub(), throat(), kennel(), sump(), market(), pit(), countingHouse()],
    dialogues: [KETCH, GRALE, SELA],
    items: [...DEMO_ITEMS.filter((item) => KEPT_ITEMS.has(item.id)), ...ITEMS],
    lootTables: LOOT,
    quests: [QUEST, MARKET_QUEST_DEF],
    adversaries: [CISTERN_WARDEN, PIT_GHOUL, BONE_BROKER],
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
