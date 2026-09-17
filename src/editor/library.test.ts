import { describe, it, expect } from 'vitest';
import { OBJECT_KINDS, creatureTabs, filterLibrary, tilesTab, objectsTab, propsTab, titleCase } from './library';

const CREATURES = [
  { id: 'jagged-knife-bandit', name: 'Jagged Knife Bandit', tier: 1 as const, role: 'standard' as const },
  { id: 'acid-burrower', name: 'Acid Burrower', tier: 1 as const, role: 'solo' as const },
  { id: 'dire-wolf', name: 'Dire Wolf', tier: 1 as const, role: 'skulk' as const },
  { id: 'vault-guardian-sentinel', name: 'Vault Guardian Sentinel', tier: 3 as const, role: 'bruiser' as const },
];

describe('the library', () => {
  it('marks the kinds of tile that stack, and finds them by what they are', () => {
    // Structures used to be a tab of its own listing four shapes with ids like
    // `tile-stairs`. They are kinds of tile now, so what says a card stacks is the kind
    // naming a structure - and searching for the old words still finds it.
    const tab = tilesTab([
      { id: 'floor', name: 'Floor', color: '#5d8a4a' },
      { id: 'rampart', name: 'Rampart', color: '#7d7a6d', structure: 'wall' },
    ]);
    // The ground is not on the strip at all: the placer puts down structures and nothing
    // else, so a card for a kind of ground would do nothing when it was clicked.
    expect(tab.items.map((item) => item.id)).toEqual(['rampart']);
    expect(filterLibrary([tab], 'building').map((item) => item.id)).toEqual(['rampart']);
    expect(filterLibrary([tab], 'structure wall').map((item) => item.id)).toEqual(['rampart']);
  });

  it('offers nothing when no kind of tile is a structure', () => {
    // A project can declare a palette of pure ground - every project did, before kinds and
    // structures were one thing. The strip is then empty rather than full of dead cards,
    // and the placer's own panel is where that is explained.
    expect(tilesTab([{ id: 'floor', name: 'Floor' }, { id: 'lava' }]).items).toEqual([]);
  });
  it('names ids the way a person would', () => {
    expect(titleCase('deadTree')).toBe('Dead Tree');
    expect(titleCase('rot-hound')).toBe('Rot Hound');
    expect(titleCase('wall')).toBe('Wall');
  });

  it('shows each kind as a swatch, in the colour it declares', () => {
    const tab = tilesTab([
      { id: 'floor', name: 'Floor', color: '#5d8a4a', structure: 'floor' },
      { id: 'lava', name: 'Lava', color: '#c4441f', structure: 'block' },
      // No colour of its own, and no table to look one up in: it takes the fallback.
      { id: 'water', structure: 'block' },
    ]);
    expect(tab.id).toBe('tiles');
    expect(tab.items.map((i) => [i.id, i.label, i.swatch, i.tab])).toEqual([
      ['floor', 'Floor', '#5d8a4a', 'tiles'],
      ['lava', 'Lava', '#c4441f', 'tiles'],
      ['water', 'Water', '#5d8a4a', 'tiles'],
    ]);
  });

  it('takes the name a kind of tile was given, and titles its id when it has none', () => {
    const tab = tilesTab([
      { id: 'deep-water', name: 'Deep Water', structure: 'block' },
      { id: 'rot-marsh', structure: 'block' },
    ]);
    expect(tab.items.map((i) => i.label)).toEqual(['Deep Water', 'Rot Marsh']);
  });

  it('lists imported models after the built-in props, and says so', () => {
    const tab = propsTab(['barrel', 'deadTree'], ['duck']);
    expect(tab.items.map((i) => i.label)).toEqual(['Barrel', 'Dead Tree', 'Duck']);
    expect(tab.items[2]!.detail).toBe('imported');
  });

  it('offers every kind of object', () => {
    expect(objectsTab().items.map((i) => i.id)).toEqual([...OBJECT_KINDS]);
    expect(OBJECT_KINDS).toEqual(['chest', 'door', 'pillar', 'portal', 'scripted']);
  });

  it('files creatures by tier, by name, with their role', () => {
    const tabs = creatureTabs(CREATURES);
    expect(tabs.map((t) => t.id)).toEqual(['tier-1', 'tier-2', 'tier-3', 'tier-4']);
    expect(tabs[0]!.items.map((i) => i.label)).toEqual(['Acid Burrower', 'Dire Wolf', 'Jagged Knife Bandit']);
    expect(tabs[0]!.items[0]!.detail).toBe('T1 · Solo');
    expect(tabs[1]!.items).toEqual([]);
    expect(tabs[2]!.items.map((i) => i.id)).toEqual(['vault-guardian-sentinel']);
  });

  it('searches every tab at once, every word, any case', () => {
    const tabs = creatureTabs(CREATURES);
    expect(filterLibrary(tabs, 'wolf').map((i) => i.id)).toEqual(['dire-wolf']);
    expect(filterLibrary(tabs, 'VAULT sentinel').map((i) => i.id)).toEqual(['vault-guardian-sentinel']);
    // A role is searchable though it is not in the name.
    expect(filterLibrary(tabs, 'bruiser').map((i) => i.id)).toEqual(['vault-guardian-sentinel']);
    expect(filterLibrary(tabs, 'tier 3').map((i) => i.id)).toEqual(['vault-guardian-sentinel']);
  });

  it('finds nothing for an empty search, so the strip shows the open tab instead', () => {
    expect(filterLibrary(creatureTabs(CREATURES), '   ')).toEqual([]);
  });
});
