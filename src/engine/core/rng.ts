/**
 * Deterministic random number generation for the rules core.
 *
 * Every rule that rolls dice takes an `Rng` explicitly; nothing in `src/engine/**`
 * may call `Math.random()`. A run is reproducible from its seed, so tests pin exact
 * outcomes and a replay/save can restore the stream position.
 *
 * The generator is SplitMix32: 32-bit state, one multiply-xorshift chain per draw,
 * good enough for dice and cheap enough to call in a loop. State is a single uint32,
 * which makes `save()`/`restore()` trivial and serialisable.
 */

/** Serialisable position in a random stream. */
export type RngState = number;

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max) — `max` must be a positive integer. */
  nextInt(max: number): number;
  /** One die: uniform integer in [1, sides]. */
  die(sides: number): number;
  /** `count` dice of `sides`, in roll order. */
  dice(count: number, sides: number): number[];
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** In-place Fisher-Yates shuffle; returns the same array. */
  shuffle<T>(items: T[]): T[];
  /**
   * A new independent generator derived from this one's current position.
   * Advances this stream by one draw, so forking is itself deterministic.
   * Use it to give a subsystem its own stream without coupling it to the caller's
   * call count (e.g. cosmetic dice animation must not shift the rules stream).
   */
  fork(): Rng;
  /** Current stream position, for saves and assertions. */
  save(): RngState;
  /** Jump to a previously saved position. */
  restore(state: RngState): void;
}

/** Hash an arbitrary string into a uint32 seed, so seeds can be human-readable. */
export function hashSeed(seed: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Create a generator. A string seed is hashed; a number is used as-is (mod 2^32). */
export function createRng(seed: number | string = 0): Rng {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;

  const nextUint32 = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };

  const rng: Rng = {
    next: () => nextUint32() / 0x1_0000_0000,
    nextInt(max) {
      if (!Number.isInteger(max) || max <= 0) {
        throw new RangeError(`nextInt(max) needs a positive integer, got ${max}`);
      }
      // Rejection sampling keeps the distribution exactly uniform.
      const limit = 0x1_0000_0000 - (0x1_0000_0000 % max);
      let v = nextUint32();
      while (v >= limit) v = nextUint32();
      return v % max;
    },
    die(sides) {
      if (!Number.isInteger(sides) || sides <= 0) {
        throw new RangeError(`die(sides) needs a positive integer, got ${sides}`);
      }
      return rng.nextInt(sides) + 1;
    },
    dice(count, sides) {
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError(`dice(count) needs a non-negative integer, got ${count}`);
      }
      const out: number[] = new Array(count);
      for (let i = 0; i < count; i++) out[i] = rng.die(sides);
      return out;
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick() needs a non-empty array');
      return items[rng.nextInt(items.length)]!;
    },
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1);
        const a = items[i]!;
        items[i] = items[j]!;
        items[j] = a;
      }
      return items;
    },
    fork: () => createRng(nextUint32()),
    save: () => state,
    restore(s) {
      state = s >>> 0;
    },
  };
  return rng;
}
