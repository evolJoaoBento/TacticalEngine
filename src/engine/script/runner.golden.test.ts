/**
 * Scripts run as the Rust server must run them, and the world they change (`docs/SERVER.md`, phase 2).
 *
 * The runner walks effect lists, stops for the player and resumes with their answer, and asks the world
 * for everything else - reads and writes alike. This runs every script in the game's own demo scene (its
 * party, adversaries, cards, conditions and project hooks) and tapes every call the runner makes on the
 * world, in order, with the world's answer; and, since the world draws from the runner's dice stream when
 * it is handed it, where that stream stood after. A hook is taped as what it was handed and what it
 * answered or queued - from the runner, and from inside the world - since running one is hooks' own part.
 *
 * The scripts are every ability's in the demo project and the shipped SRD pack, and a set written here for
 * the corners the content leaves out; each is run under options drawn off a seeded stream (who acts, who
 * and where it is aimed at, what it answers) by a player who mostly answers straight and sometimes
 * declines, resumes with nothing waiting, or runs the runner again.
 *
 * For the world's port the same runs keep what the world began as (its scene, the scenario, and the content
 * read off the world itself), what each step changed, and what was left to be heard; and one run in four is
 * then probed - played in a world carrying content written for the corners the demo's never reaches, and
 * asked directly, on purpose and on a seeded stream, what a fight asks of it beyond a script.
 * `UPDATE_GOLDEN=1 npx vitest run src/engine/script/runner.golden.test.ts` writes
 * `server/fixtures/runner.json` and `world.json`; `server/engine/tests/golden_runner.rs` replays the one
 * against a tape, `golden_world.rs` both against the Rust world.
 */

import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../core/rng';
import { rollDuality } from '../rules/duality';
import { buildDemoScene, refreshWorld } from '../../game/demo-scene';
import { characterContentFor } from '../../game/room';
import type { DerivedCharacter } from '../character/sheet';
import type { ContentPack } from '../content/pack/import';
import type { TileGrid } from '../grid/grid';
import { restoreScenario, scenarioSnapshot, type SceneScriptWorld } from './world';
import { deriveCharacter } from '../character/sheet';
import { abilitySchema } from '../content/abilities';
import { conditionDefSchema } from '../content/conditions';
import { NO_TILE } from '../grid/grid';
import { RANGE_BANDS } from '../rules/range';
import { cardDefSchema } from '../content/pack/schema';
import { hollowVaultMap } from '../../game/demo-map';
import { startEncounter } from '../../game/movement';
import { ScriptRunner, type Prompt, type Response, type RunStatus, type ScriptRunnerOptions, type ScriptWorld } from './runner';
import { effectSchema, type Effect } from './schema';

const rec = vi.hoisted(() => ({ depth: 0, calls: null as unknown[] | null, hooks: null as unknown[] | null, rng: null as unknown }));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

vi.mock('./hooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('./hooks')>();
  const runHook: typeof original.runHook = (fn, context) => {
    if (rec.calls === null) return original.runHook(fn, context);
    const reads = context as unknown as Record<string, unknown> & { rng?: Rng; queue?: (e: unknown[]) => void; log?: (t: string, tone?: string) => void };
    const seen = { args: clone(reads['args']), actor: reads['actor'], targets: clone(reads['targets']), hit: clone(reads['hit']), inCombat: reads['inCombat'] };
    // Asked from inside the world - a modifier's gate, a card's - it is the world's own question, and only
    // the world's tape holds it; the runner's holds what the runner asked.
    const inner = rec.depth > 0;
    const tape = (entry: unknown): void => {
      if (!inner) rec.calls!.push(entry);
      rec.hooks?.push(entry);
    };
    rec.depth++;
    try {
      if (reads.queue === undefined) {
        const result = original.runHook(fn, context);
        tape({ call: 'runHook', ...seen, answer: result.ok && result.value === true });
        return result;
      }
      // Run as an effect: what it queued, in the order it queued it.
      const queued: unknown[] = [];
      const queue = reads.queue;
      const log = reads.log!;
      const watched = {
        ...reads,
        queue: (effects: unknown[]) => {
          queued.push(...clone(effects));
          queue(effects);
        },
        log: (text: string, tone?: string) => {
          queued.push({ kind: 'log', text, ...(tone === undefined ? {} : { tone }) });
          log(text, tone);
        },
      };
      const result = original.runHook(fn, watched as never);
      tape({ call: 'runHookEffect', ...seen, lastRoll: clone(reads['lastRoll']), ok: result.ok, message: result.ok ? '' : result.message, queued, after: reads.rng!.save() });
      return result;
    } finally {
      rec.depth--;
    }
  };
  return { ...original, runHook };
});

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/runner.json');
const WORLD_FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/world.json');

/** Every world method the runner calls, taped with its arguments and answer. */
const CALLS = [
  'hasFlag', 'hasKey', 'hasItem', 'getVar', 'interactableState', 'encounterState', 'countAlive', 'questStatus', 'objectiveDone', 'actorId',
  'resolveTargets', 'inCombat', 'loadoutDomain', 'hasCondition', 'poolValue', 'bandTo', 'factionOf', 'difficultyOf', 'hook', 'tokensOn',
  'addItem', 'rollLoot', 'removeItem', 'setFlag', 'clearFlag', 'giveKey', 'setVar', 'openInteractable', 'closeInteractable', 'removeInteractable',
  'markInteractableUsed', 'startEncounter', 'endEncounter', 'damage', 'heal', 'healShared', 'checkModifier', 'advantageRolling', 'advantageAgainst',
  'liftRoll', 'goodDieSides', 'answersRoll', 'markSpot', 'recallSpot', 'forgetSpot', 'experiences', 'grantLevel', 'gainGood', 'gainBad',
  'startQuest', 'completeObjective', 'revealObjective', 'completeQuest', 'failQuest', 'dealDamage', 'markStress', 'clearStress', 'clearArmor',
  'markArmor', 'gainGoodFor', 'spendGood', 'loseGood', 'applyCondition', 'clearCondition', 'revive', 'slay', 'setAttitude', 'proficiencyOf',
  'addTokens', 'spendTokens', 'spellcastValue', 'loseBad', 'traitValue', 'weaponDamage', 'attack', 'pushBack', 'drawIn', 'drawTo', 'blinkTo',
  'breakAway', 'summon', 'startCountdown', 'placeZone', 'endZone', 'refreshZones', 'tileOf', 'spotlightSpent', 'nearestFirst', 'replace', 'rollReaction',
] as const;

function recorded(world: ScriptWorld): ScriptWorld {
  return new Proxy(world, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      const fn = value.bind(target) as (...args: unknown[]) => unknown;
      if (!(CALLS as readonly string[]).includes(key as string)) return fn;
      return (...args: unknown[]) => {
        if (rec.calls === null || rec.depth > 0) return fn(...args);
        rec.depth++;
        try {
          const handed = args.some((a) => a === rec.rng);
          const answer = fn(...args);
          rec.calls.push({
            call: key,
            args: clone(args.map((a) => (a === rec.rng ? 'rng' : a))),
            answer: key === 'hook' ? answer !== null : clone(answer),
            ...(handed ? { after: (rec.rng as Rng).save() } : {}),
          });
          return answer;
        } finally {
          rec.depth--;
        }
      };
    },
  }) as ScriptWorld;
}

const num = (value: number): number | null => (Number.isFinite(value) ? value : null);

function specOf(grid: TileGrid) {
  return {
    width: grid.width,
    height: grid.height,
    origin: { ...grid.origin },
    palette: grid.palette.types.map((t) => ({ id: t.id, passable: t.passable, cost: num(t.cost), providesCover: t.providesCover, blocksSight: t.blocksSight })),
    heights: [...grid.heights],
    terrain: [...grid.terrain],
    overlay: [...grid.overlay],
    lift: [...grid.lift],
    barred: [...grid.barred],
  };
}

/** The content as the Rust reads it, as `character.golden.test.ts` writes it: each list in its map's order. */
function contentJson(pack: ContentPack) {
  return {
    weapons: [...pack.weapons.values()].map(({ id, name, tier, slot, trait, range, damage, burden, features }) => ({ id, name, tier, slot, trait, range, damage, burden, features })),
    armors: [...pack.armors.values()].map(({ id, name, tier, baseThresholds, baseScore, features }) => ({ id, name, tier, baseThresholds, baseScore, features })),
    classes: [...pack.classes.values()].map(({ id, name, domains, startingEvasion, startingHitPoints }) => ({ id, name, domains, startingEvasion, startingHitPoints })),
    ancestries: [...pack.ancestries.values()].map(({ id, name }) => ({ id, name })),
    communities: [...pack.communities.values()].map(({ id, name }) => ({ id, name })),
    subclasses: [...pack.subclasses.values()].map(({ id, name, classId, domains, spellcastTrait }) => ({ id, name, classId, domains, ...(spellcastTrait === undefined ? {} : { spellcastTrait }) })),
    cards: cardsJson(pack.cards),
  };
}

function cardsJson(cards: ContentPack['cards']) {
  return [...cards.values()].map(({ id, name, grant, domain, type, level, recallCost }) => ({ id, name, grant, ...(domain === undefined ? {} : { domain }), ...(type === undefined ? {} : { type }), ...(level === undefined ? {} : { level }), ...(recallCost === undefined ? {} : { recallCost }) }));
}

