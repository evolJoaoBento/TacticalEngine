/**
 * Doors hung on their hinges.
 *
 * Three things are easy to get subtly wrong and look almost right: hanging a door must not move
 * it, it must turn about its front left edge and not its middle, and a room drawn again must not
 * replay a swing that already happened. Each is checked in world space, which is what is drawn.
 */

import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { DoorSwings, SWING, SWING_SECONDS } from './door-swing';

/** A door slab a tile wide and a tenth deep, standing at (3, 0, 4) and turned by `facing`. */
function slab(facing = 0): Group {
  const scene = new Scene();
  const group = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 2, 0.1), new MeshBasicMaterial());
  mesh.position.y = 1;
  group.add(mesh);
  group.position.set(3, 0, 4);
  group.rotation.y = facing;
  scene.add(group);
  return group;
}

const world = (object: Group): Vector3 => {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(new Vector3());
};

describe('hanging a door', () => {
  for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    it(`leaves it exactly where it stood, facing ${facing.toFixed(2)}`, () => {
      const door = slab(facing);
      const scene = door.parent!;
      const before = world(door);
      const pivot = new DoorSwings().hang('d', door);
      scene.add(pivot);
      const after = world(door);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.z).toBeCloseTo(before.z, 6);
      expect(pivot.rotation.y).toBeCloseTo(facing, 9);
    });
  }

  it('puts the hinge on the front left edge of the model, not the corner of its tile', () => {
    const pivot = new DoorSwings().hang('d', slab(0));
    // Half the slab's width to the left, half its depth to the front: the end of the slab.
    expect(pivot.position.x).toBeCloseTo(2.5, 6);
    expect(pivot.position.z).toBeCloseTo(4.05, 6);
  });

  it('remembers where the door stands, since the hinge does not stand there', () => {
    // The editor finds the tile a press landed on from the top of what was pressed, which for a
    // door is the hinge; read off the hinge, a door was picked up from the tile beside it.
    const pivot = new DoorSwings().hang('d', slab(Math.PI / 2));
    expect(pivot.userData.stands).toEqual({ x: 3, z: 4 });
  });
});

describe('swinging it', () => {
  it('turns a quarter, easing, about the hinge - which does not move', () => {
    const swings = new DoorSwings();
    const door = slab(0);
    const scene = door.parent!;
    const pivot = swings.hang('d', door);
    scene.add(pivot);
    const hinge = pivot.position.clone();

    swings.setOpen(new Set(['d']));
    swings.tick(SWING_SECONDS / 2);
    const half = swings.angleOf('d')!;
    expect(half).toBeLessThan(0);
    expect(half).toBeGreaterThan(SWING);
    swings.tick(SWING_SECONDS);
    expect(swings.angleOf('d')).toBeCloseTo(SWING, 9);
    expect(pivot.position.equals(hinge)).toBe(true);

    // The free end went towards the front: the middle of the slab is now in front of the hinge.
    const middle = world(door);
    expect(middle.z).toBeGreaterThan(hinge.z + 0.3);

    swings.setOpen(new Set());
    swings.tick(SWING_SECONDS);
    expect(swings.angleOf('d')).toBeCloseTo(0, 9);
  });

  it('comes back open when the room is drawn again, rather than swinging open a second time', () => {
    const swings = new DoorSwings();
    swings.hang('d', slab(0));
    swings.setOpen(new Set(['d']));
    swings.tick(SWING_SECONDS);
    swings.clear();
    swings.hang('d', slab(0));
    expect(swings.angleOf('d')).toBeCloseTo(SWING, 9);
  });

  it('knows nothing of a prop that was never hung', () => {
    expect(new DoorSwings().angleOf('crate')).toBeNull();
  });
});
