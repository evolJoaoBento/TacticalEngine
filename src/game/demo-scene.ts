/**
 * The demo scene, assembled from real content.
 *
 * Everything the browser entry point needs that is *not* a renderer, a camera or
 * an input handler — so it can be built and asserted on in node, and the page is
 * left holding only the parts that genuinely need a browser.
 *
 * It is also the closest thing to a playable vertical slice: a party you select
 * between and walk around, followers that keep up, a trigger that starts a fight,
 * and a turn loop that hands the spotlight back and forth.
 */

import adversaryJson from '../../tools/srd-sources/seansbox/adversaries.json';
import { useInteractable } from '../engine/scene/interact';
import type { Trait } from '../engine/scene/primitives';
import type { CheckOutcome, LogTone } from '../engine/script/effects';
import { ScriptRunner, type JournalEntry, type Prompt, type Response } from '../engine/script/runner';
import { createScenarioState, SceneScriptWorld, type ScenarioState } from '../engine/script/world';
import ancestryJson from '../../tools/srd-sources/daggersearch/core/ancestries.json';
import armorJson from '../../tools/srd-sources/daggersearch/core/armors.json';
import classJson from '../../tools/srd-sources/daggersearch/core/classes.json';
import communityJson from '../../tools/srd-sources/daggersearch/core/communities.json';
import weaponJson from '../../tools/srd-sources/daggersearch/core/weapons.json';
import { applyAttack, resolveAttack, type AttackProfile } from '../engine/combat/attack';
import { EncounterRunner } from '../engine/combat/encounter';
import {
  attackProfile,
  blankSheet,
  defenderProfile,
  deriveCharacter,
  startingPools,
  type CharacterSheet,
  type DerivedCharacter,
} from '../engine/character/sheet';
import { importCharacterContent } from '../engine/content/srd/daggersearch';
import {
  importSeansboxAdversaries,
  type RawAdversary,
} from '../engine/content/srd/seansbox-adversaries';
import type { AdversaryDef } from '../engine/content/types';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE, type TileGrid } from '../engine/grid/grid';
import { Pathfinder, type ReachableField } from '../engine/grid/pathfinding';
import { gridFromScene, tileOf } from '../engine/scene/grid-from-scene';
import { importLegacyScene, type LegacyMap } from '../engine/scene/legacy-import';
import { Party } from '../engine/scene/party';
import type { SceneDoc } from '../engine/scene/schema';
import { createPartyEntity, sceneStateFromScene, type SceneState } from '../engine/scene/state';
import { TriggerIndex } from '../engine/scene/triggers';

/** Adversary stat blocks, keyed by content id. */
export const SRD_ADVERSARIES: ReadonlyMap<string, AdversaryDef> = new Map(
  importSeansboxAdversaries(adversaryJson as RawAdversary[]).defs.map((def) => [def.id, def]),
);

/**
 * The prototype's homebrew Hollow Husk has no SRD stat block, so the demo stands
 * the SRD's Acid Burrower in its place — the same substitution the end-to-end
 * combat test makes.
 */
export const DEMO_ADVERSARY_ID = 'acid-burrower';

/** How far a party member may move in one go, in movement points. */
export const DEMO_MOVE_BUDGET = 8;

/** Tight bands, so a 22x16 map spans more than one of them. */
export const DEMO_BAND_TILES = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

/**
 * Which model an entity uses. Party members carry a class name and adversaries an
 * SRD content id; neither is a model id, so the demo maps them.
 */
export const DEMO_MODELS: Readonly<Record<string, string>> = {
  guardian: 'knight',
  rogue: 'rogue',
  wizard: 'mage',
  'acid-burrower': 'bramble',
  'hollow-husk': 'husk',
};

/** Classes, ancestries, communities, armor and weapons, from the vendored SRD. */
export const SRD_CHARACTERS = importCharacterContent({
  weapons: weaponJson as unknown[],
  armors: armorJson as unknown[],
  classes: classJson as unknown[],
  ancestries: ancestryJson as unknown[],
  communities: communityJson as unknown[],
}).content;

