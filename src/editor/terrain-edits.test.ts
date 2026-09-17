import { describe, it, expect } from 'vitest';
import { DEFAULT_TERRAIN_TYPES } from '../engine/grid/terrain';
import { paletteForProject } from '../engine/scene/grid-from-scene';
import type { ProjectDoc } from '../engine/scene/schema';
import {
  addTerrainType,
  removeTerrainType,
  setTerrainModel,
  tileIdTaken,
  tilesStandingOn,
  updateTerrainType,
} from './terrain-edits';

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

describe('adding, changing and removing a kind of tile', () => {
  it('keeps the engine four as they were born when it writes them down', () => {
    const doc = project();
    addTerrainType({ id: 'bog', name: 'Bog', passable: true, cost: 2, providesCover: false, blocksSight: false }).apply(doc);

    // The bug this is here for: materialising the four used to drop their colours,
    // because the copy listed the fields it knew and `color` arrived later.
    const floor = doc.terrainPalette!.find((t) => t.id === 'floor')!;
    expect(floor.color).toBe('#5d8a4a');
    expect(doc.terrainPalette!.find((t) => t.id === 'wall')!.color).toBe('#3b3f4a');
    expect(doc.terrainPalette!.map((t) => t.id)).toEqual([...DEFAULT_TERRAIN_TYPES.map((t) => t.id), 'bog']);
  });

  it('gives back a document with no palette when the add is undone', () => {
    const doc = project();
    const edit = addTerrainType({ id: 'bog', name: 'Bog', passable: true, cost: 1, providesCover: false, blocksSight: false });
    edit.apply(doc);
    edit.undo(doc);
    expect(doc.terrainPalette).toBeUndefined();
  });

  it('refuses a second tile with an id one already has', () => {
    const doc = project();
    const twice = { id: 'bog', name: 'Bog', passable: true, cost: 1, providesCover: false, blocksSight: false };
    addTerrainType(twice).apply(doc);
    const again = addTerrainType({ ...twice, name: 'Other Bog' });
    again.apply(doc);
    expect(again.isNoop?.()).toBe(true);
    expect(doc.terrainPalette!.filter((t) => t.id === 'bog')).toHaveLength(1);
  });

  it('changes what a tile is, and puts it back exactly on undo', () => {
    const doc = project([
      { id: 'sand', name: 'Sand', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#d8c38a' },
    ]);
    const edit = updateTerrainType('sand', { cost: 3, color: '#c0a060' });
    edit.apply(doc);
    expect(doc.terrainPalette![0]!.cost).toBe(3);
    expect(doc.terrainPalette![0]!.color).toBe('#c0a060');

    edit.undo(doc);
    expect(doc.terrainPalette![0]!.cost).toBe(1);
    expect(doc.terrainPalette![0]!.color).toBe('#d8c38a');
  });

  it('clears a field rather than writing it undefined', () => {
    const doc = project([
      { id: 'sand', name: 'Sand', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#d8c38a' },
    ]);
    updateTerrainType('sand', { color: undefined }).apply(doc);
    // Absent, not present-and-undefined: the schema draws that line and so does undo.
    expect('color' in doc.terrainPalette![0]!).toBe(false);
  });

  it('removes a kind of tile and puts it back where it was', () => {
    const doc = project();
    const edit = removeTerrainType('cover');
    edit.apply(doc);
    // Everything the engine ships except the one taken out. Spelled out, this was the one
    // assertion in the file that held a copy of the engine's list rather than deriving it,
    // and it went stale the moment the stackable kinds were added.
    expect(doc.terrainPalette!.map((t) => t.id)).toEqual(
      DEFAULT_TERRAIN_TYPES.map((t) => t.id).filter((id) => id !== 'cover'),
    );

    edit.undo(doc);
    expect(doc.terrainPalette!.map((t) => t.id)).toEqual(DEFAULT_TERRAIN_TYPES.map((t) => t.id));
  });

  it('refuses to take the last kind of tile, which every cell falls back to', () => {
    const doc = project([{ id: 'only', name: 'Only', passable: true, cost: 1, providesCover: false, blocksSight: false }]);
    const edit = removeTerrainType('only');
    edit.apply(doc);
    expect(edit.isNoop?.()).toBe(true);
    expect(doc.terrainPalette).toHaveLength(1);
  });

  it('counts the cells standing on a kind of tile, so a removal can say what it costs', () => {
    const doc = project();
    doc.scenes = [
      { terrain: ['floor', 'wall', 'wall', 'floor'] },
      { terrain: ['wall', 'floor'] },
    ] as ProjectDoc['scenes'];
    expect(tilesStandingOn(doc, 'wall')).toBe(3);
    expect(tilesStandingOn(doc, 'cover')).toBe(0);
    expect(tileIdTaken(doc, 'floor')).toBe(true);
    expect(tileIdTaken(doc, 'bog')).toBe(false);
  });
});
