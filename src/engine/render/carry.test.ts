import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { CarryMotion, LIFT, MAX_LEAN, follow, leanFor, squashAt } from './carry';

/** A box one unit tall standing at 2,0,3, turned a radian, in a scene so it has a parent. */
function standing(): Group {
  const scene = new Scene();
  const group = new Group();
  const box = new Mesh(new BoxGeometry(0.5, 1, 0.5), new MeshBasicMaterial());
  box.position.y = 0.5;
  group.add(box);
  group.position.set(2, 0, 3);
  group.rotation.y = 1;
  scene.add(group);
  return group;
}

function run(motion: CarryMotion, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) motion.tick(1 / 60);
}

describe('the spring and the curves', () => {
  it('follows a goal without ever passing it', () => {
    let [x, v] = [0, 0];
    let most = 0;
    for (let i = 0; i < 120; i++) {
      [x, v] = follow(x, v, 1, 14, 1 / 60);
      most = Math.max(most, x);
    }
    expect(most).toBeLessThanOrEqual(1 + 1e-9);
    expect(x).toBeCloseTo(1, 3);
  });

  it('stays put through a very slow frame rather than flying off', () => {
    const [x] = follow(0, 0, 1, 14, 2);
    expect(x).toBeGreaterThan(0.99);
    expect(x).toBeLessThanOrEqual(1);
  });

  it('leans with speed, never past the most it leans', () => {
    expect(leanFor(1)).toBeGreaterThan(0);
    expect(leanFor(1000)).toBe(MAX_LEAN);
    expect(leanFor(-1000)).toBe(-MAX_LEAN);
  });

  it('squashes on landing, bounces once, and comes to rest', () => {
    expect(squashAt(0)).toBeGreaterThan(0.15);
    expect(Math.min(...[0.2, 0.3, 0.4, 0.5].map(squashAt))).toBeLessThan(0);
    expect(squashAt(1)).toBe(0);
  });
});

describe('carrying a thing', () => {
  it('lifts it off the ground where it stood', () => {
    const group = standing();
    const motion = new CarryMotion();
    motion.lift(group);
    expect(motion.carrying).toBe(true);
    run(motion, 0.5);
    expect(group.position.y).toBeCloseTo(LIFT, 1);
    expect(group.position.x).toBeCloseTo(2, 2);
    expect(group.position.z).toBeCloseTo(3, 2);
  });

  it('hangs from its top, so moving it swings its bottom behind', () => {
    const group = standing();
    const motion = new CarryMotion();
    motion.lift(group);
    run(motion, 0.3);
    motion.moveTo(6, 0, 3);
    run(motion, 0.12);
    // Going along +X: leaning about Z so its feet trail back toward where it came from.
    expect(group.rotation.z).toBeLessThan(-0.05);
    const top = new Vector3(0, 1, 0).applyEuler(group.rotation).add(group.position);
    expect(group.position.x).toBeLessThan(top.x - 0.05);
    // Going along +Z leans it about X the other way round, feet trailing toward -Z.
    motion.moveTo(6, 0, 7);
    run(motion, 0.12);
    expect(group.rotation.x).toBeGreaterThan(0.05);
    // Caught up and still: upright over the new spot, still facing the way it was placed.
    run(motion, 3);
    expect(Math.abs(group.rotation.x)).toBeLessThan(0.02);
    expect(Math.abs(group.rotation.z)).toBeLessThan(0.02);
    expect(group.rotation.y).toBe(1);
    expect(group.position.x).toBeCloseTo(6, 1);
    expect(group.position.z).toBeCloseTo(7, 1);
  });

  it('drops a fresh copy where the document has it, squashes it, and leaves it at rest', () => {
    const group = standing();
    const motion = new CarryMotion();
    motion.lift(group);
    motion.moveTo(4, 0, 3);
    run(motion, 0.4);
    // The editor moved it: the view drew a new one where it landed, and the carried one is gone.
    const landed = standing();
    landed.position.set(4, 0, 3);
    group.removeFromParent();
    motion.drop(landed);
    expect(motion.carrying).toBe(false);
    // It starts from where the carried one hung, not at its rest.
    expect(landed.position.y).toBeGreaterThan(0.3);
    let flattest = 1;
    for (let t = 0; t < 0.8; t += 1 / 60) {
      motion.tick(1 / 60);
      flattest = Math.min(flattest, landed.scale.y);
    }
    expect(flattest).toBeLessThan(0.9);
    expect(motion.holding).toBeNull();
    expect(landed.position.toArray()).toEqual([4, 0, 3]);
    expect(landed.rotation.toArray()).toEqual([0, 1, 0, 'XYZ']);
    expect(landed.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('puts the same one back where it stood when nothing moved', () => {
    const group = standing();
    const motion = new CarryMotion();
    motion.lift(group);
    run(motion, 0.1);
    motion.drop(null);
    run(motion, 1);
    expect(group.position.toArray()).toEqual([2, 0, 3]);
    expect(group.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('lets go of a thing drawn away mid-carry, and ignores a pointer with nothing in hand', () => {
    const group = standing();
    const motion = new CarryMotion();
    motion.moveTo(9, 0, 9);
    motion.drop(null);
    expect(motion.holding).toBeNull();
    motion.lift(group);
    group.removeFromParent();
    motion.tick(1 / 60);
    expect(motion.holding).toBeNull();
  });
});
