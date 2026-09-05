/**
 * The four monster miniatures, ported from `legacy/js/models.js`.
 *
 * The Shadow Hag and the Archfey had `setSpiritEyes(head, 2)` called at build
 * time — "her eyes always burn white-cold", "eyes like cold stars". A spec cannot
 * call a function, so their eyes are simply declared lit in the palette, which is
 * the same result without the mutation.
 */

import {
  BASE_PALETTE,
  EYE_PALETTE,
  head,
  ringMaterial,
  staff,
  tokenBase,
  type PartSpec,
  type ProceduralModelSpec,
} from '../spec';

/** Eyes already burning, for the two models that were built that way. */
const LIT_EYES = { eye: { color: '#aef6ff', emissive: '#7be8ff', emissiveIntensity: 1.6 } };

export const husk: ProceduralModelSpec = {
  id: 'husk',
  category: 'monster',
  standHeight: 0.86,
  tags: ['undead'],
  palette: {
    ...BASE_PALETTE,
    ...EYE_PALETTE,
    ring: ringMaterial('#c2455a'),
    skirt: { color: '#5c3340' },
    torso: { color: '#7d4452' },
    skin: { color: '#9c6b76' },
    claw: { color: '#3c2330' },
    horn: { color: '#4a2a38' },
  },
  parts: [
    ...tokenBase(),
    { prim: { kind: 'cone', r: 0.27, h: 0.4, seg: 5 }, mat: 'skirt', pos: [0, 0.26, 0] },
    {
      prim: { kind: 'cylinder', rTop: 0.12, rBottom: 0.2, h: 0.34, seg: 5 },
      mat: 'torso',
      pos: [0, 0.52, 0.05],
      rot: [0.5, 0, 0],
    },
    // The head is hunched forward, so it is placed rather than stacked.
    { prim: { kind: 'icosahedron', r: 0.11 }, mat: 'skin', pos: [0, 0.68, 0.2], rot: [0.45, 0, 0] },
    { prim: { kind: 'sphere', r: 0.028, wSeg: 6, hSeg: 6 }, mat: 'eye', pos: [-0.05, 0.72, 0.29], name: 'eye0' },
    { prim: { kind: 'sphere', r: 0.028, wSeg: 6, hSeg: 6 }, mat: 'eye', pos: [0.05, 0.72, 0.29], name: 'eye1' },
    { prim: { kind: 'cone', r: 0.045, h: 0.2, seg: 4 }, mat: 'claw', pos: [-0.22, 0.42, 0.22], rot: [1.2, 0, 0.4] },
    { prim: { kind: 'cone', r: 0.045, h: 0.2, seg: 4 }, mat: 'claw', pos: [0.22, 0.42, 0.22], rot: [1.2, 0, -0.4] },
    { prim: { kind: 'cone', r: 0.06, h: 0.16, seg: 4 }, mat: 'horn', pos: [0, 0.78, 0.1] },
  ],
};

/** Nine thorns radiating from the core, as the legacy loop laid them out. */
function thorns(): PartSpec[] {
  return Array.from({ length: 9 }, (_, i) => {
    const angle = (i / 9) * Math.PI * 2;
    const lift = ((i % 3) - 1) * 0.5;
    return {
      prim: { kind: 'cone' as const, r: 0.03, h: 0.22, seg: 4 },
      mat: 'thorn',
      pos: [Math.cos(angle) * 0.24, 0.3 + lift * 0.12, Math.sin(angle) * 0.24] as const,
      rot: [Math.PI / 2 + lift, 0, -angle] as const,
    };
  });
}

export const bramble: ProceduralModelSpec = {
  id: 'bramble',
  category: 'monster',
  standHeight: 0.49,
  tags: ['plant', 'minion'],
  palette: {
    ...BASE_PALETTE,
    ring: ringMaterial('#a0522d'),
    core: { color: '#4a3322' },
    lobeA: { color: '#5c4128' },
    lobeB: { color: '#3d2a1c' },
    feeding: { color: '#b3122e', emissive: '#8a0a20', emissiveIntensity: 1.2 },
    thorn: { color: '#2e2118' },
  },
  parts: [
    ...tokenBase(),
    { prim: { kind: 'icosahedron', r: 0.22 }, mat: 'core', pos: [0, 0.3, 0] },
    { prim: { kind: 'icosahedron', r: 0.15 }, mat: 'lobeA', pos: [-0.18, 0.2, 0.12], rot: [0.5, 1, 0] },
    { prim: { kind: 'icosahedron', r: 0.13 }, mat: 'lobeB', pos: [0.2, 0.22, -0.1], rot: [1, 0.4, 0.6] },
    { prim: { kind: 'icosahedron', r: 0.08 }, mat: 'feeding', pos: [0.02, 0.34, 0.08] },
    ...thorns(),
  ],
};

