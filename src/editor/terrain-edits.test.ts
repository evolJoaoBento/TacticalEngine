import { describe, it, expect } from 'vitest';
import { DEFAULT_TERRAIN_TYPES } from '../engine/grid/terrain';
import { paletteForProject } from '../engine/scene/grid-from-scene';
import type { ProjectDoc } from '../engine/scene/schema';
import { setTerrainModel } from './terrain-edits';

/**
 * Naming what a kind of ground is drawn with.
 *
 * The awkward case is a project that declares no palette at all, which means "the
 * engine's four". There is nowhere to hang `floor`'s model until `floor` is written
 * down, so the edit writes the four — and undo has to take them away again, or every
 * project that ever opened this picker carries a palette nobody asked for.
 */

const project = (palette?: ProjectDoc['terrainPalette']): ProjectDoc =>
  ({ ...(palette === undefined ? {} : { terrainPalette: palette }) }) as ProjectDoc;

describe('what a kind of ground is drawn with', () => {
  it('writes the engine four down first, because there is nowhere else to hang it', () => {
    const doc = project();
    const edit = setTerrainModel('floor', 'plank');
    edit.apply(doc);

    expect(doc.terrainPalette).toHaveLength(DEFAULT_TERRAIN_TYPES.length);
    expect(doc.terrainPalette!.find((t) => t.id === 'floor')!.model).toBe('plank');
    // And the palette it wrote is the engine's own, not four blanks.
    expect(doc.terrainPalette!.map((t) => t.id)).toEqual(DEFAULT_TERRAIN_TYPES.map((t) => t.id));
  });

  it('gives back a document with no palette, rather than four types nobody asked for', () => {
    const doc = project();
    const edit = setTerrainModel('floor', 'plank');
    edit.apply(doc);
    edit.undo(doc);
    expect(doc.terrainPalette).toBeUndefined();
  });

  it('leaves a declared palette as it found it', () => {
    const declared = [
      { id: 'sand', name: 'Sand', passable: true, cost: 1, providesCover: false, blocksSight: false },
    ];
    const doc = project(declared);
    const edit = setTerrainModel('sand', 'dune');
    edit.apply(doc);
    expect(doc.terrainPalette![0]!.model).toBe('dune');

    edit.undo(doc);
    expect(doc.terrainPalette).toHaveLength(1);
    expect(doc.terrainPalette![0]!.model).toBeUndefined();
  });

  it('clears the naming rather than writing an empty id', () => {
    const doc = project([
      { id: 'sand', name: 'Sand', passable: true, cost: 1, providesCover: false, blocksSight: false, model: 'dune' },
    ]);
    setTerrainModel('sand', null).apply(doc);
    // Absent, not '': ground put back to colour is the document it was before.
    expect('model' in doc.terrainPalette![0]!).toBe(false);
  });

  it('reaches the palette a grid is built from', () => {
    const doc = project();
    setTerrainModel('difficult', 'bog').apply(doc);
    const palette = paletteForProject(doc);
    expect(palette.types.find((t) => t.id === 'difficult')!.model).toBe('bog');
    // The others are untouched: naming one ground does not draw the rest as anything.
    expect(palette.types.find((t) => t.id === 'floor')!.model).toBeUndefined();
  });
});
