/**
 * What each prop function plays as.
 *
 * A function is stored as the author chose it and turned into an object here. The tests are about
 * the choices that are easy to get wrong: a Trapped prop guarding a door is itself a door, an
 * unset success does nothing rather than something, a portal pair is two and never three, and the
 * parts are ordinary effects that any script could run.
 */

import { describe, it, expect } from 'vitest';
import {
  FUNCTION_KINDS,
  PROP_FUNCTIONS,
  containerItems,
  interactablesOf,
  objectOfProp,
  pairTaken,
  parts,
  portalPartner,
  stepsOf,
  type UsableProp,
} from './prop-functions';
import { propFunctionSchema, type PropFunction } from './prop-function-schema';
import { effectSchema } from '../script/schema';
import { sceneSchema, type SceneDoc } from './schema';
import { blankScene } from './grid-from-scene';

const prop = (id: string, fn: PropFunction, at = { x: 1, y: 1 }, extra: Partial<UsableProp> = {}): UsableProp =>
  ({ id, model: 'crate', position: at, rotation: 0, function: fn, ...extra });

describe('the parts', () => {
  it('are ordinary effects, which any script can run', () => {
    for (const effect of [parts.open('a'), parts.close('a'), parts.toggle('a'), parts.showContents('a'), parts.teleport('p'), parts.usedUp('a'), parts.check('agility', 12, [], [])]) {
      expect(effectSchema.safeParse(effect).success, JSON.stringify(effect)).toBe(true);
    }
  });
});

describe('what each function plays as', () => {
  it('offers every function it knows, with a fresh one of each that the document accepts', () => {
    expect(FUNCTION_KINDS).toEqual(['container', 'door', 'trapped', 'portal', 'script']);
    for (const kind of FUNCTION_KINDS) expect(propFunctionSchema.safeParse(PROP_FUNCTIONS[kind].fresh()).success, kind).toBe(true);
  });

  it('makes a door that is in the way until it is used, and used again to shut', () => {
    const door = objectOfProp(prop('d', { kind: 'door' }));
    expect(door).toMatchObject({ kind: 'door', blocksMovement: true, repeatable: true, toggles: true, effects: [parts.toggle('d')] });
    expect(door.model).toBeNull();
  });

  it('makes a container that shows what it holds, and stands in the way only if the prop is solid', () => {
    const fn: PropFunction = { kind: 'container', items: [{ item: 'rope', count: 2 }] };
    expect(objectOfProp(prop('c', fn))).toMatchObject({ blocksMovement: false, effects: [parts.showContents('c')] });
    expect(objectOfProp(prop('c', fn, undefined, { solid: true })).blocksMovement).toBe(true);
    expect(containerItems(fn)).toEqual([{ item: 'rope', count: 2 }]);
  });

  it('makes a trap a roll whose success and failure run their own functions', () => {
    const trap = objectOfProp(prop('t', { kind: 'trapped', trait: 'finesse', difficulty: 14, repeatable: true, success: { kind: 'door' }, failure: { kind: 'portal', pair: 'pit' } }));
    expect(trap.repeatable).toBe(true);
    expect(trap.check).toMatchObject({ trait: 'finesse', difficulty: 14 });
    expect(trap.check!.onSuccessWithGood).toEqual([parts.toggle('t')]);
    expect(trap.check!.onSuccessWithBad).toEqual([parts.toggle('t')]);
    expect(trap.check!.onFailureWithBad).toEqual([parts.teleport('pit')]);
    // A trap in front of a door is a door: in the way until the roll opens it.
    expect(trap).toMatchObject({ kind: 'door', blocksMovement: true });
  });

  it('does nothing on an outcome that was left as nothing', () => {
    const trap = objectOfProp(prop('t', { kind: 'trapped', trait: 'agility', difficulty: 10, repeatable: false }));
    expect(trap.check!.onSuccessWithGood).toEqual([]);
    expect(trap.check!.onFailureWithGood).toEqual([]);
    expect(trap).toMatchObject({ kind: 'scripted', blocksMovement: false });
    expect(stepsOf(undefined, 't')).toEqual([]);
  });

  it('nests a trap inside a trap, and finds a container however deep it is', () => {
    const inner: PropFunction = { kind: 'trapped', trait: 'strength', difficulty: 11, repeatable: false, success: { kind: 'container', items: [{ item: 'gem', count: 1 }] } };
    const outer: PropFunction = { kind: 'trapped', trait: 'finesse', difficulty: 13, repeatable: false, success: inner };
    expect(propFunctionSchema.safeParse(outer).success).toBe(true);
    expect(containerItems(outer)).toEqual([{ item: 'gem', count: 1 }]);
    const steps = stepsOf(outer, 'x');
    expect(steps[0]).toMatchObject({ kind: 'check', check: { trait: 'finesse' } });
  });

  it('keeps everything an object could say, in a script', () => {
    const fn = PROP_FUNCTIONS.script.fresh();
    const scripted = objectOfProp(prop('s', { ...fn, object: 'chest', name: 'Strongbox', requiresKey: 'word', effects: [{ kind: 'log', text: 'It opens.' }] }));
    expect(scripted).toMatchObject({ kind: 'chest', name: 'Strongbox', requiresKey: 'word' });
    expect(scripted.effects).toHaveLength(1);
  });
});

