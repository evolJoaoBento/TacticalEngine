import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { createRng } from '../engine/core/rng';
import { runScript } from '../engine/script/runner';
import { buildDemoScene, float, record, type DemoScene } from './demo-scene';

/**
 * Numbers over heads.
 *
 * The log says what happened; a floater says it where it happened, over the
 * creature it happened to. They are written beside the log line, from the
 * same journal entry, so a view has only to draw them - and a headless run
 * that never draws them loses nothing.
 */

const scene = (): DemoScene => buildDemoScene(demoMap(), 'demo');

describe('what floats', () => {
  it('is the wound, over whoever took it, in the log line\'s tone', () => {
    const demo = scene();
    const husk = demo.state.entitiesOf('adversary')[0]!.id;
    record(demo, [
      { kind: 'attack', attacker: 'kara', target: husk, weapon: 'broadsword', hit: true, critical: false, hitPointsMarked: 2 },
    ]);
    expect(demo.floaters).toEqual([{ id: husk, text: '-2 HP', tone: 'combat' }]);
    expect(demo.log.at(-1)?.tone).toBe('combat');
  });

  it('is a miss, since the swing was watched', () => {
    const demo = scene();
    const husk = demo.state.entitiesOf('adversary')[0]!.id;
    record(demo, [
      { kind: 'attack', attacker: 'kara', target: husk, weapon: 'broadsword', hit: false, critical: false, hitPointsMarked: 0 },
    ]);
    expect(demo.floaters).toEqual([{ id: husk, text: 'miss', tone: 'system' }]);
  });

  it('is the pool that moved: Stress marked or cleared, Armor cleared, Hope gained', () => {
    const demo = scene();
    record(demo, [
      { kind: 'stress', id: 'kara', marked: 1, cleared: 0, hitPoints: 0 },
      { kind: 'stress', id: 'finn', marked: 0, cleared: 2, hitPoints: 0 },
      { kind: 'armor', id: 'kara', cleared: 1 },
      { kind: 'hope', gained: 1, id: 'mira' },
    ]);
    expect(demo.floaters).toEqual([
      { id: 'kara', text: '+1 Stress', tone: 'fear' },
      { id: 'finn', text: '-2 Stress', tone: 'hope' },
      { id: 'kara', text: '+1 Armor', tone: 'hope' },
      { id: 'mira', text: '+1 Hope', tone: 'hope' },
    ]);
  });

  it('is the condition by its name, going on and not coming off', () => {
    const demo = scene();
    record(demo, [
      { kind: 'condition', id: 'kara', condition: 'holding-the-line', applied: true },
      { kind: 'condition', id: 'kara', condition: 'holding-the-line', applied: false },
    ]);
    expect(demo.floaters).toEqual([{ id: 'kara', text: 'Holding the Line', tone: 'combat' }]);
  });

  it('is the healing, over each of the healed, because the runner says who', () => {
    const demo = scene();
    demo.state.entity('kara')!.hitPoints.marked = 3;
    const journal = runScript([{ kind: 'heal', amount: 2, target: { kind: 'entity', id: 'kara' } }], demo.world, createRng(1));
    const healed = journal.find((e) => e.kind === 'heal');
    expect(healed).toMatchObject({ kind: 'heal', amount: 2, ids: ['kara'] });
    record(demo, journal);
    expect(demo.floaters).toEqual([{ id: 'kara', text: '+2', tone: 'hope' }]);
  });

  it('keeps a shared healing in the log, since the journal has only the total', () => {
    const demo = scene();
    for (const id of ['kara', 'finn']) demo.state.entity(id)!.hitPoints.marked = 2;
    const journal = runScript([{ kind: 'heal', amount: 3, spread: true, target: { kind: 'party' } }], demo.world, createRng(1));
    expect(journal.find((e) => e.kind === 'heal')).toMatchObject({ kind: 'heal', spread: true });
    record(demo, journal);
    expect(demo.floaters).toEqual([]);
  });

  it('floats over nobody who is not on the board', () => {
    const demo = scene();
    float(demo, 'nobody', '-1 HP', 'combat');
    expect(demo.floaters).toEqual([]);
    // The room's own damage - "You take 3 damage" - names no head to float over.
    record(demo, [{ kind: 'damage', amount: 3, marked: 1 }]);
    expect(demo.floaters).toEqual([]);
  });
});
