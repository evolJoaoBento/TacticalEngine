import { describe, it, expect } from 'vitest';
import { Box3, BoxGeometry, Group, Mesh } from 'three';
import { AssetLibrary, modelAssetSchema, seatOnTile } from './assets';

/**
 * The asset library, driven with a fake loader.
 *
 * What matters: nothing loads that nothing asks for, a template shows up once
 * and only for the spec that asked, a failure is reported rather than thrown,
 * and a spec replaced mid-flight does not receive the old file.
 */

/** A loader whose promises the test settles by hand. */
function controllable() {
  const pending = new Map<string, { resolve: (o: Group) => void; reject: (e: Error) => void }>();
  const load = (url: string): Promise<Group> =>
    new Promise((resolve, reject) => void pending.set(url, { resolve, reject }));
  return { load, pending };
}

const duck = () =>
  modelAssetSchema.parse({ id: 'duck', url: '/models/duck.glb', scale: 0.01, groundOffset: 0 });

describe('the schema', () => {
  it('defaults what a designer would leave out', () => {
    expect(duck()).toEqual({ id: 'duck', kind: 'gltf', url: '/models/duck.glb', scale: 0.01, groundOffset: 0, rotationY: 0, offsetX: 0, offsetY: 0 });
  });

  it('refuses a scale of nothing', () => {
    expect(() => modelAssetSchema.parse({ id: 'x', url: 'x.glb', scale: 0 })).toThrow();
  });
});

describe('how the loading stands', () => {
  it('counts what is on its way and what has finished, and nothing that was never asked for', async () => {
    const { load, pending } = controllable();
    const goose = { ...duck(), id: 'goose', url: '/models/goose.glb' };
    const swan = { ...duck(), id: 'swan', url: '/models/swan.glb' };
    const library = new AssetLibrary(load, [duck(), goose, swan]);
    expect(library.progress()).toEqual({ loading: 0, settled: 0 });

    library.request('duck');
    library.request('goose');
    expect(library.progress()).toEqual({ loading: 2, settled: 0 });

    pending.get('/models/duck.glb')!.resolve(new Group());
    await Promise.resolve();
    await Promise.resolve();
    expect(library.progress()).toEqual({ loading: 1, settled: 1 });

    // A file that is not coming is finished too: nothing should sit waiting for it.
    pending.get('/models/goose.glb')!.reject(new Error('404'));
    await Promise.resolve();
    await Promise.resolve();
    expect(library.progress()).toEqual({ loading: 0, settled: 2 });
    expect(library.statusOf('swan')).toBe('unknown');
  });
});

describe('retuning', () => {
  it('keeps the file that is already here when only the settings change', async () => {
    const { load, pending } = controllable();
    const library = new AssetLibrary(load, [duck()]);
    library.request('duck');
    const scene = new Group();
    pending.get('/models/duck.glb')!.resolve(scene);
    await Promise.resolve();
    await Promise.resolve();
    expect(library.statusOf('duck')).toBe('ready');

    const changed: string[] = [];
    library.onChange((id) => changed.push(id));
    library.retune({ ...duck(), scale: 2, clips: { idle: 'Survey' } });

    // The settings moved and everything using it is told, but the file did not
    // have to come down again — which is what `add` would have cost.
    expect(library.spec('duck')!.scale).toBe(2);
    expect(library.spec('duck')!.clips).toEqual({ idle: 'Survey' });
    expect(library.statusOf('duck')).toBe('ready');
    expect(library.template('duck')).toBe(scene);
    expect(changed).toEqual(['duck']);
  });

  it('will not invent a model it was never given', () => {
    const { load } = controllable();
    const library = new AssetLibrary(load, []);
    library.retune({ ...duck(), id: 'nobody' });
    expect(library.has('nobody')).toBe(false);
  });

  it('still reloads when the file itself is replaced', async () => {
    const { load, pending } = controllable();
    const library = new AssetLibrary(load, [duck()]);
    library.request('duck');
    pending.get('/models/duck.glb')!.resolve(new Group());
    await Promise.resolve();
    await Promise.resolve();

    library.retune({ ...duck(), url: '/models/other.glb' });
    expect(library.statusOf('duck')).toBe('unknown');
    expect(library.template('duck')).toBeUndefined();
  });
});

