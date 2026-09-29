/**
 * Scripts run as the Rust server must run them (`docs/SERVER.md`, phase 2).
 *
 * The runner walks effect lists, stops for the player and resumes with their answer, and asks the world
 * for everything else - reads and writes alike. The world is not ported yet, so this runs every script in
 * the game's own demo scene (its party, adversaries, cards, conditions and project hooks) and tapes every
 * call the runner makes on the world, in order, with the world's answer; and, since the world draws from
 * the runner's dice stream when it is handed it, where that stream stood after. A hook the runner calls
 * is taped as what it was handed and what it queued: running it is the world's, and hooks' own part.
 *
 * The scripts are every ability's in the demo project and the shipped SRD pack, and a set written here for
 * the corners the content leaves out; each is run under options drawn off a seeded stream (who acts, who
 * and where it is aimed at, what it answers) by a player who mostly answers straight and sometimes
 * declines, resumes with nothing waiting, or runs the runner again.
 * `UPDATE_GOLDEN=1 npx vitest run src/engine/script/runner.golden.test.ts` writes
 * `server/fixtures/runner.json`; `server/engine/tests/golden_runner.rs` replays it.
 */

import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../core/rng';
import { rollDuality } from '../rules/duality';
import { buildDemoScene, refreshWorld } from '../../game/demo-scene';
import { characterContentFor } from '../../game/room';
import { deriveCharacter } from '../character/sheet';
import { abilitySchema } from '../content/abilities';
import { cardDefSchema } from '../content/pack/schema';
import { hollowVaultMap } from '../../game/demo-map';
import { startEncounter } from '../../game/movement';
import { ScriptRunner, type Prompt, type Response, type RunStatus, type ScriptRunnerOptions, type ScriptWorld } from './runner';
import { effectSchema, type Effect } from './schema';

const rec = vi.hoisted(() => ({ depth: 0, calls: null as unknown[] | null, rng: null as unknown }));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

vi.mock('./hooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('./hooks')>();
  const runHook: typeof original.runHook = (fn, context) => {
    if (rec.calls === null || rec.depth > 0) return original.runHook(fn, context);
    rec.depth++;
    try {
      const reads = context as unknown as Record<string, unknown> & { rng?: Rng; queue?: (e: unknown[]) => void; log?: (t: string, tone?: string) => void };
      const seen = { args: clone(reads['args']), actor: reads['actor'], targets: clone(reads['targets']), hit: clone(reads['hit']), inCombat: reads['inCombat'] };
      if (reads.queue === undefined) {
        const result = original.runHook(fn, context);
        rec.calls.push({ call: 'runHook', ...seen, answer: result.ok && result.value === true });
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
      rec.calls.push({ call: 'runHookEffect', ...seen, lastRoll: clone(reads['lastRoll']), ok: result.ok, message: result.ok ? '' : result.message, queued, after: reads.rng!.save() });
      return result;
    } finally {
      rec.depth--;
    }
  };
  return { ...original, runHook };
});

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/runner.json');

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

const log = { kind: 'log', text: 'x' };
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
  const runner = new ScriptRunner(recorded(demo.world), rng, options);
  const steps: unknown[] = [];
  let status: RunStatus | null = null;
  let seen = 0;
  for (let step = 0; step < 14; step++) {
    const calls: unknown[] = [];
    rec.calls = calls;
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
    }
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
  return { source, seed, options: clone(options), effects: clone(effects), steps };
}

function golden() {
  const all = scripts(buildDemoScene(hollowVaultMap(), 'the script list'));
  const runs = all.flatMap(({ source, effects }, i) => [0, 1, 2, 3].map((k) => play(source, effects, `runner:${i}:${k}`)));
  return { about: 'src/engine/script/runner.ts run for the Rust port; written by src/engine/script/runner.golden.test.ts', runs };
}

describe('scripts, as the Rust server must run them', () => {
  it('are what server/fixtures/runner.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  }, 120_000);
});
