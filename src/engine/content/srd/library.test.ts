import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRng } from '../../core/rng';
import { TileGrid } from '../../grid/grid';
import { SRD_ADVERSARIES } from '../../../game/demo-scene';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../../scene/state';
import { blankScene } from '../../scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../../scene/schema';
import { validateProject } from '../../../editor/validate';
import { SceneScriptWorld, createScenarioState } from '../../script/world';
import { ScriptRunner } from '../../script/runner';
import type { Effect } from '../../script/schema';
import { blankSheet, deriveCharacter, startingPools, type DerivedCharacter } from '../../character/sheet';
import { importCharacterContent } from './daggersearch';
import type { AdversaryDef } from '../types';
import { isScripted, readsATarget, type AbilityDef } from '../abilities';
import { SRD_CONDITIONS } from '../conditions';
import { SRD_ABILITIES } from './abilities';
import { SRD_HOOKS } from './hooks';
import { SRD_ADVERSARY_ABILITIES } from './adversary-abilities';
import { importSeansboxAdversaries, type RawAdversary } from './seansbox-adversaries';

/**
 * The library as a whole, rather than one card at a time.
 *
 * Two questions no per-card test asks. First, structurally: does every card
 * name hooks and conditions that exist, and does every card that reads "the
 * chosen target" actually ask the player for one? Second, in play: stand a
 * party in a fight and run every scripted card — does any of them refuse?
 *
 * A refusal in the fixture below is a bug unless it is in `EXPECTED_REFUSALS`
 * with the reason, and that list is short on purpose.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (name: string): unknown[] =>
  JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/daggersearch/core/${name}.json`, 'utf8'));
const content = importCharacterContent({
  weapons: read('weapons'),
  armors: read('armors'),
  classes: read('classes'),
  ancestries: read('ancestries'),
  communities: read('communities'),
  subclasses: read('subclasses'),
  domainCards: read('domain-cards'),
}).content;

const EVERY: readonly AbilityDef[] = [...SRD_ABILITIES, ...SRD_ADVERSARY_ABILITIES];

/** Whether anything in a script reads "the one the player picked". */
const needsAPick = (effects: readonly Effect[]): boolean => readsATarget(effects);