describe('loading', () => {
  it('loads only what is asked for, once', async () => {
    const { load, pending } = controllable();
    const library = new AssetLibrary(load, [duck()]);
    expect(library.statusOf('duck')).toBe('unknown');
    expect(pending.size).toBe(0);

    expect(library.request('duck')).toBe(true);
    expect(library.request('duck')).toBe(false);
    expect(library.statusOf('duck')).toBe('loading');
    expect(pending.size).toBe(1);

    const changed: string[] = [];
    library.onChange((id) => changed.push(id));
    const scene = new Group();
    scene.add(new Mesh());
    pending.get('/models/duck.glb')!.resolve(scene);
    await Promise.resolve();
    await Promise.resolve();

    expect(library.statusOf('duck')).toBe('ready');
    expect(library.template('duck')).toBe(scene);
    expect(changed).toEqual(['duck']);
    expect(library.request('duck')).toBe(false);
  });

  it('ignores an id nobody declared', () => {
    const { load } = controllable();
    const library = new AssetLibrary(load);
    expect(library.request('ghost')).toBe(false);
    expect(library.template('ghost')).toBeUndefined();
  });

  it('reports a failure instead of throwing, and can try again', async () => {
    const { load, pending } = controllable();
    const library = new AssetLibrary(load, [duck()]);
    const changed: string[] = [];
    library.onChange((id) => changed.push(id));
    library.request('duck');
    pending.get('/models/duck.glb')!.reject(new Error('404'));
    await Promise.resolve();
    await Promise.resolve();
    expect(library.statusOf('duck')).toBe('failed');
    expect(library.errorOf('duck')).toBe('404');
    expect(changed).toEqual(['duck']);
    // A failed asset may be asked for again.
    expect(library.request('duck')).toBe(true);
  });

  it('drops a file that arrives for a spec since replaced', async () => {
    const { load, pending } = controllable();
    const library = new AssetLibrary(load, [duck()]);
    library.request('duck');
    const stale = pending.get('/models/duck.glb')!;
    library.add({ ...duck(), url: '/models/duck-v2.glb' });
    stale.resolve(new Group());
    await Promise.resolve();
    await Promise.resolve();
    expect(library.statusOf('duck')).toBe('unknown');
    expect(library.template('duck')).toBeUndefined();
  });

  it('can be told to fetch everything', () => {
    const { load, pending } = controllable();
    const library = new AssetLibrary(load, [duck(), { ...duck(), id: 'fox', url: '/models/fox.glb' }]);
    library.requestAll();
    expect(pending.size).toBe(2);
  });

  it('stops listening when asked', async () => {
    const { load, pending } = controllable();
    const library = new AssetLibrary(load, [duck()]);
    const changed: string[] = [];
    const stop = library.onChange((id) => changed.push(id));
    stop();
    library.request('duck');
    pending.get('/models/duck.glb')!.resolve(new Group());
    await Promise.resolve();
    await Promise.resolve();
    expect(changed).toEqual([]);
  });
});

describe('seating a model on its tile', () => {
  /** A 2x2x2 box modelled a long way from its file's origin, as an exported file often is. */
  const offCentre = (scale: number): Group => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    mesh.position.set(3, 5, -2);
    const model = new Group();
    model.add(mesh);
    model.scale.setScalar(scale);
    return model;
  };

  it('centres what arrived and stands it on the ground, wherever it was modelled', () => {
    const model = offCentre(1);
    seatOnTile(model);
    // The box spans x 2..4, y 4..6, z -3..-1, so its middle goes to the tile and its feet to zero.
    expect(model.position.x).toBeCloseTo(-3, 10);
    expect(model.position.y).toBeCloseTo(-4, 10);
    expect(model.position.z).toBeCloseTo(2, 10);
  });

  it('grows where it stands: twice the size is the same spot, not twice as far off it', () => {
    const stood = (scale: number) => {
      const model = offCentre(scale);
      seatOnTile(model);
      const box = new Box3().setFromObject(model);
      return { middleX: (box.min.x + box.max.x) / 2, middleZ: (box.min.z + box.max.z) / 2, feet: box.min.y, height: box.max.y - box.min.y };
    };
    const small = stood(1);
    const big = stood(2);
    for (const one of [small, big]) {
      expect(one.middleX).toBeCloseTo(0, 10);
      expect(one.middleZ).toBeCloseTo(0, 10);
      expect(one.feet).toBeCloseTo(0, 10);
    }
    // Bigger, and still standing on the tile rather than sunk through it.
    expect(big.height).toBeCloseTo(small.height * 2, 10);
  });

  it('centres on the base it stands on, not on the middle of a body that leans over it', () => {
    // A figure whose feet are a small pad and whose body hangs well off to one side: the pad goes
    // over the tile, and the body leans off it, which is how a leaning figure reads on a board.
    const feet = new Mesh(new BoxGeometry(0.6, 0.1, 0.6));
    feet.position.set(0, 0.05, 0);
    const body = new Mesh(new BoxGeometry(1, 1.4, 1));
    body.position.set(1.2, 1, 0); // clear of the floor, so the base is the pad and nothing else
    const model = new Group();
    model.add(feet, body);
    seatOnTile(model);
    const box = new Box3().setFromObject(model);
    // The feet are centred on the tile; the middle of the whole thing is not.
    expect(model.position.x).toBeCloseTo(0, 10);
    expect(box.min.y).toBeCloseTo(0, 10);
    expect((box.min.x + box.max.x) / 2).toBeGreaterThan(0.3);
  });

  it('leaves a model with nothing to measure where it is', () => {
    const empty = new Group();
    seatOnTile(empty);
    expect(empty.position.toArray()).toEqual([0, 0, 0]);
  });
});