/**
 * The demo party, as authored character sheets.
 *
 * Everything mechanical — Evasion, Hit Points, damage thresholds, Armor Slots and
 * the trait each attack rolls — is derived from the class, ancestry and equipment
 * these name, rather than written down here.
 */
export const PARTY_SHEETS: readonly CharacterSheet[] = [
  blankSheet('kara', 'guardian', {
    name: 'Kara',
    traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
    ancestryId: 'human',
    armorId: 'chainmail-armor',
    primaryWeaponId: 'broadsword',
  }),
  blankSheet('finn', 'rogue', {
    name: 'Finn',
    traits: { agility: 2, strength: -1, finesse: 2, instinct: 1, presence: 0, knowledge: 0 },
    ancestryId: 'elf',
    armorId: 'gambeson-armor',
    primaryWeaponId: 'shortbow',
  }),
  blankSheet('mira', 'wizard', {
    name: 'Mira',
    traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 2 },
    ancestryId: 'faerie',
    armorId: 'gambeson-armor',
    primaryWeaponId: 'greatstaff',
  }),
];

export interface DemoScene {
  scene: SceneDoc;
  grid: TileGrid;
  state: SceneState;
  pathfinder: Pathfinder;
  party: Party;
  /** Derived sheets, by character id. */
  characters: ReadonlyMap<string, DerivedCharacter>;
  triggers: TriggerIndex;
  rng: Rng;
  /** What scripts read and write: flags, keys, variables. */
  world: SceneScriptWorld;
  scenario: ScenarioState;
  /** The narrative log, oldest first. */
  log: LogLine[];
  /** A script waiting on the player — a roll to make, or a choice to pick. */
  pending: PendingScript | null;
  /** Set while a fight is running. */
  encounter: EncounterRunner | null;
}

/** A line in the narrative pane. */
export interface LogLine {
  text: string;
  tone: LogTone;
}

/** A script that stopped to ask the player something. */
export interface PendingScript {
  runner: ScriptRunner;
  prompt: Prompt;
  /** The interactable it came from, for a UI that wants to name it. */
  interactable: string;
  /**
   * How much of the runner's journal has already reached the log.
   *
   * A runner's journal is cumulative — every `resume` returns the whole story so
   * far, not just the new part — so without this the lines shown before a roll
   * are shown again after it.
   */
  recorded: number;
}

export function buildDemoScene(map: LegacyMap, seed = 'demo'): DemoScene {
  const imported = importLegacyScene(map);
  const scene = imported.scene;
  if (scene === null) throw new Error('the demo map could not be imported');

  const { grid } = gridFromScene(scene);
  const burrower = SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID);
  if (burrower === undefined) throw new Error(`missing adversary "${DEMO_ADVERSARY_ID}"`);

  const stats = new Map<string, { id: string; hitPoints: number; stress: number }>();
  for (const encounter of scene.encounters) {
    for (const placement of encounter.adversaries) {
      stats.set(placement.adversary, {
        id: placement.adversary,
        hitPoints: burrower.hitPoints,
        stress: burrower.stress,
      });
    }
  }

  // Derive every sheet once; the pools a character enters a scene with come
  // straight off it, so nothing about them is written down twice.
  const characters = new Map<string, DerivedCharacter>();
  for (const sheet of PARTY_SHEETS) {
    characters.set(sheet.id, deriveCharacter(sheet, SRD_CHARACTERS).character);
  }

  const { state } = sceneStateFromScene(scene, grid, {
    adversaries: stats,
    party: PARTY_SHEETS.map((sheet) => {
      const pools = startingPools(characters.get(sheet.id)!);
      return {
        ...createPartyEntity(sheet.id, sheet.classId, NO_TILE),
        hitPoints: pools.hitPoints,
        stress: pools.stress,
        armorSlots: pools.armorSlots,
        hope: pools.hope,
      };
    }),
  });

  // The vault door is shut in the authored map; open it so the demo has somewhere
  // to walk and something to reach.
  const door = scene.interactables.find((i) => i.kind === 'door');
  if (door !== undefined) {
    state.interactable(door.id).open = true;
    state.setInteractableBlocking(tileOf(grid, door.position), false);
  }

  const pathfinder = new Pathfinder(grid);

  // One world for the whole scene, so a flag a chest sets is a flag a later
  // dialogue or trigger can read.
  const scenario = createScenarioState();
  const world = new SceneScriptWorld(state, scenario, {
    traits: traitsFor(characters),
  });

  return {
    scene,
    grid,
    state,
    pathfinder,
    party: new Party(state, pathfinder, { moveBudget: DEMO_MOVE_BUDGET }),
    characters,
    triggers: new TriggerIndex(scene, grid),
    rng: createRng(seed),
    world,
    scenario,
    log: [],
    pending: null,
    encounter: null,
  };
}

