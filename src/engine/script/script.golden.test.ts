/**
 * The effect vocabulary as the Rust server must read it (`docs/SERVER.md`, phase 2): target selectors,
 * conditions and effects, what zod lets in and puts in, and - path for path, word for word - what it says
 * about what it turns away. The corpus is every selector, condition and effect the shipped content and the
 * default project carry, and one of every kind written here, since the content leaves some out; samples
 * of each kind are then broken at every field two levels down, twelve ways. Beside that, the walks that
 * visit every effect and condition inside a script.
 * `UPDATE_GOLDEN=1 npx vitest run src/engine/script/script.golden.test.ts` writes
 * `server/fixtures/script.json` afresh; `server/engine/tests/golden_script.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../content/pack/starter';
import {
  checkRequestSchema, choiceOptionSchema, conditionSchema, effectSchema, targetSelectorSchema,
  walkConditionsIn, walkConditionsInCheck, walkEffects, type CheckRequest, type Effect,
} from './schema';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '../../../server/fixtures/script.json');

const SCHEMAS: Record<string, z.ZodType> = { target: targetSelectorSchema, condition: conditionSchema, effect: effectSchema, check: checkRequestSchema, option: choiceOptionSchema };

const t = { kind: 'target' };
const flag = { kind: 'flag', flag: 'f' };
const log = { kind: 'log', text: 'x' };

/** One of every kind, most with their optional fields, some written twice to reach both sides of a union. */
const WRITTEN: Record<string, unknown[]> = {
  target: [
    { kind: 'actor' }, { kind: 'party' }, { kind: 'entity', id: 'kara' }, { kind: 'entities', ids: ['a', 'b'] }, t,
    { kind: 'hit', having: 'bramble', nearest: 2 },
    { kind: 'allies', range: 'close', around: 'point', includeSelf: true, except: 'target', nearest: 1 },
    { kind: 'inPath', range: 'far', reach: 'weapon', side: 'allies' },
    { kind: 'adversaries', range: 'veryClose', reach: 'weapon', around: 'target', except: 'actor', nearest: 3, sameKind: true },
  ],
  condition: [
    { kind: 'always' }, { kind: 'never' }, { kind: 'not', of: flag }, { kind: 'all', of: [flag, { kind: 'always' }] }, { kind: 'any', of: [] },
    { kind: 'count', of: 'spent', op: '>=', value: 2 }, flag, { kind: 'hasKey', key: 'k' }, { kind: 'hasItem', item: 'rope', quantity: 2 },
    { kind: 'var', name: 'v', op: '==', value: null }, { kind: 'var', name: 'v', op: '<', value: 3.5 }, { kind: 'var', name: 'v', op: '!=', value: 'x' },
    { kind: 'interactable', id: 'door', state: 'open' }, { kind: 'encounter', id: 'e', state: 'triggered' },
    { kind: 'quest', quest: 'q', status: 'inactive' }, { kind: 'objectiveDone', quest: 'q', objective: 'o' },
    { kind: 'partyAlive', op: '>', value: 0 }, { kind: 'adversariesAlive', op: '<=', value: 1 },
    { kind: 'pool', pool: 'stress', of: t, measure: 'marked', op: '>=', value: 3 }, { kind: 'rolled', is: 'withBad' }, { kind: 'rollTagged', tag: 'lock' },
    { kind: 'hasMark', mark: 'm' }, { kind: 'rolledWith', trait: 'weapon' },
    { kind: 'chance', dice: 'd6', atLeast: 5, times: { trait: 'spellcast', of: t, times: 2 } },
    { kind: 'chance', dice: 'd6', atLeast: 5, times: { pool: 'good' } },
    { kind: 'chance', dice: 'd6', atLeast: 5, times: { count: { kind: 'hit' } } },
    { kind: 'chance', dice: 'd6', atLeast: 5, times: { dice: '2d4', using: 'proficiency', pick: 'highest' } },
    { kind: 'chance', dice: 'd6', atLeast: 5, times: { tokens: 'ward', of: t } }, { kind: 'chance', dice: 'd6', atLeast: 5, times: 'targetsHit' },
    { kind: 'inCombat' }, { kind: 'loadout', domain: 'sage', of: t, op: '==', value: 2 },
    { kind: 'nearby', of: { kind: 'allies' }, op: '>', value: { pool: 'hitPoints', of: t, measure: 'max' } }, { kind: 'nearby', of: { kind: 'party' }, op: '>', value: 1 },
    { kind: 'tokens', ability: 'ward', of: t, op: '>=', value: 3 }, { kind: 'hasCondition', condition: 'hidden', of: t },
    { kind: 'self', of: t }, { kind: 'side', of: t, is: 'ally' }, { kind: 'withinRange', range: 'melee', of: t },
    { kind: 'hook', hook: 'h', args: { a: 1, b: 'x', c: true } },
  ],
  effect: [
    { kind: 'none' }, { kind: 'log', text: 'x', tone: 'combat' }, { kind: 'story', title: 'T', paragraphs: ['a', ''], button: 'On' },
    { kind: 'setFlag', flag: 'f' }, { kind: 'clearFlag', flag: 'f' }, { kind: 'giveKey', key: 'k' },
    { kind: 'addItem', item: 'rope', quantity: 2 }, { kind: 'removeItem', item: 'rope' },
    { kind: 'setVar', name: 'v', value: false }, { kind: 'addVar', name: 'v', by: -0.5 },
    { kind: 'open', interactable: 'door' }, { kind: 'close' }, { kind: 'toggleOpen', interactable: 'door' }, { kind: 'openContainer' },
    { kind: 'teleport', pair: 'p' }, { kind: 'remove' }, { kind: 'markUsed', interactable: 'lever' }, { kind: 'loot', table: 'chest' },
    { kind: 'damage', amount: 3, type: 'magic', using: 'halfProficiency', direct: true, half: true, target: t, source: 'fire' },
    { kind: 'damage', dice: '2d6' }, { kind: 'heal', dice: 'd4', spread: true, target: t }, { kind: 'heal', amount: 'hitPointsTaken' },
    { kind: 'startEncounter', encounter: 'e', intro: 'Go' }, { kind: 'endEncounter', encounter: 'e' }, { kind: 'goto', scene: 's' },
    { kind: 'startDialogue', dialogue: 'd' }, { kind: 'startQuest', quest: 'q' }, { kind: 'completeObjective', quest: 'q', objective: 'o' },
    { kind: 'completeQuest', quest: 'q' }, { kind: 'revealObjective', quest: 'q', objective: 'o' }, { kind: 'failQuest', quest: 'q' },
    { kind: 'levelUp', level: 3 }, { kind: 'branch', when: flag, then: [log], otherwise: [] },
    { kind: 'choice', title: 'T', body: 'B', options: [{ label: 'A', detail: 'd', available: flag, effects: [log] }, { label: 'B' }] },
    { kind: 'check', check: { trait: 'spellcast', difficulty: 'target', roll: 'last', targets: t, tags: ['lock'], prompt: 'P', onCriticalSuccess: [log], onSuccessWithGood: [], onSuccessWithBad: [log], onFailureWithGood: [], onFailureWithBad: [log], always: [log] } },
    { kind: 'markStress', amount: { dice: 'd4' }, target: t }, { kind: 'clearStress' }, { kind: 'clearArmor', amount: 1, target: t }, { kind: 'markArmor' },
    { kind: 'gainBad', amount: 2 }, { kind: 'loseBad' }, { kind: 'gainGood', amount: 1, target: t }, { kind: 'spendGood', amount: 'spent' }, { kind: 'loseGood', target: t },
    { kind: 'applyCondition', condition: 'vulnerable', duration: 'scene', target: t }, { kind: 'clearCondition', condition: 'hidden', target: t },
    { kind: 'revive', target: t }, { kind: 'slay' }, { kind: 'openShop', of: 'smith' }, { kind: 'setAttitude', attitude: 'hostile', target: t },
    { kind: 'attack', weapon: 'secondary', by: 'target', target: t, advantage: -1, damageBonus: 2, damageDice: 'd8', damage: '2d6+2', range: 'far', direct: true, joinedBy: { kind: 'allies' }, onHit: [log], onMiss: [] },
    { kind: 'addToken', ability: 'ward', amount: { trait: 'knowledge' }, target: t }, { kind: 'spendToken', ability: 'ward', amount: 1, all: true, target: t },
    { kind: 'push', to: 'close', target: t }, { kind: 'summon', adversary: 'rat', count: 'd4', perPc: true, range: 'close', spotlight: true },
    { kind: 'replace', adversary: 'rat', count: '2', spotlight: false },
    { kind: 'move', who: t, teleport: true, how: 'away', of: { kind: 'actor' }, to: 'mark', mark: 'spot', range: 'far', budget: 'close' },
    { kind: 'spotlight', targets: { kind: 'allies' }, count: '2', halfDamage: true },
    { kind: 'boostDamage', dice: 'd6', amount: 2, times: { tokens: 'ward' }, double: true, type: 'physical' }, { kind: 'rerollDamage', below: 3 },
    { kind: 'nameRoll' }, { kind: 'raiseRoll', amount: { trait: 'presence' } }, { kind: 'markSpot', mark: 'm' }, { kind: 'forgetSpot', mark: 'm' },
    { kind: 'rerollDuality' }, { kind: 'rerollDuality', which: 'good' }, { kind: 'softenBlow', dice: 'd6', amount: 2 }, { kind: 'avoidBlow' },
    { kind: 'stepSeverity', steps: 2 }, { kind: 'dodgeBy', amount: 3 },
    { kind: 'diceCheck', dice: 'd6', times: 3, atLeast: 4, needed: 2, then: [log], otherwise: [log] },
    { kind: 'forceHitPoints', amount: 1 }, { kind: 'forceSeverity', severity: 'major', least: true },
    { kind: 'howMany', most: { pool: 'good' }, least: 0, title: 'T', body: 'B', each: [log] },
    { kind: 'endSpotlight' }, { kind: 'spotlightAgain' }, { kind: 'vaultCard' }, { kind: 'maxOneDie' },
    { kind: 'zone', zone: 'z', name: 'Z', condition: 'burning', at: 'actor', band: 'veryClose', side: 'adversaries', onDeath: 'keep', value: 0, grows: { by: 1, until: 3 } },
    { kind: 'endZone', zone: 'z' },
    { kind: 'countdown', countdown: 'c', name: 'C', start: 'd6', advance: 'withBad', loop: 'increasing', onDeath: 'trigger' },
    { kind: 'run', hook: 'h', args: { n: 2 } },
    { kind: 'reactionRoll', difficulty: 'roll', trait: 'agility', targets: t, damage: { dice: '2d6', type: 'physical' }, onFail: [log], onSuccess: [] },
  ],
};

