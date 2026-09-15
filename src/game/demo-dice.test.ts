import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { runScript } from '../engine/script/runner';
import {
  attackWithSelected,
  buildDemoScene,
  endTurn,
  record,
  type DemoScene,
} from './demo-scene';
import { startEncounter } from './movement';

/**
 * The Duality Dice a view has to show.
 *
 * The rules never wait for them — a roll is decided, applied and logged in one
 * breath — so what is asserted here is the queue: whose roll it was, which
 * faces it landed on, and that a d20 leaves nothing behind to watch.
 */

const scene = (seed = 'dice'): DemoScene => buildDemoScene(demoMap(), seed);

/** Kara, next to the nearest thing worth swinging at. */
function standoff(seed = 'dice'): { demo: DemoScene; foe: string } {
  const demo = scene(seed);
  demo.askDefender = false;
  startEncounter(demo, demo.scene.encounters[0]!.id);
  const foe = demo.state.entitiesOf('adversary').find((e) => e.alive)!.id;
  demo.state.moveEntity(
    'kara',
    demo.grid.indexOf(demo.grid.xOf(demo.state.entity(foe)!.tile) - 1, demo.grid.yOf(demo.state.entity(foe)!.tile)),
  );
  demo.party.select('kara');
  return { demo, foe };
}

describe('the dice a player watches land', () => {
  it('queues the faces of a party swing, with the weapon it was rolled for', () => {
    const { demo, foe } = standoff('swing');
    expect(demo.rolls).toEqual([]);
    attackWithSelected(demo, foe);

    expect(demo.rolls).toHaveLength(1);
    const shown = demo.rolls[0]!;
    expect(shown.who).toBe('Kara');
    expect(shown.what).toBe('the Longsword');
    // The faces are the roll's own: two d12s, and the total they add up to.
    expect(shown.roll.good).toBeGreaterThanOrEqual(1);
    expect(shown.roll.good).toBeLessThanOrEqual(12);
    expect(shown.roll.bad).toBeGreaterThanOrEqual(1);
    expect(shown.roll.bad).toBeLessThanOrEqual(12);
    expect(shown.roll.total).toBe(
      shown.roll.good + shown.roll.bad + shown.roll.advantageDie + shown.roll.helpBonus + shown.roll.modifier,
    );
  });

  it('leaves nothing to watch when the GM rolls, because a d20 is not the Duality Dice', () => {
    const { demo } = standoff('gm');
    demo.rolls.length = 0;
    for (let i = 0; i < 3 && demo.encounter?.outcome === 'ongoing'; i++) endTurn(demo);
    // Adversaries swung, and hit or missed, and none of it is dice anyone
    // watches: the GM rolls one d20 and the log says what it did.
    expect(demo.log.some((l) => l.text.includes('misses') || l.text.includes('hits'))).toBe(true);
    expect(demo.rolls).toEqual([]);
  });

  it('is a queue, not a slot: a feature that catches the party rolls several at once', () => {
    // What Hellfire does: everyone in range rolls to get out of the way. They
    // are rolled in one breath, so the view has a line of dice to work through.
    const { demo } = standoff('burst');
    demo.rolls.length = 0;
    const journal = runScript(
      [{ kind: 'reactionRoll', difficulty: 12, trait: 'agility', targets: { kind: 'party' } }],
      demo.world,
      demo.rng,
    );
    record(demo, journal);

    expect(demo.rolls.length).toBeGreaterThan(1);
    // In the order they were rolled, each one naming who rolled it.
    const ids = demo.rolls.map((shown) => shown.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(demo.rolls.map((shown) => shown.who)).toContain('Kara');
    expect(new Set(demo.rolls.map((shown) => shown.who)).size).toBe(demo.rolls.length);
  });

  it('starts every scene with a settle time a view can turn off', () => {
    const demo = scene();
    expect(demo.diceMillis).toBeGreaterThan(0);
    demo.diceMillis = 0;
    expect(demo.diceMillis).toBe(0);
  });
});
