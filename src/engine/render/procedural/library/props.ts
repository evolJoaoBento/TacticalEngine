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

/**
 * The four things a room interacts with, for an object that names no model of its
 * own. An interactable is content — it stands in the room whether or not anybody is
 * editing it — and until these existed a door with a lock on it was invisible in play.
 */
export const door: ProceduralModelSpec = {
  id: 'door',
  category: 'prop',
  standHeight: 1.9,
  tags: ['interactable'],
  info: { name: 'Door', desc: 'Banded timber in a stone frame.' },
  palette: {
    timber: { color: '#6b4a2c' },
    band: { color: '#3f4249' },
    frame: { color: '#6e7480' },
  },
  parts: [
    { prim: { kind: 'box', w: 0.14, h: 1.8, d: 0.12 }, mat: 'frame', pos: [-0.43, 0.9, 0] },
    { prim: { kind: 'box', w: 0.14, h: 1.8, d: 0.12 }, mat: 'frame', pos: [0.43, 0.9, 0] },
    { prim: { kind: 'box', w: 1.0, h: 0.14, d: 0.12 }, mat: 'frame', pos: [0, 1.82, 0] },
    { prim: { kind: 'box', w: 0.74, h: 1.72, d: 0.08 }, mat: 'timber', pos: [0, 0.86, 0] },
    { prim: { kind: 'box', w: 0.78, h: 0.1, d: 0.1 }, mat: 'band', pos: [0, 1.4, 0] },
    { prim: { kind: 'box', w: 0.78, h: 0.1, d: 0.1 }, mat: 'band', pos: [0, 0.42, 0] },
    { prim: { kind: 'sphere', r: 0.06, wSeg: 8, hSeg: 6 }, mat: 'band', pos: [0.26, 0.92, 0.08] },
  ],
};

export const chest: ProceduralModelSpec = {
  id: 'chest',
  category: 'prop',
  standHeight: 0.579,
  tags: ['interactable'],
  info: { name: 'Chest', desc: 'Banded and lidded, with a heavy lock.' },
  palette: {
    wood: { color: '#5d3f24' },
    band: { color: '#3f4249' },
    lock: { color: '#c9a227', emissive: '#6b520d', emissiveIntensity: 0.35 },
  },
  parts: [
    { prim: { kind: 'box', w: 0.72, h: 0.34, d: 0.46 }, mat: 'wood', pos: [0, 0.17, 0] },
    { prim: { kind: 'cylinder', rTop: 0.23, rBottom: 0.23, h: 0.72, seg: 10 }, mat: 'wood', pos: [0, 0.36, 0], rot: [0, 0, Math.PI / 2] },
    { prim: { kind: 'box', w: 0.76, h: 0.07, d: 0.12 }, mat: 'band', pos: [0, 0.2, 0] },
    { prim: { kind: 'box', w: 0.1, h: 0.42, d: 0.5 }, mat: 'band', pos: [-0.24, 0.24, 0] },
    { prim: { kind: 'box', w: 0.1, h: 0.42, d: 0.5 }, mat: 'band', pos: [0.24, 0.24, 0] },
    { prim: { kind: 'box', w: 0.12, h: 0.14, d: 0.08 }, mat: 'lock', pos: [0, 0.3, 0.24] },
  ],
};

export const pillar: ProceduralModelSpec = {
  id: 'pillar',
  category: 'prop',
  standHeight: 2.14,
  tags: ['interactable'],
  info: { name: 'Pillar', desc: 'Worn stone, carved once and long ago.' },
  palette: {
    stone: { color: '#7a7f8a' },
    dark: { color: '#5d626c' },
    rune: { color: '#8fd0ff', emissive: '#3f8fd0', emissiveIntensity: 0.8 },
  },
  parts: [
    { prim: { kind: 'box', w: 0.62, h: 0.16, d: 0.62 }, mat: 'dark', pos: [0, 0.08, 0] },
    { prim: { kind: 'cylinder', rTop: 0.22, rBottom: 0.26, h: 1.6, seg: 8 }, mat: 'stone', pos: [0, 0.96, 0] },
    { prim: { kind: 'box', w: 0.56, h: 0.14, d: 0.56 }, mat: 'dark', pos: [0, 1.83, 0] },
    { prim: { kind: 'octahedron', r: 0.12 }, mat: 'rune', pos: [0, 2.02, 0] },
  ],
};

export const portal: ProceduralModelSpec = {
  id: 'portal',
  category: 'prop',
  standHeight: 1.542,
  tags: ['interactable'],
  info: { name: 'Portal', desc: 'A way out of the room, and into another.' },
  palette: {
    step: { color: '#6e7480' },
    dark: { color: '#4a4f58' },
    glow: { color: '#9fd8ff', emissive: '#4aa3e0', emissiveIntensity: 1.1 },
  },
  parts: [
    { prim: { kind: 'box', w: 0.9, h: 0.12, d: 0.34 }, mat: 'step', pos: [0, 0.06, 0.22] },
    { prim: { kind: 'box', w: 0.9, h: 0.12, d: 0.34 }, mat: 'dark', pos: [0, 0.18, -0.02] },
    { prim: { kind: 'torus', r: 0.46, tube: 0.09, radSeg: 6, tubSeg: 18 }, mat: 'step', pos: [0, 1.0, -0.2] },
    { prim: { kind: 'cylinder', rTop: 0.38, rBottom: 0.38, h: 0.04, seg: 16, open: true }, mat: 'glow', pos: [0, 1.0, -0.2], rot: [Math.PI / 2, 0, 0] },
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
  door,
  chest,
  pillar,
  portal,
] as const;
