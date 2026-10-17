/**
 * Your models as the page talks to them (`your-models.ts`): which are laid under a project, and what
 * opening a project brings in on the fly - an embedded glTF the folder does not have, a model in
 * another player's folder - and what it leaves: the engine's, the player's own, one already there.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { modelAssetSchema } from '../engine/render/assets';
import { embeddedGlb, importCarriedModels, ownerOfModelUrl, yourModelsMissingFrom, type YourModel } from './your-models';

const GLB = Buffer.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 7]);
const glbUrl = (bytes: Buffer): string => `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
const model = (id: string, over: Partial<YourModel> = {}): YourModel => ({ id, file: `${id}.glb`, url: `/__models/u/bramble/imported/${id}.glb`, hash: 'x', added: 1, ...over });

describe('the models laid under a project', () => {
  it('are the player\u2019s the project has no model of that id for', () => {
    const laid = yourModelsMissingFrom([{ id: 'golem' }], [model('golem'), model('wolf')]);
    expect(laid).toEqual([modelAssetSchema.parse({ id: 'wolf', url: '/__models/u/bramble/imported/wolf.glb', scale: 1 })]);
  });

  it('know whose folder a url is in', () => {
    expect(ownerOfModelUrl('/__models/u/bramble/imported/wolf.glb')).toBe('bramble');
    expect(ownerOfModelUrl('/models/wolf.glb')).toBeNull();
  });
});

describe('a project\u2019s models, brought in as it opens', () => {
  it('are each embedded glTF the folder does not have, and each in another player\u2019s folder', async () => {
    const known = Buffer.from([...GLB.subarray(0, 8), 9]);
    const mine = [model('kept', { hash: createHash('sha256').update(known).digest('hex') })];
    const sent: unknown[] = [];
    const send = async (url: string, init?: RequestInit) => {
      if (url === '/__models/mine') return { ok: true, status: 200, json: async () => mine };
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push(body);
      return { ok: true, status: 200, json: async () => ({ model: model(String(body['name'] ?? 'theirs'), { hash: String(sent.length) }) }) };
    };
    const assets = [
      { id: 'new', url: glbUrl(GLB) },
      { id: 'kept', url: glbUrl(known) },
      { id: 'text', url: 'data:model/gltf+json;base64,e30=' },
      { id: 'theirs', url: '/__models/u/violet/imported/theirs.glb' },
      { id: 'mine', url: '/__models/u/bramble/imported/mine.glb' },
      { id: 'shipped', url: '/models/shipped.glb' },
    ].map((asset) => modelAssetSchema.parse(asset));
    expect(await importCarriedModels(assets, 'bramble', send)).toEqual(['new', 'theirs']);
    expect(sent).toEqual([{ name: 'new.glb', data: glbUrl(GLB) }, { url: '/__models/u/violet/imported/theirs.glb' }]);
  });

  it('are nothing without a folder: nobody signed in, or no accounts on the server', async () => {
    const send = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await importCarriedModels([modelAssetSchema.parse({ id: 'new', url: glbUrl(GLB) })], 'bramble', send)).toEqual([]);
  });

  it('read an embedded file only when it is a binary glTF', () => {
    expect([...embeddedGlb(glbUrl(GLB))!]).toEqual([...GLB]);
    expect(embeddedGlb('data:model/gltf+json;base64,e30=')).toBeNull();
    expect(embeddedGlb('/models/x.glb')).toBeNull();
  });
});
