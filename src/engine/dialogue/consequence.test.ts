/**
 * A consequence node, and a conversation that knows whom it is with.
 *
 * A consequence says nothing: the runner runs its effects and walks on to its `goto`, or ends. And
 * a conversation opened with a creature binds it as the `target` of every script inside, which is
 * how "turn them hostile" in a reply or a consequence means the one being talked to.
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { SceneScriptWorld, createScenarioState } from '../script/world';
import { DialogueRunner } from './dialogue';
import { dialogueSchema } from './schema';

function world(): { world: SceneScriptWorld; state: SceneState } {
  const state = new SceneState({ id: 'pit' }, new TileGrid({ width: 4, height: 4 }));
  state.addEntity(createPartyEntity('kara', 'sentinel', 0));
  state.addEntity(createAdversaryEntity('foe', 'fixture-foe', 5, { hitPoints: 4, stress: 2, faction: 'neutral' }));
  return { world: new SceneScriptWorld(state, createScenarioState({}, 'kara'), {}), state };
}

const TALK = dialogueSchema.parse({
  id: 'talk',
  start: 'ask',
  nodes: [
    { id: 'ask', lines: [{ text: 'Well?' }], choices: [{ text: 'Fight', goto: 'turn' }, { text: 'Leave', goto: 'bye' }] },
    { id: 'turn', kind: 'consequence', onEnter: [{ kind: 'setAttitude', attitude: 'hostile' }, { kind: 'setFlag', flag: 'turned' }], goto: 'after' },
    { id: 'after', lines: [{ text: 'So be it.' }] },
    { id: 'bye', kind: 'consequence', onEnter: [{ kind: 'setFlag', flag: 'left' }] },
  ],
});

describe('a consequence node', () => {
  it('runs its effects on the one talked to and walks on without being shown', () => {
    const { world: w, state } = world();
    const runner = new DialogueRunner(TALK, w, createRng('c'), { targets: ['foe'] });
    runner.start();
    const next = runner.choose(0);
    // Straight past the consequence to what it leads to: its own id is never on screen.
    expect(next.status).toBe('talking');
    expect(next.status === 'talking' ? next.view.node.id : null).toBe('after');
    expect(state.entity('foe')!.faction).toBe('adversary');
    expect(w.hasFlag('turned')).toBe(true);
    expect(next.journal).toContainEqual({ kind: 'attitude', id: 'foe', attitude: 'hostile' });
  });

  it('ends the conversation when it leads nowhere', () => {
    const { world: w } = world();
    const runner = new DialogueRunner(TALK, w, createRng('c'), { targets: ['foe'] });
    runner.start();
    expect(runner.choose(1).status).toBe('ended');
    expect(w.hasFlag('left')).toBe(true);
  });

  it('turns nobody when the conversation was opened with nobody', () => {
    const { world: w, state } = world();
    const runner = new DialogueRunner(TALK, w, createRng('c'));
    runner.start();
    runner.choose(0);
    expect(state.entity('foe')!.faction).toBe('neutral');
  });

  it('never turns a party member', () => {
    const { world: w, state } = world();
    expect(w.setAttitude('kara', 'hostile')).toBe(false);
    expect(state.entity('kara')!.faction).toBe('party');
    // And turning one to the side it is already on changes nothing.
    expect(w.setAttitude('foe', 'friendly')).toBe(false);
  });
});
