/**
 * Characters as the Rust server must derive them (`docs/SERVER.md`, phase 2): this takes the content the
 * game plays with - the demo pack with the shipped SRD characters laid over it, and their abilities - and
 * sheets of every kind: the demo party, one of every class levelled by legal plans drawn off a seeded stream
 * (to ten, or until a class's domains run out of cards - the demo's three, one domain of five cards each,
 * stop at level 3 or 4), sheets that name things that are not there, and plans that break every rule. It records
 * what `src/engine/character` answers - derived numbers, attack and defender profiles, starting pools,
 * every progression query, each level taken or refused with its reasons - and what the gear's features
 * plainly say (`content/equipment/features.ts`), into `server/fixtures/character.json`, which
 * `server/engine/tests/golden_character.rs` replays. Content is written in the order the maps hold it.
 * `UPDATE_GOLDEN=1 npx vitest run src/engine/character/character.golden.test.ts` writes it afresh.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../core/rng';
import { mergePack, type ContentPack } from '../content/pack/import';
import { gearEffects } from '../content/equipment/features';
import { DEMO_CHARACTERS, PARTY_SHEETS } from '../../game/demo-rules';
import { shippedPack } from '../../game/listed-packs';
import type { Trait } from '../scene/schema';
import {
  availableAdvancements, cardAllowed, crossedOut, domainsOf, heldCards, levelUp, markedTraits, progressionBonuses, subclassStage, takenInTier, tierOf,
  type Advancement, type AdvancementKind, type LevelUpPlan, type Tier,
} from './progression';
import { attackProfile, blankSheet, defenderProfile, deriveCharacter, grantedCards, lentCards, startingPools, traitPart, wieldedTrait, type CharacterSheet } from './sheet';
import { parseSheet } from './sheet-schema';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/character.json');
const TRAITS: readonly Trait[] = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];
const KINDS: readonly AdvancementKind[] = ['traits', 'hitPoint', 'stress', 'experiences', 'domainCard', 'evasion', 'subclass', 'proficiency', 'multiclass'];

/** Cards no pack ships, for grants the shipped ones leave out: lent by either of two conditions, and handed to sheets by id. */
const PROBE_CARDS = [
  { id: 'probe-lent', name: 'Probe Lent', grant: { kind: 'condition', conditions: ['hidden', 'restrained'] }, text: '', features: [] },
  { id: 'probe-given', name: 'Probe Given', grant: { kind: 'given', characters: ['given', 'nobody'] }, text: '', features: [] },
  { id: 'probe-adversary', name: 'Probe Adversary', grant: { kind: 'adversary', adversaries: ['given'] }, text: '', features: [] },
];

function content(): ContentPack {
  const srd = shippedPack('srd-characters')!;
  const pack = mergePack(DEMO_CHARACTERS, { classes: srd.classes, subclasses: srd.subclasses, ancestries: srd.ancestries, communities: srd.communities, cards: srd.cards } as never);
  return mergePack(pack, { cards: PROBE_CARDS } as never);
}

/**
 * Abilities no pack ships, on the cards one sheet holds or is granted, listed against the order they rank in: every
 * kind of modifier a derivation folds, skips or filters, so the order and the sums are both read.
 */
