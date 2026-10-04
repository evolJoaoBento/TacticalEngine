/**
 * Using what a character can do: domain cards, Light features, subclass cards.
 *
 * An ability is a script with a price and a target. This module is the verb:
 * it checks the price can be paid and the target is fair, pays, runs the
 * script through the same runner a chest's check uses, and — in a fight —
 * spends the character's action once the script has finished asking things,
 * because whether the spotlight passes is only known after the roll.
 *
 * Also here: the loadout and the vault (five cards active, swapping costs
 * Stress outside a rest), and rests themselves, with the SRD's downtime moves.
 */

import {
  abilitiesFor,
  isScripted,
  loadoutOf,
  vaultOf,
  LOADOUT_LIMIT,
  type AbilityDef,
  cardOf,
  grantRank,
} from '../engine/content/abilities';
import { canMarkStress } from '../engine/rules/resources';
import { reaches, type RangeBand } from '../engine/rules/range';
import { isDomainCard, type CardDef, type CardGrant, type ContentPack } from '../engine/content/pack/import';
import { deriveCharacter, grantedCards, lentCards, type DerivedCharacter } from '../engine/character/sheet';
import { traitSchema, type Trait } from '../engine/scene/primitives';
import { evaluateOptional } from '../engine/script/conditions';
import { useKey } from '../engine/script/world';
import { NO_TILE } from '../engine/grid/grid';
import { walkEffects, type TargetSelector } from '../engine/script/schema';
import { worthAiming, type DemoScene } from './demo-scene';
import { inCombat } from './moment';
import { characterContentFor } from './room';

/** An ability as the action bar shows it: what it is, and why it is greyed out. */
export interface AbilityView {
  ability: AbilityDef;
  /** The rules text: the ability's own, or the card's / feature's from the SRD. */
  text: string;
  /** Whether the engine can run it, or it is text for the table. */
  scripted: boolean;
  usable: boolean;
  /** Why not, when not. */
  reason: string | null;
  /** Uses left before the next refresh, or null when unlimited. */
  usesLeft: number | null;
  /** Valid targets right now, when it wants one. */
  targets: string[];
  /**
   * The card it sits on, with the domain its art is drawn in: a chosen card's own, and `granted` for
   * a card in play because of what its holder is. Null for a card nothing defines.
   */
  card: { id: string; domain: string } | null;
}

/**
 * The words for an ability: its own, or else its card's.
 *
 * Found through the card the ability sits on, by id. What a class or a subclass printed used to be
 * found by matching the ability's name against the printed feature's, and renaming either quietly
 * lost the text; a card is where the words live now, so there is nothing to match.
 */
export function abilityText(demo: DemoScene, ability: AbilityDef): string {
  if (ability.text !== '') return ability.text;
  // The project's content, which is the pack's unless the project carries its own.
  const card = characterContentFor(demo.project).cards.get(cardOf(ability));
  if (card === undefined) return '';
  // A grimoire's spell is one of the card's named features.
  const spell = card.name === ability.name ? undefined : card.features.find((f) => f.name === ability.name);
  return spell?.text ?? card.text;
}

/**
 * The card an ability sits on, for its art: a chosen card in its domain's colour, and any other in the
 * colour the loadout's Always in play gives a card nobody chose. Null for a card nothing defines.
 */
function cardArtOf(demo: DemoScene, ability: AbilityDef): { id: string; domain: string } | null {
  const card = characterContentFor(demo.project).cards.get(cardOf(ability));
  if (card === undefined) return null;
  return { id: card.id, domain: isDomainCard(card) ? card.domain : 'granted' };
}

/** Every ability a character has, in sheet order. */
export function abilitiesOf(demo: DemoScene, characterId: string): AbilityDef[] {
  const character = demo.characters.get(characterId);
  if (character === undefined) return [];
  // The cards in play as the project stands now, which is how the world reads them too, and
  // whatever a condition on them lends while it lasts.
  const cards = characterContentFor(demo.project).cards;
  const bearing = demo.state.entity(characterId)?.conditions ?? [];
  const granted = [...grantedCards(character.sheet, cards.values()), ...lentCards(bearing, cards.values())];
  return abilitiesFor({ ...character, granted }, demo.project.abilities);
}

