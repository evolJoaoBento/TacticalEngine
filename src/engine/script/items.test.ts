import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import { createRng } from '../core/rng';
import { SceneState } from '../scene/state';
import { evaluate } from './conditions';
import { runScript } from './runner';
import {
  SceneScriptWorld,
  createScenarioState,
  restoreScenario,
  scenarioSnapshot,
  scenarioSnapshotSchema,
} from './world';

/**
 * What the party carries.
 *
 * Keys used to be a `Set<string>` of their own, separate from anything else the
 * party might hold. They are items now — a key is an item you have one of — so
 * these cover both the new vocabulary and the old one still working over it.
 */

function world(): SceneScriptWorld {
  const state = new SceneState({ id: 'room' }, new TileGrid({ width: 4, height: 4 }));
  return new SceneScriptWorld(state, createScenarioState(), { traits: { finesse: 2 } });
}

const run = (w: SceneScriptWorld, effects: Parameters<typeof runScript>[0]) =>
  runScript(effects, w, createRng(7));

describe('carrying things', () => {
  it('starts with nothing', () => {
    const w = world();
    expect(w.itemCount('gold')).toBe(0);
    expect(w.hasItem('gold')).toBe(false);
  });

  it('adds and stacks', () => {
    const w = world();
    expect(w.addItem('gold', 12)).toBe(12);
    expect(w.addItem('gold', 8)).toBe(20);
    expect(w.hasItem('gold', 20)).toBe(true);
    expect(w.hasItem('gold', 21)).toBe(false);
  });

  it('takes some away, and forgets an item once none are left', () => {
    const w = world();
    w.addItem('draught', 3);
    expect(w.removeItem('draught', 2)).toBe(2);
    expect(w.itemCount('draught')).toBe(1);

    expect(w.removeItem('draught', 1)).toBe(1);
    expect(w.hasItem('draught')).toBe(false);
    // Gone entirely rather than sitting at zero.
    expect(w.scenario.items.has('draught')).toBe(false);
  });

  it('cannot take more than the party has', () => {
    const w = world();
    w.addItem('rope', 1);
    // Reports what actually went, so a script can say so truthfully.
    expect(w.removeItem('rope', 5)).toBe(1);
    expect(w.itemCount('rope')).toBe(0);
  });

  it('ignores a removal of something never held', () => {
    const w = world();
    expect(w.removeItem('nothing', 3)).toBe(0);
  });

  it('ignores a nonsense quantity rather than going backwards', () => {
    const w = world();
    w.addItem('coin', 5);
    expect(w.addItem('coin', 0)).toBe(5);
    expect(w.addItem('coin', -3)).toBe(5);
  });
});

describe('the old key vocabulary, over items', () => {
  it('gives a key as an item, and finds it either way', () => {
    const w = world();
    w.giveKey('brass');
    expect(w.hasKey('brass')).toBe(true);
    expect(w.hasItem('brass')).toBe(true);
    expect(w.itemCount('brass')).toBe(1);
  });

  it('answers a hasKey condition from an item a script added', () => {
    const w = world();
    run(w, [{ kind: 'addItem', item: 'brass', quantity: 1 }]);
    // Content written before items existed keeps working.
    expect(evaluate({ kind: 'hasKey', key: 'brass' }, w)).toBe(true);
  });

  it('answers a hasItem condition with a quantity', () => {
    const w = world();
    run(w, [{ kind: 'addItem', item: 'gold', quantity: 10 }]);
    expect(evaluate({ kind: 'hasItem', item: 'gold', quantity: 10 }, w)).toBe(true);
    expect(evaluate({ kind: 'hasItem', item: 'gold', quantity: 11 }, w)).toBe(false);
    // No quantity means one.
    expect(evaluate({ kind: 'hasItem', item: 'gold' }, w)).toBe(true);
  });
});

describe('item effects', () => {
  it('journals what was gained', () => {
    const w = world();
    const journal = run(w, [{ kind: 'addItem', item: 'gold', quantity: 12 }]);
    expect(journal).toContainEqual({ kind: 'item', item: 'gold', change: 12 });
  });

  it('journals what was actually taken, not what was asked for', () => {
    const w = world();
    w.addItem('gold', 2);
    const journal = run(w, [{ kind: 'removeItem', item: 'gold', quantity: 10 }]);
    // Two went, not ten.
    expect(journal).toContainEqual({ kind: 'item', item: 'gold', change: -2 });
  });

  it('defaults to one of a thing', () => {
    const w = world();
    run(w, [{ kind: 'addItem', item: 'lantern' }]);
    expect(w.itemCount('lantern')).toBe(1);
  });

  it('gates a branch on what the party carries', () => {
    const w = world();
    w.addItem('brass', 1);
    const journal = run(w, [
      {
        kind: 'branch',
        when: { kind: 'hasItem', item: 'brass' },
        then: [{ kind: 'log', text: 'The key turns.' }],
        otherwise: [{ kind: 'log', text: 'It stays shut.' }],
      },
    ]);
    expect(journal.some((e) => e.kind === 'log' && e.text === 'The key turns.')).toBe(true);
  });
});

/**
 * Campaign state going to disk and coming back.
 *
 * `SceneState` has always snapshotted; this is the other half, and the half that
 * has to be JSON-safe by hand because a `Set` and a `Map` are not.
 */
describe('snapshotting a scenario', () => {
  const filled = () => {
    const scenario = createScenarioState();
    scenario.variables['mood'] = 'grim';
    scenario.variables['count'] = 3;
    scenario.flags.add('met-the-warden');
    scenario.items.set('gold', 12);
    scenario.items.set('brass-key', 1);
    scenario.actorId = 'kara';
    return scenario;
  };

  it('flattens the Set and the Map into JSON', () => {
    const snapshot = scenarioSnapshot(filled());
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(snapshot.flags).toEqual(['met-the-warden']);
    expect(snapshot.items).toEqual([
      ['gold', 12],
      ['brass-key', 1],
    ]);
    expect(scenarioSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it('round-trips through JSON', () => {
    const original = filled();
    const restored = createScenarioState();
    restoreScenario(restored, JSON.parse(JSON.stringify(scenarioSnapshot(original))));
    expect(restored).toEqual(original);
  });

  it('refills in place, so a world already built keeps reading it', () => {
    // Every `SceneScriptWorld` holds a reference to the scenario; replacing the
    // object would leave the live room writing flags nobody reads.
    const scenario = createScenarioState();
    const w = new SceneScriptWorld(
      new SceneState({ id: 'room' }, new TileGrid({ width: 4, height: 4 })),
      scenario,
    );
    restoreScenario(scenario, scenarioSnapshot(filled()));
    expect(w.hasItem('gold', 12)).toBe(true);
    expect(w.hasFlag('met-the-warden')).toBe(true);
  });

  it('replaces what was there rather than merging into it', () => {
    const scenario = filled();
    restoreScenario(scenario, scenarioSnapshot(createScenarioState()));
    expect(scenario.flags.size).toBe(0);
    expect(scenario.items.size).toBe(0);
    expect(scenario.variables).toEqual({});
    expect(scenario.actorId).toBeNull();
  });

  it('does not alias the snapshot into live state', () => {
    const original = filled();
    const snapshot = scenarioSnapshot(original);
    original.items.set('gold', 99);
    original.flags.add('later');
    expect(snapshot.items).toContainEqual(['gold', 12]);
    expect(snapshot.flags).toEqual(['met-the-warden']);
  });
});