/** What a world was built with, read off the world itself: its private options are what it plays. */
function contentOf(world: SceneScriptWorld, project: Parameters<typeof characterContentFor>[0], code: readonly { id: string; name: string; source: string }[]) {
  const w = world as unknown as {
    traits: object; lootTables: Map<string, unknown>; characters: Map<string, DerivedCharacter>; adversaries: Map<string, unknown>;
    bandTiles?: object; movement?: object; defense: object; abilities: unknown[]; cards: (() => ContentPack['cards']) | null;
    conditionDefs: Map<string, unknown>; hooks: () => ReadonlyMap<string, unknown>;
  };
  return {
    pack: contentJson(characterContentFor(project)),
    sheets: [...w.characters.values()].map((c) => c.sheet),
    derived: [...w.characters.values()].map((c) => ({ id: c.sheet.id, cards: c.cards.map((x) => x.id), granted: c.granted.map((x) => x.id), modifiers: c.modifiers, proficiency: c.proficiency, evasion: c.evasion, thresholds: c.thresholds, traits: c.traits })),
    cards: w.cards === null ? null : cardsJson(w.cards()),
    abilities: w.abilities,
    adversaries: [...w.adversaries.values()],
    conditionDefs: [...w.conditionDefs.values()],
    lootTables: [...w.lootTables.values()],
    traits: w.traits,
    bandTiles: w.bandTiles ?? null,
    movement: w.movement ?? null,
    defense: w.defense,
    hooks: [...w.hooks().keys()],
    code: code.map(({ id, name, source }) => ({ id, name, source })),
  };
}

/** Where a run began: the scene as a snapshot holds it, what a snapshot does not (who blocks where), and the scenario. */
function startOf(demo: ReturnType<typeof buildDemoScene>) {
  const s = demo.state as unknown as { blockingInteractables: Set<number>; interactableTiles: Map<string, number>; interactableFootprints: Map<string, number[]>; passableWhenOpen: Set<string> };
  return {
    grid: specOf(demo.state.grid),
    scene: demo.state.snapshot(),
    layout: { blocking: [...s.blockingInteractables], tiles: [...s.interactableTiles], footprints: [...s.interactableFootprints], doors: [...s.passableWhenOpen] },
    scenario: scenarioSnapshot(demo.scenario),
    spotlit: demo.state.allEntities().map((e) => e.id).filter((id) => demo.world.spotlightSpent(id)),
    damaged: demo.world.drainDamage(),
    entered: demo.world.drainEntered(),
  };
}

// --- Probes: the world asked directly, after a run ------------------------------------------------------

/**
 * Content written for the corners the demo's never reaches: conditions that pay out, aid an Armor Slot,
 * answer a fall, swap the Light Die, shrug damage off, stop a creature, end of themselves, or lend a card;
 * a card the party is given, with tokens that lift a roll; and features printed on the demo's stat blocks.
 */
function probeContent(demo: ReturnType<typeof buildDemoScene>, party: readonly string[]): void {
  const blocks = [...new Set(demo.state.entitiesOf('adversary').map((e) => e.definition))];
  const say = (text: string) => ({ kind: 'log', text });
  const inCombat = { kind: 'inCombat' };
  demo.project.conditionDefs.push(
    ...[
      { id: 'probe-marked', name: 'Marked', payout: { on: 'attacked', effects: [say('paid')], auto: true }, armor: { steps: 1, endsWhenItSaves: true }, modifiers: [{ stat: 'evasion', bonus: 2, when: inCombat }] },
      { id: 'probe-veil', name: 'Veiled', insteadOfDeath: { clears: 2, says: 'not yet' }, goodDie: { sides: 20 }, defenses: { resistances: ['physical'], reduce: [{ dice: '2' }] }, blocks: ['armor'] },
      { id: 'probe-stunned', name: 'Stunned', blocks: ['reactions', 'act', 'move'], endsWhen: 'hit' },
      { id: 'probe-sleep', name: 'Asleep', endsWhen: 'damaged', modifiers: [{ stat: 'advantage', bonus: 1, against: true, anyRoll: true }] },
      { id: 'probe-focus', name: 'Focused', endsWhen: 'rolls', modifiers: [{ stat: 'advantage', bonus: 1, anyRoll: true }, { stat: 'attackRoll', bonus: 1, requires: 'meleeWeapon' }, { stat: 'damageRoll', bonus: 1, perToken: 'probe-ward' }] },
      { id: 'probe-keeps', name: 'Kept', payout: { on: 'attacked', effects: [say('kept')], keeps: true, when: inCombat } },
      { id: 'probe-lends', name: 'Lent' },
      { id: 'probe-ground', name: 'Ground', onEnter: { effects: [say('entered')] } },
    ].map((c) => conditionDefSchema.parse(c)),
  );
  demo.project.cards.push(
    ...[
      { id: 'probe-ward-card', name: 'Ward', grant: { kind: 'given', characters: [...party] } },
      { id: 'probe-lent-card', name: 'Lent', grant: { kind: 'condition', conditions: ['probe-lends'] } },
      { id: 'probe-block-card', name: 'Block', grant: { kind: 'adversary', adversaries: blocks } },
    ].map((c) => cardDefSchema.parse(c)),
  );
  const on = (card: string, id: string, rest: object) => abilitySchema.parse({ id, name: id, source: { card }, ...rest });
  demo.project.abilities.push(
    on('probe-ward-card', 'probe-ward', { kind: 'passive', tokens: { amount: 'spellcast', minimum: 1 }, lift: { each: 2 }, modifiers: [{ stat: 'evasion', bonus: 1, perToken: 'probe-ward' }] }),
    on('probe-ward-card', 'probe-reflex', { kind: 'reaction', trigger: 'attacked', available: inCombat, effects: [say('reflex')] }),
    on('probe-ward-card', 'probe-rolling', { kind: 'reaction', trigger: 'partyRolling', available: { kind: 'not', of: inCombat }, effects: [say('rolling')] }),
    on('probe-lent-card', 'probe-lent', { kind: 'passive', modifiers: [{ stat: 'thresholds', bonus: 3 }], defenses: { immunities: ['magic'] } }),
    on('probe-lent-card', 'probe-lent-reaction', { kind: 'reaction', trigger: 'incomingDamage', reaction: { kind: 'reduceSeverity', steps: 1 }, cost: { stress: 1 } }),
    on('probe-block-card', 'probe-direct', { kind: 'passive', standardAttack: { direct: true, damage: '2d6', when: inCombat } }),
    on('probe-block-card', 'probe-heavy', { kind: 'passive', standardAttack: { damage: '1d4+1', double: true, severity: 'major' } }),
    on('probe-block-card', 'probe-hide', { kind: 'passive', defenses: { resistances: ['magic'], reduce: [{ dice: '1', only: 'physical' }] }, modifiers: [{ stat: 'advantage', bonus: -1, against: true }, { stat: 'evasion', bonus: 1 }, { stat: 'majorThreshold', bonus: 2, when: inCombat }] }),
    on('probe-block-card', 'probe-shell', { kind: 'reaction', trigger: 'incomingDamage', reaction: { kind: 'reduceDamage', dice: '1d4' } }),
  );
  for (const who of party) {
    demo.characters.set(who, deriveCharacter(demo.sheets.get(who)!, characterContentFor(demo.project), demo.project.abilities).character);
  }
  refreshWorld(demo);
}

const TRIGGERS = ['incomingDamage', 'attackHit', 'attackMissed', 'tookDamage', 'tookHitPoints', 'tookSevere', 'defeated', 'dealtHit', 'dealtDamage', 'dealtMiss', 'attacked', 'partyRolled', 'partyRolling', 'rollingDamage', 'allyRollingDamage', 'allyTookDamage', 'nearbyTookDamage', 'spotlighted'] as const;
const ROLL_STATS = ['attackRoll', 'damageRoll', 'spellcastRoll', 'actionRoll'] as const;
const POOL_STATS = ['evasion', 'armorScore', 'hitPoints', 'stress', 'majorThreshold', 'severeThreshold', 'thresholds'] as const;
const BLOCKS = ['act', 'move', 'reactions', 'armor'] as const;
const TRAITS = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'] as const;
const BANDS = RANGE_BANDS.filter((b) => b !== 'outOfRange');
const OUTCOMES = ['criticalSuccess', 'successWithGood', 'successWithBad', 'failureWithGood', 'failureWithBad'] as const;
const TYPES = ['physical', 'magic'] as const;

/**
 * The world asked directly, on a stream: what a fight asks of it beyond a script - modifiers, defences,
 * reactions, the swing a block prints, what a condition owes - with writes between the reads so there is
 * something to read: conditions on and off, zones placed, tokens, marks, blows, attacks, walks, doors,
 * summons, a creature turned, the actor changed. Each call, its arguments and the world's answer; and
 * where the dice stood after a call that threw them.
 */