/** Uses left of a limited ability, or null when it is not limited. */
export function usesLeft(demo: DemoScene, characterId: string, ability: AbilityDef): number | null {
  if (ability.uses === undefined) return null;
  return Math.max(0, ability.uses.count - (demo.scenario.abilityUses.get(useKey(characterId, ability.id)) ?? 0));
}

/**
 * Who a script with no pick of its own will roll against: the first check's
 * own selector — "all adversaries within Very Close range" — read from where
 * the actor stands. Empty when nobody is there, which refuses the use rather
 * than rolling at the air.
 */
export function scriptTargets(demo: DemoScene, characterId: string, ability: AbilityDef): string[] | null {
  const first = ability.effects.find((e) => e.kind === 'check');
  if (first?.kind !== 'check' || first.check.targets === undefined) return null;
  const actor = demo.scenario.actorId;
  demo.scenario.actorId = characterId;
  const ids = demo.world.resolveTargets(first.check.targets, { targets: [], hit: [] });
  demo.scenario.actorId = actor;
  return ids;
}

/** The creatures an ability may be aimed at from where the actor stands. */
export function abilityTargets(demo: DemoScene, characterId: string, ability: AbilityDef): string[] {
  const kind = ability.target.kind;
  if (kind === 'none') return scriptTargets(demo, characterId, ability) ?? [];
  if (kind === 'self') return [characterId];
  // A card aimed at the ground names no creature to pick: `pointTiles` is the
  // list, and what it catches is not known until one is chosen.
  if (kind === 'point') return [];
  const within = (id: string, range: RangeBand): boolean => {
    const band = demo.world.bandTo(characterId, id);
    return band !== null && reaches(band, range);
  };
  // A card that brings somebody back has to be able to point at them; every
  // other card names only what is standing.
  const living = demo.state
    .allEntities()
    .filter((e) => e.alive || (ability.target.fallen === true && e.faction === 'party'));
  return living
    .filter((e) => {
      if (kind === 'adversary' || kind === 'group') return e.faction === 'adversary';
      if (kind === 'ally') return e.faction === 'party';
      return true;
    })
    .filter((e) => within(e.id, ability.target.range))
    .filter((e) => worthAiming(demo, characterId, ability, e.id))
    .map((e) => e.id);
}

/**
 * The tiles a card aimed at the ground may be aimed at.
 *
 * Everything within the band the card names, whether or not anybody is
 * standing there and whether or not the ground can be walked on: "a point
 * within Far range" is a place in the room, and a spell dropped on a wall is
 * the fiction's problem rather than the rules'. A run that ends somewhere the
 * mover cannot reach still passes what it passes.
 */
export function pointTiles(demo: DemoScene, characterId: string, ability: AbilityDef): number[] {
  if (ability.target.kind !== 'point') return [];
  const here = demo.state.entity(characterId)?.tile ?? NO_TILE;
  if (here === NO_TILE) return [];
  const tiles: number[] = [];
  for (let tile = 0; tile < demo.grid.size; tile++) {
    if (tile === here) continue;
    const band = demo.world.bandBetween(here, tile);
    if (band !== null && reaches(band, ability.target.range)) tiles.push(tile);
  }
  return tiles;
}

/**
 * Who a card aimed at this tile would catch, without aiming it.
 *
 * The shapes are read against a world nothing has changed, which is what lets
 * the board draw a preview under the pointer: every selector a card's effects
 * name is resolved with the tile bound as the point, and the creatures they
 * come back with are the ones about to be in it.
 */
