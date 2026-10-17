/**
 * Check, on the imported materials kinds of tile are drawn in (`validate.ts`, `checkSurfaces`): a kind drawn in a
 * material the project has not got, one whose model wins over its material, and what the materials weigh together.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { validateProject } from './validate';

function build(): ProjectDoc {
  return projectSchema.parse({ id: 'demo', name: 'Demo', scenes: [sceneSchema.parse(blankScene('room', 6, 4))], startScene: 'room' });
}

const messages = (project: ProjectDoc): string[] => validateProject(project).map((p) => p.message);

describe('the imported materials kinds of tile are drawn in', () => {
  const maps = { color: 'data:image/webp;base64,AA', normalHeight: 'data:image/png;base64,AB', orm: 'data:image/webp;base64,AC' };
  it('says a kind drawn in a material the project has not got, and one whose model wins over its material', () => {
    const project = projectSchema.parse({
      ...build(),
      surfaces: [{ id: 'bricks', name: 'Bricks', maps, parallax: true }],
      terrainPalette: [
        { id: 'grass' },
        { id: 'bricks-wall', name: 'Bricks Wall', structure: 'wall', surface: 'bricks' },
        { id: 'lost-wall', name: 'Lost Wall', structure: 'wall', surface: 'stone' },
        { id: 'crate-block', name: 'Crate', structure: 'block', model: 'crate', surface: 'bricks' },
      ],
    });
    const found = validateProject(project);
    expect(found.filter((p) => p.message.includes('surface')).map((p) => [p.severity, p.message])).toEqual([
      ['error', 'Kind of tile "Lost Wall" is drawn in surface "stone", which the project does not have.'],
      ['warning', 'Kind of tile "Crate" is drawn with the model "crate"; its surface "bricks" is ignored.'],
    ]);
  });

  it('says what the materials weigh together once they are heavy', () => {
    const heavy = `data:image/png;base64,${'A'.repeat(6 * 1024 * 1024)}`;
    const project = projectSchema.parse({ ...build(), surfaces: [{ id: 'a', name: 'A', maps: { color: heavy, normalHeight: heavy, orm: 'x,' }, parallax: true }] });
    expect(messages(project)).toContain('Imported materials are carried inside the project at 9.0 MB; saving and loading will feel it.');
  });
});
