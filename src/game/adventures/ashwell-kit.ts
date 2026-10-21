/**
 * The Ashwell's kit (`ashwell.ts`, `docs/ASHWELL.md`): the ids every level shares, the map drawn as rows of characters
 * (`sceneFromRows`) and the kinds of tile it is laid with, the stair paired across two rooms, and the chest that waits
 * for its room's fight to be over.
 */

import { buildingKey, type BuildingTile } from '../../engine/scene/building';
import type { TileSurface } from '../../engine/scene/schema';
import type { ProjectDoc, SceneDoc } from '../../engine/scene/schema';
import type { Effect } from '../../engine/script/schema';
import { DEMO_TERRAIN } from '../demo-scenes';

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
export const READING_ID = 'reading-room';
export const STACKS_ID = 'wet-stacks';
export const INDEX_ID = 'index-vault';
export const LIBRARY_QUEST = 'the-drowned-library';
export const AUD_DIALOGUE = 'aud-brennock';
export const KINDLING = 'auds-tinder';
export const YOUR_PAGE = 'your-page';
export const INK_WRAITH_ID = 'ink-wraith';
export const INDEX_BOSS_ID = 'undertow-index';
export const NAVE_ID = 'ash-nave';
export const GALLERY_ID = 'coal-gallery';
export const HALL_ID = 'furnace-hall';
export const FURNACE_QUEST = 'the-furnace-of-names';
export const ILSE_DIALOGUE = 'ilse-grey';
export const STOKER_ID = 'iron-stoker';
export const SAINT_ID = 'bellows-saint';
export const THRONE_ID = 'ledger-throne';
export const THRONE_QUEST = 'the-ledger-throne';
export const VANE_DIALOGUE = 'orsolde-vane';
export const VANE_ID = 'sallow-archivist';


/** What each character of a map is. */
export type Cell = 'wall' | 'floor' | 'water' | 'rubble' | 'cover' | 'raised' | 'stair' | 'boards' | 'deck';

/**
 * The characters a map is drawn in: a wall, floor, water (below the floor, slow to wade), rubble (slow), a low wall to
 * take cover behind; floor raised a block's height (`^` - a ledge, a dais, a heap the rope ends on), a stair up to it
 * (`/`, turned to climb toward the raised floor beside it), boards laid on the floor (`=`), and boards raised (`B` - a
 * platform of planks, or of stacked doors).
 */
export const LEGEND: Readonly<Record<string, Cell>> = { '#': 'wall', '.': 'floor', '~': 'water', ',': 'rubble', c: 'cover', '^': 'raised', '/': 'stair', '=': 'boards', B: 'deck' };

/**
 * Furniture a map draws in characters of its own: one piece of a kind (`FURNITURE`) stood on the floor - a counter, a
 * shelf, a pew, a furnace - a block, or a wall (a slab along one edge of its tile, turned by `rotation`), stretched to
 * `height` blocks.
 */
export interface Furniture {
  kind: keyof typeof FURNITURE;
  shape: 'block' | 'wall';
  height: number;
  rotation?: number;
}

/** How many blocks a wall stands, and where a floor's top is. */
const WALL_BLOCKS = 2;
const FLOOR_TOP = 0.25;

/** The kinds of tile a level's rows are laid with: what a wall, a floor, rubble and a low wall are, in that level. */
export interface Kinds {
  wall: string;
  floor: string;
  rubble: string;
  cover: string;
}

/** The demo's stone, for a map drawn without a look of its own. */
const STONE: Kinds = { wall: 'rampart', floor: 'flagstone', rubble: 'road', cover: 'barrier' };

/** The planks every level lays: boards on the floor, and a platform of them. */
const PLANKS = ['weathered_brown_planks', 'Weathered Planks', 2, '#5b4330'] as const;

/**
 * The furniture the levels stand on their floors (`Furniture`), each a kind of tile no walk goes through: its texture,
 * whether it gives cover and whether it hides what is behind it.
 */
export const FURNITURE = {
  counter: { name: 'Counter', texture: ['weathered_brown_planks', 'Weathered Planks', 2], color: '#5b4330', cover: true, sight: false },
  shelf: { name: 'Shelves', texture: ['raw_plank_wall', 'Raw Plank Wall', 2], color: '#6a5139', cover: true, sight: true },
  pew: { name: 'Pew', texture: ['weathered_brown_planks', 'Weathered Planks', 2], color: '#5b4330', cover: true, sight: false },
  furnace: { name: 'Furnace', texture: ['broken_brick_wall', 'Broken Brick Wall', 2], color: '#5a3b30', cover: true, sight: true },
  slab: { name: 'Stone Slab', texture: ['castle_wall_slates', 'Castle Wall Slates', 2], color: '#55555a', cover: true, sight: false },
  bones: { name: 'Stacked Bone', texture: ['marble_01', 'Marble', 1.5], color: '#c9bfa8', cover: true, sight: false },
  drawers: { name: 'Catalogue Drawers', texture: ['raw_plank_wall', 'Raw Plank Wall', 2], color: '#4a3826', cover: true, sight: true },
  coal: { name: 'Coal Heap', texture: ['castle_wall_slates', 'Castle Wall Slates', 2], color: '#1c1a1a', cover: true, sight: false },
} as const satisfies Record<string, { name: string; texture: readonly [string, string, number]; color: string; cover: boolean; sight: boolean }>;

