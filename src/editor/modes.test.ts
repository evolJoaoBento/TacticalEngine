import { describe, it, expect } from 'vitest';
import type { EditorTool } from './controller';
import {
  EDITOR_MODES,
  MODE_LABELS,
  MODE_TOOLS,
  TERRAIN_RAIL,
  TERRAIN_TABS,
  TERRAIN_TAB_TOOL,
  defaultTool,
  isTerrainTab,
  modeOfTool,
  terrainTabOf,
} from './modes';

const ALL_TOOLS: readonly EditorTool[] = [
  'buildTile',
  'eraseTile',
  'select',
  'paintTerrain',
  'raise',
  'lower',
  'prop',
  'spawn',
  'interactable',
  'adversary',
  'trigger',
  'erase',
];

describe('editor modes', () => {
  it('are the four the user named, in their order', () => {
    expect(EDITOR_MODES).toEqual(['inspect', 'terrain', 'combat', 'interaction']);
    expect(EDITOR_MODES.map((mode) => MODE_LABELS[mode])).toEqual(['Inspector', 'Terrain', 'Combat', 'Interaction']);
  });

  it('give every tool a home', () => {
    for (const tool of ALL_TOOLS) {
      expect(EDITOR_MODES.some((mode) => MODE_TOOLS[mode].includes(tool)), tool).toBe(true);
    }
  });

  it('default to a tool they own', () => {
    for (const mode of EDITOR_MODES) expect(MODE_TOOLS[mode]).toContain(defaultTool(mode));
  });

  it('let Combat select a creature without changing the tool it opens with', () => {
    expect(MODE_TOOLS.combat).toContain('select');
    // Select is not first: entering Combat still hands over creature placement.
    expect(defaultTool('combat')).toBe('adversary');
    // And select stays put rather than throwing the user back to the Inspector.
    expect(modeOfTool('select', 'combat')).toBe('combat');
  });

  it('find the mode a tool belongs to', () => {
    expect(modeOfTool('raise', 'inspect')).toBe('terrain');
    expect(modeOfTool('adversary', 'terrain')).toBe('combat');
    expect(modeOfTool('select', 'terrain')).toBe('inspect');
  });

  it('keep a shared tool in the mode that already owns it', () => {
    expect(modeOfTool('erase', 'combat')).toBe('combat');
    expect(modeOfTool('erase', 'terrain')).toBe('terrain');
    expect(modeOfTool('erase', 'inspect')).toBe('terrain');
    expect(modeOfTool('select', 'interaction')).toBe('interaction');
  });
});

describe("terrain's tabs", () => {
  it('give every terrain tool a tab, so nothing can be held and not shown', () => {
    for (const tool of MODE_TOOLS.terrain) {
      const owner = TERRAIN_TABS.find((tab) => TERRAIN_TAB_TOOL[tab] === tool || TERRAIN_RAIL[tab].includes(tool));
      expect(owner, tool).toBeDefined();
      expect(terrainTabOf(tool, 'tiles'), tool).toBe(tool === 'buildTile' || tool === 'eraseTile' ? 'tiles' : owner);
    }
  });

  it('cover exactly the tools Terrain owns, and nothing else', () => {
    const offered = new Set([
      ...TERRAIN_TABS.map((tab) => TERRAIN_TAB_TOOL[tab]),
      ...TERRAIN_TABS.flatMap((tab) => [...TERRAIN_RAIL[tab]]),
    ]);
    expect([...offered].sort()).toEqual([...MODE_TOOLS.terrain].sort());
  });

  it('keep Erase in the tab that already offers it', () => {
    expect(terrainTabOf('erase', 'tiles')).toBe('props');
    expect(terrainTabOf('erase', 'objects')).toBe('objects');
    expect(terrainTabOf('erase', 'props')).toBe('props');
  });

  it("leave the tab alone for a tool no tab owns", () => {
    expect(terrainTabOf('adversary', 'ground')).toBe('ground');
  });

  it('recognise their own ids and no others', () => {
    for (const tab of TERRAIN_TABS) expect(isTerrainTab(tab)).toBe(true);
    expect(isTerrainTab('creatures')).toBe(false);
  });
});
