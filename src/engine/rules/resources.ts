/**
 * The five resource pools and the rules that connect them.
 *
 * Two shapes of pool exist in the rules and they behave differently:
 *
 * - **Filling pools** are *marked*: Hit Points, Stress and Armor Slots start empty
 *   and fill up as you take damage or strain. "Marking your last Stress" is bad.
 * - **Draining pools** are *spent*: Light and Shadow start at a value and are spent.
 *
 * Every operation here is pure — it returns a new pool plus a report of what
 * actually happened, so callers can log the real numbers instead of the requested
 * ones (asking to clear 4 Stress with 2 marked clears 2).
 *
 * The rules these implement are the paired pools, hit points against damage thresholds, stress,
 * armour and downtime. The text they were read from is no longer vendored — see
 * `docs/CONTEXT.md` for what was settled and why.
 */

/** A PC starts with 2 Light. */
export const STARTING_GOOD = 2;
/** "A PC can have a maximum of 6 Light at one time." */
export const MAX_GOOD = 6;
/** "The GM can have up to 12 Shadow at one time." */
export const MAX_BAD = 12;
/** "All classes start with 6 Stress slots." */
export const STARTING_STRESS_SLOTS = 6;
/** HP and Stress slots both cap at 12 through leveling. */
export const MAX_SLOTS = 12;
/** Spending 3 Light initiates a Tag Team Roll and powers Class Light Features. */
export const TAG_TEAM_GOOD_COST = 3;
export const CLASS_GOOD_FEATURE_COST = 3;

/** A pool that is marked from empty, such as Hit Points, Stress or Armor Slots. */
export interface MarkPool {
  /** Slots currently marked. Always within [0, max]. */
  marked: number;
  /** Total slots. */
  max: number;
}

export function createMarkPool(max: number, marked = 0): MarkPool {
  const m = Math.max(0, Math.trunc(max));
  return { max: m, marked: clamp(marked, 0, m) };
}

/** Slots still open. */
export function unmarked(pool: MarkPool): number {
  return pool.max - pool.marked;
}

/** True when every slot is marked. */
export function isFull(pool: MarkPool): boolean {
  return pool.max > 0 && pool.marked >= pool.max;
}

export interface MarkResult {
  pool: MarkPool;
  /** Slots actually marked. */
  applied: number;
  /** Slots that could not be marked because the pool ran out. */
  overflow: number;
  /** True when this operation marked the last slot (it may already have been full). */
  filled: boolean;
}

/** Mark slots, reporting the overflow rather than silently dropping it. */
export function mark(pool: MarkPool, amount = 1): MarkResult {
  const want = Math.max(0, Math.trunc(amount));
  const applied = Math.min(want, unmarked(pool));
  const next: MarkPool = { max: pool.max, marked: pool.marked + applied };
  return { pool: next, applied, overflow: want - applied, filled: isFull(next) };
}

export interface ClearResult {
  pool: MarkPool;
  /** Slots actually cleared. */
  applied: number;
}

/** Clear marked slots (Tend to Wounds, Clear Stress, Repair Armor, a crit). */
export function clear(pool: MarkPool, amount = 1): ClearResult {
  const applied = Math.min(Math.max(0, Math.trunc(amount)), pool.marked);
  return { pool: { max: pool.max, marked: pool.marked - applied }, applied };
}

/** Clear every marked slot (Tend to All Wounds, Clear All Stress, a long rest). */
export function clearAll(pool: MarkPool): ClearResult {
  return { pool: { max: pool.max, marked: 0 }, applied: pool.marked };
}

/** Add or remove slots — leveling up, or an effect that grants temporary Armor Slots. */
export function resize(pool: MarkPool, max: number, cap = MAX_SLOTS): MarkPool {
  const m = clamp(Math.trunc(max), 0, cap);
  return { max: m, marked: Math.min(pool.marked, m) };
}