/** Whether a fight is currently running. */
export function inCombat(demo: DemoScene): boolean {
  return demo.encounter !== null && demo.encounter.outcome === 'ongoing';
}

/** Tiles the selected member can reach right now. */
export function reachableTiles(demo: DemoScene, budget = DEMO_MOVE_BUDGET): ReachableField {
  const id = demo.party.selected;
  if (id === null) return demo.pathfinder.reachable(NO_TILE, 0);
  return demo.party.reachable(id, { inCombat: inCombat(demo), budget });
}

export interface MoveResult {
  moved: boolean;
  path: number[];
  /** The encounter this move woke, if any. */
  triggered?: string;
}

/**
 * Walk the selected member.
 *
 * Out of combat the rest of the party follows; in combat everyone moves alone and
 * the move spends an action. Walking onto a trigger cell starts its encounter, and
 * the mover stops there rather than running on through the ambush.
 */
export function moveSelectedTo(demo: DemoScene, destination: number): MoveResult {
  const id = demo.party.selected;
  if (id === null || !demo.party.canCommand(id)) return { moved: false, path: [] };
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(id)) return { moved: false, path: [] };

  const field = demo.party.reachable(id, { inCombat: fighting });
  if (!field.canReach(destination)) return { moved: false, path: [] };

  const full = demo.party.moveTo(id, destination, { inCombat: fighting });
  if (full === null) return { moved: false, path: [] };

  // A trigger stops the move where it fired.
  const hit = demo.triggers.firstAlong(full, demo.state);
  const path = hit === null ? full : full.slice(0, full.indexOf(hit.tile) + 1);
  if (hit !== null) demo.state.moveEntity(id, hit.tile);

  if (!fighting) demo.party.follow(id, path);
  if (fighting) demo.encounter!.act(id);

  if (hit !== null) {
    startEncounter(demo, hit.encounter);
    return { moved: true, path, triggered: hit.encounter };
  }
  return { moved: true, path };
}

/** Begin a fight. Safe to call twice. */
export function startEncounter(demo: DemoScene, encounterId: string): EncounterRunner {
  if (demo.encounter !== null && demo.encounter.encounterId === encounterId) return demo.encounter;
  const runner = new EncounterRunner(demo.state, encounterId);
  runner.start();
  demo.encounter = runner;
  return runner;
}


/**
 * The selected character attacks an adversary.
 *
 * Returns null when the attack could not be attempted at all, so a UI can say why
 * without the engine having rolled anything.
 */
export function attackWithSelected(
  demo: DemoScene,
  targetId: string,
): { hit: boolean; refused: string | null; hitPointsMarked: number } | null {
  const id = demo.party.selected;
  const character = id === null ? undefined : demo.characters.get(id);
  const attacker = id === null ? undefined : demo.state.entity(id);
  const target = demo.state.entity(targetId);
  if (character === undefined || attacker === undefined || target === undefined) return null;
  if (inCombat(demo) && !demo.encounter!.canAct(id!)) return null;

  const def = SRD_ADVERSARIES.get(target.definition) ?? SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
  const outcome = resolveAttack(demo.rng, {
    grid: demo.grid,
    attacker,
    target,
    profile: attackProfile(character),
    defender: { difficulty: def.difficulty, thresholds: def.thresholds },
    options: { bandTiles: DEMO_BAND_TILES },
  });
  if (outcome.refused !== null) return { hit: false, refused: outcome.refused, hitPointsMarked: 0 };

  const applied = applyAttack(demo.state, outcome);
  if (inCombat(demo)) demo.encounter!.act(id!, { spotlightToGm: outcome.spotlightToGm });
  return { hit: outcome.hit, refused: null, hitPointsMarked: applied.hitPointsMarked };
}

