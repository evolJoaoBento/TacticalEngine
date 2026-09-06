import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import { createRng } from '../core/rng';
import { SceneState } from '../scene/state';
import { questSchema } from '../content/quests';
import { evaluate } from './conditions';
import { runScript, type JournalEntry } from './runner';
import {
  SceneScriptWorld,
  createScenarioState,
  restoreScenario,
  scenarioSnapshot,
  scenarioSnapshotSchema,
} from './world';

/**
 * Quests, as the scripts drive them.
 *
 * The rules are few and each one is a decision: starting is idempotent,
 * ticking a step starts the quest, finishing is explicit and terminal. A test
 * per rule, because every one of them is a thing a designer will lean on.
 */

function world(): SceneScriptWorld {
  const state = new SceneState({ id: 'room' }, new TileGrid({ width: 4, height: 4 }));
  return new SceneScriptWorld(state, createScenarioState());
}

const run = (w: SceneScriptWorld, effects: Parameters<typeof runScript>[0]): JournalEntry[] =>
  [...runScript(effects, w, createRng(7))];

const questEvents = (journal: readonly JournalEntry[]) =>
  journal.filter((e) => e.kind === 'quest' || e.kind === 'objective');

describe('the quest schema', () => {
  it('parses a quest with steps', () => {
    const quest = questSchema.parse({
      id: 'find-the-word',
      name: 'Find the word',
      objectives: [{ id: 'ask', text: 'Ask the Warden.' }],
    });
    expect(quest.summary).toBe('');
    expect(quest.objectives).toHaveLength(1);
  });

  it('refuses a quest with nothing to do', () => {
    expect(() => questSchema.parse({ id: 'empty', name: 'Empty', objectives: [] })).toThrow();
  });

  it('refuses two objectives with the same id', () => {
    expect(() =>
      questSchema.parse({
        id: 'twice',
        name: 'Twice',
        objectives: [
          { id: 'a', text: 'One.' },
          { id: 'a', text: 'Two.' },
        ],
      }),
    ).toThrow(/duplicate objective/);
  });
});

describe('starting and finishing', () => {
  it('starts a quest once, and journals it once', () => {
    const w = world();
    const journal = run(w, [
      { kind: 'startQuest', quest: 'q' },
      { kind: 'startQuest', quest: 'q' },
    ]);
    expect(w.questStatus('q')).toBe('active');
    expect(questEvents(journal)).toEqual([{ kind: 'quest', quest: 'q', change: 'started' }]);
  });

  it('reads as inactive until something starts it', () => {
    expect(world().questStatus('q')).toBe('inactive');
  });

  it('starts a quest when a step is ticked before anything started it', () => {
    // "The party found the thing" is one effect, not two.
    const w = world();
    const journal = run(w, [{ kind: 'completeObjective', quest: 'q', objective: 'find' }]);
    expect(w.questStatus('q')).toBe('active');
    expect(w.objectiveDone('q', 'find')).toBe(true);
    expect(questEvents(journal)).toEqual([
      { kind: 'quest', quest: 'q', change: 'started' },
      { kind: 'objective', quest: 'q', objective: 'find' },
    ]);
  });

  it('ticks a step once', () => {
    const w = world();
    const journal = run(w, [
      { kind: 'completeObjective', quest: 'q', objective: 'find' },
      { kind: 'completeObjective', quest: 'q', objective: 'find' },
    ]);
    expect(journal.filter((e) => e.kind === 'objective')).toHaveLength(1);
  });

  it('does not complete a quest just because every step is done', () => {
    // Finishing is a beat the designer places: "you have everything, now bring
    // it back" is the whole second half of most quests.
    const w = world();
    run(w, [{ kind: 'completeObjective', quest: 'q', objective: 'only' }]);
    expect(w.questStatus('q')).toBe('active');
  });

  it('completes an active quest, and journals it', () => {
    const w = world();
    const journal = run(w, [
      { kind: 'startQuest', quest: 'q' },
      { kind: 'completeQuest', quest: 'q' },
    ]);
    expect(w.questStatus('q')).toBe('completed');
    expect(questEvents(journal).at(-1)).toEqual({ kind: 'quest', quest: 'q', change: 'completed' });
  });

  it('will not complete a quest nothing started', () => {
    const w = world();
    const journal = run(w, [{ kind: 'completeQuest', quest: 'q' }]);
    expect(w.questStatus('q')).toBe('inactive');
    expect(questEvents(journal)).toEqual([]);
  });

  it('treats completed and failed as the end of the road', () => {
    const w = world();
    run(w, [
      { kind: 'startQuest', quest: 'done' },
      { kind: 'completeQuest', quest: 'done' },
      { kind: 'startQuest', quest: 'lost' },
      { kind: 'failQuest', quest: 'lost' },
    ]);
    const journal = run(w, [
      { kind: 'failQuest', quest: 'done' },
      { kind: 'completeQuest', quest: 'lost' },
      { kind: 'startQuest', quest: 'done' },
      { kind: 'completeObjective', quest: 'done', objective: 'late' },
    ]);
    expect(w.questStatus('done')).toBe('completed');
    expect(w.questStatus('lost')).toBe('failed');
    expect(w.objectiveDone('done', 'late')).toBe(false);
    expect(questEvents(journal)).toEqual([]);
  });
});

