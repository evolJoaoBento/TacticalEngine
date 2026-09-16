import { describe, it, expect, afterEach } from 'vitest';
import {
  BUILD_ATOMS,
  DEFAULT_STRUCTURES,
  buildingParts,
  isStructure,
  setStructures,
  structureTypes,
} from './building';

/**
 * Structures, as data rather than a switch.
 *
 * The four the engine ships are the atoms everything else is put together from, so the
 * first thing to hold is that they still produce exactly the boxes they did when they
 * were four cases in a switch statement.
 */

afterEach(() => {
  // The registry is module state; a test that declares its own must not leak.
  setStructures();
});

describe('the four the engine ships', () => {
  it('produce exactly the boxes they always did', () => {
    expect(buildingParts('block')).toEqual([[0, 0.5, 0, 1, 1, 1]]);
    expect(buildingParts('floor')).toEqual([[0, 0.125, 0, 1, 0.25, 1]]);
    expect(buildingParts('wall')).toEqual([[0, 0.5, -0.4, 1, 1, 0.2]]);
    expect(buildingParts('stairs')).toEqual([
      [0, 0.125, -0.375, 1, 0.25, 0.25],
      [0, 0.25, -0.125, 1, 0.5, 0.25],
      [0, 0.375, 0.125, 1, 0.75, 0.25],
      [0, 0.5, 0.375, 1, 1, 0.25],
    ]);
  });

  it('collapse a staircase at a distance, and nothing else', () => {
    expect(buildingParts('stairs', true)).toEqual([[0, 0.5, 0, 1, 1, 1]]);
    // A shape with no far form reads the same however far away it is.
    expect(buildingParts('wall', true)).toEqual(buildingParts('wall'));
    expect(buildingParts('floor', true)).toEqual(buildingParts('floor'));
  });

  it('are each one atom, and are what a project starts with', () => {
    expect(DEFAULT_STRUCTURES.map((s) => s.id)).toEqual(['block', 'floor', 'wall', 'stairs']);
    for (const type of DEFAULT_STRUCTURES) expect(type.atoms).toHaveLength(1);
    expect(Object.keys(BUILD_ATOMS).sort()).toEqual(['block', 'floor', 'stairs', 'wall']);
  });
});

describe('a structure put together from them', () => {
  it('is the atoms it names, each moved where it was put', () => {
    setStructures([
      { id: 'doorway', name: 'Doorway', atoms: [
        { shape: 'wall', at: [-0.5, 0, 0] },
        { shape: 'wall', at: [0.5, 0, 0] },
      ] },
    ]);

    expect(buildingParts('doorway')).toEqual([
      [-0.5, 0.5, -0.4, 1, 1, 0.2],
      [0.5, 0.5, -0.4, 1, 1, 0.2],
    ]);
  });

  it('collapses with the atoms that collapse, so the count is the same both times', () => {
    setStructures([
      { id: 'landing', name: 'Landing', atoms: [{ shape: 'floor' }, { shape: 'stairs', at: [0, 0.25, 0] }] },
    ]);

    // Near: one floor box and four steps. Far: one floor box and one ramp. The renderer
    // counts before it fills, so what matters is that each call is consistent with itself.
    expect(buildingParts('landing')).toHaveLength(5);
    expect(buildingParts('landing', true)).toHaveLength(2);
    expect(buildingParts('landing')).toHaveLength(5);
  });

  it('keeps the engine four, and puts whatever a project declares after them', () => {
    setStructures([{ id: 'doorway', name: 'Doorway', atoms: [{ shape: 'wall' }] }]);
    expect(structureTypes().map((s) => s.id)).toEqual(['block', 'floor', 'wall', 'stairs', 'doorway']);
    expect(isStructure('doorway')).toBe(true);
  });

  it('lets a project replace one of the four rather than adding beside it', () => {
    setStructures([{ id: 'wall', name: 'Thin Wall', atoms: [{ shape: 'floor' }] }]);
    expect(structureTypes()).toHaveLength(4);
    expect(buildingParts('wall')).toEqual(buildingParts('floor'));
  });

  it('draws nothing for an id nothing declares, rather than throwing', () => {
    // A document naming a structure its project has since dropped still opens; Check is
    // where that is reported, not a crash in the middle of a chunk rebuild.
    expect(isStructure('nothing-like-it')).toBe(false);
    expect(buildingParts('nothing-like-it')).toEqual([]);
  });

  it('ignores an atom naming something that is not one of the four', () => {
    setStructures([
      { id: 'odd', name: 'Odd', atoms: [{ shape: 'wall' }, { shape: 'not-an-atom' }] },
    ]);
    expect(buildingParts('odd')).toEqual([[0, 0.5, -0.4, 1, 1, 0.2]]);
  });
});
