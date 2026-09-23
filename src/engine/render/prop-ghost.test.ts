/**
 * The ghost, and the one thing about it that can go badly wrong.
 *
 * A model's materials come out of a cache shared by everything drawn from it. Fading a ghost by
 * setting opacity on the materials it was handed would fade every crate in the room along with
 * it, and the mistake would look like a lighting bug rather than like what it is. So what is
 * pinned here is chiefly that the ghost's materials are copies.
 */

import { describe, it, expect } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, BoxGeometry } from 'three';
import { GHOST_OPACITY, PropGhost, fadeToGhost } from './prop-ghost';
import type { BuiltModel } from './procedural/build';

/** A model with two meshes sharing one material, the way a cache hands them out. */
function shared(): { group: Group; material: MeshStandardMaterial; meshes: Mesh[] } {
  const material = new MeshStandardMaterial({ color: '#c08040' });
  const group = new Group();
  const meshes = [new Mesh(new BoxGeometry(), material), new Mesh(new BoxGeometry(), material)];
  meshes[1]!.castShadow = true;
  group.add(...meshes);
  return { group, material, meshes };
}

describe('fading a model to a ghost', () => {
  it('works on copies, so nothing else drawn from the same material fades with it', () => {
    const { group, material, meshes } = shared();
    const cloned = fadeToGhost(group);
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
    for (const mesh of meshes) {
      expect(mesh.material).not.toBe(material);
      expect((mesh.material as MeshStandardMaterial).opacity).toBeCloseTo(GHOST_OPACITY, 6);
      expect((mesh.material as MeshStandardMaterial).transparent).toBe(true);
    }
    // One copy per mesh, handed back so the caller can dispose of them.
    expect(cloned).toHaveLength(2);
  });

  it('stops writing depth and casting shadows, because it is not there', () => {
    const { group, meshes } = shared();
    fadeToGhost(group);
    for (const mesh of meshes) {
      expect((mesh.material as MeshStandardMaterial).depthWrite).toBe(false);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
    }
  });

  it('is half solid by default, and takes another amount when asked', () => {
    expect(GHOST_OPACITY).toBe(0.5);
    const { group, meshes } = shared();
    fadeToGhost(group, 0.2);
    expect((meshes[0]!.material as MeshStandardMaterial).opacity).toBeCloseTo(0.2, 6);
  });

  it('walks past anything with no material of its own', () => {
    const group = new Group();
    group.add(new Group());
    expect(() => fadeToGhost(group)).not.toThrow();
    expect(fadeToGhost(group)).toEqual([]);
  });
});

describe('the ghost on the board', () => {
  const make = (id: string): BuiltModel => {
    const { group } = shared();
    group.name = `model:${id}`;
    return { group, spec: { id } as BuiltModel['spec'], named: new Map(), hooks: new Map() };
  };

  it('builds once per model and keeps it, rather than once per frame', () => {
    const root = new Group();
    let built = 0;
    const ghost = new PropGhost(root, (id) => { built++; return make(id); }, () => {});
    for (let frame = 0; frame < 10; frame++) ghost.show('crate', (model) => model.group.position.setX(frame));
    expect(built).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(ghost.shown?.id).toBe('crate');

    // A different model is a different ghost, and the old one comes off the board.
    ghost.show('barrel', () => {});
    expect(built).toBe(2);
    expect(root.children).toHaveLength(1);
    expect(ghost.shown?.id).toBe('barrel');
  });

  it('is seated by the caller, so it stands where the real prop would', () => {
    const root = new Group();
    const ghost = new PropGhost(root, make, () => {});
    ghost.show('crate', (model) => {
      model.group.position.set(3, 0, 4);
      model.group.scale.setScalar(3);
    });
    expect(ghost.shown).toEqual({ id: 'crate', span: 3 });
    expect(root.children[0]!.position.x).toBe(3);
  });

  it('comes down when hidden, and tells whoever is keeping clips about it', () => {
    const root = new Group();
    const forgotten: unknown[] = [];
    const ghost = new PropGhost(root, make, (of) => forgotten.push(of));
    ghost.show('crate', () => {});
    const group = root.children[0]!;
    ghost.hide();
    expect(root.children).toHaveLength(0);
    expect(ghost.shown).toBeNull();
    expect(forgotten).toEqual([group]);
    // Hiding what is already hidden is not an error and forgets nothing twice.
    ghost.hide();
    expect(forgotten).toHaveLength(1);
  });
});
