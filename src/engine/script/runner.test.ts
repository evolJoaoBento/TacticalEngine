import { describe, it, expect } from 'vitest';
import { createRng, type Rng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { addVar, log, setFlag, type Effect } from './effects';
import { ScriptRunner, runScript, type ScriptWorld } from './runner';
import { conditionDefSchema } from '../content/conditions';
import { SceneScriptWorld, createScenarioState } from './world';
import { evaluate, NO_BINDINGS } from './conditions';

/**
 * A world that does nothing, for testing what the runner asks of it rather
 * than what a scene does about it. Override the one or two members a test
 * cares about; the rest answer "nothing there".
 */
function stubWorld(overrides: Partial<ScriptWorld> = {}): ScriptWorld {
  const flags = new Set<string>();
  const base: ScriptWorld = {
    hasFlag: (f) => flags.has(f),
    hasKey: () => false,
    hasItem: () => false,
    rollLoot: () => [],
    addItem: () => 1,
    removeItem: () => 1,
    getVar: () => null,
    interactableState: () => ({ used: false, open: false, removed: false }),
    encounterState: () => ({ started: false, ended: false, triggered: false }),
    countAlive: () => 1,
    factionOf: () => 'party' as const,
    questStatus: () => 'inactive',
    objectiveDone: () => false,
    grantLevel: () => null,
    gainHope: () => false,
    gainFear: () => false,
    startQuest: () => false,
    completeObjective: () => false,
    revealObjective: () => false,
    completeQuest: () => false,
    failQuest: () => false,
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
healShared: () => 0,
    checkModifier: () => 0,
    advantageRolling: () => ({ advantage: 0, disadvantage: 0 }),
    advantageAgainst: () => ({ advantage: 0, disadvantage: 0 }),
    liftRoll: () => 0,
    experiences: () => [],
    difficultyOf: () => null,
    hook: () => null,
    actorId: () => null,
    resolveTargets: () => [],
    inCombat: () => false,
    loadoutDomain: () => null,
    hasCondition: () => false,
    poolValue: () => null,
    bandTo: () => null,
    dealDamage: () => ({ incoming: 0, reduced: 0, hpMarked: 0, armorSlotsSpent: 0, fell: false, reactions: [] }),
    markStress: () => ({ stressMarked: 0, hpMarked: 0, fell: false }),
    clearStress: () => 0,
    clearArmor: () => 0,
    gainHopeFor: () => 0,
    spendHope: () => false,
    loseHope: () => 0,
    applyCondition: () => false,
    clearCondition: () => false,
    proficiencyOf: () => 1,
    markArmor: () => 0,
    tokensOn: () => 0,
    addTokens: () => 0,
    spendTokens: () => 0,
    spellcastValue: () => null,
    loseFear: () => false,
    traitValue: () => null,
    weaponDamage: () => null,
    attack: () => ({
      refused: 'nothing to attack',
      weapon: '',
      hit: false,
      critical: false,
      hitPointsMarked: 0,
      hopeGained: 0,
      fearGained: 0,
      stressCleared: 0,
      spotlightToGm: false,
    }),
    pushBack: () => null,
    drawIn: () => null,
    drawTo: () => null,
    blinkTo: () => null,
placeZone: () => {},
endZone: () => false,
refreshZones: () => {},
tileOf: () => -1,
    breakAway: () => null,
    rollReaction: () => ({ success: false, total: 0 }),
    summon: () => ({ ids: [] }),
    startCountdown: () => {},
    spotlightSpent: () => false,
    nearestFirst: (_from: string, ids: readonly string[]) => [...ids],
    replace: () => ({ ids: [] }),
  };
  return { ...base, ...overrides };
}

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
    expect(w.hasFlag('opened')).toBe(true);
    expect(w.hasKey('brass')).toBe(true);
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
    expect(w.hasFlag('lit')).toBe(false);
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
    expect(w.hasFlag('bargained')).toBe(true);
    expect(after.journal.map((e) => (e.kind === 'log' ? e.text : e.kind))).toEqual([
      'chose',
      'flag',
      'Done.',
      'The moment passes.',
    ]);
  });

  it('shows a gated option once its condition holds', () => {
    const { world: w, state } = world();
    w.setFlag('knows-cranks');
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
    // A roll also hands out a Hope or a Fear, journalled right after the check.
    const kinds = after.journal
      .filter((e) => e.kind !== 'hope' && e.kind !== 'fear')
      .map((e) => (e.kind === 'log' ? e.text : e.kind));
    expect(kinds).toEqual(['check', 'A crank!', 'var', 'You step back.']);
    expect(after.journal[1]!.kind === 'hope' || after.journal[1]!.kind === 'fear').toBe(true);
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

  /**
   * The same room, with conditions to stand on somebody: one that speaks of
   * any action roll, one that only ever spoke of a swing.
   */
  const carrying = (worn: string): SceneScriptWorld => {
    const grid = new TileGrid({ width: 5, height: 3 });
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity({ ...createPartyEntity('kara', 'sentinel', 0), hitPoints: { max: 6, marked: 0 } });
    const scenario = createScenarioState({}, 'kara');
    const w = new SceneScriptWorld(state, scenario, {
      traits: { finesse: 2, presence: 1 },
      conditionDefs: [
        conditionDefSchema.parse({
          id: 'sure-of-it',
          name: 'Sure of It',
          text: 'Your next action roll has advantage.',
          modifiers: [{ stat: 'advantage', bonus: 1, anyRoll: true }],
        }),
        conditionDefSchema.parse({
          id: 'swinging-wide',
          name: 'Swinging Wide',
          text: 'Your attacks have disadvantage.',
          modifiers: [{ stat: 'advantage', bonus: -1 }],
        }),
      ],
    });
    w.applyCondition('kara', worn, 'scene');
    return w;
  };

  /** The die a check was rolled with, and nothing else about it. */
  const advantageDie = (w: SceneScriptWorld): number => {
    const runner = new ScriptRunner(w, scriptedRng([5, 4, 6]));
    runner.run(search);
    const entry = runner.resume({ kind: 'roll' }).journal.find((e) => e.kind === 'check');
    if (entry?.kind !== 'check') throw new Error('expected a check entry');
    return entry.roll.advantageDie;
  };

  it('rolls with the advantage the roller was already carrying', () => {
    expect(advantageDie(carrying('sure-of-it'))).toBe(6);
  });

  it('leaves what only a swing reads to the swing', () => {
    // "Disadvantage on attack rolls" is not a word about searching a piano.
    expect(advantageDie(carrying('swinging-wide'))).toBe(0);
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

describe('numbers a script can read', () => {
  it('marks what the blow marked, and nothing at all when it marked nothing', () => {
    const marked: number[] = [];
    const stub = stubWorld({
      resolveTargets: () => ['kara'],
      markStress: (_id, amount) => {
        marked.push(amount);
        return { stressMarked: amount, hpMarked: 0, isFull: false, fell: false };
      },
    });

    const answering = new ScriptRunner(stub, createRng('counts'), { counts: { hitPointsTaken: 3 } });
    answering.run([{ kind: 'markStress', amount: 'hitPointsTaken', target: { kind: 'target' } }]);
    expect(marked).toEqual([3]);

    // A feature run out of nowhere reads zero, and a zero is quiet: nothing
    // marked, nothing journalled, no refusal.
    const cold = new ScriptRunner(stub, createRng('counts'));
    const result = cold.run([{ kind: 'markStress', amount: 'hitPointsTaken', target: { kind: 'target' } }]);
    expect(marked).toEqual([3]);
    expect(result.journal).toEqual([]);
  });

  it('keeps count of what its own damage marked', () => {
    const cleared: number[] = [];
    const stub = stubWorld({
      resolveTargets: (selector) => (selector.kind === 'actor' ? ['husk'] : ['kara', 'finn']),
      dealDamage: () => ({ incoming: 9, reduced: 0, hpMarked: 2, armorSlotsSpent: 0, fell: false, reactions: [] }),
      heal: (_target, amount) => {
        cleared.push(amount);
        return amount;
      },
    });
    const runner = new ScriptRunner(stub, createRng('dealt'));
    runner.run([
      { kind: 'damage', dice: '2d6', target: { kind: 'hit' } },
      { kind: 'heal', amount: 'hitPointsDealt', target: { kind: 'actor' } },
    ]);
    // Two targets, two Hit Points each: the Necromancer drinks back four.
    expect(cleared).toEqual([4]);
  });

  it('counts the creatures the last roll beat', () => {
    let fear = 0;
    const stub = stubWorld({
      resolveTargets: () => ['kara', 'finn', 'husk'],
      rollReaction: (id) => ({ success: id === 'kara', total: 12 }),
      gainFear: () => {
        fear += 1;
        return true;
      },
    });
    const runner = new ScriptRunner(stub, createRng('fear'));
    runner.run([
      {
        kind: 'reactionRoll',
        difficulty: 14,
        trait: 'instinct',
        targets: { kind: 'allies' },
        onFail: [{ kind: 'gainFear', amount: 'targetsHit' }],
      },
    ]);
    // Two failed, so two Fear - not one for each of the three who rolled.
    expect(fear).toBe(2);
  });

  it('carries a blow it was handed rather than one it rolled', () => {
    const dealt: number[] = [];
    const stub = stubWorld({
      resolveTargets: () => ['kara'],
      dealDamage: (_id, damage) => {
        dealt.push(damage.amount);
        return { incoming: damage.amount, reduced: 0, hpMarked: 1, armorSlotsSpent: 0, fell: false, reactions: [] };
      },
    });
    const runner = new ScriptRunner(stub, createRng('reflect'), {
      lastDamage: { total: 11, types: ['magic'] },
    });
    runner.run([{ kind: 'damage', dice: 'same', half: true, target: { kind: 'target' } }]);
    // Half of eleven, rounded up, and still magic.
    expect(dealt).toEqual([6]);
  });

  it('reads a count in a gate the same way an amount does', () => {
    const stub = stubWorld();
    const bindings = { targets: [], hit: [], counts: { hitPointsTaken: 2 } };
    expect(evaluate({ kind: 'count', of: 'hitPointsTaken', op: '>=', value: 2 }, stub, bindings)).toBe(true);
    expect(evaluate({ kind: 'count', of: 'hitPointsTaken', op: '>=', value: 3 }, stub, bindings)).toBe(false);
    // A script nobody handed a number to compares against zero.
    expect(evaluate({ kind: 'count', of: 'hitPointsTaken', op: '>=', value: 1 }, stub, NO_BINDINGS)).toBe(false);
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

  it("carries the attack's damage type over, not just its total", () => {
    // "All other adversaries take half damage" is half of *that* damage: a
    // sword's swing stays physical, so armor and resistances that answer the
    // swing answer the spill too.
    const dealt: { amount: number; types: readonly string[] | undefined }[] = [];
    const stub = stubWorld({
      actorId: () => 'kara',
      resolveTargets: () => ['husk'],
      attack: () => ({
        refused: null,
        weapon: 'broadsword',
        hit: true,
        critical: false,
        hitPointsMarked: 1,
        damage: 9,
        damageDice: '1d8+1',
        damageTypes: ['physical'],
        hopeGained: 0,
        fearGained: 0,
        stressCleared: 0,
        spotlightToGm: false,
      }),
      dealDamage: (_id, request) => {
        dealt.push({ amount: request.amount, types: request.types });
        return { incoming: request.amount, reduced: 0, hpMarked: 1, armorSlotsSpent: 0, fell: false, reactions: [] };
      },
    });

    runScript(
      [{ kind: 'attack', onHit: [{ kind: 'damage', dice: 'same', half: true, target: { kind: 'entities', ids: ['other'] } }] }],
      stub,
      createRng(1),
    );
    expect(dealt).toEqual([{ amount: 5, types: ['physical'] }]);
  });

  it('asks how many, and writes the answer into what it runs', () => {
    // "Spend any number of tokens and roll that many d10s": one option per
    // number, each carrying its own copy of the effects with the number
    // already in them - so nothing downstream has to look it up.
    const stub = stubWorld({ actorId: () => 'mira', resolveTargets: () => ['mira'], tokensOn: () => 3 });
    const runner = new ScriptRunner(stub, createRng(1), { targets: [], hit: [] });
    const waiting = runner.run([
      {
        kind: 'howMany',
        most: { tokens: 'unleash-chaos' },
        title: 'How much?',
        each: [{ kind: 'log', text: 'chaos for {n}' }, { kind: 'gainFear', amount: 'spent' }],
      },
    ]);
    expect(waiting.status).toBe('waiting');
    expect(waiting.status === 'waiting' && waiting.prompt.kind).toBe('choice');
    const options = waiting.status === 'waiting' && waiting.prompt.kind === 'choice' ? waiting.prompt.options : [];
    expect(options.map((o) => o.label)).toEqual(['1', '2', '3']);

    // Taking the third writes three into both halves of it.
    let fear = 0;
    const counting = stubWorld({
      actorId: () => 'mira',
      resolveTargets: () => ['mira'],
      tokensOn: () => 3,
      gainFear: () => {
        fear += 1;
        return true;
      },
    });
    const again = new ScriptRunner(counting, createRng(1), { targets: [], hit: [] });
    again.run([
      {
        kind: 'howMany',
        most: { tokens: 'unleash-chaos' },
        each: [{ kind: 'log', text: 'chaos for {n}' }, { kind: 'gainFear', amount: 'spent' }],
      },
    ]);
    const done = again.resume({ kind: 'choose', index: 2 });
    expect(done.status).toBe('done');
    expect(done.journal.some((e) => e.kind === 'log' && e.text === 'chaos for 3')).toBe(true);
    expect(fear).toBe(3);
  });

  it('refuses to ask when there is none of it', () => {
    const stub = stubWorld({ actorId: () => 'mira', resolveTargets: () => ['mira'], tokensOn: () => 0 });
    const journal = runScript(
      [{ kind: 'howMany', most: { tokens: 'unleash-chaos' }, each: [{ kind: 'gainFear', amount: 'spent' }] }],
      stub,
      createRng(1),
    );
    expect(journal).toContainEqual({ kind: 'refused', reason: 'there is none of it to spend' });
  });

  it('reads an amount off a pool, and off nobody as a quiet zero', () => {
    // "A bonus to the damage roll equal to the Demon's current number of
    // marked HP": the actor's own pool when nothing says otherwise.
    const asked: [string, string, string][] = [];
    const stub = stubWorld({
      actorId: () => 'demon',
      resolveTargets: (selector) => (selector.kind === 'actor' ? ['demon'] : []),
      poolValue: (id, pool, measure) => {
        asked.push([id, pool, measure]);
        return 3;
      },
    });
    const journal = runScript(
      [{ kind: 'boostDamage', amount: { pool: 'hitPoints', measure: 'marked' } }],
      stub,
      createRng(1),
    );
    expect(journal).toContainEqual({ kind: 'damageBoosted', id: 'demon', by: 3 });
    expect(asked).toEqual([['demon', 'hitPoints', 'marked']]);

    // Nobody to read it off is nothing added, not a refusal.
    const nobody = runScript(
      [{ kind: 'boostDamage', amount: { pool: 'hitPoints', of: { kind: 'target' } } }],
      stub,
      createRng(1),
    );
    expect(nobody.some((e) => e.kind === 'damageBoosted')).toBe(false);
    expect(nobody.some((e) => e.kind === 'refused')).toBe(false);
  });

  it('rolls a die for each of the ones on the card', () => {
    // "Roll the dice on this card and add the total to your damage roll": the
    // count is what the fight put there, and none of them is nothing added.
    const stub = stubWorld({ actorId: () => 'mira', resolveTargets: () => ['mira'], tokensOn: () => 4 });
    const journal = runScript(
      [{ kind: 'boostDamage', dice: 'd8', times: { tokens: 'sigil-of-retribution' } }],
      stub,
      createRng(1),
    );
    const boosted = journal.find((e) => e.kind === 'damageBoosted');
    expect(boosted?.kind === 'damageBoosted' ? boosted.by : 0).toBeGreaterThanOrEqual(4);
    expect(boosted?.kind === 'damageBoosted' ? boosted.by : 0).toBeLessThanOrEqual(32);

    // An empty card adds nothing, and does not refuse.
    const empty = stubWorld({ actorId: () => 'mira', resolveTargets: () => ['mira'], tokensOn: () => 0 });
    const nothing = runScript(
      [{ kind: 'boostDamage', dice: 'd8', times: { tokens: 'sigil-of-retribution' } }],
      empty,
      createRng(1),
    );
    expect(nothing.some((e) => e.kind === 'damageBoosted')).toBe(false);
    expect(nothing.some((e) => e.kind === 'refused')).toBe(false);
  });

  it('forces the Hit Points a blow marks, read off a pool', () => {
    // "Force the target to mark a number of Hit Points equal to the number of
    // Hit Points you currently have marked": journalled for the swing to obey.
    const stub = stubWorld({
      actorId: () => 'kara',
      resolveTargets: (selector) => (selector.kind === 'actor' ? ['kara'] : []),
      poolValue: () => 3,
    });
    const journal = runScript(
      [{ kind: 'forceHitPoints', amount: { pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked' } }],
      stub,
      createRng(1),
    );
    expect(journal).toContainEqual({ kind: 'hitPointsForced', id: 'kara', to: 3 });

    // Nothing marked is nothing forced: a zero would be a blow that does
    // nothing, which is not what the card meant.
    const clean = stubWorld({
      actorId: () => 'kara',
      resolveTargets: (selector) => (selector.kind === 'actor' ? ['kara'] : []),
      poolValue: () => 0,
    });
    const none = runScript(
      [{ kind: 'forceHitPoints', amount: { pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked' } }],
      clean,
      createRng(1),
    );
    expect(none.some((e) => e.kind === 'hitPointsForced')).toBe(false);
  });

  it('reads an amount off a trait, times over, and off a stat block as nothing', () => {
    // "A bonus to your damage roll equal to twice your Strength."
    const asked: [string, string][] = [];
    const stub = stubWorld({
      actorId: () => 'kara',
      resolveTargets: (selector) => (selector.kind === 'actor' ? ['kara'] : []),
      traitValue: (id, trait) => {
        asked.push([id, trait]);
        return 2;
      },
    });
    const journal = runScript(
      [{ kind: 'boostDamage', amount: { trait: 'strength', times: 2 } }],
      stub,
      createRng(1),
    );
    expect(journal).toContainEqual({ kind: 'damageBoosted', id: 'kara', by: 4 });
    expect(asked).toEqual([['kara', 'strength']]);

    // A creature with no sheet has no traits: nothing added, and no refusal.
    const block = stubWorld({ actorId: () => 'husk', resolveTargets: () => ['husk'], traitValue: () => null });
    const nothing = runScript([{ kind: 'boostDamage', amount: { trait: 'strength' } }], block, createRng(1));
    expect(nothing.some((e) => e.kind === 'damageBoosted')).toBe(false);
    expect(nothing.some((e) => e.kind === 'refused')).toBe(false);
  });

  it('rolls a handful of dice and takes the branch one of them earned', () => {
    // "Roll a number of d6s equal to your Proficiency. If any roll a 6."
    const stub = stubWorld({ actorId: () => 'kara', resolveTargets: () => ['kara'], traitValue: () => 3 });
    const lucky = runScript(
      [
        {
          kind: 'diceCheck',
          dice: '1d6',
          times: { trait: 'proficiency' },
          atLeast: 6,
          then: [log('caught it')],
          otherwise: [log('missed it')],
        },
      ],
      stub,
      scriptedRng([2, 6, 3]),
    );
    expect(lucky).toContainEqual({ kind: 'diceChecked', id: 'kara', dice: '1d6', results: [2, 6, 3], passed: true });
    expect(lucky.some((e) => e.kind === 'log' && e.text === 'caught it')).toBe(true);

    const flat = runScript(
      [
        {
          kind: 'diceCheck',
          dice: '1d6',
          times: { trait: 'proficiency' },
          atLeast: 6,
          then: [log('caught it')],
          otherwise: [log('missed it')],
        },
      ],
      stub,
      scriptedRng([1, 2, 5]),
    );
    expect(flat.some((e) => e.kind === 'log' && e.text === 'missed it')).toBe(true);

    // No dice at all is not a failed roll: nothing is rolled and nothing is
    // said about it, though what would have happened otherwise still does.
    const none = stubWorld({ actorId: () => 'kara', resolveTargets: () => ['kara'], traitValue: () => 0 });
    const empty = runScript(
      [
        {
          kind: 'diceCheck',
          dice: '1d6',
          times: { trait: 'proficiency' },
          atLeast: 6,
          then: [log('caught it')],
          otherwise: [log('missed it')],
        },
      ],
      none,
      scriptedRng([]),
    );
    expect(empty.some((e) => e.kind === 'diceChecked')).toBe(false);
    expect(empty.some((e) => e.kind === 'log' && e.text === 'missed it')).toBe(true);
  });

  it('names the band a blow lands in', () => {
    const stub = stubWorld({ actorId: () => 'assassin' });
    const journal = runScript([{ kind: 'forceSeverity', severity: 'severe' }], stub, createRng(1));
    expect(journal).toContainEqual({ kind: 'severityForced', id: 'assassin', severity: 'severe' });
  });

  it('says the spotlight is over without stopping the script', () => {
    // `endSpotlight` is a note to the turn, not a bail: the effects after it
    // still run, and it names the creature whose turn it was.
    const stub = stubWorld({ actorId: () => 'ooze' });
    const journal = runScript([{ kind: 'endSpotlight' }, log('and still speaks')], stub, createRng(1));
    expect(journal).toContainEqual({ kind: 'spotlightEnded', id: 'ooze' });
    expect(journal.some((e) => e.kind === 'log' && e.text === 'and still speaks')).toBe(true);
  });

  it('works against a stub world, not just a scene', () => {
    // The runner talks to an interface, which is what lets a replay drive it.
    const seen = new Set<string>();
    const stub = stubWorld({ setFlag: (f) => void seen.add(f) });
    runScript([setFlag('worked')], stub, createRng(1));
    expect(seen.has('worked')).toBe(true);
  });
});