function probes(demo: ReturnType<typeof buildDemoScene>, world: SceneScriptWorld, seed: string, told: boolean): unknown[] {
  const gen = createRng(`${seed}:probe`);
  const dice = createRng(`${seed}:probe-dice`);
  const state = demo.state;
  const w = world as unknown as { conditionDefs: Map<string, unknown>; abilities: { id: string; tokens?: unknown }[]; adversaries: Map<string, unknown> };
  const coin = (): boolean => gen.nextInt(2) === 0;
  const one = <T>(xs: readonly T[]): T => xs[gen.nextInt(xs.length)]!;
  const some = <T>(xs: readonly T[]): T[] => xs.filter(() => gen.nextInt(3) === 0).slice(0, 3);
  // A small cast, so what is done to one is read back from the same one: the party, four others, and
  // whatever was summoned.
  const cast = (): string[] => {
    const all = state.allEntities();
    const others = all.filter((e) => e.faction !== 'party');
    return [...all.filter((e) => e.faction === 'party'), ...others.slice(0, 4), ...others.slice(4).filter((e) => e.id.includes('-s')).slice(0, 3)].map((e) => e.id);
  };
  // And a thread through the calls: most picks go back to whoever the last call was about, so what is
  // done to one is read back from it.
  let focus: string | null = null;
  const pool = (xs: string[]): string[] => (focus !== null && xs.includes(focus) && gen.nextInt(3) > 0 ? [focus] : xs);
  const ids = (): string[] => pool([...cast(), 'nobody']);
  const living = (): string[] => pool(cast());
  const tile = (): number => (gen.nextInt(10) === 0 ? NO_TILE : gen.nextInt(state.grid.size));
  const shipped = [...w.conditionDefs.keys(), 'probe-none'];
  const written = shipped.filter((c) => c.startsWith('probe-'));
  const condition = (): string => (coin() ? one(written) : one(shipped));
  const tokens = [...w.abilities.filter((a) => a.tokens !== undefined).map((a) => a.id), 'probe-none'];
  const blocks = [...w.adversaries.keys()].slice(0, 6).concat(['nope']);
  const things = [...(state as unknown as { interactableTiles: Map<string, number> }).interactableTiles.keys()].concat(['nothing-here']);
  const thingTile = (): number => state.interactableTile(one(things));
  const bindings = () => ({ targets: some(ids()), hit: some(ids()), ...(coin() ? { point: tile() } : {}) });
  const maybe = <T>(value: () => T): T | undefined => (coin() ? value() : undefined);
  const selector = (): Record<string, unknown> => {
    const kind = one(['actor', 'party', 'entity', 'entities', 'target', 'hit', 'allies', 'inPath', 'adversaries']);
    const opt = (key: string, value: () => unknown) => (coin() ? { [key]: value() } : {});
    switch (kind) {
      case 'entity':
        return { kind, id: one(ids()) };
      case 'entities':
        return { kind, ids: some(ids()) };
      case 'hit':
        return { kind, ...opt('having', () => condition()), ...opt('nearest', () => 1 + gen.nextInt(2)) };
      case 'allies':
        return { kind, ...opt('range', () => one(BANDS)), ...opt('around', () => one(['target', 'point'])), ...opt('includeSelf', () => true), ...opt('except', () => 'target'), ...opt('nearest', () => 1 + gen.nextInt(2)) };
      case 'inPath':
        return { kind, ...opt('range', () => one(BANDS)), ...opt('reach', () => 'weapon'), ...opt('side', () => one(['allies', 'adversaries'])) };
      case 'adversaries':
        return { kind, range: one(BANDS), ...opt('around', () => one(['target', 'point'])), ...opt('except', () => one(['target', 'actor'])), ...opt('sameKind', () => true), ...opt('reach', () => 'weapon'), ...opt('nearest', () => 1 + gen.nextInt(2)) };
      default:
        return { kind };
    }
  };
  const damageOf = () => ({ amount: gen.nextInt(16), ...(coin() ? { types: [one(TYPES)] } : {}), ...(coin() ? { direct: true } : {}) });
  const idsOf = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

  type Op = [call: string, args: () => unknown[], run: (...args: never[]) => unknown, dice?: true];
  const ops: Op[] = [
    // writes, to give the reads something to read
    ['actor', () => [coin() ? one(living()) : null], (id: string | null) => void (demo.scenario.actorId = id)],
    ['applyCondition', () => [one(ids()), condition(), one(['temporary', 'scene', 'rest', 'permanent'])], (id: string, c: string, d: 'scene') => world.applyCondition(id, c, d)],
    ['applyCondition', () => [one(ids()), condition(), 'scene'], (id: string, c: string, d: 'scene') => world.applyCondition(id, c, d)],
    ['clearCondition', () => [one(ids()), condition()], (id: string, c: string) => world.clearCondition(id, c)],
    ['placeZone', () => [{ id: one(['z1', 'z2']), name: 'Z', owner: coin() ? one(ids()) : null, condition: condition(), anchor: gen.nextInt(state.grid.size), band: one(BANDS), ...(coin() ? { side: one(['allies', 'adversaries']) } : {}), onDeath: one(['end', 'keep']), ...(coin() ? { value: 1 + gen.nextInt(3), grows: { by: 1, until: 4 } } : {}) }], (zone: never) => world.placeZone(zone)],
    ['endZone', () => [one(['z1', 'z2', 'z3'])], (id: string) => world.endZone(id)],
    ['refreshZones', () => [], () => world.refreshZones()],
    ['addTokens', () => [one(ids()), one(tokens), maybe(() => gen.nextInt(4))], (id: string, a: string, n?: number) => world.addTokens(id, a, n)],
    ['spendTokens', () => [one(ids()), one(tokens), gen.nextInt(4)], (id: string, a: string, n: number) => world.spendTokens(id, a, n)],
    ['markSpot', () => [one(ids()), one(['here', 'there'])], (id: string, m: string) => world.markSpot(id, m)],
    ['forgetSpot', () => [one(ids()), one(['here', 'there'])], (id: string, m: string) => world.forgetSpot(id, m)],
    ['forgetSpots', () => [], () => world.forgetSpots()],
    ['noteDamage', () => [one(ids()), { ...(coin() ? { attacker: one(ids()) } : {}), hitPoints: gen.nextInt(3), damage: gen.nextInt(9), ...(coin() ? { types: [one(TYPES)] } : {}), severe: coin() }], (id: string, note: never) => world.noteDamage(id, note)],
    ['noteSevere', () => [one(ids())], (id: string) => world.noteSevere(id)],
    ['drainDamage', () => [], () => world.drainDamage()],
    ['drainEntered', () => [], () => world.drainEntered()],
    ['markStress', () => [one(ids()), gen.nextInt(4)], (id: string, n: number) => world.markStress(id, n)],
    ['markArmor', () => [one(ids()), gen.nextInt(3)], (id: string, n: number) => world.markArmor(id, n)],
    ['clearArmor', () => [one(ids()), gen.nextInt(3)], (id: string, n: number) => world.clearArmor(id, n)],
    ['gainGoodFor', () => [one(ids()), gen.nextInt(3)], (id: string, n: number) => world.gainGoodFor(id, n)],
    ['loseGood', () => [one(ids()), gen.nextInt(3)], (id: string, n: number) => world.loseGood(id, n)],
    ['damage', () => [selector(), gen.nextInt(4), null, bindings()], (s: never, n: number, _: null, b: never) => world.damage(s, n, undefined, b)],
    ['heal', () => [selector(), gen.nextInt(4), bindings()], (s: never, n: number, b: never) => world.heal(s, n, b)],
    ['healShared', () => [selector(), gen.nextInt(5), bindings()], (s: never, n: number, b: never) => world.healShared(s, n, b)],
    ['slay', () => [selector(), bindings()], (s: never, b: never) => world.slay(s, b)],
    ['revive', () => [selector(), bindings()], (s: never, b: never) => world.revive(s, b)],
    ['setAttitude', () => [one(ids()), one(['friendly', 'hostile'])], (id: string, a: 'friendly') => world.setAttitude(id, a)],
    ['endsOnHit', () => [one(ids())], (id: string) => world.endsOnHit(id)],
    ['endsOnDamage', () => [one(ids())], (id: string) => world.endsOnDamage(id)],
    ['endsOnAttack', () => [one(ids())], (id: string) => world.endsOnAttack(id)],
    ['endsOnRoll', () => [one(ids())], (id: string) => world.endsOnRoll(id)],
    ['startCountdown', () => [{ id: one(['c1', 'c2']), name: 'C', owner: coin() ? one(ids()) : null, dice: '3', value: 1 + gen.nextInt(3), start: 3, advance: one(['standard', 'attackRoll', 'hpMarked']), ...(coin() ? { loop: 'reset' } : {}), onDeath: one(['end', 'trigger']), effects: [] }], (c: never) => world.startCountdown(c)],
    ['advanceCountdowns', () => [coin() ? { kind: 'actionRoll', attack: coin(), outcome: one(OUTCOMES) } : { kind: 'hpMarked', id: one(ids()), marked: gen.nextInt(3) }], (cue: never) => world.advanceCountdowns(cue, dice), true],
    ['reapCountdowns', () => [], () => world.reapCountdowns()],
    ['endCreatureCountdowns', () => [], () => world.endCreatureCountdowns()],
    ['dealDamage', () => [one(ids()), damageOf()], (id: string, d: never) => world.dealDamage(id, d, dice), true],
    [
      'defend',
      () => [one(ids()), damageOf()],
      (id: string, d: never) => {
        const defense = world.defend(id, d, dice);
        return { ...defense, reactions: defense.reactions.map((r) => ({ ability: r.ability.id, goodSpent: r.goodSpent, stressMarked: r.stressMarked, ...(r.rolled === undefined ? {} : { rolled: r.rolled }) })) };
      },
      true,
    ],
    ['attack', () => [{ attacker: one(ids()), target: one(ids()), weapon: one(['primary', 'secondary']), ...(coin() ? { advantage: gen.nextInt(3) - 1 } : {}), ...(coin() ? { damage: one(['1d6', '2d4+1', 'x']) } : {}), ...(coin() ? { range: one(BANDS) } : {}), ...(coin() ? { direct: true } : {}), ...(coin() ? { joinedBy: some(ids()) } : {}) }], (r: never) => world.attack(r, dice), true],
    ['rollReaction', () => [one(ids()), 8 + gen.nextInt(8), one(TRAITS)], (id: string, d: number, tr: 'agility') => world.rollReaction(id, d, tr, dice), true],
    ['summon', () => [one(blocks), gen.nextInt(3), one(BANDS)], (d: string, n: number, b: 'close') => world.summon(d, n, b)],
    ['replace', () => [one(blocks), gen.nextInt(3)], (d: string, n: number) => world.replace(d, n)],
    ['drawIn', () => [one(ids()), one(ids()), one(BANDS), one(BANDS)], (a: string, b: string, band: 'close', budget: 'close') => world.drawIn(a, b, band, budget)],
    ['drawTo', () => [one(ids()), tile(), one(BANDS), one(BANDS)], (a: string, t: number, band: 'close', budget: 'close') => world.drawTo(a, t, band, budget)],
    ['blinkTo', () => [one(ids()), tile(), one([...BANDS, 'outOfRange'])], (a: string, t: number, band: 'close') => world.blinkTo(a, t, band)],
    ['breakAway', () => [one(ids()), one(ids()), one(BANDS)], (a: string, b: string, budget: 'close') => world.breakAway(a, b, budget)],
    ['pushBack', () => [one(ids()), one(ids()), one(BANDS)], (a: string, b: string, band: 'close') => world.pushBack(a, b, band)],
    ['placeEntity', () => [one(living()), gen.nextInt(state.grid.width) + one([0, 0.25, 0.4]), gen.nextInt(state.grid.height) + one([0, 0.3])], (id: string, x: number, y: number) => state.placeEntity(id, x, y)],
    ['openInteractable', () => [one(things)], (id: string) => world.openInteractable(id)],
    ['closeInteractable', () => [one(things)], (id: string) => state.closeInteractable(id)],
    ['removeInteractable', () => [one(things)], (id: string) => world.removeInteractable(id)],
    ['clearConditions', () => [one(['scene', 'rest'])], (scope: 'scene') => state.clearConditions(scope)],
    ['roundTrip', () => [], () => restoreScenario(demo.scenario, scenarioSnapshot(demo.scenario))],
    ['setFlag', () => [one(['f', 'g'])], (f: string) => world.setFlag(f)],
    ['clearFlag', () => [one(['f', 'g'])], (f: string) => world.clearFlag(f)],
    ['hasFlag', () => [one(['f', 'g'])], (f: string) => world.hasFlag(f)],
    ['addItem', () => [one(['rope', 'key']), gen.nextInt(3)], (i: string, n: number) => world.addItem(i, n)],
    ['removeItem', () => [one(['rope', 'key']), gen.nextInt(3)], (i: string, n: number) => world.removeItem(i, n)],
    ['setVar', () => [one(['v', '7', 'mark:here:kara']), one([1, 'x', null, true])], (name: string, v: never) => world.setVar(name, v)],
    ['getVar', () => [one(['v', '7', 'mark:here:kara', 'unset'])], (name: string) => world.getVar(name)],
    ['grantLevel', () => [coin() ? 1 + gen.nextInt(12) : null], (level: number | null) => world.grantLevel(level ?? undefined)],
    ['startQuest', () => [one(['q', 'r'])], (q: string) => world.startQuest(q)],
    ['completeObjective', () => [one(['q', 'r']), one(['o', 'p'])], (q: string, o: string) => world.completeObjective(q, o)],
    ['revealObjective', () => [one(['q', 'r']), one(['o', 'p'])], (q: string, o: string) => world.revealObjective(q, o)],
    ['completeQuest', () => [one(['q', 'r'])], (q: string) => world.completeQuest(q)],
    ['failQuest', () => [one(['q', 'r'])], (q: string) => world.failQuest(q)],
    ['questStatus', () => [one(['q', 'r'])], (q: string) => world.questStatus(q)],
    ['objectiveDone', () => [one(['q', 'r']), one(['o', 'p'])], (q: string, o: string) => world.objectiveDone(q, o)],
    ['startEncounter', () => [one(demo.scene.encounters.map((e) => e.id))], (id: string) => world.startEncounter(id)],
    ['hasCondition', () => [one(ids()), condition()], (id: string, c: string) => world.hasCondition(id, c)],
    ['countAlive', () => [one(['party', 'adversary'])], (side: 'party') => world.countAlive(side)],
    // reads
    ['heldBy', () => [one(ids())], (id: string) => idsOf(world.heldBy(id))],
    ['modifiersOf', () => [one(ids()), one(['roll', 'pool']), bindings()], (id: string, scope: 'roll', b: never) => world.modifiersOf(id, scope, b)],
    ['rollBonus', () => [one(ids()), one(ROLL_STATS), coin()], (id: string, stat: 'attackRoll', melee: boolean) => world.rollBonus(id, stat, { melee })],
    ['poolBonus', () => [one(ids()), one(POOL_STATS)], (id: string, stat: 'evasion') => world.poolBonus(id, stat)],
    ['defensesOf', () => [one(ids())], (id: string) => world.defensesOf(id)],
    ['defenderOf', () => [one(living())], (id: string) => world.defenderOf(state.entity(id)!)],
    ['advantageFor', () => [one(ids()), one(ids())], (a: string, b: string) => world.advantageFor(a, b)],
    ['advantageRolling', () => [], () => world.advantageRolling()],
    ['advantageAgainst', () => [some(ids())], (xs: string[]) => world.advantageAgainst(xs)],
    ['reactionsFor', () => [one(ids()), one(TRIGGERS), maybe(bindings) ?? null], (id: string, tr: 'attacked', b: never | null) => idsOf(world.reactionsFor(id, tr, b ?? undefined))],
    ['standardAttackOf', () => [one(blocks), coin() ? [one(ids()), one(ids())] : null], (d: string, between: [string, string] | null) => world.standardAttackOf(d, between === null ? undefined : { attacker: between[0], target: between[1] })],
    ['abilitiesForAdversary', () => [one(blocks)], (d: string) => idsOf(world.abilitiesForAdversary(d))],
    ['blocking', () => [one(ids()), one(BLOCKS)], (id: string, what: 'act') => world.blocking(id, what)],
    ['armorFor', () => [one(ids())], (id: string) => world.armorFor(id)],
    ['payoutsOn', () => [one(ids())], (id: string) => world.payoutsOn(id, 'attacked')],
    ['armorAid', () => [one(ids())], (id: string) => world.armorAid(id)],
    ['insteadOfDeath', () => [one(ids())], (id: string) => world.insteadOfDeath(id)],
    ['conditionName', () => [condition()], (c: string) => world.conditionName(c)],
    ['weaponRange', () => [one(ids())], (id: string) => world.weaponRange(id)],
    ['weaponDamage', () => [one(ids())], (id: string) => world.weaponDamage(id)],
    ['tokenCount', () => [one(ids()), one(tokens)], (id: string, a: string) => world.tokenCount(id, a)],
    ['goodDieSides', () => [one(ids())], (id: string) => world.goodDieSides(id)],
    ['liftRoll', () => [one(ids()), one(['spellcast', 'agility']), gen.nextInt(12), 8 + gen.nextInt(8), gen.nextInt(8) === 0], (id: string, tr: 'agility', total: number, d: number, crit: boolean) => world.liftRoll(id, tr, total, d, crit)],
    ['answersRoll', () => [one(ids()), { total: gen.nextInt(20), outcome: one(OUTCOMES) }], (id: string, roll: never) => world.answersRoll(id, roll)],
    ['checkModifier', () => [one([...TRAITS, 'spellcast', 'weapon']), one(['party', 'actor'])], (tr: 'agility', as: 'party') => world.checkModifier(tr, as)],
    ['resolveTargets', () => [selector(), bindings()], (s: never, b: never) => world.resolveTargets(s, b)],
    ['nearestFirst', () => [one(ids()), some(ids())], (id: string, xs: string[]) => world.nearestFirst(id, xs)],
    ['alongPath', () => [tile(), tile(), one(BANDS), some(ids())], (a: number, b: number, band: 'close', except: string[]) => world.alongPath(a, b, band, except)],
    ['zoneFootprints', () => [], () => world.zoneFootprints()],
    ['marks', () => [], () => world.marks()],
    ['countdowns', () => [], () => world.countdowns()],
    ['poolValue', () => [one(ids()), one(['hitPoints', 'stress', 'armorSlots', 'good']), one(['available', 'marked', 'max'])], (id: string, pool: 'stress', m: 'max') => world.poolValue(id, pool, m)],
    ['bandTo', () => [one(ids()), one(ids())], (a: string, b: string) => world.bandTo(a, b)],
    ['bandBetween', () => [tile(), tile()], (a: number, b: number) => world.bandBetween(a, b)],
    ['difficultyOf', () => [one(ids())], (id: string) => world.difficultyOf(id)],
    ['factionOf', () => [one(ids())], (id: string) => world.factionOf(id)],
    ['bodyFree', () => [tile(), coin() ? one(living()) : ''], (at: number, except: string) => state.bodyFree(at, except)],
    ['bodyFree', () => [thingTile(), ''], (at: number, except: string) => state.bodyFree(at, except)],
    ['bodyFree', () => [living().length === 0 ? NO_TILE : state.entity(one(living()))!.tile + one([1, -1, state.grid.width, -state.grid.width]), ''], (at: number, except: string) => state.bodyFree(at, except)],
    ['isOccupied', () => [tile()], (at: number) => state.isOccupied(at)],
    ['isOpen', () => [one(things)], (id: string) => state.isOpen(id)],
  ];
  // Asked only on purpose, never off the stream: reads nothing else reaches.
  const extra: Op[] = [
    ['encounterState', () => [], (id: string) => world.encounterState(id)],
    ['endEncounter', () => [], (id: string) => world.endEncounter(id)],
    ['interactableState', () => [], (id: string) => world.interactableState(id)],
    ['markInteractableUsed', () => [], (id: string) => world.markInteractableUsed(id)],
    ['hasItem', () => [], (item: string, n: number) => world.hasItem(item, n)],
    ['hasKey', () => [], (key: string) => world.hasKey(key)],
    ['itemCount', () => [], (item: string) => world.itemCount(item)],
    ['loadoutDomain', () => [], (id: string, domain: string) => world.loadoutDomain(id, domain)],
    ['recallSpot', () => [], (id: string, mark: string) => world.recallSpot(id, mark)],
    ['clearStress', () => [], (id: string, n: number) => world.clearStress(id, n)],
    ['spendGood', () => [], (id: string, n: number) => world.spendGood(id, n)],
    ['traitValue', () => [], (id: string, tr: 'agility') => world.traitValue(id, tr)],
    ['spellcastValue', () => [], (id: string) => world.spellcastValue(id)],
    ['proficiencyOf', () => [], (id: string) => world.proficiencyOf(id)],
    ['experiences', () => [], () => world.experiences()],
    ['tileOf', () => [], (id: string) => world.tileOf(id)],
  ];
  const out: unknown[] = [];
  const ask = (call: string, given: unknown[]): void => {
    const [, , run, rolls] = [...ops, ...extra].find(([name]) => name === call)!;
    const answer = (run as (...a: unknown[]) => unknown)(...given);
    out.push({ call, args: clone(given), answer: clone(answer), ...(rolls === true ? { after: dice.save() } : {}) });
  };
  if (told) for (const [call, given] of stories(demo, things)) ask(call, given);
  for (let i = 0; i < 80; i++) {
    const [call, args] = ops[gen.nextInt(ops.length)]!;
    const given = args();
    if (typeof given[0] === 'string' && cast().includes(given[0])) focus = given[0];
    ask(call, given);
  }
  return out;
}

