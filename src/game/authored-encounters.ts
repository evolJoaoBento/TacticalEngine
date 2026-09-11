/**
 * Bringing authored encounters into a running game.
 *
 * The work itself lives in `demo-scene.ts`, beside `install` and the scene
 * builders that have to call it and beside `SRD_ADVERSARIES`, which it reads;
 * importing it the other way round would put a cycle between the two modules.
 * This file is the name the rest of the game asks for it by.
 */

export { syncAuthoredEncounters } from './demo-scene';
