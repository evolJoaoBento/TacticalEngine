/**
 * The room beyond the vault.
 *
 * Authored as document data and parsed through `sceneSchema`, the way a project
 * file would hold it — the demo's other scene comes from the legacy importer, so
 * this is also a check that a hand-written scene and an imported one are the same
 * kind of thing.
 *
 * Small on purpose: what it exists to prove is that the party can leave a room
 * and come back to find it as they left it.
 */

import { DEFAULT_TERRAIN_TYPES } from '../engine/grid/terrain';
import { buildingKey, type BuildingTile } from '../engine/scene/building';
import { encounterSchema, sceneSchema, type Encounter, type ProjectDoc, type SceneDoc } from '../engine/scene/schema';
import { OBJECTIVE_OPEN_THE_STRONGBOX, WARDENS_WORD_QUEST } from './demo-quests';
import { DEMO_ADVERSARIES, DEMO_LINE_UP_ID, DEMO_LINE_UP_ROWS, DEMO_LINE_UP_X } from './demo-rules';

export const PIT_SCENE_ID = 'the-pit';

const W = 10;
const H = 8;

/** A ring of wall around an open floor, with a ledge along the north wall. */
function terrain(): string[] {
  const tiles: string[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      tiles.push(edge ? 'wall' : 'floor');
    }
  }
  return tiles;
}

function heights(): number[] {
  const levels: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      // The south wall is the one the camera looks through, so it is a lip rather
      // than a wall — a room whose own party is hidden behind masonry is not a
      // room anyone can play. The rest stand tall.
      const south = y === H - 1;
      levels.push(edge ? (south ? 1 : 4) : y === 1 ? 1 : 0);
    }
  }
  return levels;
}

export const PIT_SCENE: SceneDoc = sceneSchema.parse({
  id: PIT_SCENE_ID,
  name: 'The Sounding Pit',
  intro:
    'The stair gives out into a round chamber. Water moves somewhere below, and the walls carry every sound twice.',
  width: W,
  height: H,
  terrain: terrain(),
  heights: heights(),
  spawns: [
    { x: 2, y: 6 },
    { x: 3, y: 6 },
    { x: 4, y: 6 },
  ],
  decos: [
    { model: 'crate-prop', position: { x: 7, y: 5 }, rotation: 0 },
    { model: 'barrel-prop', position: { x: 8, y: 5 }, rotation: 0 },
    { model: 'camp-fire-prop', position: { x: 5, y: 3 }, rotation: 0 },
  ],
  interactables: [
    {
      id: 'stair-up',
      kind: 'portal',
      position: { x: 2, y: 5 },
      name: 'The stair up',
      flavor: 'The steps you came down. They go back.',
      blocksMovement: false,
      model: null,
      // Filled in by the demo builder, which is the only thing that knows the
      // vault's imported id.
      effects: [],
    },
    {
      id: 'strongbox',
      kind: 'chest',
      position: { x: 7, y: 2 },
      name: 'A banded strongbox',
      flavor: 'Someone left in a hurry, and left this behind.',
      // The key the Warden gives up, if the party talked it round.
      requiresKey: 'wardens-word',
      lockedText: 'The lid will not shift. Whatever holds it is not a lock.',
      effects: [
        { kind: 'log', text: 'The word you were given does the work for you.', tone: 'good' },
        { kind: 'loot', table: 'pit-strongbox' },
        {
          kind: 'completeObjective',
          quest: WARDENS_WORD_QUEST,
          objective: OBJECTIVE_OPEN_THE_STRONGBOX,
        },
        { kind: 'completeQuest', quest: WARDENS_WORD_QUEST },
        // A milestone: the GM says the party has earned a level.
        { kind: 'levelUp' },
      ],
    },
  ],
});

/**
 * One of every stat block the pack ships, stood along the vault's back wall to be looked at: what
 * each is drawn with, how big it stands, what its card says.
 *
 * An encounter of their own that nothing starts, and `bystanders`: a fight counts every adversary
 * in the room whichever encounter placed it, so these are stood up on nobody's side. They are
 * scenery with stat blocks, and the fight in the room is still the three husks it always was. Here rather than in the legacy map because that map is the prototype's and is never
 * edited; `buildDemoScene` adds this to the vault the way it adds the stair.
 */
export function lineUp(): Encounter {
  return encounterSchema.parse({
    id: DEMO_LINE_UP_ID,
    name: 'The line-up',
    startsOnTrigger: false,
    bystanders: true,
    // As many as there are places along the wall: a pack that grows past that gets a longer wall
    // here, not two creatures stood on one tile.
    adversaries: [...DEMO_ADVERSARIES.keys()].slice(0, DEMO_LINE_UP_ROWS.length).map((adversary, at) => ({
      id: `${DEMO_LINE_UP_ID}-${adversary}`,
      adversary,
      position: { x: DEMO_LINE_UP_X, y: DEMO_LINE_UP_ROWS[at]! },
    })),
  });
}

/**
 * The kinds of tile the demo is laid from: the engine's own, and four of the demo's.
 *
 * `rampart` is the stone block as a wall nobody climbs, for a room that needs one: a kind that
 * says `passable: false` stops feet and arcs whatever its height. The vault's own wall is not
 * that. It is plain blocks, two high, and the rule for height is the only rule it has - so
 * whoever is strong enough jumps onto it, and the door is for everybody else.
 *
 * `flagstone` is the stone block's file as a floor tile - fitted to a floor's height, as any
 * file is to its structure - so indoors is not a lawn. `road` is the dirt ground's file as a
 * floor that costs what the legacy map's difficult ground did. The cover that map had is half a
 * block of the engine's own `barrier`, the stone wall, which shelters whoever stands by it and is
 * stepped over; it had a `low-wall` kind of its own until that was folded into the stone wall.
 */
