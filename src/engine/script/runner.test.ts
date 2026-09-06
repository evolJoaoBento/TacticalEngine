import { describe, it, expect } from 'vitest';
import { createRng, type Rng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { addVar, log, setFlag, type Effect } from './effects';
import { ScriptRunner, runScript, type ScriptWorld } from './runner';
import { SceneScriptWorld, createScenarioState } from './world';

/** Faces scripted in order, so an outcome can be pinned. */
function scriptedRng(faces: number[]): Rng {
  let i = 0;
  const take = (): number => {
    if (i >= faces.length) throw new Error('scriptedRng exhausted');
    return faces[i++]!;
  };
  const rng: Rng = {
    next: () => take() / 100,
    nextInt: () => take(),
    die: () => take(),
    dice: (count) => Array.from({ length: count }, take),
    pick: (items) => items[0]!,
    shuffle: (items) => items,
    fork: () => rng,
    save: () => i,
    restore: (s) => {
      i = s;
    },
  };
  return rng;
}

function world(): { world: SceneScriptWorld; state: SceneState } {
  const grid = new TileGrid({ width: 5, height: 3 });
  const state = new SceneState({ id: 'room' }, grid);
  state.addEntity({ ...createPartyEntity('kara', 'sentinel', 0), hitPoints: { max: 6, marked: 0 } });
  state.addEntity({ ...createPartyEntity('finn', 'nightwalker', 1), hitPoints: { max: 6, marked: 0 } });
  state.addEntity(createAdversaryEntity('husk', 'husk', 4, { hitPoints: 5, stress: 3 }));
  state.placeInteractable('chest', 2);
  const scenario = createScenarioState({}, 'kara');
  return {
    world: new SceneScriptWorld(state, scenario, { traits: { finesse: 2, presence: 1 } }),
    state,
  };
}

describe('plain effects', () => {
  it('runs a list in order and journals what it did', () => {
    const { world: w, state } = world();
    const journal = runScript(
      [log('The lock clicks.', 'success'), setFlag('opened'), { kind: 'giveKey', key: 'brass' }],
      w,
      createRng(1),
    );
    expect(journal.map((e) => e.kind)).toEqual(['log', 'flag', 'key']);
    expect(state.hasFlag('opened')).toBe(true);
    expect(state.hasKey('brass')).toBe(true);
  });

  it('sets and adds variables, treating an unset one as zero', () => {
    const { world: w } = world();
    runScript([addVar('cranks', 1), addVar('cranks', 2), { kind: 'setVar', name: 'mood', value: 'vengeful' }], w, createRng(1));
    expect(w.getVar('cranks')).toBe(3);
    expect(w.getVar('mood')).toBe('vengeful');
  });

  it('clears a flag', () => {
    const { world: w, state } = world();
    runScript([setFlag('lit'), { kind: 'clearFlag', flag: 'lit' }], w, createRng(1));
    expect(state.hasFlag('lit')).toBe(false);
  });

  it('opens, uses and removes an interactable, freeing its tile', () => {
    const { world: w, state } = world();
    state.setInteractableBlocking(2, true);
    runScript(
      [
        { kind: 'open', interactable: 'chest' },
        { kind: 'markUsed', interactable: 'chest' },
      ],
      w,
      createRng(1),
    );
    expect(state.interactable('chest').open).toBe(true);
    expect(state.interactable('chest').used).toBe(true);
    expect(state.blockedFor('kara')(2)).toBe(true);

    runScript([{ kind: 'remove', interactable: 'chest' }], w, createRng(1));
    expect(state.interactable('chest').removed).toBe(true);
    expect(state.blockedFor('kara')(2)).toBe(false);
  });

  it('starts and ends an encounter', () => {
    const { world: w, state } = world();
    runScript([{ kind: 'startEncounter', encounter: 'group-1', intro: 'They rise.' }], w, createRng(1));
    expect(state.encounter('group-1')).toMatchObject({ started: true, triggered: true });
    runScript([{ kind: 'endEncounter', encounter: 'group-1' }], w, createRng(1));
    expect(state.encounter('group-1').ended).toBe(true);
  });

  it('damages and heals, reporting what actually landed', () => {
    const { world: w, state } = world();
    const journal = runScript(
      [{ kind: 'damage', amount: 2, target: { kind: 'entity', id: 'husk' }, source: 'Trap' }],
      w,
      createRng(1),
    );
    expect(journal[0]).toMatchObject({ kind: 'damage', amount: 2, marked: 2, source: 'Trap' });
    expect(state.entity('husk')!.hitPoints.marked).toBe(2);

    const healed = runScript(
      [{ kind: 'heal', amount: 5, target: { kind: 'entity', id: 'husk' } }],
      w,
      createRng(1),
    );
    // Only two were marked, so only two clear.
    expect(healed[0]).toMatchObject({ kind: 'heal', cleared: 2 });
  });

  it('damages the whole party when told to', () => {
    const { world: w, state } = world();
    runScript([{ kind: 'damage', amount: 1, target: { kind: 'party' } }], w, createRng(1));
    expect(state.entity('kara')!.hitPoints.marked).toBe(1);
    expect(state.entity('finn')!.hitPoints.marked).toBe(1);
    expect(state.entity('husk')!.hitPoints.marked).toBe(0);
  });

  it('defaults a target to the acting character', () => {
    const { world: w, state } = world();
    runScript([{ kind: 'damage', amount: 1 }], w, createRng(1));
    expect(state.entity('kara')!.hitPoints.marked).toBe(1);
    expect(state.entity('finn')!.hitPoints.marked).toBe(0);
  });

  it('fells a target that marks its last Hit Point', () => {
    const { world: w, state } = world();
    runScript([{ kind: 'damage', amount: 9, target: { kind: 'entity', id: 'husk' } }], w, createRng(1));
    expect(state.entity('husk')!.alive).toBe(false);
  });
});

describe('branch', () => {
  it('takes the branch its condition selects', () => {
    const { world: w } = world();
    const script: Effect[] = [
      setFlag('met'),
      {
        kind: 'branch',
        when: { kind: 'flag', flag: 'met' },
        then: [log('You have met before.')],
        otherwise: [log('A stranger.')],
      },
    ];
    const journal = runScript(script, w, createRng(1));
    expect(journal.filter((e) => e.kind === 'log')).toEqual([
      { kind: 'log', text: 'You have met before.', tone: 'narration' },
    ]);
  });

  it('does nothing when the false branch is omitted', () => {
    const { world: w } = world();
    const journal = runScript(
      [{ kind: 'branch', when: { kind: 'never' }, then: [log('unreachable')] }],
      w,
      createRng(1),
    );
    expect(journal).toEqual([]);
  });

  it('runs a nested branch in the right order', () => {
    const { world: w } = world();
    const journal = runScript(
      [
        log('one'),
        {
          kind: 'branch',
          when: { kind: 'always' },
          then: [log('two'), { kind: 'branch', when: { kind: 'always' }, then: [log('three')] }],
        },
        log('four'),
      ],
      w,
      createRng(1),
    );
    expect(journal.map((e) => (e.kind === 'log' ? e.text : ''))).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);
  });
});

