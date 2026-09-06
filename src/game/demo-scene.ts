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
import { CHEST_LOOT, DEMO_ITEMS, DEMO_LOOT_TABLES } from './demo-items';
import { PIT_SCENE, PIT_SCENE_ID } from './demo-scenes';
import { walkCheck } from '../engine/script/schema';
import type { LootTable } from '../engine/content/items';
import type { Currency, MarkPool } from '../engine/rules/resources';
import { interactableSchema, projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { SceneStateSnapshot } from '../engine/scene/state';
import { DialogueRunner, type DialogueView } from '../engine/dialogue/dialogue';
import type { Dialogue } from '../engine/dialogue/schema';
import { DEMO_DIALOGUES, PILLAR_DIALOGUE_ID } from './demo-dialogue';
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

/** The way out of the vault, added by the demo because the legacy map had none. */
export const DEMO_STAIR_ID = 'stair-down';

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
  /** Every scene the campaign holds, so travel has somewhere to go. */
  project: ProjectDoc;
  /** How each visited scene was left, so returning finds it that way. */
  snapshots: Map<string, SceneStateSnapshot>;
  /** A scene a script asked to travel to, acted on once the script settles. */
  destination: string | null;
  /** Conversations the project ships, by id. */
  dialogues: ReadonlyMap<string, Dialogue>;
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

/**
 * A script that stopped to ask the player something.
 *
 * `dialogue` is set when the thing it stopped *on* was a conversation: the
 * dialogue runs to its end, and only then does the script it interrupted carry
 * on. That nesting is why this is one object rather than two fields — the outer
 * runner has to be kept alive across the whole conversation.
 */
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
  /** The conversation this script opened, while it is being had. */
  dialogue: PendingDialogue | null;
}

/** A conversation in progress. */
export interface PendingDialogue {
  id: string;
  runner: DialogueRunner;
  /** What the player is looking at, or null while an inner script has the floor. */
  view: DialogueView | null;
  /** An inner prompt: a reply that costs a roll. */
  prompt: Prompt | null;
  /** Same cumulative-journal guard as above. */
  recorded: number;
  /**
   * The node whose lines are already in the log.
   *
   * What a character *says* lives in the view, not the journal, so a transcript
   * has to be written as nodes are entered — and only once each, because a node
   * offering replies keeps handing back the same view until one is picked.
   */
  spokenNode: string | null;
}

/** Everything that belongs to one room rather than to the campaign. */
interface SceneRuntime {
  scene: SceneDoc;
  grid: TileGrid;
  state: SceneState;
  pathfinder: Pathfinder;
  party: Party;
  triggers: TriggerIndex;
  world: SceneScriptWorld;
}

interface RuntimeOptions {
  /** Pools the party arrives with, by character id. Fresh sheets when absent. */
  pools?: ReadonlyMap<string, PartyPools>;
  /** Fear is the GM's across the session, not the room's. */
  fear?: Currency;
  /** The project's loot tables, so a chest in any room pays out. */
  lootTables?: ReadonlyMap<string, LootTable>;
}

/** The pools a character carries between rooms. */
export interface PartyPools {
  hitPoints: MarkPool;
  stress: MarkPool;
  armorSlots: MarkPool;
  /** Optional only because `EntityState` makes it so; party members always have it. */
  hope?: Currency;
}

/**
 * Build the mutable half of a scene.
 *
 * Split out of `buildDemoScene` so travelling can do exactly this again for the
 * room being entered, with the party's pools carried in rather than rolled back
 * to full.
 */
