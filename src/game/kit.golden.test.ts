/**
 * What the party carries and how it is kitted out, as the Rust server must run it (`docs/SERVER.md`, phase 2).
 *
 * Sessions of a party buying and selling at the shops (`shopContents`, `purse`, `offerFor`, `sellables`,
 * `buyFrom`, `sellTo`, and a shop's wares taken through the container window), putting on and taking off
 * what it carries (`equipItem`, `unequipItem`, `gearOf`), the binder's cards (`gearCard`, `gearView`), using
 * an item (`useItem`), the cards a character has chosen (`loadoutView`, `swapCard`), rests (`rest`), and
 * what a stat block prints (`statBlockCards`), a level granted and taken (`awaitingLevel`, `applyLevelUp`), and
 * the campaign put down and picked up again (`saveBlockedBy`, `saveGame`, `serialiseSave`, `loadGame`,
 * `loadGameText` - its own saves, older ones migrated, and saves refused) between rooms travelled to - with the
 * fight going on around them. After each step its
 * answer and everything `fight.golden.test.ts` records, and every sheet's gear.
 * `UPDATE_GOLDEN=1 npx vitest run src/game/kit.golden.test.ts` writes `server/fixtures/kit.json`;
 * `server/hooks/tests/golden_kit.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../engine/core/rng';
import type { Spot } from '../engine/grid/grid';
import { EQUIPMENT, itemsFor } from '../engine/content/equipment/catalogue';
import type { ContentPack } from '../engine/content/pack/import';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { Response } from '../engine/script/runner';
import { scenarioSnapshot } from '../engine/script/world';
import type { RangeBand } from '../engine/rules/range';
import { answerPending, attackWithSelected, buildProjectScene, endTurn, moveSelectedTo, type DemoScene } from './demo-scene';
import { abilitiesOf, loadoutView, rest, statBlockCards, swapCard, useAbility, type RestMove } from './demo-abilities';
import { equipItem, gearOf, itemForGear, unequipItem, type GearSlot } from './equip';
import { gearCard, gearView } from './gear';
import { buyFrom, offerFor, purse, sellables, sellTo, shopContents, shopOf } from './shop';
import { containerContents, takeFromContainer } from './prop-use';
import { useItem } from './use-item';
import { DEMO_ADVERSARIES, DEMO_CHARACTERS } from './demo-rules';
import { characterContentFor, travelTo } from './room';
import { startEncounter } from './movement';
import { inCombat } from './moment';
import { syncTalks } from './talks';
import { loadoutOf, vaultOf } from '../engine/content/abilities';
import type { Advancement, LevelUpPlan } from '../engine/character/progression';
import { applyLevelUp, awaitingLevel } from './level-up';
import { loadGame, loadGameText, saveBlockedBy, saveGame, serialiseSave, type SaveGame } from './save';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../server/fixtures/kit.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

/** The content as the Rust reads it - the gear with its numbers, the cards with their words. */
function contentJson(pack: ContentPack) {
  return {
    weapons: [...pack.weapons.values()].map(({ id, name, tier, slot, trait, range, damage, burden, features }) => ({ id, name, tier, slot, trait, range, damage, burden, features })),
    armors: [...pack.armors.values()].map(({ id, name, tier, baseThresholds, baseScore, features }) => ({ id, name, tier, baseThresholds, baseScore, features })),
    classes: [...pack.classes.values()].map(({ id, name, domains, startingEvasion, startingHitPoints }) => ({ id, name, domains, startingEvasion, startingHitPoints })),
    ancestries: [...pack.ancestries.values()].map(({ id, name }) => ({ id, name })),
    communities: [...pack.communities.values()].map(({ id, name }) => ({ id, name })),
    subclasses: [...pack.subclasses.values()].map(({ id, name, classId, domains, spellcastTrait }) => ({ id, name, classId, domains, ...(spellcastTrait === undefined ? {} : { spellcastTrait }) })),
    cards: [...pack.cards.values()].map(({ id, name, grant, domain, type, level, recallCost, text, features }) => ({ id, name, grant, text, features, ...(domain === undefined ? {} : { domain }), ...(type === undefined ? {} : { type }), ...(level === undefined ? {} : { level }), ...(recallCost === undefined ? {} : { recallCost }) })),
  };
}

// --- What a step is seen as --------------------------------------------------------------------------------

function view(demo: DemoScene, since: number) {
  const e = demo.encounter;
  const circles = e === null ? [] : [...(e as unknown as { circles: Map<string, { anchor: Spot; band: RangeBand }> }).circles];
  const seen = clone({
    scene: demo.scene.id,
    fight: e === null ? null : { id: e.encounterId, view: e.view(), log: e.log, circles: circles.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, c]) => [id, c.anchor, c.band]) },
    pending: demo.pending === null ? null : demo.pending.kind === 'script' ? { prompt: demo.pending.prompt, dialogue: demo.pending.dialogue?.id ?? null } : { kind: demo.pending.kind, prompt: demo.pending.prompt },
    selected: demo.party.selected,
    bad: demo.state.bad,
    entities: demo.state.allEntities().map((x) => [x.id, x.faction, x.tile, x.at.x, x.at.y, x.alive, x.dead ?? null, x.hitPoints, x.stress, x.armorSlots, x.good ?? null, [...x.conditions], x.truce ?? null]),
    sheets: [...demo.sheets.values()].map((s) => [s.id, s.loadout ?? null, s.primaryWeaponId ?? null, s.secondaryWeaponId ?? null, s.armorId ?? null, s.level, s.domainCards, s.levels ?? null]),
    log: demo.log.slice(since),
    floaters: demo.floaters,
    motions: demo.motions,
    rolls: demo.rolls.map(({ who, what, roll }) => ({ who, what, roll })),
    things: demo.state.snapshot().interactables,
    scenario: scenarioSnapshot(demo.scenario),
    rng: demo.rng.save(),
    left: [...demo.snapshots.keys()],
    party: demo.project.party.map((sheet) => sheet.id),
  });
  demo.floaters.length = 0;
  demo.motions.length = 0;
  demo.rolls.length = 0;
  return seen;
}

