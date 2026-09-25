import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * The models live on Hugging Face and are fetched with `npm run models`; git carries only the list
 * of them. A model committed again is in every clone for good, and only a history rewrite - the one
 * that took them out - takes it back.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lock = JSON.parse(readFileSync(join(root, 'models.lock.json'), 'utf8')) as {
  repo: string;
  repoType: string;
  revision: string;
  files: { path: string; bytes: number; sha256: string }[];
};

describe('the models', () => {
  it('are named by a list that pins one revision and every file by size and hash', () => {
    expect(lock.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(['model', 'dataset']).toContain(lock.repoType);
    // A branch name would let the files change under a clone that never asked for it.
    expect(lock.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.files.length).toBeGreaterThan(10);
    for (const file of lock.files) {
      expect(file.path, file.path).toMatch(/^[^/\\]+\.(glb|gltf)$/);
      expect(file.bytes, file.path).toBeGreaterThan(0);
      expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(lock.files.map((file) => file.path)).size).toBe(lock.files.length);
  });

  it('lists every model the game ships with by name, so a demo built from code finds its props', () => {
    const listed = new Set(lock.files.map((file) => file.path.replace(/\.(glb|gltf)$/i, '')));
    for (const id of ['tree-prop', 'dirt-ground', 'grass-ground', 'grass-dirt-ground', 'portal-prop', 'door-prop', 'chest-prop', 'stone-block', 'stone-wall', 'Quim']) {
      expect(listed.has(id), id).toBe(true);
    }
  });

  it('are not in git: the folder is ignored, and nothing in it is tracked', () => {
    const ignored = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((line) => line.trim());
    expect(ignored, '.gitignore must ignore "public/models/*.glb" - restore the rule rather than deleting this test').toContain('public/models/*.glb');
    const tracked = execFileSync('git', ['ls-files', 'public/models'], { cwd: root, encoding: 'utf8' }).split('\n').filter((line) => /\.(glb|gltf)$/i.test(line));
    expect(tracked, 'a model is tracked by git again; it belongs on Hugging Face (see models.lock.json)').toEqual([]);
  });
});

describe('the equipment cards\u2019 pictures', () => {
  const pictures = JSON.parse(readFileSync(join(root, 'equipment.lock.json'), 'utf8')) as typeof lock;
  const catalogue = JSON.parse(readFileSync(join(root, 'src/engine/content/equipment/catalogue.json'), 'utf8')) as { items: { id: string; card?: string }[] };

  it('are named the way the models are, from the same repo, one revision, every file by size and hash', () => {
    expect(pictures.repo).toBe(lock.repo);
    expect(pictures.revision).toMatch(/^[0-9a-f]{40}$/);
    for (const file of pictures.files) {
      expect(file.path, file.path).toMatch(/^equipment\/[\w-]+\.webp$/);
      expect(file.bytes, file.path).toBeGreaterThan(0);
      expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('cover every card the catalogue draws with a picture', () => {
    const listed = new Set(pictures.files.map((file) => file.path));
    const missing = catalogue.items.filter((item) => item.card !== undefined && !listed.has(`equipment/${item.card}`)).map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it('are not in git: the folder is ignored, and nothing in it is tracked', () => {
    const ignored = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((line) => line.trim());
    expect(ignored, '.gitignore must ignore "public/equipment/*.webp" - restore the rule rather than deleting this test').toContain('public/equipment/*.webp');
    const tracked = execFileSync('git', ['ls-files', 'public/equipment'], { cwd: root, encoding: 'utf8' }).split('\n').filter((line) => line !== '');
    expect(tracked, 'a card picture is tracked by git; it belongs on Hugging Face (see equipment.lock.json)').toEqual([]);
  });
});
