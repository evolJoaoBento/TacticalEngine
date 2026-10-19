/**
 * The Ashwell (`ashwell.ts`, `docs/ASHWELL.md`) is whole: a project the schema and the editor's check both take as it
 * is, every scene reached from the hub, every way in and out of each level leading somewhere, every thing it hands
 * out and every stat block it fields known - and its maps drawn as they read.
 */

import { describe, expect, it } from 'vitest';
import { validateProject } from '../../editor/validate';
import { projectSchema, type ProjectDoc } from '../../engine/scene/schema';
import { walkEffects, type Effect } from '../../engine/script/schema';
import { itemsFor } from '../../engine/content/equipment/catalogue';
import { STARTER_ADVERSARIES } from '../../engine/content/pack/starter';
import { buildingKey } from '../../engine/scene/building';
import { ASHWELL_ID, HUB_ID, KENNEL_ID, QUEST_ID, SUMP_ID, SUMP_KEY, THROAT_ID, WARDEN_ID, ashwellProject, sceneFromRows } from './ashwell';

/** Every effect the project can run: on its props, in its dialogues, in each branch of either. */
function effectsOf(project: ProjectDoc): Effect[] {
  const found: Effect[] = [];
  const take = (effects: readonly Effect[] | undefined): void => {
    if (effects !== undefined) walkEffects(effects, (effect) => void found.push(effect));
  };
  for (const scene of project.scenes) for (const deco of scene.decos) if (deco.function?.kind === 'script') take(deco.function.effects);
  for (const dialogue of project.dialogues) {
    for (const node of dialogue.nodes) {
      take(node.onEnter);
      for (const choice of node.choices ?? []) take(choice.effects);
    }
  }
  return found;
}

