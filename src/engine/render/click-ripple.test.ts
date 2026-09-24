/**
 * The ground answering a click: a ripple that spreads and fades where a walk was ordered, and a
 * red shake where one was refused - each gone when its time is up, and never a pile of them.
 */

import { describe, it, expect } from 'vitest';
import { MeshBasicMaterial, type Mesh } from 'three';
import { TileGrid } from '../grid/grid';
import { SceneView } from './scene-view';
import { ClickRipples, REFUSAL_SECONDS, RIPPLE_SECONDS, ripplesIn } from './click-ripple';

const opacity = (mesh: Mesh): number => (mesh.material as MeshBasicMaterial).opacity;
const ripples = (): ClickRipples => new ClickRipples(() => 1);
/** Time passing as it does in play, a frame at a time, rather than in one leap a frame would never make. */
const play = (tick: (dt: number) => void, seconds: number): void => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) tick(Math.min(1 / 60, seconds - t));
};

describe('a ripple', () => {
  it('spreads and fades where it landed, the second ring a beat behind the first, and is gone at the end', () => {
    const r = ripples();
    r.add({ x: 3, y: 0.5, z: -2 }, 'go');
    expect(r.count).toBe(1);
    const [group] = r.group.children;
    expect(group!.position.x).toBe(3);
    expect(group!.position.z).toBe(-2);
    // Just above the ground it landed on, so the ground does not swallow it.
    expect(group!.position.y).toBeGreaterThan(0.5);
    const [first, second] = ripplesIn(group!);

    play((dt) => r.tick(dt), RIPPLE_SECONDS * 0.1);
    const early = { size: first!.scale.x, seen: opacity(first!) };
    // The second has not started yet.
    expect(opacity(second!)).toBe(0);
    play((dt) => r.tick(dt), RIPPLE_SECONDS * 0.4);
    expect(first!.scale.x).toBeGreaterThan(early.size);
    expect(opacity(first!)).toBeLessThan(early.seen);
    expect(opacity(second!)).toBeGreaterThan(0);

    play((dt) => r.tick(dt), RIPPLE_SECONDS);
    expect(r.count).toBe(0);
    expect(r.group.children).toHaveLength(0);
  });

  it('shakes red in place where the click walked nobody, and is gone sooner', () => {
    const r = ripples();
    r.add({ x: 1, y: 0, z: 1 }, 'no');
    const group = r.group.children[0]!;
    const [ring] = ripplesIn(group);
    expect((ring!.material as MeshBasicMaterial).color.getHexString()).toBe('e0533f');
    const moved = new Set<number>();
    for (let i = 0; i < 8; i++) {
      r.tick(REFUSAL_SECONDS / 10);
      moved.add(Number(group.position.x.toFixed(4)));
    }
    // Side to side, not a spread: it went both ways about where it landed.
    expect(Math.min(...moved)).toBeLessThan(1);
    expect(Math.max(...moved)).toBeGreaterThan(1);
    play((dt) => r.tick(dt), REFUSAL_SECONDS);
    expect(r.count).toBe(0);
  });

  it('outlives a frame longer than its whole life, so a hitch never swallows the answer to a click', () => {
    const r = ripples();
    r.add({ x: 0, y: 0, z: 0 }, 'go');
    r.tick(5);
    expect(r.count).toBe(1);
    // And is gone in a handful of ordinary frames after.
    for (let i = 0; i < 10; i++) r.tick(RIPPLE_SECONDS / 5);
    expect(r.count).toBe(0);
  });

  it('keeps no more than a short trail when the clicks come fast', () => {
    const r = ripples();
    for (let i = 0; i < 20; i++) r.add({ x: i, y: 0, z: 0 }, 'go');
    expect(r.count).toBe(6);
    // The newest stay: the trail is the last few clicks.
    expect(r.group.children.map((child) => child.position.x)).toEqual([14, 15, 16, 17, 18, 19]);
    r.clear();
    expect(r.group.children).toHaveLength(0);
  });
});

describe('the view', () => {
  it('ripples the ground at the spot clicked, and lets it go', () => {
    const view = new SceneView(new TileGrid({ width: 5, height: 3 }));
    view.ripple({ x: 2, y: 1 }, true);
    expect(view.rippleCount).toBe(1);
    const group = view.root.getObjectByName('click-ripples')!.children[0]!;
    // The middle tile of a 5 by 3 room is the middle of the world.
    expect(group.position.x).toBeCloseTo(0, 6);
    expect(group.position.z).toBeCloseTo(0, 6);
    play((dt) => view.tick(dt), RIPPLE_SECONDS * 2);
    expect(view.rippleCount).toBe(0);
    view.dispose();
  });
});