export const DEMO_TERRAIN: NonNullable<ProjectDoc['terrainPalette']> = [
  ...DEFAULT_TERRAIN_TYPES.map((type) => ({
    id: type.id,
    name: type.name,
    passable: type.passable,
    cost: Number.isFinite(type.cost) ? type.cost : 1,
    providesCover: type.providesCover,
    blocksSight: type.blocksSight,
    ...(type.color === undefined ? {} : { color: type.color }),
    ...(type.model === undefined ? {} : { model: type.model }),
    ...(type.scale === undefined ? {} : { scale: type.scale }),
    ...(type.structure === undefined ? {} : { structure: type.structure }),
  })),
  { id: 'rampart', name: 'Stone Block (impassable)', passable: false, cost: 1, providesCover: false, blocksSight: true, structure: 'block', model: 'stone-block', scale: 1, color: '#3b3f4a' },
  { id: 'flagstone', name: 'Stone Block (floor)', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'floor', model: 'stone-block', scale: 1, color: '#8a8994' },
  { id: 'road', name: 'Dirt Ground', passable: true, cost: 2, providesCover: false, blocksSight: false, structure: 'floor', model: 'dirt-ground', scale: 1, color: '#6b6350' },
  // Where the road gives out into the grass: grass with the dirt showing through, walked like grass.
  { id: 'grass-dirt', name: 'Grass Dirt Ground', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'floor', model: 'grass-dirt-ground', scale: 1, color: '#6f7a4c' },
];

/** The column the vault's wall stands in: from here east is indoors. */
export const DEMO_VAULT_WALL_X = 12;

/** How many blocks a wall stands above the floor. */
const WALL_BLOCKS = 2;
/** The level a floor's top is at, which is where everything standing on the floor starts. */
const FLOOR_TOP = 0.25;

/**
 * Relay a room painted as ground with tiles: the same room, cell for cell, as pieces.
 *
 * The legacy maps say what a cell is with a terrain id and how high it stands with a number
 * of slabs, and a wall is ground that happens to be tall. Here every cell is a floor tile
 * with whatever stands on it stacked above, the painted ground goes flat and plain
 * underneath, and what can be walked, climbed or jumped is read off how high the pieces
 * stand - which is how a room somebody builds in the editor is read, so the demo is one.
 *
 * A wall becomes a stack of blocks, as high as `WALL_BLOCKS` and as climbable as that is. Two slabs of height, the vault's dais,
 * become a block: a jump up from the floor. One slab is a bump - a second floor tile - unless
 * it leads up to a block, and then it is what it always was for, the steps. `indoors` says
 * which floor is flagstone rather than grass, and `beaten` which is laid as road - a trail
 * through a wood is easy going that looks like a road, and a thicket is hard going that looks
 * like the wood it is, so how a tile is walked and how it is laid are asked separately.
 */
export function groundAsTiles(
  scene: SceneDoc,
  indoors: (x: number, y: number) => boolean,
  beaten: (x: number, y: number) => boolean = () => false,
): void {
  const pieces: Record<string, BuildingTile> = { ...(scene.buildingTiles ?? {}) };
  const put = (x: number, y: number, level: number, tile: string, shape: string, rotation = 0, height?: number): void => {
    const piece: BuildingTile = { x, y, level, shape, material: 'stone', rotation, tile, ...(height === undefined ? {} : { height }) };
    pieces[buildingKey(piece)] = piece;
  };
  // Which way a flight climbs: towards the block beside it. Rotation 0 ascends to the south.
  const ASCENTS: readonly [number, number, number][] = [[0, 1, 0], [1, 0, 1], [0, -1, 2], [-1, 0, 3]];
  const was = scene.heights.slice();
  const slabs = (x: number, y: number): number => (x < 0 || y < 0 || x >= scene.width || y >= scene.height ? 0 : was[y * scene.width + x]!);
  const walled = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < scene.width && y < scene.height && scene.terrain[y * scene.width + x] === 'wall';
  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) {
      const at = y * scene.width + x;
      const kind = scene.terrain[at]!;
      const inside = indoors(x, y);
      put(x, y, 0, inside || kind === 'wall' ? 'flagstone' : kind === 'difficult' || beaten(x, y) ? 'road' : 'platform', 'floor');
      if (kind === 'wall') {
        for (let n = 0; n < WALL_BLOCKS; n++) put(x, y, FLOOR_TOP + n, 'block', 'block');
      } else if (was[at]! >= 2) put(x, y, FLOOR_TOP, 'block', 'block');
      else if (was[at] === 1) {
        const up = ASCENTS.find(([dx, dy]) => !walled(x + dx, y + dy) && slabs(x + dx, y + dy) >= 2);
        if (up === undefined) put(x, y, FLOOR_TOP, 'platform', 'floor');
        else put(x, y, FLOOR_TOP, 'steps', 'stairs', up[2]);
      }
      if (kind === 'cover') put(x, y, FLOOR_TOP, 'barrier', 'wall');
      scene.terrain[at] = 'floor';
      scene.heights[at] = 0;
    }
  }
  scene.buildingTiles = pieces;
}
