/**
 * Bringing authored encounters into a running game.
 *
 * The work lives in `room.ts`, beside `install` and `buildRuntime`, which call
 * it on every entry into a scene. This file is the name the rest of the game
 * asks for it by; it used to be needed to keep a cycle out of `demo-scene.ts`,
 * and stays only so its importers do not move.
 */

export { syncAuthoredEncounters } from './room';