function answerFor(demo: DemoScene, g: Rng): Response {
  const p = demo.pending;
  if (p === null) return { kind: 'continue' };
  if (p.kind !== 'script') {
    const options = p.prompt.kind === 'choice' ? p.prompt.options : [];
    return options.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: g.pick(options).index };
  }
  const d = p.dialogue;
  if (d !== null && d.view !== null && d.prompt === null) {
    const enabled = d.view.options.filter((o) => o.enabled);
    return enabled.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: g.pick(enabled).index };
  }
  const prompt = d === null ? p.prompt : d.prompt;
  if (prompt === null) return { kind: 'continue' };
  switch (prompt.kind) {
    case 'check':
      return g.nextInt(5) === 0 ? { kind: 'cancel' } : { kind: 'roll' };
    case 'choice':
      return { kind: 'choose', index: g.pick(prompt.options).index };
    case 'rolled':
      return { kind: 'answered' };
    default:
      return { kind: 'continue' };
  }
}

// --- A step ------------------------------------------------------------------------------------------------

type Step = Record<string, unknown> & { step: string };

/** Every shop in the room: the props and creatures that keep one. */
function shopsOf(demo: DemoScene): string[] {
  const props = demo.scene.decos.map((d) => d.id);
  const creatures = demo.scene.encounters.flatMap((e) => e.adversaries.map((a) => a.id));
  return [...props, ...creatures].filter((id): id is string => id !== undefined && shopOf(demo, id) !== null);
}

/** Do what a step says, and say what came of it. */
function perform(demo: DemoScene, step: Step): unknown {
  const s = step as unknown as Record<string, never>;
  switch (step.step) {
    case 'give':
      demo.world.addItem(s['item'], s['count']);
      return null;
    case 'shop': {
      const shop = shopOf(demo, s['id'])!;
      return {
        contents: shopContents(demo, s['id']),
        sellables: sellables(demo, s['id']),
        purse: purse(demo, shop),
        offers: (s['items'] as string[]).map((item) => offerFor(demo, shop, item)),
        container: containerContents(demo, s['id']).map(({ item, name, count }) => [item, name, count]),
      };
    }
    case 'buy':
      return buyFrom(demo, s['id'], s['item']);
    case 'take':
      return takeFromContainer(demo, s['id'], s['item']);
    case 'sell':
      return sellTo(demo, s['id'], s['item']);
    case 'equip':
      return equipItem(demo, s['id'], s['item']);
    case 'unequip':
      return unequipItem(demo, s['id'], s['slot'] as GearSlot);
    case 'gear':
      return { view: gearView(demo, s['id']), of: gearOf(demo, s['id']) };
    case 'card':
      return gearCard(demo, s['item']);
    case 'useItem':
      return useItem(demo, s['item']);
    case 'loadout':
      return loadoutView(demo, s['id']);
    case 'swap':
      return swapCard(demo, s['id'], s['cardIn'], s['cardOut'] ?? undefined, { resting: s['resting'] });
    case 'rest':
      return rest(demo, s['kind'], s['plan']);
    case 'statBlock':
      return statBlockCards(demo, s['id']);
    case 'grant':
      demo.scenario.partyLevel = Math.max(demo.scenario.partyLevel, s['level']);
      return null;
    case 'travel':
      return travelTo(demo, s['id']);
    case 'save': {
      const save = saveGame(demo);
      if (save !== null) saved.set(demo, clone(save));
      return { blocked: saveBlockedBy(demo), save, text: serialiseSave(demo) };
    }
    case 'load':
      return s['text'] !== undefined ? loadGameText(demo, s['text']) : loadGame(demo, s['save']);
    case 'awaiting':
      return awaitingLevel(demo);
    case 'levelUp': {
      const result = applyLevelUp(demo, s['id'], s['plan']);
      return result.ok ? result : { ok: false, issues: result.issues.map(({ field, message }) => ({ field, message })) };
    }
    case 'fell': {
      const body = demo.state.entity(s['id'])!;
      body.hitPoints = { ...body.hitPoints, marked: body.hitPoints.max };
      body.alive = false;
      return null;
    }
    case 'hurt': {
      const body = demo.state.entity(s['id'])!;
      body.hitPoints = { ...body.hitPoints, marked: Math.min(body.hitPoints.max - 1, body.hitPoints.marked + (s['hp'] as number)) };
      body.stress = { ...body.stress, marked: Math.min(body.stress.max, body.stress.marked + (s['stress'] as number)) };
      body.armorSlots = { ...body.armorSlots, marked: Math.min(body.armorSlots.max, body.armorSlots.marked + (s['armor'] as number)) };
      return null;
    }
    case 'use':
      return useAbility(demo, s['id'], s['ability'], s['targets']);
    case 'fight':
      startEncounter(demo, s['id']);
      return null;
    case 'attack':
      return attackWithSelected(demo, s['id']);
    case 'endTurn':
      return endTurn(demo);
    case 'move':
      return moveSelectedTo(demo, s['destination']);
    case 'answer':
      return answerPending(demo, s['response']);
    case 'select':
      return { selected: demo.party.selectNext(), moved: syncTalks(demo) };
  }
  throw new Error(`a step nobody knows: ${step.step}`);
}

