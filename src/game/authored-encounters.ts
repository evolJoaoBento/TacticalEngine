import { createAdversaryEntity } from '../engine/scene/state';
import { TriggerIndex } from '../engine/scene/triggers';
import { SRD_ADVERSARIES, type DemoScene } from './demo-scene';

/** Bring authored encounters into play without resetting existing creatures or party pools. */
export function syncAuthoredEncounters(demo: DemoScene, previousIds: ReadonlySet<string>): void {
  const placed = new Set<string>();
  for (const encounter of demo.scene.encounters) for (const placement of encounter.adversaries) {
    placed.add(placement.id);
    if (demo.state.entity(placement.id)) continue;
    const definition = SRD_ADVERSARIES.get(placement.adversary);
    const tile = demo.grid.indexOf(placement.position.x, placement.position.y);
    if (!definition || tile < 0) continue;
    demo.state.addEntity(createAdversaryEntity(placement.id, placement.adversary, tile, {
      hitPoints: placement.hitPoints ?? definition.hitPoints, stress: definition.stress,
    }));
  }
  for (const id of previousIds) if (!placed.has(id)) demo.state.removeEntity(id);
  demo.triggers = new TriggerIndex(demo.scene, demo.grid);
}
