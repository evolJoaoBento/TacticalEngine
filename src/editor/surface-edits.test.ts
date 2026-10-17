/**
 * The project's imported materials, edited (`surface-edits.ts`): one imported with its four kinds of tile as one step,
 * undone and redone whole; tuned, its kinds left alone; removed, its kinds with it. And the importer's choices that
 * need no browser (`surface-import.ts`): a lossless WebP known by its bytes, and ids moved along past taken ones.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_TERRAIN_TYPES } from '../engine/grid/terrain';
import { kindsForSurface } from '../engine/content/tile-surface-kit';
import type { ProjectDoc, TileSurface } from '../engine/scene/schema';
import { importTileSurface, removeTileSurface, roomForSurface, updateTileSurface } from './surface-edits';
import { isLosslessWebp, withKinds } from './surface-import';

const bricks: TileSurface = { id: 'bricks', name: 'Bricks', maps: { color: 'c', normalHeight: 'n', orm: 'o' }, parallax: true, size: 1, depth: 0.06, normalScale: 1, roughness: 1 };
const four = kindsForSurface(bricks, '#884422', () => false).kinds;
const project = (over: Partial<ProjectDoc> = {}): ProjectDoc => ({ ...over }) as ProjectDoc;

describe("the project's imported materials, edited", () => {
  it('imports a material and its four kinds as one step: the engine palette written down first, all undone and redone whole', () => {
    const doc = project();
    const edit = importTileSurface(bricks, four);
    edit.apply(doc);
    expect(doc.surfaces).toEqual([bricks]);
    expect(doc.terrainPalette!.map((t) => t.id)).toEqual([...DEFAULT_TERRAIN_TYPES.map((t) => t.id), 'bricks-block', 'bricks-wall', 'bricks-floor', 'bricks-stairs']);
    edit.undo(doc);
    expect(doc.surfaces).toBeUndefined();
    expect(doc.terrainPalette).toBeUndefined();
    edit.apply(doc);
    expect(doc.terrainPalette!.filter((t) => t.surface === 'bricks')).toHaveLength(4);
  });

  it('takes back only its own four from a palette the project had already, the rest as it was', () => {
    const doc = project({ terrainPalette: [{ id: 'grass', name: 'Grass', passable: true, cost: 1, providesCover: false, blocksSight: false }] });
    const edit = importTileSurface(bricks, four);
    edit.apply(doc);
    expect(doc.terrainPalette!.map((t) => t.id)).toEqual(['grass', 'bricks-block', 'bricks-wall', 'bricks-floor', 'bricks-stairs']);
    edit.undo(doc);
    expect(doc.terrainPalette!.map((t) => t.id)).toEqual(['grass']);
    expect(doc.surfaces).toBeUndefined();
  });

  it('imports nothing over a material or a kind of tile already there', () => {
    const doc = project({ surfaces: [bricks] });
    const edit = importTileSurface(bricks, four);
    edit.apply(doc);
    expect(edit.isNoop?.()).toBe(true);
    expect(doc.terrainPalette).toBeUndefined();
  });

  it('tunes a material, its kinds left alone, and undoes it', () => {
    const doc = project();
    importTileSurface(bricks, four).apply(doc);
    const kinds = JSON.stringify(doc.terrainPalette);
    const tune = updateTileSurface('bricks', { depth: 0.12, name: 'Old Bricks' });
    tune.apply(doc);
    expect(doc.surfaces![0]).toMatchObject({ depth: 0.12, name: 'Old Bricks', maps: bricks.maps });
    expect(JSON.stringify(doc.terrainPalette)).toBe(kinds);
    tune.undo(doc);
    expect(doc.surfaces![0]).toEqual(bricks);
    expect(updateTileSurface('nothing', { depth: 0 })).toBeDefined();
  });

  it('takes a slider dragged as one step back to where it started', () => {
    const doc = project();
    importTileSurface(bricks, four).apply(doc);
    const first = updateTileSurface('bricks', { depth: 0.1 });
    first.apply(doc);
    const second = updateTileSurface('bricks', { depth: 0.2 });
    expect(second.mergeKey).toBe(first.mergeKey);
    second.apply(doc);
    expect(first.absorb!(second)).toBe(true);
    expect(doc.surfaces![0]!.depth).toBe(0.2);
    first.undo(doc);
    expect(doc.surfaces![0]!.depth).toBe(0.06);
    first.apply(doc);
    expect(doc.surfaces![0]!.depth).toBe(0.2);
    expect(updateTileSurface('bricks', { size: 2 }).mergeKey).not.toBe(first.mergeKey);
  });

  it('removes a material and every kind drawn in it, and puts them back where they were', () => {
    const doc = project();
    importTileSurface(bricks, four).apply(doc);
    const before = JSON.stringify(doc);
    const remove = removeTileSurface('bricks');
    remove.apply(doc);
    expect(doc.surfaces).toEqual([]);
    expect(doc.terrainPalette!.some((t) => t.surface === 'bricks')).toBe(false);
    remove.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('says when a palette has no room for four more kinds', () => {
    const full = Array.from({ length: 252 }, (_, i) => ({ id: `k${i}`, name: '', passable: true, cost: 1, providesCover: false, blocksSight: false }));
    expect(roomForSurface(project({ terrainPalette: full.slice(0, 251) }), 4)).toBeNull();
    expect(roomForSurface(project({ terrainPalette: full }), 4)).toMatch(/at most 255 kinds of tile/);
  });
});

describe('a material imported', () => {
  it('knows a lossless WebP by its bytes', () => {
    const webp = (chunk: string): Uint8Array => new TextEncoder().encode(`RIFF\0\0\0\0WEBP${chunk}\0\0\0\0`);
    expect(isLosslessWebp(webp('VP8L'))).toBe(true);
    expect(isLosslessWebp(webp('VP8 '))).toBe(false);
    expect(isLosslessWebp(new TextEncoder().encode('\x89PNG\r\n\x1a\n........'))).toBe(false);
  });

  it('moves its id and its name along past what the project has taken', () => {
    const { surface, kinds } = withKinds({ surface: bricks, color: '#000000', ignored: [] }, (id) => id === 'bricks-wall');
    expect(surface.id).toBe('bricks-2');
    expect(surface.name).toBe('Bricks 2');
    expect(kinds.map((k) => k.surface)).toEqual(['bricks-2', 'bricks-2', 'bricks-2', 'bricks-2']);
  });
});