function probeAbilities(pack: ContentPack, sheet: CharacterSheet): NonNullable<Parameters<typeof deriveCharacter>[2]> {
  const granted = (kind: string, test: (grant: Record<string, unknown>) => boolean): string =>
    [...pack.cards.values()].find((c) => c.grant.kind === kind && test(c.grant as never))!.id;
  const on = (id: string, card: string, modifiers: object[]) => ({ id, source: { card }, modifiers });
  return [
    on('probe-community', granted('community', (g) => g['communityId'] === sheet.communityId), [{ stat: 'evasion', bonus: 3 }]),
    on('probe-ancestry', granted('ancestry', (g) => g['ancestryId'] === sheet.ancestryId), [{ stat: 'evasion', bonus: 2 }]),
    on('probe-chosen', sheet.domainCards![0]!, [
      { stat: 'evasion', bonus: 4, requires: 'meleeWeapon' },
      { stat: 'hitPoints', bonus: 1, when: { kind: 'inCombat' } },
      { stat: 'stress', bonus: 1, perToken: 'probe' },
      { stat: 'armorScore', bonus: 1, requires: 'unarmored' },
      { stat: 'armorScore', bonus: 2, requires: 'armored' },
      { stat: 'thresholds', bonus: 1, plusTrait: 'agility', halveTrait: true, plusProficiency: true },
      { stat: 'proficiency', bonus: 1 },
    ]),
    on('probe-subclass', granted('subclass', (g) => g['subclassId'] === sheet.subclassId && g['stage'] === 'foundation'), [{ stat: 'majorThreshold', bonus: 1 }]),
    on('probe-class', granted('class', (g) => g['classId'] === sheet.classId), [{ stat: 'evasion', bonus: 1 }]),
    on('probe-given', 'probe-given', [{ stat: 'severeThreshold', bonus: 5 }]),
    on('probe-lent', 'probe-lent', [{ stat: 'evasion', bonus: 9 }]),
  ] as never;
}

/** The content as the Rust reads it: each list in the order its map holds it, cut to what the character reads. */
function contentJson(pack: ContentPack) {
  return {
    weapons: [...pack.weapons.values()].map(({ id, name, tier, slot, trait, range, damage, burden, features }) => ({ id, name, tier, slot, trait, range, damage, burden, features })),
    armors: [...pack.armors.values()].map(({ id, name, tier, baseThresholds, baseScore, features }) => ({ id, name, tier, baseThresholds, baseScore, features })),
    classes: [...pack.classes.values()].map(({ id, name, domains, startingEvasion, startingHitPoints }) => ({ id, name, domains, startingEvasion, startingHitPoints })),
    ancestries: [...pack.ancestries.values()].map(({ id, name }) => ({ id, name })),
    communities: [...pack.communities.values()].map(({ id, name }) => ({ id, name })),
    subclasses: [...pack.subclasses.values()].map(({ id, name, classId, domains, spellcastTrait }) => ({ id, name, classId, domains, ...(spellcastTrait === undefined ? {} : { spellcastTrait }) })),
    cards: [...pack.cards.values()].map(({ id, name, grant, domain, type, level, recallCost }) => ({ id, name, grant, ...(domain === undefined ? {} : { domain }), ...(type === undefined ? {} : { type }), ...(level === undefined ? {} : { level }), ...(recallCost === undefined ? {} : { recallCost }) })),
  };
}

// --- Sheets ---------------------------------------------------------------------------------------------

function baseSheets(pack: ContentPack, rng: Rng): CharacterSheet[] {
  const classes = [...pack.classes.values()];
  const ancestries = [...pack.ancestries.keys()];
  const communities = [...pack.communities.keys()];
  const weapons = [...pack.weapons.values()];
  const armors = [...pack.armors.keys()];
  const spreads = [[2, 1, 1, 0, 0, -1], [0, -1, 2, 1, 1, 0], [1, 0, 0, 2, -1, 1], [-1, 2, 0, 1, 0, 1]];
  return classes.map((klass, i) => {
    const subclass = [...pack.subclasses.values()].find((s) => s.classId === klass.id);
    const cards = [...pack.cards.values()].filter((c) => c.grant.kind === 'chosen' && c.level === 1 && klass.domains.includes(c.domain ?? '')).map((c) => c.id);
    const spread = spreads[i % spreads.length]!;
    const traits = Object.fromEntries(TRAITS.map((t, j) => [t, spread[j]!])) as Record<Trait, number>;
    const weapon = weapons[rng.nextInt(weapons.length)]!;
    const secondary = weapons.filter((w) => w.slot === 'secondary');
    return blankSheet(`pc-${klass.id}`, klass.id, {
      name: klass.name,
      traits,
      ancestryId: ancestries[i % ancestries.length]!,
      communityId: communities[i % communities.length]!,
      ...(subclass === undefined ? {} : { subclassId: subclass.id }),
      domainCards: cards.slice(0, 2),
      primaryWeaponId: weapon.id,
      ...(i % 2 === 0 && secondary.length > 0 ? { secondaryWeaponId: secondary[rng.nextInt(secondary.length)]!.id } : {}),
      ...(i % 3 === 2 ? {} : { armorId: armors[rng.nextInt(armors.length)]! }),
      experiences: [{ name: 'First', modifier: 2 }, { name: 'Second', modifier: 2 }],
    });
  });
}