/**
 * The world asked on purpose, a rule at a time, so that each is read back where the random calls might
 * never happen to: a condition put on and then read, a door opened and then walked at, a creature slain
 * and then healed. Named for the demo's own cast, whoever they are in this run.
 */
function stories(demo: ReturnType<typeof buildDemoScene>, things: readonly string[]): [string, unknown[]][] {
  const state = demo.state;
  const party = state.entitiesOf('party').map((e) => e.id);
  const others = state.entitiesOf('adversary').map((e) => e.id);
  if (party.length < 3 || others.length < 2) return [];
  const [p0, p1, p2] = party as [string, string, string];
  const [f0, f1] = others as [string, string];
  const at = (id: string): number => state.entity(id)?.tile ?? NO_TILE;
  const def = (id: string): string => state.entity(id)?.definition ?? 'nope';
  const door = things.find((id) => (state as unknown as { passableWhenOpen: Set<string> }).passableWhenOpen.has(id)) ?? things[0]!;
  const none = { targets: [], hit: [] };
  const spot = state.entity(p2)?.at ?? { x: 0, y: 0 };
  // A straight run of open floor from the first of the party, to line a push up against a body.
  const grid = state.grid;
  const from = at(p0);
  const open = (x: number, y: number): boolean => grid.inBounds(x, y) && grid.isPassable(grid.indexOf(x, y));
  const [dx, dy] = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).find(([sx, sy]) => [1, 2, 3].every((k) => open(grid.xOf(from) + sx * k, grid.yOf(from) + sy * k))) ?? [1, 0];
  const lined = (k: number): [number, number] => [grid.xOf(from) + dx * k, grid.yOf(from) + dy * k];
  return [
    ['actor', [p0]],
    ['applyCondition', [p0, 'probe-veil', 'scene']],
    ['armorFor', [p0]],
    ['defensesOf', [p0]],
    ['goodDieSides', [p0]],
    ['insteadOfDeath', [p0]],
    ['clearCondition', [p0, 'probe-veil']],
    ['applyCondition', [f0, 'probe-stunned', 'scene']],
    ['reactionsFor', [f0, 'incomingDamage', null]],
    ['blocking', [f0, 'move']],
    ['drawIn', [f0, p0, 'melee', 'far']],
    ['endsOnHit', [f0]],
    ['drawIn', [f0, p0, 'melee', 'veryFar']],
    ['applyCondition', [p1, 'probe-sleep', 'scene']],
    ['endsOnDamage', [p1]],
    ['actor', [p1]],
    ['applyCondition', [p1, 'probe-focus', 'scene']],
    ['rollBonus', [p1, 'attackRoll', false]],
    ['rollBonus', [p1, 'attackRoll', true]],
    ['addTokens', [p1, 'probe-ward', 2]],
    ['rollBonus', [p1, 'damageRoll', false]],
    ['advantageRolling', []],
    ['endsOnRoll', [p1]],
    ['hasCondition', [p1, 'probe-focus']],
    ['applyCondition', [f0, 'hidden', 'scene']],
    ['applyCondition', [f1, 'vulnerable', 'scene']],
    ['advantageAgainst', [[f0, f1]]],
    ['advantageAgainst', [[f0]]],
    ['advantageAgainst', [[f1]]],
    ['applyCondition', [p0, 'hidden', 'scene']],
    ['attack', [{ attacker: p0, target: f1, weapon: 'primary', range: 'veryFar' }]],
    ['hasCondition', [p0, 'hidden']],
    ['applyCondition', [p0, 'probe-lends', 'scene']],
    ['heldBy', [p0]],
    ['defenderOf', [p0]],
    ['modifiersOf', [p0, 'pool', none]],
    ['reactionsFor', [p0, 'incomingDamage', null]],
    ['defensesOf', [p0]],
    ['placeEntity', [p2, spot.x + 0.4, spot.y]],
    ...[...party, ...others.slice(0, 6)].map((id): [string, unknown[]] => ['bandTo', [p2, id]]),
    ['bodyFree', [at(p2) + 1, '']],
    ['bodyFree', [at(p2) - 1, '']],
    ['openInteractable', [door]],
    ['bodyFree', [state.interactableTile(door), '']],
    ['closeInteractable', [door]],
    ['bodyFree', [state.interactableTile(door), '']],
    ['removeInteractable', [door]],
    ['bodyFree', [state.interactableTile(door), '']],
    ['addTokens', [p2, 'probe-ward', 1]],
    ['liftRoll', [p2, 'agility', 5, 12, false]],
    ['liftRoll', [p2, 'agility', 10, 12, false]],
    ['tokenCount', [p2, 'probe-ward']],
    ['startEncounter', [demo.scene.encounters[0]?.id ?? 'none']],
    ['standardAttackOf', [def(f0), [f0, p0]]],
    ['standardAttackOf', [def(f0), null]],
    ['abilitiesForAdversary', [def(f0)]],
    ['actor', [f0]],
    ['resolveTargets', [{ kind: 'adversaries', range: 'veryFar', sameKind: true }, none]],
    ['resolveTargets', [{ kind: 'adversaries', range: 'veryFar', nearest: 2 }, none]],
    ['actor', [p0]],
    ['resolveTargets', [{ kind: 'adversaries', range: 'melee', reach: 'weapon' }, none]],
    ['resolveTargets', [{ kind: 'adversaries', range: 'veryFar', reach: 'weapon' }, none]],
    ['actor', [p1]],
    ['resolveTargets', [{ kind: 'adversaries', range: 'melee', reach: 'weapon' }, none]],
    ['actor', [p0]],
    ['resolveTargets', [{ kind: 'adversaries', range: 'veryFar', nearest: 3 }, none]],
    ['drawIn', [f1, p0, 'melee', 'veryFar']],
    ['resolveTargets', [{ kind: 'adversaries', range: 'veryFar', nearest: 1 }, none]],
    ['resolveTargets', [{ kind: 'adversaries', range: 'veryFar', around: 'point', nearest: 1 }, { targets: [], hit: [], point: at(p0) }]],
    ['blinkTo', [p2, at(p0), 'outOfRange']],
    ['placeZone', [{ id: 'za', name: 'A', owner: p1, condition: 'probe-ground', anchor: 0, band: 'melee', onDeath: 'keep' }]],
    ['placeZone', [{ id: 'zb', name: 'B', owner: f0, condition: 'probe-ground', anchor: at(p0), band: 'melee', onDeath: 'keep' }]],
    ['drainEntered', []],
    ['endZone', ['za']],
    ['endZone', ['zb']],
    ['resolveTargets', [{ kind: 'adversaries', range: 'veryFar', around: 'target', nearest: 1 }, { targets: [p1], hit: [] }]],
    ['resolveTargets', [{ kind: 'allies', range: 'veryFar', nearest: 1 }, none]],
    ['resolveTargets', [{ kind: 'hit', nearest: 1 }, { targets: [], hit: [f1, f0] }]],
    ['slay', [{ kind: 'entity', id: p2 }, none]],
    ['heal', [{ kind: 'entity', id: p2 }, 2, none]],
    ['resolveTargets', [{ kind: 'party' }, none]],
    ['healShared', [{ kind: 'entity', id: p2 }, 2, none]],
    ['resolveTargets', [{ kind: 'party' }, none]],
    ['revive', [{ kind: 'target' }, { targets: [p2], hit: [] }]],
    ['damage', [{ kind: 'party' }, 3, null, none]],
    ['healShared', [{ kind: 'party' }, 4, none]],
    ['markStress', [p1, 20]],
    ['markStress', [p1, 1]],
    ['markStress', [p1, 1]],
    ['markStress', [p1, 1]],
    ['markStress', [p1, 1]],
    ['markStress', [p1, 1]],
    ['markStress', [p1, 1]],
    ['placeZone', [{ id: 'zs', name: 'Z', owner: p0, condition: 'probe-ground', anchor: at(f0), band: 'close', onDeath: 'end', value: 1, grows: { by: 1, until: 2 } }]],
    ['drainEntered', []],
    ['noteDamage', [f0, { hitPoints: 1, damage: 3 }]],
    ['noteDamage', [f0, { hitPoints: 1, damage: 3 }]],
    ['zoneFootprints', []],
    ['slay', [{ kind: 'entity', id: p0 }, none]],
    ['actor', [p0]],
    ['resolveTargets', [{ kind: 'actor' }, none]],
    ['summon', [def(f0), 1, 'melee']],
    ['refreshZones', []],
    ['zoneFootprints', []],
    ['applyCondition', [f1, 'probe-marked', 'scene']],
    ['applyCondition', [f1, 'probe-keeps', 'scene']],
    ['payoutsOn', [f1]],
    ['armorAid', [f1]],
    ['revive', [{ kind: 'entity', id: p0 }, none]],
    ['placeEntity', [f0, ...lined(1)]],
    ['placeEntity', [f1, ...lined(2)]],
    ['pushBack', [p0, f0, 'far']],
    ['setAttitude', [p0, 'friendly']],
    ['setAttitude', [f1, 'friendly']],
    ['factionOf', [f1]],
    ['setAttitude', [f1, 'hostile']],
    ['startCountdown', [{ id: 'cs', name: 'C', owner: f1, dice: '2', value: 2, start: 2, advance: 'hpMarked', onDeath: 'trigger', effects: [] }]],
    ['advanceCountdowns', [{ kind: 'hpMarked', id: f1, marked: 1 }]],
    ['slay', [{ kind: 'entity', id: f1 }, none]],
    ['reapCountdowns', []],
    ['countAlive', ['adversary']],
    ['countAlive', ['party']],
    ['actor', [f0]],
    ['summon', [def(f0), 2, 'close']],
    ['replace', [def(f0), 2]],
    ['encounterState', [demo.scene.encounters[0]?.id ?? 'none']],
    ['endEncounter', [demo.scene.encounters[0]?.id ?? 'none']],
    ['encounterState', [demo.scene.encounters[0]?.id ?? 'none']],
    ['interactableState', [door]],
    ['markInteractableUsed', [door]],
    ['interactableState', [door]],
    ['addItem', ['rope', 2]],
    ['hasItem', ['rope', 2]],
    ['hasItem', ['rope', 3]],
    ['hasKey', ['rope']],
    ['hasKey', ['lockpick']],
    ['addItem', ['lockpick', 1]],
    ['hasKey', ['lockpick']],
    ['setVar', [`mark:far:${p0}`, 1_000_000]],
    ['recallSpot', [p0, 'far']],
    ['setVar', [`mark:far:${p0}`, -5]],
    ['recallSpot', [p0, 'far']],
    ['itemCount', ['rope']],
    ...party.flatMap((id): [string, unknown[]][] => [
      ['loadoutDomain', [id, 'bulwark']],
      ['loadoutDomain', [id, 'ember']],
      ['loadoutDomain', [id, 'shadow']],
      ['traitValue', [id, 'agility']],
      ['traitValue', [id, 'spellcast']],
      ['traitValue', [id, 'proficiency']],
      ['spellcastValue', [id]],
      ['proficiencyOf', [id]],
      ['clearStress', [id, 1]],
      ['spendGood', [id, 1]],
      ['markSpot', [id, 'here']],
      ['recallSpot', [id, 'here']],
      ['tileOf', [id]],
    ]),
    ['loadoutDomain', [f0, 'ember']],
    ['recallSpot', [f0, 'nowhere']],
    ['actor', [p1]],
    ['experiences', []],
    // A crowd that fills the ring it was called to, so the rest stand nearer.
    ['actor', [others[2] ?? p0]],
    ['summon', [def(f0), 20, 'veryClose']],
  ];
}

