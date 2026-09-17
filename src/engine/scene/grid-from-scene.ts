/**
 * Building a runtime `TileGrid` from an authored `SceneDoc`, and reading one back.
 *
 * The document stores terrain by id and the grid stores it by palette index, so
 * this is where the two representations meet. A terrain id the palette does not
 * know is reported rather than guessed at — silently falling back to floor would
 * turn a typo into an invisible hole in a wall.
 */

import { NO_TILE, TileGrid } from '../grid/grid';
import { DEFAULT_TERRAIN_TYPES, TerrainPalette, terrain } from '../grid/terrain';
import { setStructures } from './building';
import type { ContentIssue } from '../content/types';
import type { Point, ProjectDoc, SceneDoc } from './schema';

/**
 * Build the palette a project declares, or the engine's default one.
 *
 * Takes on the project's structures at the same time, because since the two halves were
 * fused they are one question: a kind of tile can be a structure, so reading what a
 * project says about its ground means reading what it says about its structures too.
 *
 * Idempotent, which is what makes this the right place rather than somewhere rarer. It
 * rebuilds a small map from the same input, so being called again on every terrain change
 * costs nothing, and a registry that is refreshed too often is a great deal safer than one
 * refreshed too seldom - a project whose structures never loaded draws nothing at all.
 */
export function paletteForProject(project: Pick<ProjectDoc, 'terrainPalette' | 'structureTypes'>): TerrainPalette {
  setStructures(project.structureTypes);
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
        ...(type.scale === undefined ? {} : { scale: type.scale }),
        ...(type.structure === undefined ? {} : { structure: type.structure }),
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

  stackPieces(scene, grid, palette);

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

/**
 * Resolve the building layer onto the grid: what a walk meets on each cell.
 *
 * A cell can carry several pieces at several heights, so the one that counts is the
 * topmost - the last thing you would step onto. Ties go to whichever the document lists
 * later, which is the one stamped most recently.
 *
 * Three kinds of piece are passed over. One naming no kind of tile is scenery, which is
 * every piece placed before the two halves were fused and is why that field is optional.
 * One naming a kind the palette does not have is left to Check, which reports it rather
 * than guessing. And one standing outside the scene is ignored here: the building layer
 * reaches to a million on each axis and the grid is only as big as the room.
 */
function stackPieces(scene: SceneDoc, grid: TileGrid, palette: TerrainPalette): void {
  const pieces = scene.buildingTiles;
  if (pieces === undefined) return;
  // The height of whatever is currently winning each cell, so a lower piece stamped later
  // does not displace the one above it.
  const bestLevel = new Map<number, number>();
  for (const piece of Object.values(pieces)) {
    if (piece.tile === undefined) continue;
    const index = palette.indexOf(piece.tile);
    if (index < 0) continue;
    const tile = grid.indexOf(piece.x, piece.y);
    if (tile === NO_TILE) continue;
    const standing = bestLevel.get(tile);
    if (standing !== undefined && piece.level < standing) continue;
    bestLevel.set(tile, piece.level);
    grid.setOverlay(tile, index);
  }
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
