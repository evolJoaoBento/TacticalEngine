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
import { ASHWELL_ID, ASHWELL_PARTY, AUD_DIALOGUE, BONE_KEY, BROKER_ID, COUNTING_ID, FURNACE_QUEST, GALLERY_ID, GHOUL_ID, GRALE_DIALOGUE, GUILD_MARK, HALL_ID, HUB_ID, ILSE_DIALOGUE, INDEX_BOSS_ID, INDEX_ID, INK_WRAITH_ID, KENNEL_ID, KINDLING, LIBRARY_QUEST, MARKET_ID, MARKET_QUEST, NAVE_ID, PIT_ID, QUEST_ID, READING_ID, SAINT_ID, SELA_DIALOGUE, STACKS_ID, STOKER_ID, SUMP_ID, SUMP_KEY, THRONE_ID, THRONE_QUEST, THROAT_ID, VANE_DIALOGUE, VANE_ID, WARDEN_ID, YOUR_PAGE, ashwellProject, sceneFromRows } from './ashwell';
import { BELL_CALLED_ID, CLERK_DIALOGUE, SEXTON_DIALOGUE, SEXTON_ID } from './ashwell-level2';

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
    // The key comes out of the Warden's strongbox once his fight is over - or he gives it (`Level 1, rebuilt`).
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

  it('raises floor a block high, of the floor’s stone or of planks, and turns a stair to climb toward it', () => {
    const map = sceneFromRows(['^/.', '...', './.', '.B.', './.', '...', '/^.'], { wall: 'w', floor: 'f', rubble: 'r', cover: 'c' });
    const at = (x: number, y: number) => map.buildingTiles![buildingKey({ x, y, level: 0 })];
    expect([at(0, 0)?.shape, at(0, 0)?.tile, at(1, 3)?.shape, at(1, 3)?.tile]).toEqual(['block', 'f', 'block', 'planks']);
    // Each stair climbs toward the raised floor beside it: west, south, north, east.
    expect([at(1, 0), at(1, 2), at(1, 4), at(0, 6)].map((piece) => [piece?.shape, piece?.rotation])).toEqual([['stairs', 3], ['stairs', 0], ['stairs', 2], ['stairs', 1]]);
    expect(at(1, 0)?.tile).toBe('f');
    expect(() => sceneFromRows(['./.'])).toThrow('the stair at 1,0 has nothing raised beside it');
  });

  it('lays boards on the floor, and stands a room’s furniture on it, a kind nobody walks through, stretched to its height', () => {
    const map = sceneFromRows(['=K', 'S.'], { wall: 'w', floor: 'f', rubble: 'r', cover: 'c' }, { K: { kind: 'counter', shape: 'block', height: 0.75 }, S: { kind: 'shelf', shape: 'wall', height: 1.75, rotation: 2 } });
    const at = (x: number, y: number, level: number) => map.buildingTiles![buildingKey({ x, y, level })];
    expect(at(0, 0, 0)?.tile).toBe('planks');
    expect([at(1, 0, 0)?.tile, at(1, 0, 0.25)]).toEqual(['f', { x: 1, y: 0, level: 0.25, shape: 'block', material: 'stone', rotation: 0, tile: 'counter', height: 0.75 }]);
    expect(at(0, 1, 0.25)).toMatchObject({ shape: 'wall', tile: 'shelf', rotation: 2, height: 1.75 });
    expect(map.terrain).toEqual(['bedrock', 'bedrock', 'bedrock', 'bedrock']);
  });
});