/** The scene and scenario as they stand, for a step to say what it changed. */
function standing(demo: ReturnType<typeof buildDemoScene>) {
  const scene = demo.state.snapshot();
  return { entities: scene.entities, interactables: scene.interactables, encounters: scene.encounters, bad: scene.bad, scenario: scenarioSnapshot(demo.scenario) };
}

/** What changed between two readings: each creature that did (null for one gone), and each other part whole. */
function changes(was: ReturnType<typeof standing>, now: ReturnType<typeof standing>) {
  const differ = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const entities: Record<string, unknown> = {};
  for (const id of new Set([...Object.keys(was.entities), ...Object.keys(now.entities)])) {
    if (differ(was.entities[id], now.entities[id])) entities[id] = now.entities[id] ?? null;
  }
  return {
    ...(Object.keys(entities).length === 0 ? {} : { entities }),
    ...(differ(was.interactables, now.interactables) ? { interactables: now.interactables } : {}),
    ...(differ(was.encounters, now.encounters) ? { encounters: now.encounters } : {}),
    ...(differ(was.bad, now.bad) ? { bad: now.bad } : {}),
    ...(differ(was.scenario, now.scenario) ? { scenario: now.scenario } : {}),
  };
}

const log = { kind: 'log', text: 'x' };
/**
 * A hook of the fixture's own, in every run's project: every read, against whatever the run has made of the
 * world - a foe turned, a target named - so the world a hook reads is held to the TypeScript's, hook and all.
 */