describe('choice', () => {
  const bargain: Effect[] = [
    {
      kind: 'choice',
      title: 'The Hag leans close.',
      body: 'What will you give?',
      options: [
        { label: 'Take the bargain.', effects: [setFlag('bargained'), log('Done.')] },
        { label: 'Kill her.', detail: 'A fight.', effects: [setFlag('vengeful')] },
        {
          label: 'Ask about the cranks.',
          available: { kind: 'flag', flag: 'knows-cranks' },
          effects: [log('She tells you.')],
        },
      ],
    },
    log('The moment passes.'),
  ];

  it('stops and offers only the options whose condition passes', () => {
    const { world: w } = world();
    const runner = new ScriptRunner(w, createRng(1));
    const result = runner.run(bargain);
    expect(result.status).toBe('waiting');
    if (result.status !== 'waiting' || result.prompt.kind !== 'choice') throw new Error('expected a choice');
    expect(result.prompt.title).toBe('The Hag leans close.');
    expect(result.prompt.options.map((o) => o.label)).toEqual(['Take the bargain.', 'Kill her.']);
    // The indices are the original ones, so a gated option cannot be picked by
    // an off-by-one after filtering.
    expect(result.prompt.options.map((o) => o.index)).toEqual([0, 1]);
  });

  it('runs the chosen branch, then continues the outer script', () => {
    const { world: w, state } = world();
    const runner = new ScriptRunner(w, createRng(1));
    runner.run(bargain);
    const after = runner.resume({ kind: 'choose', index: 0 });

    expect(after.status).toBe('done');
    expect(state.hasFlag('bargained')).toBe(true);
    expect(after.journal.map((e) => (e.kind === 'log' ? e.text : e.kind))).toEqual([
      'chose',
      'flag',
      'Done.',
      'The moment passes.',
    ]);
  });

  it('shows a gated option once its condition holds', () => {
    const { world: w, state } = world();
    state.setFlag('knows-cranks');
    const runner = new ScriptRunner(w, createRng(1));
    const result = runner.run(bargain);
    if (result.status !== 'waiting' || result.prompt.kind !== 'choice') throw new Error('expected a choice');
    expect(result.prompt.options).toHaveLength(3);
  });

  it('refuses a gated option even if a caller asks for it by index', () => {
    const { world: w } = world();
    const runner = new ScriptRunner(w, createRng(1));
    runner.run(bargain);
    const after = runner.resume({ kind: 'choose', index: 2 });
    expect(after.journal.some((e) => e.kind === 'chose')).toBe(false);
    expect(after.status).toBe('done');
  });

  it('skips a choice with nothing available rather than dead-ending', () => {
    const { world: w } = world();
    const journal = runScript(
      [
        { kind: 'choice', options: [{ label: 'nope', available: { kind: 'never' }, effects: [] }] },
        log('carried on'),
      ],
      w,
      createRng(1),
    );
    expect(journal.map((e) => (e.kind === 'log' ? e.text : e.kind))).toEqual(['carried on']);
  });
});