function buildRuntime(
  scene: SceneDoc,
  characters: ReadonlyMap<string, DerivedCharacter>,
  scenario: ScenarioState,
  options: RuntimeOptions = {},
): SceneRuntime {
  const { grid } = gridFromScene(scene);

  // The legacy map's adversaries are homebrew ids with no SRD stat block, so one
  // imported adversary stands in for all of them; a real project would ship its
  // own. An id that *is* in the SRD uses its own numbers.
  const stand = SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID);
  if (stand === undefined) throw new Error(`missing adversary "${DEMO_ADVERSARY_ID}"`);
  const stats = new Map<string, { id: string; hitPoints: number; stress: number }>();
  for (const encounter of scene.encounters) {
    for (const placement of encounter.adversaries) {
      const definition = SRD_ADVERSARIES.get(placement.adversary) ?? stand;
      stats.set(placement.adversary, {
        id: placement.adversary,
        hitPoints: definition.hitPoints,
        stress: definition.stress,
      });
    }
  }

  const { state } = sceneStateFromScene(scene, grid, {
    adversaries: stats,
    party: PARTY_SHEETS.map((sheet) => {
      const carried = options.pools?.get(sheet.id);
      const pools = carried ?? startingPools(characters.get(sheet.id)!);
      return {
        ...createPartyEntity(sheet.id, sheet.classId, NO_TILE),
        hitPoints: { ...pools.hitPoints },
        stress: { ...pools.stress },
        armorSlots: { ...pools.armorSlots },
        ...(pools.hope === undefined ? {} : { hope: { ...pools.hope } }),
      };
    }),
    ...(options.fear === undefined ? {} : { fear: { ...options.fear } }),
  });

  const pathfinder = new Pathfinder(grid);
  return {
    scene,
    grid,
    state,
    pathfinder,
    party: new Party(state, pathfinder, { moveBudget: DEMO_MOVE_BUDGET }),
    triggers: new TriggerIndex(scene, grid),
    world: new SceneScriptWorld(state, scenario, {
      traits: traitsFor(characters),
      ...(options.lootTables === undefined ? {} : { lootTables: options.lootTables }),
    }),
  };
}

/** What each party member is carrying, pool-wise, right now. */
function poolsOf(demo: DemoScene): Map<string, PartyPools> {
  const pools = new Map<string, PartyPools>();
  for (const entity of demo.state.entitiesOf('party')) {
    pools.set(entity.id, {
      hitPoints: { ...entity.hitPoints },
      stress: { ...entity.stress },
      armorSlots: { ...entity.armorSlots },
      ...(entity.hope === undefined ? {} : { hope: { ...entity.hope } }),
    });
  }
  return pools;
}

/**
 * Move the party to another scene.
 *
 * Wounds, Stress, Hope and Fear travel; where everyone stood does not — the
 * party arrives on the new scene's spawn points. A room already visited is
 * restored to how it was left, minus its party entities, which are replaced with
 * the ones that actually walked in.
 */
export function travelTo(demo: DemoScene, sceneId: string): boolean {
  const target = demo.project.scenes.find((candidate) => candidate.id === sceneId);
  if (target === undefined || target.id === demo.scene.id) return false;

  // Remember the room being left, so coming back finds the chest still open.
  demo.snapshots.set(demo.scene.id, demo.state.snapshot());

  const selected = demo.party.selected;
  const runtime = buildRuntime(target, demo.characters, demo.scenario, {
    pools: poolsOf(demo),
    fear: demo.state.fear,
    lootTables: new Map(demo.project.lootTables.map((table) => [table.id, table])),
  });

  const remembered = demo.snapshots.get(target.id);
  if (remembered !== undefined) {
    const arrivals = runtime.state.entitiesOf('party').map((e) => ({ ...e }));
    // `restore` replaces everything, the stale party included; put the real one
    // back on the spawns afterwards.
    runtime.state.restore(remembered);
    for (const entity of runtime.state.entitiesOf('party')) {
      runtime.state.removeEntity(entity.id);
    }
    const spawns = target.spawns;
    arrivals.forEach((entity, i) => {
      const spawn = spawns[i % Math.max(spawns.length, 1)];
      const tile = spawn === undefined ? NO_TILE : tileOf(runtime.grid, spawn);
      runtime.state.addEntity({ ...entity, tile });
    });
  }

  install(demo, runtime, selected);
  // `SceneDoc.intro` has been an authored field nothing ever read.
  if (target.intro !== '') note(demo, target.intro, 'narration');
  return true;
}

/**
 * Make a freshly built runtime the one being played.
 *
 * A fight does not follow you through a door, and a script that was waiting
 * belongs to the room it was asked in — so both are dropped here rather than at
 * each call site.
 */
function install(demo: DemoScene, runtime: SceneRuntime, selected: string | null): void {
  demo.scene = runtime.scene;
  demo.grid = runtime.grid;
  demo.state = runtime.state;
  demo.pathfinder = runtime.pathfinder;
  demo.party = runtime.party;
  demo.triggers = runtime.triggers;
  demo.world = runtime.world;
  demo.encounter = null;
  demo.pending = null;
  demo.destination = null;

  if (selected !== null && demo.party.members().includes(selected)) demo.party.select(selected);
}