describe('props among the things a room holds', () => {
  const room = (decos: unknown[]): SceneDoc => sceneSchema.parse({ ...blankScene('room', 8, 8), decos });

  it('lists a prop with a function beside the objects, and scenery not at all', () => {
    const scene = room([
      { model: 'rock', position: { x: 1, y: 1 }, rotation: 0 },
      { id: 'gate', model: 'door', position: { x: 2, y: 2 }, rotation: 0, function: { kind: 'door' } },
    ]);
    expect(interactablesOf(scene).map((thing) => thing.id)).toEqual(['gate']);
  });

  it('will not have a prop with a function and no id, or two things sharing one', () => {
    expect(sceneSchema.safeParse({ ...blankScene('room', 8, 8), decos: [{ model: 'door', position: { x: 2, y: 2 }, rotation: 0, function: { kind: 'door' } }] }).success).toBe(false);
    const twice = sceneSchema.safeParse({
      ...blankScene('room', 8, 8),
      decos: [
        { id: 'same', model: 'door', position: { x: 2, y: 2 }, rotation: 0, function: { kind: 'door' } },
        { id: 'same', model: 'chest', position: { x: 3, y: 2 }, rotation: 0, function: { kind: 'container', items: [] } },
      ],
    });
    expect(twice.success).toBe(false);
  });
});

describe('portal pairs', () => {
  const project = (...rooms: { id: string; portals: [string, string][] }[]) => ({
    scenes: rooms.map((r) => ({ id: r.id, decos: r.portals.map(([id, pair], i) => prop(id, { kind: 'portal', pair }, { x: i, y: 0 })) })),
  });

  it('finds the other end, in this room or another', () => {
    const p = project({ id: 'a', portals: [['up', 'stair']] }, { id: 'b', portals: [['down', 'stair']] });
    expect(portalPartner(p, 'stair', 'up')).toMatchObject({ scene: 'b', prop: { id: 'down' } });
    expect(portalPartner(p, 'stair', 'down')).toMatchObject({ scene: 'a', prop: { id: 'up' } });
  });

  it('has no other end while it is the only one', () => {
    expect(portalPartner(project({ id: 'a', portals: [['lone', 'x']] }), 'x', 'lone')).toBeNull();
  });

  it('is two and never three: an id two other portals answer to is taken', () => {
    const p = project({ id: 'a', portals: [['one', 'gate'], ['two', 'gate']] });
    expect(pairTaken(p, 'gate', 'third')).toEqual(['one', 'two']);
    // Either end of the pair keeping the id it has is not a third.
    expect(pairTaken(p, 'gate', 'one')).toEqual([]);
    expect(pairTaken(p, 'fresh', 'third')).toEqual([]);
  });
});