/** A step picked at random, as the dice fall, from what makes sense now. */
function pickStep(demo: DemoScene, g: Rng, pool: readonly string[]): Step {
  const fighting = inCombat(demo);
  const selected = demo.party.selected;
  const members = demo.party.members();
  const member = (): string => (selected !== null && g.nextInt(2) === 0 ? selected : g.pick(members));
  const carried = [...demo.scenario.items.entries()].filter(([, n]) => n > 0).map(([id]) => id);
  const anyItem = (): string => (carried.length > 0 && g.nextInt(3) > 0 ? g.pick(carried) : g.nextInt(8) === 0 ? 'no-such-item' : g.pick(pool));
  const shops = shopsOf(demo);
  const kinds = demo.pending !== null
    ? (['answer', 'answer', 'answer', 'useItem', 'equip', 'swap', 'rest', 'gear', 'levelUp', 'save', 'load'] as const)
    : fighting
      ? (['use', 'useItem', 'useItem', 'equip', 'equip', 'unequip', 'attack', 'endTurn', 'endTurn', 'select', 'rest', 'swap', 'gear', 'hurt', 'levelUp', 'save', 'load'] as const)
      : (['save', 'save', 'load', 'load', 'travel', 'grant', 'awaiting', 'levelUp', 'levelUp', 'levelUp', 'give', 'give', 'shop', 'buy', 'buy', 'take', 'sell', 'sell', 'equip', 'equip', 'equip', 'unequip', 'gear', 'card', 'useItem', 'useItem', 'loadout', 'swap', 'swap', 'rest', 'rest', 'statBlock', 'hurt', 'use', 'fight', 'select', 'move'] as const);
  const kind = g.pick(kinds);
  switch (kind) {
    case 'give':
      return g.nextInt(3) === 0 ? { step: kind, item: 'gold', count: 1 + g.nextInt(30) } : { step: kind, item: g.pick(pool), count: 1 + g.nextInt(2) };
    case 'shop':
      return shops.length === 0 ? { step: 'gear', id: member() } : { step: kind, id: g.pick(shops), items: [g.pick(pool), anyItem(), 'gold'] };
    case 'buy':
    case 'take': {
      if (shops.length === 0) return { step: 'gear', id: member() };
      const id = g.pick(shops);
      const lines = shopContents(demo, id);
      return { step: kind, id, item: lines.length > 0 && g.nextInt(4) > 0 ? g.pick(lines).item : g.pick(pool) };
    }
    case 'sell': {
      if (shops.length === 0) return { step: 'gear', id: member() };
      const id = g.pick(shops);
      const lines = sellables(demo, id);
      return { step: kind, id, item: lines.length > 0 && g.nextInt(4) > 0 ? g.pick(lines).item : anyItem() };
    }
    case 'equip':
      return { step: kind, id: member(), item: anyItem() };
    case 'unequip':
      return { step: kind, id: member(), slot: g.pick(['primary', 'secondary', 'armor', 'secondary']) };
    case 'gear':
    case 'loadout':
      return { step: kind, id: member() };
    case 'card':
      return { step: kind, item: anyItem() };
    case 'useItem':
      return { step: kind, item: anyItem() };
    case 'swap': {
      const id = member();
      const character = demo.characters.get(id)!;
      const vault = vaultOf(character);
      const loadout = loadoutOf(character);
      const all = character.cards.map((c) => c.id);
      const cardIn = vault.length > 0 && g.nextInt(5) > 0 ? g.pick(vault) : g.pick(all);
      const cardOut = g.nextInt(3) === 0 ? null : loadout.length > 0 && g.nextInt(5) > 0 ? g.pick(loadout) : g.pick(all);
      return { step: kind, id, cardIn, cardOut, resting: g.nextInt(4) === 0 };
    }
    case 'rest': {
      const moves: Record<string, RestMove[]> = {};
      const others = [...members, 'nobody'];
      for (const id of [...members, 'nobody']) {
        if (g.nextInt(4) === 0) continue;
        moves[id] = [0, 1, 2].slice(0, 1 + g.nextInt(3)).map(() => {
          const pick = g.nextInt(4);
          const target = g.nextInt(3) === 0 ? { target: g.pick(others) } : {};
          return pick === 0 ? { kind: 'tendWounds', ...target } : pick === 1 ? { kind: 'clearStress' } : pick === 2 ? { kind: 'repairArmor', ...target } : { kind: 'prepare' };
        });
      }
      const plan: Record<string, unknown> = { moves };
      if (g.nextInt(3) === 0) {
        const id = g.pick(members);
        const cards = demo.characters.get(id)!.cards.map((c) => c.id);
        plan['loadouts'] = { [id]: [...cards.filter(() => g.nextInt(2) === 0), 'no-such-card'], ...(g.nextInt(2) === 0 ? { nobody: ['x'] } : {}) };
      }
      return { step: kind, kind: g.nextInt(2) === 0 ? 'short' : 'long', plan };
    }
    case 'travel': {
      const elsewhere = demo.project.scenes.map((scene) => scene.id).filter((id) => id !== demo.scene.id);
      return { step: kind, id: elsewhere.length === 0 || g.nextInt(6) === 0 ? 'nowhere' : g.pick(elsewhere) };
    }
    case 'save':
      return { step: kind };
    case 'load':
      return loadStep(demo, g);
    case 'grant':
      return { step: kind, level: Math.min(10, demo.scenario.partyLevel + (g.nextInt(3) === 0 ? 2 : 1)) };
    case 'awaiting':
      return { step: kind };
    case 'levelUp': {
      const waiting = awaitingLevel(demo);
      // With nobody waiting, a level is granted first - else nearly every level taken is refused for it.
      if (waiting.length === 0 && !fighting && demo.pending === null && demo.scenario.partyLevel < 10 && g.nextInt(4) > 0) return { step: 'grant', level: demo.scenario.partyLevel + 1 };
      const id = waiting.length > 0 && g.nextInt(5) > 0 ? g.pick(waiting) : g.pick([...members, 'nobody']);
      return { step: kind, id, plan: planFor(demo, g, id) };
    }
    case 'statBlock':
      return { step: kind, id: g.pick([...DEMO_ADVERSARIES.keys(), ...demo.project.adversaries.map((a) => a.id), 'nobody']) };
    case 'hurt':
      return { step: kind, id: g.pick(members), hp: g.nextInt(4), stress: g.nextInt(4), armor: g.nextInt(3) };
    case 'use': {
      const id = selected ?? g.pick(members);
      const mine = abilitiesOf(demo, id).filter((a) => a.kind === 'action' && a.source.card === 'kit-pack');
      return mine.length === 0 ? { step: 'gear', id } : { step: kind, id, ability: g.pick(mine).id, targets: [] };
    }
    case 'fight': {
      const fights = demo.scene.encounters.filter((e) => e.adversaries.length > 0 && e.adversaries.every((a) => a.interaction === undefined)).map((e) => e.id);
      return fights.length === 0 ? { step: 'gear', id: member() } : { step: kind, id: g.pick(fights) };
    }
    case 'attack': {
      const foes = demo.state.allEntities().filter((x) => x.alive && x.faction === 'adversary').map((x) => x.id);
      return { step: kind, id: foes.length === 0 ? 'nobody' : g.pick(foes) };
    }
    case 'endTurn':
      return { step: kind };
    case 'move': {
      const from = selected === null ? 0 : (demo.state.entity(selected)?.tile ?? 0);
      const x = Math.min(demo.grid.width - 1, Math.max(0, demo.grid.xOf(from) + g.nextInt(9) - 4));
      const y = Math.min(demo.grid.height - 1, Math.max(0, demo.grid.yOf(from) + g.nextInt(9) - 4));
      return { step: kind, destination: demo.grid.indexOf(x, y) };
    }
    case 'answer':
      return { step: kind, response: answerFor(demo, g) };
    case 'select':
      return { step: kind };
  }
}

