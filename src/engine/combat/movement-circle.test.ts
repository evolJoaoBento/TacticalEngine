/**
 * Movement in a fight is a circle: Close round where the spotlight found each fighter, free to
 * move in again and again, pushed out a distance step by a roll, and drawn afresh when the
 * spotlight comes back to the party.
 */

import { describe, expect, it } from 'vitest';
import { TileGrid } from '../grid/grid';
import { Pathfinder } from '../grid/pathfinding';
import { distanceInside, insideCircle, splitLine } from '../grid/walk';
import { maxSpanForBand, nextBand } from '../rules/range';
import { Party } from '../scene/party';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { ReachRing } from '../render/reach-ring';
import { EncounterRunner } from './encounter';

function fight() {
  const grid = new TileGrid({ width: 16, height: 10 });
  const state = new SceneState({ id: 'field', encounters: [{ id: 'brawl', adversaries: [], triggerCells: [], startsOnTrigger: true }] } as never, grid);
  state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(2, 5)));
  state.addEntity(createPartyEntity('finn', 'rogue', grid.indexOf(3, 5)));
  state.addEntity(createAdversaryEntity('husk', 'husk', grid.indexOf(12, 5), { hitPoints: 3, stress: 2 }));
  const runner = new EncounterRunner(state, 'brawl');
  runner.start();
  return { grid, state, runner };
}

describe('the distance steps', () => {
  it('go out one band at a time, and stop at Very Far', () => {
    expect(nextBand('close')).toBe('far');
    expect(nextBand('far')).toBe('veryFar');
    expect(nextBand('veryFar')).toBeNull();
    expect(maxSpanForBand('close', { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 })).toBe(4.5);
  });
});

describe('a fighter’s circle', () => {
  it('is Close round where they stood when the fight began, for everybody living in the party', () => {
    const { runner } = fight();
    expect(runner.circleOf('kara')).toEqual({ anchor: { x: 2, y: 5 }, band: 'close' });
    expect(runner.circleOf('finn')).toEqual({ anchor: { x: 3, y: 5 }, band: 'close' });
    expect(runner.circleOf('husk')).toBeNull();
    expect(runner.circleOf('nobody')).toBeNull();
  });

  it('stays where it was as they move about inside it', () => {
    const { state, runner } = fight();
    state.placeEntity('kara', 4.3, 6.1);
    expect(runner.circleOf('kara')!.anchor).toEqual({ x: 2, y: 5 });
  });

  it('is pushed out a step by a roll, and no further than Very Far', () => {
    const { runner } = fight();
    expect(runner.pushOpens('kara')).toBe('far');
    expect(runner.push('kara')).toBe('far');
    expect(runner.circleOf('kara')!.band).toBe('far');
    expect(runner.push('kara')).toBe('veryFar');
    expect(runner.pushOpens('kara')).toBeNull();
    expect(runner.push('kara')).toBeNull();
    expect(runner.log.filter((event) => event.kind === 'pushed')).toHaveLength(2);
  });

  it('is drawn afresh at Close round where they now stand when the spotlight comes back', () => {
    const { state, runner } = fight();
    runner.push('kara');
    state.placeEntity('kara', 7, 5);
    runner.passToGm();
    expect(runner.circleOf('kara')!.band).toBe('far'); // untouched through the GM's turn
    runner.endGmTurn();
    expect(runner.circleOf('kara')).toEqual({ anchor: { x: 7, y: 5 }, band: 'close' });
  });

  it('is re-anchored on somebody shoved clean out of it, keeping its band', () => {
    const { state, runner } = fight();
    runner.push('kara');
    state.placeEntity('kara', 14, 8);
    runner.reanchor('kara');
    expect(runner.circleOf('kara')).toEqual({ anchor: { x: 14, y: 8 }, band: 'far' });
  });
});

describe('a line kept inside a circle', () => {
  const circle = { anchor: { x: 0, y: 0 }, radius: 3 };
  it('is all of it when it never leaves, and up to the edge when it does', () => {
    expect(insideCircle({ x: 3, y: 0 }, circle)).toBe(true);
    expect(insideCircle({ x: 3.01, y: 0 }, circle)).toBe(false);
    expect(distanceInside([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], circle)).toBeCloseTo(4, 6);
    expect(distanceInside([{ x: 0, y: 0 }, { x: 6, y: 0 }], circle)).toBeCloseTo(3, 1);
    // Out and back in again: the walk stops the first time it leaves.
    expect(distanceInside([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 1 }], circle)).toBeCloseTo(3, 1);
    expect(distanceInside([{ x: 5, y: 0 }, { x: 0, y: 0 }], circle)).toBe(0);
    expect(splitLine([{ x: 0, y: 0 }, { x: 6, y: 0 }], 3).within.at(-1)).toEqual({ x: 3, y: 0 });
  });

  it('bounds a walk in the party, with a cut at the edge when asked', () => {
    const grid = new TileGrid({ width: 16, height: 10 });
    const state = new SceneState({ id: 'field' }, grid);
    state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(2, 5)));
    const party = new Party(state, new Pathfinder(grid));
    const within = { anchor: { x: 2, y: 5 }, radius: 4.5 };
    expect(party.planWalk('kara', grid.indexOf(6, 5), { inCombat: true, budget: Infinity, within })).not.toBeNull();
    expect(party.planWalk('kara', grid.indexOf(7, 5), { inCombat: true, budget: Infinity, within })).toBeNull();
    const cut = party.planWalk('kara', grid.indexOf(10, 5), { inCombat: true, budget: Infinity, within, short: true })!;
    expect(cut.route.at(-1)!.x).toBeCloseTo(6.5, 1);
    expect(cut.beyond!.at(-1)).toEqual({ x: 10, y: 5 });
    // Two moves inside it, and the second measured from the same anchor, not from where the first ended.
    party.walkTo('kara', grid.indexOf(5, 5), { inCombat: true, budget: Infinity, within });
    expect(party.planWalk('kara', grid.indexOf(6, 5), { inCombat: true, budget: Infinity, within })).not.toBeNull();
    expect(party.planWalk('kara', grid.indexOf(8, 5), { inCombat: true, budget: Infinity, within })).toBeNull();
    // What is lit: the tiles inside it, walkable without leaving it.
    const lit = party.covered('kara', { inCombat: true, within });
    expect(lit.canReach(grid.indexOf(6, 5))).toBe(true);
    expect(lit.canReach(grid.indexOf(7, 5))).toBe(false);
  });
});

describe('the rings on the ground', () => {
  it('draws one per kind at its centre and radius, and none when told nothing', () => {
    const rings = new ReachRing(1);
    rings.show([{ x: 1, y: 0.25, z: 2, radius: 4.5, kind: 'move' }, { x: 1, y: 0.25, z: 2, radius: 8.5, kind: 'push' }]);
    expect(rings.group.visible).toBe(true);
    const move = rings.group.getObjectByName('reach:move')!;
    expect(move.visible).toBe(true);
    expect(move.position.toArray()).toEqual([1, 0.29, 2]);
    expect(rings.group.getObjectByName('reach:jump')!.visible).toBe(false);
    expect(rings.showing).toHaveLength(2);
    rings.hide();
    expect(rings.group.visible).toBe(false);
    expect(rings.showing).toEqual([]);
    rings.dispose();
  });
});