function isKind(value: unknown): value is Record<string, unknown> & { kind: string } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as { kind?: unknown }).kind === 'string';
}

/** Every selector, condition and effect in the content the engine reads, as written, once each. */
function corpus(): Record<string, unknown[]> {
  const found: Record<string, Map<string, unknown>> = { target: new Map(), condition: new Map(), effect: new Map() };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== 'object') return;
    if (isKind(value)) {
      for (const [name, schema] of Object.entries({ target: targetSelectorSchema, condition: conditionSchema, effect: effectSchema })) {
        if (schema.safeParse(value).success) found[name]!.set(JSON.stringify(value), value);
      }
    }
    Object.values(value).forEach(walk);
  };
  walk(JSON.parse(readFileSync(resolve(HERE, '../content/pack/shipped/srd-characters.json'), 'utf8')));
  walk(JSON.parse(readFileSync(resolve(HERE, '../../../projects/default.json'), 'utf8')));
  walk(JSON.parse(JSON.stringify(STARTER_ABILITIES)));
  walk(JSON.parse(JSON.stringify(STARTER_CONDITIONS)));
  return Object.fromEntries(Object.entries(found).map(([name, map]) => [name, [...map.values()]]));
}

type Path = (string | number)[];

function placesIn(value: unknown, depth = 0, at: Path = []): Path[] {
  if (depth > 2 || value === null || typeof value !== 'object') return [];
  const places: Path[] = [];
  if (Array.isArray(value)) {
    if (value.length > 0) places.push([...at, 0], ...placesIn(value[0], depth + 1, [...at, 0]));
    return places;
  }
  for (const [key, inner] of Object.entries(value)) places.push([...at, key], ...placesIn(inner, depth + 1, [...at, key]));
  return places;
}