/**
 * Mark Stress, applying the SRD fallback: "When a character must mark 1 or more
 * Stress but can't, they mark 1 HP instead."
 *
 * Read literally, that is a flat 1 Hit Point for the whole event however much
 * Stress went unmarked — marking 3 Stress with one slot free marks 1 Stress and
 * 1 HP, not 1 Stress and 2 HP. That literal reading is what this implements; the
 * per-Stress reading some tables use would be `mark(hitPoints, overflow)`.
 *
 * The caller still has to honour the other half of the rule — "a character can't
 * *use a move* that requires them to mark Stress if all of their Stress is marked" —
 * which is a legality check on the move, not on this function. `canMarkStress`
 * exists for that check.
 */
export interface StressResult {
  stress: MarkPool;
  hitPoints: MarkPool;
  stressMarked: number;
  hpMarked: number;
  /** "When a character marks their last Stress, they become Vulnerable." */
  becameVulnerable: boolean;
  /** "When a character marks their last Hit Point, they fall" and make a death move. */
  fell: boolean;
}

export function markStress(stress: MarkPool, hitPoints: MarkPool, amount = 1): StressResult {
  const wasFull = isFull(stress);
  const s = mark(stress, amount);
  const h = mark(hitPoints, s.overflow > 0 ? 1 : 0);
  return {
    stress: s.pool,
    hitPoints: h.pool,
    stressMarked: s.applied,
    hpMarked: h.applied,
    becameVulnerable: s.filled && !wasFull,
    fell: h.filled && h.applied > 0,
  };
}

/** Whether a move that costs Stress may be used at all. */
export function canMarkStress(stress: MarkPool, cost = 1): boolean {
  return unmarked(stress) >= Math.max(1, Math.trunc(cost));
}

export interface HitPointResult {
  hitPoints: MarkPool;
  hpMarked: number;
  /** The character marked their last Hit Point and must make a death move. */
  fell: boolean;
}

export function markHitPoints(hitPoints: MarkPool, amount: number): HitPointResult {
  const wasFull = isFull(hitPoints);
  const r = mark(hitPoints, amount);
  return { hitPoints: r.pool, hpMarked: r.applied, fell: r.filled && !wasFull };
}

/** A metacurrency that is gained and spent against a cap: Light or Shadow. */
export interface Currency {
  value: number;
  max: number;
}

export function createGood(value = STARTING_GOOD, max = MAX_GOOD): Currency {
  return { max, value: clamp(value, 0, max) };
}

export function createBad(value = 0, max = MAX_BAD): Currency {
  return { max, value: clamp(value, 0, max) };
}

export interface GainResult {
  currency: Currency;
  /** Amount actually gained. */
  applied: number;
  /** Amount lost to the cap — Light and Shadow at their maximum simply do not accrue. */
  wasted: number;
}

export function gain(currency: Currency, amount = 1): GainResult {
  const want = Math.max(0, Math.trunc(amount));
  const applied = Math.min(want, currency.max - currency.value);
  return {
    currency: { max: currency.max, value: currency.value + applied },
    applied,
    wasted: want - applied,
  };
}

export interface SpendResult {
  currency: Currency;
  /** False when the character could not afford it; the currency is then unchanged. */
  ok: boolean;
  spent: number;
}

/** Spend all-or-nothing: a partially paid cost buys nothing. */
export function spend(currency: Currency, amount = 1): SpendResult {
  const cost = Math.max(0, Math.trunc(amount));
  if (currency.value < cost) return { currency, ok: false, spent: 0 };
  return { currency: { max: currency.max, value: currency.value - cost }, ok: true, spent: cost };
}

export function canAfford(currency: Currency, amount = 1): boolean {
  return currency.value >= Math.max(0, Math.trunc(amount));
}

/**
 * Cross out a Light slot permanently — a Scar from the Avoid Death move.
 * "If you ever cross out your last Light slot, your character's journey ends."
 */
export interface ScarResult {
  good: Currency;
  /** The character has no Light slots left and their journey ends. */
  journeyEnds: boolean;
}

export function scar(good: Currency): ScarResult {
  const max = Math.max(0, good.max - 1);
  return { good: { max, value: Math.min(good.value, max) }, journeyEnds: max === 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
