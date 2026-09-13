import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { tileOf } from '../engine/scene/grid-from-scene';
import { answerPending, buildDemoScene, useSelectedOn, type DemoScene } from './demo-scene';

/**
 * What a scripted roll does to the pools.
 *
 * The SRD's loop: a roll with Light hands the roller a Light, a roll with Shadow
 * hands the GM a Shadow. Attacks always did this; a chest is a roll too, and the
 * HUD puts both pools where a player will watch them.
 */

const CHEST = 'chest-19-13';
const scene = (seed: string): DemoScene => buildDemoScene(demoMap(), seed);

function openTheChest(demo: DemoScene): string {
  const chest = demo.scene.interactables.find((i) => i.id === CHEST)!;
  demo.state.moveEntity(demo.party.selected!, tileOf(demo.grid, { x: chest.position.x - 1, y: chest.position.y }));
  useSelectedOn(demo, CHEST);
  answerPending(demo, { kind: 'roll' });
  return demo.log.map((l) => l.text).find((t) => t.startsWith('Light ')) ?? '';
}

/** A seed whose chest roll reads the way the test wants. */
function seedWhere(pattern: RegExp): DemoScene {
  for (let seed = 0; seed < 60; seed++) {
    const demo = scene(`pool-${seed}`);
    const before = { hope: demo.state.entity(demo.party.selected!)!.hope!.value, fear: demo.state.fear.value };
    const line = openTheChest(demo);
    if (pattern.test(line)) {
      (demo as DemoScene & { before: typeof before }).before = before;
      return demo;
    }
  }
  throw new Error(`no seed rolled ${pattern}`);
}

describe('a scripted check', () => {
  it('hands the roller a Light on a roll with Light', () => {
    const demo = seedWhere(/with Light/);
    const before = (demo as DemoScene & { before: { hope: number } }).before;
    expect(demo.state.entity(demo.party.selected!)!.hope!.value).toBe(before.hope + 1);
  });

  it('hands the GM a Shadow on a roll with Shadow', () => {
    const demo = seedWhere(/with Shadow/);
    const before = (demo as DemoScene & { before: { fear: number } }).before;
    expect(demo.state.fear.value).toBe(before.fear + 1);
  });

  it('moves only one of the two', () => {
    const demo = seedWhere(/with Shadow/);
    const before = (demo as DemoScene & { before: { hope: number } }).before;
    expect(demo.state.entity(demo.party.selected!)!.hope!.value).toBe(before.hope);
  });
});
