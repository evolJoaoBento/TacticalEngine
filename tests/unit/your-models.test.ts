import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileOfUrl, freeModelId, hashOf, importModel, judgeImport, modelsFolder, readYourModels, tidyId, type YourModel } from '../../tools/your-models';

/**
 * Your models (`tools/your-models.ts`): a player's own folder of `.glb` files, each known by its bytes
 * so the same file is kept once, under an id tidied from its name and never one the folder has given
 * to a different file; only binary glTF; and a served url that names nothing outside a player's folder.
 */

const GLB = (n: number): Uint8Array => new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, n]);

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'your-models-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('a model in your folder', () => {
  it('is kept once however often it comes, and is a listing\u2019s once it is got from one', () => {
    withRoot((root) => {
      const first = importModel(root, 'bramble', 'Stone Golem.glb', GLB(1));
      expect(first).toMatchObject({ ok: true, fresh: true, model: { id: 'stone-golem', file: 'stone-golem.glb', url: '/__models/u/bramble/imported/stone-golem.glb', hash: hashOf(GLB(1)) } });
      expect(existsSync(join(root, modelsFolder('bramble'), 'stone-golem.glb'))).toBe(true);
      const again = importModel(root, 'bramble', 'another-name.glb', GLB(1), { listing: '0123456789abcdef' });
      expect(again).toMatchObject({ ok: true, fresh: false, model: { id: 'stone-golem', listing: '0123456789abcdef' } });
      expect(readYourModels(root, 'bramble')).toHaveLength(1);
      expect(readYourModels(root, 'bramble')[0]!.listing).toBe('0123456789abcdef');
    });
  });

  it('never takes an id the folder gave a different file', () => {
    withRoot((root) => {
      importModel(root, 'bramble', 'golem.glb', GLB(1));
      const other = importModel(root, 'bramble', 'golem.glb', GLB(2));
      expect(other).toMatchObject({ ok: true, fresh: true, model: { id: 'golem-2', file: 'golem-2.glb' } });
      expect([...readFileSync(join(root, modelsFolder('bramble'), 'golem.glb'))]).toEqual([...GLB(1)]);
      // Another player's folder is their own.
      expect(importModel(root, 'violet', 'golem.glb', GLB(2))).toMatchObject({ ok: true, model: { id: 'golem' } });
    });
  });

  it('is a binary glTF, for an account there can be', () => {
    withRoot((root) => {
      expect(importModel(root, 'bramble', 'a.glb', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatchObject({ ok: false });
      expect(importModel(root, '../etc', 'a.glb', GLB(1))).toMatchObject({ ok: false });
      expect(readYourModels(root, 'bramble')).toEqual([]);
    });
  });
});

describe('the names', () => {
  it('tidies a file\u2019s name as the engine does', () => {
    expect(tidyId('Stone_Golem.glb')).toBe('stone-golem');
    expect(tidyId('--.glb')).toBe('model');
  });

  it('counts on from a taken id', () => {
    const taken = [{ id: 'golem' }, { id: 'golem-2' }] as YourModel[];
    expect(freeModelId('golem', taken)).toBe('golem-3');
    expect(freeModelId('wolf', taken)).toBe('wolf');
  });

  it('reads a served url only as a file in a player\u2019s folder', () => {
    expect(fileOfUrl('/__models/u/bramble/imported/golem.glb')).toEqual({ account: 'bramble', file: 'golem.glb' });
    expect(fileOfUrl('/__models/u/bramble/imported/../../accounts.json')).toBeNull();
    expect(fileOfUrl('/__models/u/../imported/golem.glb')).toBeNull();
    expect(fileOfUrl('/__models/u/bramble/imported/golem.gltf')).toBeNull();
    expect(fileOfUrl('/models/golem.glb')).toBeNull();
  });
});

describe('an import', () => {
  it('is a file as a data URL or base64, or a url in a player\u2019s folder', () => {
    const data = `data:model/gltf-binary;base64,${Buffer.from(GLB(1)).toString('base64')}`;
    const file = judgeImport(JSON.stringify({ name: 'g.glb', data }));
    expect(file.ok && 'bytes' in file && [...file.bytes]).toEqual([...GLB(1)]);
    expect(judgeImport(JSON.stringify({ url: '/__models/u/violet/imported/wolf.glb' }))).toEqual({ ok: true, url: { account: 'violet', file: 'wolf.glb' } });
    expect(judgeImport(JSON.stringify({ url: '/etc/passwd' }))).toMatchObject({ ok: false });
    expect(judgeImport(JSON.stringify({ name: 'g.glb' }))).toMatchObject({ ok: false });
    expect(judgeImport('not json')).toMatchObject({ ok: false });
  });
});
