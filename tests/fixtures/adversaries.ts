/**
 * Stat blocks for tests to fight.
 *
 * A test about the engine should not depend on a shipped catalogue for the
 * creature it swings at. These are deliberately dull — a role, a stat line, and
 * no features at all — because a test that is about flanking, or about a locked
 * door, only needs something standing there with hit points.
 *
 * A test that *is* about a creature's feature carries that creature itself,
 * beside the behaviour it is checking, rather than adding it here: a specimen
 * belongs next to the assertion that reads it.
 *
 * These live outside `src/` on purpose. Nothing the app bundles may import
 * them — the bundler only follows what `main.ts` reaches — so a fixture can
 * never become content the engine ships.
 */

import { adversaryDefSchema, domainCardDefSchema } from '../../src/engine/content/pack/schema';

/**
 * One stat block. Flat and positional, like the pack's own: the shape is wide,
 * the values are what matter, and every one of them is visible on one line.
 */
const block = (
  id: string,
  name: string,
  role: 'standard' | 'ranged' | 'horde' | 'minion' | 'bruiser' | 'leader' | 'solo' | 'skulk' | 'social' | 'support',
  difficulty: number,
  major: number,
  severe: number,
  hitPoints: number,
  stress: number,
  attackName: string,
  attackModifier: number,
  attackRange: 'melee' | 'veryClose' | 'close' | 'far' | 'veryFar',
  damageCount: number,
  damageSides: number,
  damageModifier: number,
): ReturnType<typeof adversaryDefSchema.parse> =>
  adversaryDefSchema.parse({
    id,
    name,
    tier: 1,
    role,
    difficulty,
    thresholds: { major, severe },
    hitPoints,
    stress,
    attackName,
    // A flat modifier is an expression that rolls nothing.
    attackModifier: { count: 0, sides: 0, modifier: attackModifier },
    attackRange,
    attackDamage: { count: damageCount, sides: damageSides, modifier: damageModifier, types: ['physical'] },
    description: 'A fixture, standing where a test needs something to stand.',
    motivesAndTactics: 'Whatever the test is about.',
    features: [],
  });

/**
 * One of each role a fight can ask for, so a test picks the shape it needs
 * rather than the name it remembers. `fixture-foe` is the one to reach for when
 * the creature genuinely does not matter, which is most of the time.
 *
 * Names are bare nouns on purpose. The fight writes its own log lines out of
 * them — "Foe is gone: 2 Runts in their place", "the Foe's Swing misses" — and
 * a name carrying its own article reads badly in every one of them.
 */
export const FIXTURE_ADVERSARIES = [
  block('fixture-foe', 'Foe', 'standard', 11, 6, 12, 5, 3, 'Swing', 2, 'melee', 1, 6, 1),
  block('fixture-archer', 'Archer', 'ranged', 11, 5, 11, 4, 3, 'Loosed Arrow', 3, 'far', 1, 6, 1),
  block('fixture-swarm', 'Swarm', 'horde', 10, 5, 10, 6, 2, 'Press of Bodies', 1, 'melee', 1, 6, 0),
  block('fixture-runt', 'Runt', 'minion', 9, 4, 8, 1, 1, 'Jab', 1, 'veryClose', 1, 4, 0),
  block('fixture-brute', 'Brute', 'bruiser', 14, 12, 24, 9, 3, 'Heavy Arm', 4, 'melee', 2, 8, 2),
  block('fixture-captain', 'Captain', 'leader', 14, 10, 20, 8, 4, 'Sabre', 3, 'melee', 1, 10, 2),
  block('fixture-champion', 'Champion', 'solo', 15, 13, 26, 12, 5, 'Greatsword', 4, 'melee', 2, 10, 2),
  block('fixture-lurker', 'Lurker', 'skulk', 11, 6, 12, 4, 3, 'Grasp', 2, 'melee', 1, 6, 1),
] as const;

/** The ids above, for a test that wants to name one without repeating a literal. */
export const FIXTURE_FOE = 'fixture-foe';

/**
 * Cards for a test to hold.
 *
 * Everything a character has is a card, so these are the slots the abilities in
 * `cards.ts` sit in: a test carries the cards, puts the ones it cares about in a
 * hand, and the abilities come with them.
 *
 * They carry no rules text of their own — the ability does the work. Some cards
 * also count each other, which is why there are more than a handful and why
 * they are not all in one domain.
 */
