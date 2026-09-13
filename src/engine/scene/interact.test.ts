import { describe, it, expect } from 'vitest';
import { createRng, type Rng } from '../core/rng';
import { createScenarioState, SceneScriptWorld } from '../script/world';
import { gridFromScene } from './grid-from-scene';
import { sceneStateFromScene } from './state';
import { interactableSchema, sceneSchema, type Interactable } from './schema';
import { useInteractable } from './interact';

/**
 * The use verb, over the authored document.
 *
 * These matter more than their size suggests: until this existed, every one of
 * the fields exercised here — `requiresKey`, `lockedText`, `check`, `goto` —
 * round-tripped through save and load and did nothing at all.
 */

const object = (overrides: Partial<Interactable> = {}): Interactable =>
  interactableSchema.parse({
    id: 'chest-1',
    kind: 'chest',
    position: { x: 1, y: 1 },
    ...overrides,
  });

function world(objects: Interactable[] = []): SceneScriptWorld {
  const scene = sceneSchema.parse({
    id: 'room',
    name: 'Room',
    width: 4,
    height: 4,
    terrain: Array(16).fill('floor'),
    heights: Array(16).fill(0),
    spawns: [{ x: 0, y: 0 }],
    interactables: objects,
  });
  const { grid } = gridFromScene(scene);
  const { state } = sceneStateFromScene(scene, grid);
  return new SceneScriptWorld(state, createScenarioState(), {
    traits: { finesse: 2, presence: 1 },
  });
}

const rng = (): Rng => createRng(1234);

describe('using an interactable', () => {
  it('runs the authored flavor as narration', () => {
    const chest = object({ flavor: 'It smells of old rain.' });
    const result = useInteractable(chest, world([chest]), rng());
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.journal.some((e) => e.kind === 'log' && e.text.includes('old rain'))).toBe(true);
  });

  it('refuses a locked thing with the authored line, without spending the roll', () => {
    const door = object({
      kind: 'door',
      requiresKey: 'brass',
      lockedText: 'The brass lock will not turn.',
      check: { trait: 'finesse', difficulty: 10, onSuccessWithGood: [{ kind: 'open' }] },
    });
    const result = useInteractable(door, world([door]), rng());
    expect(result).toEqual({
      status: 'refused',
      reason: 'locked',
      text: 'The brass lock will not turn.',
    });
  });

  it('opens once the party holds the key', () => {
    const door = object({ kind: 'door', requiresKey: 'brass', goto: 'the-pit' });
    const w = world([door]);
    w.giveKey('brass');
    const result = useInteractable(door, w, rng());
    expect(result.status).toBe('done');
  });

  it('falls back to its own words when a locked thing has no locked text', () => {
    const door = object({ kind: 'door', requiresKey: 'brass' });
    const result = useInteractable(door, world([door]), rng());
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.text).toBe('It is locked.');
  });

  it('stops for the roll a check needs, rather than resolving it silently', () => {
    const chest = object({
      check: {
        trait: 'finesse',
        difficulty: 12,
        onSuccessWithGood: [{ kind: 'log', text: 'The lid lifts.' }, { kind: 'open' }],
        onFailureWithBad: [{ kind: 'damage', amount: 2 }],
      },
    });
    const result = useInteractable(chest, world([chest]), rng());
    expect(result.status).toBe('waiting');
    if (result.status !== 'waiting') return;
    expect(result.prompt.kind).toBe('check');
  });

  it('carries the check through to its outcome and marks the thing used', () => {
    const chest = object({
      check: {
        trait: 'finesse',
        difficulty: 1, // trivially passed, so the assertion is about wiring not luck
        onSuccessWithGood: [{ kind: 'log', text: 'The lid lifts.' }, { kind: 'open' }],
        onSuccessWithBad: [{ kind: 'log', text: 'The lid lifts.' }, { kind: 'open' }],
      },
    });
    const w = world([chest]);
    const result = useInteractable(chest, w, rng());
    expect(result.status).toBe('waiting');
    if (result.status !== 'waiting') return;

    const finished = result.runner.resume({ kind: 'roll' });
    expect(finished.status).toBe('done');
    expect(w.interactableState('chest-1').used).toBe(true);
    expect(w.interactableState('chest-1').open).toBe(true);
  });

  it('refuses a second use once it has been used', () => {
    const chest = object({ goto: 'the-pit' });
    const w = world([chest]);
    useInteractable(chest, w, rng());
    const again = useInteractable(chest, w, rng());
    expect(again.status).toBe('refused');
    if (again.status !== 'refused') return;
    expect(again.reason).toBe('alreadyUsed');
  });

  it('lets a repeatable thing be used again', () => {
    const lever = object({ kind: 'scripted', goto: 'the-pit' });
    const w = world([lever]);
    useInteractable(lever, w, rng());
    expect(useInteractable(lever, w, rng(), { repeatable: true }).status).toBe('done');
  });

  it('does not consume a thing that only has words on it', () => {
    const plaque = object({ kind: 'scripted', flavor: 'Names, worn smooth.' });
    const w = world([plaque]);
    expect(useInteractable(plaque, w, rng()).status).toBe('done');
    // Reading an inscription should not use it up.
    expect(w.interactableState('chest-1').used).toBe(false);
    expect(useInteractable(plaque, w, rng()).status).toBe('done');
  });

  it('refuses a thing with nothing authored on it at all', () => {
    const rock = object({ kind: 'scripted', name: 'A rock' });
    const result = useInteractable(rock, world([rock]), rng());
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.reason).toBe('nothingToDo');
  });

  it('refuses a thing an effect has removed', () => {
    const chest = object({ goto: 'the-pit' });
    const w = world([chest]);
    w.removeInteractable('chest-1');
    const result = useInteractable(chest, w, rng());
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.reason).toBe('removed');
  });

  it('is replayable: the same seed gives the same outcome', () => {
    const chest = object({
      check: {
        trait: 'finesse',
        difficulty: 14,
        onSuccessWithGood: [{ kind: 'log', text: 'open' }],
        onFailureWithBad: [{ kind: 'log', text: 'stuck' }],
        onFailureWithGood: [{ kind: 'log', text: 'stuck' }],
        onSuccessWithBad: [{ kind: 'log', text: 'open' }],
      },
    });
    const play = (): string => {
      const w = world([chest]);
      const result = useInteractable(chest, w, createRng(99));
      if (result.status !== 'waiting') return result.status;
      const done = result.runner.resume({ kind: 'roll' });
      return JSON.stringify(done.journal);
    };
    expect(play()).toBe(play());
  });
});
