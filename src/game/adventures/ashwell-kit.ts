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
export type Cell = 'wall' | 'floor' | 'water' | 'rubble' | 'cover';

/** The characters a map is drawn in. */
export const LEGEND: Readonly<Record<string, Cell>> = { '#': 'wall', '.': 'floor', '~': 'water', ',': 'rubble', c: 'cover' };

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
    Object.values(LOOKS)
      .flatMap((look) => [look.wall, look.floor])
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

/**
 * A room drawn as rows of characters (`LEGEND`), as a scene's ground: every cell a floor piece - stone, or rubble,
 * which is slow - with a wall's blocks or a low wall stood on it, on bedrock; black water left as ground, below the
 * floor's top and slow to wade. The bedrock is dark, as the water is: the ground's colours blend from cell to cell,
 * and a lawn's green under the stone showed round every pool. Throws on a row of the wrong length or a character the legend has not got.
 */
export function sceneFromRows(rows: readonly string[], kinds: Kinds = STONE): Pick<SceneDoc, 'width' | 'height' | 'terrain' | 'heights' | 'buildingTiles'> {
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
      put(x, y, 0, cell === 'rubble' ? kinds.rubble : kinds.floor, 'floor');
      if (cell === 'wall') for (let n = 0; n < WALL_BLOCKS; n++) put(x, y, FLOOR_TOP + n, kinds.wall, 'block');
      if (cell === 'cover') put(x, y, FLOOR_TOP, kinds.cover, 'wall');
    });
  });
  return { width, height, terrain, heights: terrain.map(() => 0), buildingTiles: pieces };
}

/** The kinds of tile it is laid with: the demo's, the bedrock under the stone, and the black water of the cistern. */
export const PALETTE: NonNullable<ProjectDoc['terrainPalette']> = [
  ...DEMO_TERRAIN,
  ...LEVEL_KINDS,
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
