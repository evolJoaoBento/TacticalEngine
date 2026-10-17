/**
 * Models given ancestries for every project (`model-ancestries.ts`, `character-models.ts`, and the
 * file `projects/model-ancestries.json` the dev server keeps them in): what the editor sends, what the
 * page then knows, and what New Game offers each ancestry.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addEngineModel, assignedAncestry, isShippedModel, setModelAncestry } from './model-ancestries';
import { ancestryOfModel, modelsForAncestry } from './character-models';
import { CAMP_CREW } from './camp';
import { shippedPack } from './listed-packs';

describe('a model given an ancestry in the editor', () => {
  it('is sent to the server as the page itself, and known to the page once it is kept', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const refused = await setModelAncestry('quim', 'dwarf', async (url, init) => {
      sent.push({ url, init });
      return { ok: true, text: async () => '{}' };
    });
    expect(refused).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.init.method).toBe('POST');
    expect((sent[0]!.init.headers as Record<string, string>)['x-tactical-save']).toBe('1');
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({ model: 'quim', ancestry: 'dwarf' });
    expect(assignedAncestry('quim')).toBe('dwarf');
    expect(await setModelAncestry('quim', null, async () => ({ ok: true, text: async () => '{}' }))).toBeNull();
    expect(assignedAncestry('quim')).toBeUndefined();
  });

  it('says why when it was not kept, and the page goes on knowing what it knew', async () => {
    const refused = await setModelAncestry('violet', 'elf', async () => ({ ok: false, text: async () => 'this server does not keep models’ ancestries' }));
    expect(refused).toContain('does not keep');
    expect(assignedAncestry('violet')).toBeUndefined();
    expect(await setModelAncestry('violet', 'elf', async () => { throw new Error('offline'); })).toBe('the server could not be reached');
  });
});

describe('a model added to the engine from the editor', () => {
  it('is sent as the page itself, named, and is one of the engine’s own from then on', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer;
    const added = await addEngineModel('Stone Golem.glb', bytes, async (url, init) => {
      sent.push({ url, init });
      return { ok: true, text: async () => JSON.stringify({ id: 'stone-golem', url: '/models/stone-golem.glb' }) };
    });
    expect(added).toEqual({ id: 'stone-golem', url: '/models/stone-golem.glb' });
    expect(sent[0]!.url).toBe('/__models/add?name=Stone%20Golem.glb');
    expect(sent[0]!.init.body).toBe(bytes);
    expect((sent[0]!.init.headers as Record<string, string>)['x-tactical-save']).toBe('1');
    expect(isShippedModel('stone-golem')).toBe(true);
  });

  it('says why when it was not added, and is not the engine’s', async () => {
    const refused = await addEngineModel('quim.glb', new ArrayBuffer(4), async () => ({ ok: false, text: async () => 'the engine already has a model called quim' }));
    expect(refused).toEqual({ refused: 'the engine already has a model called quim' });
    expect(await addEngineModel('x.glb', new ArrayBuffer(4), async () => { throw new Error('offline'); })).toEqual({ refused: 'the server could not be reached' });
    expect(isShippedModel('x')).toBe(false);
  });
});

describe('the models New Game offers an ancestry', () => {
  it('are the ones given it, over the ones named for it', () => {
    const shipped = [...CAMP_CREW.map((id) => ({ id })), { id: 'elf-ranger' }, { id: 'elf-archer', ancestry: 'faerie' }, { id: 'quim', ancestry: 'dwarf' }];
    // Given one: the company's Quim, given to the dwarves, is theirs now.
    expect(modelsForAncestry('dwarf', shipped)).toEqual(['quim']);
    // Named for the elves but given to the faeries: the faeries'.
    expect(modelsForAncestry('elf', shipped)).toEqual(['elf-ranger']);
    expect(modelsForAncestry('faerie', shipped)).toEqual(['elf-archer']);
    // Nobody's: the company.
    expect(modelsForAncestry('orc', shipped)).toEqual([...CAMP_CREW]);
  });

  it('are named for the longest ancestry that fits, when none was given', () => {
    expect(ancestryOfModel({ id: 'wood-elf-2' }, ['elf', 'wood-elf'])).toBe('wood-elf');
    expect(ancestryOfModel({ id: 'wood-elf-2', ancestry: 'orc' }, ['elf', 'wood-elf'])).toBe('orc');
    expect(ancestryOfModel({ id: 'quim' }, ['elf'])).toBeUndefined();
  });
});

describe('the ancestries kept for every project', () => {
  it('name models the build ships and ancestries the character pack has', () => {
    const kept = JSON.parse(readFileSync('projects/model-ancestries.json', 'utf8')) as Record<string, string>;
    const lock = JSON.parse(readFileSync('models.lock.json', 'utf8')) as { files: { path: string }[] };
    const models = new Set(lock.files.map((file) => file.path.replace(/\.(glb|gltf)$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')));
    const ancestries = new Set(shippedPack('srd-characters')!.ancestries.map((entry) => entry.id));
    expect(Object.keys(kept).length).toBeGreaterThan(0);
    for (const [model, ancestry] of Object.entries(kept)) {
      expect(models.has(model), model).toBe(true);
      expect(ancestries.has(ancestry), ancestry).toBe(true);
    }
  });
});