/**
 * A plan for somebody's next level: two boxes from the common options, a card from their class's domains at a
 * level they may take it - now and then one too high, a box twice, or a box off the sheet, for the issues.
 */
function planFor(demo: DemoScene, g: Rng, id: string): LevelUpPlan {
  const sheet = demo.sheets.get(id);
  const content = characterContentFor(demo.project);
  const next = (sheet?.level ?? 1) + 1;
  const domains = sheet === undefined ? [] : (content.classes.get(sheet.classId)?.domains ?? []);
  const held = new Set(sheet?.domainCards ?? []);
  const cards = [...content.cards.values()].filter((c) => c.grant.kind === 'chosen' && c.domain !== undefined && domains.includes(c.domain) && !held.has(c.id));
  const fitting = cards.filter((c) => (c.level ?? 1) <= next);
  const card = (g.nextInt(6) === 0 || fitting.length === 0 ? (cards.length > 0 ? g.pick(cards) : null) : g.pick(fitting))?.id ?? 'no-such-card';
  const traits = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'] as const;
  const box = (): Advancement => {
    const pick = g.nextInt(10);
    if (pick < 3) {
      const a = g.pick(traits);
      const b = g.pick(traits.filter((x) => x !== a));
      return { kind: 'traits', traits: [a, b] };
    }
    if (pick < 5) return { kind: 'hitPoint' };
    if (pick < 7) return { kind: 'stress' };
    if (pick < 8) return { kind: 'evasion' };
    if (pick < 9) return next >= 5 || g.nextInt(4) === 0 ? { kind: 'proficiency' } : { kind: 'evasion' };
    return { kind: 'experiences', names: ['Vault-born', 'Road-worn'] };
  };
  const advancements = g.nextInt(8) === 0 ? [box()] : [box(), box()];
  // An Experience where the level grants one, and now and then where it does not, or none where it does.
  const named = [2, 5, 8].includes(next) !== (g.nextInt(8) === 0);
  return { advancements, domainCard: card, ...(named ? { experience: { name: 'Lessons learned', modifier: 2 } } : {}) };
}

/** The last save each session made, to be loaded again - whole, or spoiled one way or another. */
const saved = new WeakMap<DemoScene, SaveGame>();

/**
 * A save to load: the session's own last save as text or as it stands, an older one migrated on the way in,
 * one with somebody in it the project does not list, or one refused - not a save at all, from a newer build, another project's, a room it does not hold, a room
 * the project has not got, a sheet naming gear nobody has.
 */