/**
 * Re-enter a scene exactly as a snapshot left it, party included.
 *
 * This is `travelTo`'s twin and deliberately not the same function: travel walks
 * the party in through a spawn point, while loading a save has to put everyone
 * back on the tile they were standing on. A save that teleports you to the door
 * on reload is a save that lost something.
 */
export function enterSavedScene(
  demo: DemoScene,
  sceneId: string,
  snapshot: SceneStateSnapshot,
): boolean {
  const target = demo.project.scenes.find((candidate) => candidate.id === sceneId);
  if (target === undefined) return false;

  const runtime = buildRuntime(target, demo.characters, demo.scenario, {
    lootTables: new Map(demo.project.lootTables.map((table) => [table.id, table])),
  });
  // Everything the snapshot holds wins, pools and party tiles included; the
  // freshly built state is only here for the grid and the blocking index.
  runtime.state.restore(snapshot);
  install(demo, runtime, null);
  return true;
}

/**
 * Act on a `goto` a script asked for, once the script has finished asking the
 * player things.
 *
 * Travelling mid-script would carry the rest of that script into the wrong room,
 * so the destination is remembered and spent here.
 */
function settleTravel(demo: DemoScene, lines: LogLine[]): UseOutcome {
  if (demo.destination === null || demo.pending !== null) {
    return { status: demo.pending === null ? 'done' : 'waiting', lines };
  }
  const before = demo.log.length;
  travelTo(demo, demo.destination);
  demo.destination = null;
  return { status: 'done', lines: [...lines, ...demo.log.slice(before)] };
}

