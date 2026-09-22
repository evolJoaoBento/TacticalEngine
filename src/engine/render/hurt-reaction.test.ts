import { beforeEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { FLASH_WIDTH, OUTLINE_NAME, flashOutline, forgetOutlines, outline, recolourOutline } from './faction-outline';
import { HURT_RIM, HURT_SECONDS, poseHurt, restFromHurt } from './hurt-reaction';

const RED = '#d8402c';
const BLUE = '#69d2ff';

function creature(): Group {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  return group;
}

const rimOf = (group: Group): Mesh => group.children.find((child) => child.name === OUTLINE_NAME) as Mesh;
const colourOf = (group: Group): string => `#${(rimOf(group).material as MeshBasicMaterial).color.getHexString()}`;

beforeEach(() => forgetOutlines());

describe('a token being hurt', () => {
  it('swells on the blow, rocks, and is back to itself by the end - without ever leaving where it stands', () => {
    const group = creature();
    group.position.set(3, 1, -2);
    poseHurt(group, 0);
    expect(group.scale.x).toBeCloseTo(1, 6);
    // The impact: wider, a little squatter, not yet leaning.
    poseHurt(group, 0.1);
    expect(group.scale.x).toBeGreaterThan(1.1);
    expect(group.scale.y).toBeLessThan(1);
    // The recoil rocks both ways before it dies away.
    const leans = [0.08, 0.25, 0.42, 0.58, 0.75].map((t) => {
      poseHurt(group, t);
      return group.rotation.z;
    });
    expect(Math.max(...leans)).toBeGreaterThan(0.05);
    expect(Math.min(...leans)).toBeLessThan(-0.05);
    expect(Math.abs(leans[4]!)).toBeLessThan(Math.abs(leans[0]!));
    poseHurt(group, 1);
    expect(group.scale.x).toBeCloseTo(1, 6);
    expect(group.rotation.z).toBeCloseTo(0, 6);
    expect(group.position.toArray()).toEqual([3, 1, -2]);
    restFromHurt(group);
    expect(group.scale.toArray()).toEqual([1, 1, 1]);
    expect(HURT_SECONDS).toBeGreaterThan(0.35);
  });
});

describe('the line round somebody being hurt', () => {
  it('burns red and wide for the moment, and goes back to what it was', () => {
    const group = creature();
    outline(group, 'husk', RED);
    const resting = rimOf(group).material;
    const undo = flashOutline(group, HURT_RIM);
    expect(colourOf(group)).toBe(HURT_RIM);
    expect(rimOf(group).material).not.toBe(resting);
    expect(FLASH_WIDTH).toBeGreaterThan(1);
    undo();
    expect(rimOf(group).material).toBe(resting);
  });

  it('goes back to the colour it is given mid-flash, rather than being cut short by it', () => {
    const group = creature();
    outline(group, 'husk', RED);
    const undo = flashOutline(group, HURT_RIM);
    // The pointer found them, or they were selected, while the blow was still showing.
    expect(recolourOutline(group, BLUE)).toBe(false);
    expect(colourOf(group)).toBe(HURT_RIM);
    undo();
    expect(colourOf(group)).toBe(BLUE);
  });

  it('takes a second blow on top of the first without remembering red as the colour to go back to', () => {
    const group = creature();
    outline(group, 'husk', RED);
    const first = flashOutline(group, HURT_RIM);
    first();
    const again = flashOutline(group, HURT_RIM);
    const second = flashOutline(group, HURT_RIM);
    again();
    second();
    expect(colourOf(group)).toBe(RED);
  });

  it('is nothing at all on a model with no line round it', () => {
    expect(() => flashOutline(creature(), HURT_RIM)()).not.toThrow();
  });
});