const VARIANTS = ['own', 'own', 'own', 'object', 'object', 'old', 'joiner', 'garbage', 'newer', 'other', 'missing', 'unknown', 'sheet'] as const;
type Variant = (typeof VARIANTS)[number];

function loadStep(demo: DemoScene, g: Rng, chosen?: Variant): Step {
  const last = saved.get(demo);
  if (last === undefined) return g.nextInt(2) === 0 ? { step: 'load', text: 'not a save {' } : { step: 'save' };
  const save = clone(last);
  const variant = chosen ?? g.pick(VARIANTS);
  switch (variant) {
    case 'own':
      return { step: 'load', text: JSON.stringify(save) };
    case 'object':
      return { step: 'load', save };
    case 'old': {
      // From before a room said its size: version 5 gives the vault the width it had then.
      const scenes = Object.fromEntries(Object.entries(save.scenes).map(([id, scene]) => {
        const { room: _room, ...rest } = scene;
        return [id, id === 'the-husk-vault' ? rest : scene];
      }));
      return { step: 'load', text: JSON.stringify({ ...save, formatVersion: 4, scenes }) };
    }
    case 'joiner': {
      // Somebody who joined after the project was written, and was saved with the party.
      const first = save.sheets[0];
      const sheets = first === undefined ? save.sheets : [...save.sheets, { ...first, id: 'kit-joiner', name: 'Joiner' }];
      return { step: 'load', text: JSON.stringify({ ...save, sheets }) };
    }
    case 'garbage':
      return { step: 'load', text: JSON.stringify({ ...save, rng: 'seven' }) };
    case 'newer':
      return { step: 'load', text: JSON.stringify({ ...save, formatVersion: 99 }) };
    case 'other':
      return { step: 'load', text: JSON.stringify({ ...save, projectId: 'somebody-elses' }) };
    case 'missing':
      return { step: 'load', save: { ...save, sceneId: 'a-room-not-saved' } };
    case 'unknown': {
      const scenes = { ...save.scenes, 'a-room-since-deleted': save.scenes[save.sceneId]! };
      return { step: 'load', save: { ...save, sceneId: 'a-room-since-deleted', scenes } };
    }
    case 'sheet': {
      const sheets = save.sheets.map((sheet, at) => (at === 0 ? { ...sheet, primaryWeaponId: 'no-such-weapon' } : sheet));
      return { step: 'load', text: JSON.stringify({ ...save, sheets }) };
    }
  }
}

// --- A session ---------------------------------------------------------------------------------------------

/** The items worth carrying about: what the shops stock, gear of each kind, the workshop's own. */
function poolOf(project: ProjectDoc): string[] {
  const content = characterContentFor(project);
  const items = itemsFor(project);
  const weapons = items.filter((i) => i.kind === 'weapon' && i.contentId !== undefined && content.weapons.has(i.contentId));
  const twoHanded = weapons.filter((i) => content.weapons.get(i.contentId!)!.burden === 'twoHanded').slice(0, 3);
  const secondary = weapons.filter((i) => content.weapons.get(i.contentId!)!.slot === 'secondary').slice(0, 3);
  const primary = weapons.filter((i) => content.weapons.get(i.contentId!)!.slot !== 'secondary' && content.weapons.get(i.contentId!)!.burden !== 'twoHanded').slice(0, 3);
  const armors = items.filter((i) => i.kind === 'armor' && i.contentId !== undefined && content.armors.has(i.contentId)).slice(0, 4);
  const own = project.items.map((i) => i.id);
  const consumables = items.filter((i) => i.kind === 'consumable').slice(0, 4);
  return [...new Set([...own, ...twoHanded, ...secondary, ...primary, ...armors, ...consumables].map((i) => (typeof i === 'string' ? i : i.id)))];
}

function session(g: Rng, name: string, project: number, input: ProjectDoc, length: number, tour: readonly Step[] = []) {
  const demo = buildProjectScene(projectSchema.parse(clone(input)), `kit:${name}`);
  const pool = poolOf(demo.project);
  const start = view(demo, 0);
  const steps: unknown[] = [];
  const take = (planned: Step): void => {
    // A tour's load names its variant; the save it spoils is whatever was saved last.
    const step = planned.step === 'load' && planned['variant'] !== undefined ? loadStep(demo, g, planned['variant'] as Variant) : planned;
    const since = demo.log.length;
    const result = perform(demo, step);
    steps.push({ ...step, result: clone(result), after: view(demo, since) });
  };
  for (const step of tour) take(step);
  for (let n = 0; n < length; n++) take(pickStep(demo, g, pool));
  return { name, project, start, steps };
}

/**
 * On purpose, in the workshop: the stall's limited line bought out and sold back, a party too poor, the fence
 * that buys nothing; a shield taken up and a two-handed weapon after it, which frees the hand; the shield
 * refused while it is held, the same weapon twice, nothing to take off, starting gear with no item; a draught,
 * a scroll that asks a roll and an item used while it waits; a full loadout, a recall with no Stress left, a
 * rest in the middle of a question, and a long rest with two preparing; the armour already worn, a thing worth
 * one sold for half, a seller's own coin offered it, a token spent and a fallen friend tended at a rest.
 */