describe('the shipped library, structurally', () => {
  it('names only hooks and conditions that exist', () => {
    const project = projectSchema.parse({
      id: 'library',
      name: 'Library',
      scenes: [sceneSchema.parse(blankScene('room', 8, 8))],
      startScene: 'room',
      abilities: EVERY,
      conditionDefs: SRD_CONDITIONS,
    });
    expect(validateProject(project, { knownHooks: new Set(SRD_HOOKS.keys()) })).toEqual([]);
  });

  it('asks the player for a target whenever a card reads one', () => {
    // An adversary's feature is aimed by whoever plays the stat block, so its
    // `target` describes reach rather than a prompt.
    const wrong = EVERY.filter(
      (a) => a.source.kind !== 'adversary' && needsAPick(a.effects) && a.target.kind === 'none',
    ).map((a) => a.id);
    expect(wrong).toEqual([]);
  });

  it('sources every stat-block feature to an adversary that exists', () => {
    // A feature filed under a misspelled block is a feature nobody ever plays,
    // and nothing else in the suite would notice.
    const known = new Set(
      importSeansboxAdversaries(
        JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/seansbox/adversaries.json`, 'utf8')) as RawAdversary[],
      ).defs.map((def) => def.id),
    );
    const missing: string[] = [];
    for (const ability of EVERY) {
      if (ability.source.kind !== 'adversary') continue;
      for (const id of ability.source.adversaries) if (!known.has(id)) missing.push(`${ability.id} -> ${id}`);
    }
    expect(missing).toEqual([]);
  });

  it('leaves no scripted reaction without a trigger', () => {
    for (const ability of EVERY) {
      if (!isScripted(ability) || ability.kind !== 'reaction') continue;
      expect(ability.trigger, ability.id).toBeDefined();
    }
  });
});

/** Cards that legitimately refuse in the fixture below, and why. */
const EXPECTED_REFUSALS: ReadonlyMap<string, string> = new Map([
  ['inspirational-words', 'no tokens on the card until a long rest places them'],
  ['restoration', 'no tokens on the card until a long rest places them'],
  ['unleash-chaos', 'no tokens on the card until a session places them'],
  ['spellcharge', 'no tokens on the card until a wound charges it'],
  ['minor-chaos-elemental-magical-reflection', 'nothing to reflect until a blow has landed on the Elemental'],
  ['share-the-burden', 'nobody in the fixture is carrying Stress to take on'],
]);

const husk = (id: string, difficulty: number): AdversaryDef => ({
  id,
  name: id,
  tier: 1,
  role: 'standard',
  description: '',
  motivesAndTactics: '',
  difficulty,
  thresholds: { major: 7, severe: 12 },
  hitPoints: 8,
  stress: 3,
  attackName: 'Claws',
  attackModifier: { count: 0, sides: 0, modifier: 1 },
attackRange: 'melee',
  attackDamage: { count: 1, sides: 6, modifier: 2, types: ['physical'] },
  experiences: [],
  features: [],
});

const bandTiles = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

/**
 * A caster with every trait worth having, an ally beside her, and two husks
 * in Melee range — near enough that Melee, Very Close, Close, Far and Very
 * Far all find something, so no card refuses merely for want of a target.
 */
function fixture(): { run: (ability: AbilityDef) => string[]; state: SceneState } {
  const grid = new TileGrid({ width: 14, height: 3 });
  const state = new SceneState({ id: 'corridor' }, grid);
  const sheets = [
    blankSheet('mira', 'wizard', {
      name: 'Mira',
      traits: { agility: 1, strength: 1, finesse: 1, instinct: 1, presence: 1, knowledge: 2 },
      armorId: 'gambeson-armor',
      primaryWeaponId: 'greatstaff',
      subclassId: 'school-of-knowledge',
      domainCards: ['book-of-ava', 'rune-ward'],
      experiences: [{ name: 'Read the runes', modifier: 2 }],
    }),
    blankSheet('kara', 'guardian', {
      name: 'Kara',
      traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
      armorId: 'chainmail-armor',
      primaryWeaponId: 'broadsword',
      subclassId: 'stalwart',
      domainCards: ['bare-bones', 'get-back-up'],
      experiences: [{ name: 'Held the line', modifier: 2 }],
    }),
  ];
  const characters = new Map<string, DerivedCharacter>();
  sheets.forEach((sheet, i) => {
    const derived = deriveCharacter(sheet, content);
    expect(derived.issues).toEqual([]);
    characters.set(sheet.id, derived.character);
    state.addEntity({ ...createPartyEntity(sheet.id, sheet.classId, grid.indexOf(i, 1)), ...startingPools(derived.character) });
  });
  // Every SRD block, not just the fixture's husk: a feature that summons
  // Bladed Guards has to find a Bladed Guard to summon.
  const adversaries = new Map<string, AdversaryDef>([
    ...SRD_ADVERSARIES,
    ['husk', husk('husk', 11)],
  ]);
  state.addEntity(createAdversaryEntity('foe-1', 'husk', grid.indexOf(1, 0), { hitPoints: 8, stress: 3 }));
  state.addEntity(createAdversaryEntity('foe-2', 'husk', grid.indexOf(1, 2), { hitPoints: 8, stress: 3 }));

  const scenario = createScenarioState({}, 'mira');
  const world = new SceneScriptWorld(state, scenario, {
    traits: { agility: 1, strength: 1, finesse: 1, instinct: 1, presence: 1, knowledge: 2 },
    characters,
    adversaries,
    bandTiles,
    inCombat: () => true,
    abilities: EVERY,
    conditionDefs: SRD_CONDITIONS,
    hooks: SRD_HOOKS,
  });

  // One room, every script — so each one starts in the room the last one left
  // unless the fixture puts it back. A dragon's breath would otherwise kill the
  // party halfway down the list and every feature after it would refuse for
  // want of anyone to aim at.
  const fresh = state.snapshot();

  const run = (ability: AbilityDef): string[] => {
    state.restore(fresh);
    // A feature is run by the creature that prints it, aimed at the party —
    // which is the side of the table the `allies` selector reads from, and the
    // only way a stat block's script is exercised as it will actually run.
    const fromBlock = ability.source.kind === 'adversary';
    scenario.actorId = fromBlock ? 'foe-1' : 'mira';
    const runner = new ScriptRunner(world, createRng(`smoke:${ability.id}`), {
      // Kara stands in Melee range of foe-1, so a feature that reaches only
      // that far still has someone to reach.
      targets: fromBlock ? ['kara'] : ability.target.kind === 'ally' ? ['kara'] : ['foe-1'],
      rollAs: 'actor',
    });
    let result = runner.run(ability.effects);
    // A card that asks a question is answered with its first option, until it
    // has nothing left to ask.
    for (let i = 0; i < 8 && result.status === 'waiting'; i++) {
      result = runner.resume(result.prompt.kind === 'choice' ? { kind: 'choose', index: 0 } : { kind: 'continue' });
    }
    return result.journal.filter((e) => e.kind === 'refused').map((e) => e.reason);
  };
  return { run, state };
}

/** One scripted feature by id, or a failure that names it. */
function featureNamed(id: string): AbilityDef {
  const found = SRD_ADVERSARY_ABILITIES.find((a) => a.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

describe("a stat block's own features, played", () => {
  it('takes a Hope from everyone the howl reaches, and none from anyone it does not', () => {
    const { run, state } = fixture();
    const before = state.entity('mira')!.hope!.value;
    expect(run(featureNamed('demonic-hound-pack-dreadhowl'))).toEqual([]);
    // Both of them stand within Very Close of the creature that howled.
    expect(state.entity('mira')!.hope!.value).toBe(before - 1);
    expect(state.entity('kara')!.hope!.value).toBe(before - 1);
    // And the adversaries have no Hope to take, so nothing happened to them.
    expect(state.entity('foe-2')!.hope).toBeUndefined();
  });

  it('takes two Hope with the chorus, which is more than anyone has left after one', () => {
    const { run, state } = fixture();
    expect(run(featureNamed('hydra-terrifying-chorus'))).toEqual([]);
    expect(state.entity('mira')!.hope!.value).toBe(0);
  });
});

describe('the shipped library, in a fight', () => {
  it('runs every scripted card without a refusal', () => {
    const { run } = fixture();
    const refused = new Map<string, string[]>();
    let ran = 0;
    let fromBlocks = 0;
    for (const ability of EVERY) {
      if (ability.effects.length === 0) continue;
      ran++;
      if (ability.source.kind === 'adversary') fromBlocks++;
      const reasons = run(ability);
      if (reasons.length > 0) refused.set(ability.id, reasons);
    }
    // A fixture that silently stopped finding cards would pass every other
    // assertion here, so the counts are two of them — and the stat blocks are
    // counted apart from the cards, so a pass that skipped them would show.
    expect(ran).toBeGreaterThanOrEqual(40);
    expect(fromBlocks).toBeGreaterThanOrEqual(50);
    for (const [id, reasons] of refused) {
      expect(EXPECTED_REFUSALS.has(id), `${id} refused: ${reasons.join('; ')}`).toBe(true);
    }
    // And the allowlist earns its place: each entry really does refuse.
    for (const id of EXPECTED_REFUSALS.keys()) expect(refused.has(id), `${id} no longer refuses`).toBe(true);
  });
});
