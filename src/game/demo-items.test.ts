import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { tileOf } from '../engine/scene/grid-from-scene';
import { validateProject } from '../editor/validate';
import { buildDemoScene, useSelectedOn, type DemoScene } from './demo-scene';
import { startEncounter } from './movement';
import { useItem } from './use-item';

/**
 * Using what is carried.
 *
 * A draught is the whole story: it comes out of the pack, it heals whoever
 * drank it, it says so, and in a fight it costs the turn.
 */

const DRAUGHT = 'healing-draught';
const scene = (seed = 'demo'): DemoScene => buildDemoScene(demoMap(), seed);

function wounded(demo: DemoScene, marks = 3): string {
  const id = demo.party.selected!;
  demo.state.entity(id)!.hitPoints.marked = marks;
  return id;
}

describe('using an item', () => {
  it('ships a draught whose use validates clean', () => {
    const demo = scene();
    expect(demo.project.items.find((i) => i.id === DRAUGHT)!.use.length).toBeGreaterThan(0);
    expect(validateProject(demo.project).filter((p) => p.entity === DRAUGHT)).toEqual([]);
  });

  it('heals the one who drinks it, and spends the draught', () => {
    const demo = scene();
    const kara = wounded(demo, 3);
    demo.world.addItem(DRAUGHT, 2);
    const result = useItem(demo, DRAUGHT);
    expect(result.status).toBe('done');
    expect(demo.state.entity(kara)!.hitPoints.marked).toBe(1);
    expect(demo.scenario.items.get(DRAUGHT)).toBe(1);
    expect(demo.log.map((l) => l.text)).toContain('Kara uses the Healing draught.');
    expect(demo.log.map((l) => l.text)).toContain('Iron and mint. The cuts close.');
  });

  it('heals whoever is selected, not the first party member', () => {
    const demo = scene();
    demo.party.select('mira');
    demo.state.entity('mira')!.hitPoints.marked = 2;
    demo.state.entity('kara')!.hitPoints.marked = 2;
    demo.world.addItem(DRAUGHT, 1);
    useItem(demo, DRAUGHT);
    expect(demo.state.entity('mira')!.hitPoints.marked).toBe(0);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBe(2);
  });

  it('refuses what the party is not carrying, and what has no use', () => {
    const demo = scene();
    expect(useItem(demo, DRAUGHT).status).toBe('refused');
    demo.world.addItem('gold', 5);
    expect(useItem(demo, 'gold').status).toBe('refused');
    expect(demo.scenario.items.get('gold')).toBe(5);
    expect(useItem(demo, 'no-such-thing').status).toBe('missing');
  });

  it("can be done in a fight, on the party's turn", () => {
    // The demo runs the SRD's spotlight: acting hands the spotlight around
    // rather than spending a fixed action, so a use is recorded as acting but
    // does not lock the character out. It is refused on the GM's turn.
    const demo = scene();
    const kara = wounded(demo, 2);
    demo.world.addItem(DRAUGHT, 2);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    expect(demo.encounter!.canAct(kara)).toBe(true);
    expect(useItem(demo, DRAUGHT).status).toBe('done');
    expect(demo.state.entity(kara)!.hitPoints.marked).toBe(0);
    expect(demo.scenario.items.get(DRAUGHT)).toBe(1);

    demo.encounter!.passToGm();
    expect(demo.encounter!.canAct(kara)).toBe(false);
    expect(useItem(demo, DRAUGHT).status).toBe('refused');
    expect(demo.scenario.items.get(DRAUGHT)).toBe(1);
  });

  it('waits its turn behind a script that is asking something', () => {
    const demo = scene();
    demo.world.addItem(DRAUGHT, 1);
    const chest = demo.scene.interactables.find((i) => i.id === 'chest-19-13')!;
    demo.state.moveEntity(demo.party.selected!, tileOf(demo.grid, { x: chest.position.x - 1, y: chest.position.y }));
    useSelectedOn(demo, 'chest-19-13');
    expect(demo.pending).not.toBeNull();
    expect(useItem(demo, DRAUGHT).status).toBe('busy');
    expect(demo.scenario.items.get(DRAUGHT)).toBe(1);
  });

  it('does not overheal', () => {
    const demo = scene();
    const kara = wounded(demo, 1);
    demo.world.addItem(DRAUGHT, 1);
    useItem(demo, DRAUGHT);
    expect(demo.state.entity(kara)!.hitPoints.marked).toBe(0);
  });
});