function tourOf(demo: DemoScene): Step[] {
  const project = demo.project;
  const content = characterContentFor(project);
  const items = itemsFor(project);
  const [first, second] = demo.party.members() as [string, string];
  const shield = items.find((i) => i.kind === 'weapon' && content.weapons.get(i.contentId ?? '')?.slot === 'secondary')!.id;
  const big = items.find((i) => i.kind === 'weapon' && content.weapons.get(i.contentId ?? '')?.burden === 'twoHanded')!.id;
  const firstCards = demo.characters.get(first)!.cards.map((c) => c.id);
  const vaulted = vaultOf(demo.characters.get(first)!);
  const wearing = itemForGear(demo, demo.sheets.get(first)!.armorId)!.id;
  // A card the first may take at level 2: a chosen card of their class's domains, not held, level 1 or 2.
  const kara = demo.sheets.get(first)!;
  const theirs = content.classes.get(kara.classId)!.domains;
  const card = [...content.cards.values()].find((c) => c.grant.kind === 'chosen' && c.domain !== undefined && theirs.includes(c.domain) && (c.level ?? 1) <= 2 && !(kara.domainCards ?? []).includes(c.id))!.id;
  const hitAndRun: LevelUpPlan = { advancements: [{ kind: 'hitPoint' }, { kind: 'traits', traits: ['strength', 'agility'] }], domainCard: card, experience: { name: 'Vault-born', modifier: 2 } };
  return [
    { step: 'shop', id: 'kit-stall', items: ['kit-scroll', big, 'gold', 'husk-carapace'] },
    { step: 'give', item: 'gold', count: 3 },
    { step: 'buy', id: 'kit-stall', item: big },
    { step: 'give', item: 'gold', count: 100 },
    { step: 'buy', id: 'kit-stall', item: 'kit-scroll' },
    { step: 'buy', id: 'kit-stall', item: 'kit-scroll' },
    { step: 'buy', id: 'kit-stall', item: 'kit-scroll' },
    { step: 'shop', id: 'kit-stall', items: ['kit-scroll', 'kit-salve'] },
    { step: 'sell', id: 'kit-stall', item: 'kit-scroll' },
    { step: 'sell', id: 'kit-stall', item: 'gold' },
    { step: 'take', id: 'kit-stall', item: 'kit-scroll' },
    { step: 'sell', id: 'kit-fence', item: 'kit-scroll' },
    { step: 'shop', id: 'kit-fence', items: ['kit-scroll', 'husk-carapace'] },
    { step: 'shop', id: 'kit-empty', items: ['kit-scroll'] },
    { step: 'buy', id: 'kit-stall', item: big },
    { step: 'give', item: shield, count: 1 },
    { step: 'equip', id: first, item: shield },
    { step: 'gear', id: first },
    { step: 'equip', id: first, item: big },
    { step: 'equip', id: first, item: shield },
    { step: 'give', item: big, count: 1 },
    { step: 'equip', id: first, item: big },
    { step: 'unequip', id: first, slot: 'secondary' },
    { step: 'unequip', id: second, slot: 'primary' },
    { step: 'equip', id: first, item: 'kit-rock' },
    { step: 'give', item: 'kit-rock', count: 1 },
    { step: 'give', item: 'kit-broken-blade', count: 1 },
    { step: 'equip', id: first, item: 'kit-rock' },
    { step: 'equip', id: first, item: 'kit-broken-blade' },
    { step: 'equip', id: 'nobody', item: big },
    { step: 'equip', id: first, item: 'no-such-item' },
    { step: 'card', item: 'kit-rock' },
    { step: 'card', item: 'kit-relic' },
    { step: 'useItem', item: 'kit-relic' },
    { step: 'give', item: 'kit-relic', count: 1 },
    { step: 'useItem', item: 'kit-relic' },
    { step: 'give', item: 'kit-salve', count: 2 },
    { step: 'hurt', id: first, hp: 3, stress: 2, armor: 2 },
    { step: 'useItem', item: 'kit-salve' },
    { step: 'useItem', item: 'kit-scroll' },
    { step: 'useItem', item: 'kit-salve' },
    { step: 'save' },
    { step: 'equip', id: first, item: shield },
    { step: 'swap', id: first, cardIn: vaulted[0] ?? firstCards[0]!, cardOut: null, resting: false },
    { step: 'rest', kind: 'short', plan: { moves: {} } },
    { step: 'grant', level: 2 },
    { step: 'levelUp', id: first, plan: hitAndRun },
    { step: 'answer', response: { kind: 'roll' } },
    { step: 'awaiting' },
    { step: 'hurt', id: first, hp: 2, stress: 1, armor: 1 },
    { step: 'levelUp', id: first, plan: hitAndRun },
    { step: 'levelUp', id: first, plan: hitAndRun },
    { step: 'levelUp', id: 'nobody', plan: hitAndRun },
    { step: 'levelUp', id: second, plan: { advancements: [{ kind: 'proficiency' }, { kind: 'hitPoint' }], domainCard: 'no-such-card' } },
    { step: 'awaiting' },
    { step: 'loadout', id: first },
    { step: 'hurt', id: first, hp: 0, stress: 9, armor: 0 },
    { step: 'swap', id: first, cardIn: vaulted[0] ?? firstCards[0]!, cardOut: firstCards[0]!, resting: false },
    { step: 'swap', id: first, cardIn: vaulted[0] ?? firstCards[0]!, cardOut: firstCards[0]!, resting: true },
    { step: 'swap', id: first, cardIn: firstCards[0]!, cardOut: 'no-such-card', resting: false },
    { step: 'loadout', id: first },
    { step: 'use', id: first, ability: 'kit-rested', targets: [] },
    { step: 'use', id: first, ability: 'kit-longrested', targets: [] },
    { step: 'use', id: first, ability: 'kit-scened', targets: [] },
    { step: 'use', id: first, ability: 'kit-brace', targets: [] },
    { step: 'loadout', id: first },
    { step: 'rest', kind: 'short', plan: { moves: { [first]: [{ kind: 'prepare' }, { kind: 'clearStress' }, { kind: 'prepare' }], [second]: [{ kind: 'tendWounds', target: first }, { kind: 'repairArmor', target: 'nobody' }] } } },
    { step: 'hurt', id: second, hp: 4, stress: 3, armor: 3 },
    { step: 'rest', kind: 'long', plan: { moves: { [first]: [{ kind: 'prepare' }], [second]: [{ kind: 'prepare' }, { kind: 'tendWounds' }], nobody: [{ kind: 'prepare' }] }, loadouts: { [second]: [...firstCards.slice(0, 2)] } } },
    { step: 'give', item: wearing, count: 1 },
    { step: 'equip', id: first, item: wearing },
    { step: 'sell', id: 'kit-stall', item: 'kit-rock' },
    { step: 'give', item: 'husk-carapace', count: 2 },
    { step: 'shop', id: 'kit-pawn', items: ['husk-carapace', 'kit-rock'] },
    { step: 'sell', id: 'kit-pawn', item: 'husk-carapace' },
    { step: 'use', id: first, ability: 'kit-token', targets: [] },
    { step: 'fell', id: second },
    { step: 'rest', kind: 'short', plan: { moves: { [first]: [{ kind: 'tendWounds', target: second }] } } },
    { step: 'statBlock', id: 'hollow-knight' },
    ...Array.from({ length: 40 }, () => ({ step: 'rest', kind: 'short', plan: { moves: { [first]: [{ kind: 'prepare' }, { kind: 'clearStress' }] } } })),
    { step: 'save' },
    { step: 'travel', id: 'the-pit' },
    { step: 'give', item: 'gold', count: 9 },
    { step: 'save' },
    { step: 'travel', id: 'the-husk-vault' },
    { step: 'travel', id: 'the-husk-vault' },
    { step: 'travel', id: 'nowhere' },
    { step: 'load', text: 'not a save {' },
    ...(['garbage', 'newer', 'other', 'missing', 'unknown', 'sheet', 'old', 'object', 'joiner', 'own'] as const).map((variant) => ({ step: 'load', variant })),
    { step: 'travel', id: 'the-pit' },
    { step: 'save' },
    { step: 'travel', id: 'the-husk-vault' },
    { step: 'load', variant: 'own' },
    { step: 'fight', id: 'group-1' },
    { step: 'save' },
    { step: 'equip', id: first, item: 'armor-gambeson-armor' },
    { step: 'give', item: 'armor-gambeson-armor', count: 1 },
    { step: 'equip', id: first, item: 'armor-gambeson-armor' },
    { step: 'unequip', id: first, slot: 'armor' },
    { step: 'rest', kind: 'long', plan: { moves: {} } },
    { step: 'grant', level: 3 },
    { step: 'levelUp', id: first, plan: hitAndRun },
    { step: 'levelUp', id: second, plan: { advancements: [{ kind: 'stress' }, { kind: 'evasion' }], domainCard: card, experience: { name: 'Old roads', modifier: 2 } } },
    { step: 'give', item: 'kit-salve', count: 2 },
    { step: 'useItem', item: 'kit-salve' },
    { step: 'useItem', item: 'kit-salve' },
    // A load in the middle of a fight ends it: the room is entered as the save left it.
    { step: 'load', variant: 'own' },
  ];
}

