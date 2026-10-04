import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { describePack, readPack } from '../engine/content/pack/document';
import { STARTER_PACK } from '../engine/content/pack/starter';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { importPack } from '../editor/session';
import { validateProject } from '../editor/validate';
import { worldOptions } from './room';

/**
 * The pack the build ships as a file rather than as code: two ember spells, each carrying the
 * condition it applies. The engine used to carry both conditions itself; they left it for this, so
 * everything here is read from the file a player would import, not from a copy of it.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const PACK_FILE = 'public/packs/ember-spells.json';
const reading = () => readPack(JSON.parse(readFileSync(`${repoRoot}${PACK_FILE}`, 'utf8')), PACK_FILE);

describe('the ember spells pack', () => {
  it('reads clean, and checks clean in a project that imports it', () => {
    const { pack, issues, refused } = reading();
    expect(refused).toBeNull();
    expect(issues).toEqual([]);
    expect(describePack(pack)).toBe('3 cards, 3 abilities, 2 conditions');

    const project = projectSchema.parse({
      id: 'ember',
      name: 'Ember',
      scenes: [sceneSchema.parse(blankScene('room', 4, 4))],
      startScene: 'room',
      ...STARTER_PACK,
    });
    importPack(pack).apply(project);
    const ids = [...pack.cards, ...pack.abilities, ...pack.conditionDefs].map((entry) => entry.id);
    // Nothing the validator says is about the pack: every condition its cards apply, it brought.
    const about = validateProject(project).filter((problem) => ids.some((id) => problem.message.includes(`"${id}"`)));
    expect(about).toEqual([]);
  });

  it('brings the conditions it applies, which the engine no longer carries', () => {
    // The two it replaces, by the ids they had in the engine's own list.
    const engine = SRD_CONDITIONS.map((def) => def.id);
    expect(engine).not.toContain('korvax-circle');
    expect(engine).not.toContain('sitil-echo');

    const project = projectSchema.parse({
      id: 'bare',
      name: 'Bare',
      scenes: [sceneSchema.parse(blankScene('room', 4, 4))],
      startScene: 'room',
    });
    importPack(reading().pack).apply(project);
    const named = new Map((worldOptions(new Map(), undefined, undefined, project).conditionDefs ?? []).map((def) => [def.id, def.name]));
    expect(named.get('biting-ground')).toBe('Biting Circle');
    expect(named.get('echoing')).toBe('Echoing');
  });
});