export function buildDemoScene(map: LegacyMap, seed = 'demo'): DemoScene {
  const imported = importLegacyScene(map);
  const vault = imported.scene;
  if (vault === null) throw new Error('the demo map could not be imported');

  // Derive every sheet once; the pools a character enters a scene with come
  // straight off it, so nothing about them is written down twice.
  const characters = new Map<string, DerivedCharacter>();
  for (const sheet of PARTY_SHEETS) {
    characters.set(sheet.id, deriveCharacter(sheet, SRD_CHARACTERS).character);
  }

  // The pillar is the dullest thing on the map — a Strength check and a line of
  // text. Give it the conversation instead, so the demo has something to talk to.
  // Authored the way a project file would: an effect on the object, no roll to
  // reach it.
  const pillar = vault.interactables.find((i) => i.kind === 'pillar');
  if (pillar !== undefined) {
    pillar.effects = [{ kind: 'startDialogue', dialogue: PILLAR_DIALOGUE_ID }];
    delete pillar.check;
  }

  // A way down, and a way back. The two scenes only learn each other's ids here,
  // because one of them is imported and its id is not knowable in advance.
  // The legacy map has no way out of the vault — it was a one-room prototype.
  vault.interactables.push(
    interactableSchema.parse({
      id: DEMO_STAIR_ID,
      kind: 'portal',
      position: { x: 20, y: 9 },
      name: 'A stair down',
      flavor: 'Behind the husks, steps drop away into the dark.',
      blocksMovement: false,
      effects: [{ kind: 'goto', scene: PIT_SCENE_ID }],
    }),
  );
  const pit = structuredClone(PIT_SCENE);
  const back = pit.interactables.find((i) => i.id === 'stair-up');
  if (back !== undefined) back.effects = [{ kind: 'goto', scene: vault.id }];

  const project: ProjectDoc = projectSchema.parse({
    id: 'demo',
    name: 'Demo Vault',
    scenes: [vault, pit],
    dialogues: [...DEMO_DIALOGUES],
    items: [...DEMO_ITEMS],
    lootTables: [...DEMO_LOOT_TABLES],
    startScene: vault.id,
  });

  // Play the documents the *project* holds, not the literals they were parsed
  // from. `projectSchema.parse` copies, so keeping the originals would leave the
  // editor and the game editing two different documents that only look alike —
  // a scene added in one would be invisible to the other.
  const vaultDoc = project.scenes.find((scene) => scene.id === vault.id)!;

  const scenario = createScenarioState();
  const lootTables = new Map(project.lootTables.map((table) => [table.id, table]));
  const runtime = buildRuntime(vaultDoc, characters, scenario, { lootTables });

  // The legacy `loot` effect named no table, because the prototype had no items.
  // Point it at one, so opening the chest actually pays out.
  for (const object of vaultDoc.interactables) {
    if (object.check === undefined) continue;
    walkCheck(object.check, (effect) => {
      if (effect.kind === 'loot' && effect.table === undefined) effect.table = CHEST_LOOT;
    });
  }

  // The vault door is shut in the authored map; open it so the demo has somewhere
  // to walk and something to reach.
  const door = vaultDoc.interactables.find((i) => i.kind === 'door');
  if (door !== undefined) {
    runtime.state.interactable(door.id).open = true;
    runtime.state.setInteractableBlocking(tileOf(runtime.grid, door.position), false);
  }

  return {
    ...runtime,
    characters,
    rng: createRng(seed),
    scenario,
    project,
    snapshots: new Map(),
    destination: null,
    // From the project, not from the literals it was parsed out of: parsing
    // copies, and a conversation edited in the graph editor has to be the one
    // the pillar opens. Same trap as the scenes.
    dialogues: new Map(project.dialogues.map((d) => [d.id, d])),
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
  // A script waiting on the player blocks everything else; see `useSelectedOn`.
  if (demo.pending !== null) return { moved: false, path: [] };
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
  if (demo.pending !== null) return null;
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
  status: 'done' | 'waiting' | 'refused' | 'unreachable' | 'missing' | 'busy';
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
  // One thing at a time: a script waiting on an answer holds the floor, or a
  // player could walk away from a lock and then pick it from across the room.
  if (demo.pending !== null) return { status: 'busy', lines: [] };

  const object = demo.scene.interactables.find((i) => i.id === interactableId);
  if (object === undefined) return { status: 'missing', lines: [] };

  const actor = demo.party.selected;
  if (actor === null) return { status: 'unreachable', lines: [] };
  const here = demo.state.entity(actor)?.tile ?? NO_TILE;
  const there = tileOf(demo.grid, object.position);
  if (here === NO_TILE || there === NO_TILE || chebyshev(demo.grid, here, there) > DEMO_REACH) {
    return { status: 'unreachable', lines: note(demo, 'It is out of reach.', 'system') };
  }

  // In a fight, opening a chest is what you did with your turn.
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(actor)) {
    return { status: 'refused', lines: note(demo, 'There is no time — you have acted.', 'system') };
  }

  demo.scenario.actorId = actor;
  const result = useInteractable(object, demo.world, demo.rng);
  if (result.status === 'refused') {
    return { status: 'refused', lines: note(demo, result.text, 'system') };
  }

  if (fighting) demo.encounter!.act(actor);

  const lines = record(demo, result.journal);
  if (result.status === 'waiting') {
    demo.pending = {
      runner: result.runner,
      prompt: result.prompt,
      interactable: object.id,
      recorded: result.journal.length,
      dialogue: null,
    };
    return settle(demo, lines);
  }
  return settleTravel(demo, lines);
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

  // A conversation on top of the script takes the answer first.
  if (waiting.dialogue !== null) return answerDialogue(demo, waiting, waiting.dialogue, response);

  const result = waiting.runner.resume(response);
  // Only the part that has not been shown yet.
  const lines = record(demo, result.journal.slice(waiting.recorded));
  if (result.status === 'waiting') {
    demo.pending = { ...waiting, prompt: result.prompt, recorded: result.journal.length };
    return settle(demo, lines);
  }
  demo.pending = null;
  return settleTravel(demo, lines);
}

/** Pick a reply, or answer a roll a reply asked for. */
function answerDialogue(
  demo: DemoScene,
  waiting: PendingScript,
  talking: PendingDialogue,
  response: Response,
): UseOutcome {
  const status =
    response.kind === 'choose'
      ? talking.runner.choose(response.index)
      : response.kind === 'continue'
        ? talking.runner.advance()
        : talking.runner.resume(response);

  const lines = record(demo, status.journal.slice(talking.recorded));
  const next: PendingDialogue = { ...talking, recorded: status.journal.length };

  if (status.status === 'talking') {
    const shown: PendingDialogue = { ...next, view: status.view, prompt: null };
    const said = speak(demo, shown, status.view);
    demo.pending = { ...waiting, dialogue: shown };
    return { status: 'waiting', lines: [...lines, ...said] };
  }
  if (status.status === 'script') {
    demo.pending = { ...waiting, dialogue: { ...next, view: null, prompt: status.prompt } };
    return { status: 'waiting', lines };
  }

  // The conversation ended; the script that opened it carries on.
  demo.pending = { ...waiting, dialogue: null };
  return resumeOuter(demo, lines);
}

