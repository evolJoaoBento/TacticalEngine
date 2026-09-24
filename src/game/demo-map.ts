/**
 * The demo's map: the woods leading into the Hollow Vault.
 *
 * The prototype's one-room map is still the heart of it - the marsh band, the vault wall with its
 * door at (12, 7), the plateau, the husks, the chest and the pillar all stand exactly where they
 * stood, so a save, a test or a memory of the place still finds them. Around that room this adds
 * what a demo of walking wants: a forest to the south to cross, a trail through it, a stream with
 * a ford, hillocks and an outcrop to climb, and deeper halls east of the vault door.
 *
 * Authored here rather than in `legacy/`, which is never edited: the old map is read for the room
 * it describes and copied in, tile for tile.
 *
 * Everything is worked out from the coordinates - no randomness - so the map is the same on every
 * run, which is what the tests and the saves need.
 */

import { demoMap } from '../../legacy/js/data.js';
import type { LegacyMap } from '../engine/scene/legacy-import';

/** How big the map is. The old room is its north-west corner. */
export const DEMO_MAP_WIDTH = 44;
export const DEMO_MAP_HEIGHT = 32;
/** The room the prototype drew, kept where it was. */
export const OLD_WIDTH = 22;
export const OLD_HEIGHT = 16;
/** The vault: its west wall, the last floor of its halls, and the wall along its south. */
export const VAULT_WEST_X = 12;
export const VAULT_EAST_X = 42;
export const VAULT_SOUTH_Y = 16;

/** The colours a tile is laid as road by: the trail's dirt and the water. Everything else is grass. */
export const BEATEN_TINTS: ReadonlySet<string> = new Set(['#7d6b4c', '#4a6b5d', '#41615a']);

const GRASS = '#5d8a4a';
const GRASS_DARK = '#4f7a45';
const GRASS_LIGHT = '#679a52';
const MARSH = '#4a6b5d';
const MARSH_DEEP = '#41615a';
const DIRT = '#7d6b4c';
const STONE = '#7a7f8c';
const STONE_PALE = '#70757f';
const DARK = '#565b6b';
const WALL = '#454a59';

interface Tile {
  h: number;
  color: string;
  prop: string | null;
}

interface Deco {
  type: string;
  x: number;
  y: number;
  rot: number;
}

/** A settled scatter: the same tile always answers the same, with no state to carry. */
function hash(x: number, y: number, salt: number): number {
  const n = Math.imul(x + 0x3b9a, 0x27d4eb2d) ^ Math.imul(y + 0x1f13, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1);
  return ((n ^ (n >>> 15)) >>> 0) % 1000;
}

/** The trail through the woods, as the corners it turns; a walk between them is painted a tile wide either side. */
const TRAIL: readonly (readonly [number, number])[] = [
  [3, 30], [6, 27], [5, 23], [9, 20], [7, 17], [4, 16],
];
/** The branch east, a long walk through the southern woods for anyone following the pointer. */
const BRANCH: readonly (readonly [number, number])[] = [
  [9, 20], [16, 23], [24, 26], [33, 23], [40, 27],
];
/** Where the stream runs, and the ford the trail crosses it by. */
const STREAM_X = [7, 8, 9] as const;
const FORD_Y = 27;

