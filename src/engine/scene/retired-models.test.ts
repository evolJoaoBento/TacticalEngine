import { describe, it, expect } from 'vitest';
import { PROP_MODELS } from '../render/procedural/library/props';
import { projectSchema } from './schema';
import { RETIRED_MODELS, currentModel, renameRetiredModels } from './retired-models';

/** A project naming retired models everywhere a model can be named. */
function old() {
  return projectSchema.parse({
    id: 'old',
    name: 'Old',
    startScene: 'room',
    scenes: [{
      id: 'room',
      name: 'Room',
      width: 2,
      height: 2,
      terrain: ['floor', 'floor', 'floor', 'floor'],
      heights: [0, 0, 0, 0],
      spawns: [{ x: 0, y: 0 }],
      decos: [
        { model: 'pine', position: { x: 1, y: 0 }, rotation: 0 },
        { model: 'husk', position: { x: 1, y: 1 }, rotation: 0 },
      ],
      interactables: [{ id: 'gate', kind: 'door', position: { x: 0, y: 1 }, model: 'door' }],
      encounters: [{ id: 'e', name: '', adversaries: [{ id: 'a', adversary: 'husk', position: { x: 1, y: 1 }, model: 'dummy' }], triggerCells: [], startsOnTrigger: true }],
    }],
    propPresets: [{ id: 'crates', label: 'Crates', model: 'crate' }],
    terrainPalette: [{ id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#555555', model: 'barrel' }],
    adversaryModels: { husk: 'brazier', wolf: 'wolf-model' },
  });
}

describe('retired models', () => {
  it('are none the procedural library still draws, and each names what replaced it', () => {
    const drawn = new Set(PROP_MODELS.map((spec) => spec.id));
    for (const [retired, now] of Object.entries(RETIRED_MODELS)) {
      expect(drawn.has(retired), retired).toBe(false);
      expect(now).toMatch(/-prop$/);
    }
    expect(Object.keys(RETIRED_MODELS).sort()).toEqual(['banner', 'barrel', 'brazier', 'campfire', 'cart', 'chest', 'crate', 'deadTree', 'door', 'dummy', 'pillar', 'pine', 'portal', 'rock']);
  });

  it('gives the replacement for a retired name and leaves any other name alone', () => {
    expect(currentModel('pine')).toBe('tree-prop');
    expect(currentModel('rock')).toBe('rock-prop');
    expect(currentModel('pillar')).toBe('pillar-prop');
    expect(currentModel('husk')).toBe('husk');
    // Not fooled by what every object has.
    expect(currentModel('toString')).toBe('toString');
  });

  it('renames every place a project names a model, and nothing else', () => {
    const project = old();
    expect(renameRetiredModels(project)).toBe(6);
    const room = project.scenes[0]!;
    expect(room.decos.map((deco) => deco.model)).toEqual(['tree-prop', 'husk']);
    expect(room.interactables[0]!.model).toBe('door-prop');
    expect(room.encounters[0]!.adversaries[0]!.model).toBe('training-dummy-prop');
    expect(project.propPresets![0]!.model).toBe('crate-prop');
    expect(project.terrainPalette![0]!.model).toBe('barrel-prop');
    expect(project.adversaryModels).toEqual({ husk: 'standing-torch-prop', wolf: 'wolf-model' });
    // A second pass finds nothing left to do.
    expect(renameRetiredModels(project)).toBe(0);
  });
});