export function shapeAt(demo: DemoScene, characterId: string, ability: AbilityDef, tile: number): string[] {
  if (ability.target.kind !== 'point' || tile === NO_TILE) return [];
  const was = demo.scenario.actorId;
  demo.scenario.actorId = characterId;
  const caught = new Set<string>();
  walkEffects(ability.effects, (effect) => {
    // Every way an effect names who it is for: the plain `target`, the roll's
    // `targets`, and a check's. A shape can be written in any of the three,
    // and the preview has to find it wherever the card put it.
    const named: unknown[] = [
      'target' in effect ? effect.target : undefined,
      'targets' in effect ? effect.targets : undefined,
      effect.kind === 'check' ? effect.check.targets : undefined,
    ];
    for (const selector of named) {
      if (selector === undefined || typeof selector !== 'object' || selector === null) continue;
      const shape = selector as TargetSelector;
      if (shape.kind !== 'inPath' && !('around' in shape && shape.around === 'point')) continue;
      for (const id of demo.world.resolveTargets(shape, { targets: [], hit: [], point: tile })) caught.add(id);
    }
  });
  demo.scenario.actorId = was;
  return [...caught];
}

/** Whether an ability can be used now, and if not, why. */
export function canUseAbility(
  demo: DemoScene,
  characterId: string,
  ability: AbilityDef,
  targets: readonly string[] = [],
): { ok: true } | { ok: false; reason: string } {
  const entity = demo.state.entity(characterId);
  const character = demo.characters.get(characterId);
  if (entity === undefined || character === undefined || !entity.alive) return { ok: false, reason: 'not standing' };
  if (demo.pending !== null) return { ok: false, reason: 'something is waiting for an answer' };
  if (ability.kind !== 'action') return { ok: false, reason: ability.kind === 'passive' ? 'always on' : 'a reaction' };
  if (!isScripted(ability)) return { ok: false, reason: 'the table adjudicates this one' };
  const fighting = inCombat(demo);
  if (ability.inCombatOnly && !fighting) return { ok: false, reason: 'only in a fight' };
  if (fighting && demo.encounter!.view().side !== 'party') return { ok: false, reason: "the GM's turn" };
  if (fighting && ability.action && !demo.encounter!.canAct(characterId)) return { ok: false, reason: 'already acted' };
  const cost = ability.cost;
  if ((cost.bad ?? 0) > 0) return { ok: false, reason: 'only the GM spends Shadow' };
  if ((cost.good ?? 0) > 0 && (entity.good?.value ?? 0) < cost.good!) return { ok: false, reason: `needs ${cost.good} Light` };
  if ((cost.stress ?? 0) > 0 && !canMarkStress(entity.stress, cost.stress)) return { ok: false, reason: 'no Stress slot to mark' };
  const left = usesLeft(demo, characterId, ability);
  if (left !== null && left <= 0) return { ok: false, reason: `used until the next ${ability.uses!.per === 'longRest' ? 'long rest' : ability.uses!.per === 'scene' ? 'fight' : 'rest'}` };
  demo.scenario.actorId = characterId;
  if (!evaluateOptional(ability.available, demo.world, { targets, hit: [] })) return { ok: false, reason: 'not now' };
  if (ability.target.kind === 'point') {
    if (pointTiles(demo, characterId, ability).length === 0) return { ok: false, reason: 'nowhere to aim it' };
  } else if (ability.target.kind !== 'none') {
    const valid = abilityTargets(demo, characterId, ability);
    if (valid.length === 0) return { ok: false, reason: 'nothing in range' };
    if (targets.length > 0 && !targets.every((id) => valid.includes(id))) return { ok: false, reason: 'that target is out of range' };
  } else if (scriptTargets(demo, characterId, ability)?.length === 0) {
    return { ok: false, reason: 'nothing in range' };
  }
  return { ok: true };
}

