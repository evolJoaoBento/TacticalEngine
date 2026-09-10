import { describe, it, expect } from 'vitest';
import type { EditorTool } from './controller';
import { EDITOR_MODES, MODE_LABELS, MODE_TOOLS, defaultTool, modeOfTool } from './modes';

const ALL_TOOLS: readonly EditorTool[] = [
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