/** A legal plan for a sheet's next level, drawn off the stream; or nothing when none could be made. */
function legalPlan(sheet: CharacterSheet, pack: ContentPack, rng: Rng): LevelUpPlan | null {
  const next = sheet.level + 1;
  const tier = tierOf(next);
  const offered = availableAdvancements(sheet, next);
  const legalCard = (atLevel: number, not: readonly string[]): string | null => {
    const cards = [...pack.cards.keys()].filter((id) => !not.includes(id) && cardAllowed(sheet, pack, id, atLevel).ok);
    return cards.length === 0 ? null : cards[rng.nextInt(cards.length)]!;
  };
  const make = (option: (typeof offered)[number], used: Advancement[]): Advancement | null => {
    const box = option.tier === tier ? {} : { fromTier: option.tier };
    switch (option.kind) {
      case 'traits': {
        const free = TRAITS.filter((t) => !markedTraits(sheet).has(t) && !used.some((u) => u.kind === 'traits' && u.traits.includes(t)));
        if (free.length < 2) return null;
        const a = free[rng.nextInt(free.length)]!;
        const rest = free.filter((t) => t !== a);
        return { kind: 'traits', traits: [a, rest[rng.nextInt(rest.length)]!], ...box };
      }
      case 'experiences':
        return { kind: 'experiences', names: ['First', 'Second'], ...box };
      case 'domainCard': {
        const card = legalCard(Math.min(next, option.cardCap ?? next), used.flatMap((u) => (u.kind === 'domainCard' ? [u.card] : [])));
        return card === null ? null : { kind: 'domainCard', card, ...box };
      }
      case 'subclass':
        return sheet.subclassId === undefined ? null : { kind: 'subclass', ...box };
      case 'multiclass': {
        const other = [...pack.classes.values()].filter((c) => c.id !== sheet.classId);
        if (other.length === 0) return null;
        const klass = other[rng.nextInt(other.length)]!;
        return { kind: 'multiclass', classId: klass.id, domain: klass.domains[rng.nextInt(klass.domains.length)]!, ...box };
      }
      default:
        return { kind: option.kind, ...box } as Advancement;
    }
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = offered[rng.nextInt(offered.length)];
    if (first === undefined) return null;
    const advancements: Advancement[] = [];
    const a = make(first, advancements);
    if (a === null) continue;
    advancements.push(a);
    if (first.cost === 1) {
      const seconds = offered.filter((o) => o.cost === 1 && !(o.kind === first.kind && o.tier === first.tier && o.limit < 2) && !(o.kind === 'subclass' && first.kind === 'subclass'));
      const second = seconds[rng.nextInt(Math.max(1, seconds.length))];
      if (second === undefined) continue;
      const b = make(second, advancements);
      if (b === null) continue;
      advancements.push(b);
    }
    const domainCard = legalCard(next, advancements.flatMap((u) => (u.kind === 'domainCard' ? [u.card] : [])));
    if (domainCard === null) return null;
    const plan: LevelUpPlan = { advancements, domainCard, ...([2, 5, 8].includes(next) ? { experience: { name: `Grown at ${next}`, modifier: 2 } } : {}) };
    if (levelUp(sheet, pack, plan).issues.length === 0) return plan;
  }
  return null;
}

