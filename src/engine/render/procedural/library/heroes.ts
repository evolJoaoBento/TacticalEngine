/**
 * The six hero miniatures, ported from `legacy/js/models.js` as specs.
 *
 * Geometry, position and colour are carried over exactly; the only deliberate
 * change is that the base ring is a palette entry named `ring` rather than a
 * colour baked into the builder, so an entity's own colour can drive it.
 * (docs/research/legacy-models.md §2.3 catalogues the four heroes whose baked
 * ring did not match their data colour, which is why it became a parameter.)
 */

import {
  BASE_PALETTE,
  EYE_PALETTE,
  WOOD_PALETTE,
  head,
  ringMaterial,
  staff,
  tokenBase,
  type ProceduralModelSpec,
} from '../spec';

export const knight: ProceduralModelSpec = {
  id: 'knight',
  category: 'hero',
  standHeight: 1.09,
  tags: ['hero', 'armored'],
  palette: {
    ...BASE_PALETTE,
    ...EYE_PALETTE,
    ring: ringMaterial('#c8cede'),
    legs: { color: '#3f4350' },
    plate: { color: '#8d93a5', metalness: 0.3 },
    helm: { color: '#8d93a5', metalness: 0.4 },
    plume: { color: '#c0392b' },
    skin: { color: '#d8c5a5' },
    shield: { color: '#5a6378', metalness: 0.25 },
    gold: { color: '#d4af37', metalness: 0.5 },
    goldFlat: { color: '#d4af37' },
    blade: { color: '#cfd6e4', metalness: 0.6 },
  },
  parts: [
    ...tokenBase(),
    { prim: { kind: 'cylinder', rTop: 0.14, rBottom: 0.18, h: 0.3, seg: 6 }, mat: 'legs', pos: [0, 0.24, 0] },
    { prim: { kind: 'box', w: 0.36, h: 0.32, d: 0.24 }, mat: 'plate', pos: [0, 0.52, 0] },
    { prim: { kind: 'box', w: 0.14, h: 0.1, d: 0.14 }, mat: 'plate', pos: [-0.24, 0.66, 0] },
    { prim: { kind: 'box', w: 0.14, h: 0.1, d: 0.14 }, mat: 'plate', pos: [0.24, 0.66, 0] },
    ...head('skin', 0.11, 0.8),
    { prim: { kind: 'cylinder', rTop: 0.12, rBottom: 0.13, h: 0.1, seg: 8 }, mat: 'helm', pos: [0, 0.88, 0] },
    { prim: { kind: 'cone', r: 0.05, h: 0.18, seg: 5 }, mat: 'plume', pos: [0, 1.0, -0.02] },
    // Tower shield on the left, sword on the right.
    { prim: { kind: 'box', w: 0.07, h: 0.55, d: 0.34 }, mat: 'shield', pos: [-0.3, 0.42, 0.04] },
    { prim: { kind: 'box', w: 0.08, h: 0.4, d: 0.08 }, mat: 'gold', pos: [-0.305, 0.42, 0.04] },
    {
      prim: { kind: 'box', w: 0.04, h: 0.42, d: 0.07 },
      mat: 'blade',
      pos: [0.3, 0.62, 0.06],
      rot: [0, 0, -0.35],
    },
    { prim: { kind: 'box', w: 0.12, h: 0.04, d: 0.04 }, mat: 'goldFlat', pos: [0.24, 0.44, 0.06] },
  ],
  hooks: { 'hand.R': { pos: [0.3, 0.6, 0.06] }, 'hand.L': { pos: [-0.3, 0.42, 0.04] } },
};

