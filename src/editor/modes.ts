/**
 * The editor's modes, and which tools each one owns.
 *
 * The top bar switches between four ways of working on a room, in the order the
 * user set: look at and change what is there, shape the ground, set up a fight,
 * and write what things say and do. A tool belongs to a mode, so choosing a tool
 * chooses its mode too - the two can never disagree.
 */

import type { EditorTool } from './controller';

/** The four ways of working on a room; a tool always belongs to exactly one. */
export type EditorMode = 'inspect' | 'terrain' | 'combat' | 'interaction';

/** The top bar's order, which is also the number keys'. */
export const EDITOR_MODES: readonly EditorMode[] = ['inspect', 'terrain', 'combat', 'interaction'];

/** What the top bar's tab reads for each mode. */
export const MODE_LABELS: Readonly<Record<EditorMode, string>> = {
  inspect: 'Inspector',
  terrain: 'Terrain',
  combat: 'Combat',
  interaction: 'Interaction',
};

/**
 * The tools each mode offers, its default first.
 *
 * Terrain and Combat hold the tools the editor had before the shell; parts 3
 * and 4 of the rebuild replace them. Erase is in both, and what it removes
 * depends on which mode it is used in. Interaction keeps Select so a click on the
 * board still picks an object out.
 */
export const MODE_TOOLS: Readonly<Record<EditorMode, readonly EditorTool[]>> = {
  inspect: ['select'],
  terrain: ['buildTile', 'eraseTile', 'paintTerrain', 'raise', 'lower', 'prop', 'interactable', 'erase'],
  combat: ['adversary', 'trigger', 'spawn', 'erase'],
  interaction: ['select'],
};

/** The tool a mode opens with, and the one a switch into it falls back to. */
export function defaultTool(mode: EditorMode): EditorTool {
  return MODE_TOOLS[mode][0]!;
}

/**
 * The mode a tool belongs to. A tool two modes share stays in the current mode
 * when that mode owns it; otherwise it goes to the first mode in the bar that does.
 */
export function modeOfTool(tool: EditorTool, current: EditorMode): EditorMode {
  if (MODE_TOOLS[current].includes(tool)) return current;
  return EDITOR_MODES.find((mode) => MODE_TOOLS[mode].includes(tool)) ?? current;
}