const PROBE_CODE = {
  id: 'probe-reads',
  name: 'Probe reads',
  notes: '',
  source: [
    'var a = ctx.actor, t = ctx.targets[0];',
    'var out = [ctx.inCombat, ctx.targets, ctx.hit, ctx.pool(a, "hitPoints"), ctx.pool(a, "stress", "marked"), ctx.select({ kind: "target" }), ctx.select({ kind: "hit" }),',
    '  ctx.select({ kind: "adversaries", range: "far", around: "target" }), ctx.countAlive("neutral"), ctx.countAlive("party"), ctx.difficultyOf(t), ctx.factionOf(t),',
    '  ctx.tokens(a, "ward"), ctx.variable("v"), ctx.flag("f"), ctx.hasCondition(a, "hidden"), ctx.bandTo(a, t)];',
    'try { out.push(ctx.pool(a, "nonsense")); } catch (e) { out.push(e.name); }',
    'if (ctx.log === undefined) return ctx.inCombat === false;',
    'out.push(ctx.rng.nextInt(3000000000), ctx.rng.nextInt(3000000000), ctx.lastRoll);',
    'ctx.log(JSON.stringify(out));',
    'return true;',
  ].join('\n'),
};
/** Stands for the stat block of one of the demo's own foes, so a summons has something to call. */
const FOE = '<foe>';
/** Scripts for the corners the content does not reach. */
const WRITTEN: unknown[][] = [
  [{ kind: 'none' }, { kind: 'story', title: 'T', paragraphs: ['a'] }, { kind: 'setFlag', flag: 'f' }, { kind: 'clearFlag', flag: 'f' }, { kind: 'giveKey', key: 'k' }],
  [{ kind: 'addItem', item: 'rope', quantity: 2 }, { kind: 'removeItem', item: 'rope', quantity: 5 }, { kind: 'setVar', name: 'v', value: 'x' }, { kind: 'addVar', name: 'v', by: 2 }, { kind: 'addVar', name: 'n', by: 1.5 }],
  [{ kind: 'open' }, { kind: 'close', interactable: 'door' }, { kind: 'toggleOpen', interactable: 'door' }, { kind: 'toggleOpen', interactable: 'door' }, { kind: 'remove', interactable: 'lever' }, { kind: 'markUsed' }, { kind: 'openContainer' }, { kind: 'teleport', pair: 'p' }],
  [{ kind: 'loot', table: 'chest' }, { kind: 'loot' }, { kind: 'loot', table: 'nothing-here' }],
  [{ kind: 'startQuest', quest: 'q' }, { kind: 'completeObjective', quest: 'q2', objective: 'o' }, { kind: 'revealObjective', quest: 'q', objective: 'p' }, { kind: 'completeQuest', quest: 'q' }, { kind: 'failQuest', quest: 'q2' }, { kind: 'levelUp' }, { kind: 'levelUp', level: 4 }],
  [{ kind: 'startEncounter', encounter: 'e', intro: 'Go' }, { kind: 'endEncounter', encounter: 'e' }, { kind: 'goto', scene: 's' }, { kind: 'startDialogue', dialogue: 'd' }, log],
  [{ kind: 'damage', amount: 2, source: 'trap' }, { kind: 'damage', amount: { pool: 'stress' }, target: { kind: 'target' } }, { kind: 'damage', amount: 'spent' }],
  [{ kind: 'damage', dice: 'd6', target: { kind: 'target' } }, { kind: 'damage', dice: 'same', half: true, target: { kind: 'target' } }, { kind: 'damage', dice: 'weapon', using: 'proficiency', target: { kind: 'target' }, type: 'magic' }],
  [{ kind: 'damage', dice: 'same', target: { kind: 'target' } }, { kind: 'damage', dice: 'theirs', target: { kind: 'actor' } }, { kind: 'damage', dice: 'nonsense', target: { kind: 'target' } }, { kind: 'damage', dice: '2d6', using: 'spellcast', direct: true, target: { kind: 'target' } }, { kind: 'damage', dice: '1d8', using: 'halfProficiency', target: { kind: 'target' } }],
  [{ kind: 'heal', dice: '1d4', target: { kind: 'party' }, spread: true }, { kind: 'heal', amount: 2 }, { kind: 'heal', dice: 'bad' }, { kind: 'heal', amount: 'hitPointsTaken' }],
  [{ kind: 'markStress', amount: 2, target: { kind: 'party' } }, { kind: 'clearStress', amount: { trait: 'presence' } }, { kind: 'clearArmor' }, { kind: 'markArmor', amount: 2, target: { kind: 'party' } }],
  [{ kind: 'gainGood', amount: 1, target: { kind: 'party' } }, { kind: 'loseGood', target: { kind: 'party' } }, { kind: 'spendGood', amount: 1 }, { kind: 'spendGood', amount: 9 }],
  [{ kind: 'gainBad', amount: { pool: 'stress', measure: 'marked' } }, { kind: 'loseBad', amount: 2 }, { kind: 'gainBad', amount: 'targetsHit' }],
  [{ kind: 'applyCondition', condition: 'vulnerable', duration: 'scene' }, { kind: 'clearCondition', condition: 'vulnerable' }, { kind: 'setAttitude', attitude: 'friendly' }, { kind: 'setAttitude', attitude: 'hostile' }],
  [{ kind: 'slay' }, { kind: 'revive', target: { kind: 'party' } }, { kind: 'openShop' }, { kind: 'openShop', of: 'smith' }],
  [{ kind: 'slay', target: { kind: 'target' } }, { kind: 'revive', target: { kind: 'target' } }, { kind: 'revive', target: { kind: 'target' } }],
  // Blows hard enough that Get Back Up and Rune Ward answer them.
  [{ kind: 'damage', amount: 14, target: { kind: 'party' } }, { kind: 'damage', amount: 30, target: { kind: 'party' } }],
  [{ kind: 'branch', when: { kind: 'chance', dice: 'd6', atLeast: 4, times: { dice: 'd2' } }, then: [log], otherwise: [{ kind: 'log', text: 'y' }] }, { kind: 'branch', when: { kind: 'never' }, then: [log] }],
  [{ kind: 'choice', title: 'T', body: 'B', options: [{ label: 'A', effects: [log] }, { label: 'B', available: { kind: 'never' } }, { label: 'C', detail: 'd', effects: [{ kind: 'setFlag', flag: 'c' }] }] }, { kind: 'choice', options: [{ label: 'x', available: { kind: 'never' } }] }],
  [{ kind: 'check', check: { trait: 'presence', difficulty: 12, tags: ['talk'], prompt: 'P', onSuccessWithGood: [log], onFailureWithBad: [{ kind: 'setFlag', flag: 'failed' }], always: [{ kind: 'log', text: 'always' }] } }, { kind: 'check', check: { trait: 'agility', difficulty: 'target', roll: 'last' } }],
  [{ kind: 'check', check: { trait: 'finesse', difficulty: 'target', targets: { kind: 'adversaries', range: 'far' }, onCriticalSuccess: [log] } }, { kind: 'check', check: { trait: 'spellcast', difficulty: 10 } }, { kind: 'check', check: { trait: 'weapon', difficulty: 8 } }],
  [{ kind: 'check', check: { trait: 'knowledge', difficulty: 5, roll: 'last', onSuccessWithGood: [log] } }],
  [{ kind: 'attack', target: { kind: 'target' }, advantage: 1, damageBonus: 2, damageDice: 'd4', onHit: [{ kind: 'damage', dice: 'same', half: true, target: { kind: 'target' } }], onMiss: [log] }],
  [{ kind: 'attack', by: 'target', target: { kind: 'party' }, weapon: 'secondary', damageDice: 'weapon', range: 'far', direct: true, joinedBy: { kind: 'allies', range: 'close' } }, { kind: 'attack', damageDice: 'weaponDie' }, { kind: 'attack', target: { kind: 'actor' } }],
  [{ kind: 'summon', adversary: FOE, count: '2', range: 'close', spotlight: true }, { kind: 'summon', adversary: FOE, count: '0' }, { kind: 'summon', adversary: 'nope', perPc: true }, { kind: 'summon', adversary: FOE, count: 'lots' }],
  [{ kind: 'replace', adversary: FOE, count: '2' }, { kind: 'replace', adversary: FOE, count: 'x' }],
  [{ kind: 'spotlight' }, { kind: 'spotlight', targets: { kind: 'party' }, count: 'd2', halfDamage: true }, { kind: 'spotlight', count: '0' }, { kind: 'spotlight', count: 'q' }],
  [{ kind: 'boostDamage', dice: 'd6', amount: 1, times: 2, double: true, type: 'magic' }, { kind: 'boostDamage', dice: 'weapon' }, { kind: 'boostDamage', amount: 'spent' }, { kind: 'boostDamage', dice: '??' }],
  [{ kind: 'diceCheck', dice: 'd6', times: 3, atLeast: 5, needed: 2, then: [log], otherwise: [{ kind: 'log', text: 'no' }] }, { kind: 'diceCheck', dice: 'd6', times: 'spent', atLeast: 1, then: [log], otherwise: [log] }, { kind: 'diceCheck', dice: '!', atLeast: 1, then: [] }],
  [{ kind: 'softenBlow', dice: 'd4', amount: 1 }, { kind: 'damage', dice: 'same', target: { kind: 'target' } }, { kind: 'softenBlow', amount: 'spent' }, { kind: 'avoidBlow' }, { kind: 'stepSeverity' }, { kind: 'dodgeBy', dice: 'd6' }, { kind: 'dodgeBy', dice: 'x' }],
  [{ kind: 'forceSeverity', severity: 'severe', least: true }, { kind: 'forceHitPoints', amount: 2 }, { kind: 'forceHitPoints', amount: 'spent' }, { kind: 'rerollDamage', below: 3 }, { kind: 'raiseRoll', amount: 2 }, { kind: 'nameRoll' }, { kind: 'rerollDuality', which: 'bad' }, { kind: 'maxOneDie' }, { kind: 'vaultCard' }, { kind: 'spotlightAgain' }, { kind: 'endSpotlight' }],
  [{ kind: 'howMany', most: 3, least: 0, title: 'How many?', each: [{ kind: 'log', text: 'spent {n}' }, { kind: 'gainGood', amount: 'spent' }] }, { kind: 'howMany', most: 'spent', each: [log] }],
  [{ kind: 'howMany', most: { pool: 'good' }, each: [{ kind: 'markStress', amount: 'spent' }, { kind: 'diceCheck', dice: 'd6', times: 'spent', atLeast: 6, then: [log] }] }],
  [{ kind: 'markSpot', mark: 'here' }, { kind: 'move', to: 'mark', mark: 'here' }, { kind: 'forgetSpot', mark: 'here' }, { kind: 'move', to: 'mark', mark: 'here' }],
  [{ kind: 'move', to: 'point', teleport: true }, { kind: 'move', to: 'point', range: 'close', budget: 'far' }, { kind: 'move', how: 'away', budget: 'close' }, { kind: 'move', of: { kind: 'target' }, range: 'melee' }, { kind: 'move', who: { kind: 'party' }, of: { kind: 'target' } }, { kind: 'push', to: 'far' }],
  [{ kind: 'zone', zone: 'z', name: 'Z', condition: 'burning', band: 'close', side: 'adversaries', value: 1, grows: { by: 1, until: 3 } }, { kind: 'zone', zone: 'y', name: 'Y', condition: 'burning', at: 'point', band: 'melee' }, { kind: 'endZone', zone: 'z' }, { kind: 'endZone', zone: 'none' }],
  [{ kind: 'countdown', countdown: 'c', name: 'C', start: 'd6', advance: 'attackRoll', loop: 'reset', onDeath: 'trigger', effects: [log] }, { kind: 'countdown', countdown: 'd', name: 'D', start: '0' }, { kind: 'countdown', countdown: 'e', name: 'E', start: 'x' }],
  [{ kind: 'addToken', ability: 'ward', amount: 3 }, { kind: 'addToken', ability: 'ward' }, { kind: 'spendToken', ability: 'ward', amount: 2 }, { kind: 'spendToken', ability: 'ward', amount: 9 }, { kind: 'spendToken', ability: 'ward', all: true }, { kind: 'addToken', ability: 'ward', amount: 'spent' }],
  [{ kind: 'reactionRoll', difficulty: 12, trait: 'instinct', targets: { kind: 'party' }, damage: { dice: '2d6', type: 'physical' }, onFail: [{ kind: 'damage', dice: 'same', target: { kind: 'hit' } }], onSuccess: [{ kind: 'damage', dice: 'same', half: true, target: { kind: 'hit' } }] }, { kind: 'reactionRoll', difficulty: 'roll' }, { kind: 'reactionRoll', difficulty: 10, damage: { dice: '?' } }],
  [{ kind: 'run', hook: 'nobody-wrote-this' }, { kind: 'run', hook: 'nobody', args: { a: 1 } }],
  // Amounts read afresh each time round a loop, and a handful's highest die with its modifier.
  [{ kind: 'gainBad', amount: { dice: '1d2+1' } }, { kind: 'loseBad', amount: { count: { kind: 'party' } } }, { kind: 'gainBad', amount: { dice: '2d4+1', pick: 'highest' } }],
  [{ kind: 'howMany', most: 12, each: [{ kind: 'log', text: '{n} of twelve' }] }, { kind: 'howMany', most: 20, least: 0, each: [{ kind: 'log', text: '{n}' }] }],
  // Swings that reach whoever is there, so they land or miss rather than being refused for range.
  [{ kind: 'attack', target: { kind: 'adversaries', range: 'veryFar' }, range: 'veryFar', onHit: [{ kind: 'log', text: 'hit' }], onMiss: [{ kind: 'log', text: 'missed' }] }],
  [{ kind: 'attack', target: { kind: 'adversaries', range: 'veryFar', nearest: 1 }, range: 'veryFar', damageDice: 'weapon', onHit: [{ kind: 'damage', dice: 'same', target: { kind: 'hit' } }], onMiss: [{ kind: 'markStress', amount: 1 }] }],
  [{ kind: 'attack', by: 'target', target: { kind: 'party' }, range: 'veryFar', onMiss: [{ kind: 'log', text: 'it missed' }] }],
  // The fixture's own hook, run and asked, with a foe turned first so there is somebody neutral to count.
  [{ kind: 'setAttitude', attitude: 'friendly' }, { kind: 'run', hook: 'probe-reads', args: { n: 1 } }, { kind: 'branch', when: { kind: 'hook', hook: 'probe-reads' }, then: [log], otherwise: [{ kind: 'log', text: 'no' }] }],
  // One die is enough unless a check says otherwise, and an Experience costs Light the roller may not have.
  [{ kind: 'diceCheck', dice: 'd6', times: 1, atLeast: 1, then: [log], otherwise: [{ kind: 'log', text: 'no' }] }],
  [{ kind: 'loseGood', amount: 9, target: { kind: 'actor' } }, { kind: 'check', check: { trait: 'presence', difficulty: 12 } }, { kind: 'check', check: { trait: 'instinct', difficulty: 10 } }],
];

