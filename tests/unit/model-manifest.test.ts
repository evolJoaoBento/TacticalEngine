import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODELS_DIRECTORY, SHIPPED_SCALE, shippedModels } from '../../tools/model-manifest';

/**
 * The folder is the registry.
 *
 * Dropping a `.glb` into `public/models` is how a model gets into the game, so what
 * matters is that the list comes off the folder itself: the file's own name is the
 * id content refers to, a folder that is not there is no models rather than a crash,
 * and anything that is not a model file is ignored.
 */

/** A `public` directory with these files in its models folder. */
function served(...files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'models-'));
  mkdirSync(join(root, MODELS_DIRECTORY), { recursive: true });
  for (const name of files) writeFileSync(join(root, MODELS_DIRECTORY, name), 'glTF');
  return root;
}

describe('the models a project ships with', () => {
  it('is what the folder holds, named by the files themselves', () => {
    const found = shippedModels(served('rot-hound.glb', 'bandit-cutter.glb'));
    // Sorted, so a build says the same thing twice.
    expect(found.map((model) => model.id)).toEqual(['bandit-cutter', 'rot-hound']);
    expect(found[0]).toEqual({ id: 'bandit-cutter', url: '/models/bandit-cutter.glb', scale: SHIPPED_SCALE });
  });

  it('takes glTF in either spelling, and nothing that is not a model', () => {
    const found = shippedModels(served('fen-lurker.glb', 'grave-moth.gltf', 'notes.md', 'sources.json'));
    expect(found.map((model) => model.id)).toEqual(['fen-lurker', 'grave-moth']);
  });

  it('tidies the name into the id content refers to, and serves the file it really is', () => {
    // The golem arrived as `stone_golem.glb` among nine hyphenated files; an id taken
    // verbatim would never have matched the `stone-golem` an adversary is drawn with.
    const found = shippedModels(served('stone_golem.glb', 'Fen Lurker.GLB'));
    expect(found.map((model) => model.id)).toEqual(['fen-lurker', 'stone-golem']);
    // The url is the name the file actually has, which is what the server answers to.
    expect(found.map((model) => model.url)).toEqual(['/models/Fen Lurker.GLB', '/models/stone_golem.glb']);
  });

  it('is no models at all where there is no folder, rather than a failure to start', () => {
    const root = mkdtempSync(join(tmpdir(), 'models-'));
    expect(shippedModels(root)).toEqual([]);
  });
});