function brokenPlans(sheet: CharacterSheet, pack: ContentPack): LevelUpPlan[] {
  const next = sheet.level + 1;
  const card = [...pack.cards.keys()].find((id) => cardAllowed(sheet, pack, id, next).ok) ?? 'nothing';
  const high = [...pack.cards.values()].find((c) => c.grant.kind === 'chosen' && (c.level ?? 0) > next && domainsOf(sheet, pack).includes(c.domain ?? ''))?.id ?? 'nothing';
  const granted = [...pack.cards.values()].find((c) => c.grant.kind !== 'chosen')?.id ?? 'nothing';
  const outside = [...pack.cards.values()].find((c) => c.grant.kind === 'chosen' && !domainsOf(sheet, pack).includes(c.domain ?? ''))?.id ?? 'nothing';
  const exp = [2, 5, 8].includes(next) ? { experience: { name: 'X', modifier: 1 } } : {};
  // A card box on the previous tier's sheet keeps that sheet's cap: level 4 on tier 2's, 7 on tier 3's.
  const previous: Tier | null = tierOf(next) === 3 ? 2 : tierOf(next) === 4 ? 3 : null;
  const capped = previous === null ? undefined : [...pack.cards.values()].find((c) => c.id !== card && cardAllowed(sheet, pack, c.id, next).ok && (c.level ?? 0) > (previous === 2 ? 4 : 7));
  const plans: LevelUpPlan[] = [
    { advancements: [{ kind: 'hitPoint' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }, { kind: 'evasion' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'traits', traits: ['agility', 'agility'] }, { kind: 'hitPoint' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'experiences', names: ['First', 'Nobody'] }, { kind: 'hitPoint' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'experiences', names: ['First', 'First'] }, { kind: 'stress' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'domainCard', card: high }, { kind: 'hitPoint' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'domainCard', card }, { kind: 'hitPoint' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }], domainCard: granted, ...exp },
    { advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }], domainCard: outside, ...exp },
    { advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }], domainCard: 'no-such-card', ...exp },
    { advancements: [{ kind: 'proficiency' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'multiclass', classId: sheet.classId, domain: 'arcana' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'multiclass', classId: 'no-such-class', domain: 'arcana' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'subclass' }, { kind: 'multiclass', classId: 'wizard', domain: 'codex' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'hitPoint', fromTier: 1 }, { kind: 'stress' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'hitPoint', fromTier: 4 }, { kind: 'stress' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }], domainCard: card },
    { advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }], domainCard: card, experience: { name: 'Unasked', modifier: 2 } },
    { advancements: [{ kind: 'evasion' }, { kind: 'evasion' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'subclass' }, { kind: 'hitPoint' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'subclass' }, { kind: 'subclass', fromTier: 3 }], domainCard: card, ...exp },
    { advancements: [{ kind: 'multiclass', classId: 'wizard', domain: 'blade' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'multiclass', classId: 'wizard', domain: 'codex' }], domainCard: card, ...exp },
    { advancements: [{ kind: 'proficiency' }], domainCard: card, ...exp },
    ...(capped === undefined || previous === null ? [] : [{ advancements: [{ kind: 'domainCard' as const, card: capped.id, fromTier: previous }, { kind: 'hitPoint' as const }], domainCard: card, ...exp }]),
  ];
  return plans;
}

