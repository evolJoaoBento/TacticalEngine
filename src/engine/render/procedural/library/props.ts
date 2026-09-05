/**
 * Scenery props, ported from `legacy/js/models.js`.
 *
 * These are the ones the shipped maps actually place — the demo vault's eight and
 * the one-shot's camp dressing. The remaining legacy props (piano, throne, hut,
 * spotlight, barrier, gate, spectator, floorboard, trunk) belong to the one-shot
 * and follow when that campaign is ported.
 *
 * One behaviour is deliberately dropped: `pine()` called `Math.random()` at build
 * time to vary its green, which made the same map look different on every load
 * and put a random call in the render path. The variation is now a build
 * parameter — `pineShades` below — so a project can vary trees deterministically
 * from its own seed.
 */

import type { MatSpec, ProceduralModelSpec } from '../spec';

/** Scale a hex colour, as the legacy `Color.multiplyScalar` did. */
function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = clamp((n >> 16) & 0xff);
  const g = clamp((n >> 8) & 0xff);
  const b = clamp(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const PINE_GREEN = '#3d6b45';

/**
 * A pine at a given shade. The legacy builder picked `0.85 + random() * 0.3`;
 * a caller that wants variety picks from this range itself.
 */
export function pineAt(brightness = 1): ProceduralModelSpec {
  const base = shade(PINE_GREEN, brightness);
  const palette: Record<string, MatSpec> = {
    trunk: { color: '#4a3a26' },
    lower: { color: base },
    middle: { color: shade(base, 1.12) },
    upper: { color: shade(base, 1.25) },
  };
  return {
    id: brightness === 1 ? 'pine' : `pine@${brightness.toFixed(2)}`,
    category: 'prop',
    standHeight: 1.55,
    tags: ['tree'],
    info: { name: 'Pine', desc: 'A young pine, needles dark against the sky.' },
    palette,
    parts: [
      { prim: { kind: 'cylinder', rTop: 0.07, rBottom: 0.09, h: 0.4, seg: 5 }, mat: 'trunk', pos: [0, 0.2, 0] },
      { prim: { kind: 'cone', r: 0.4, h: 0.6, seg: 6 }, mat: 'lower', pos: [0, 0.6, 0] },
      { prim: { kind: 'cone', r: 0.3, h: 0.5, seg: 6 }, mat: 'middle', pos: [0, 1.0, 0] },
      { prim: { kind: 'cone', r: 0.18, h: 0.4, seg: 6 }, mat: 'upper', pos: [0, 1.35, 0] },
    ],
  };
}

export const pine = pineAt(1);

/** The shade range the legacy random picked from, for deterministic variety. */
export const PINE_SHADE_RANGE = { min: 0.85, max: 1.15 } as const;

export const deadTree: ProceduralModelSpec = {
  id: 'deadTree',
  category: 'prop',
  standHeight: 1.4,
  tags: ['tree'],
  info: { name: 'Dead Tree', desc: 'Bare branches, long past leafing.' },
  palette: { bark: { color: '#3d3429' }, branch: { color: '#332b22' } },
  parts: [
    { prim: { kind: 'cylinder', rTop: 0.06, rBottom: 0.12, h: 1.1, seg: 5 }, mat: 'bark', pos: [0, 0.55, 0], rot: [0, 0, 0.08] },
    { prim: { kind: 'cylinder', rTop: 0.03, rBottom: 0.05, h: 0.55, seg: 4 }, mat: 'bark', pos: [0.22, 1.0, 0], rot: [0, 0, -0.9] },
    { prim: { kind: 'cylinder', rTop: 0.025, rBottom: 0.04, h: 0.45, seg: 4 }, mat: 'branch', pos: [-0.18, 0.85, 0.08], rot: [0.3, 0, 0.9] },
    { prim: { kind: 'cylinder', rTop: 0.02, rBottom: 0.03, h: 0.3, seg: 4 }, mat: 'branch', pos: [0.05, 1.25, -0.06], rot: [-0.4, 0, 0.25] },
  ],
};

export const rock: ProceduralModelSpec = {
  id: 'rock',
  category: 'prop',
  standHeight: 0.6,
  // Half-sunk: the legacy model encoded that in its part positions rather than
  // offsetting the group, and the port keeps it there so the two match.
  tags: ['stone', 'cover'],
  info: { name: 'Rock', desc: 'A weathered boulder, half sunk into the earth.' },
  palette: { stone: { color: '#6e7480' }, chip: { color: '#7d8490' } },
  parts: [
    { prim: { kind: 'icosahedron', r: 0.3 }, mat: 'stone', pos: [0, 0.2, 0], rot: [0.4, 0.7, 0.2] },
    { prim: { kind: 'icosahedron', r: 0.18 }, mat: 'chip', pos: [0.28, 0.12, 0.15], rot: [1.1, 0.3, 0.5] },
  ],
};

export const barrel: ProceduralModelSpec = {
  id: 'barrel',
  category: 'prop',
  standHeight: 0.42,
  tags: ['container'],
  info: { name: 'Barrel', desc: 'Stout oak, hooped in iron.' },
  palette: { staves: { color: '#6e5a40' }, hoop: { color: '#4d4a55' } },
  parts: [
    { prim: { kind: 'cylinder', rTop: 0.18, rBottom: 0.16, h: 0.42, seg: 9 }, mat: 'staves', pos: [0, 0.21, 0] },
    { prim: { kind: 'torus', r: 0.18, tube: 0.018, radSeg: 5, tubSeg: 12 }, mat: 'hoop', pos: [0, 0.12, 0], rot: [Math.PI / 2, 0, 0] },
    { prim: { kind: 'torus', r: 0.18, tube: 0.018, radSeg: 5, tubSeg: 12 }, mat: 'hoop', pos: [0, 0.32, 0], rot: [Math.PI / 2, 0, 0] },
  ],
};

export const crate: ProceduralModelSpec = {
  id: 'crate',
  category: 'prop',
  standHeight: 0.38,
  tags: ['container'],
  info: { name: 'Crate', desc: 'Rough planks, nailed and banded.' },
  palette: { planks: { color: '#7a6446' }, band: { color: '#5c4632' }, small: { color: '#6e5a40' } },
  parts: [
    { prim: { kind: 'box', w: 0.38, h: 0.38, d: 0.38 }, mat: 'planks', pos: [0, 0.19, 0], rot: [0, 0.2, 0] },
    { prim: { kind: 'box', w: 0.42, h: 0.07, d: 0.07 }, mat: 'band', pos: [0, 0.19, 0.17], rot: [0, 0.2, 0.8] },
    { prim: { kind: 'box', w: 0.2, h: 0.2, d: 0.2 }, mat: 'small', pos: [0.22, 0.1, -0.18], rot: [0, 0.6, 0] },
  ],
};

export const banner: ProceduralModelSpec = {
  id: 'banner',
  category: 'prop',
  standHeight: 1.62,
  tags: ['heraldry'],
  info: { name: 'Banner', desc: 'A company standard, colours faded.' },
  palette: {
    pole: { color: '#4a3a26' },
    cloth: { color: '#7a2433' },
    finial: { color: '#d4af37', metalness: 0.5 },
  },
  parts: [
    { prim: { kind: 'cylinder', rTop: 0.03, rBottom: 0.04, h: 1.5, seg: 5 }, mat: 'pole', pos: [0, 0.75, 0] },
    { prim: { kind: 'box', w: 0.42, h: 0.04, d: 0.04 }, mat: 'pole', pos: [0.18, 1.42, 0] },
    { prim: { kind: 'box', w: 0.34, h: 0.62, d: 0.025 }, mat: 'cloth', pos: [0.2, 1.1, 0] },
    { prim: { kind: 'cone', r: 0.04, h: 0.12, seg: 4 }, mat: 'finial', pos: [0, 1.56, 0] },
  ],
};

export const brazier: ProceduralModelSpec = {
  id: 'brazier',
  category: 'prop',
  standHeight: 0.85,
  tags: ['fire', 'light'],
  info: { name: 'Brazier', desc: 'Coals banked against the dark.' },
  palette: {
    iron: { color: '#3a3d49', metalness: 0.4 },
    flame: { color: '#ff9d45', emissive: '#ff6a00', emissiveIntensity: 1.6 },
    core: { color: '#ffe9a0', emissive: '#ffd75e', emissiveIntensity: 2.0 },
  },
  parts: [
    { prim: { kind: 'cylinder', rTop: 0.05, rBottom: 0.07, h: 0.5, seg: 5 }, mat: 'iron', pos: [0, 0.25, 0] },
    { prim: { kind: 'cylinder', rTop: 0.16, rBottom: 0.08, h: 0.14, seg: 7 }, mat: 'iron', pos: [0, 0.55, 0] },
    { prim: { kind: 'cone', r: 0.1, h: 0.24, seg: 5 }, mat: 'flame', pos: [0, 0.7, 0] },
    { prim: { kind: 'cone', r: 0.05, h: 0.14, seg: 4 }, mat: 'core', pos: [0, 0.78, 0] },
  ],
};

/** Four wheels, two per side. */
const wheels = ([-0.25, 0.25] as const).flatMap((x) =>
  ([0.26, -0.26] as const).map((z) => ({
    prim: { kind: 'cylinder' as const, rTop: 0.14, rBottom: 0.14, h: 0.05, seg: 8 },
    mat: 'wheel',
    pos: [x, 0.16, z] as const,
    rot: [Math.PI / 2, 0, 0] as const,
  })),
);

export const cart: ProceduralModelSpec = {
  id: 'cart',
  category: 'prop',
  standHeight: 0.58,
  tags: ['vehicle'],
  info: { name: 'Cart', desc: 'A supply cart, one shaft resting in the mud.' },
  palette: { bed: { color: '#6e5a40' }, rail: { color: '#5c4632' }, wheel: { color: '#4a3a26' } },
  parts: [
    { prim: { kind: 'box', w: 0.8, h: 0.22, d: 0.5 }, mat: 'bed', pos: [0, 0.34, 0] },
    { prim: { kind: 'box', w: 0.8, h: 0.16, d: 0.05 }, mat: 'rail', pos: [0, 0.5, 0.22] },
    { prim: { kind: 'box', w: 0.8, h: 0.16, d: 0.05 }, mat: 'rail', pos: [0, 0.5, -0.22] },
    ...wheels,
    { prim: { kind: 'cylinder', rTop: 0.025, rBottom: 0.025, h: 0.5, seg: 4 }, mat: 'rail', pos: [0.55, 0.3, 0.1], rot: [0, 0, -0.9] },
  ],
};

export const dummy: ProceduralModelSpec = {
  id: 'dummy',
  category: 'prop',
  standHeight: 1.03,
  tags: ['training'],
  info: { name: 'Training Dummy', desc: 'Straw and old armour on a pole.' },
  palette: {
    pole: { color: '#5c4632' },
    straw: { color: '#8a7a5c' },
    head: { color: '#a89a78' },
    helm: { color: '#4d4a55', metalness: 0.3 },
  },
  parts: [
    { prim: { kind: 'cylinder', rTop: 0.04, rBottom: 0.05, h: 0.9, seg: 5 }, mat: 'pole', pos: [0, 0.45, 0] },
    { prim: { kind: 'box', w: 0.55, h: 0.05, d: 0.05 }, mat: 'pole', pos: [0, 0.62, 0] },
    { prim: { kind: 'cylinder', rTop: 0.14, rBottom: 0.18, h: 0.35, seg: 6 }, mat: 'straw', pos: [0, 0.6, 0] },
    { prim: { kind: 'sphere', r: 0.11, wSeg: 6, hSeg: 5 }, mat: 'head', pos: [0, 0.92, 0] },
    { prim: { kind: 'cylinder', rTop: 0.12, rBottom: 0.13, h: 0.06, seg: 6 }, mat: 'helm', pos: [0, 1.0, 0] },
  ],
};

export const campfire: ProceduralModelSpec = {
  id: 'campfire',
  category: 'prop',
  standHeight: 0.41,
  tags: ['fire', 'light'],
  info: { name: 'Campfire', desc: 'Logs banked around a low, steady flame.' },
  palette: {
    log: { color: '#4a3a26' },
    stone: { color: '#6e7480' },
    flame: { color: '#ff9d45', emissive: '#ff6a00', emissiveIntensity: 1.7 },
    core: { color: '#ffe9a0', emissive: '#ffd75e', emissiveIntensity: 2.2 },
  },
  parts: [
    ...Array.from({ length: 5 }, (_, i) => {
      const angle = (i / 5) * Math.PI * 2;
      return {
        prim: { kind: 'icosahedron' as const, r: 0.09 },
        mat: 'stone',
        pos: [Math.cos(angle) * 0.28, 0.05, Math.sin(angle) * 0.28] as const,
        rot: [angle, angle, 0] as const,
      };
    }),
    { prim: { kind: 'cylinder', rTop: 0.05, rBottom: 0.06, h: 0.42, seg: 5 }, mat: 'log', pos: [0, 0.1, 0], rot: [0.9, 0.4, 0] },
    { prim: { kind: 'cylinder', rTop: 0.05, rBottom: 0.06, h: 0.42, seg: 5 }, mat: 'log', pos: [0, 0.1, 0], rot: [0.9, -0.8, 0] },
    { prim: { kind: 'cone', r: 0.14, h: 0.3, seg: 5 }, mat: 'flame', pos: [0, 0.24, 0] },
    { prim: { kind: 'cone', r: 0.07, h: 0.18, seg: 4 }, mat: 'core', pos: [0, 0.32, 0] },
  ],
};

export const PROP_MODELS = [
  pine,
  deadTree,
  rock,
  barrel,
  crate,
  banner,
  brazier,
  cart,
  dummy,
  campfire,
] as const;
