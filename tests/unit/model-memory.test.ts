import { describe, expect, it } from 'vitest';
import { NO_STORE, missingFrom, type ModelStore } from '../../src/editor/model-memory';
import { modelAssetSchema, type ModelAsset } from '../../src/engine/render/assets';

/**
 * What a browser remembers of the models imported into it.
 *
 * The file itself rides inside the project document, so what is kept here is the
 * declaration — and the rule that matters is whose declaration wins when both a
 * project and the browser have one: the project's, every time. The store is a
 * Map here and IndexedDB in the app.
 */

const asset = (id: string, extra: Record<string, unknown> = {}): ModelAsset =>
  modelAssetSchema.parse({ id, url: `data:model/gltf-binary;base64,${id}`, scale: 1, ...extra });

/** The store as a Map, with the same shape the browser's has. */
function remembering(rows: unknown[] = []): ModelStore & { rows: unknown[] } {
  // Keyed by id where there is one: a row left by an older build may be anything
  // at all, and the store still holds it until something tries to read it back.
  const kept = new Map<string, unknown>(
    rows.map((row, i) => [
      typeof row === 'object' && row !== null && 'id' in row ? String((row as { id: unknown }).id) : `row-${i}`,
      row,
    ]),
  );
  return {
    get rows() {
      return [...kept.values()];
    },
    all: () => Promise.resolve([...kept.values()]),
    put: (one) => {
      kept.set(one.id, one);
      return Promise.resolve();
    },
    forget: (id) => {
      kept.delete(id);
      return Promise.resolve();
    },
  };
}

describe('what comes back', () => {
  it('gives a project the models it is missing, settings and file and all', async () => {
    const store = remembering();
    await store.put(asset('fox', { scale: 0.012, groundOffset: 0.2 }));
    await store.put(asset('cube'));

    const missing = missingFrom([], await store.all());
    expect(missing.map((one) => one.id)).toEqual(['fox', 'cube']);
    expect(missing[0]!.scale).toBe(0.012);
    expect(missing[0]!.groundOffset).toBe(0.2);
    expect(missing[0]!.url.startsWith('data:')).toBe(true);
  });

  it('never reaches over a project that has its own: the document wins the id', async () => {
    const store = remembering();
    await store.put(asset('fox', { scale: 99 }));
    const declared = [asset('fox', { scale: 0.012 })];

    expect(missingFrom(declared, await store.all())).toEqual([]);
    // And the project's own settings are untouched by what was remembered.
    expect(declared[0]!.scale).toBe(0.012);
  });

  it('forgets what was removed, so a deleted model stays deleted', async () => {
    const store = remembering();
    await store.put(asset('fox'));
    await store.put(asset('cube'));
    await store.forget('fox');

    expect(missingFrom([], await store.all()).map((one) => one.id)).toEqual(['cube']);
  });

  it('skips a row it cannot read rather than refusing to open the editor', async () => {
    const store = remembering([{ id: 'ancient' }, null, 'nonsense']);
    await store.put(asset('cube'));

    expect(missingFrom([], await store.all()).map((one) => one.id)).toEqual(['cube']);
  });

  it('keeps nothing, quietly, where there is nowhere to keep it', async () => {
    await NO_STORE.put(asset('fox'));
    await NO_STORE.forget('fox');
    expect(await NO_STORE.all()).toEqual([]);
    expect(missingFrom([], await NO_STORE.all())).toEqual([]);
  });
});