/** Five tattered points around the hem of the hag's cloak. */
function hem(): PartSpec[] {
  return Array.from({ length: 5 }, (_, i) => {
    const angle = (i / 5) * Math.PI * 2;
    return {
      prim: { kind: 'cone' as const, r: 0.06, h: 0.18, seg: 4 },
      mat: 'hem',
      pos: [Math.cos(angle) * 0.24, 0.1, Math.sin(angle) * 0.24] as const,
      rot: [Math.PI, 0, 0] as const,
    };
  });
}

export const shadowHag: ProceduralModelSpec = {
  id: 'shadowHag',
  category: 'monster',
  standHeight: 1.28,
  tags: ['fey', 'caster'],
  palette: {
    ...BASE_PALETTE,
    ...LIT_EYES,
    ring: ringMaterial('#6f42c8'),
    cloak: { color: '#241c33' },
    hem: { color: '#1a1426' },
    shoulders: { color: '#3a2d52' },
    skin: { color: '#8a7f9c' },
    crescent: { color: '#e8e6ff', emissive: '#b8b0ff', emissiveIntensity: 1.6 },
    haft: { color: '#2e2640' },
  },
  parts: [
    ...tokenBase(),
    { prim: { kind: 'cone', r: 0.3, h: 0.75, seg: 7 }, mat: 'cloak', pos: [0, 0.44, 0] },
    ...hem(),
    { prim: { kind: 'sphere', r: 0.1, wSeg: 6, hSeg: 5 }, mat: 'shoulders', pos: [0, 0.86, 0.12] },
    { prim: { kind: 'icosahedron', r: 0.1 }, mat: 'skin', pos: [0, 0.92, 0.18], rot: [0.5, 0, 0] },
    {
      prim: { kind: 'sphere', r: 0.028, wSeg: 6, hSeg: 6 },
      mat: 'eye',
      pos: [-0.05, 0.96, 0.26],
      name: 'eye0',
      scale: 1.4,
    },
    {
      prim: { kind: 'sphere', r: 0.028, wSeg: 6, hSeg: 6 },
      mat: 'eye',
      pos: [0.05, 0.96, 0.26],
      name: 'eye1',
      scale: 1.4,
    },
    { prim: { kind: 'cone', r: 0.05, h: 0.16, seg: 4 }, mat: 'skin', pos: [0, 0.88, 0.3], rot: [1.3, 0, 0] },
    ...staff(1.05, [0.3, 0, 0.05], 'haft', {
      prim: { kind: 'torus', r: 0.11, tube: 0.028, radSeg: 5, tubSeg: 12, arc: Math.PI * 1.4 },
      mat: 'crescent',
      rot: [0, 0, Math.PI * 0.8],
    }),
  ],
};

/** Six starlight points in the Archfey's crown. */
function crown(): PartSpec[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2;
    return {
      prim: { kind: 'cone' as const, r: 0.025, h: 0.14, seg: 4 },
      mat: 'star',
      pos: [Math.cos(angle) * 0.1, 1.56, Math.sin(angle) * 0.1] as const,
    };
  });
}

export const archfey: ProceduralModelSpec = {
  id: 'archfey',
  category: 'monster',
  standHeight: 1.63,
  // He hovers rather than standing, and has no base at all — the legacy model put
  // that in its part positions (the robe starts at y = 0.25), so the port does too.
  motion: { idle: 'hover', amp: 0.06, hz: 0.35 },
  tags: ['fey', 'boss'],
  palette: {
    ...LIT_EYES,
    robe: { color: '#3da8a0', metalness: 0.65, roughness: 0.25 },
    mantle: { color: '#7fe0d0', metalness: 0.7, roughness: 0.2 },
    skin: { color: '#e9e2f2' },
    star: { color: '#fff8d8', emissive: '#ffe9a0', emissiveIntensity: 1.4 },
    wispA: { color: '#7fe0d0', opacity: 0.55 },
    wispB: { color: '#caa6ff', opacity: 0.55 },
  },
  parts: [
    { prim: { kind: 'cone', r: 0.3, h: 1.0, seg: 8 }, mat: 'robe', pos: [0, 0.75, 0] },
    { prim: { kind: 'cone', r: 0.32, h: 0.3, seg: 8 }, mat: 'mantle', pos: [0, 1.15, 0] },
    ...head('skin', 0.11, 1.42).map((part) =>
      part.name === undefined ? part : { ...part, scale: 1.4 },
    ),
    ...crown(),
    { prim: { kind: 'cone', r: 0.08, h: 0.5, seg: 5 }, mat: 'wispA', pos: [-0.3, 0.9, -0.1], rot: [0, 0, 0.7] },
    { prim: { kind: 'cone', r: 0.08, h: 0.5, seg: 5 }, mat: 'wispB', pos: [0.3, 0.95, 0.08], rot: [0, 0, -0.7] },
  ],
};

export const MONSTER_MODELS = [husk, bramble, shadowHag, archfey] as const;