describe('Level 5, rebuilt', () => {
  const project = ashwellProject();
  const scene = (id: string) => project.scenes.find((s) => s.id === id)!;
  const deco = (room: string, id: string) => scene(room).decos.find((d) => d.id === id)!;
  const node = (id: string) => project.dialogues.find((d) => d.id === VANE_DIALOGUE)!.nodes.find((n) => n.id === id)!;
  const all = (effects: readonly Effect[]): Effect[] => {
    const found: Effect[] = [];
    walkEffects(effects, (effect) => void found.push(effect));
    return found;
  };
  const flagsRead = (effects: readonly Effect[]): string[] => all(effects).flatMap((effect) => (effect.kind === 'branch' && effect.when.kind === 'flag' ? [effect.when.flag] : []));
  const pieces = (tile: string) => Object.values(scene(THRONE_ID).buildingTiles!).filter((piece) => piece.tile === tile);

  it('is a room worth ending in: lamplit, shelved to the ceiling, the lectern up on a dais inside a ring of screens', () => {
    expect(scene(THRONE_ID).light).toBe(0.5);
    expect(pieces('shelf').length).toBeGreaterThan(30);
    const raised = (at: { x: number; y: number }) => Object.values(scene(THRONE_ID).buildingTiles!).some((piece) => piece.x === at.x && piece.y === at.y && piece.shape === 'block' && piece.level === 0);
    const vane = scene(THRONE_ID).encounters[0]!.adversaries.find((a) => a.id === 'orsolde-vane')!;
    expect([raised(deco(THRONE_ID, 'the-ledger').position), raised(vane.position), raised(deco(THRONE_ID, 'the-burnt-page').position)]).toEqual([true, true, true]);
    expect([pieces('counter').length, pieces('barrier').length]).toEqual([22, 0]);
    // Low wooden screens, half a block: a ring to read inside, not a wall to fight behind.
    expect(pieces('counter').every((piece) => piece.height === 0.5)).toBe(true);
  });

  it('has Vane write the room round him when it comes to a fight: the floor his page, every entry he finishes a wound, the Written out of the margins', () => {
    expect(project.adversaries.find((a) => a.id === VANE_ID)!.features.map((f) => f.name)).toEqual(['Writes the Room', 'Out of the Margins']);
    const writes = project.abilities.find((a) => a.id === 'vane-writes-the-room')!;
    expect([writes.kind, writes.trigger, writes.uses, writes.cost]).toEqual(['reaction', 'partyRolled', { count: 1, per: 'scene' }, {}]);
    expect(writes.effects[1]).toEqual({ kind: 'zone', zone: 'his-page', name: 'His Page', condition: 'vulnerable', at: 'actor', band: 'close', side: 'adversaries', onDeath: 'end' });
    expect(writes.effects[2]).toMatchObject({ kind: 'countdown', start: '3', advance: 'standard', loop: 'reset', onDeath: 'end' });
    const wound = writes.effects[2]!.kind === 'countdown' ? writes.effects[2]!.effects.find((e) => e.kind === 'damage') : undefined;
    // The nearest of the party, from his chair: the party are his allies' opposite, and `allies` names the party.
    expect(wound).toEqual({ kind: 'damage', dice: '2d6', type: 'magic', direct: true, target: { kind: 'allies', range: 'veryFar', nearest: 1 } });
    const margins = project.abilities.find((a) => a.id === 'vane-out-of-the-margins')!;
    expect([margins.trigger, margins.uses, margins.effects[0]]).toEqual(['tookHitPoints', { count: 2, per: 'scene' }, { kind: 'summon', adversary: INK_WRAITH_ID, count: '1', range: 'close' }]);
    expect(project.adversaryModels[INK_WRAITH_ID]).toBe('briar-wraith');
  });

  it('gives the pen on the party\u2019s record - three things kept on the way down - or on their word, a Presence roll', () => {
    expect(node('decide').choices!.find((c) => c.text === 'Give us the pen.')!.goto).toBe('pen-ask');
    const ask = node('pen-ask');
    expect(ask.onEnter![0]).toEqual({ kind: 'setVar', name: 'kept', value: 0 });
    expect(flagsRead(ask.onEnter!)).toEqual(['annick-spared', 'returned-the-ring', 'mott-talked', 'found-our-own', 'freed-annicks-name', 'told-aud', 'choir-led-up', 'took-back-the-page', 'heard-of-ilsabet']);
    for (const branch of ask.onEnter!.slice(1)) expect(branch.kind === 'branch' && branch.then[0]).toEqual({ kind: 'addVar', name: 'kept', by: 1 });
    const [record, word, back] = ask.choices!;
    expect([record!.available, record!.goto]).toEqual([{ kind: 'var', name: 'kept', op: '>=', value: 3 }, 'pen']);
    expect(word!.check).toEqual({ trait: 'presence', difficulty: 16, gotoOnSuccess: 'pen', gotoOnFailure: 'not-yet' });
    expect(back!.goto).toBe('decide');
    expect(node('not-yet').choices!.map((c) => c.goto)).toEqual(['leave', 'refused']);
  });

  it('keeps the Furnace\u2019s page on his desk for whoever wrote it, and gives back what went with it', () => {
    const page = deco(THRONE_ID, 'the-burnt-page').function!;
    if (page.kind !== 'script') throw new Error('the page is no script');
    const ids = project.party.map((sheet) => sheet.id);
    expect(flagsRead(page.effects)).toEqual(ids.map((id) => `burnt-${id}`));
    const first = page.effects[0]!;
    expect(first.kind === 'branch' && first.then.slice(1)).toEqual([{ kind: 'clearStress', amount: 3, target: { kind: 'entity', id: ids[0] } }, { kind: 'setFlag', flag: 'took-back-the-page' }]);
    expect(page.effects.at(-1)).toEqual({ kind: 'markUsed' });
  });

  it('reads Level 1 back: the first page torn down, and Ketch\u2019s word about his wife, whose entry every ending remembers', () => {
    expect(flagsRead(node('greet').onEnter!)).toEqual(['read-vanes-page']);
    const asked = node('greet').choices!.find((c) => c.goto === 'ilsabet')!;
    expect(asked.available).toEqual({ kind: 'all', of: [{ kind: 'flag', flag: 'knows-vanes-name' }, { kind: 'not', of: { kind: 'flag', flag: 'heard-of-ilsabet' } }] });
    expect(node('ilsabet').onEnter).toEqual([{ kind: 'setFlag', flag: 'heard-of-ilsabet' }]);
    const pen = node('pen').choices![0]!.effects!;
    const left = node('leave').choices![0]!.effects!;
    const ledger = deco(THRONE_ID, 'the-ledger').function!;
    const burnt = ledger.kind === 'script' ? all(ledger.effects).find((e) => e.kind === 'choice') : undefined;
    const burning = burnt?.kind === 'choice' ? burnt.options[0]!.effects : [];
    for (const [ending, effects] of [['pen', pen], ['left', left], ['burnt', burning]] as const) expect(flagsRead(effects), ending).toContain('heard-of-ilsabet');
  });

  it('pays every flag it sets: each is read somewhere, and nothing reads a flag nothing sets', () => {
    const text = JSON.stringify(project);
    const set = new Set([...text.matchAll(/"kind":"setFlag","flag":"([^"]+)"/g)].map((m) => m[1]!));
    const read = new Set([...text.matchAll(/"kind":"flag","flag":"([^"]+)"/g)].map((m) => m[1]!));
    expect([...set].filter((flag) => !read.has(flag))).toEqual([]);
    expect([...read].filter((flag) => !set.has(flag))).toEqual([]);
    expect(set.size).toBeGreaterThan(40);
  });
});

describe('Level 4, rebuilt', () => {
  const project = ashwellProject();
  const scene = (id: string) => project.scenes.find((s) => s.id === id)!;
  const deco = (room: string, id: string) => scene(room).decos.find((d) => d.id === id)!;
  const dialogue = (id: string) => project.dialogues.find((d) => d.id === id)!;
  const node = (id: string, at: string) => dialogue(id).nodes.find((n) => n.id === at)!;
  const all = (effects: readonly Effect[]): Effect[] => {
    const found: Effect[] = [];
    walkEffects(effects, (effect) => void found.push(effect));
    return found;
  };
  const flagsRead = (effects: readonly Effect[]): string[] => all(effects).flatMap((effect) => (effect.kind === 'branch' && effect.when.kind === 'flag' ? [effect.when.flag] : []));
  const pieces = (room: string, tile: string) => Object.values(scene(room).buildingTiles!).filter((piece) => piece.tile === tile);

  it('is lit by its fires - the Nave warm, the Gallery black, the Hall white - with pews, coal, chutes and a furnace filling a wall', () => {
    expect([NAVE_ID, GALLERY_ID, HALL_ID].map((id) => scene(id).light)).toEqual([0.4, 0.25, 0.6]);
    expect(pieces(NAVE_ID, 'pew')).toHaveLength(24);
    expect([pieces(GALLERY_ID, 'coal').length, pieces(GALLERY_ID, 'furnace').length]).toEqual([8, 4]);
    // The furnace is the Hall's whole east wall, floor to well above a man.
    const furnace = pieces(HALL_ID, 'furnace');
    expect([furnace.length, new Set(furnace.map((piece) => piece.x)), furnace.every((piece) => piece.height === 2.5)]).toEqual([14, new Set([13, 14]), true]);
  });

  it('makes the heat a hazard: the door costs a Stress to try, and the valve is a test of strength, tried until it turns', () => {
    const door = deco(NAVE_ID, 'furnace-door').function!;
    expect(door.kind === 'script' && door.effects[0]!.kind === 'branch' && door.effects[0]!.otherwise?.[0]).toEqual({ kind: 'markStress', amount: 1, target: { kind: 'actor' } });
    const valve = deco(GALLERY_ID, 'great-valve').function!;
    if (valve.kind !== 'script' || valve.effects[0]!.kind !== 'branch') throw new Error('the valve is no branch');
    const roll = valve.effects[0]!.then[0]!;
    if (roll.kind !== 'check') throw new Error('the valve is no roll');
    expect([roll.check.trait, roll.check.difficulty]).toEqual(['strength', 13]);
    // Turned on any success, burnt on a success with Shadow; never used up by a failure, so it is tried again.
    for (const turned of [roll.check.onCriticalSuccess, roll.check.onSuccessWithGood, roll.check.onSuccessWithBad]) expect(turned).toEqual(expect.arrayContaining([{ kind: 'setFlag', flag: 'valve-turned' }, { kind: 'markUsed' }]));
    expect(roll.check.onSuccessWithBad![0]).toEqual({ kind: 'markStress', amount: 1, target: { kind: 'actor' } });
    for (const failed of [roll.check.onFailureWithGood!, roll.check.onFailureWithBad!]) expect(failed.some((effect) => effect.kind === 'markUsed' || effect.kind === 'setFlag')).toBe(false);
    expect(roll.check.onFailureWithBad![0]).toEqual({ kind: 'damage', dice: '1d6', type: 'magic' });
    expect(valve.effects[0]!.then.some((effect) => effect.kind === 'markUsed')).toBe(false);
  });

  it('gives the Saint his bellows, breathing the furnace over the floor round him, and the Choir\u2019s hymn to heal by', () => {
    expect(project.adversaries.find((a) => a.id === SAINT_ID)!.features.map((f) => f.name)).toEqual(['The Bellows', 'The Hymn']);
    const bellows = project.abilities.find((a) => a.id === 'saint-the-bellows')!;
    expect([bellows.kind, bellows.trigger, bellows.uses, bellows.cost]).toEqual(['reaction', 'partyRolled', { count: 1, per: 'scene' }, {}]);
    expect(bellows.effects.at(-1)).toEqual({ kind: 'zone', zone: 'the-furnace-breath', name: 'The Furnace\u2019s Breath', condition: 'furnace-breath', at: 'actor', band: 'close', side: 'adversaries', onDeath: 'end' });
    const breath = project.conditionDefs!.find((c) => c.id === 'furnace-breath')!;
    expect(breath.onEnter?.effects.at(-1)).toEqual({ kind: 'damage', dice: '1d6', type: 'magic', target: { kind: 'target' } });
    const hymn = project.abilities.find((a) => a.id === 'saint-the-hymn')!;
    expect([hymn.kind, hymn.trigger, hymn.uses]).toEqual(['reaction', 'tookHitPoints', { count: 3, per: 'scene' }]);
    expect(hymn.effects[0]).toMatchObject({ kind: 'branch', when: { kind: 'flag', flag: 'choir-silent' }, otherwise: [{ kind: 'heal', amount: 1, target: { kind: 'actor' } }, { kind: 'log' }] });
    expect(project.adversaries.find((a) => a.id === STOKER_ID)!.features.map((f) => f.name)).toEqual(['Into the Chute']);
    expect(project.abilities.find((a) => a.id === 'stoker-into-the-chute')!.effects[0]).toMatchObject({ kind: 'attack', range: 'melee', onHit: [{ kind: 'push', to: 'close', target: { kind: 'hit' } }, { kind: 'log' }] });
  });

  it('lets the Choir be told why they sing - silencing the hymn - or not, and led up the well once the Saint is down', () => {
    const why = node(ILSE_DIALOGUE, 'why').choices!;
    expect(why.map((c) => c.text)).toEqual(['[Say nothing.]', 'They should know.']);
    expect(why[0]!.effects).toEqual([{ kind: 'setFlag', flag: 'kept-ilses-secret' }]);
    expect(node(ILSE_DIALOGUE, 'told').onEnter).toEqual([{ kind: 'setFlag', flag: 'choir-silent' }]);
    const choir = node(ILSE_DIALOGUE, 'choir').choices!;
    expect(choir.map((c) => c.goto)).toEqual(['furnace', 'saint', 'valve', 'why', 'after', undefined]);
    expect(choir[4]!.available).toEqual({ kind: 'all', of: [{ kind: 'objectiveDone', quest: FURNACE_QUEST, objective: 'the-saint' }, { kind: 'not', of: { kind: 'flag', flag: 'choir-led-up' } }] });
    const after = node(ILSE_DIALOGUE, 'after').onEnter!;
    const choristers = scene(NAVE_ID).decos.flatMap((d) => (d.id?.startsWith('chorister-') ? [d.id] : []));
    expect(choristers).toHaveLength(8);
    expect(after).toEqual(expect.arrayContaining([{ kind: 'setFlag', flag: 'choir-led-up' }, ...choristers.map((id) => ({ kind: 'remove', interactable: id }))]));
    expect(flagsRead(after)).toEqual(['kept-ilses-secret']);
    // Every one of them answers, singing or silent.
    for (const id of choristers) {
      const sings = deco(NAVE_ID, id).function!;
      expect(sings.kind === 'script' && flagsRead(sings.effects), id).toEqual(['choir-silent']);
    }
    // Ketch's slate knows they came up.
    const slate = deco(HUB_ID, 'ketchs-slate').function!;
    expect(slate.kind === 'script' && flagsRead(slate.effects)).toContain('choir-led-up');
  });

  it('reads the name burnt back at the foot of the last stair, whoever\u2019s it was, and the Choir sent up', () => {
    const stair = deco(HALL_ID, 'throne-stair').function!;
    const ids = project.party.map((sheet) => sheet.id);
    expect(stair.kind === 'script' && flagsRead(stair.effects)).toEqual(['name-burnt', 'level-4-done', ...ids.map((id) => `burnt-${id}`), 'choir-led-up']);
    const read = stair.kind === 'script' ? all(stair.effects).filter((effect) => effect.kind === 'branch' && effect.when.kind === 'flag' && effect.when.flag === `burnt-${ids[1]}`) : [];
    expect(read[0]?.kind === 'branch' && read[0].then[0]).toMatchObject({ kind: 'log', text: expect.stringContaining('and with it the house they grew up in') });
  });
});

describe('Level 3, rebuilt', () => {
  const project = ashwellProject();
  const scene = (id: string) => project.scenes.find((s) => s.id === id)!;
  const deco = (room: string, id: string) => scene(room).decos.find((d) => d.id === id)!;
  const dialogue = (id: string) => project.dialogues.find((d) => d.id === id)!;
  const all = (effects: readonly Effect[]): Effect[] => {
    const found: Effect[] = [];
    walkEffects(effects, (effect) => void found.push(effect));
    return found;
  };
  const flagsRead = (effects: readonly Effect[]): string[] => all(effects).flatMap((effect) => (effect.kind === 'branch' && effect.when.kind === 'flag' ? [effect.when.flag] : []));
  const catalogue = () => {
    const fn = deco(INDEX_ID, 'catalogue-drawers').function!;
    return fn.kind === 'script' ? all(fn.effects) : [];
  };

  it('is lit low, by the Kindlers\u2019 fire and the Index\u2019s lamps, with its shelves as shelves and a cabinet taller than a wall', () => {
    expect([READING_ID, STACKS_ID, INDEX_ID].map((id) => scene(id).light)).toEqual([0.3, 0.2, 0.26]);
    for (const id of [READING_ID, STACKS_ID]) expect(Object.values(scene(id).buildingTiles!).some((piece) => piece.tile === 'shelf'), id).toBe(true);
    const drawers = Object.values(scene(INDEX_ID).buildingTiles!).filter((piece) => piece.tile === 'drawers');
    expect(drawers).toHaveLength(8);
    expect(drawers.every((piece) => piece.height === 3)).toBe(true);
    // The reading platform is raised out of the water, and Aud and her fire are up on it.
    const raised = (id: string, at: { x: number; y: number }) => Object.values(scene(id).buildingTiles!).some((piece) => piece.x === at.x && piece.y === at.y && piece.shape === 'block' && piece.level === 0);
    expect(['aud-brennock', 'kindlers-fire'].map((id) => raised(READING_ID, deco(READING_ID, id).position))).toEqual([true, true]);
    expect(raised(INDEX_ID, deco(INDEX_ID, 'catalogue-drawers').position)).toBe(true);
  });

  it('has the Index read the party\u2019s entry aloud at their first roll: a looping countdown, quicker with a name of theirs filed, slower for those who knew', () => {
    expect(project.adversaries.find((a) => a.id === INDEX_BOSS_ID)!.features.map((f) => f.name)).toEqual(['Reads You Aloud']);
    const reads = project.abilities.find((a) => a.id === 'index-reads-you-aloud')!;
    expect([reads.kind, reads.trigger, reads.uses, reads.cost]).toEqual(['reaction', 'partyRolled', { count: 1, per: 'scene' }, {}]);
    const counts = all(reads.effects).filter((effect) => effect.kind === 'countdown');
    // Knowing, then a name filed: four ways, read in that order.
    expect(counts.map((c) => c.kind === 'countdown' && c.start)).toEqual(['3', '4', '2', '3']);
    for (const c of counts) expect(c).toMatchObject({ countdown: 'the-index-reads', advance: 'standard', loop: 'reset', onDeath: 'end' });
    const rung = counts[0]!.kind === 'countdown' ? counts[0]!.effects : [];
    // A line further each time round, and every one of them rolling not to flinch.
    expect(rung[0]).toEqual({ kind: 'addVar', name: 'index-read', by: 1 });
    expect(rung.at(-1)).toMatchObject({ kind: 'reactionRoll', difficulty: 14, trait: 'instinct', targets: { kind: 'party' }, onFail: [{ kind: 'markStress', amount: 1, target: { kind: 'hit' } }] });
    expect(flagsRead(rung)).toEqual(['annick-spared', 'gave-grales-name', 'gave-ketchs-name', 'gave-our-own', 'annick-named-living', 'gave-annicks-name', 'broker-fought']);
    expect(project.cards.find((c) => c.id === 'index-reads-you-aloud')!.grant).toEqual({ kind: 'adversary', adversaries: [INDEX_BOSS_ID] });
  });

  it('gives the ink-wraiths a pull into the water, which holds whoever it catches', () => {
    expect(project.adversaries.find((a) => a.id === INK_WRAITH_ID)!.features.map((f) => f.name)).toEqual(['Pulled Under']);
    const pulled = project.abilities.find((a) => a.id === 'wraith-pulled-under')!;
    expect([pulled.cost, pulled.effects[0]]).toEqual([{ bad: 1 }, expect.objectContaining({ kind: 'attack', range: 'veryClose', onHit: [{ kind: 'applyCondition', condition: 'restrained', target: { kind: 'hit' } }, expect.objectContaining({ kind: 'log' })] })]);
  });

  it('hides things in pages: a Kindler\u2019s note on the Index behind a Knowledge roll, and Aud\u2019s own card on the Kindlers\u2019 shelf', () => {
    const page = deco(READING_ID, 'drifting-page').function!;
    if (page.kind !== 'trapped') throw new Error('the drifting page is no roll');
    expect([page.trait, page.difficulty]).toEqual(['knowledge', 13]);
    expect(page.success?.kind === 'script' && page.success.effects).toContainEqual({ kind: 'setFlag', flag: 'knows-the-index' });
    expect(page.failure?.kind === 'script' && page.failure.effects[0]).toEqual({ kind: 'markStress', amount: 1, target: { kind: 'actor' } });
    const shelf = deco(STACKS_ID, 'kindlers-shelf').function!;
    expect(shelf.kind === 'script' && shelf.effects[0]).toMatchObject({ kind: 'branch', when: { kind: 'encounter', id: 'the-stacks', state: 'ended' } });
    expect(shelf.kind === 'script' && all(shelf.effects)).toContainEqual({ kind: 'setFlag', flag: 'read-auds-entry' });
    // Aud answers both: the name the Broker filed, and the card read.
    const fire = dialogue(AUD_DIALOGUE).nodes.find((n) => n.id === 'fire')!.choices!;
    expect(fire.map((c) => c.goto)).toEqual(['who', 'burning', 'deeper', 'ash', 'whole', 'filed', 'entry', undefined]);
    expect(fire[6]!.available).toEqual({ kind: 'all', of: [{ kind: 'flag', flag: 'read-auds-entry' }, { kind: 'not', of: { kind: 'flag', flag: 'told-aud' } }] });
    // Told once, she has said her piece.
    expect(dialogue(AUD_DIALOGUE).nodes.find((n) => n.id === 'entry')!.onEnter).toEqual([{ kind: 'setFlag', flag: 'told-aud' }]);
  });

  it('pays back what the Market took: the party\u2019s own name found and read back, Annick\u2019s card to tear out, and Aud\u2019s line remembered', () => {
    const found = catalogue();
    const ours = found.find((effect) => effect.kind === 'branch' && effect.when.kind === 'flag' && effect.when.flag === 'gave-our-own');
    expect(ours?.kind === 'branch' && ours.then).toEqual(expect.arrayContaining([{ kind: 'clearStress', amount: 2, target: { kind: 'party' } }, { kind: 'setFlag', flag: 'found-our-own' }]));
    expect(flagsRead(found)).toEqual(expect.arrayContaining(['gave-our-own', 'gave-annicks-name', 'annick-named-living', 'read-auds-entry']));
    const choice = found.find((effect) => effect.kind === 'choice');
    if (choice?.kind !== 'choice') throw new Error('the catalogue offers no choice');
    // Burning stays the first answer; tearing Annick's card out is for those who sold it.
    expect(choice.options.map((o) => o.label)).toEqual(['Burn it.', 'Leave it.', 'Tear out Annick\u2019s card, and leave the rest.']);
    expect(choice.options[2]!.available).toEqual({ kind: 'flag', flag: 'gave-annicks-name' });
    expect(choice.options[2]!.effects).toContainEqual({ kind: 'setFlag', flag: 'freed-annicks-name' });
  });

  it('has the sealed stair\u2019s page read back what the party did in the Library', () => {
    const stair = deco(INDEX_ID, 'furnace-stair').function!;
    expect(stair.kind === 'script' && flagsRead(stair.effects)).toEqual(['level-3-done', 'found-our-own', 'freed-annicks-name', 'burned-the-index']);
  });
});

describe('Level 2, rebuilt', () => {
  const project = ashwellProject();
  const scene = (id: string) => project.scenes.find((s) => s.id === id)!;
  const deco = (room: string, id: string) => scene(room).decos.find((d) => d.id === id)!;
  const dialogue = (id: string) => project.dialogues.find((d) => d.id === id)!;
  const choice = (id: string, node: string, text: string) => dialogue(id).nodes.find((n) => n.id === node)!.choices!.find((c) => c.text === text)!;
  const flagsRead = (effects: readonly Effect[]): string[] => {
    const read: string[] = [];
    walkEffects(effects, (effect) => void (effect.kind === 'branch' && effect.when.kind === 'flag' && read.push(effect.when.flag)));
    return read;
  };

  it('is lit low, by its lamps: the Market by fat, the pit nearly dark, the Counting House warm', () => {
    expect([MARKET_ID, PIT_ID, COUNTING_ID].map((id) => scene(id).light)).toEqual([0.42, 0.24, 0.55]);
    // Stacked bone, a furniture of its own, is the walls of the Market and the drifts in the pit.
    for (const id of [MARKET_ID, PIT_ID]) expect(Object.values(scene(id).buildingTiles!).some((piece) => piece.tile === 'bones'), id).toBe(true);
  });

  it('has the Sexton ring the bell at the party\u2019s first roll: a looping countdown of four that calls two of the dead, until he falls or stops', () => {
    const sexton = scene(PIT_ID).encounters[0]!.adversaries.find((a) => a.id === 'sexton-mott')!;
    expect([sexton.adversary, sexton.interaction]).toEqual([SEXTON_ID, { kind: 'threshold', dialogue: SEXTON_DIALOGUE, percent: 50 }]);
    expect(project.cards.find((c) => c.id === 'sexton-the-bell')!.grant).toEqual({ kind: 'adversary', adversaries: [SEXTON_ID] });
    const bell = project.abilities.find((a) => a.id === 'sexton-the-bell')!;
    expect([bell.kind, bell.trigger, bell.uses, bell.cost]).toEqual(['reaction', 'partyRolled', { count: 1, per: 'scene' }, {}]);
    const countdown = bell.effects.find((e) => e.kind === 'countdown')!;
    expect(countdown).toMatchObject({ start: '4', advance: 'standard', loop: 'reset', onDeath: 'end' });
    const rung = countdown.kind === 'countdown' ? countdown.effects[0]! : undefined;
    // Talked down, he has let go: the bell calls nobody after.
    expect(rung).toMatchObject({ kind: 'branch', when: { kind: 'flag', flag: 'mott-talked' }, otherwise: [{ kind: 'summon', adversary: BELL_CALLED_ID, count: '2', range: 'close' }, { kind: 'log' }] });
    expect(project.adversaries.find((a) => a.id === BELL_CALLED_ID)!.features.map((f) => f.name)).toEqual(['Minion (4)']);
    expect(project.adversaryModels[BELL_CALLED_ID]).toBe('fen-lurker');
    expect(dialogue(SEXTON_DIALOGUE).nodes.find((n) => n.id === 'stops')!.onEnter).toEqual([{ kind: 'setFlag', flag: 'mott-talked' }, { kind: 'setFlag', flag: 'knows-the-bell' }]);
  });

  it('gives the pit\u2019s ghouls a bite that feeds them, and the Broker momentum and her people at her call', () => {
    expect(project.adversaries.find((a) => a.id === GHOUL_ID)!.features.map((f) => f.name)).toEqual(['Feed']);
    expect(project.abilities.find((a) => a.id === 'ghoul-feed')!.effects[0]).toMatchObject({ kind: 'attack', range: 'melee', onHit: [{ kind: 'heal', amount: 1, target: { kind: 'actor' } }, { kind: 'log' }] });
    expect(project.adversaries.find((a) => a.id === BROKER_ID)!.features.map((f) => f.name)).toEqual(['Momentum', 'Call in the Debt']);
    const debt = project.abilities.find((a) => a.id === 'broker-call-in-the-debt')!;
    expect([debt.cost, debt.effects.at(-1)]).toEqual([{ bad: 2 }, { kind: 'spotlight', count: '2' }]);
  });

  it('lets the bell be learned twice over - from Mott, or the chit in the rope - and Grale caught with it: his purse, or his name to the Broker', () => {
    const rope = deco(PIT_ID, 'bell-rope').function!;
    const cut: Effect[] = [];
    if (rope.kind === 'script') walkEffects(rope.effects, (effect) => void cut.push(effect));
    expect(cut).toContainEqual({ kind: 'setFlag', flag: 'knows-the-bell' });
    expect(choice(GRALE_DIALOGUE, 'greet', 'Your sexton rings the bell. You pay him to.').available).toEqual({ kind: 'all', of: [{ kind: 'flag', flag: 'knows-the-bell' }, { kind: 'not', of: { kind: 'flag', flag: 'confronted-grale' } }] });
    expect(choice(GRALE_DIALOGUE, 'bell', 'Take the purse.').effects).toEqual(expect.arrayContaining([{ kind: 'addItem', item: 'gold', quantity: 25 }, { kind: 'setFlag', flag: 'took-grales-purse' }]));
    // His name is the Broker's to take only from those who know, and did not take his money for keeping quiet.
    const grale = choice(SELA_DIALOGUE, 'terms', 'Take Usher Grale\u2019s. He rings your pit bell for bone.');
    expect(grale.available).toMatchObject({ kind: 'all', of: [{ kind: 'not' }, { kind: 'flag', flag: 'knows-the-bell' }, { kind: 'not', of: { kind: 'flag', flag: 'took-grales-purse' } }] });
    const given: Effect[] = [];
    walkEffects(dialogue(SELA_DIALOGUE).nodes.find((n) => n.id === 'grale')!.onEnter!, (effect) => void given.push(effect));
    expect(given).toEqual(expect.arrayContaining([{ kind: 'setFlag', flag: 'gave-grales-name' }, { kind: 'giveKey', key: BONE_KEY }]));
  });

  it('reads Annick back: a dead man\u2019s name for a roll, or a spared man\u2019s for nothing, and the Broker knows which', () => {
    const dead = choice(SELA_DIALOGUE, 'terms', 'Hob Annick is dead. Take his.');
    const living = choice(SELA_DIALOGUE, 'terms', 'Take Hob Annick\u2019s. He gave us his key; he can spare his name.');
    expect(dead.available).toMatchObject({ kind: 'all', of: [{ kind: 'not' }, { kind: 'not', of: { kind: 'flag', flag: 'annick-spared' } }] });
    expect([living.available, living.check]).toEqual([{ kind: 'all', of: [{ kind: 'not', of: expect.anything() }, { kind: 'flag', flag: 'annick-spared' }] }, undefined]);
    expect(dialogue(SELA_DIALOGUE).nodes.find((n) => n.id === 'annick-living')!.onEnter).toEqual(expect.arrayContaining([{ kind: 'setFlag', flag: 'annick-named-living' }, { kind: 'giveKey', key: BONE_KEY }]));
  });

  it('sells keepsakes to the Guild - Tam\u2019s ring among them, which Ketch buys back - and Vane\u2019s page below knows what the key cost', () => {
    const ring = dialogue(CLERK_DIALOGUE).nodes.find((n) => n.id === 'ring')!;
    expect(ring.onEnter).toEqual([{ kind: 'removeItem', item: 'tams-ring', quantity: 1 }, { kind: 'addItem', item: 'gold', quantity: 30 }, { kind: 'setFlag', flag: 'sold-the-ring' }]);
    const slate = deco(HUB_ID, 'ketchs-slate').function!;
    expect(slate.kind === 'script' && flagsRead(slate.effects)).toContain('sold-the-ring');
    const stair = deco(COUNTING_ID, 'library-stair').function!;
    // Most particular first: a living man's name is also a name of Annick's.
    expect(stair.kind === 'script' && flagsRead(stair.effects)).toEqual(['level-2-done', 'gave-grales-name', 'gave-ketchs-name', 'gave-our-own', 'annick-named-living', 'gave-annicks-name', 'broker-fought']);
  });
});

describe('Level 1, rebuilt', () => {
  const project = ashwellProject();
  const scene = (id: string) => project.scenes.find((s) => s.id === id)!;
  const deco = (room: string, id: string) => scene(room).decos.find((d) => d.id === id)!;
  const placed = (room: string, id: string) => scene(room).encounters.flatMap((e) => e.adversaries).find((a) => a.id === id)!;
  const dialogue = (id: string) => project.dialogues.find((d) => d.id === id)!;

  it('is lit by what burns in it: the Lantern a low lamp, the cistern darker, the Kennel nearly black', () => {
    expect([HUB_ID, THROAT_ID, KENNEL_ID, SUMP_ID].map((id) => scene(id).light)).toEqual([0.5, 0.3, 0.22, 0.3]);
    for (const id of [HUB_ID, THROAT_ID, KENNEL_ID, SUMP_ID]) expect(scene(id).decos.some((d) => ['camp-fire-prop', 'standing-torch-prop', 'wall-torch-prop'].includes(d.model)), id).toBe(true);
  });

  it('gives the Lantern a shelf to buy from, a hearth to sleep by for five gold, and a slate that remembers', () => {
    const shelf = deco(HUB_ID, 'ketchs-shelf').function!;
    expect(shelf.kind === 'shop' && shelf.shop.stock.map((s) => s.item)).toEqual(['consumable-minor-health-potion', 'consumable-minor-stamina-potion', 'healing-draught']);
    const hearth = deco(HUB_ID, 'the-hearth').function!;
    expect(hearth.kind === 'script' && hearth.effects[0]).toMatchObject({ kind: 'branch', when: { kind: 'hasItem', item: 'gold', quantity: 5 } });
    const slate = deco(HUB_ID, 'ketchs-slate').function!;
    const read: string[] = [];
    if (slate.kind === 'script') walkEffects(slate.effects, (effect) => void (effect.kind === 'branch' && effect.when.kind === 'flag' && read.push(effect.when.flag)));
    expect(read).toEqual(['gave-ketchs-name', 'returned-the-ring', 'sold-the-ring', 'annick-spared', 'choir-led-up', 'ending-burned']);
  });

  it('hides the Warden’s token behind a stone an Instinct roll finds, once; and Tam Ketch’s ring in the Kennel, for Ketch', () => {
    const stone = deco(THROAT_ID, 'loose-stone').function!;
    expect(stone).toMatchObject({ kind: 'trapped', trait: 'instinct', difficulty: 12, repeatable: false });
    const chest = deco(KENNEL_ID, 'kennel-chest').function!;
    expect(chest.kind === 'container' && chest.items.map((i) => i.item)).toContain('tams-ring');
    const ring = dialogue('mother-ketch').nodes.find((n) => n.id === 'ring')!;
    expect(ring.onEnter).toEqual(expect.arrayContaining([{ kind: 'removeItem', item: 'tams-ring', quantity: 1 }, { kind: 'setFlag', flag: 'returned-the-ring' }]));
  });

  it('has Nails talk at three fifths, and the Warden at half: shown his token, or told by her, he gives the key and is spared', () => {
    expect(placed(THROAT_ID, 'nails').interaction).toEqual({ kind: 'threshold', dialogue: 'nails', percent: 60 });
    expect(dialogue('nails').nodes.find((n) => n.id === 'annick')!.onEnter).toEqual([{ kind: 'setFlag', flag: 'nails-talked' }]);
    expect(placed(SUMP_ID, 'hob-annick').interaction).toEqual({ kind: 'threshold', dialogue: 'hob-annick', percent: 50 });
    const [spare, finish] = dialogue('hob-annick').nodes[0]!.choices!;
    expect(spare!.available).toEqual({ kind: 'any', of: [{ kind: 'hasItem', item: 'keepers-token' }, { kind: 'flag', flag: 'nails-talked' }] });
    expect(finish!.effects).toEqual([{ kind: 'setAttitude', attitude: 'hostile' }]);
    expect(dialogue('hob-annick').nodes.find((n) => n.id === 'keeper')!.onEnter).toEqual(expect.arrayContaining([{ kind: 'giveKey', key: SUMP_KEY }, { kind: 'setFlag', flag: 'annick-spared' }]));
    // And Vane's page below the gate knows which it was.
    const stair = deco(SUMP_ID, 'stair-down').function!;
    const read: string[] = [];
    if (stair.kind === 'script') walkEffects(stair.effects, (effect) => void (effect.kind === 'branch' && effect.when.kind === 'flag' && read.push(effect.when.flag)));
    expect(read).toContain('annick-spared');
  });

  it('gives the Warden a second spotlight and a chain that holds, and makes the lamp moths minions', () => {
    const warden = project.adversaries.find((a) => a.id === WARDEN_ID)!;
    expect(warden.features.map((f) => f.name)).toEqual(['Relentless (2)', 'Drag Under']);
    const card = project.cards.find((c) => c.id === 'warden-drag-under')!;
    expect(card.grant).toEqual({ kind: 'adversary', adversaries: [WARDEN_ID] });
    const drag = project.abilities.find((a) => a.id === 'warden-drag-under')!;
    expect(drag.effects[0]).toMatchObject({ kind: 'attack', range: 'close', onHit: [{ kind: 'applyCondition', condition: 'restrained', target: { kind: 'hit' } }, { kind: 'log' }] });
    expect(project.adversaries.find((a) => a.id === 'lamp-moth')!.features.map((f) => f.name)).toEqual(['Minion (3)']);
    expect(scene(SUMP_ID).encounters[0]!.adversaries.filter((a) => a.adversary === 'lamp-moth')).toHaveLength(2);
  });
});
