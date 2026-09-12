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

import { adversaryDefSchema } from '../../src/engine/content/pack/schema';

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
 * rather than the name it remembers.
 *
 * `fixture-foe` is the one to reach for when the creature genuinely does not
 * matter, which is most of the time.
 */
export const FIXTURE_ADVERSARIES = [
  block('fixture-foe', 'A Foe', 'standard', 11, 6, 12, 5, 3, 'A Swing', 2, 'melee', 1, 6, 1),
  block('fixture-archer', 'An Archer', 'ranged', 11, 5, 11, 4, 3, 'A Loosed Arrow', 3, 'far', 1, 6, 1),
  block('fixture-swarm', 'A Swarm', 'horde', 10, 5, 10, 6, 2, 'A Press of Bodies', 1, 'melee', 1, 6, 0),
  block('fixture-runt', 'A Runt', 'minion', 9, 4, 8, 1, 1, 'A Jab', 1, 'veryClose', 1, 4, 0),
  block('fixture-brute', 'A Brute', 'bruiser', 14, 12, 24, 9, 3, 'A Heavy Arm', 4, 'melee', 2, 8, 2),
  block('fixture-captain', 'A Captain', 'leader', 14, 10, 20, 8, 4, 'A Sabre', 3, 'melee', 1, 10, 2),
  block('fixture-champion', 'A Champion', 'solo', 15, 13, 26, 12, 5, 'A Greatsword', 4, 'melee', 2, 10, 2),
  block('fixture-lurker', 'A Lurker', 'skulk', 11, 6, 12, 4, 3, 'A Grasp', 2, 'melee', 1, 6, 1),
] as const;

/** The ids above, for a test that wants to name one without repeating a literal. */
export const FIXTURE_FOE = 'fixture-foe';
