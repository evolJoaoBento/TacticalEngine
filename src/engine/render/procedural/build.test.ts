import { describe, it, expect } from 'vitest';
import { Box3, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import {
  MaterialLibrary,
  ModelResources,
  PrimitiveCache,
  buildModel,
  setSpiritEyes,
  type BuiltModel,
} from './build';
import { ModelRegistry, MODELS, placeholder } from './registry';
import { matKey, primKey, type ProceduralModelSpec } from './spec';

const tiny: ProceduralModelSpec = {
  id: 'tiny',
  category: 'prop',
  standHeight: 0.5,
  palette: { a: { color: '#ff0000' }, b: { color: '#00ff00' } },
  parts: [
    { prim: { kind: 'box', w: 1, h: 1, d: 1 }, mat: 'a', pos: [0, 0.5, 0] },
    { prim: { kind: 'box', w: 1, h: 1, d: 1 }, mat: 'a', pos: [1, 0.5, 0], name: 'twin' },
    { prim: { kind: 'sphere', r: 0.2, wSeg: 6, hSeg: 6 }, mat: 'b', pos: [0, 1.2, 0] },
  ],
  hooks: { 'hand.R': { pos: [0.5, 0.8, 0] } },
};

describe('cache keys', () => {
  it('give identical primitives the same key and different ones different keys', () => {
    expect(primKey({ kind: 'box', w: 1, h: 2, d: 3 })).toBe(primKey({ kind: 'box', w: 1, h: 2, d: 3 }));
    expect(primKey({ kind: 'box', w: 1, h: 2, d: 3 })).not.toBe(primKey({ kind: 'box', w: 1, h: 2, d: 4 }));
    expect(primKey({ kind: 'sphere', r: 1, wSeg: 6, hSeg: 6 })).not.toBe(
      primKey({ kind: 'icosahedron', r: 1 }),
    );
  });

  it('treat a defaulted property as equal to the default written out', () => {
    expect(matKey({ color: '#fff' })).toBe(
      matKey({ color: '#fff', metalness: 0, roughness: 1, opacity: 1 }),
    );
    expect(matKey({ color: '#fff' })).not.toBe(matKey({ color: '#fff', metalness: 0.5 }));
  });
});

describe('PrimitiveCache', () => {
  it('returns one geometry per distinct shape', () => {
    const cache = new PrimitiveCache();
    const a = cache.get({ kind: 'box', w: 1, h: 1, d: 1 });
    const b = cache.get({ kind: 'box', w: 1, h: 1, d: 1 });
    const c = cache.get({ kind: 'box', w: 2, h: 1, d: 1 });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(cache.size).toBe(2);
    cache.dispose();
    expect(cache.size).toBe(0);
  });

  it('builds every primitive kind', () => {
    const cache = new PrimitiveCache();
    const prims = [
      { kind: 'box', w: 1, h: 1, d: 1 },
      { kind: 'cylinder', rTop: 1, rBottom: 1, h: 1, seg: 6 },
      { kind: 'cone', r: 1, h: 1, seg: 5 },
      { kind: 'sphere', r: 1, wSeg: 6, hSeg: 6 },
      { kind: 'icosahedron', r: 1 },
      { kind: 'octahedron', r: 1 },
      { kind: 'tetrahedron', r: 1 },
      { kind: 'torus', r: 1, tube: 0.1, radSeg: 5, tubSeg: 8 },
    ] as const;
    for (const prim of prims) {
      const geometry = cache.get(prim);
      expect(geometry.getAttribute('position').count).toBeGreaterThan(2);
    }
    expect(cache.size).toBe(prims.length);
    cache.dispose();
  });
});

describe('MaterialLibrary', () => {
  it('shares a material between identical specs', () => {
    const library = new MaterialLibrary();
    const a = library.get({ color: '#abcdef' });
    expect(library.get({ color: '#abcdef' })).toBe(a);
    expect(library.get({ color: '#fedcba' })).not.toBe(a);
    expect(library.size).toBe(2);
    library.dispose();
  });

  it('builds an unlit material for fx parts and a faceted lit one otherwise', () => {
    const library = new MaterialLibrary();
    expect(library.get({ color: '#fff', unlit: true })).toBeInstanceOf(MeshBasicMaterial);
    const lit = library.get({ color: '#fff' });
    expect(lit).toBeInstanceOf(MeshStandardMaterial);
    // Faceted as the legacy library was, which is what makes a ported model read the same.
    expect((lit as MeshStandardMaterial).flatShading).toBe(true);
    library.dispose();
  });

  it('carries emissive, opacity and the surface a spec asks for', () => {
    const library = new MaterialLibrary();
    const m = library.get({
      color: '#112233',
      emissive: '#445566',
      emissiveIntensity: 1.4,
      metalness: 0.5,
      opacity: 0.5,
    }) as MeshStandardMaterial;
    expect(m.emissiveIntensity).toBe(1.4);
    expect(m.opacity).toBe(0.5);
    expect(m.transparent).toBe(true);
    // The ramp used to swallow these; a lit material spends them.
    expect(m.metalness).toBe(0.5);
    library.dispose();
  });
});

describe('buildModel', () => {
  it('builds one mesh per part, at its declared transform', () => {
    const resources = new ModelResources();
    const model = buildModel(tiny, resources);
    const meshes = model.group.children.filter((c) => c instanceof Mesh);
    expect(meshes).toHaveLength(3);
    expect(meshes[1]!.position.x).toBe(1);
    resources.dispose();
  });

  it('shares geometry between parts of the same shape', () => {
    const resources = new ModelResources();
    const model = buildModel(tiny, resources);
    const [first, second] = model.group.children as Mesh[];
    expect(second!.geometry).toBe(first!.geometry);
    expect(second!.material).toBe(first!.material);
    resources.dispose();
  });

  it('shares everything between two builds of the same spec', () => {
    const resources = new ModelResources();
    const a = buildModel(tiny, resources);
    const b = buildModel(tiny, resources);
    expect(b.group).not.toBe(a.group);
    expect((b.group.children[0] as Mesh).geometry).toBe((a.group.children[0] as Mesh).geometry);
    // Two builds of a three-part model still cost two geometries and two materials.
    expect(resources.primitives.size).toBe(2);
    expect(resources.materials.size).toBe(2);
    resources.dispose();
  });


  it('exposes named parts and hooks', () => {
    const resources = new ModelResources();
    const model = buildModel(tiny, resources);
    expect(model.named.get('twin')).toBeDefined();
    expect(model.named.get('twin')!.name).toBe('twin');
    expect(model.hooks.get('hand.R')!.position.x).toBe(0.5);
    resources.dispose();
  });

  it('applies a palette override without touching the spec', () => {
    const resources = new ModelResources();
    const plain = buildModel(tiny, resources);
    const recoloured = buildModel(tiny, resources, { palette: { a: { color: '#0000ff' } } });
    expect((recoloured.group.children[0] as Mesh).material).not.toBe(
      (plain.group.children[0] as Mesh).material,
    );
    expect(tiny.palette['a']!.color).toBe('#ff0000');
    resources.dispose();
  });

  it('refuses a part whose material the palette does not define', () => {
    const resources = new ModelResources();
    const broken: ProceduralModelSpec = {
      ...tiny,
      parts: [{ prim: { kind: 'box', w: 1, h: 1, d: 1 }, mat: 'nope' }],
    };
    expect(() => buildModel(broken, resources)).toThrow(/material "nope"/);
    resources.dispose();
  });

  it('hides parts marked hidden, and keeps fx parts out of the shadow pass', () => {
    const resources = new ModelResources();
    const spec: ProceduralModelSpec = {
      ...tiny,
      palette: { ...tiny.palette, beam: { color: '#fff', unlit: true, opacity: 0.2 } },
      parts: [
        { prim: { kind: 'cone', r: 1, h: 1, seg: 4 }, mat: 'beam', hidden: true, name: 'beam' },
      ],
    };
    const model = buildModel(spec, resources);
    const beam = model.named.get('beam')!;
    expect(beam.visible).toBe(false);
    expect(beam.castShadow).toBe(false);
    resources.dispose();
  });

  it('lifts a model that declares a ground offset', () => {
    const resources = new ModelResources();
    const floating = buildModel({ ...tiny, groundOffset: 0.25 }, resources);
    expect(floating.group.position.y).toBe(0.25);
    resources.dispose();
  });
});

describe('setSpiritEyes', () => {
  it('lights and dims eyes by swapping shared materials', () => {
    const resources = new ModelResources();
    const model = buildModel(new ModelRegistry().get('knight'), resources);
    const [eye0, eye1] = [model.named.get('eye0')!, model.named.get('eye1')!];

    setSpiritEyes(model, resources, 0);
    const dark = eye0.material;
    expect(eye0.scale.x).toBe(1);

    setSpiritEyes(model, resources, 1);
    expect(eye0.material).not.toBe(dark);
    expect(eye0.scale.x).toBeCloseTo(1.4, 10);
    expect(eye1.material).toBe(dark);

    setSpiritEyes(model, resources, 2);
    expect(eye1.material).toBe(eye0.material); // one shared lit material, not two
    resources.dispose();
  });

  it('does nothing to a model with no eyes', () => {
    const resources = new ModelResources();
    const model = buildModel(new ModelRegistry().get('crate'), resources);
    expect(() => setSpiritEyes(model, resources, 2)).not.toThrow();
    resources.dispose();
  });
});

describe('the shipped library', () => {
  const registry = new ModelRegistry();
  const resources = new ModelResources();

  it('gives every model a unique id and a non-empty palette', () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of MODELS) {
      expect(spec.parts.length).toBeGreaterThan(0);
      expect(Object.keys(spec.palette).length).toBeGreaterThan(0);
    }
  });

  it('builds every model, with every part resolving a material', () => {
    for (const spec of MODELS) {
      const model = buildModel(spec, resources);
      expect(model.group.children.length).toBeGreaterThanOrEqual(spec.parts.length);
    }
  });

  it('stands every model on the ground, bar the three that deliberately do not', () => {
    // docs/research/legacy-models.md §2.6 catalogues the legacy origin violators.
    // Reproducing them exactly is how the port stays visually faithful: the rock
    // is half sunk, the campfire's log ends dip below, the Archfey floats.
    const intentional: Readonly<Record<string, number>> = {
      rock: -0.203,
      campfire: -0.095,
      archfey: 0.25,
    };
    const box = new Box3();
    const offenders: string[] = [];
    for (const spec of MODELS) {
      box.setFromObject(buildModel(spec, resources).group);
      const expected = intentional[spec.id] ?? 0;
      if (Math.abs(box.min.y - expected) > 0.02) {
        offenders.push(`${spec.id}: expected ${expected}, measured ${box.min.y.toFixed(3)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares a standHeight that matches the geometry it builds', () => {
    const box = new Box3();
    const wrong: string[] = [];
    for (const spec of MODELS) {
      const model = buildModel(spec, resources);
      box.setFromObject(model.group);
      // Within 0.02 of the measured top: these were measured, not estimated.
      if (Math.abs(box.max.y - spec.standHeight) > 0.02) {
        wrong.push(`${spec.id}: declared ${spec.standHeight}, measured ${box.max.y.toFixed(3)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keeps every model roughly within a tile, apart from the known wide ones', () => {
    const box = new Box3();
    for (const spec of MODELS) {
      const model = buildModel(spec, resources);
      box.setFromObject(model.group);
      const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      expect(width, `${spec.id} is ${width.toFixed(2)} wide`).toBeLessThan(1.2);
    }
  });

  it('shares heavily across the whole library', () => {
    const fresh = new ModelResources();
    let parts = 0;
    for (const spec of MODELS) {
      buildModel(spec, fresh);
      parts += spec.parts.length;
    }
    // The legacy library allocated one geometry and one material per part.
    expect(parts).toBeGreaterThan(150);
    expect(fresh.primitives.size).toBeLessThan(parts * 0.8);
    expect(fresh.materials.size).toBeLessThan(parts * 0.8);
    fresh.dispose();
  });

  it('resolves an unknown id to a placeholder rather than throwing', () => {
    expect(registry.get('no-such-model')).toBe(placeholder);
    expect(registry.missing()).toContain('no-such-model');
    expect(() => buildModel(registry.get('no-such-model'), resources)).not.toThrow();
  });

  it('lets a project add or replace a model', () => {
    const local = new ModelRegistry();
    expect(local.has('tiny')).toBe(false);
    local.add(tiny);
    expect(local.get('tiny')).toBe(tiny);
    expect(local.ids()).toContain('tiny');
    expect(local.byCategory('hero').length).toBe(6);
  });

  it('rejects a duplicate id at construction', () => {
    expect(() => new ModelRegistry([tiny, tiny])).toThrow(/duplicate model id/);
  });
});
