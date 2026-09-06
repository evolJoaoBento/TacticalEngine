/**
 * The room beyond the vault.
 *
 * Authored as document data and parsed through `sceneSchema`, the way a project
 * file would hold it — the demo's other scene comes from the legacy importer, so
 * this is also a check that a hand-written scene and an imported one are the same
 * kind of thing.
 *
 * Small on purpose: what it exists to prove is that the party can leave a room
 * and come back to find it as they left it.
 */

import { sceneSchema, type SceneDoc } from '../engine/scene/schema';

export const PIT_SCENE_ID = 'the-pit';

const W = 10;
const H = 8;

/** A ring of wall around an open floor, with a ledge along the north wall. */
function terrain(): string[] {
  const tiles: string[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      tiles.push(edge ? 'wall' : 'floor');
    }
  }
  return tiles;
}

function heights(): number[] {
  const levels: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      // The south wall is the one the camera looks through, so it is a lip rather
      // than a wall — a room whose own party is hidden behind masonry is not a
      // room anyone can play. The rest stand tall.
      const south = y === H - 1;
      levels.push(edge ? (south ? 1 : 4) : y === 1 ? 1 : 0);
    }
  }
  return levels;
}

export const PIT_SCENE: SceneDoc = sceneSchema.parse({
  id: PIT_SCENE_ID,
  name: 'The Sounding Pit',
  intro:
    'The stair gives out into a round chamber. Water moves somewhere below, and the walls carry every sound twice.',
  width: W,
  height: H,
  terrain: terrain(),
  heights: heights(),
  spawns: [
    { x: 2, y: 6 },
    { x: 3, y: 6 },
    { x: 4, y: 6 },
  ],
  decos: [
    { model: 'crate', position: { x: 7, y: 5 }, rotation: 0 },
    { model: 'barrel', position: { x: 8, y: 5 }, rotation: 0 },
    { model: 'campfire', position: { x: 5, y: 3 }, rotation: 0 },
  ],
  interactables: [
    {
      id: 'stair-up',
      kind: 'portal',
      position: { x: 2, y: 5 },
      name: 'The stair up',
      flavor: 'The steps you came down. They go back.',
      blocksMovement: false,
      model: null,
      // Filled in by the demo builder, which is the only thing that knows the
      // vault's imported id.
      effects: [],
    },
    {
      id: 'strongbox',
      kind: 'chest',
      position: { x: 7, y: 2 },
      name: 'A banded strongbox',
      flavor: 'Someone left in a hurry, and left this behind.',
      // The key the Warden gives up, if the party talked it round.
      requiresKey: 'wardens-word',
      lockedText: 'The lid will not shift. Whatever holds it is not a lock.',
      effects: [
        { kind: 'log', text: 'The word you were given does the work for you.', tone: 'hope' },
        { kind: 'loot' },
      ],
    },
  ],
});
