/**
 * Character content for tests about levelling.
 *
 * The starter pack cannot serve these: it ships three classes of one domain each and cards at
 * levels 1 and 2 only, while the level-up sheet runs to level 10, opens a second domain through
 * multiclassing, and has tier boxes that only a card above level 2 can test. A test about the
 * *rules* of advancement should not be blocked on what a pack happens to ship.
 *
 * So this is a pack shaped for the rules rather than for play: one class with two domains and one
 * with a third to multiclass into, a subclass carrying all three stages, and cards spread across
 * the levels the tier tables care about.
 *
 * Named for their shape, not for anything they were read off — `fixture-guard-4` is "a guard card
 * at level 4", which is the only thing any assertion needs of it.
 *
 * These live outside `src/` with the rest of the fixtures: nothing the app bundles may import
 * them, so a fixture can never become content the engine ships.
 */

import type { ContentPack } from '../../src/engine/content/pack/import';
import {
  armorDefSchema,
  classDefSchema,
  communityDefSchema,
  ancestryDefSchema,
  domainCardDefSchema,
  subclassDefSchema,
  weaponDefSchema,
} from '../../src/engine/content/pack/schema';

const index = <T extends { id: string }>(defs: readonly T[]): ReadonlyMap<string, T> =>
  new Map(defs.map((def) => [def.id, def]));

/** A card at a level, in a domain. Everything else about it is beside the point. */
const card = (id: string, name: string, domain: string, level: number, recallCost = 1) =>
  domainCardDefSchema.parse({ id, name, domain, type: 'ability', level, recallCost, text: 'A fixture card.' });

const feature = (name: string) => ({ name, text: 'A fixture feature.' });

/**
 * Two domains on one class, which is what makes "the domain a multiclass opens" a question with
 * an answer. The third lives on a class nobody starts as.
 */
const CLASSES = [
  classDefSchema.parse({
    id: 'fixture-warden',
    name: 'Warden',
    domains: ['guard', 'edge'],
    startingEvasion: 9,
    startingHitPoints: 7,
    signatureFeature: feature('Stand Fast'),
    features: [feature('Drilled')],
  }),
  classDefSchema.parse({
    id: 'fixture-adept',
    name: 'Adept',
    domains: ['codex'],
    startingEvasion: 10,
    startingHitPoints: 5,
    features: [feature('Read the Signs')],
  }),
];

/** One subclass with all three stages filled, so `subclassStage` has somewhere to climb to. */
const SUBCLASSES = [
  subclassDefSchema.parse({
    id: 'fixture-bulwark',
    name: 'Bulwark',
    classId: 'fixture-warden',
    domains: ['guard', 'edge'],
    foundation: [feature('Set Feet')],
    specialization: [feature('Unmoved')],
    mastery: [feature('Wall of One')],
  }),
  subclassDefSchema.parse({
    id: 'fixture-scribe',
    name: 'Scribe',
    classId: 'fixture-adept',
    domains: ['codex'],
    spellcastTrait: 'knowledge',
    foundation: [feature('Margin Notes')],
    specialization: [feature('Second Reading')],
    mastery: [feature('Whole Library')],
  }),
];

/**
 * Cards by level, because the tier tables are about levels.
 *
 * `guard` runs 1 to 6 so a climb always has an unheld card to take, with one at level 8 for the
 * case that must be refused for being above the level taken. `edge` and `codex` carry enough to
 * ask whether a domain is open.
 */
const CARDS = [
  card('fixture-guard-1', 'Guard One', 'guard', 1, 1),
  card('fixture-guard-2', 'Guard Two', 'guard', 2, 1),
  card('fixture-guard-3', 'Guard Three', 'guard', 3, 1),
  card('fixture-guard-4', 'Guard Four', 'guard', 4, 2),
  card('fixture-guard-5', 'Guard Five', 'guard', 5, 2),
  card('fixture-guard-6', 'Guard Six', 'guard', 6, 2),
  // Above anything a climb in these tests reaches: the card a plan must be refused for taking.
  card('fixture-guard-8', 'Guard Eight', 'guard', 8, 3),
  card('fixture-edge-1', 'Edge One', 'edge', 1, 0),
  card('fixture-edge-2', 'Edge Two', 'edge', 2, 1),
  card('fixture-edge-5', 'Edge Five', 'edge', 5, 2),
  // The domain no starting class has, for multiclassing to open.
  card('fixture-codex-1', 'Codex One', 'codex', 1, 1),
  card('fixture-codex-5', 'Codex Five', 'codex', 5, 2),
];

const ANCESTRIES = [ancestryDefSchema.parse({ id: 'fixture-kin', name: 'Kin', features: [feature('Steady')] })];
const COMMUNITIES = [communityDefSchema.parse({ id: 'fixture-folk', name: 'Folk', features: [feature('Known Here')] })];

/** Numbers that make a derived sheet legible: 5/11 thresholds at score 3, and a d8 in hand. */
const ARMORS = [
  armorDefSchema.parse({
    id: 'fixture-coat',
    name: 'Coat',
    tier: 1,
    baseThresholds: { major: 5, severe: 11 },
    baseScore: 3,
  }),
];
const WEAPONS = [
  weaponDefSchema.parse({
    id: 'fixture-blade',
    name: 'Blade',
    tier: 1,
    slot: 'primaryPhysical',
    trait: 'strength',
    range: 'melee',
    damage: { count: 1, sides: 8, modifier: 0, types: ['physical'] },
    burden: 'oneHanded',
  }),
];

/** The whole of it, in the form the rules read. */
export const FIXTURE_CONTENT: ContentPack = {
  classes: index(CLASSES),
  subclasses: index(SUBCLASSES),
  domainCards: index(CARDS),
  ancestries: index(ANCESTRIES),
  communities: index(COMMUNITIES),
  armors: index(ARMORS),
  weapons: index(WEAPONS),
};

/** The ids a test names, so a rename is one edit rather than a sweep. */
export const FIXTURE_WARDEN = 'fixture-warden';
export const FIXTURE_ADEPT = 'fixture-adept';
export const FIXTURE_BULWARK = 'fixture-bulwark';
