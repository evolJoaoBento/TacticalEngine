'use strict';
// What a hook runs inside, in the QuickJS runtime each call is given: the same pieces
// `src/engine/script/hooks.ts` and `src/engine/core/rng.ts` build, written as they write them, so a hook
// meets the same `ctx`, the same `Math` and the same dice. `__host(name, json)` is the one door out: the
// world's answer to a read, as JSON, or undefined where the TypeScript's world answers undefined.

const SHADOWED = [
  'globalThis', 'window', 'self', 'document', 'navigator', 'location', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'Date', 'console', 'process', 'require', 'module',
  'exports', 'localStorage', 'sessionStorage', 'indexedDB', 'crypto', 'performance', 'Function',
];

const SAFE_MATH = (() => {
  const copy = {};
  for (const key of Object.getOwnPropertyNames(Math)) {
    copy[key] = Math[key];
  }
  copy['random'] = () => {
    throw new Error('Math.random is not available in a hook: roll off ctx.rng so replays stay in step');
  };
  return Object.freeze(copy);
})();

function createRng(seed) {
  let state = seed >>> 0;

  const nextUint32 = () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };

  const rng = {
    next: () => nextUint32() / 0x1_0000_0000,
    nextInt(max) {
      if (!Number.isInteger(max) || max <= 0) {
        throw new RangeError(`nextInt(max) needs a positive integer, got ${max}`);
      }
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
      const out = new Array(count);
      for (let i = 0; i < count; i++) out[i] = rng.die(sides);
      return out;
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick() needs a non-empty array');
      return items[rng.nextInt(items.length)];
    },
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1);
        const a = items[i];
        items[i] = items[j];
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

const host = __host;
const parse = JSON.parse;
const stringify = JSON.stringify;

function hookReads(reads) {
  const call = (name, args) => {
    const answer = host(name, stringify(args));
    if (answer === undefined) return undefined;
    const read = parse(answer);
    // A read the world could not make: its error, thrown where the hook made it.
    if (read !== null && typeof read === 'object' && read.__thrown === 'TypeError') throw new TypeError(read.message);
    return read;
  };
  return {
    args: reads.args,
    actor: reads.actor,
    targets: reads.targets,
    hit: reads.hit,
    inCombat: reads.inCombat,
    pool: (id, pool, measure = 'available') => call('pool', [id, pool, measure]),
    hasCondition: (id, condition) => call('hasCondition', [id, condition]),
    bandTo: (from, to) => call('bandTo', [from, to]),
    difficultyOf: (id) => call('difficultyOf', [id]),
    select: (selector) => call('select', [selector]),
    flag: (name) => call('flag', [name]),
    variable: (name) => call('variable', [name]),
    countAlive: (faction) => call('countAlive', [faction]),
    factionOf: (id) => call('factionOf', [id]),
    tokens: (id, ability) => call('tokens', [id, ability]),
  };
}

/** Compile a body as `compileHooks` does: its parameters and nothing else it could reach by name. */
function compile(source) {
  return new Function(...SHADOWED, 'ctx', 'Math', `'use strict';\n${source}`);
}

/**
 * One call: the hook compiled, its `ctx` built - the reads, and for an effect the dice, the last roll and
 * the queue - and run as `runHook` runs it, a throw turned into its message. What comes back is JSON.
 */
function run(source, effect, readsJson, seed, lastRollJson) {
  const compiled = compile(source);
  const reads = parse(readsJson);
  const queued = [];
  const rng = effect ? createRng(seed) : undefined;
  const ctx = effect
    ? {
        ...hookReads(reads),
        rng,
        lastRoll: parse(lastRollJson),
        queue: (effects) => {
          queued.push(...effects);
        },
        log: (text, tone) => {
          queued.push({ kind: 'log', text, ...(tone === undefined ? {} : { tone }) });
        },
      }
    : hookReads(reads);
  const shadows = SHADOWED.map(() => undefined);
  let result;
  try {
    const value = compiled(...shadows, ctx, SAFE_MATH);
    result = { ok: true, value: value === true };
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : String(error), name: error instanceof Error ? error.name : null };
  }
  return stringify({ ...result, queued: result.ok ? queued : [], state: effect ? rng.save() : null });
}

/** Whether a body compiles, and if not, what the engine said. */
function check(source) {
  try {
    compile(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