const card = (id: string, name: string, domain = 'fixture'): ReturnType<typeof domainCardDefSchema.parse> =>
  domainCardDefSchema.parse({ id, name, domain, type: 'ability', level: 1, recallCost: 0, text: '', features: [] });

/**
 * Two domains, because some cards count each other.
 *
 * A card whose effect reads "for every card of this kind in your loadout" needs
 * both something to count and something that must *not* count, so the `other`
 * pair exists to be held without being counted.
 */
export const FIXTURE_CARDS = [
  card('fixture-card-1', 'Fixture Card I'),
  card('fixture-card-2', 'Fixture Card II'),
  card('fixture-card-3', 'Fixture Card III'),
  card('fixture-card-4', 'Fixture Card IV'),
  card('fixture-card-5', 'Fixture Card V'),
  card('fixture-card-6', 'Fixture Card VI'),
  card('fixture-card-7', 'Fixture Card VII'),
  card('fixture-card-8', 'Fixture Card VIII'),
  card('fixture-card-9', 'Fixture Card IX'),
  card('fixture-card-10', 'Fixture Card X'),
  card('fixture-card-11', 'Fixture Card XI'),
  card('fixture-card-12', 'Fixture Card XII'),
  card('fixture-card-13', 'Fixture Card XIII'),
  card('fixture-card-14', 'Fixture Card XIV'),
  card('fixture-card-15', 'Fixture Card 15'),
  card('fixture-card-16', 'Fixture Card 16'),
  card('fixture-card-17', 'Fixture Card 17'),
  card('fixture-card-18', 'Fixture Card 18'),
  card('fixture-card-19', 'Fixture Card 19'),
  card('fixture-card-20', 'Fixture Card 20'),
  card('fixture-card-21', 'Fixture Card 21'),
  card('fixture-card-22', 'Fixture Card 22'),
  card('fixture-card-23', 'Fixture Card 23'),
  card('fixture-card-24', 'Fixture Card 24'),
  card('fixture-card-25', 'Fixture Card 25'),
  card('fixture-card-26', 'Fixture Card 26'),
  card('fixture-card-27', 'Fixture Card 27'),
  card('fixture-card-28', 'Fixture Card 28'),
  card('fixture-card-29', 'Fixture Card 29'),
  card('fixture-card-30', 'Fixture Card 30'),
  card('fixture-card-31', 'Fixture Card 31'),
  card('fixture-card-32', 'Fixture Card 32'),
  card('fixture-card-33', 'Fixture Card 33'),
  card('fixture-card-34', 'Fixture Card 34'),
  card('fixture-card-35', 'Fixture Card 35'),
  card('fixture-card-36', 'Fixture Card 36'),
  card('fixture-card-37', 'Fixture Card 37'),
  card('fixture-card-38', 'Fixture Card 38'),
  card('fixture-card-39', 'Fixture Card 39'),
  card('fixture-card-40', 'Fixture Card 40'),
  card('fixture-card-41', 'Fixture Card 41'),
  card('fixture-card-42', 'Fixture Card 42'),
  card('fixture-card-43', 'Fixture Card 43'),
  card('fixture-card-44', 'Fixture Card 44'),
  card('fixture-card-45', 'Fixture Card 45'),
  card('fixture-card-46', 'Fixture Card 46'),
  card('fixture-card-47', 'Fixture Card 47'),
  card('fixture-card-48', 'Fixture Card 48'),
  card('fixture-card-49', 'Fixture Card 49'),
  card('fixture-card-50', 'Fixture Card 50'),
  card('fixture-card-51', 'Fixture Card 51'),
  card('fixture-card-52', 'Fixture Card 52'),
  card('fixture-card-53', 'Fixture Card 53'),
  card('fixture-card-54', 'Fixture Card 54'),
  card('fixture-card-55', 'Fixture Card 55'),
  card('fixture-card-56', 'Fixture Card 56'),
  card('fixture-card-57', 'Fixture Card 57'),
  card('fixture-card-58', 'Fixture Card 58'),
  card('fixture-card-59', 'Fixture Card 59'),
  card('fixture-card-60', 'Fixture Card 60'),
  card('fixture-card-61', 'Fixture Card 61'),
  card('fixture-card-62', 'Fixture Card 62'),
  card('fixture-card-63', 'Fixture Card 63'),
  card('fixture-card-64', 'Fixture Card 64'),
  card('fixture-card-65', 'Fixture Card 65'),
  card('fixture-card-66', 'Fixture Card 66'),
  card('fixture-card-67', 'Fixture Card 67'),
  card('fixture-card-68', 'Fixture Card 68'),
  card('fixture-card-69', 'Fixture Card 69'),
  card('fixture-card-70', 'Fixture Card 70'),
  card('fixture-card-71', 'Fixture Card 71'),
  card('fixture-card-72', 'Fixture Card 72'),
  card('fixture-card-73', 'Fixture Card 73'),
  card('fixture-card-74', 'Fixture Card 74'),
  card('fixture-card-75', 'Fixture Card 75'),
  card('fixture-card-76', 'Fixture Card 76'),
  card('fixture-card-77', 'Fixture Card 77'),
  card('fixture-card-78', 'Fixture Card 78'),
  card('fixture-card-79', 'Fixture Card 79'),
  card('fixture-card-80', 'Fixture Card 80'),
  card('fixture-card-81', 'Fixture Card 81'),
  card('fixture-card-82', 'Fixture Card 82'),
  card('fixture-card-83', 'Fixture Card 83'),
  card('fixture-card-84', 'Fixture Card 84'),
  card('fixture-card-85', 'Fixture Card 85'),
  card('fixture-card-86', 'Fixture Card 86'),
  card('fixture-card-87', 'Fixture Card 87'),
  card('fixture-card-88', 'Fixture Card 88'),
  card('fixture-card-89', 'Fixture Card 89'),
  card('fixture-card-90', 'Fixture Card 90'),
  card('fixture-card-91', 'Fixture Card 91'),
  card('fixture-card-92', 'Fixture Card 92'),
  card('fixture-card-93', 'Fixture Card 93'),
  card('fixture-card-94', 'Fixture Card 94'),
  card('fixture-card-95', 'Fixture Card 95'),
  card('fixture-card-96', 'Fixture Card 96'),
  card('fixture-card-97', 'Fixture Card 97'),
  card('fixture-card-98', 'Fixture Card 98'),
  card('fixture-card-99', 'Fixture Card 99'),
  card('fixture-card-100', 'Fixture Card 100'),
  card('fixture-card-101', 'Fixture Card 101'),
  card('fixture-card-102', 'Fixture Card 102'),
  card('fixture-card-103', 'Fixture Card 103'),
  card('fixture-card-104', 'Fixture Card 104'),
  card('fixture-card-105', 'Fixture Card 105'),
  card('fixture-card-106', 'Fixture Card 106'),
  card('fixture-card-107', 'Fixture Card 107'),
  card('fixture-card-108', 'Fixture Card 108'),
  card('fixture-card-109', 'Fixture Card 109'),
  card('fixture-card-110', 'Fixture Card 110'),
  card('fixture-card-111', 'Fixture Card 111'),
  card('fixture-card-112', 'Fixture Card 112'),
  card('fixture-card-113', 'Fixture Card 113'),
  card('fixture-card-114', 'Fixture Card 114'),
  card('fixture-card-115', 'Fixture Card 115'),
  card('fixture-card-116', 'Fixture Card 116'),
  card('fixture-card-117', 'Fixture Card 117'),
  card('fixture-card-118', 'Fixture Card 118'),
  card('fixture-card-119', 'Fixture Card 119'),
  card('fixture-card-120', 'Fixture Card 120'),
  card('fixture-other-1', 'Other Card I', 'other'),
  card('fixture-other-2', 'Other Card II', 'other'),
  card('fixture-other-3', 'Other Card III', 'other'),
  card('fixture-other-4', 'Other Card IV', 'other'),
  card('fixture-other-5', 'Other Card V', 'other'),
  card('fixture-other-6', 'Other Card VI', 'other'),
];

/** The four a gate of "four or more of one domain" is satisfied by. */
export const FIXTURE_DOMAIN_FOUR = ['fixture-card-1', 'fixture-card-2', 'fixture-card-3', 'fixture-card-4'];

/**
 * And four of the *other* domain, for a gate read against a second one — or for
 * a held hand that must leave the first gate short.
 */
export const FIXTURE_OTHER_FOUR = ['fixture-other-1', 'fixture-other-2', 'fixture-other-3', 'fixture-other-4'];