describe('check', () => {
  const search: Effect[] = [
    {
      kind: 'check',
      check: {
        trait: 'finesse',
        difficulty: 13,
        prompt: 'Search the piano strings.',
        onSuccessWithHope: [log('A crank!', 'success'), addVar('cranks', 1)],
        onFailureWithFear: [log('Something stirs.', 'fear')],
        always: [log('You step back.')],
      },
    },
  ];

  it('stops with the trait, difficulty and the modifier already applied', () => {
    const { world: w } = world();
    const runner = new ScriptRunner(w, scriptedRng([]));
    const result = runner.run(search);
    if (result.status !== 'waiting' || result.prompt.kind !== 'check') throw new Error('expected a check');
    expect(result.prompt).toMatchObject({ trait: 'finesse', difficulty: 13, modifier: 2 });
    expect(result.prompt.prompt).toBe('Search the piano strings.');
  });

  it('rolls, dispatches on the outcome, then runs `always`', () => {
    const { world: w } = world();
    // Hope 9, Fear 4 -> 13 + 2 = 15, a success with Hope.
    const runner = new ScriptRunner(w, scriptedRng([9, 4]));
    runner.run(search);
    const after = runner.resume({ kind: 'roll' });

    expect(after.status).toBe('done');
    const kinds = after.journal.map((e) => (e.kind === 'log' ? e.text : e.kind));
    expect(kinds).toEqual(['check', 'A crank!', 'var', 'You step back.']);
    expect(w.getVar('cranks')).toBe(1);
  });

  it('takes the failure branch when the roll falls short', () => {
    const { world: w } = world();
    const runner = new ScriptRunner(w, scriptedRng([2, 5]));
    runner.run(search);
    const after = runner.resume({ kind: 'roll' });
    const texts = after.journal.filter((e) => e.kind === 'log').map((e) => e.text);
    expect(texts).toEqual(['Something stirs.', 'You step back.']);
    expect(w.getVar('cranks')).toBe(null);
  });

  it('falls back between outcomes so content need not write all five', () => {
    const { world: w } = world();
    // 7/7 is a critical success; only onSuccessWithHope is written.
    const runner = new ScriptRunner(w, scriptedRng([7, 7]));
    runner.run(search);
    const after = runner.resume({ kind: 'roll' });
    expect(after.journal.some((e) => e.kind === 'log' && e.text === 'A crank!')).toBe(true);
  });

  it('costs nothing when the player declines the roll', () => {
    const { world: w } = world();
    const runner = new ScriptRunner(w, scriptedRng([]));
    runner.run(search);
    const after = runner.resume({ kind: 'cancel' });
    expect(after.status).toBe('done');
    expect(after.journal).toEqual([]);
    expect(w.getVar('cranks')).toBe(null);
  });

  it('applies advantage the table grants', () => {
    const { world: w } = world();
    const runner = new ScriptRunner(w, scriptedRng([5, 4, 6]));
    runner.run(search);
    const after = runner.resume({ kind: 'roll', advantage: 1 });
    const check = after.journal.find((e) => e.kind === 'check');
    expect(check).toBeDefined();
    if (check?.kind !== 'check') throw new Error('expected a check entry');
    expect(check.roll.advantageDie).toBe(6);
    expect(check.roll.total).toBe(17);
  });
});

