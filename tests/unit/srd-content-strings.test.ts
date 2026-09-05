/**
 * Fidelity tests against the *real* vendored SRD content in `tools/srd-sources/`.
 *
 * The rules core is unit-tested on synthetic input; this file makes sure the
 * parsers actually swallow every string the shipped content contains, so a gap
 * shows up here rather than as a silently skipped adversary at import time.
 *
 * These read the repo from disk, which is why they live under `tests/unit/`
 * rather than beside the engine modules.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseDice } from '../../src/engine/rules/dice';
import { parseThresholds } from '../../src/engine/rules/damage';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(repoRoot + relativePath, 'utf8')) as T;
}

interface SeansboxAdversary {
  name: string;
  damage?: string;
  atk?: string;
  hp?: string;
  stress?: string;
  difficulty?: string;
  thresholds?: string;
  tier?: string;
  type?: string;
}

const adversaries = readJson<SeansboxAdversary[]>('tools/srd-sources/seansbox/adversaries.json');

describe('vendored SRD content is machine-readable', () => {
  it('ships the adversaries the research notes counted', () => {
    expect(adversaries.length).toBe(129);
  });

  it('parses every adversary damage string', () => {
    const failures: string[] = [];
    for (const a of adversaries) {
      if (a.damage === undefined) continue;
      if (parseDice(a.damage) === null) failures.push(`${a.name}: ${JSON.stringify(a.damage)}`);
    }
    expect(failures).toEqual([]);
  });

  it('finds both damage types across the adversary roster, including dual-typed', () => {
    const seen = new Set<string>();
    for (const a of adversaries) {
      const parsed = a.damage === undefined ? null : parseDice(a.damage);
      if (parsed?.types !== undefined) seen.add([...parsed.types].sort().join('+'));
    }
    expect(seen.has('physical')).toBe(true);
    expect(seen.has('magic')).toBe(true);
    expect(seen.has('magic+physical')).toBe(true);
  });

  it('parses every adversary threshold string', () => {
    const failures: string[] = [];
    for (const a of adversaries) {
      if (a.thresholds === undefined) continue;
      const parsed = parseThresholds(a.thresholds);
      if (parsed === null) failures.push(`${a.name}: ${JSON.stringify(a.thresholds)}`);
    }
    expect(failures).toEqual([]);
  });

  it('gives every Minion a thresholdless stat block and a single Hit Point', () => {
    const minions = adversaries.filter((a) => a.type === 'Minion');
    expect(minions.length).toBeGreaterThan(0);
    for (const m of minions) {
      expect(parseThresholds(m.thresholds ?? '')).toEqual({ major: Infinity, severe: Infinity });
      expect(m.hp).toBe('1');
    }
  });

  it('parses every adversary attack modifier, including the dice-valued one', () => {
    const failures: string[] = [];
    let diceValued = 0;
    for (const a of adversaries) {
      if (a.atk === undefined) continue;
      const parsed = parseDice(a.atk);
      if (parsed === null) {
        failures.push(`${a.name}.atk: ${JSON.stringify(a.atk)}`);
        continue;
      }
      if (parsed.count > 0) diceValued++;
    }
    expect(failures).toEqual([]);
    // The Outer Realms Abomination's "+2d4" — the one stat block that rolls its ATK.
    expect(diceValued).toBe(1);
  });

  it('parses every adversary HP, Stress, Difficulty and Tier as a plain number', () => {
    const numeric: (keyof SeansboxAdversary)[] = ['hp', 'stress', 'difficulty', 'tier'];
    const failures: string[] = [];
    for (const a of adversaries) {
      for (const field of numeric) {
        const raw = a[field];
        if (raw === undefined) continue;
        if (!/^\s*\d+\s*$/.test(String(raw))) {
          failures.push(`${a.name}.${String(field)}: ${JSON.stringify(raw)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

interface DaggersearchArmor {
  id: string;
  baseMajorThreshold: number;
  baseSevereThreshold: number;
  baseScore: number;
}

describe('vendored armor data matches the threshold rules', () => {
  const armors = readJson<DaggersearchArmor[]>('tools/srd-sources/daggersearch/core/armors.json');

  it('gives every armor a Severe threshold above its Major threshold', () => {
    expect(armors.length).toBeGreaterThan(0);
    for (const armor of armors) {
      expect(armor.baseSevereThreshold).toBeGreaterThan(armor.baseMajorThreshold);
      expect(armor.baseScore).toBeGreaterThanOrEqual(0);
    }
  });
});
