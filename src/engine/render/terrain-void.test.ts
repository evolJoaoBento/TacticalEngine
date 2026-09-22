import { describe, expect, it } from 'vitest';
import type { Material } from 'three';
import { blankScene, gridFromScene } from '../scene/grid-from-scene';
import { buildTerrainMesh } from './terrain-mesh';

/** A strip of three cells: grass, nothing, grass. */
function strip() {
  const scene = blankScene('strip', 3, 1);
  scene.terrain[1] = 'void';
  return buildTerrainMesh(gridFromScene(scene).grid);
}

const faces = (mesh: { geometry: { getAttribute(name: string): { count: number } } }): number => mesh.geometry.getAttribute('position').count / 6;

describe('nothing, in the ground mesh', () => {
  it('is there to be struck and is not drawn', () => {
    const terrain = strip();
    const nothing = terrain.meshes.find((mesh) => mesh.name === 'terrain:void')!;
    expect((nothing.material as Material).visible).toBe(false);
    expect(nothing.castShadow).toBe(false);
    expect(terrain.drawn.map((mesh) => mesh.name)).toEqual(['terrain:floor']);
    expect(terrain.tileOf(nothing, 0)).toBe(1);
  });

  it('is an edge of the world to the ground beside it: the grass shows its side there, as it does off the map', () => {
    const open = blankScene('open', 3, 1);
    const whole = buildTerrainMesh(gridFromScene(open).grid).drawn[0]!;
    const broken = strip().drawn[0]!;
    // Three tops and eight sides round the outside; with the middle gone, two tops, and each
    // island has all four of its sides - the two facing the gap included.
    expect(faces(whole)).toBe(3 + 8);
    expect(faces(broken)).toBe(2 + 8);
  });
});
