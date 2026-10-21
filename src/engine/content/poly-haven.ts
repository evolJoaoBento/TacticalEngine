/**
 * Materials from Poly Haven (`docs/MANUAL.md`, "Surfaces"): its textures are CC0, so a project may carry them anywhere,
 * and its API answers a browser from any page (`Access-Control-Allow-Origin: *`). What to ask for and what to make of
 * the answers is decided here, without a browser; the editor downloads (`editor/surface-import.ts`, `downloadPolyHaven`).
 *
 * Two calls describe a texture: `https://api.polyhaven.com/info/{id}` its name and the size of the patch it shows, in
 * millimetres; `https://api.polyhaven.com/files/{id}` every file, by map, resolution and format - `Diffuse`, `nor_gl`,
 * `Rough`, `AO`, `Displacement`, and others this does not read (`arm`, a packed copy of three of them; `blend`, `gltf`,
 * `mtlx`). An HDRI or a model answers the same calls with none of the maps.
 */

/** Where Poly Haven's API is. */
export const POLY_HAVEN_API = 'https://api.polyhaven.com';

/**
 * How many metres one tile spans, to turn a texture's real size into the tiles one repeat covers. A tile is one unit,
 * and a model at scale 1 is in metres (`render/assets.ts`), so a metre is a tile: a 2 m patch of bricks repeats every
 * two tiles, at the scale the party is drawn. The author retunes Size from there.
 */
export const METRES_PER_TILE = 1;

/** The maps downloaded, in the order asked for: each by Poly Haven's name for it. A DirectX normal only if there is no OpenGL one. */
const MAPS = ['Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement'] as const;

/** A texture's files as `/files/{id}` gives them: map, then resolution, then format. */
export type PolyHavenFiles = Record<string, Record<string, Record<string, { url?: string } | undefined> | undefined> | undefined>;

/** A texture as `/info/{id}` describes it: what matters here. */
export interface PolyHavenInfo {
  name?: string;
  /** The patch the texture shows, in millimetres. */
  dimensions?: number[];
}

/** A texture suggested in the editor: Poly Haven's id for it, what it is called, and where it suits. */
export interface PolyHavenStarter {
  id: string;
  name: string;
  group: 'Dungeon' | 'Town' | 'Wilds';
}

/**
 * The textures the editor suggests, each checked against the API to have a colour, an OpenGL normal, roughness and a
 * height map at 1K and 2K: a set for a dungeon, a town and the wilds. Any other is a name typed away.
 */
export const POLY_HAVEN_STARTERS: readonly PolyHavenStarter[] = [
  { id: 'stone_brick_wall_001', name: 'Stone Brick Wall', group: 'Dungeon' },
  { id: 'castle_brick_07', name: 'Castle Brick', group: 'Dungeon' },
  { id: 'castle_wall_slates', name: 'Castle Wall Slates', group: 'Dungeon' },
  { id: 'rustic_stone_wall_02', name: 'Rustic Stone Wall', group: 'Dungeon' },
  { id: 'rock_wall_10', name: 'Rock Wall', group: 'Dungeon' },
  { id: 'broken_brick_wall', name: 'Broken Brick Wall', group: 'Dungeon' },
  { id: 'brick_moss_001', name: 'Mossy Brick', group: 'Dungeon' },
  { id: 'cobblestone_floor_04', name: 'Cobblestone Floor', group: 'Dungeon' },
  { id: 'large_sandstone_blocks_01', name: 'Large Sandstone Blocks', group: 'Dungeon' },
  { id: 'marble_01', name: 'Marble', group: 'Dungeon' },
  { id: 'dirt_floor', name: 'Dirt Floor', group: 'Dungeon' },
  { id: 'wood_floor_worn', name: 'Worn Wood Floor', group: 'Town' },
  { id: 'weathered_brown_planks', name: 'Weathered Planks', group: 'Town' },
  { id: 'raw_plank_wall', name: 'Plank Wall', group: 'Town' },
  { id: 'medieval_red_brick', name: 'Medieval Red Brick', group: 'Town' },
  { id: 'plastered_stone_wall', name: 'Plastered Stone Wall', group: 'Town' },
  { id: 'rough_plasterbrick_05', name: 'Rough Plaster Brick', group: 'Town' },
  { id: 'grassy_cobblestone', name: 'Grassy Cobblestone', group: 'Town' },
  { id: 'roof_slates_02', name: 'Roof Slates', group: 'Town' },
  { id: 'thatch_roof_angled', name: 'Thatch', group: 'Town' },
  { id: 'forrest_ground_01', name: 'Forest Ground', group: 'Wilds' },
  { id: 'leafy_grass', name: 'Leafy Grass', group: 'Wilds' },
  { id: 'brown_mud_leaves_01', name: 'Mud and Leaves', group: 'Wilds' },
  { id: 'rocks_ground_02', name: 'Rocky Ground', group: 'Wilds' },
  { id: 'mossy_rock', name: 'Mossy Rock', group: 'Wilds' },
  { id: 'sand_01', name: 'Sand', group: 'Wilds' },
  { id: 'snow_02', name: 'Snow', group: 'Wilds' },
];

/**
 * The texture an author named: Poly Haven's id as it is (`rock_wall_08`), or a link to its page
 * (`https://polyhaven.com/a/rock_wall_08`, `…/textures/…`). Nothing, when there is no id in it.
 */
export function polyHavenId(text: string): string | null {
  const trimmed = text.trim();
  const page = /polyhaven\.com\/(?:a|textures?)\/([A-Za-z0-9_-]+)/i.exec(trimmed);
  const id = (page?.[1] ?? trimmed).toLowerCase();
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(id) ? id : null;
}

/** The resolution a material kept at `size` pixels is downloaded at: never smaller than it is kept. */
export function polyHavenResolution(size: number): '1k' | '2k' {
  return size > 1024 ? '2k' : '1k';
}

/**
 * The files to download for a material: each map Poly Haven has, as a JPEG at the resolution asked - the other if it
 * has not that one - named as the download names it, so the importer knows each by its name (`_diff_1k.jpg`). Empty
 * when the asset has no colour map: it is not a texture.
 */
export function polyHavenMaps(files: PolyHavenFiles, resolution: '1k' | '2k'): { name: string; url: string }[] {
  const urlOf = (map: string): string | undefined => {
    const sizes = files[map];
    if (sizes === undefined) return undefined;
    for (const at of [resolution, resolution === '1k' ? '2k' : '1k']) {
      const url = sizes[at]?.jpg?.url ?? sizes[at]?.png?.url;
      if (url !== undefined) return url;
    }
    return undefined;
  };
  if (urlOf('Diffuse') === undefined) return [];
  const wanted = MAPS.map((map) => (map === 'nor_gl' && urlOf(map) === undefined ? 'nor_dx' : map));
  return wanted.flatMap((map) => {
    const url = urlOf(map);
    return url === undefined ? [] : [{ name: decodeURIComponent(url.split('/').pop() ?? `${map}.jpg`), url }];
  });
}

/** The tiles one repeat covers, from the patch the texture shows: its wider side in metres, at a tile a metre (`METRES_PER_TILE`), as far as Size goes. One when it says nothing. */
export function polyHavenSize(info: PolyHavenInfo): number {
  const widest = Math.max(...(info.dimensions ?? []).filter((side) => Number.isFinite(side) && side > 0), 0);
  if (widest === 0) return 1;
  const tiles = widest / 1000 / METRES_PER_TILE;
  return Math.min(16, Math.max(0.05, Math.round(tiles * 100) / 100));
}
