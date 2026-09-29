import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANCESTRY_FILE, MODELS_DIRECTORY, MODEL_ADD_LIMIT, SHIPPED_SCALE, assignAncestry, judgeAncestry, judgeModelAdd, modelIdOf, readModelAncestries, shippedModels, writeModelAncestries } from '../../tools/model-manifest';

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

describe('the ancestry each model draws', () => {
  const page = { method: 'POST', headers: { 'x-tactical-save': '1', origin: 'http://127.0.0.1:8420', host: '127.0.0.1:8420' } };

  it('is served with the list, for the models given one', () => {
    const found = shippedModels(served('faun-male.glb', 'quim.glb'), { quim: 'dwarf' });
    expect(found.find((model) => model.id === 'quim')?.ancestry).toBe('dwarf');
    expect(found.find((model) => model.id === 'faun-male')).not.toHaveProperty('ancestry');
  });

  it('is kept in a file of its own, written whole, read back, and missing is none', () => {
    const root = mkdtempSync(join(tmpdir(), 'ancestries-'));
    expect(readModelAncestries(root)).toEqual({});
    const map = assignAncestry(assignAncestry({}, 'quim', 'dwarf'), 'faun-male', 'faun');
    writeModelAncestries(root, map);
    expect(readModelAncestries(root)).toEqual({ 'faun-male': 'faun', quim: 'dwarf' });
    // In order, so the file diffs cleanly; and taken away again.
    expect(Object.keys(map)).toEqual(['faun-male', 'quim']);
    expect(assignAncestry(map, 'quim', null)).toEqual({ 'faun-male': 'faun' });
    // Anything that is not an id given an id is left out, and junk is none.
    writeFileSync(join(root, ANCESTRY_FILE), JSON.stringify({ quim: 'dwarf', '../x': 'elf', violet: 3 }));
    expect(readModelAncestries(root)).toEqual({ quim: 'dwarf' });
    writeFileSync(join(root, ANCESTRY_FILE), 'not json');
    expect(readModelAncestries(root)).toEqual({});
  });

  it('is changed only by the page itself, and only to an id or nothing', () => {
    expect(judgeAncestry(page, JSON.stringify({ model: 'quim', ancestry: 'dwarf' }))).toEqual({ ok: true, model: 'quim', ancestry: 'dwarf' });
    expect(judgeAncestry(page, JSON.stringify({ model: 'quim', ancestry: null }))).toEqual({ ok: true, model: 'quim', ancestry: null });
    expect(judgeAncestry({ ...page, method: 'GET' }, '{}')).toMatchObject({ ok: false, status: 405 });
    expect(judgeAncestry({ ...page, headers: { ...page.headers, 'x-tactical-save': undefined } }, '{}')).toMatchObject({ ok: false, status: 403 });
    expect(judgeAncestry({ ...page, headers: { ...page.headers, origin: 'https://elsewhere.example' } }, '{}')).toMatchObject({ ok: false, status: 403 });
    expect(judgeAncestry(page, 'not json')).toMatchObject({ ok: false, status: 400 });
    expect(judgeAncestry(page, JSON.stringify({ model: '../../etc', ancestry: 'dwarf' }))).toMatchObject({ ok: false, status: 422 });
    expect(judgeAncestry(page, JSON.stringify({ model: 'quim', ancestry: 'Dwarf!' }))).toMatchObject({ ok: false, status: 422 });
    expect(judgeAncestry(page, JSON.stringify({ model: 'quim', ancestry: 'x'.repeat(5000) }))).toMatchObject({ ok: false, status: 413 });
  });
});

describe('a model added to the engine from the editor', () => {
  const page = { method: 'POST', headers: { 'x-tactical-save': '1', origin: 'http://127.0.0.1:8420', host: '127.0.0.1:8420' } };
  const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  const none = (): boolean => false;

  it('is written under its file name made an id, as the folder names every model', () => {
    expect(modelIdOf('Stone Golem.glb')).toBe('stone-golem');
    expect(judgeModelAdd(page, 'Stone Golem.glb', glb, none)).toEqual({ ok: true, id: 'stone-golem', file: 'stone-golem.glb' });
  });

  it('is a binary glTF, and nothing else', () => {
    expect(judgeModelAdd(page, 'golem.gltf', glb, none)).toMatchObject({ ok: false, status: 422 });
    expect(judgeModelAdd(page, 'golem.glb', new Uint8Array([1, 2, 3, 4]), none)).toMatchObject({ ok: false, status: 422 });
    expect(judgeModelAdd(page, null, glb, none)).toMatchObject({ ok: false, status: 422 });
    expect(judgeModelAdd(page, '....glb', glb, none)).toMatchObject({ ok: false, status: 422 });
  });

  it('never takes the place of a model the engine already has - by id, whatever the case of the file', () => {
    expect(judgeModelAdd(page, 'Quim.glb', glb, (id) => id === 'quim')).toMatchObject({ ok: false, status: 409 });
  });

  it('is sent by the page itself, and is no bigger than a model should be', () => {
    expect(judgeModelAdd({ ...page, method: 'PUT' }, 'golem.glb', glb, none)).toMatchObject({ ok: false, status: 405 });
    expect(judgeModelAdd({ ...page, headers: { ...page.headers, 'x-tactical-save': undefined } }, 'golem.glb', glb, none)).toMatchObject({ ok: false, status: 403 });
    expect(judgeModelAdd({ ...page, headers: { ...page.headers, origin: 'https://elsewhere.example' } }, 'golem.glb', glb, none)).toMatchObject({ ok: false, status: 403 });
    const heavy = new Uint8Array(MODEL_ADD_LIMIT + 1);
    heavy.set(glb);
    expect(judgeModelAdd(page, 'golem.glb', heavy, none)).toMatchObject({ ok: false, status: 413 });
  });
});