const BREAKS: unknown[] = ['delete', null, 'zzz', 7, true, [], {}, '', -1, 1.5, 2 ** 60, 'Bad-Id'];

function broken(entry: unknown, path: Path, change: unknown): unknown {
  // Through JSON, not structuredClone: a sample written here may share an object between two places, and
  // breaking one must not break the other - the fixture's JSON holds them apart.
  const copy = JSON.parse(JSON.stringify(entry)) as Record<string | number, unknown>;
  let parent: Record<string | number, unknown> = copy;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if (change === 'delete') {
    if (Array.isArray(parent)) parent.splice(last as number, 1);
    else delete parent[last];
  } else parent[last] = structuredClone(change);
  return copy;
}

function verdict(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? { ok: result.data } : { issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) };
}

function golden() {
  const found = corpus();
  const all = Object.fromEntries(Object.keys(found).map((name) => [name, [...WRITTEN[name]!, ...found[name]!]]));
  const entries = Object.entries(all).map(([schema, values]) => ({ schema, cases: values.map((value) => ({ value, ...verdict(SCHEMAS[schema]!, value) })) }));

  // Of each kind, the one written here and the longest the content has: broken everywhere.
  const breaks = Object.entries(all).map(([schema, values]) => {
    const byKind = new Map<string, unknown[]>();
    for (const value of values) if (isKind(value)) byKind.set(value.kind, [...(byKind.get(value.kind) ?? []), value]);
    const samples = [...byKind.values()].flatMap((list) => {
      const longest = [...list].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
      return [...new Set([list[0], longest])];
    });
    return {
      schema,
      samples: samples.map((sample) => ({
        sample,
        cases: placesIn(sample).flatMap((path) => BREAKS.map((change) => ({ path, change, ...verdict(SCHEMAS[schema]!, broken(sample, path, change)) }))),
      })),
    };
  });

  const corners: { schema: string; value: unknown }[] = [
    { schema: 'effect', value: { kind: 'damage' } },
    { schema: 'effect', value: { kind: 'damage', amount: 1, dice: 'd4' } },
    { schema: 'effect', value: { kind: 'heal', amount: 0, dice: '' } },
    { schema: 'effect', value: { kind: 'damage', amount: 'lots', target: { kind: 'nobody' } } },
    { schema: 'effect', value: { kind: 'nope' } },
    { schema: 'effect', value: { kind: 'run', hook: 'h', args: { '': 1, b: null, c: [], d: 2 } } },
    { schema: 'effect', value: { kind: 'run', hook: 'h', args: [] } },
    { schema: 'effect', value: { kind: 'setVar', name: 'v', value: [] } },
    { schema: 'effect', value: { kind: 'branch', when: { kind: 'not', of: { kind: 'all', of: [{ kind: 'flag' }, { kind: 'x' }] } }, then: [{ kind: 'log' }, { kind: 'branch', when: { kind: 'never' }, then: [{ kind: 'damage', amount: 1.5 }] }] } },
    { schema: 'effect', value: { kind: 'choice', options: [{ label: '', effects: [{ kind: 'nope' }] }, { label: 'ok', available: { kind: 'never' } }] } },
    { schema: 'effect', value: { kind: 'check', check: { trait: 'luck', difficulty: 0, onFailureWithBad: [{ kind: 'gainBad', amount: -2 }] } } },
    { schema: 'effect', value: { kind: 'countdown', countdown: 'c', name: 'C', start: 'd6', effects: [{ kind: 'countdown' }] } },
    { schema: 'effect', value: { kind: 'levelUp', level: 11 } },
    { schema: 'effect', value: { kind: 'zone', zone: 'z', name: 'Z', condition: 'c', band: 'far', grows: { by: 0 } } },
    { schema: 'effect', value: { kind: 'reactionRoll', difficulty: 0 } },
    { schema: 'effect', value: { kind: 'boostDamage', times: { pool: 'luck', of: { kind: 'hit', nearest: 0 } } } },
    { schema: 'condition', value: { kind: 'hook', hook: 'h', args: { __proto__: 1, ok: 2 } } },
    { schema: 'condition', value: { kind: 'nearby', of: { kind: 'party' }, op: '~', value: { pool: 'good', measure: 'most' } } },
    { schema: 'condition', value: { kind: 'var', name: 'v', op: '==', value: { a: 1 } } },
    { schema: 'condition', value: { kind: 'chance', dice: 'd6', atLeast: 1, times: { dice: 'd4', pick: 'lowest' } } },
    { schema: 'target', value: { kind: 'entities', ids: ['a', '', 3] } },
    { schema: 'target', value: { kind: 'adversaries' } },
    { schema: 'option', value: { label: 'x', effects: [{ kind: 'none', junk: 1 }], junk: 2 } },
  ].map(({ schema, value }) => ({ schema, value: JSON.parse(JSON.stringify(value)) as unknown }));
  // A key JSON can hold that an object literal cannot write: an own `__proto__`, dropped by zod's record.
  corners.push({ schema: 'condition', value: JSON.parse('{"kind":"hook","hook":"h","args":{"__proto__":1,"ok":2}}') as unknown });

  const walks = (all['effect'] as Effect[]).filter((e) => effectSchema.safeParse(e).success).map((raw) => {
    const effect = effectSchema.parse(raw);
    const kinds: string[] = [];
    walkEffects([effect], (e) => kinds.push(e.kind));
    const conditions: string[] = [];
    walkConditionsIn([effect], (c) => conditions.push(c.kind));
    const inCheck: string[] = [];
    if (effect.kind === 'check') walkConditionsInCheck(effect.check as CheckRequest, (c) => inCheck.push(c.kind));
    return { effect, kinds, conditions, inCheck };
  });

  return {
    about: 'src/engine/script schemas read for the Rust port; written by src/engine/script/script.golden.test.ts',
    entries,
    breaks,
    corners: corners.map(({ schema, value }) => ({ schema, value, ...verdict(SCHEMAS[schema]!, value) })),
    walks,
  };
}

describe('the effect vocabulary, as the Rust server must read it', () => {
  it('is what server/fixtures/script.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