/** The map the demo plays on. */
export function hollowVaultMap(): LegacyMap {
  const old = demoMap() as unknown as { tiles: Tile[]; decos: Deco[]; nodes: unknown[]; enemies: unknown[]; triggers: unknown[]; spawns: number[][] };
  const tiles: Tile[] = [];
  for (let i = 0; i < DEMO_MAP_WIDTH * DEMO_MAP_HEIGHT; i++) tiles.push({ h: 0, color: GRASS, prop: null });
  const at = (x: number, y: number): Tile => tiles[y * DEMO_MAP_WIDTH + x]!;

  // The prototype's room, tile for tile, in the corner it always occupied.
  for (let y = 0; y < OLD_HEIGHT; y++) {
    for (let x = 0; x < OLD_WIDTH; x++) {
      const from = old.tiles[y * OLD_WIDTH + x]!;
      Object.assign(at(x, y), { h: from.h, color: from.color, prop: from.prop ?? null });
    }
  }

  const decos: Deco[] = [...old.decos];
  woods(at, decos);
  halls(at, decos);

  return {
    // The id is what a save names, so it stays what it has always been; the room is renamed, not replaced.
    id: 'the-husk-vault',
    name: 'The Hollow Vault',
    intro:
      'Pines close over the trail, and the stream runs black between them. East, past the marsh, the vault mouth stands open in the hillside - and the cold coming out of it has never seen the sun.',
    w: DEMO_MAP_WIDTH,
    h: DEMO_MAP_HEIGHT,
    tiles,
    decos,
    nodes: old.nodes,
    enemies: old.enemies,
    triggers: old.triggers,
    // The prototype stood three on the grass; the party is six, so there are six places to stand,
    // the first three exactly where they always were.
    spawns: [...old.spawns, [3, 8], [2, 6], [3, 6]],
  };
}

/** Everything south and west of the vault: forest floor, the stream, the trail, and what stands in them. */
function woods(at: (x: number, y: number) => Tile, decos: Deco[]): void {
  for (let y = OLD_HEIGHT; y < DEMO_MAP_HEIGHT; y++) {
    for (let x = 0; x < DEMO_MAP_WIDTH; x++) {
      const tile = at(x, y);
      const roll = hash(x, y, 1);
      tile.color = roll < 220 ? GRASS_DARK : roll < 320 ? GRASS_LIGHT : GRASS;
      // Hillocks: a tile higher here and there, in patches rather than speckles.
      if (hash(Math.floor(x / 4), Math.floor(y / 4), 2) < 95 && roll > 200) tile.h = 1;
      // Thickets: hard going, and where the pines stand thickest.
      if (hash(x, y, 3) < 130) tile.prop = 'difficult';
    }
  }

  // The stream, running south out of the marsh the old map already had, and difficult all the way.
  for (let y = OLD_HEIGHT; y < DEMO_MAP_HEIGHT; y++) {
    for (const x of STREAM_X) {
      const tile = at(x, y);
      tile.h = 0;
      tile.prop = 'difficult';
      tile.color = hash(x, y, 4) < 400 ? MARSH_DEEP : MARSH;
    }
  }

  // The outcrop: two tiles up, with a step round its west side - somewhere to jump off.
  for (let y = 21; y <= 24; y++) {
    for (let x = 19; x <= 22; x++) {
      at(x, y).h = 2;
      at(x, y).color = DARK;
      at(x, y).prop = null;
    }
  }
  for (const [x, y] of [[18, 22], [18, 23], [19, 25], [20, 25]] as const) {
    at(x, y).h = 1;
    at(x, y).color = DARK;
    at(x, y).prop = null;
  }

  trail(at, TRAIL);
  trail(at, BRANCH);
  // The ford: the trail crosses the stream on stones, and there the water is no trouble.
  for (const x of STREAM_X) {
    for (const y of [FORD_Y - 1, FORD_Y]) {
      at(x, y).prop = null;
      at(x, y).color = DIRT;
      at(x, y).h = 0;
    }
  }

  // Pines, where the ground is open and the trail is not: thicker in the thickets.
  for (let y = OLD_HEIGHT; y < DEMO_MAP_HEIGHT; y++) {
    for (let x = 0; x < DEMO_MAP_WIDTH; x++) {
      const tile = at(x, y);
      if (tile.color === DIRT || tile.h > 1 || STREAM_X.includes(x as 7)) continue;
      const roll = hash(x, y, 5);
      const wanted = tile.prop === 'difficult' ? 165 : 40;
      if (roll >= wanted) continue;
      decos.push({ type: roll % 7 === 0 ? 'withering-tree-prop' : 'tree-prop', x, y, rot: (roll % 100) / 16 });
    }
  }

  // Landmarks, and the camp somebody left in the clearing by the trail.
  const standing: readonly (readonly [string, number, number])[] = [
    ['tree-prop', 12, 20], ['tree-prop', 27, 19], ['tree-prop', 36, 30], ['tree-prop', 2, 26],
    ['withering-tree-prop', 15, 28], ['withering-tree-prop', 31, 29], ['withering-tree-prop', 24, 17],
    ['rock-prop', 11, 25], ['rock-prop', 25, 22], ['rock-prop', 38, 19], ['rock-prop', 17, 30], ['rock-prop', 5, 19],
    ['camp-fire-prop', 4, 22], ['cart-prop', 2, 21], ['crate-prop', 3, 24], ['barrel-prop', 5, 25], ['withering-tree-prop', 13, 24],
  ];
  for (const [type, x, y] of standing) {
    const tile = at(x, y);
    tile.prop = null;
    if (tile.h > 1) tile.h = 1;
    decos.push({ type, x, y, rot: (hash(x, y, 6) % 100) / 16 });
  }
}

