/**
 * What the editor draws for things that have no body of their own: a place the party starts, and an
 * object with no model. Neither is drawn in play - a party start is where the party stands, and an
 * object with no model is present but invisible - but an author has to see them to pick them up.
 *
 * The party start is the legacy editor's blue ring (r .22-.36, `#5fb0ff`) with a pawn standing in
 * it, so it is something to take hold of and not a decal; the object is a gold ring round a plinth
 * with a gem over it, the mark games put on a thing to use.
 */

import type { ProceduralModelSpec } from './procedural/spec';

export const PARTY_START_MARK: ProceduralModelSpec = {
  id: 'party-start-mark',
  category: 'node',
  standHeight: 0.6,
  tags: [],
  info: { name: 'Party start', desc: 'Where the party arrives in this room.' },
  palette: {
    ring: { color: '#5fb0ff', emissive: '#5fb0ff', emissiveIntensity: 0.6, opacity: 0.8 },
    body: { color: '#8cc6ff', emissive: '#2a6fb0', emissiveIntensity: 0.45, roughness: 0.6, opacity: 0.85 },
  },
  parts: [
    { prim: { kind: 'torus', r: 0.29, tube: 0.07, radSeg: 6, tubSeg: 28 }, mat: 'ring', pos: [0, 0.045, 0], rot: [Math.PI / 2, 0, 0], castShadow: false },
    { prim: { kind: 'cylinder', rTop: 0.09, rBottom: 0.16, h: 0.34, seg: 14 }, mat: 'body', pos: [0, 0.17, 0] },
    { prim: { kind: 'sphere', r: 0.11, wSeg: 14, hSeg: 10 }, mat: 'body', pos: [0, 0.46, 0] },
  ],
};

export const OBJECT_MARK: ProceduralModelSpec = {
  id: 'object-mark',
  category: 'node',
  standHeight: 0.72,
  tags: [],
  info: { name: 'Object', desc: 'An object with no model of its own.' },
  palette: {
    ring: { color: '#e0b64a', emissive: '#e0b64a', emissiveIntensity: 0.5, opacity: 0.85 },
    stone: { color: '#5a5f6e', roughness: 0.9 },
    gem: { color: '#f2cf6b', emissive: '#b8871f', emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.2 },
  },
  parts: [
    { prim: { kind: 'torus', r: 0.3, tube: 0.04, radSeg: 6, tubSeg: 28 }, mat: 'ring', pos: [0, 0.04, 0], rot: [Math.PI / 2, 0, 0], castShadow: false },
    { prim: { kind: 'cylinder', rTop: 0.12, rBottom: 0.16, h: 0.3, seg: 8 }, mat: 'stone', pos: [0, 0.15, 0] },
    { prim: { kind: 'octahedron', r: 0.15 }, mat: 'gem', pos: [0, 0.55, 0] },
  ],
};

/**
 * The base a creature stands on: the faction ring the procedural tokens carry, so an
 * imported model reads as one of the board's own. Drawn under a token in play, and under
 * the picture the Models panel shows of a file that has just been imported.
 */
export const RING_ONLY: ProceduralModelSpec = {
  id: 'ring',
  category: 'prop',
  standHeight: 0,
  tags: [],
  info: { name: 'Ring', desc: '' },
  palette: { ring: { color: '#ffffff' } },
  parts: [{ prim: { kind: 'cylinder', rTop: 0.42, rBottom: 0.42, h: 0.05, seg: 24 }, mat: 'ring', pos: [0, 0.025, 0] }],
};

/**
 * A tile under a previewed model: the ground it will stand on, so the picture shows
 * where a thing sits rather than only what it is.
 */
export const TILE_UNDER: ProceduralModelSpec = {
  id: 'tile-under',
  category: 'prop',
  standHeight: 0,
  tags: [],
  info: { name: 'Tile', desc: '' },
  palette: { ground: { color: '#3c4048' }, edge: { color: '#585e69' } },
  parts: [
    { prim: { kind: 'box', w: 1, h: 0.04, d: 1 }, mat: 'ground', pos: [0, -0.02, 0], castShadow: false },
    { prim: { kind: 'box', w: 1.04, h: 0.012, d: 0.04 }, mat: 'edge', pos: [0, 0.002, 0.5], castShadow: false },
    { prim: { kind: 'box', w: 1.04, h: 0.012, d: 0.04 }, mat: 'edge', pos: [0, 0.002, -0.5], castShadow: false },
    { prim: { kind: 'box', w: 0.04, h: 0.012, d: 1.04 }, mat: 'edge', pos: [0.5, 0.002, 0], castShadow: false },
    { prim: { kind: 'box', w: 0.04, h: 0.012, d: 1.04 }, mat: 'edge', pos: [-0.5, 0.002, 0], castShadow: false },
  ],
};