describe('the Ashwell, as a project', () => {
  const project = ashwellProject();

  it('is one the schema takes as it is, and the editor finds nothing wrong with', () => {
    expect(projectSchema.parse(project)).toEqual(project);
    expect(project.id).toBe(ASHWELL_ID);
    expect(validateProject(project)).toEqual([]);
  });

  it('opens at the Lantern & Lye, and every room is reached from it, by a goto or a stair paired with one below', () => {
    expect(project.startScene).toBe(HUB_ID);
    // Each paired stair, by its pair: the scenes that hold it.
    const holders = new Map<string, string[]>();
    for (const scene of project.scenes) {
      for (const deco of scene.decos) if (deco.function?.kind === 'portal') holders.set(deco.function.pair, [...(holders.get(deco.function.pair) ?? []), scene.id]);
    }
    for (const [pair, scenes] of holders) expect(scenes, pair).toHaveLength(2);
    const leads = new Map<string, Set<string>>();
    for (const scene of project.scenes) {
      const to = new Set<string>();
      for (const deco of scene.decos) {
        if (deco.function?.kind === 'portal') for (const other of holders.get(deco.function.pair)!) if (other !== scene.id) to.add(other);
        if (deco.function?.kind !== 'script') continue;
        if (deco.function.goto !== undefined) to.add(deco.function.goto);
        walkEffects(deco.function.effects, (effect) => void (effect.kind === 'goto' && to.add(effect.scene)));
      }
      leads.set(scene.id, to);
    }
    const reached = new Set([HUB_ID]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const from of [...reached]) for (const to of leads.get(from) ?? []) if (!reached.has(to)) grew = reached.add(to) !== null;
    }
    expect([...reached].sort()).toEqual(project.scenes.map((scene) => scene.id).sort());
    expect(leads.get(HUB_ID)).toEqual(new Set([THROAT_ID]));
    expect(leads.get(THROAT_ID)).toEqual(new Set([HUB_ID, KENNEL_ID, SUMP_ID]));
    expect(leads.get(KENNEL_ID)).toEqual(new Set([THROAT_ID]));
    // The Sump's stair down ends the level, and climbs back to the Lantern.
    expect(leads.get(SUMP_ID)).toEqual(new Set([THROAT_ID, HUB_ID]));
  });

  it('hands out only things that exist, and fields only stat blocks it has or the engine ships', () => {
    const items = new Map(itemsFor(project).map((item) => [item.id, item]));
    for (const effect of effectsOf(project)) {
      if (effect.kind === 'addItem') expect(items.has(effect.item), effect.item).toBe(true);
      if (effect.kind === 'giveKey') expect(items.get(effect.key)?.kind, effect.key).toBe('key');
    }
    for (const table of project.lootTables) for (const entry of table.entries) expect(items.has(entry.item), entry.item).toBe(true);
    for (const scene of project.scenes) {
      for (const deco of scene.decos) if (deco.function?.kind === 'container') for (const held of deco.function.items) expect(items.has(held.item), held.item).toBe(true);
    }
    const blocks = new Set([...project.adversaries.map((a) => a.id), ...STARTER_ADVERSARIES.keys()]);
    for (const scene of project.scenes) for (const encounter of scene.encounters) for (const placed of encounter.adversaries) expect(blocks.has(placed.adversary), placed.adversary).toBe(true);
  });

  it('has Level 1 as it is written: a fight a room, the Warden the boss, his key the gate’s, the stair past it', () => {
    const scene = (id: string) => project.scenes.find((s) => s.id === id)!;
    // One fight to a room: a fight is everyone hostile in the room it is in.
    expect([THROAT_ID, KENNEL_ID, SUMP_ID].map((id) => scene(id).encounters.map((e) => e.id))).toEqual([['wellrats'], ['the-kennel'], ['the-warden']]);
    expect(scene(SUMP_ID).encounters[0]!.adversaries.map((a) => a.adversary)).toContain(WARDEN_ID);
    const deco = (id: string) => scene(SUMP_ID).decos.find((d) => d.id === id)!;
    const gate = deco('sump-gate').function!;
    expect(gate.kind === 'script' && gate.requiresKey).toBe(SUMP_KEY);
    // The key comes out of the Warden's strongbox, and only once his fight is over.
    const box = deco('wardens-strongbox').function!;
    const given: Effect[] = [];
    if (box.kind === 'script') walkEffects(box.effects, (effect) => void given.push(effect));
    expect(given.some((effect) => effect.kind === 'giveKey' && effect.key === SUMP_KEY)).toBe(true);
    expect(box.kind === 'script' && box.effects[0]).toMatchObject({ kind: 'branch', when: { kind: 'encounter', id: 'the-warden', state: 'ended' } });
    // The stair down is a step past the gate, which stands in the only way to it.
    expect(deco('stair-down').position.x - deco('sump-gate').position.x).toBe(1);
    // And the quest: every objective is completed somewhere.
    const done = new Set(effectsOf(project).flatMap((effect) => (effect.kind === 'completeObjective' && effect.quest === QUEST_ID ? [effect.objective] : [])));
    expect([...done].sort()).toEqual(project.quests[0]!.objectives.map((o) => o.id).sort());
  });
});

describe('a map drawn as rows', () => {
  it('lays a floor everywhere but the water, a wall two blocks high, rubble that is slow and a low wall to crouch behind', () => {
    const map = sceneFromRows(['#.', '~,', 'c.']);
    expect([map.width, map.height]).toEqual([2, 3]);
    expect(map.terrain).toEqual(['bedrock', 'bedrock', 'black-water', 'bedrock', 'bedrock', 'bedrock']);
    expect(map.heights).toEqual([0, 0, 0, 0, 0, 0]);
    const at = (x: number, y: number, level: number) => map.buildingTiles![buildingKey({ x, y, level })];
    expect(at(0, 0, 0)?.tile).toBe('flagstone');
    expect([at(0, 0, 0.25)?.tile, at(0, 0, 1.25)?.tile]).toEqual(['rampart', 'rampart']);
    expect(at(1, 0, 0.25)).toBeUndefined();
    expect(at(0, 1, 0)).toBeUndefined();
    expect(at(1, 1, 0)?.tile).toBe('road');
    expect([at(0, 2, 0)?.tile, at(0, 2, 0.25)?.tile, at(0, 2, 0.25)?.shape]).toEqual(['flagstone', 'barrier', 'wall']);
  });

  it('refuses a row of the wrong length, and a character not in the legend', () => {
    expect(() => sceneFromRows(['##', '#'])).toThrow('row 1 is 1 wide, not 2');
    expect(() => sceneFromRows(['#x'])).toThrow('"x" at 1,0 is not in the legend');
  });
});
