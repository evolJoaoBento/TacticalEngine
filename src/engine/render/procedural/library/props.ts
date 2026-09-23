/**
 * Scenery props, ported from `legacy/js/models.js`.
 *
 * What is left of the port: the four the shipped maps place that no imported model has replaced
 * yet. The pine, the dead tree, the barrel, the crate, the brazier, the cart, the training dummy,
 * the door, the chest and the portal were retired for the models in `public/models` that took
 * their places (`tree-prop`, `withering-tree-prop`, `barrel-prop`, `crate-prop`,
 * `standing-torch-prop`, `cart-prop`, `training-dummy-prop`, `door-prop`, `chest-prop`,
 * `portal-prop`); a project that still names one is renamed as it opens (`RETIRED_MODELS`).
 * The remaining legacy props (piano, throne, hut, spotlight, barrier, gate, spectator,
 * floorboard, trunk) belong to the one-shot and follow when that campaign is ported.
 */

import type { ProceduralModelSpec } from '../spec';

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

export const PROP_MODELS = [rock, banner, campfire, pillar];
