import { describe, it, expect, afterEach } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { setStructures, type BuildingTile } from '../engine/scene/building';
import { projectSchema, sceneSchema, type ProjectDoc, type SceneDoc } from '../engine/scene/schema';
import { validateProject } from './validate';

/**
 * What Check says about the building layer.
 *
 * It said nothing at all until the two halves were fused, which was survivable while a
 * piece was only scenery: a shape nobody declared drew nothing and that was the end of it.
 * Once a piece carries the kind of tile it is, both of its names are authored references
 * that can go stale, and a stale one is invisible - a structure the project dropped draws
 * nothing, and a kind of tile the palette lost is walked on as whatever comes first.
 *
 * In its own file rather than `validate.test.ts` because that file is pinned at its size.
 */

function project(buildingTiles: SceneDoc['buildingTiles'], palette?: ProjectDoc['terrainPalette']): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse({ ...blankScene('room', 6, 4), buildingTiles })],
    startScene: 'room',
    ...(palette === undefined ? {} : { terrainPalette: palette }),
  });
}

const messages = (doc: ProjectDoc): string[] => validateProject(doc).map((p) => p.message);

const piece = (over: Partial<BuildingTile> = {}): BuildingTile => ({
  x: 1, y: 1, level: 0, shape: 'block', material: 'stone', rotation: 0, ...over,
});

afterEach(() => {
  // `paletteForProject` fills the registry from the project under test, so a project that
  // declared its own structures must not be left standing for the next one.
  setStructures();
});

describe('Check over the building layer', () => {
  it('says nothing about a piece whose structure and kind both resolve', () => {
    const said = messages(project({ '1,1,0': piece({ tile: 'floor' }) }));
    expect(said.filter((m) => m.includes('building tile'))).toEqual([]);
  });

  it('says nothing about a piece that is only scenery', () => {
    // No `tile`, so nothing to resolve: this is every piece placed before the fusion.
    const said = messages(project({ '1,1,0': piece() }));
    expect(said.filter((m) => m.includes('building tile'))).toEqual([]);
  });

  it('reports a kind of tile the palette does not have', () => {
    const said = messages(project({ '1,1,0': piece({ tile: 'rampart' }) }));
    expect(said).toContain(
      'A building tile is of kind "rampart", which the palette does not have; it falls back to the first kind.',
    );
  });

  it('leaves an unknown structure to the schema, which refuses it first', () => {
    // There is deliberately no Check pass for an unknown shape. `validateProject` re-parses
    // the document, `buildingTilesSchema` refuses a shape no structure declares, and
    // `paletteForProject` refills the registry from the project being validated - so no
    // document can reach a pass looking for one. A first draft had that pass; it was dead
    // code, and this is what says so.
    setStructures([{ id: 'doorway', name: 'Doorway', atoms: [{ shape: 'wall' }] }]);
    const doc = project({ '1,1,0': piece({ shape: 'doorway' }) });
    setStructures();
    const said = messages(doc);
    expect(said.some((m) => m.includes('doorway'))).toBe(true);
    // The schema's words, not a pass of Check's own.
    expect(said.some((m) => m.startsWith('A building tile is a'))).toBe(false);
  });

  it('reports each stale name once, however many pieces carry it', () => {
    const said = messages(
      project({
        '1,1,0': piece({ tile: 'rampart' }),
        '2,1,0': piece({ x: 2, tile: 'rampart' }),
        '3,1,0': piece({ x: 3, tile: 'parapet' }),
      }),
    );
    const about = said.filter((m) => m.startsWith('A building tile is of kind'));
    // Two messages for three pieces, sorted, so a room of a hundred broken cells is
    // readable rather than a hundred lines saying the same thing.
    expect(about).toEqual([
      'A building tile is of kind "parapet", which the palette does not have; it falls back to the first kind.',
      'A building tile is of kind "rampart", which the palette does not have; it falls back to the first kind.',
    ]);
  });

  it('accepts a kind the project itself declared', () => {
    const said = messages(
      project({ '1,1,0': piece({ tile: 'rampart' }) }, [
        { id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false },
        { id: 'rampart', name: 'Rampart', passable: false, cost: 1, providesCover: true, blocksSight: true, structure: 'wall' },
      ]),
    );
    expect(said.filter((m) => m.includes('building tile'))).toEqual([]);
  });
});