/**
 * The default project with shops and gear to try: a stall with a limited line and its scroll, a fence that buys
 * nothing and is paid in carapace, a stall with nothing; a scroll that asks a roll, a salve that braces until a
 * rest (and lends a card, and an Evasion), a relic with nothing to do, a weapon with no gear and one pointing at
 * gear nobody has, a pawnbroker paid in carapace, which has a worth of its own; each character
 * holding more cards than a loadout takes; a card of abilities that a rest, a long rest and a scene refresh, a
 * token a rest refills, a condition a rest ends, and a card a condition lends; and cards a stat block prints.
 */
function workshop(base: ProjectDoc): ProjectDoc {
  const project = clone(base);
  const loose = project as unknown as Record<'items' | 'cards' | 'abilities' | 'conditionDefs', unknown[]>;
  loose.items.push(
    { id: 'kit-scroll', name: 'Scroll of Daring', kind: 'trinket', description: 'Read it aloud, if you dare.', value: 6, tier: 2, use: [{ kind: 'check', check: { trait: 'presence', difficulty: 12, onSuccess: [{ kind: 'gainGood', amount: 1, target: { kind: 'actor' } }], onFailure: [{ kind: 'markStress', amount: 1, target: { kind: 'actor' } }] } }] },
    { id: 'kit-salve', name: 'Bracing Salve', kind: 'consumable', description: 'It stings.', value: 3, use: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }, { kind: 'applyCondition', condition: 'kit-braced', duration: 'rest', target: { kind: 'actor' } }] },
    { id: 'kit-relic', name: 'Odd Relic', kind: 'trinket', description: 'Nobody knows.', value: 0 },
    { id: 'kit-rock', name: 'A Rock', kind: 'weapon', description: 'Heavy enough.', value: 1 },
    { id: 'kit-broken-blade', name: 'Broken Blade', kind: 'weapon', contentId: 'no-such-weapon', value: 2 },
  );
  loose.conditionDefs.push({ id: 'kit-braced', name: 'Braced', text: '', modifiers: [{ stat: 'evasion', bonus: 1 }], blocks: [] });
  const members = project.party.map((s) => s.id);
  loose.cards.push(
    { id: 'kit-pack', name: 'Pack', text: '', features: [{ name: 'Kit', text: 'A few tricks.' }, { name: '', text: 'And a spare.' }], grant: { kind: 'given', characters: members } },
    { id: 'kit-lent', name: 'Steadied Hand', text: 'Borrowed while braced.', grant: { kind: 'condition', conditions: ['kit-braced'] } },
    { id: 'kit-roar', name: 'Roar', text: '', grant: { kind: 'adversary', adversaries: ['hollow-knight'] } },
    { id: 'kit-hide', name: 'Hide', text: 'It hides.', grant: { kind: 'adversary', adversaries: ['hollow-knight', 'merchant'] } },
  );
  const on = (id: string, rest: Record<string, unknown>) => ({ id, name: id.replace(/-/g, ' '), source: { card: 'kit-pack' }, text: '', kind: 'action', ...rest });
  loose.abilities.push(
    on('kit-rested', { uses: { count: 1, per: 'rest' }, effects: [{ kind: 'log', text: 'Rested.', tone: 'system' }] }),
    on('kit-longrested', { uses: { count: 1, per: 'longRest' }, effects: [{ kind: 'log', text: 'Long rested.', tone: 'system' }] }),
    on('kit-scened', { uses: { count: 2, per: 'scene' }, effects: [{ kind: 'log', text: 'Once a scene.', tone: 'system' }] }),
    on('kit-token', { tokens: { amount: 2, refill: 'rest' }, available: { kind: 'tokens', ability: 'kit-token', op: '>=', value: 1 }, effects: [{ kind: 'spendToken', ability: 'kit-token', amount: 1 }] }),
    on('kit-brace', { effects: [{ kind: 'applyCondition', condition: 'kit-braced', duration: 'rest', target: { kind: 'actor' } }] }),
    { id: 'kit-roared', name: 'roar', source: { card: 'kit-roar' }, text: 'It roars, and the room shakes.', kind: 'passive', effects: [] },
  );
  // More cards than a loadout takes, and some chosen already.
  // The project's own, then a few more its content has - cards a saved sheet can name and still load.
  const own = ['grapeshot', 'powder-and-shot', 'footnote', 'mark-the-page', 'another-round', 'barrel-through'];
  const more = [...characterContentFor(project).cards.values()].filter((c) => c.grant.kind === 'chosen' && !own.includes(c.id)).slice(0, 2).map((c) => c.id);
  const chosen = [...own, ...more];
  project.party.forEach((sheet, at) => {
    const own = sheet as unknown as Record<string, unknown>;
    own['domainCards'] = chosen.slice(at % 2, at % 2 + 6 + (at % 3));
    if (at % 2 === 0) delete own['loadout'];
    else own['loadout'] = chosen.slice(at % 2, at % 2 + 3);
  });
  const vault = project.scenes[0]!;
  const crate = (id: string, x: number, y: number, shop: unknown) => ({ model: 'crate-prop', position: { x, y }, rotation: 0, id, function: { kind: 'shop', ...(shop === undefined ? {} : { shop }) } });
  vault.decos.push(
    crate('kit-stall', 4, 9, { currency: 'gold', stock: [{ item: 'consumable-minor-health-potion', price: 4 }, { item: 'kit-scroll', price: 7, count: 2 }, { item: 'kit-salve', price: 2 }, { item: poolOf(project).find((i) => i.startsWith('primary-') || i.startsWith('secondary-')) ?? 'gold', price: 15, count: 1 }] }) as never,
    crate('kit-fence', 5, 9, { currency: 'husk-carapace', buysAt: 0, stock: [{ item: 'kit-salve', price: 1 }] }) as never,
    crate('kit-empty', 6, 9, undefined) as never,
    crate('kit-pawn', 7, 9, { currency: 'husk-carapace', stock: [] }) as never,
  );
  return projectSchema.parse(project);
}

