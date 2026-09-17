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
  'eraseTile',
  'select',
  'placeTile',
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
    // Not select any more: every mode owns it now, so it can never demonstrate the fallback
    // to the first mode in the bar that does. Spawn still can.
    expect(modeOfTool('spawn', 'terrain')).toBe('combat');
  });

  it('let Terrain select and drag without leaving the mode', () => {
    // Laying a room out means nudging what is already in it, and leaving the mode to do
    // that is the trip the user asked to be rid of.
    expect(MODE_TOOLS.terrain).toContain('select');
    // Not first: entering Terrain still hands over the placer.
    expect(defaultTool('terrain')).toBe('placeTile');
    expect(modeOfTool('select', 'terrain')).toBe('terrain');
    // On every tab's rail, so reaching for it never moves the strip out from under you.
    for (const tab of TERRAIN_TABS) {
      expect(TERRAIN_RAIL[tab], tab).toContain('select');
      expect(terrainTabOf('select', tab), tab).toBe(tab);
    }
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
      expect(terrainTabOf(tool, 'tiles'), tool).toBe(owner);
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
    expect(terrainTabOf('adversary', 'props')).toBe('props');
  });

  it('put the ground and the things stacked on it in one tab', () => {
    // There were two: Structures stamped pieces a walk ignored, Tiles painted the ground a
    // walk was costed on. A kind of tile carries its own structure now, so the choice
    // between the tabs became a choice between kinds of tile within one.
    expect(TERRAIN_TABS).toEqual(['tiles', 'props', 'objects']);
    expect(TERRAIN_TAB_TOOL.tiles).toBe('placeTile');
    // Raise and Lower came with the ground they move; there is no second tab for them now.
    // Select is last and on every tab, so it is not one of this tab's own verbs.
    expect(TERRAIN_RAIL.tiles).toEqual(['eraseTile', 'raise', 'lower', 'select']);
  });

  it('recognise their own ids and no others', () => {
    for (const tab of TERRAIN_TABS) expect(isTerrainTab(tab)).toBe(true);
    expect(isTerrainTab('creatures')).toBe(false);
  });
});