/** Everything a character can do, for an action bar. */
export function abilityList(demo: DemoScene, characterId: string): AbilityView[] {
  return abilitiesOf(demo, characterId).map((ability) => {
    const can = canUseAbility(demo, characterId, ability);
    return {
      ability,
      text: abilityText(demo, ability),
      scripted: isScripted(ability),
      usable: can.ok,
      reason: can.ok ? null : can.reason,
      usesLeft: usesLeft(demo, characterId, ability),
      targets: abilityTargets(demo, characterId, ability),
      card: cardArtOf(demo, ability),
    };
  });
}

// ---------------------------------------------------------------------------
// Loadout and vault
// ---------------------------------------------------------------------------

export interface LoadoutCard {
  id: string;
  name: string;
  recallCost: number;
  domain: string;
  level: number;
  type: string;
  text: string;
}

/** A card in play because of what its holder is, as the loadout shows it: no level, no recall. */
export interface GrantedCard {
  id: string;
  name: string;
  text: string;
  /** What granted it, in words. */
  from: string;
}

export interface LoadoutView {
  loadout: LoadoutCard[];
  vault: LoadoutCard[];
  /** What they have without choosing it: face up, counted by no limit, never vaulted. */
  granted: GrantedCard[];
  limit: number;
  /** The numbers on the sheet beside the cards. Absent when there is no character to read. */
  stats?: SheetStats;
}

/**
 * What a player looks up on their sheet in the middle of a fight: what they roll with, what it
 * takes to hit them, and how hard a blow has to be to cost more than one Hit Point.
 */
export interface SheetStats {
  level: number;
  proficiency: number;
  /** As it stands now, with whatever their conditions and cards add. */
  evasion: number;
  /** `Infinity` for a threshold they do not have. */
  thresholds: { major: number; severe: number };
  /** In the order a sheet prints them, advancements folded in. */
  traits: { id: Trait; value: number; spellcast: boolean }[];
  experiences: { name: string; modifier: number }[];
}

/** What a card prints: its own text, or its named features when it has no text of its own. */
export function printedText(card: Pick<CardDef, 'text' | 'features'>): string {
  return card.text !== '' ? card.text : card.features.map((f) => (f.name ? `${f.name}\n${f.text}` : f.text)).join('\n\n');
}

/** A chosen card as a face draws it, with the loadout's numbers defaulted where a card lacks them. */
export function loadoutCardOf(card: CardDef): LoadoutCard {
  return { id: card.id, name: card.name, recallCost: card.recallCost ?? 0, domain: card.domain ?? 'Unknown',
    level: card.level ?? 1, type: card.type ?? 'ability', text: printedText(card) };
}

/** A granted card as a face draws it: what granted it, in words, in place of a domain. */
export function grantedCardOf(card: CardDef, content: ContentPack): GrantedCard {
  return { id: card.id, name: card.name, text: printedText(card), from: grantedBy(card.grant, content) };
}

export function loadoutView(demo: DemoScene, characterId: string): LoadoutView {
  const character = demo.characters.get(characterId);
  const content = characterContentFor(demo.project);
  const describe = (id: string) => {
    const card = content.cards.get(id);
    return card === undefined ? { id, name: id, recallCost: 0, domain: 'Unknown', level: 1, type: 'ability', text: '' } : loadoutCardOf(card);
  };
  if (character === undefined) return { loadout: [], vault: [], granted: [], limit: LOADOUT_LIMIT };
  // Read as the cards stand now, the way the world reads them, so a card handed over is shown at
  // once; in the order a sheet lists what they have, and the pack's order within that. What a
  // condition on them lends comes last, read off the creature, since no sheet ever holds it.
  const bearing = demo.state.entity(characterId)?.conditions ?? new Set<string>();
  const granted = [...grantedCards(character.sheet, content.cards.values()), ...lentCards(bearing, content.cards.values())]
    .sort((a, b) => grantRank(a.grant) - grantRank(b.grant))
    .map((card) => ({
      ...grantedCardOf(card, content),
      ...(card.grant.kind === 'condition' ? { from: lentBy(card.grant.conditions, bearing, demo) } : {}),
    }));
  return {
    loadout: loadoutOf(character).map(describe),
    vault: vaultOf(character).map(describe),
    granted,
    limit: LOADOUT_LIMIT,
    stats: sheetStats(demo, character),
  };
}