describe('the runner as a whole', () => {
  it('replays identically from the same seed and answers', () => {
    const run = (): string => {
      const { world: w } = world();
      const runner = new ScriptRunner(w, createRng('script'));
      runner.run([
        { kind: 'check', check: { trait: 'presence', difficulty: 12, onSuccessWithHope: [log('yes')], onFailureWithFear: [log('no')] } },
      ]);
      const done = runner.resume({ kind: 'roll' });
      return JSON.stringify(done.journal);
    };
    expect(run()).toBe(run());
  });

  it('refuses to resume when nothing is waiting', () => {
    const { world: w } = world();
    const runner = new ScriptRunner(w, createRng(1));
    expect(() => runner.resume({ kind: 'cancel' })).toThrow(/not waiting/);
  });

  it('runScript refuses a script that needs an answer', () => {
    const { world: w } = world();
    expect(() =>
      runScript([{ kind: 'choice', options: [{ label: 'a', effects: [] }] }], w, createRng(1)),
    ).toThrow(/needs a choice/);
  });

  it('journals a goto rather than acting on it itself', () => {
    // Scene changes belong to the layer above; the runner only reports that
    // content asked for one.
    const { world: w } = world();
    const journal = runScript([{ kind: 'goto', scene: 'the-pit' }], w, createRng(1));
    expect(journal).toEqual([{ kind: 'goto', scene: 'the-pit' }]);
  });

  it('stops on a dialogue and waits to be told it finished', () => {
    const { world: w } = world();
    const runner = new ScriptRunner(w, createRng(1));
    const waiting = runner.run([
      { kind: 'log', text: 'before' },
      { kind: 'startDialogue', dialogue: 'hag' },
      { kind: 'log', text: 'after' },
    ]);

    // A conversation is not something a script runs past: everything after it
    // waits, or the ordering of the two would be undefined.
    expect(waiting.status).toBe('waiting');
    if (waiting.status !== 'waiting') return;
    expect(waiting.prompt).toEqual({ kind: 'dialogue', dialogue: 'hag' });
    expect(waiting.journal.some((e) => e.kind === 'log' && e.text === 'after')).toBe(false);

    const done = runner.resume({ kind: 'continue' });
    expect(done.status).toBe('done');
    expect(done.journal.some((e) => e.kind === 'log' && e.text === 'after')).toBe(true);
  });

  it('works against a stub world, not just a scene', () => {
    // The runner talks to an interface, which is what lets a replay drive it.
    const flags = new Set<string>();
    const stub: ScriptWorld = {
      hasFlag: (f) => flags.has(f),
      hasKey: () => false,
      getVar: () => null,
      interactableState: () => ({ used: false, open: false, removed: false }),
      encounterState: () => ({ started: false, ended: false, triggered: false }),
      countAlive: () => 1,
      setFlag: (f) => void flags.add(f),
      clearFlag: (f) => void flags.delete(f),
      giveKey: () => {},
      setVar: () => {},
      openInteractable: () => {},
      removeInteractable: () => {},
      markInteractableUsed: () => {},
      startEncounter: () => {},
      endEncounter: () => {},
      damage: () => 0,
      heal: () => 0,
      traitModifier: () => 0,
    };
    runScript([setFlag('worked')], stub, createRng(1));
    expect(flags.has('worked')).toBe(true);
  });
});