function edgeSheets(pack: ContentPack, base: CharacterSheet): CharacterSheet[] {
  const granted = [...pack.cards.values()].find((c) => c.grant.kind === 'class')?.id ?? 'nothing';
  const otherSubclass = [...pack.subclasses.values()].find((s) => s.classId !== base.classId)?.id ?? 'nothing';
  const bareBones = pack.cards.has('bare-bones') ? ['bare-bones'] : [];
  return [
    blankSheet('nobody', 'no-such-class'),
    { ...base, id: 'lost', ancestryId: 'no-ancestry', communityId: 'no-community', armorId: 'no-armor', primaryWeaponId: 'no-weapon', secondaryWeaponId: 'no-weapon-either', subclassId: 'no-subclass', domainCards: ['no-card', granted] },
    { ...base, id: 'borrowed-subclass', subclassId: otherSubclass },
    { ...base, id: 'scarred', scars: 3 },
    { ...base, id: 'scarred-out', scars: 7 },
    { ...base, id: 'bonused', bonuses: { evasion: 2, hitPoints: 9, stress: 9, armorScore: 20, majorThreshold: 1, severeThreshold: -3 } },
    { ...base, id: 'loadout', loadout: [...(base.domainCards ?? [])].reverse().concat(['not-held']) },
    { ...base, id: 'bare', armorId: undefined as never, domainCards: [...bareBones, ...(base.domainCards ?? []).slice(0, 1)] },
    { ...base, id: 'bare-armored', domainCards: [...bareBones, ...(base.domainCards ?? []).slice(0, 1)] },
    { ...base, id: 'given', model: 'quim' },
    {
      ...base, id: 'crossed', level: 9, levels: [
        { level: 5, advancements: [{ kind: 'subclass' }, { kind: 'hitPoint' }], domainCard: 'x' },
        { level: 8, advancements: [{ kind: 'multiclass', classId: 'wizard', domain: 'codex' }], domainCard: 'y' },
      ],
    },
  ].map((sheet) => JSON.parse(JSON.stringify(sheet)) as CharacterSheet);
}

// --- What the module answers --------------------------------------------------------------------------

function derived(sheet: CharacterSheet, pack: ContentPack, abilities: Parameters<typeof deriveCharacter>[2]) {
  const { character, issues } = deriveCharacter(sheet, pack, abilities);
  const conditionSets = [[], ['hidden'], ['restrained', 'vulnerable'], [...new Set([...pack.cards.values()].flatMap((c) => (c.grant.kind === 'condition' ? c.grant.conditions : [])))]];
  return {
    issues,
    character: {
      ...(character.subclass === undefined ? {} : { subclass: character.subclass.id }),
      ...(character.spellcastTrait === undefined ? {} : { spellcastTrait: character.spellcastTrait }),
      cards: character.cards.map((c) => c.id),
      granted: character.granted.map((c) => c.id),
      modifiers: character.modifiers,
      proficiency: character.proficiency,
      traits: character.traits,
      experiences: character.experiences,
      evasion: character.evasion,
      thresholds: character.thresholds,
      armorScore: character.armorScore,
      hitPoints: character.hitPoints,
      stress: character.stress,
      good: character.good,
      ...(character.primaryWeapon === undefined ? {} : { primaryWeapon: character.primaryWeapon.id }),
      ...(character.secondaryWeapon === undefined ? {} : { secondaryWeapon: character.secondaryWeapon.id }),
    },
    attack: { primary: attackProfile(character, 'primary'), secondary: attackProfile(character, 'secondary') },
    defender: defenderProfile(character),
    pools: startingPools(character),
    grantedCards: grantedCards(sheet, pack.cards.values()).map((c) => c.id),
    lent: conditionSets.map((conditions) => [conditions, lentCards(conditions, pack.cards.values()).map((c) => c.id)]),
  };
}

function queries(sheet: CharacterSheet, pack: ContentPack) {
  const tiers: Tier[] = [1, 2, 3, 4];
  const cards = [...pack.cards.keys()];
  return {
    taken: tiers.map((t) => KINDS.map((k) => takenInTier(sheet, t, k))),
    crossed: tiers.map((t) => KINDS.map((k) => crossedOut(sheet, t, k))),
    marked: [...markedTraits(sheet)],
    stage: subclassStage(sheet),
    domains: domainsOf(sheet, pack),
    held: heldCards(sheet),
    available: sheet.level < 10 ? availableAdvancements(sheet, sheet.level + 1) : [],
    bonuses: progressionBonuses(sheet),
    allowed: cards.filter((_, i) => i % 7 === 0).flatMap((id) => [1, 4, 10].map((at) => [id, at, cardAllowed(sheet, pack, id, at)])),
  };
}