describe('asking about quests', () => {
  it('gates on status', () => {
    const w = world();
    expect(evaluate({ kind: 'quest', quest: 'q', status: 'inactive' }, w)).toBe(true);
    run(w, [{ kind: 'startQuest', quest: 'q' }]);
    expect(evaluate({ kind: 'quest', quest: 'q', status: 'inactive' }, w)).toBe(false);
    expect(evaluate({ kind: 'quest', quest: 'q', status: 'active' }, w)).toBe(true);
    run(w, [{ kind: 'completeQuest', quest: 'q' }]);
    expect(evaluate({ kind: 'quest', quest: 'q', status: 'completed' }, w)).toBe(true);
  });

  it('gates on a step', () => {
    const w = world();
    const step = { kind: 'objectiveDone', quest: 'q', objective: 'find' } as const;
    expect(evaluate(step, w)).toBe(false);
    run(w, [{ kind: 'completeObjective', quest: 'q', objective: 'find' }]);
    expect(evaluate(step, w)).toBe(true);
  });

  it('branches a script on quest progress', () => {
    const w = world();
    run(w, [{ kind: 'completeObjective', quest: 'q', objective: 'find' }]);
    const journal = run(w, [
      {
        kind: 'branch',
        when: { kind: 'objectiveDone', quest: 'q', objective: 'find' },
        then: [{ kind: 'log', text: 'You have it.' }],
        otherwise: [{ kind: 'log', text: 'Not yet.' }],
      },
    ]);
    expect(journal.some((e) => e.kind === 'log' && e.text === 'You have it.')).toBe(true);
  });
});

describe('quests in a snapshot', () => {
  it('round-trips progress through JSON', () => {
    const w = world();
    run(w, [
      { kind: 'completeObjective', quest: 'q', objective: 'find' },
      { kind: 'startQuest', quest: 'r' },
      { kind: 'failQuest', quest: 'r' },
    ]);
    const snapshot = JSON.parse(JSON.stringify(scenarioSnapshot(w.scenario)));
    const restored = createScenarioState();
    restoreScenario(restored, scenarioSnapshotSchema.parse(snapshot));
    expect(restored.quests.get('q')).toEqual({ status: 'active', done: new Set(['find']) });
    expect(restored.quests.get('r')).toEqual({ status: 'failed', done: new Set() });
  });

  it('still loads a snapshot written before quests existed', () => {
    // A save format is a promise to every file already on disk.
    const old = { variables: {}, flags: ['seen'], items: [['gold', 3]], actorId: null };
    const parsed = scenarioSnapshotSchema.parse(old);
    expect(parsed.quests).toEqual([]);
    const restored = createScenarioState();
    restoreScenario(restored, parsed);
    expect(restored.flags.has('seen')).toBe(true);
    expect(restored.quests.size).toBe(0);
  });
});