/**
 * Evasion and the thresholds are asked of the world rather than read off the sheet, so they are
 * the numbers an attack would actually be rolled against: a condition that raises Evasion shows.
 */
function sheetStats(demo: DemoScene, character: DerivedCharacter): SheetStats {
  const entity = demo.state.entity(character.sheet.id);
  const defence = entity === undefined ? { difficulty: character.evasion, thresholds: character.thresholds } : demo.world.defenderOf(entity);
  return {
    level: character.sheet.level,
    proficiency: character.proficiency,
    evasion: defence.difficulty,
    thresholds: { ...defence.thresholds },
    traits: traitSchema.options.map((id) => ({ id, value: character.traits[id], spellcast: character.spellcastTrait === id })),
    experiences: character.experiences.map((e) => ({ name: e.name, modifier: e.modifier })),
  };
}

/** What granted a card, in the words the table uses: "Sentinel", "Shieldbearer · foundation", "Given". */
function grantedBy(grant: CardGrant, content: ContentPack): string {
  switch (grant.kind) {
    case 'class':
      return content.classes.get(grant.classId)?.name ?? grant.classId;
    case 'subclass':
      return `${content.subclasses.get(grant.subclassId)?.name ?? grant.subclassId} · ${grant.stage}`;
    case 'ancestry':
      return content.ancestries.get(grant.ancestryId)?.name ?? grant.ancestryId;
    case 'community':
      return content.communities.get(grant.communityId)?.name ?? grant.communityId;
    case 'given':
      return 'Given';
    // Which of them lent it is the creature's to say, not the card's: `lentBy`.
    case 'condition':
      return 'Lent';
    // Neither is ever granted to a character: one is chosen, the other printed on a stat block.
    case 'chosen':
    case 'adversary':
      return '';
  }
}

/** Which condition on somebody lent them a card, in the words the table uses: "Lent by Steadied". */
function lentBy(conditions: readonly string[], bearing: ReadonlySet<string>, demo: DemoScene): string {
  const by = conditions.find((id) => bearing.has(id));
  return by === undefined ? 'Lent' : `Lent by ${demo.world.conditionName(by)}`;
}

export type SwapResult = { ok: true; stress: number } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Rests
// ---------------------------------------------------------------------------

export type RestMove =
  | { kind: 'tendWounds'; target?: string }
  | { kind: 'clearStress' }
  | { kind: 'repairArmor'; target?: string }
  | { kind: 'prepare' };

export interface RestPlan {
  /** Each character's two downtime moves. A character left out makes none. */
  moves: Record<string, readonly RestMove[]>;
  /** Loadouts to set, free, as the rest begins. */
  loadouts?: Record<string, readonly string[]>;
}

export type RestResult = { ok: true; badGained: number } | { ok: false; reason: string };

/** A card a stat block prints, as somebody looking at the creature reads it. */
export interface PrintedCard {
  id: string;
  name: string;
  text: string;
}

/**
 * The cards a stat block prints, as the table sees them when somebody looks at the creature: every
 * card granted by `adversary` to this block, scripted or not, named as the card is and worded as the
 * card is -- or, for a card the editor wrote, as the ability on it is. Read from the project as it
 * stands, so a card printed a moment ago is on the block at once.
 */
export function statBlockCards(demo: DemoScene, definition: string): PrintedCard[] {
  const cards = [...characterContentFor(demo.project).cards.values()].filter(
    (card) => card.grant.kind === 'adversary' && card.grant.adversaries.includes(definition),
  );
  return cards.map((card) => {
    const ability = demo.project.abilities.find((a) => cardOf(a) === card.id);
    return { id: card.id, name: card.name, text: card.text !== '' ? card.text : (ability?.text ?? '') };
  });
}