/**
 * Play the GM's turn: spotlight adversaries while the Fear lasts, each attacking
 * the nearest party member it can reach.
 */
export function playGmTurn(demo: DemoScene): number {
  const encounter = demo.encounter;
  if (encounter === null || encounter.outcome !== 'ongoing' || encounter.view().side !== 'gm') return 0;

  let acted = 0;
  for (const id of encounter.view().waiting) {
    if (!encounter.canSpotlight(id)) break;
    encounter.spotlight(id);
    acted++;
    attackNearestPartyMember(demo, id);
    if (encounter.outcome !== 'ongoing') break;
  }
  encounter.endGmTurn();
  return acted;
}

function attackNearestPartyMember(demo: DemoScene, adversaryId: string): void {
  const adversary = demo.state.entity(adversaryId);
  if (adversary === undefined || !adversary.alive) return;

  const targets = demo.state.entitiesOf('party').filter((e) => e.alive);
  if (targets.length === 0) return;
  // Nearest, then by id, so the same state always produces the same target.
  const target = targets.sort(
    (a, b) =>
      demo.grid.manhattanDistance(adversary.tile, a.tile) -
        demo.grid.manhattanDistance(adversary.tile, b.tile) || a.id.localeCompare(b.id),
  )[0]!;

  const character = demo.characters.get(target.id);
  const def = SRD_ADVERSARIES.get(adversary.definition) ?? SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
  const outcome = resolveAttack(demo.rng, {
    grid: demo.grid,
    attacker: adversary,
    target,
    profile: {
      kind: 'adversary',
      name: def.attackName,
      modifier: def.attackModifier,
      range: def.attackRange,
      damage: def.attackDamage,
    },
    // The target defends with the Evasion and thresholds their own sheet derives.
    defender:
      character === undefined
        ? { difficulty: 11, thresholds: { major: 6, severe: 12 } }
        : defenderProfile(character),
    options: { bandTiles: DEMO_BAND_TILES },
  });
  if (outcome.refused === null) applyAttack(demo.state, outcome);
}

// ---------------------------------------------------------------------------
// Using the things in the world
// ---------------------------------------------------------------------------

/** How close you have to be to touch something. */
export const DEMO_REACH = 1;

export interface UseOutcome {
  status: 'done' | 'waiting' | 'refused' | 'unreachable' | 'missing';
  /** Lines added to the narrative log by this use. */
  lines: readonly LogLine[];
}

/**
 * Use the interactable with this id, with whoever is selected.
 *
 * You have to be able to reach it: the legacy prototype let you click a chest
 * across the room, which made keys and locked doors meaningless.
 */
export function useSelectedOn(demo: DemoScene, interactableId: string): UseOutcome {
  const object = demo.scene.interactables.find((i) => i.id === interactableId);
  if (object === undefined) return { status: 'missing', lines: [] };

  const actor = demo.party.selected;
  if (actor === null) return { status: 'unreachable', lines: [] };
  const here = demo.state.entity(actor)?.tile ?? NO_TILE;
  const there = tileOf(demo.grid, object.position);
  if (here === NO_TILE || there === NO_TILE || chebyshev(demo.grid, here, there) > DEMO_REACH) {
    return { status: 'unreachable', lines: note(demo, 'It is out of reach.', 'system') };
  }

  demo.scenario.actorId = actor;
  const result = useInteractable(object, demo.world, demo.rng);
  if (result.status === 'refused') {
    return { status: 'refused', lines: note(demo, result.text, 'system') };
  }

  const lines = record(demo, result.journal);
  if (result.status === 'waiting') {
    demo.pending = {
      runner: result.runner,
      prompt: result.prompt,
      interactable: object.id,
      recorded: result.journal.length,
    };
    return { status: 'waiting', lines };
  }
  return { status: 'done', lines };
}

/**
 * Answer whatever a script is waiting for.
 *
 * Rolling uses the scene's RNG, so a use is part of the same replayable stream
 * as every attack.
 */
