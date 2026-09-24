/**
 * Scenery props, ported from `legacy/js/models.js`.
 *
 * What is left of the port: the pillar, the one prop the shipped maps place that no imported model
 * has replaced yet. The pine, the dead tree, the barrel, the crate, the brazier, the cart, the
 * training dummy, the door, the chest, the portal, the banner, the rock and the campfire were retired
 * for the models in `public/models` that took their places (`tree-prop`, `withering-tree-prop`,
 * `barrel-prop`, `crate-prop`, `standing-torch-prop`, `cart-prop`, `training-dummy-prop`,
 * `door-prop`, `chest-prop`, `portal-prop`, `banner-prop`, `rock-prop`, `camp-fire-prop`); a project
 * that still names one is renamed as it opens (`RETIRED_MODELS`).
 * The remaining legacy props (piano, throne, hut, spotlight, barrier, gate, spectator,
 * floorboard, trunk) belong to the one-shot and follow when that campaign is ported.
 */

import type { ProceduralModelSpec } from '../spec';

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

export const PROP_MODELS = [pillar];