function scripts(demo: ReturnType<typeof buildDemoScene>): { source: string; effects: Effect[] }[] {
  const srd = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../content/pack/shipped/srd-characters.json'), 'utf8')) as { abilities: { id: string; effects?: unknown[] }[] };
  const fromContent = [...demo.project.abilities, ...srd.abilities]
    .filter((a) => (a.effects ?? []).length > 0)
    .map((a) => ({ source: a.id, effects: (a.effects ?? []).map((e) => effectSchema.parse(e)) }));
  const byId = new Map(fromContent.map((s) => [s.source, s]));
  const foe = JSON.stringify(demo.state.entitiesOf('adversary')[0]!.definition);
  const written = WRITTEN.map((list) => JSON.parse(JSON.stringify(list).replaceAll(JSON.stringify(FOE), foe)) as unknown[]);
  return [...byId.values(), ...written.map((list, i) => ({ source: `written-${i}`, effects: list.map((e) => effectSchema.parse(e)) }))];
}

/** A player's answer to a prompt, drawn off a stream: mostly straight, sometimes not. */
function answer(prompt: Prompt, player: Rng): Response {
  const roll = player.next();
  if (roll < 0.07) return { kind: 'cancel' };
  switch (prompt.kind) {
    case 'choice': {
      if (roll < 0.12) return { kind: 'choose', index: player.pick([-1, 99, 0.5]) };
      return { kind: 'choose', index: prompt.options[player.nextInt(prompt.options.length)]!.index };
    }
    case 'check': {
      const experience = prompt.experiences.length > 0 && player.nextInt(2) === 0 ? { experience: prompt.experiences[player.nextInt(prompt.experiences.length)]!.name } : {};
      return { kind: 'roll', ...(player.nextInt(3) === 0 ? { advantage: player.nextInt(3) } : {}), ...(player.nextInt(4) === 0 ? { disadvantage: 1 } : {}), ...(player.nextInt(4) === 0 ? { helpDice: 1 } : {}), ...experience };
    }
    case 'rolled':
      return { kind: 'answered', ...player.pick([{}, { reroll: 'good' as const }, { reroll: 'bad' as const }, { reroll: 'both' as const }, { raise: 2 }, { name: true }, { raise: 1, name: true }]) };
    case 'dialogue':
      return { kind: 'continue' };
  }
}

