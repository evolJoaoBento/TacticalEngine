/**
 * Holding the button: one short step towards the pointer, and never a push out of the circle.
 */

import { describe, expect, it } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { movementCircle } from './circle';
import { startEncounter } from './movement';
import { WALK_PER_TILE } from '../engine/render/glide';
import { STEER_MOST, STEER_STOP, steerStep } from './steer';

/** A tick of a held button, as long as the demo's own pace makes it: a quarter-tile step. */
const TICK = 0.25 * WALK_PER_TILE;

const build = (): DemoScene => buildDemoScene(hollowVaultMap(), 'steer');

/** Where the selected character stands. */
const stood = (demo: DemoScene): { x: number; y: number } => ({ ...demo.state.entity(demo.party.selected!)!.at });

describe('a steered walk', () => {
  it('covers what a walk covers in the time the step stands for, and no more', () => {
    const demo = build();
    const from = stood(demo);
    const step = steerStep(demo, { x: from.x + 9, y: from.y }, TICK)!;
    expect(step).not.toBeNull();
    expect(step.x - from.x).toBeCloseTo(0.25, 6); // a quarter of a tile in a quarter of a tile's time
    expect(step.y).toBeCloseTo(from.y, 6);
    // Twice the time, twice the ground: holding the button is walking, not sprinting.
    expect(steerStep(demo, { x: from.x + 9, y: from.y }, 2 * TICK)!.x - from.x).toBeCloseTo(0.5, 6);
    // A tick lost to something else is still only a step, not a leap.
    expect(steerStep(demo, { x: from.x + 9, y: from.y }, 30)!.x - from.x).toBeCloseTo(STEER_MOST, 6);
    // No time, no step.
    expect(steerStep(demo, { x: from.x + 9, y: from.y }, 0)).toBeNull();
  });

  it('goes only as far as the pointer when that is nearer than the step', () => {
    const demo = build();
    const from = stood(demo);
    const step = steerStep(demo, { x: from.x + 0.6, y: from.y + 0.6 }, 30)!;
    expect(Math.hypot(step.x - from.x, step.y - from.y)).toBeCloseTo(Math.hypot(0.6, 0.6), 6);
  });

  it('does nothing with the pointer under their feet, or with nobody to command', () => {
    const demo = build();
    const from = stood(demo);
    expect(steerStep(demo, { x: from.x + STEER_STOP / 2, y: from.y }, TICK)).toBeNull();
    demo.state.entity(demo.party.selected!)!.alive = false;
    expect(steerStep(demo, { x: from.x + 9, y: from.y }, TICK)).toBeNull();
  });

  it('waits while a prompt is up, and while the party is walking into an ambush', () => {
    const demo = build();
    const from = stood(demo);
    demo.pending = { kind: 'script', prompt: { kind: 'choice', text: '', options: [] } } as never;
    expect(steerStep(demo, { x: from.x + 9, y: from.y }, TICK)).toBeNull();
    demo.pending = null;
    demo.ambush = 'whatever';
    expect(steerStep(demo, { x: from.x + 9, y: from.y }, TICK)).toBeNull();
  });

  it('stays inside the circle in a fight, and stops at its edge rather than asking for a push', () => {
    const demo = build();
    const id = demo.party.selected!;
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const circle = movementCircle(demo, id)!;
    // Aimed far past the edge, and steered until it stops: every step stays inside the circle.
    const far = { x: circle.anchor.x + 30, y: circle.anchor.y };
    let steps = 0;
    for (; steps < 12; steps++) {
      const step = steerStep(demo, far, 30);
      if (step === null) break;
      expect(Math.hypot(step.x - circle.anchor.x, step.y - circle.anchor.y)).toBeLessThanOrEqual(circle.radius);
      demo.state.placeEntity(id, step.x, step.y);
    }
    expect(steps).toBeGreaterThan(1);
    expect(steps).toBeLessThan(12);
    // It stopped at the edge, with the push left for a click to ask for, and nothing spent on any of it.
    const stopped = demo.state.entity(id)!.at;
    expect(Math.hypot(stopped.x - circle.anchor.x, stopped.y - circle.anchor.y)).toBeGreaterThan(circle.radius - 0.6);
    expect(demo.encounter!.canAct(id)).toBe(true);
  });
});