export function answerPending(demo: DemoScene, response: Response): UseOutcome {
  const waiting = demo.pending;
  if (waiting === null) return { status: 'refused', lines: [] };

  const result = waiting.runner.resume(response);
  // Only the part that has not been shown yet.
  const lines = record(demo, result.journal.slice(waiting.recorded));
  if (result.status === 'waiting') {
    demo.pending = { ...waiting, prompt: result.prompt, recorded: result.journal.length };
    return { status: 'waiting', lines };
  }
  demo.pending = null;
  return { status: 'done', lines };
}

/** The nearest thing the selected member could use right now, if any. */
export function reachableInteractable(demo: DemoScene): string | null {
  const actor = demo.party.selected;
  if (actor === null) return null;
  const here = demo.state.entity(actor)?.tile ?? NO_TILE;
  if (here === NO_TILE) return null;
  for (const object of demo.scene.interactables) {
    const there = tileOf(demo.grid, object.position);
    if (there !== NO_TILE && chebyshev(demo.grid, here, there) <= DEMO_REACH) return object.id;
  }
  return null;
}

/** Tiles apart, counting a diagonal as one step. */
function chebyshev(grid: TileGrid, a: number, b: number): number {
  const ax = a % grid.width;
  const ay = Math.floor(a / grid.width);
  const bx = b % grid.width;
  const by = Math.floor(b / grid.width);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Put one line in the log, and return it. */
function note(demo: DemoScene, text: string, tone: LogTone): LogLine[] {
  const line = { text, tone };
  demo.log.push(line);
  return [line];
}

/**
 * Turn what a script did into what the player reads.
 *
 * Only the entries with something to say become lines; a flag being set is real
 * but not news.
 */
function record(demo: DemoScene, journal: readonly JournalEntry[]): LogLine[] {
  const lines: LogLine[] = [];
  for (const entry of journal) {
    const line = describeEntry(entry);
    if (line !== null) lines.push(line);
  }
  demo.log.push(...lines);
  return lines;
}

function describeEntry(entry: JournalEntry): LogLine | null {
  switch (entry.kind) {
    case 'log':
      return { text: entry.text, tone: entry.tone };
    case 'story':
      return { text: [entry.title, ...entry.paragraphs].join(' '), tone: 'narration' };
    case 'key':
      return { text: `You take the ${entry.key}.`, tone: 'success' };
    case 'loot':
      return { text: 'You find something worth carrying.', tone: 'success' };
    case 'damage':
      return { text: `You take ${entry.amount} damage.`, tone: 'fear' };
    case 'heal':
      return { text: `You recover ${entry.amount}.`, tone: 'hope' };
    case 'check':
      return { text: describeOutcome(entry.outcome), tone: toneFor(entry.outcome) };
    case 'chose':
      return { text: entry.label, tone: 'system' };
    case 'encounter':
      return entry.change === 'started'
        ? { text: entry.intro ?? 'Something moves.', tone: 'combat' }
        : null;
    default:
      // Flags, variables and bookkeeping are real but not news.
      return null;
  }
}

function describeOutcome(outcome: CheckOutcome): string {
  switch (outcome) {
    case 'criticalSuccess':
      return 'A critical success.';
    case 'successWithHope':
      return 'Success, with Hope.';
    case 'successWithFear':
      return 'Success, with Fear.';
    case 'failureWithHope':
      return 'Failure, with Hope.';
    case 'failureWithFear':
      return 'Failure, with Fear.';
  }
}

function toneFor(outcome: CheckOutcome): LogTone {
  if (outcome === 'criticalSuccess') return 'success';
  return outcome.startsWith('success') ? 'hope' : 'fear';
}

/** Trait modifiers for whoever is acting, so a check uses the real sheet. */
function traitsFor(
  characters: ReadonlyMap<string, DerivedCharacter>,
): Partial<Record<Trait, number>> {
  // The demo rolls with the strongest of the party for each trait: a check on an
  // object is the party solving it together, not one specific hand.
  const best: Partial<Record<Trait, number>> = {};
  for (const character of characters.values()) {
    for (const [trait, value] of Object.entries(character.sheet.traits) as [Trait, number][]) {
      if (best[trait] === undefined || value > best[trait]!) best[trait] = value;
    }
  }
  return best;
}