export const rogue: ProceduralModelSpec = {
  id: 'rogue',
  category: 'hero',
  standHeight: 0.96,
  tags: ['hero', 'ranged'],
  palette: {
    ...BASE_PALETTE,
    ...EYE_PALETTE,
    ring: ringMaterial('#5fb0ff'),
    cloak: { color: '#3d6b8f' },
    skin: { color: '#e8d5b5' },
    bow: { color: '#7a5a36' },
    quiver: { color: '#4a3a26' },
  },
  parts: [
    ...tokenBase(),
    { prim: { kind: 'cone', r: 0.24, h: 0.55, seg: 6 }, mat: 'cloak', pos: [0, 0.36, 0] },
    ...head('skin', 0.11, 0.7),
    { prim: { kind: 'cone', r: 0.15, h: 0.22, seg: 6 }, mat: 'cloak', pos: [0, 0.82, -0.02], rot: [0.25, 0, 0] },
    {
      prim: { kind: 'torus', r: 0.26, tube: 0.02, radSeg: 5, tubSeg: 10, arc: Math.PI * 1.1 },
      mat: 'bow',
      pos: [0, 0.5, -0.18],
      rot: [0, 0, Math.PI * 0.45],
    },
    { prim: { kind: 'box', w: 0.05, h: 0.3, d: 0.05 }, mat: 'quiver', pos: [0.18, 0.45, 0.12], rot: [0, 0, 0.4] },
  ],
  hooks: { 'hand.R': { pos: [0.2, 0.5, 0.1] } },
};

export const mage: ProceduralModelSpec = {
  id: 'mage',
  category: 'hero',
  standHeight: 1.1,
  tags: ['hero', 'caster'],
  palette: {
    ...BASE_PALETTE,
    ...EYE_PALETTE,
    ...WOOD_PALETTE,
    ring: ringMaterial('#b07ae0'),
    robe: { color: '#7d54b8' },
    skin: { color: '#e8d5b5' },
    orb: { color: '#caa6ff', emissive: '#9a5cff', emissiveIntensity: 0.9 },
  },
  parts: [
    ...tokenBase(),
    { prim: { kind: 'cone', r: 0.26, h: 0.6, seg: 7 }, mat: 'robe', pos: [0, 0.38, 0] },
    ...head('skin', 0.11, 0.75),
    { prim: { kind: 'cone', r: 0.2, h: 0.3, seg: 7 }, mat: 'robe', pos: [0, 0.95, 0] },
    {
      prim: { kind: 'torus', r: 0.17, tube: 0.035, radSeg: 5, tubSeg: 12 },
      mat: 'robe',
      pos: [0, 0.84, 0],
      rot: [Math.PI / 2, 0, 0],
    },
    ...staff(0.85, [0.27, 0, 0.08], 'wood', {
      prim: { kind: 'icosahedron', r: 0.07 },
      mat: 'orb',
    }),
  ],
  hooks: { 'hand.R': { pos: [0.27, 0.5, 0.08] } },
};

export const battleMage: ProceduralModelSpec = {
  id: 'battleMage',
  category: 'hero',
  standHeight: 1.03,
  tags: ['hero', 'caster'],
  palette: {
    ...BASE_PALETTE,
    ...EYE_PALETTE,
    ring: ringMaterial('#ff9d45'),
    robe: { color: '#8c3324' },
    plate: { color: '#4d4a55', metalness: 0.3 },
    circlet: { color: '#4d4a55', metalness: 0.4 },
    skin: { color: '#d8b89a' },
    ember: { color: '#ff7b33', emissive: '#ff5a1f', emissiveIntensity: 1.4 },
    orb: { color: '#ffb347', emissive: '#ff6a00', emissiveIntensity: 1.6 },
    darkWood: { color: '#4a3026' },
  },
  parts: [
    ...tokenBase(),
    { prim: { kind: 'cone', r: 0.26, h: 0.6, seg: 7 }, mat: 'robe', pos: [0, 0.38, 0] },
    { prim: { kind: 'box', w: 0.4, h: 0.08, d: 0.22 }, mat: 'plate', pos: [0, 0.62, 0] },
    ...head('skin', 0.11, 0.78),
    { prim: { kind: 'cylinder', rTop: 0.115, rBottom: 0.125, h: 0.07, seg: 8 }, mat: 'circlet', pos: [0, 0.86, 0] },
    // Ember shards orbiting the shoulders.
    ...([
      [-0.28, 0.7, 0.1],
      [0.3, 0.74, -0.06],
      [0.05, 0.95, 0.14],
    ] as const).map((pos) => ({
      prim: { kind: 'tetrahedron' as const, r: 0.05 },
      mat: 'ember',
      pos,
      rot: [0.5, 0.8, 0] as const,
    })),
    ...staff(0.9, [0.28, 0, 0.06], 'darkWood', {
      prim: { kind: 'icosahedron', r: 0.085 },
      mat: 'orb',
    }),
  ],
  hooks: { 'hand.R': { pos: [0.28, 0.5, 0.06] } },
};

