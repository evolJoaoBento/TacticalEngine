import { expect, it } from 'vitest';
import { projectSchema } from '../engine/scene/schema';
import { blankScene } from '../engine/scene/grid-from-scene';
import { buildProjectScene } from './demo-scene';
import { PARTY_SHEETS } from './demo-rules';
import { syncAuthoredEncounters } from './authored-encounters';
import { FIXTURE_ADVERSARIES, FIXTURE_FOE } from '../../tests/fixtures/adversaries';

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
