/**
 * Which names a project could be drawing a model by: every string outside the model list itself,
 * and the bodies objects are drawn with.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from './grid-from-scene';
import { projectSchema, sceneSchema } from './schema';
import { modelNamesIn } from './model-references';

describe('the names a project draws models by', () => {
  it('counts a prop, a creature, its type and a summon inside a card, and not a model only declared', () => {
    const project = projectSchema.parse({
      id: 'p',
      name: 'P',
      scenes: [
        sceneSchema.parse({
          ...blankScene('hall', 4, 4),
          decos: [{ model: 'fern', position: { x: 1, y: 1 }, rotation: 0 }],
          encounters: [{ id: 'e', adversaries: [{ id: 'a', adversary: 'wolf', position: { x: 2, y: 2 }, model: 'alpha' }] }],
        }),
      ],
      startScene: 'hall',
      adversaryModels: { bear: 'bear-model' },
      assets: [{ id: 'unplaced', url: 'data:application/octet-stream;base64,AAAA' }],
    });
    // A card whose script calls a creature up: only the summon matters here, so the rest of the card is left out.
    (project.abilities as unknown[]).push({ id: 'howl', effects: [{ kind: 'summon', adversary: 'pup' }] });
    const named = modelNamesIn(project);
    for (const id of ['fern', 'alpha', 'wolf', 'bear-model', 'pup', 'door-prop']) expect(named.has(id), id).toBe(true);
    // Declared and named nowhere else: the one a save may leave behind.
    expect(named.has('unplaced')).toBe(false);
  });
});
