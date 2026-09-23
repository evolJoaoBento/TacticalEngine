import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { tileOf } from '../engine/scene/grid-from-scene';
import { answerPending, buildDemoScene, useSelectedOn, type DemoScene } from './demo-scene';
import { interactablesOf } from '../engine/scene/prop-functions';

/**
 * The vault door, picked rather than force-opened.
 *
 * It starts shut and in the way; a Finesse roll opens it; a failed roll leaves
 * it shut but does not use it up; an open door is not rolled again.
 */

const scene = (seed: string): DemoScene => buildDemoScene(hollowVaultMap(), seed);

function door(demo: DemoScene) {
  return interactablesOf(demo.scene).find((i) => i.kind === 'door')!;
}

function tryTheDoor(demo: DemoScene): string {
  const d = door(demo);
  demo.state.moveEntity(demo.party.selected!, tileOf(demo.grid, { x: d.position.x - 1, y: d.position.y }));
  const result = useSelectedOn(demo, d.id);
  if (result.status === 'waiting') answerPending(demo, { kind: 'roll' });
  return result.status;
}

/** A seed whose first roll on the door lands the way the test wants. */
function seedWhere(open: boolean): DemoScene {
  for (let seed = 0; seed < 60; seed++) {
    const demo = scene(`door-${seed}`);
    tryTheDoor(demo);
    if (demo.state.interactable(door(demo).id).open === open) return demo;
  }
  throw new Error(`no seed where the door ${open ? 'opened' : 'stayed shut'}`);
}

describe('the vault door', () => {
  it('starts shut and blocks the way', () => {
    const demo = scene('door');
    const d = door(demo);
    expect(demo.state.interactable(d.id).open).toBe(false);
    expect(demo.state.blockedFor(demo.party.selected!)(tileOf(demo.grid, d.position))).toBe(true);
    expect(d.repeatable).toBe(true);
  });

  it('opens on a good roll, and stops blocking', () => {
    const demo = seedWhere(true);
    const d = door(demo);
    expect(demo.state.blockedFor(demo.party.selected!)(tileOf(demo.grid, d.position))).toBe(false);
    expect(demo.log.some((l) => /grinds open|swings open|opens/i.test(l.text))).toBe(true);
  });

  it('stays shut on a bad roll, and can be tried again', () => {
    const demo = seedWhere(false);
    const d = door(demo);
    expect(demo.state.blockedFor(demo.party.selected!)(tileOf(demo.grid, d.position))).toBe(true);
    // Used, but repeatable: another go is offered, not refused.
    expect(tryTheDoor(demo)).toBe('waiting');
  });

  it('is not rolled again once open', () => {
    const demo = seedWhere(true);
    expect(tryTheDoor(demo)).toBe('refused');
    expect(demo.log.at(-1)!.text).toBe('It is already open.');
  });
});
