import { describe, expect, it } from 'vitest';
import { projectSchema, type SceneDoc } from '../engine/scene/schema';
import { blankScene } from '../engine/scene/grid-from-scene';
import { buildProjectScene, travelTo, PARTY_SHEETS, type DemoScene } from './demo-scene';
import { syncAuthoredEncounters } from './authored-encounters';
import { FIXTURE_ADVERSARIES, FIXTURE_FOE } from '../../tests/fixtures/adversaries';

/** A placement the editor would have written into the document. */
function wolf(id: string, x: number, y: number): SceneDoc['encounters'][number] {
  return {
    id: `enc-${id}`,
    name: '',
    startsOnTrigger: true,
    triggerCells: [],
    adversaries: [{ id, adversary: FIXTURE_FOE, position: { x, y } }],
  };
}

/** Two rooms, so the party can walk out of one and back into it. */
function twoRooms(): DemoScene {
  const project = projectSchema.parse({
    id: 'test',
    startScene: 'room',
    scenes: [blankScene('room', 8, 8), blankScene('hall', 8, 8)],
    party: PARTY_SHEETS,
    adversaries: [...FIXTURE_ADVERSARIES],
  });
  return buildProjectScene(project, 'travel');
}

it('makes authored creatures and triggers playable while preserving existing wounds', () => {
  const project = projectSchema.parse({ id: 'test', startScene: 'room', scenes: [blankScene('room', 8, 8)], party: PARTY_SHEETS, adversaries: [...FIXTURE_ADVERSARIES] });
  const demo = buildProjectScene(project, 'placed');
  demo.scene.encounters.push({ id: 'new', name: '', startsOnTrigger: true, triggerCells: [{ x: 4, y: 4 }],
    adversaries: [{ id: 'new-wolf', adversary: FIXTURE_FOE, position: { x: 5, y: 5 } }] });
  demo.state.entity('kara')!.hitPoints.marked = 2;
  syncAuthoredEncounters(demo);
  const wolfEntity = demo.state.entity('new-wolf')!;
  expect(wolfEntity.definition).toBe(FIXTURE_FOE); expect(wolfEntity.tile).toBe(45);
  expect(demo.triggers.at(36)).toBe('new');
  wolfEntity.hitPoints.marked = 1;
  syncAuthoredEncounters(demo);
  expect(demo.state.entity('new-wolf')!.hitPoints.marked).toBe(1);
  expect(demo.state.entity('kara')!.hitPoints.marked).toBe(2);
  demo.scene.encounters[0]!.adversaries = [];
  syncAuthoredEncounters(demo);
  expect(demo.state.entity('new-wolf')).toBeUndefined();
});

describe('a scene entered again', () => {
  it('brings in a creature authored while the party was elsewhere', () => {
    const demo = twoRooms();
    const room = demo.project.scenes[0]!;
    expect(travelTo(demo, 'hall')).toBe(true);
    // Authored in the editor while the party stood in the other room, so the
    // snapshot the room was left as knows nothing about it.
    room.encounters.push(wolf('late-wolf', 5, 5));
    expect(travelTo(demo, 'room')).toBe(true);
    expect(demo.state.entity('late-wolf')!.tile).toBe(5 * 8 + 5);
  });

  it('leaves a creature a script took out of the room out of it', () => {
    const demo = twoRooms();
    const room = demo.project.scenes[0]!;
    room.encounters.push(wolf('doomed-wolf', 5, 5));
    syncAuthoredEncounters(demo);
    expect(demo.state.entity('doomed-wolf')).toBeDefined();
    // What the `replace` script effect does: the document still places it, the
    // state deliberately no longer holds it.
    demo.state.removeEntity('doomed-wolf');
    syncAuthoredEncounters(demo);
    expect(demo.state.entity('doomed-wolf')).toBeUndefined();
    expect(travelTo(demo, 'hall')).toBe(true);
    expect(travelTo(demo, 'room')).toBe(true);
    expect(demo.state.entity('doomed-wolf')).toBeUndefined();
  });

  it('takes out a creature the document no longer places', () => {
    const demo = twoRooms();
    const room = demo.project.scenes[0]!;
    room.encounters.push(wolf('cut-wolf', 5, 5));
    syncAuthoredEncounters(demo);
    expect(demo.state.entity('cut-wolf')).toBeDefined();
    expect(travelTo(demo, 'hall')).toBe(true);
    room.encounters.length = 0;
    expect(travelTo(demo, 'room')).toBe(true);
    expect(demo.state.entity('cut-wolf')).toBeUndefined();
  });

  it('never stands up a placement authored off the board', () => {
    const demo = twoRooms();
    const room = demo.project.scenes[0]!;
    expect(travelTo(demo, 'hall')).toBe(true);
    room.encounters.push(wolf('outside-wolf', -200, 400));
    expect(travelTo(demo, 'room')).toBe(true);
    expect(demo.state.entity('outside-wolf')).toBeUndefined();
  });

  it('reports a placement naming an adversary with no stat block, as loading does', () => {
    const demo = twoRooms();
    const room = demo.project.scenes[0]!;
    expect(travelTo(demo, 'hall')).toBe(true);
    room.encounters.push({ id: 'enc-x', name: '', startsOnTrigger: true, triggerCells: [],
      adversaries: [{ id: 'nobody', adversary: 'not-a-creature', position: { x: 1, y: 1 } }] });
    expect(() => travelTo(demo, 'room')).toThrow(/no stat block/);
  });
});
