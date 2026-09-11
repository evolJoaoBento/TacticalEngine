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
 * Combat holds the tools the editor had before the shell; part 4 of the rebuild
 * replaces them. Erase is in Terrain and Combat both, and what it removes
 * depends on which mode it is used in. Interaction keeps Select so a click on the
 * board still picks an object out.
 *
 * Terrain's list is the union of what its tabs offer: `TERRAIN_TAB_TOOL` names
 * the tool each tab puts in hand and `TERRAIN_RAIL` the ones it shows beside it,
 * and between them the tabs partition this list. A tool missing from both would
 * be a tool the user can hold and never see, which `modes.test.ts` forbids.
 */
export const MODE_TOOLS: Readonly<Record<EditorMode, readonly EditorTool[]>> = {
  inspect: ['select'],
  terrain: ['buildTile', 'eraseTile', 'paintTerrain', 'raise', 'lower', 'prop', 'interactable', 'erase'],
  combat: ['adversary', 'trigger', 'spawn', 'erase'],
  interaction: ['select'],
};

/**
 * The four things Terrain can put down, each a tab of the strip along the bottom.
 *
 * The open tab, not a rail button, decides what a click on the board places -
 * the TaleSpire arrangement the user asked for. That makes tab and tool two
 * views of one fact, so the mapping is data here rather than a ternary in a
 * view, and `terrainTabOf` is the only way back from a tool to its tab.
 */
export type TerrainTab = 'tiles' | 'ground' | 'props' | 'objects';

/** The strip's order, left to right. */
export const TERRAIN_TABS: readonly TerrainTab[] = ['tiles', 'ground', 'props', 'objects'];

/** The tool opening a tab puts in hand: what a plain click on the board then does. */
export const TERRAIN_TAB_TOOL: Readonly<Record<TerrainTab, EditorTool>> = {
  tiles: 'buildTile',
  ground: 'paintTerrain',
  props: 'prop',
  objects: 'interactable',
};

/** What the rail offers beside each tab: the same subject's other verbs. */
export const TERRAIN_RAIL: Readonly<Record<TerrainTab, readonly EditorTool[]>> = {
  tiles: ['eraseTile'],
  ground: ['raise', 'lower'],
  props: ['erase'],
  objects: ['erase'],
};

/** Whether a strip's tab id is one of Terrain's, so a view can narrow without a cast. */
export function isTerrainTab(id: string): id is TerrainTab {
  return (TERRAIN_TABS as readonly string[]).includes(id);
}

/**
 * The tab a terrain tool belongs to.
 *
 * Erase belongs to Props and to Objects, so a tool the current tab already owns
 * keeps that tab: picking Erase from the Objects rail must not jump the strip to
 * Props. A tool no tab owns - a Combat tool, say - leaves the tab alone.
 */
export function terrainTabOf(tool: EditorTool, current: TerrainTab): TerrainTab {
  if (ownsTool(current, tool)) return current;
  return TERRAIN_TABS.find((tab) => ownsTool(tab, tool)) ?? current;
}

function ownsTool(tab: TerrainTab, tool: EditorTool): boolean {
  return TERRAIN_TAB_TOOL[tab] === tool || TERRAIN_RAIL[tab].includes(tool);
}

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
