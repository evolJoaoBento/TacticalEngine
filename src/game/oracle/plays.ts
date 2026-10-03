/**
 * The page's own game's rules - every intent it plays - in one place (`docs/SERVER.md`, phase 4, slice 3).
 *
 * The page plays the engine built to WebAssembly; its own TypeScript game is the oracle the Rust is held to,
 * loaded only in development and only by `oracle/local-game.ts`. A table names these as a type
 * (`Plays`, `client.ts`), never imports them, so the page's bundle carries none of them.
 */

export { answerPending, attackWithSelected, endTurn, moveSelectedTo, useSelectedOn } from '../demo-scene';
export { arrive, jumpTo, startEncounter } from '../movement';
export { approachThenUse, arrived, cancelApproach } from '../arrival';
export { travelTo } from '../room';
export { note } from '../log';
export { applyLevelUp } from '../level-up';
export { equipItem, unequipItem } from '../equip';
export { useItem } from '../use-item';
export { rest, swapCard, useAbility } from '../demo-abilities';
export { loadGameText } from '../save';
export { closeContainer, takeFromContainer } from '../prop-use';
export { sellTo } from '../shop';
export { syncTalks } from '../talks';
export { landWalkers } from '../land';
export { dropCard } from '../party-drop';