/** Paint a trail along these corners: dirt, level, and easy going. */
function trail(at: (x: number, y: number) => Tile, corners: readonly (readonly [number, number])[]): void {
  for (let i = 0; i + 1 < corners.length; i++) {
    const [ax, ay] = corners[i]!;
    const [bx, by] = corners[i + 1]!;
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 4;
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(ax + ((bx - ax) * s) / steps);
      const y = Math.round(ay + ((by - ay) * s) / steps);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]] as const) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < OLD_HEIGHT || tx >= DEMO_MAP_WIDTH || ty >= DEMO_MAP_HEIGHT) continue;
        const tile = at(tx, ty);
        if (tile.h > 1) continue;
        tile.h = 0;
        tile.prop = null;
        tile.color = DIRT;
      }
    }
  }
}

/** East of the old room: the halls the vault opens into, and the wall that shuts them off from the woods. */
function halls(at: (x: number, y: number) => Tile, decos: Deco[]): void {
  for (let y = 0; y < VAULT_SOUTH_Y; y++) {
    for (let x = OLD_WIDTH; x < DEMO_MAP_WIDTH; x++) {
      const tile = at(x, y);
      tile.h = 0;
      tile.prop = null;
      tile.color = hash(x, y, 7) < 180 ? STONE_PALE : STONE;
    }
  }
  const wall = (x: number, y: number): void => {
    const tile = at(x, y);
    tile.h = 4;
    tile.color = WALL;
    tile.prop = null;
  };
  // Shut in: along the north of the new halls, down their east end, and the whole south face.
  for (let x = OLD_WIDTH; x < DEMO_MAP_WIDTH; x++) wall(x, 0);
  for (let y = 0; y <= VAULT_SOUTH_Y; y++) wall(DEMO_MAP_WIDTH - 1, y);
  for (let x = VAULT_WEST_X; x < DEMO_MAP_WIDTH; x++) wall(x, VAULT_SOUTH_Y);

  // Two cross-walls with doorways, so the halls are rooms rather than one long box.
  for (let y = 1; y < VAULT_SOUTH_Y; y++) {
    if (y !== 7 && y !== 8) wall(28, y);
    if (y !== 4 && y !== 11) wall(36, y);
  }

  // The dais at the far end, a step up between its braziers.
  for (let y = 6; y <= 9; y++) for (let x = 38; x <= 41; x++) at(x, y).h = 1;
  for (const [type, x, y] of [
    ['standing-torch-prop', 30, 6], ['standing-torch-prop', 30, 9], ['standing-torch-prop', 38, 5], ['standing-torch-prop', 41, 10],
    ['banner-prop', 29, 2], ['banner-prop', 29, 13], ['banner-prop', 37, 1], ['banner-prop', 37, 14],
    ['crate-prop', 26, 12], ['barrel-prop', 27, 13], ['crate-prop', 33, 2], ['barrel-prop', 34, 2],
    ['pillar-prop', 32, 7], ['training-dummy-prop', 24, 4],
  ] as const) {
    at(x, y).prop = null;
    decos.push({ type, x, y, rot: (hash(x, y, 8) % 100) / 16 });
  }
}