function golden() {
  const pack = content();
  const srd = shippedPack('srd-characters')!;
  const rng = createRng('the character fixture');
  const bases = [...PARTY_SHEETS.map((s) => JSON.parse(JSON.stringify(s)) as CharacterSheet), ...baseSheets(pack, rng)];
  const abilities = [...srd.abilities, ...probeAbilities(pack, bases[PARTY_SHEETS.length]!)];

  const levelled: { sheet: CharacterSheet; plan: LevelUpPlan; result: ReturnType<typeof levelUp> }[] = [];
  // Each plan tried names its sheet by index into `triedSheets`; a refused plan hands its sheet back untouched.
  const triedSheets: CharacterSheet[] = [];
  const tried: { sheet: number; plan: LevelUpPlan; issues: ReturnType<typeof levelUp>['issues']; levelled?: CharacterSheet }[] = [];
  const tryAll = (sheet: CharacterSheet): void => {
    triedSheets.push(sheet);
    for (const plan of brokenPlans(sheet, pack)) {
      const result = levelUp(sheet, pack, plan);
      if (result.issues.length > 0 && result.sheet !== sheet) throw new Error('a refused level-up changed the sheet');
      tried.push({ sheet: triedSheets.length - 1, plan, issues: result.issues, ...(result.issues.length > 0 ? {} : { levelled: result.sheet }) });
    }
  };
  const grown: CharacterSheet[] = [];
  for (const base of bases.slice(PARTY_SHEETS.length)) {
    let sheet = base;
    while (sheet.level < 10) {
      if (sheet.level !== 3 && sheet.level !== 6 && sheet.level !== 9) tryAll(sheet);
      if (sheet.level === 4) tryAll({ ...sheet, subclassId: undefined as never });
      const plan = legalPlan(sheet, pack, rng);
      if (plan === null) break;
      const result = levelUp(sheet, pack, plan);
      levelled.push({ sheet, plan, result });
      sheet = result.sheet;
      if ([2, 5, 8, 10].includes(sheet.level)) grown.push(sheet);
    }
  }
  for (const sheet of grown.filter((g) => g.level === 10)) tryAll({ ...sheet, level: 9 });
  tryAll(grown[grown.length - 1]!);

  const edges = edgeSheets(pack, bases[PARTY_SHEETS.length]!);
  for (const sheet of edges) tryAll(sheet);
  const sheets = [...bases, ...grown, ...edges];
  const featureTexts = [
    ...new Set([...pack.weapons.values(), ...pack.armors.values()].flatMap((item) => item.features.map((f) => f.text))),
    '+1 to Attack Rolls; −1 to Evasion. +2 to Armor Score', '-1 to all character traits and Evasion', '+3 to agility', '+1 to damage thresholds.', '+2 to Spellcast Rolls.And more',
    '+1 to proficiency;+1 to severe damage threshold', '−2 to Finesse. Roll with advantage', '+ 1 to evasion', '+1 to Evasion .', '',
  ];
  const probes = [{ plusTrait: 'agility' as const }, { plusTrait: 'strength' as const, halveTrait: true }, { plusTrait: 'knowledge' as const, halveTrait: true }, {}, { halveTrait: true }];
  const traitSets = [{ agility: 3, strength: -3, finesse: 0, instinct: 1, presence: 2, knowledge: -1 }, { agility: -1, strength: 5, finesse: 2, instinct: 0, presence: 0, knowledge: 0 }];
  return {
    about: 'src/engine/character played for the Rust port; written by src/engine/character/character.golden.test.ts',
    content: contentJson(pack),
    abilities: abilities.map((a) => ({ id: a.id, source: a.source, modifiers: a.modifiers })),
    sheets: sheets.map((sheet) => ({ sheet, derived: derived(sheet, pack, abilities), queries: queries(sheet, pack) })),
    levelled: levelled.map(({ sheet, plan, result }) => ({ sheet, plan, result })),
    triedSheets,
    tried,
    tiers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((level) => [level, tierOf(level)]),
    gear: featureTexts.map((text) => [text, gearEffects([{ name: 'f', text }])]),
    gearTogether: gearEffects(featureTexts.slice(0, 12).map((text) => ({ name: 'f', text }))),
    traitParts: traitSets.flatMap((traits) => probes.map((probe) => [probe, traits, traitPart(probe, traits)])),
    wielded: [[{}, { trait: 'spellcast' }], [{ spellcastTrait: 'presence' }, { trait: 'spellcast' }], [{ spellcastTrait: 'presence' }, { trait: 'finesse' }]].map(([c, w]) => [c, w, wieldedTrait(c as never, w as never)]),
    parse: [
      ...sheets.slice(0, 6).map((sheet) => sheet as unknown),
      { ...(sheets[0] as object), id: '' }, { ...(sheets[0] as object), level: 0 }, { ...(sheets[0] as object), level: 11 }, { ...(sheets[0] as object), level: 1.5 },
      { ...(sheets[0] as object), traits: { agility: 1 } }, { ...(sheets[0] as object), traits: { ...(sheets[0]!.traits), agility: 0.5 } }, { ...(sheets[0] as object), proficiency: 0 },
      { ...(sheets[0] as object), model: '' }, { ...(sheets[0] as object), scars: -1 }, { ...(sheets[0] as object), experiences: [{ name: 'x' }] },
      { ...(sheets[0] as object), levels: [{ level: 2, advancements: [{ kind: 'flight' }], domainCard: 'x' }] },
      { ...(sheets[0] as object), levels: [{ level: 2, advancements: [{ kind: 'hitPoint', fromTier: 5 }], domainCard: 'x' }] },
      { ...(sheets[0] as object), levels: [{ level: 1, advancements: [], domainCard: 'x' }] },
      { ...(sheets[0] as object), levels: [{ level: 2, advancements: [{ kind: 'traits', traits: ['agility'] }], domainCard: 'x' }] },
      { ...(sheets[0] as object), bonuses: { evasion: 1.5 } }, { ...(sheets[0] as object), classId: '' }, { ...(sheets[0] as object), unknown: 'kept?' },
      { ...(sheets[0] as object), ancestryId: null }, { ...(sheets[0] as object), experiences: null }, { ...(sheets[0] as object), name: 7 },
      { ...(sheets[0] as object), levels: [{ level: 2, advancements: [{ kind: 'traits', traits: ['agility', 'strength', 'finesse'] }], domainCard: 'x' }] },
      { ...(sheets[0] as object), levels: [{ level: 2, advancements: [{ kind: 'multiclass', classId: 'wizard' }], domainCard: 'x' }] },
      { ...(sheets[0] as object), levels: [{ level: 2, advancements: [{ kind: 'hitPoint', fromTier: 2 }, { kind: 'stress', fromTier: 3 }], domainCard: 'x', experience: { name: 'Grown', modifier: 2 } }] },
      { ...(sheets[0] as object), traits: { ...(sheets[0]!.traits), luck: 3 }, bonuses: { evasion: 1, luck: 2 } },
      { ...(sheets[0] as object), traits: [] }, { ...(sheets[0] as object), domainCards: ['a', 3] }, { ...(sheets[0] as object), scars: 0, model: 'm' },
      null, 'a sheet', [],
    ].map((value) => {
      try {
        return { value, parsed: parseSheet(value) };
      } catch {
        return { value, error: true };
      }
    }),
  };
}

describe('characters, as the Rust server must derive them', () => {
  it('are what server/fixtures/character.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
