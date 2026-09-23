/**
 * Prop functions, played: a door, a trap, a container and portals, in the demo's own rooms.
 *
 * Each is used the way the game uses anything - `useSelectedOn`, and `answerPending` for a roll -
 * so what is tested is the whole way through: the function turned into an object, the object used,
 * the effects run, and what the game does with the journal afterwards.
 */

import { describe, it, expect } from 'vitest';
import { buildDemoScene, buildProjectScene, answerPending, useSelectedOn, type DemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { closeContainer, containerContents, openContainer, takeFromContainer } from './prop-use';
import type { PropFunction } from '../engine/scene/prop-function-schema';
import type { ProjectDoc } from '../engine/scene/schema';

type Placed = { id: string; at: { x: number; y: number }; fn: PropFunction; span?: number; scene?: number };

/** The demo, with props added to its rooms, stood up the way a project file is. */
function withProps(...props: Placed[]): DemoScene {
  const project = JSON.parse(JSON.stringify(buildDemoScene(hollowVaultMap()).project)) as ProjectDoc;
  for (const p of props) {
    project.scenes[p.scene ?? 0]!.decos.push({ id: p.id, model: 'crate', position: p.at, rotation: 0, function: p.fn, ...(p.span === undefined ? {} : { span: p.span }) });
  }
  const demo = buildProjectScene(project, 'props');
  demo.party.select('kara');
  return demo;
}

/** Stand the selected member on a tile, as a test puts somebody where it needs them. */
function standAt(demo: DemoScene, id: string, at: { x: number; y: number }): void {
  demo.state.moveEntity(id, demo.grid.indexOf(at.x, at.y));
  demo.state.placeEntity(id, at.x, at.y);
}

const blocked = (demo: DemoScene, at: { x: number; y: number }): boolean => demo.state.blockedFor('')(demo.grid.indexOf(at.x, at.y));

/** Out of the way of the party's spawn, on open floor in the vault's west room. */
const DOOR = { x: 5, y: 9 };

describe('a door', () => {
  it('stands in the way while shut, gets out of it when used, and shuts again when used again', () => {
    const demo = withProps({ id: 'gate', at: DOOR, fn: { kind: 'door' } });
    standAt(demo, 'kara', { x: 4, y: 9 });
    expect(blocked(demo, DOOR)).toBe(true);

    expect(useSelectedOn(demo, 'gate').status).toBe('done');
    expect(demo.state.interactable('gate').open).toBe(true);
    expect(blocked(demo, DOOR)).toBe(false);

    expect(useSelectedOn(demo, 'gate').status).toBe('done');
    expect(demo.state.interactable('gate').open).toBe(false);
    expect(blocked(demo, DOOR)).toBe(true);
  });

  it('will not shut on somebody standing in the doorway', () => {
    const demo = withProps({ id: 'gate', at: DOOR, fn: { kind: 'door' } });
    standAt(demo, 'kara', { x: 4, y: 9 });
    useSelectedOn(demo, 'gate');
    standAt(demo, 'finn', DOOR);
    useSelectedOn(demo, 'gate');
    expect(demo.state.interactable('gate').open).toBe(true);
    expect(demo.log.at(-1)!.text).toContain('somebody in the way');
  });

  it('covers its whole block when it is drawn across more than one tile', () => {
    const demo = withProps({ id: 'gate', at: DOOR, span: 2, fn: { kind: 'door' } });
    standAt(demo, 'kara', { x: 4, y: 9 });
    for (const at of [DOOR, { x: 6, y: 10 }]) expect(blocked(demo, at)).toBe(true);
    useSelectedOn(demo, 'gate');
    for (const at of [DOOR, { x: 6, y: 10 }]) expect(blocked(demo, at)).toBe(false);
  });
});

describe('a trap', () => {
  it('asks for the roll first, and opens the door it guards on a success', () => {
    // Difficulty 1: two d12s and a trait cannot miss it, so the success is certain and the test is about what follows.
    const demo = withProps({ id: 'lock', at: DOOR, fn: { kind: 'trapped', trait: 'finesse', difficulty: 1, repeatable: false, success: { kind: 'door' } } });
    standAt(demo, 'kara', { x: 4, y: 9 });
    expect(blocked(demo, DOOR)).toBe(true);
    expect(useSelectedOn(demo, 'lock').status).toBe('waiting');
    answerPending(demo, { kind: 'roll' });
    expect(demo.state.interactable('lock').open).toBe(true);
    expect(blocked(demo, DOOR)).toBe(false);
  });

  it('runs the failure instead on a miss, and nothing at all when the failure is nothing', () => {
    const demo = withProps({ id: 'lock', at: DOOR, fn: { kind: 'trapped', trait: 'finesse', difficulty: 40, repeatable: true, success: { kind: 'door' } } });
    standAt(demo, 'kara', { x: 4, y: 9 });
    useSelectedOn(demo, 'lock');
    answerPending(demo, { kind: 'roll' });
    expect(demo.state.interactable('lock').open).toBe(false);
    expect(blocked(demo, DOOR)).toBe(true);
    // Repeatable: the same lock can be tried again.
    expect(useSelectedOn(demo, 'lock').status).toBe('waiting');
  });

  it('is dealt with once when it is not repeatable', () => {
    const demo = withProps({ id: 'lock', at: DOOR, fn: { kind: 'trapped', trait: 'finesse', difficulty: 40, repeatable: false } });
    standAt(demo, 'kara', { x: 4, y: 9 });
    useSelectedOn(demo, 'lock');
    answerPending(demo, { kind: 'roll' });
    expect(useSelectedOn(demo, 'lock').status).toBe('refused');
  });
});

describe('a container', () => {
  it('shows what it holds, and each thing taken goes into the pack and out of the container', () => {
    const demo = withProps({ id: 'crate', at: DOOR, fn: { kind: 'container', items: [{ item: 'healing-draught', count: 2 }, { item: 'gold', count: 1 }] } });
    standAt(demo, 'kara', { x: 4, y: 9 });
    const before = demo.world.itemCount('healing-draught');

    expect(useSelectedOn(demo, 'crate').status).toBe('done');
    expect(openContainer(demo)).toBe('crate');
    expect(containerContents(demo, 'crate')).toEqual([
      { item: 'healing-draught', name: expect.any(String), count: 2 },
      { item: 'gold', name: expect.any(String), count: 1 },
    ]);

    expect(takeFromContainer(demo, 'crate', 'healing-draught')).toBe(true);
    expect(demo.world.itemCount('healing-draught')).toBe(before + 1);
    expect(containerContents(demo, 'crate')[0]!.count).toBe(1);
    takeFromContainer(demo, 'crate', 'healing-draught');
    expect(containerContents(demo, 'crate').map((line) => line.item)).toEqual(['gold']);
    // Nothing left of it to take.
    expect(takeFromContainer(demo, 'crate', 'healing-draught')).toBe(false);

    closeContainer(demo);
    expect(openContainer(demo)).toBeNull();
  });

  it('remembers what was taken with the room, so a save brings it back emptied', () => {
    const demo = withProps({ id: 'crate', at: DOOR, fn: { kind: 'container', items: [{ item: 'gold', count: 1 }] } });
    standAt(demo, 'kara', { x: 4, y: 9 });
    useSelectedOn(demo, 'crate');
    takeFromContainer(demo, 'crate', 'gold');
    const snapshot = demo.state.snapshot();
    demo.state.restore(snapshot);
    expect(containerContents(demo, 'crate')).toEqual([]);
  });
});

describe('a portal', () => {
  it('sends whoever used it to stand beside its partner in the same room', () => {
    const far = { x: 15, y: 5 };
    const demo = withProps(
      { id: 'here', at: DOOR, fn: { kind: 'portal', pair: 'bridge' } },
      { id: 'there', at: far, fn: { kind: 'portal', pair: 'bridge' } },
    );
    standAt(demo, 'kara', { x: 4, y: 9 });
    useSelectedOn(demo, 'here');
    const at = demo.state.entity('kara')!.at;
    expect(Math.max(Math.abs(at.x - far.x), Math.abs(at.y - far.y))).toBeLessThanOrEqual(1.01);
    // Put down, not walked across the room.
    expect(demo.motions.some((motion) => motion.id === 'kara' && motion.teleport === true)).toBe(true);
  });

  it('takes the party to its partner in another room, and steps them out beside it', () => {
    const demo = withProps(
      { id: 'down', at: DOOR, fn: { kind: 'portal', pair: 'shaft' } },
      { id: 'up', at: { x: 3, y: 3 }, fn: { kind: 'portal', pair: 'shaft' }, scene: 1 },
    );
    standAt(demo, 'kara', { x: 4, y: 9 });
    useSelectedOn(demo, 'down');
    expect(demo.scene.id).toBe('the-pit');
    const at = demo.state.entity('kara')!.at;
    expect(Math.max(Math.abs(at.x - 3), Math.abs(at.y - 3))).toBeLessThanOrEqual(2.01);
  });

  it('says so, and goes nowhere, while it has no partner', () => {
    const demo = withProps({ id: 'lone', at: DOOR, fn: { kind: 'portal', pair: 'nobody' } });
    standAt(demo, 'kara', { x: 4, y: 9 });
    const before = { ...demo.state.entity('kara')!.at };
    useSelectedOn(demo, 'lone');
    expect(demo.state.entity('kara')!.at).toEqual(before);
    expect(demo.log.at(-1)!.text).toContain('no partner');
  });
});
