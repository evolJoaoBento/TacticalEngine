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
import { POLY_HAVEN_STARTERS } from '../../engine/content/poly-haven';
import { buildingKey } from '../../engine/scene/building';
import { deriveCharacter } from '../../engine/character/sheet';
import { buildProjectScene } from '../demo-scene';
import { withListedPacks } from '../listed-packs';
import { characterContentFor } from '../room';
import { sheetFor } from '../new-character';
import { ASHWELL_ID, ASHWELL_PARTY, AUD_DIALOGUE, BONE_KEY, BROKER_ID, COUNTING_ID, FURNACE_QUEST, GALLERY_ID, GUILD_MARK, HALL_ID, HUB_ID, INDEX_BOSS_ID, INDEX_ID, KENNEL_ID, KINDLING, LIBRARY_QUEST, MARKET_ID, MARKET_QUEST, NAVE_ID, PIT_ID, QUEST_ID, READING_ID, SAINT_ID, SELA_DIALOGUE, STACKS_ID, SUMP_ID, SUMP_KEY, THRONE_ID, THRONE_QUEST, THROAT_ID, VANE_DIALOGUE, VANE_ID, WARDEN_ID, YOUR_PAGE, ashwellProject, sceneFromRows } from './ashwell';

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
    const laid = withListedPacks(project);
    expect(validateProject(laid, { characterContent: characterContentFor(laid) })).toEqual([]);
  });

  it('is played by SRD characters, made of the pack it lists - four of the camp\u2019s company when nobody is brought', () => {
    expect(project.packs).toEqual(['srd-characters']);
    expect(project.party.map((sheet) => sheet.name)).toEqual(['Quim', 'Violet', 'Scarlet', 'Arty']);
    // None of the demo's own: its party's cards are the vault's.
    expect(project.cards.map((card) => card.id)).not.toContain('sentinel-hold-fast');
    const problems: string[] = [];
    const demo = buildProjectScene(withListedPacks(project, problems), project.id);
    expect(problems).toEqual([]);
    const content = characterContentFor(demo.project);
    for (const sheet of ASHWELL_PARTY) {
      for (const card of sheet.domainCards ?? []) expect(content.cards.has(card), card).toBe(true);
      expect(deriveCharacter(sheet, content, demo.project.abilities).issues, sheet.id).toEqual([]);
    }
  });

  it('goes down with whoever it is begun with', () => {
    const wren = sheetFor({ name: 'Wren', model: 'violet', ancestryId: 'elf', communityId: 'wildborne', classId: 'ranger', subclassId: 'wayfinder', domainCards: ['gifted-tracker', 'natures-tongue'] });
    const theirs = ashwellProject([wren, ASHWELL_PARTY[0]!]);
    expect(theirs.party.map((sheet) => sheet.id)).toEqual(['wren', 'quim']);
    const demo = buildProjectScene(withListedPacks(theirs), theirs.id);
    expect(demo.party.members()).toEqual(['wren', 'quim']);
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
    // The Sump's stair down ends Level 1 and goes on into the Market; the Market's bone stair climbs back to it.
    expect(leads.get(SUMP_ID)).toEqual(new Set([THROAT_ID, MARKET_ID]));
    expect(leads.get(MARKET_ID)).toEqual(new Set([SUMP_ID, PIT_ID, COUNTING_ID]));
    expect(leads.get(PIT_ID)).toEqual(new Set([MARKET_ID]));
    // The Counting House's wet stair ends Level 2 and goes on into the Library; and so on down.
    expect(leads.get(COUNTING_ID)).toEqual(new Set([MARKET_ID, READING_ID]));
    expect(leads.get(READING_ID)).toEqual(new Set([COUNTING_ID, STACKS_ID]));
    expect(leads.get(STACKS_ID)).toEqual(new Set([READING_ID, INDEX_ID]));
    expect(leads.get(INDEX_ID)).toEqual(new Set([STACKS_ID, NAVE_ID]));
    expect(leads.get(NAVE_ID)).toEqual(new Set([INDEX_ID, GALLERY_ID, HALL_ID]));
    expect(leads.get(GALLERY_ID)).toEqual(new Set([NAVE_ID]));
    // The Furnace Hall's last stair ends Level 4 and goes on to the Throne; every ending climbs back to the Lantern.
    expect(leads.get(HALL_ID)).toEqual(new Set([NAVE_ID, THRONE_ID]));
    expect(leads.get(THRONE_ID)).toEqual(new Set([HALL_ID, HUB_ID]));
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

describe('Level 2, the Ossuary Market', () => {
  const project = ashwellProject();
  const scene = (id: string) => project.scenes.find((s) => s.id === id)!;
  const deco = (id: string, name: string) => scene(id).decos.find((d) => d.id === name)!;

  it('is a peaceful market, a pit with a fight, and a counting house whose fight only the Broker’s answer begins', () => {
    expect(scene(MARKET_ID).encounters).toEqual([]);
    expect(scene(PIT_ID).encounters.map((e) => e.id)).toEqual(['the-pit']);
    const broker = scene(COUNTING_ID).encounters[0]!;
    expect([broker.id, broker.startsOnTrigger, broker.triggerCells]).toEqual(['the-broker', false, []]);
    expect(broker.adversaries.map((a) => a.adversary)).toContain(BROKER_ID);
    // All of hers talk until she answers otherwise, and all of them turn when she does.
    expect(broker.adversaries.every((a) => a.interaction?.kind === 'friendly' && a.interaction.dialogue === SELA_DIALOGUE)).toBe(true);
    const turned: Effect[] = [];
    walkEffects(project.dialogues.find((d) => d.id === SELA_DIALOGUE)!.nodes.find((n) => n.id === 'fight')!.onEnter!, (effect) => void turned.push(effect));
    expect(turned.find((effect) => effect.kind === 'setAttitude')).toMatchObject({ attitude: 'hostile', target: { kind: 'entities', ids: broker.adversaries.map((a) => a.id) } });
  });

  it('opens the Counting House to the Guild’s mark, and the stair down to the Broker’s key, however it was paid for', () => {
    const door = deco(MARKET_ID, 'guild-door').function!;
    expect(door.kind === 'script' && door.requiresKey).toBe(GUILD_MARK);
    const bone = deco(COUNTING_ID, 'bone-door').function!;
    expect(bone.kind === 'script' && bone.requiresKey).toBe(BONE_KEY);
    // Every way of paying her - Ketch's name, one of the party's, Annick's - gives the key.
    const sela = project.dialogues.find((d) => d.id === SELA_DIALOGUE)!;
    for (const node of ['ketch', 'ours', 'annick']) {
      const given: Effect[] = [];
      walkEffects(sela.nodes.find((n) => n.id === node)!.onEnter!, (effect) => void given.push(effect));
      expect(given.some((effect) => effect.kind === 'giveKey' && effect.key === BONE_KEY), node).toBe(true);
    }
    // And fighting her for it: her ledger-box gives it, once her fight is over.
    const box: Effect[] = [];
    const ledger = deco(COUNTING_ID, 'brokers-ledger-box').function!;
    if (ledger.kind === 'script') walkEffects(ledger.effects, (effect) => void box.push(effect));
    expect(box.some((effect) => effect.kind === 'giveKey' && effect.key === BONE_KEY)).toBe(true);
    expect(box.some((effect) => effect.kind === 'branch' && effect.when.kind === 'encounter' && effect.when.id === 'the-broker' && effect.when.state === 'ended')).toBe(true);
  });

  it('completes every objective of its quest somewhere, and begins it where Level 1 ends', () => {
    const done = new Set(effectsOf(project).flatMap((effect) => (effect.kind === 'completeObjective' && effect.quest === MARKET_QUEST ? [effect.objective] : [])));
    expect([...done].sort()).toEqual(project.quests.find((q) => q.id === MARKET_QUEST)!.objectives.map((o) => o.id).sort());
    expect(effectsOf(project).some((effect) => effect.kind === 'startQuest' && effect.quest === MARKET_QUEST)).toBe(true);
  });
});

/** Every objective a quest has, and the objectives the project completes somewhere. */
function objectives(project: ProjectDoc, quest: string): { all: string[]; done: string[] } {
  const done = new Set(effectsOf(project).flatMap((effect) => (effect.kind === 'completeObjective' && effect.quest === quest ? [effect.objective] : [])));
  return { all: project.quests.find((q) => q.id === quest)!.objectives.map((o) => o.id).sort(), done: [...done].sort() };
}

describe('Level 3, the Drowned Library', () => {
  const project = ashwellProject();
  const scene = (id: string) => project.scenes.find((s) => s.id === id)!;
  const fn = (id: string, name: string) => scene(id).decos.find((d) => d.id === name)!.function!;

  it('is a reading room with no fight, the Stacks, and the Index with its boss', () => {
    expect([READING_ID, STACKS_ID, INDEX_ID].map((id) => scene(id).encounters.map((e) => e.id))).toEqual([[], ['the-stacks'], ['the-index']]);
    expect(scene(INDEX_ID).encounters[0]!.adversaries.map((a) => a.adversary)).toContain(INDEX_BOSS_ID);
  });

  it('opens the stair down only to the party\u2019s own page, which the catalogue gives once the Index is down', () => {
    const stair = fn(INDEX_ID, 'furnace-stair');
    expect(stair.kind === 'script' && stair.requiresKey).toBe(YOUR_PAGE);
    const drawers = fn(INDEX_ID, 'catalogue-drawers');
    expect(drawers.kind === 'script' && drawers.effects[0]).toMatchObject({ kind: 'branch', when: { kind: 'encounter', id: 'the-index', state: 'ended' } });
    const given: Effect[] = [];
    if (drawers.kind === 'script') walkEffects(drawers.effects, (effect) => void given.push(effect));
    expect(given.some((effect) => effect.kind === 'giveKey' && effect.key === YOUR_PAGE)).toBe(true);
    // The catalogue burns only with Aud's tinder, and Aud gives it.
    const choice = given.find((effect) => effect.kind === 'choice');
    expect(choice?.kind === 'choice' && choice.options.find((o) => o.label === 'Burn it.')?.available).toEqual({ kind: 'hasItem', item: KINDLING });
    const aud: Effect[] = [];
    walkEffects(project.dialogues.find((d) => d.id === AUD_DIALOGUE)!.nodes.find((n) => n.id === 'deeper')!.onEnter!, (effect) => void aud.push(effect));
    expect(aud.some((effect) => effect.kind === 'addItem' && effect.item === KINDLING)).toBe(true);
  });

  it('completes every objective of its quest somewhere', () => {
    const { all, done } = objectives(project, LIBRARY_QUEST);
    expect(done).toEqual(all);
  });
});

describe('Level 4, the Furnace of Names', () => {
  const project = ashwellProject();
  const scene = (id: string) => project.scenes.find((s) => s.id === id)!;
  const fn = (id: string, name: string) => scene(id).decos.find((d) => d.id === name)!.function!;

  it('is a nave with no fight, the Coal Gallery, and the Furnace Hall with its boss', () => {
    expect([NAVE_ID, GALLERY_ID, HALL_ID].map((id) => scene(id).encounters.map((e) => e.id))).toEqual([[], ['the-stokers'], ['the-saint']]);
    expect(scene(HALL_ID).encounters[0]!.adversaries.map((a) => a.adversary)).toContain(SAINT_ID);
  });

  it('cools the Furnace Door only with the valve turned, and the valve only once the Stokers are down', () => {
    const door = fn(NAVE_ID, 'furnace-door');
    expect(door.kind === 'script' && door.effects[0]).toMatchObject({ kind: 'branch', when: { kind: 'flag', flag: 'valve-turned' } });
    const valve = fn(GALLERY_ID, 'great-valve');
    expect(valve.kind === 'script' && valve.effects[0]).toMatchObject({ kind: 'branch', when: { kind: 'encounter', id: 'the-stokers', state: 'ended' } });
    const turned: Effect[] = [];
    if (valve.kind === 'script') walkEffects(valve.effects, (effect) => void turned.push(effect));
    expect(turned.some((effect) => effect.kind === 'setFlag' && effect.flag === 'valve-turned')).toBe(true);
  });

  it('takes one of the company\u2019s names for the last stair, each costing its owner, and the stair waits for it', () => {
    const furnace = fn(HALL_ID, 'name-furnace');
    const given: Effect[] = [];
    if (furnace.kind === 'script') walkEffects(furnace.effects, (effect) => void given.push(effect));
    const choice = given.find((effect) => effect.kind === 'choice');
    if (choice?.kind !== 'choice') throw new Error('the furnace offers no choice');
    // One option for each of the company, by their sheet's id.
    const ids = project.party.map((sheet) => sheet.id);
    expect(choice.options).toHaveLength(ids.length);
    choice.options.forEach((option, at) => {
      expect(option.effects).toContainEqual({ kind: 'setFlag', flag: 'name-burnt' });
      expect(option.effects).toContainEqual({ kind: 'markStress', amount: 3, target: { kind: 'entity', id: ids[at] } });
    });
    // The party it was begun with, whoever they are: two, here, and each named.
    const two = ashwellProject([ASHWELL_PARTY[3]!, ASHWELL_PARTY[1]!]).scenes.find((s) => s.id === HALL_ID)!.decos.find((d) => d.id === 'name-furnace')!.function!;
    const offered: Effect[] = [];
    if (two.kind === 'script') walkEffects(two.effects, (effect) => void offered.push(effect));
    const theirs = offered.find((effect) => effect.kind === 'choice');
    expect(theirs?.kind === 'choice' && theirs.options.map((option) => option.label)).toEqual(['Arty writes their name.', 'Violet writes their name.']);
    expect(theirs?.kind === 'choice' && theirs.options[1]!.effects).toContainEqual({ kind: 'setFlag', flag: 'burnt-violet' });
    // Each loses a thing of their own: the second of the party, the second thing the fire takes.
    expect(theirs?.kind === 'choice' && theirs.options[1]!.effects).toContainEqual(expect.objectContaining({ kind: 'log', text: expect.stringContaining('Violet cannot remember the house they grew up in') }));
    const stair = fn(HALL_ID, 'throne-stair');
    expect(stair.kind === 'script' && stair.effects[0]).toMatchObject({ kind: 'branch', when: { kind: 'flag', flag: 'name-burnt' } });
  });

  it('completes every objective of its quest somewhere, and begins it where Level 3 ends', () => {
    const { all, done } = objectives(project, FURNACE_QUEST);
    expect(done).toEqual(all);
    expect(effectsOf(project).some((effect) => effect.kind === 'startQuest' && effect.quest === FURNACE_QUEST)).toBe(true);
  });
});

/** Effects, and every effect inside them - a branch's, a choice's options' - in order. */
function deep(effects: readonly Effect[]): Effect[] {
  const found: Effect[] = [];
  walkEffects(effects, (effect) => {
    found.push(effect);
    if (effect.kind === 'choice') for (const option of effect.options) found.push(...deep(option.effects));
  });
  return found;
}

describe('Level 5, the Ledger Throne', () => {
  const project = ashwellProject();
  const throne = project.scenes.find((s) => s.id === THRONE_ID)!;
  const vane = project.dialogues.find((d) => d.id === VANE_DIALOGUE)!;
  const node = (id: string) => vane.nodes.find((n) => n.id === id)!;

  it('is one room where nobody fights unless the ledger is threatened, and then all of them do', () => {
    const archivist = throne.encounters[0]!;
    expect([throne.encounters.length, archivist.id, archivist.startsOnTrigger, archivist.triggerCells]).toEqual([1, 'the-archivist', false, []]);
    expect(archivist.adversaries.map((a) => a.adversary)).toContain(VANE_ID);
    expect(archivist.adversaries.every((a) => a.interaction?.kind === 'friendly' && a.interaction.dialogue === VANE_DIALOGUE)).toBe(true);
    expect(deep(node('refused').onEnter!).find((e) => e.kind === 'setAttitude')).toMatchObject({ attitude: 'hostile', target: { kind: 'entities', ids: archivist.adversaries.map((a) => a.id) } });
  });

  it('ends three ways - the pen taken, Vane left writing, the ledger burnt over him - each the Ashwell\u2019s end, and back to the Lantern', () => {
    const pen = deep(node('pen').choices![0]!.effects!);
    const left = deep(node('leave').choices![0]!.effects!);
    const ledger = throne.decos.find((d) => d.id === 'the-ledger')!.function!;
    if (ledger.kind !== 'script') throw new Error('the ledger is no script');
    // Burnt only once his fight is over: the ledger asks for it then.
    const after = deep(ledger.effects).find((e) => e.kind === 'branch' && e.when.kind === 'encounter');
    expect(after?.kind === 'branch' && after.when).toEqual({ kind: 'encounter', id: 'the-archivist', state: 'ended' });
    const choice = deep(ledger.effects).find((e) => e.kind === 'choice');
    if (choice?.kind !== 'choice') throw new Error('the ledger offers no choice');
    const burnt = deep(choice.options.find((o) => o.label === 'Burn it.')!.effects);
    for (const [flag, effects] of [['ending-took-the-pen', pen], ['ending-left-him', left], ['ending-burned', burnt]] as const) {
      expect(effects, flag).toContainEqual({ kind: 'setFlag', flag });
      expect(effects, flag).toContainEqual({ kind: 'setFlag', flag: 'ashwell-ended' });
      expect(effects, flag).toContainEqual({ kind: 'completeQuest', quest: THRONE_QUEST });
      expect(effects.at(-1), flag).toEqual({ kind: 'goto', scene: HUB_ID });
    }
  });

  it('remembers what was done above: Ketch\u2019s name and the Index, and Ketch has a word for each ending', () => {
    const offered = node('greet').choices!;
    expect(offered.find((c) => c.goto === 'ketch')?.available).toEqual({ kind: 'flag', flag: 'gave-ketchs-name' });
    expect(offered.find((c) => c.goto === 'index')?.available).toEqual({ kind: 'flag', flag: 'burned-the-index' });
    const ketch = project.dialogues.find((d) => d.id === 'mother-ketch')!.nodes.find((n) => n.id === 'slate')!.choices!;
    for (const flag of ['ending-burned', 'ending-took-the-pen', 'ending-left-him']) expect(ketch.some((c) => c.available?.kind === 'flag' && c.available.flag === flag), flag).toBe(true);
  });

  it('completes every objective of its quest somewhere, and begins it where Level 4 ends', () => {
    const all = [...effectsOf(project), ...deep(throne.decos.flatMap((d) => (d.function?.kind === 'script' ? d.function.effects : []))), ...vane.nodes.flatMap((n) => [...deep(n.onEnter ?? []), ...(n.choices ?? []).flatMap((c) => deep(c.effects ?? []))])];
    const done = new Set(all.flatMap((e) => (e.kind === 'completeObjective' && e.quest === THRONE_QUEST ? [e.objective] : [])));
    expect([...done].sort()).toEqual(project.quests.find((q) => q.id === THRONE_QUEST)!.objectives.map((o) => o.id).sort());
    expect(all.some((e) => e.kind === 'startQuest' && e.quest === THRONE_QUEST)).toBe(true);
  });
});

describe('each level\u2019s last stair', () => {
  const project = ashwellProject();
  // The stair, the flag its first use sets, and the level it goes on into.
  const STAIRS: readonly [string, string, string, string][] = [
    [SUMP_ID, 'stair-down', 'level-1-done', MARKET_ID],
    [COUNTING_ID, 'library-stair', 'level-2-done', READING_ID],
    [INDEX_ID, 'furnace-stair', 'level-3-done', NAVE_ID],
    [HALL_ID, 'throne-stair', 'level-4-done', THRONE_ID],
  ];

  it('goes on into the next level both ways: the first time, the level ended on the way; every time after, straight there', () => {
    for (const [room, stair, flag, next] of STAIRS) {
      const fn = project.scenes.find((s) => s.id === room)!.decos.find((d) => d.id === stair)!.function!;
      if (fn.kind !== 'script') throw new Error(`${stair} is no script`);
      expect(fn.repeatable, stair).toBe(true);
      const branch = deep(fn.effects).find((e) => e.kind === 'branch' && e.when.kind === 'flag' && e.when.flag === flag);
      if (branch?.kind !== 'branch') throw new Error(`${stair} does not ask whether ${flag}`);
      expect(branch.then.at(-1), `${stair}, after`).toEqual({ kind: 'goto', scene: next });
      expect(branch.otherwise?.at(-1), `${stair}, the first time`).toEqual({ kind: 'goto', scene: next });
      expect(branch.otherwise, `${stair}, the first time`).toContainEqual({ kind: 'setFlag', flag });
      expect(branch.otherwise, `${stair}, the first time`).toContainEqual({ kind: 'levelUp' });
    }
  });
});

describe('the Ashwell, dressed', () => {
  const project = ashwellProject();
  const surfaces = project.surfaces ?? [];

  it('is drawn in Poly Haven starters, every one linked rather than carried, so the project stays small', () => {
    const starters = new Set(POLY_HAVEN_STARTERS.map((s) => s.id));
    expect(surfaces.length).toBeGreaterThanOrEqual(10);
    for (const surface of surfaces) {
      expect(surface.maps, surface.id).toBeUndefined();
      expect(starters.has(surface.polyHaven!.id), surface.id).toBe(true);
      expect(surface.source).toBe(`Poly Haven ${surface.polyHaven!.id} (CC0)`);
    }
    // Small enough for the browser's saves to keep: begun, it is written there whole.
    expect(JSON.stringify(project).length).toBeLessThan(1_500_000);
  });

  it('gives every level its own wall and floor, drawn in a material the project has, and nothing drawn in one it has not', () => {
    const ids = new Set(surfaces.map((s) => s.id));
    const palette = project.terrainPalette ?? [];
    for (const kind of palette) if (kind.surface !== undefined) expect(ids.has(kind.surface), kind.id).toBe(true);
    for (const surface of surfaces) expect(palette.some((kind) => kind.surface === surface.id), surface.id).toBe(true);
    // Each room is laid with its level's kinds: its walls and its floors.
    const LOOK: Record<string, string> = { [HUB_ID]: 'lantern', [THRONE_ID]: 'lantern', [THROAT_ID]: 'throat', [KENNEL_ID]: 'throat', [SUMP_ID]: 'throat', [MARKET_ID]: 'market', [PIT_ID]: 'market', [COUNTING_ID]: 'market', [READING_ID]: 'library', [STACKS_ID]: 'library', [INDEX_ID]: 'library', [NAVE_ID]: 'furnace', [GALLERY_ID]: 'furnace', [HALL_ID]: 'furnace' };
    for (const scene of project.scenes) {
      const tiles = new Set(Object.values(scene.buildingTiles ?? {}).map((piece) => piece.tile));
      expect(tiles.has(`${LOOK[scene.id]}-wall`), scene.id).toBe(true);
      expect(tiles.has(`${LOOK[scene.id]}-floor`), scene.id).toBe(true);
      expect(tiles.has('rampart') || tiles.has('flagstone'), scene.id).toBe(false);
    }
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

  it('lays a level\u2019s own kinds of wall and floor when given them', () => {
    const map = sceneFromRows(['#.', ',c'], { wall: 'w', floor: 'f', rubble: 'r', cover: 'c' });
    const at = (x: number, y: number, level: number) => map.buildingTiles![buildingKey({ x, y, level })]?.tile;
    expect([at(0, 0, 0), at(0, 0, 0.25), at(0, 0, 1.25), at(1, 0, 0), at(0, 1, 0), at(1, 1, 0), at(1, 1, 0.25)]).toEqual(['f', 'w', 'w', 'f', 'r', 'f', 'c']);
  });

  it('refuses a row of the wrong length, and a character not in the legend', () => {
    expect(() => sceneFromRows(['##', '#'])).toThrow('row 1 is 1 wide, not 2');
    expect(() => sceneFromRows(['#x'])).toThrow('"x" at 1,0 is not in the legend');
  });
});