/**
 * Each level's look: the Poly Haven texture its walls and its floors are drawn in (CC0, every one a starter
 * `POLY_HAVEN_STARTERS` checked against Poly Haven), what it is called, how many tiles one repeat covers - the patch the
 * texture shows, a metre a tile - and the colour its kinds are drawn in until the texture is in. The Lantern and the
 * Throne share one: a good study in a good house, at the top of the well and at the bottom.
 */
const LOOKS = {
  lantern: { wall: ['plastered_stone_wall', 'Plastered Stone Wall', 2.5, '#8a7f70'], floor: ['wood_floor_worn', 'Worn Wood Floor', 2, '#6b5038'] },
  throat: { wall: ['castle_brick_07', 'Castle Brick', 2.5, '#5c4a40'], floor: ['cobblestone_floor_04', 'Cobblestone Floor', 1.5, '#5d5b58'] },
  market: { wall: ['stone_brick_wall_001', 'Stone Brick Wall', 2.5, '#77736a'], floor: ['large_sandstone_blocks_01', 'Large Sandstone Blocks', 3, '#9a8c74'] },
  library: { wall: ['rock_wall_10', 'Rock Wall', 1.8, '#4f4f52'], floor: ['marble_01', 'Marble', 1.5, '#b8b4ac'] },
  furnace: { wall: ['rustic_stone_wall_02', 'Rustic Stone Wall', 1.5, '#5e5650'], floor: ['dirt_floor', 'Dirt Floor', 2.07, '#5a4636'] },
} as const satisfies Record<string, Record<'wall' | 'floor', readonly [string, string, number, string]>>;

export type Look = keyof typeof LOOKS;

/** A material's id in the project, from the Poly Haven texture it is linked to. */
const surfaceId = (texture: string): string => texture.replace(/_/g, '-');

/** The kinds of tile a level's rows are laid with: its own wall and floor, the demo's rubble and low wall. */
export function kindsOf(look: Look): Kinds {
  return { ...STONE, wall: `${look}-wall`, floor: `${look}-floor` };
}

/**
 * The adventure's materials: every texture a level is drawn in, once, linked rather than carried - fetched from Poly
 * Haven the first time it is drawn, and kept in the browser - so the project stays a few hundred kilobytes.
 */
export const LINKED_SURFACES: TileSurface[] = [
  ...new Map(
    [...Object.values(LOOKS).flatMap((look) => [look.wall, look.floor]), PLANKS, ...Object.values(FURNITURE).map((kind) => kind.texture)]
      .map(([texture, name, size]) => [
        texture,
        { id: surfaceId(texture), name, source: `Poly Haven ${texture} (CC0)`, polyHaven: { id: texture, pixels: 1024 }, parallax: true, size, depth: 0.06, normalScale: 1, roughness: 1, tint: 0 } as TileSurface,
      ]),
  ).values(),
];

/** Each level's two kinds of tile: a wall as the demo's impassable stone is, and a floor, each drawn in its texture. */
const LEVEL_KINDS: NonNullable<ProjectDoc['terrainPalette']> = Object.entries(LOOKS).flatMap(([look, { wall, floor }]) => [
  { id: `${look}-wall`, name: `${wall[1]} (wall)`, passable: false, cost: 1, providesCover: false, blocksSight: true, color: wall[3], structure: 'block', surface: surfaceId(wall[0]) },
  { id: `${look}-floor`, name: floor[1], passable: true, cost: 1, providesCover: false, blocksSight: false, color: floor[3], structure: 'floor', surface: surfaceId(floor[0]) },
]);

/** Planks to walk on, and the furniture nobody walks through. */
const WOOD_KINDS: NonNullable<ProjectDoc['terrainPalette']> = [
  { id: 'planks', name: PLANKS[1], passable: true, cost: 1, providesCover: false, blocksSight: false, color: PLANKS[3], structure: 'floor', surface: surfaceId(PLANKS[0]) },
  ...Object.entries(FURNITURE).map(([id, kind]) => ({ id, name: kind.name, passable: false, cost: 1, providesCover: kind.cover, blocksSight: kind.sight, color: kind.color, structure: 'block', surface: surfaceId(kind.texture[0]) })),
];