/**
 * Carry the interrupted script on past its `startDialogue`.
 *
 * Its own lines are appended after the conversation's, which is the order they
 * happened in.
 */
function resumeOuter(demo: DemoScene, lines: LogLine[]): UseOutcome {
  const waiting = demo.pending;
  if (waiting === null) return { status: 'done', lines };
  const result = waiting.runner.resume({ kind: 'continue' });
  const more = record(demo, result.journal.slice(waiting.recorded));
  const all = [...lines, ...more];
  if (result.status === 'waiting') {
    demo.pending = { ...waiting, prompt: result.prompt, recorded: result.journal.length };
    return settle(demo, all);
  }
  demo.pending = null;
  return settleTravel(demo, all);
}

/**
 * A script that just stopped on a `startDialogue` opens the conversation itself,
 * so the caller never sees a prompt it has no UI for.
 */
function settle(demo: DemoScene, lines: LogLine[]): UseOutcome {
  const waiting = demo.pending;
  if (waiting === null || waiting.prompt.kind !== 'dialogue') {
    return { status: 'waiting', lines };
  }
  const dialogue = demo.dialogues.get(waiting.prompt.dialogue);
  if (dialogue === undefined) {
    // A missing conversation must not wedge the script; `validateProject` is
    // where an author is told about it.
    const missing = note(demo, 'There is nothing to say.', 'system');
    return resumeOuter(demo, [...lines, ...missing]);
  }

  const runner = new DialogueRunner(dialogue, demo.world, demo.rng);
  const status = runner.start();
  const started = record(demo, status.journal);
  const opened: PendingDialogue = {
    id: dialogue.id,
    runner,
    view: status.status === 'talking' ? status.view : null,
    prompt: status.status === 'script' ? status.prompt : null,
    recorded: status.journal.length,
    spokenNode: null,
  };
  if (status.status === 'ended') {
    demo.pending = { ...waiting, dialogue: null };
    return resumeOuter(demo, [...lines, ...started]);
  }
  const said = status.status === 'talking' ? speak(demo, opened, status.view) : [];
  demo.pending = { ...waiting, dialogue: opened };
  return { status: 'waiting', lines: [...lines, ...started, ...said] };
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

/**
 * Add a node's spoken lines to the transcript, if they are not there already.
 *
 * Returns what it added, so a caller can report the lines from one step.
 */
function speak(demo: DemoScene, talking: PendingDialogue, view: DialogueView): LogLine[] {
  if (talking.spokenNode === view.node.id) return [];
  talking.spokenNode = view.node.id;
  const lines = view.lines.map((line) => ({
    text: line.speaker === undefined ? line.text : `${line.speaker}: ${line.text}`,
    tone: 'narration' as const,
  }));
  demo.log.push(...lines);
  return lines;
}

/** Put one line in the log, and return it. */
export function note(demo: DemoScene, text: string, tone: LogTone): LogLine[] {
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
  const names = new Map(demo.project.items.map((item) => [item.id, item.name]));
  for (const entry of journal) {
    // Travel is remembered rather than taken: the rest of this script belongs to
    // the room it was asked in. `settleTravel` spends it once nothing waits.
    if (entry.kind === 'goto') demo.destination = entry.scene;
    const line = describeEntry(entry, names);
    if (line !== null) lines.push(line);
  }
  demo.log.push(...lines);
  return lines;
}

/** "12 gold and a brass key" — an item nobody named reads as its id. */
function listItems(
  found: readonly { item: string; quantity: number }[],
  names: ReadonlyMap<string, string>,
): string {
  const parts = found.map((drop) => {
    const name = names.get(drop.item) ?? drop.item;
    return drop.quantity > 1 ? `${drop.quantity} ${name}` : name;
  });
  if (parts.length <= 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
}

function describeEntry(entry: JournalEntry, names: ReadonlyMap<string, string>): LogLine | null {
  switch (entry.kind) {
    case 'log':
      return { text: entry.text, tone: entry.tone };
    case 'story':
      return { text: [entry.title, ...entry.paragraphs].join(' '), tone: 'narration' };
    case 'key':
      return { text: `You take the ${entry.key}.`, tone: 'success' };
    case 'loot':
      return entry.found.length === 0
        ? { text: 'Nothing worth taking.', tone: 'system' }
        : { text: `You find ${listItems(entry.found, names)}.`, tone: 'success' };
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
