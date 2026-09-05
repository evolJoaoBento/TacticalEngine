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
import { importSeansboxAdversaries } from '../../src/engine/content/srd/seansbox-adversaries';

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
  experience?: string;
  feature?: { name?: string; text?: string }[];
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

describe('the adversary importer swallows the whole vendored roster', () => {
  const { defs, issues } = importSeansboxAdversaries(adversaries);

  it('imports all 129 with no issues at all', () => {
    // The issue list is printed on failure, so a content shape the importer
    // cannot read names itself here.
    expect(issues).toEqual([]);
    expect(defs).toHaveLength(adversaries.length);
  });

  it('gives every adversary a unique, non-empty id', () => {
    const ids = defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('imports every feature of every adversary', () => {
    const rawFeatures = adversaries.reduce((n, a) => n + (a.feature?.length ?? 0), 0);
    const importedFeatures = defs.reduce((n, d) => n + d.features.length, 0);
    expect(importedFeatures).toBe(rawFeatures);
    expect(importedFeatures).toBeGreaterThan(400);
  });

  it('imports every Experience of every adversary', () => {
    // parseExperiences reports what it cannot read, and the importer turns that
    // into an issue — but this counts the parts directly so a silently halved
    // list would still fail.
    const rawParts = adversaries.reduce(
      (n, a) => n + (a.experience ?? '').split(',').filter((p) => p.trim() !== '').length,
      0,
    );
    const imported = defs.reduce((n, d) => n + d.experiences.length, 0);
    expect(imported).toBe(rawParts);
    expect(imported).toBeGreaterThan(80);
  });

  it('lifts the parenthetical off the SRD passives that carry one', () => {
    const byName = (name: string) =>
      defs.flatMap((d) => d.features).filter((f) => f.name === name);

    // Relentless (X) = spotlights per GM turn; Minion (X) = damage per extra kill;
    // Horde (X) = the damage the standard attack switches to at half HP.
    for (const name of ['Relentless', 'Minion', 'Horde']) {
      const features = byName(name);
      expect(features.length).toBeGreaterThan(0);
      for (const f of features) expect(f.parameter).toBeTruthy();
    }
    expect(byName('Horde').some((f) => /d/.test(f.parameter ?? ''))).toBe(true);
  });

  it('covers every role and tier the roster uses', () => {
    expect(new Set(defs.map((d) => d.role))).toEqual(
      new Set([
        'solo',
        'bruiser',
        'social',
        'skulk',
        'horde',
        'minion',
        'standard',
        'ranged',
        'leader',
        'support',
      ]),
    );
    expect([...new Set(defs.map((d) => d.tier))].sort()).toEqual([1, 2, 3, 4]);
  });

  it('finds the Fear features the GM has to pay for', () => {
    const fearFeatures = defs.flatMap((d) => d.features).filter((f) => f.costsFear);
    expect(fearFeatures.length).toBeGreaterThan(50);
  });

  it('carries the Tangle Bramble the legacy one-shot uses', () => {
    // docs/research/legacy-campaign.md: the arena fight is a Tangle Bramble Swarm.
    const swarm = defs.find((d) => d.id === 'tangle-bramble-swarm');
    expect(swarm).toBeDefined();
    expect(swarm!.role).toBe('horde');
    expect(swarm!.hordeUnitsPerHp).toBe(3);

    const bramble = defs.find((d) => d.id === 'tangle-bramble');
    expect(bramble!.role).toBe('minion');
    expect(bramble!.hitPoints).toBe(1);
    expect(bramble!.thresholds).toEqual({ major: Infinity, severe: Infinity });
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
