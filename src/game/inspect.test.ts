import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene } from './demo-scene';
import { inspection } from './inspect';
import { interactablesOf } from '../engine/scene/prop-functions';

describe('what a right-click shows', () => {
  const demo = buildDemoScene(hollowVaultMap(), 'demo');

  it('reads a party member as a character: class and level, pools, gear', () => {
    const id = demo.party.selected!;
    const card = inspection(demo, id, null)!;
    expect(card.kind).toBe('character');
    expect(card.id).toBe(id);
    expect(card.line).toMatch(/level \d/);
    expect(card.facts[0]).toMatch(/^HP \d+\/\d+$/);
    expect(card.text).toContain(' · ');
  });

  it('reads a creature by its stat block, with the cards it prints', () => {
    const foe = [...demo.state.allEntities()].find((e) => e.faction === 'adversary')!;
    const card = inspection(demo, foe.id, null)!;
    expect(card.kind).toBe('adversary');
    expect(card.line).toMatch(/^Tier \d /);
    expect(card.facts.some((f) => f.startsWith('Difficulty '))).toBe(true);
    expect(card.cards).toBeDefined();
  });

  it('reads an object by its name and kind, and finds nothing on bare ground', () => {
    const object = interactablesOf(demo.scene)[0]!;
    expect(inspection(demo, null, object.id)).toMatchObject({ kind: 'object', id: object.id, line: object.kind });
    expect(inspection(demo, null, null)).toBeNull();
  });
});
