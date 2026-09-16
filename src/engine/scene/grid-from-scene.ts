/**
 * Building a runtime `TileGrid` from an authored `SceneDoc`, and reading one back.
 *
 * The document stores terrain by id and the grid stores it by palette index, so
 * this is where the two representations meet. A terrain id the palette does not
 * know is reported rather than guessed at — silently falling back to floor would
 * turn a typo into an invisible hole in a wall.
 */

import { TileGrid } from '../grid/grid';
import { DEFAULT_TERRAIN_TYPES, TerrainPalette, terrain } from '../grid/terrain';
import type { ContentIssue } from '../content/types';
import type { Point, ProjectDoc, SceneDoc } from './schema';

/** Build the palette a project declares, or the engine's default one. */
export function paletteForProject(project: Pick<ProjectDoc, 'terrainPalette'>): TerrainPalette {
  const declared = project.terrainPalette;
  if (declared === undefined) return new TerrainPalette();
  return new TerrainPalette(
    declared.map((type) =>
      terrain(type.id, {
        name: type.name === '' ? type.id : type.name,
        passable: type.passable,
        cost: type.cost,
        providesCover: type.providesCover,
        blocksSight: type.blocksSight,
        ...(type.color === undefined ? {} : { color: type.color }),
        ...(type.model === undefined ? {} : { model: type.model }),
      }),
    ),
  );
}

/**
 * Build a grid from a scene.
 *
 * Unknown terrain ids are collected in `issues` and left as the palette's first
 * type, so an editor can show every broken tile at once instead of failing on the
 * first one.
 */
export function gridFromScene(
  scene: SceneDoc,
  palette: TerrainPalette = new TerrainPalette(),
  source = scene.id,
): { grid: TileGrid; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const grid = new TileGrid({ width: scene.width, height: scene.height, palette });

  const unknown = new Map<string, number>();
  for (let tile = 0; tile < grid.size; tile++) {
    grid.heights[tile] = scene.heights[tile]!;
    const id = scene.terrain[tile]!;
    const index = palette.indexOf(id);
    // An unresolved tile keeps the palette's first type; its height still applies.
    if (index < 0) unknown.set(id, (unknown.get(id) ?? 0) + 1);
    else grid.terrain[tile] = index;
  }

  // One issue per unknown id, not per tile — a whole wall of typos is one problem.
  for (const [id, count] of unknown) {
    issues.push({
      source,
      entry: scene.id,
      field: 'terrain',
      message: `unknown terrain id ${JSON.stringify(id)} on ${count} tile${count === 1 ? '' : 's'}`,
    });
  }

  return { grid, issues };
}

/** The tile index a scene coordinate refers to. */
export function tileOf(grid: TileGrid, point: Point): number {
  return grid.indexOf(point.x, point.y);
}

/** The scene coordinate a tile index refers to. */
export function pointOf(grid: TileGrid, tile: number): Point {
  return { x: grid.xOf(tile), y: grid.yOf(tile) };
}

/**
 * Read a grid back into the document arrays, for the editor's save path.
 * Round-trips with `gridFromScene` as long as every terrain id is in the palette.
 */
export function sceneTerrainFromGrid(grid: TileGrid): {
  terrain: string[];
  heights: number[];
} {
  const terrainIds: string[] = new Array(grid.size);
  const heights: number[] = new Array(grid.size);
  for (let tile = 0; tile < grid.size; tile++) {
    terrainIds[tile] = grid.terrainAt(tile).id;
    heights[tile] = grid.heightAt(tile);
  }
  return { terrain: terrainIds, heights };
}

/** A scene of open floor at height 0 — the starting point for a new map. */
export function blankScene(
  id: string,
  width: number,
  height: number,
  terrainId = DEFAULT_TERRAIN_TYPES[0]!.id,
): SceneDoc {
  const count = width * height;
  return {
    id,
    name: '',
    intro: '',
    width,
    height,
    terrain: new Array<string>(count).fill(terrainId),
    heights: new Array<number>(count).fill(0),
    spawns: [{ x: 0, y: 0 }],
    interactables: [],
    encounters: [],
    decos: [],
  };
}