export const frostMage: ProceduralModelSpec = {
  id: 'frostMage',
  category: 'hero',
  standHeight: 1.09,
  tags: ['hero', 'caster'],
  palette: {
    ...BASE_PALETTE,
    ...EYE_PALETTE,
    ring: ringMaterial('#9fd8ff'),
    robe: { color: '#d7e8f5' },
    mantle: { color: '#8fb8d8' },
    skin: { color: '#e9e2f2' },
    shard: { color: '#bfeaff', emissive: '#6fd2ff', emissiveIntensity: 1.1, opacity: 0.92 },
    crystal: { color: '#bfeaff', emissive: '#5fc8ff', emissiveIntensity: 1.5 },
    haft: { color: '#7d92a8' },
  },
  parts: [
    ...tokenBase(),
    { prim: { kind: 'cone', r: 0.26, h: 0.62, seg: 7 }, mat: 'robe', pos: [0, 0.39, 0] },
    { prim: { kind: 'cone', r: 0.27, h: 0.2, seg: 7 }, mat: 'mantle', pos: [0, 0.62, 0] },
    ...head('skin', 0.11, 0.8),
    { prim: { kind: 'cone', r: 0.16, h: 0.2, seg: 6 }, mat: 'robe', pos: [0, 0.96, -0.02], rot: [0.2, 0, 0] },
    // Floating ice shards.
    ...([
      [-0.3, 0.55, 0.05, 0.4],
      [0.32, 0.62, -0.08, 1.2],
      [-0.18, 0.92, -0.12, 0.8],
    ] as const).map(([x, y, z, r]) => ({
      prim: { kind: 'octahedron' as const, r: 0.06 },
      mat: 'shard',
      pos: [x, y, z] as const,
      rot: [r, r, 0] as const,
    })),
    ...staff(0.9, [0.28, 0, 0.06], 'haft', {
      prim: { kind: 'octahedron', r: 0.09 },
      mat: 'crystal',
    }),
  ],
  hooks: { 'hand.R': { pos: [0.28, 0.5, 0.06] } },
};

export const defender: ProceduralModelSpec = {
  id: 'defender',
  category: 'hero',
  standHeight: 1.06,
  tags: ['hero'],
  palette: {
    ...BASE_PALETTE,
    ...EYE_PALETTE,
    ring: ringMaterial('#7ad17a'),
    tunic: { color: '#8a6f4d' },
    belt: { color: '#5c4632' },
    satchel: { color: '#4a3a26' },
    skin: { color: '#e8c5a0' },
    hair: { color: '#5c4632' },
    tip: { color: '#7fc8ff', emissive: '#2f8fff', emissiveIntensity: 1.8 },
    haft: { color: '#3a4a5c' },
  },
  parts: [
    ...tokenBase(),
    { prim: { kind: 'cylinder', rTop: 0.2, rBottom: 0.24, h: 0.42, seg: 7 }, mat: 'tunic', pos: [0, 0.3, 0] },
    { prim: { kind: 'box', w: 0.3, h: 0.06, d: 0.2 }, mat: 'belt', pos: [0, 0.36, 0.08] },
    { prim: { kind: 'box', w: 0.16, h: 0.2, d: 0.08 }, mat: 'satchel', pos: [-0.2, 0.42, -0.1], rot: [0, 0, 0.3] },
    ...head('skin', 0.115, 0.66),
    // The legacy mop of hair is a half sphere; a full one at this scale reads the
    // same on a 0.115 head and keeps the primitive cache one entry smaller.
    { prim: { kind: 'sphere', r: 0.115, wSeg: 7, hSeg: 5 }, mat: 'hair', pos: [0, 0.7, 0] },
    ...staff(0.95, [0.28, 0, 0.05], 'haft', {
      prim: { kind: 'icosahedron', r: 0.075 },
      mat: 'tip',
    }),
  ],
  hooks: { 'hand.R': { pos: [0.28, 0.5, 0.05] } },
};

export const HERO_MODELS = [knight, rogue, mage, battleMage, frostMage, defender] as const;