function statusJson(status: RunStatus, since: number) {
  return { status: status.status, ...(status.status === 'waiting' ? { prompt: status.prompt } : {}), journalLength: status.journal.length, newEntries: status.journal.slice(since) };
}

const SRD = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../content/pack/shipped/srd-characters.json'), 'utf8')) as { abilities: { source: { card: string } }[]; cards: { id: string }[] };
/**
 * Cards that answer a roll somebody in the party makes, which is what stops a check for a `rolled` prompt,
 * and the two that answer a blow, which is what puts a `defended` line in the journal.
 */
const HELD = ['reassurance', 'bold-presence', 'get-back-up', 'rune-ward'];

/**
 * The party holding the cards that answer rolls and blows, as the demo tests hand a character cards:
 * Reassurance answers somebody else's roll and Bold Presence the holder's own failed Presence roll, so
 * everybody holds all of them; Get Back Up and Rune Ward answer the damage the holder takes.
 */
function holdAnswering(demo: ReturnType<typeof buildDemoScene>, party: readonly string[]): void {
  demo.project.cards.push(...SRD.cards.filter((c) => HELD.includes(c.id)).map((c) => cardDefSchema.parse(c)));
  demo.project.abilities.push(...SRD.abilities.filter((a) => HELD.includes(a.source.card)).map((a) => abilitySchema.parse(a)));
  for (const who of party) {
    const sheet = { ...demo.sheets.get(who)!, domainCards: [...HELD], loadout: [...HELD] };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
  }
  refreshWorld(demo);
}

function play(source: string, effects: Effect[], seed: string) {
  // Only the GM replaces a creature, so a script that does is always played by a foe.
  const byFoe = effects.some((e) => e.kind === 'replace');
  const demo = buildDemoScene(hollowVaultMap(), seed);
  demo.project.code.push(PROBE_CODE);
  const gen = createRng(`${seed}:options`);
  const ids = demo.state.allEntities().map((e) => e.id);
  const party = demo.state.entitiesOf('party').map((e) => e.id);
  const foes = demo.state.entitiesOf('adversary').map((e) => e.id);
  if (gen.nextInt(2) === 0 && demo.scene.encounters.length > 0) startEncounter(demo, demo.scene.encounters[0]!.id);
  // Mostly a party member acting, as a card is played; now and then an adversary, or nobody (a chest's script).
  const drawn = gen.pick([party[0] ?? null, party[1] ?? null, party[2] ?? null, party[0] ?? null, party[1] ?? null, foes[0] ?? null, null]);
  const actor = byFoe ? (foes[0] ?? null) : drawn;
  demo.world.scenario.actorId = actor;
  if (gen.nextInt(2) === 0) holdAnswering(demo, party.filter((id) => demo.sheets.has(id)));
  // One run in four is probed afterwards, in a world carrying the content written for the probes.
  const probed = seed.endsWith(':0');
  if (probed) probeContent(demo, party.filter((id) => demo.sheets.has(id)));
  const pick = (from: string[]): string[] => (from.length === 0 ? [] : [gen.pick(from)]);
  const options: ScriptRunnerOptions = {
    ...(gen.nextInt(8) > 0 ? { targets: gen.nextInt(4) > 0 ? pick(foes) : pick(ids) } : {}),
    ...(gen.nextInt(3) === 0 ? { point: gen.nextInt(demo.state.grid.size) } : {}),
    ...(gen.nextInt(4) === 0 ? { hit: pick(foes) } : {}),
    ...(gen.nextInt(4) === 0 ? { subject: gen.pick(['door', 'chest', 'lever']) } : {}),
    ...(gen.nextInt(5) === 0 ? { rollAs: 'actor' as const } : {}),
    ...(gen.nextInt(4) === 0 ? { counts: { hitPointsTaken: gen.nextInt(3), hitPointsDealt: gen.nextInt(3) } } : {}),
    ...(gen.nextInt(4) === 0 ? { roll: { total: 12, outcome: gen.pick(['successWithGood', 'failureWithBad', 'criticalSuccess'] as const), tags: ['lock'], trait: 'agility' as const } } : {}),
    ...(gen.nextInt(3) === 0 ? { swing: rollDuality(createRng(`${seed}:swing`), { difficulty: 10, modifier: 1 }) } : {}),
    ...(gen.nextInt(4) === 0 ? { lastDamage: { total: 5, types: ['physical' as const] } } : {}),
  };
  const rng = createRng(`${seed}:dice`);
  const player = createRng(`${seed}:player`);
  rec.rng = rng;
  const world = demo.world;
  const start = startOf(demo);
  const content = contentOf(world, demo.project, demo.project.code);
  const runner = new ScriptRunner(recorded(world), rng, options);
  const steps: unknown[] = [];
  const hookSteps: unknown[][] = [];
  const changed: unknown[] = [];
  let was = standing(demo);
  let status: RunStatus | null = null;
  let seen = 0;
  for (let step = 0; step < 14; step++) {
    const calls: unknown[] = [];
    const hooks: unknown[] = [];
    rec.calls = calls;
    rec.hooks = hooks;
    let move: Record<string, unknown>;
    try {
      if (status === null || (status.status === 'done' && player.nextInt(8) === 0)) {
        move = { act: 'run' };
        status = runner.run(effects);
      } else if (status.status === 'done') {
        move = { act: 'resume', response: { kind: 'continue' } };
        try {
          runner.resume({ kind: 'continue' });
          move['threw'] = false;
        } catch {
          move['threw'] = true;
        }
      } else {
        const response = answer(status.prompt, player);
        move = { act: 'resume', response };
        status = runner.resume(response);
      }
    } finally {
      rec.calls = null;
      rec.hooks = null;
    }
    hookSteps.push(hooks);
    const now = standing(demo);
    changed.push(changes(was, now));
    was = now;
    steps.push({
      move,
      calls,
      status: statusJson(status, seen),
      after: rng.save(),
      flags: { spotlightToGm: runner.spotlightToGm, rolled: runner.rolled, cancelled: runner.cancelled, vaulted: runner.vaulted, lastActionRoll: clone(runner.lastActionRoll) },
    });
    seen = status.journal.length;
    if (status.status === 'done' && (move['act'] === 'resume' || player.nextInt(4) > 0)) break;
  }
  const end = { damaged: world.drainDamage(), entered: world.drainEntered() };
  // One probed run in four is told the stories first.
  const told = Number(seed.split(':')[1]) % 4 === 0;
  const probe = probed ? { calls: probes(demo, world, seed, told), after: { scene: demo.state.snapshot(), scenario: scenarioSnapshot(demo.scenario) } } : null;
  return { run: { source, seed, options: clone(options), effects: clone(effects), steps }, world: { start, content, hooks: hookSteps, changed, end, probe } };
}

function golden() {
  const all = scripts(buildDemoScene(hollowVaultMap(), 'the script list'));
  const played = all.flatMap(({ source, effects }, i) => [0, 1, 2, 3].map((k) => play(source, effects, `runner:${i}:${k}`)));
  // The worlds the runs began in, and the content they were played with, are a handful between them: kept
  // once each, by what they hold.
  const kept = { grids: new Map<string, unknown>(), starts: new Map<string, unknown>(), contents: new Map<string, unknown>() };
  const key = (into: Map<string, unknown>, value: unknown): string => {
    const id = createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);
    into.set(id, value);
    return id;
  };
  const worldRuns = played.map(({ run, world: { start, content, hooks, changed, end, probe } }) => {
    const { grid, ...rest } = start;
    return { source: run.source, seed: run.seed, grid: key(kept.grids, grid), start: key(kept.starts, rest), content: key(kept.contents, content), hooks, changed, end, probe };
  });
  return {
    runner: { about: 'src/engine/script/runner.ts run for the Rust port; written by src/engine/script/runner.golden.test.ts', runs: played.map((p) => p.run) },
    world: {
      about: 'src/engine/script/world.ts under the same runs, for the Rust port; written by src/engine/script/runner.golden.test.ts',
      grids: Object.fromEntries(kept.grids),
      starts: Object.fromEntries(kept.starts),
      contents: Object.fromEntries(kept.contents),
      runs: worldRuns,
    },
  };
}

describe('scripts, as the Rust server must run them', () => {
  it('are what server/fixtures/runner.json and world.json hold', () => {
    const now = clone(golden());
    for (const [path, value] of [[FIXTURE, now.runner], [WORLD_FIXTURE, now.world]] as const) {
      if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(path)) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
      }
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(value);
    }
  }, 120_000);
});