/** Which way a stair is turned to climb toward each neighbour: south, east, north, west. */
const CLIMBS: readonly (readonly [number, number, number])[] = [
  [0, 1, 0],
  [1, 0, 1],
  [0, -1, 2],
  [-1, 0, 3],
];

/**
 * A room drawn as rows of characters (`LEGEND`, and the room's own `furniture`), as a scene's ground: every cell a
 * floor piece - stone, rubble, which is slow, or planks - with a wall's blocks, a low wall or a piece of furniture
 * stood on it, on bedrock; raised floor a block of the floor's stone (or of planks), and a stair turned to climb to it;
 * black water left as ground, below the floor's top and slow to wade. The bedrock is dark, as the water is: the
 * ground's colours blend from cell to cell, and a lawn's green under the stone showed round every pool. Throws on a row
 * of the wrong length, a character neither the legend nor the room's furniture has, or a stair with nothing raised
 * beside it.
 */
export function sceneFromRows(rows: readonly string[], kinds: Kinds = STONE, furniture: Readonly<Record<string, Furniture>> = {}): Pick<SceneDoc, 'width' | 'height' | 'terrain' | 'heights' | 'buildingTiles'> {
  const width = rows[0]?.length ?? 0;
  const height = rows.length;
  const terrain: string[] = [];
  const pieces: Record<string, BuildingTile> = {};
  const put = (x: number, y: number, level: number, tile: string, shape: string, rotation = 0, stretch?: number): void => {
    const piece: BuildingTile = { x, y, level, shape, material: 'stone', rotation, tile, ...(stretch === undefined ? {} : { height: stretch }) };
    pieces[buildingKey(piece)] = piece;
  };
  const raised = (x: number, y: number): boolean => ['raised', 'deck'].includes(LEGEND[rows[y]?.[x] ?? ''] ?? '');
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y} is ${row.length} wide, not ${width}`);
    [...row].forEach((char, x) => {
      const piece = furniture[char];
      const cell = piece === undefined ? LEGEND[char] : 'floor';
      if (cell === undefined) throw new Error(`"${char}" at ${x},${y} is not in the legend`);
      terrain.push(cell === 'water' ? 'black-water' : 'bedrock');
      if (cell === 'water') return;
      if (cell === 'raised' || cell === 'deck') return put(x, y, 0, cell === 'deck' ? 'planks' : kinds.floor, 'block');
      if (cell === 'stair') {
        const climb = CLIMBS.find(([dx, dy]) => raised(x + dx, y + dy));
        if (climb === undefined) throw new Error(`the stair at ${x},${y} has nothing raised beside it`);
        return put(x, y, 0, kinds.floor, 'stairs', climb[2]);
      }
      put(x, y, 0, cell === 'rubble' ? kinds.rubble : cell === 'boards' ? 'planks' : kinds.floor, 'floor');
      if (cell === 'wall') for (let n = 0; n < WALL_BLOCKS; n++) put(x, y, FLOOR_TOP + n, kinds.wall, 'block');
      if (cell === 'cover') put(x, y, FLOOR_TOP, kinds.cover, 'wall');
      if (piece !== undefined) put(x, y, FLOOR_TOP, piece.kind, piece.shape, piece.rotation ?? 0, piece.height);
    });
  });
  return { width, height, terrain, heights: terrain.map(() => 0), buildingTiles: pieces };
}

/** The kinds of tile it is laid with: the demo's, the bedrock under the stone, and the black water of the cistern. */
export const PALETTE: NonNullable<ProjectDoc['terrainPalette']> = [
  ...DEMO_TERRAIN,
  ...LEVEL_KINDS,
  ...WOOD_KINDS,
  { id: 'bedrock', name: 'Bedrock', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#26272b' },
  { id: 'black-water', name: 'Black Water', passable: true, cost: 2, providesCover: false, blocksSight: false, color: '#16242a' },
];

/** A stair down a passage, paired with the one at the other end: a step through either comes out by the other. */
export function passage(id: string, pair: string, position: { x: number; y: number }, rotation: number): SceneDoc['decos'][number] {
  return { id, model: 'stone-stairs', position, rotation, solid: true, function: { kind: 'portal', pair } };
}

/** A chest that waits for a fight to be over: what it gives, or what is said while the fight is not. */
export function afterTheFight(encounter: string, gives: Effect[], meanwhile: string): Effect[] {
  return [
    {
      kind: 'branch',
      when: { kind: 'encounter', id: encounter, state: 'ended' },
      then: [...gives, { kind: 'markUsed' }],
      otherwise: [{ kind: 'log', text: meanwhile, tone: 'bad' }],
    },
  ];
}
