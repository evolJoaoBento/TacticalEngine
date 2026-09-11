import { expect, it } from 'vitest';
import { projectSchema } from '../engine/scene/schema';
import { blankScene } from '../engine/scene/grid-from-scene';
import { buildProjectScene, PARTY_SHEETS } from './demo-scene';
import { syncAuthoredEncounters } from './authored-encounters';

it('makes authored creatures and triggers playable while preserving existing wounds', () => {
  const project = projectSchema.parse({ id: 'test', startScene: 'room', scenes: [blankScene('room', 8, 8)], party: PARTY_SHEETS });
  const demo = buildProjectScene(project, 'placed');
  demo.scene.encounters.push({ id: 'new', name: '', startsOnTrigger: true, triggerCells: [{ x: 4, y: 4 }],
    adversaries: [{ id: 'new-wolf', adversary: 'dire-wolf', position: { x: 5, y: 5 } }] });
  demo.state.entity('kara')!.hitPoints.marked = 2;
  syncAuthoredEncounters(demo, new Set());
  const wolf = demo.state.entity('new-wolf')!;
  expect(wolf.definition).toBe('dire-wolf'); expect(wolf.tile).toBe(45);
  expect(demo.triggers.at(36)).toBe('new');
  wolf.hitPoints.marked = 1;
  syncAuthoredEncounters(demo, new Set(['new-wolf']));
  expect(demo.state.entity('new-wolf')!.hitPoints.marked).toBe(1);
  expect(demo.state.entity('kara')!.hitPoints.marked).toBe(2);
  demo.scene.encounters[0]!.adversaries = [];
  syncAuthoredEncounters(demo, new Set(['new-wolf']));
  expect(demo.state.entity('new-wolf')).toBeUndefined();
});