function golden() {
  const g = createRng('kit');
  const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
  const shop = workshop(fallback);
  const projects: [string, ProjectDoc][] = [['default', fallback], ['the workshop', shop]];
  const sessions: ReturnType<typeof session>[] = [];
  for (let s = 0; s < 3; s++) sessions.push(session(g, `default ${s}`, 0, fallback, 50));
  for (let s = 0; s < 8; s++) sessions.push(session(g, `the workshop ${s}`, 1, shop, 70));
  const toured = buildProjectScene(projectSchema.parse(clone(shop)), 'kit:tour');
  sessions.push(session(g, 'the workshop, toured', 1, shop, 20, tourOf(toured)));
  return {
    about: 'what the party carries and how it is kitted out, for the Rust port; written by src/game/kit.golden.test.ts',
    shipped: {
      characters: contentJson(DEMO_CHARACTERS),
      adversaries: [...DEMO_ADVERSARIES.values()],
      abilities: STARTER_ABILITIES,
      conditions: [...STARTER_CONDITIONS, ...SRD_CONDITIONS],
      items: EQUIPMENT.items,
    },
    projects: projects.map(([, project]) => clone(project)),
    sessions,
  };
}

describe('what the party carries, for the Rust port', () => {
  it('matches server/fixtures/kit.json', () => {
    const written = golden();
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(written)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(clone(written));
  }, 300_000);
});
