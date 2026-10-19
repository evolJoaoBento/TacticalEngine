/**
 * The Ashwell's kit (`ashwell.ts`, `docs/ASHWELL.md`): the ids every level shares, the map drawn as rows of characters
 * (`sceneFromRows`) and the kinds of tile it is laid with, the stair paired across two rooms, and the chest that waits
 * for its room's fight to be over.
 */

import { buildingKey, type BuildingTile } from '../../engine/scene/building';
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
export const PALETTE: NonNullable<ProjectDoc['terrainPalette']> = [
  ...DEMO_TERRAIN,
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
