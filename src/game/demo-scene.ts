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
import { DEMO_QUESTS } from './demo-quests';
import { SRD_ABILITIES } from '../engine/content/srd/abilities';
import { walkCheck } from '../engine/script/schema';
import type { ItemDef, LootTable } from '../engine/content/items';
import type { QuestDef } from '../engine/content/quests';
import type { Currency, MarkPool } from '../engine/rules/resources';
import { interactableSchema, projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { SceneStateSnapshot } from '../engine/scene/state';
import { DialogueRunner, type DialogueView } from '../engine/dialogue/dialogue';
import type { Dialogue } from '../engine/dialogue/schema';
import { DEMO_DIALOGUES, PILLAR_DIALOGUE_ID } from './demo-dialogue';
import { useInteractable } from '../engine/scene/interact';
import type { Trait } from '../engine/scene/primitives';
import type { CheckOutcome, LogTone } from '../engine/script/effects';
import type { DualityRoll } from '../engine/rules/duality';
import { ScriptRunner, type JournalEntry, type Prompt, type Response } from '../engine/script/runner';
import { createScenarioState, SceneScriptWorld, useKey, type SceneScriptWorldOptions, type ScenarioState } from '../engine/script/world';
import { maxTilesForBand, type RangeBand } from '../engine/rules/range';
import { levelUp, type LevelUpIssue, type LevelUpPlan } from '../engine/character/progression';
import ancestryJson from '../../tools/srd-sources/daggersearch/core/ancestries.json';
import armorJson from '../../tools/srd-sources/daggersearch/core/armors.json';
import classJson from '../../tools/srd-sources/daggersearch/core/classes.json';
import communityJson from '../../tools/srd-sources/daggersearch/core/communities.json';
import weaponJson from '../../tools/srd-sources/daggersearch/core/weapons.json';
import subclassJson from '../../tools/srd-sources/daggersearch/core/subclasses.json';
import domainCardJson from '../../tools/srd-sources/daggersearch/core/domain-cards.json';
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
import { importCharacterContent, type WeaponDef } from '../engine/content/srd/daggersearch';
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
  subclasses: subclassJson as unknown[],
  domainCards: domainCardJson as unknown[],
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
    subclassId: 'stalwart',
    domainCards: ['bare-bones', 'get-back-up'],
    experiences: [{ name: 'Held the line', modifier: 2 }],
  }),
  blankSheet('finn', 'rogue', {
    name: 'Finn',
    traits: { agility: 2, strength: -1, finesse: 2, instinct: 1, presence: 0, knowledge: 0 },
    ancestryId: 'elf',
    armorId: 'gambeson-armor',
    primaryWeaponId: 'shortbow',
    subclassId: 'nightwalker',
    domainCards: ['pick-and-pull', 'rain-of-blades'],
    experiences: [{ name: 'Knows a locksmith', modifier: 2 }],
  }),
  blankSheet('mira', 'wizard', {
    name: 'Mira',
    traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 2 },
    ancestryId: 'faerie',
    armorId: 'gambeson-armor',
    primaryWeaponId: 'greatstaff',
    subclassId: 'school-of-knowledge',
    domainCards: ['book-of-ava', 'rune-ward'],
    experiences: [{ name: 'Read the old script', modifier: 2 }],
  }),
];

export interface DemoScene {
  scene: SceneDoc;
  grid: TileGrid;
  state: SceneState;
  pathfinder: Pathfinder;
  party: Party;
  /** The party's sheets as they stand — levels taken included. */
  sheets: Map<string, CharacterSheet>;
  /** Derived sheets, by character id. Rebuilt for one character when they level. */
  characters: Map<string, DerivedCharacter>;
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
  /** The interactable it came from, for a UI that wants to name it; null for an item. */
  interactable: string | null;
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
  /**
   * What to do once the script finishes: an ability's turn is spent here,
   * because whether the spotlight passes is known only after the roll it
   * stopped for.
   */
  onDone?: (runner: ScriptRunner) => void;
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
    world: new SceneScriptWorld(state, scenario, worldOptions(characters, options.lootTables, scene)),
  };
}

/**
 * What a script world needs from the demo: the party's best traits for an
 * object's check, each sheet for a card's roll, the stat blocks for an
 * adversary's Difficulty, and the map's range bands. One place, because the
 * world is rebuilt whenever a sheet changes and a site that forgot the stat
 * blocks would roll every spell against the fallback numbers.
 */
export function worldOptions(
  characters: ReadonlyMap<string, DerivedCharacter>,
  lootTables?: ReadonlyMap<string, LootTable>,
  scene?: SceneDoc,
): SceneScriptWorldOptions {
  return {
    traits: traitsFor(characters),
    characters,
    adversaries: adversaryDefsFor(scene),
    bandTiles: DEMO_BAND_TILES,
    ...(lootTables === undefined ? {} : { lootTables }),
  };
}

/**
 * The stat blocks a scene's adversaries answer to. The legacy map's husks name
 * a homebrew id with no SRD block, so every placement the SRD does not know is
 * pointed at the stand-in — the same substitution `buildRuntime` makes for
 * their Hit Points, so a spell against a husk meets the same Difficulty as a
 * sword does.
 */
export function adversaryDefsFor(scene?: SceneDoc): ReadonlyMap<string, AdversaryDef> {
  const defs = new Map(SRD_ADVERSARIES);
  const stand = SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID);
  if (scene === undefined || stand === undefined) return defs;
  for (const encounter of scene.encounters) {
    for (const placement of encounter.adversaries) {
      if (!defs.has(placement.adversary)) defs.set(placement.adversary, stand);
    }
  }
  return defs;
}

/** The stat block an entity answers to, stand-in included. */
export function adversaryDefOf(demo: DemoScene, entityId: string): AdversaryDef | undefined {
  const entity = demo.state.entity(entityId);
  if (entity === undefined) return undefined;
  return SRD_ADVERSARIES.get(entity.definition) ?? (entity.faction === 'adversary' ? SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID) : undefined);
}

/** Rebuild the script world after a sheet changed under it. */
export function refreshWorld(demo: DemoScene): void {
  demo.world = new SceneScriptWorld(
    demo.state,
    demo.scenario,
    worldOptions(demo.characters, new Map(demo.project.lootTables.map((table) => [table.id, table])), demo.scene),
  );
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
export function settleTravel(demo: DemoScene, lines: LogLine[]): UseOutcome {
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
  const sheets = new Map<string, CharacterSheet>(PARTY_SHEETS.map((sheet) => [sheet.id, sheet]));
  const characters = new Map<string, DerivedCharacter>();
  for (const sheet of sheets.values()) {
    characters.set(sheet.id, deriveCharacter(sheet, SRD_CHARACTERS).character);
  }

  // The pillar is the dullest thing on the map — a Strength check and a line of
  // text. Give it the conversation instead, so the demo has something to talk to.
  // Authored the way a project file would: an effect on the object, no roll to
  // reach it.
  const pillar = vault.interactables.find((i) => i.kind === 'pillar');
  if (pillar !== undefined) {
    pillar.effects = [{ kind: 'startDialogue', dialogue: PILLAR_DIALOGUE_ID }];
    // A conversation can be had again; the second time, the Warden knows you.
    pillar.repeatable = true;
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
    quests: [...DEMO_QUESTS],
    abilities: [...SRD_ABILITIES],
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

  return {
    ...runtime,
    sheets,
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
  settleFight(demo);
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
    adversaryTurn(demo, id);
    if (encounter.outcome !== 'ongoing') break;
  }
  encounter.endGmTurn();
  settleFight(demo);
  return acted;
}

/**
 * Hand the spotlight to the GM and play the GM's turn.
 *
 * Under the spotlight policy the spotlight only passes on a roll with Fear or
 * a failure; this is the party choosing to stop — "we hold and see what they
 * do" — and it is the button a player presses when everyone has acted.
 */
export function endTurn(demo: DemoScene): number {
  const encounter = demo.encounter;
  if (encounter === null || encounter.outcome !== 'ongoing') return 0;
  if (encounter.view().side === 'party') encounter.passToGm();
  return playGmTurn(demo);
}

/** Fights whose end has already been announced. */
const announced = new WeakSet<EncounterRunner>();

/**
 * What the end of a fight does, once: the scene's conditions end, the
 * abilities that refresh with the scene refresh, and the log says who won.
 */
export function settleFight(demo: DemoScene): void {
  const encounter = demo.encounter;
  if (encounter === null || encounter.outcome === 'ongoing' || announced.has(encounter)) return;
  announced.add(encounter);
  demo.state.clearConditions('scene');
  for (const key of [...demo.scenario.abilityUses.keys()]) {
    const ability = demo.project.abilities.find((a) => key.endsWith(`/${a.id}`));
    if (ability?.uses?.per === 'scene') demo.scenario.abilityUses.delete(key);
  }
  note(
    demo,
    encounter.outcome === 'victory' ? 'The last of them falls. The fight is over.' : 'The party falls.',
    encounter.outcome === 'victory' ? 'success' : 'fear',
  );
}

/**
 * One adversary's spotlight, the way the SRD lists a spotlighted adversary's
 * options: clear a condition, or move within Close range and make a standard
 * attack. The AI is deliberately simple and deterministic — the nearest
 * living party member, by id on a tie — so a seeded fight replays.
 */
function adversaryTurn(demo: DemoScene, adversaryId: string): void {
  const adversary = demo.state.entity(adversaryId);
  if (adversary === undefined || !adversary.alive) return;

  // Held in place: the spotlight goes on tearing free instead of attacking.
  if (adversary.conditions.has('restrained')) {
    clearTemporaryConditions(demo, adversaryId);
    return;
  }

  const targets = demo.state.entitiesOf('party').filter((e) => e.alive);
  if (targets.length === 0) return;
  // Nearest, then by id, so the same state always produces the same target.
  const target = targets.sort(
    (a, b) =>
      demo.grid.manhattanDistance(adversary.tile, a.tile) -
        demo.grid.manhattanDistance(adversary.tile, b.tile) || a.id.localeCompare(b.id),
  )[0]!;

  const def = SRD_ADVERSARIES.get(adversary.definition) ?? SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
  approach(demo, adversary.id, target.tile, def.attackRange);
  const attacked = attackPartyMember(demo, adversaryId, target.id);
  // Nothing in reach even after moving: an adversary with something to shake
  // off shakes it off, which is at least a move.
  if (!attacked && adversary.conditions.size > 0) clearTemporaryConditions(demo, adversaryId);
}

/**
 * Move within Close range towards a tile, stopping as soon as the target is in
 * the attack's reach. Adversaries do not roll to move, per the SRD.
 */
function approach(demo: DemoScene, adversaryId: string, targetTile: number, reach: RangeBand): void {
  const adversary = demo.state.entity(adversaryId);
  if (adversary === undefined || adversary.tile === NO_TILE) return;
  const reachTiles = maxTilesForBand(reach, DEMO_BAND_TILES);
  if (demo.grid.euclideanDistance(adversary.tile, targetTile) <= reachTiles) return;

  const budget = maxTilesForBand('close', DEMO_BAND_TILES);
  const field = demo.pathfinder.reachable(adversary.tile, budget, { isBlocked: demo.state.blockedFor(adversaryId) });
  let best = adversary.tile;
  let bestDistance = demo.grid.euclideanDistance(adversary.tile, targetTile);
  for (const tile of field.tiles()) {
    if (tile === targetTile) continue;
    const distance = demo.grid.euclideanDistance(tile, targetTile);
    // Closer wins; a tie goes to the lower index, so the walk is the same every time.
    if (distance < bestDistance || (distance === bestDistance && tile < best)) {
      best = tile;
      bestDistance = distance;
    }
  }
  if (best !== adversary.tile) demo.state.moveEntity(adversaryId, best);
}

/** An adversary spends its spotlight clearing what a scene put on it. */
function clearTemporaryConditions(demo: DemoScene, adversaryId: string): void {
  const adversary = demo.state.entity(adversaryId);
  if (adversary === undefined) return;
  const cleared: string[] = [];
  for (const condition of [...adversary.conditions]) {
    if ((adversary.conditionDurations.get(condition) ?? 'permanent') !== 'temporary') continue;
    adversary.conditions.delete(condition);
    adversary.conditionDurations.delete(condition);
    cleared.push(condition);
  }
  if (cleared.length > 0) {
    note(demo, `The ${nameOf(demo, adversaryId)} shakes off ${cleared.join(' and ')}.`, 'combat');
  }
}

/** Returns whether the attack was made at all (false when out of reach). */
function attackPartyMember(demo: DemoScene, adversaryId: string, targetId: string): boolean {
  const adversary = demo.state.entity(adversaryId);
  const target = demo.state.entity(targetId);
  if (adversary === undefined || target === undefined) return false;
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
    // One Armor Slot against a hit, when the target has one: the defender's
    // standing choice, until a prompt asks them each time.
    options: { bandTiles: DEMO_BAND_TILES, armorSlotsMarked: Math.min(1, target.armorSlots.max - target.armorSlots.marked) },
  });
  if (outcome.refused !== null) return false;
  applyAttack(demo.state, outcome);
  const who = character?.sheet.name ?? target.id;
  note(
    demo,
    outcome.hit
      ? `The ${def.name}'s ${def.attackName} ${outcome.critical ? 'tears into' : 'hits'} ${who}: ${outcome.hitPointsMarked} Hit Point${outcome.hitPointsMarked === 1 ? '' : 's'}.`
      : `The ${def.name}'s ${def.attackName} misses ${who}.`,
    'combat',
  );
  return true;
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
  const result = useInteractable(object, demo.world, demo.rng, { repeatable: object.repeatable });
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
  waiting.onDone?.(waiting.runner);
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
  waiting.onDone?.(waiting.runner);
  return settleTravel(demo, all);
}

/**
 * A script that just stopped on a `startDialogue` opens the conversation itself,
 * so the caller never sees a prompt it has no UI for.
 */
export function settle(demo: DemoScene, lines: LogLine[]): UseOutcome {
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
export function record(demo: DemoScene, journal: readonly JournalEntry[]): LogLine[] {
  const lines: LogLine[] = [];
  const names = new Map(demo.project.items.map((item) => [item.id, item.name]));
  const quests = new Map(demo.project.quests.map((quest) => [quest.id, quest]));
  const who = (id: string): string => nameOf(demo, id);
  for (const entry of journal) {
    // Travel is remembered rather than taken: the rest of this script belongs to
    // the room it was asked in. `settleTravel` spends it once nothing waits.
    if (entry.kind === 'goto') demo.destination = entry.scene;
    const line = describeEntry(entry, names, quests, who);
    if (line !== null) lines.push(line);
  }
  demo.log.push(...lines);
  return lines;
}

/** A creature's name for the log: the sheet's, the stat block's, or its id. */
export function nameOf(demo: DemoScene, id: string): string {
  const sheet = demo.sheets.get(id);
  if (sheet !== undefined) return sheet.name;
  return adversaryDefOf(demo, id)?.name ?? id;
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

function describeEntry(
  entry: JournalEntry,
  names: ReadonlyMap<string, string>,
  quests: ReadonlyMap<string, QuestDef>,
  who: (id: string) => string,
): LogLine | null {
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  switch (entry.kind) {
    case 'attack':
      return entry.hit
        ? {
            text: `${who(entry.attacker)} ${entry.critical ? 'lands a critical with' : 'hits with'} the ${entry.weapon}: ${plural(entry.hitPointsMarked, 'Hit Point')} on ${who(entry.target)}.`,
            tone: 'combat',
          }
        : { text: `${who(entry.attacker)} swings the ${entry.weapon} at ${who(entry.target)} and misses.`, tone: 'combat' };
    case 'stress':
      if (entry.cleared > 0) return { text: `${who(entry.id)} clears ${plural(entry.cleared, 'Stress')}.`, tone: 'hope' };
      return {
        text: `${who(entry.id)} marks ${plural(entry.marked, 'Stress')}${entry.hitPoints > 0 ? ' and, with no slot left, a Hit Point' : ''}.`,
        tone: 'fear',
      };
    case 'armor':
      return { text: `${who(entry.id)} clears ${plural(entry.cleared, 'Armor Slot')}.`, tone: 'hope' };
    case 'condition':
      return entry.applied
        ? { text: `${who(entry.id)} is ${entry.condition}.`, tone: 'combat' }
        : { text: `${who(entry.id)} is no longer ${entry.condition}.`, tone: 'system' };
    case 'moved':
      return { text: `${who(entry.id)} is thrown back.`, tone: 'combat' };
    case 'reaction':
      return {
        text: `${who(entry.id)} reacts: ${entry.total} against ${entry.difficulty} — ${entry.success ? 'holds' : 'fails'}.`,
        tone: entry.success ? 'system' : 'success',
      };
    case 'refused':
      return { text: `That cannot happen: ${entry.reason}.`, tone: 'system' };
    case 'hopeSpent':
      return { text: `Spends ${plural(entry.amount, 'Hope')}.`, tone: 'hope' };
    case 'experience':
      return { text: `Draws on "${entry.name}" (+${entry.modifier}).`, tone: 'hope' };
    case 'hope':
      return entry.id === undefined ? null : { text: `${who(entry.id)} gains ${plural(entry.gained, 'Hope')}.`, tone: 'hope' };
    // Quest events are news, unlike the flags underneath them: the journal
    // changed, and the player should hear it without opening the journal.
    case 'quest': {
      const name = quests.get(entry.quest)?.name ?? entry.quest;
      if (entry.change === 'started') return { text: `New quest: ${name}.`, tone: 'system' };
      if (entry.change === 'completed') return { text: `Quest complete: ${name}.`, tone: 'success' };
      return { text: `Quest failed: ${name}.`, tone: 'fear' };
    }
    case 'levelUp':
      return { text: `The party reaches level ${entry.level}.`, tone: 'hope' };
    case 'objective': {
      const quest = quests.get(entry.quest);
      const step = quest?.objectives.find((o) => o.id === entry.objective)?.text ?? entry.objective;
      return { text: `Objective complete: ${step}`, tone: 'success' };
    }
    case 'revealed': {
      const quest = quests.get(entry.quest);
      const step = quest?.objectives.find((o) => o.id === entry.objective)?.text ?? entry.objective;
      return { text: `New objective: ${step}`, tone: 'system' };
    }
    case 'log':
      return { text: entry.text, tone: entry.tone };
    case 'story':
      return { text: [entry.title, ...entry.paragraphs].join(' '), tone: 'narration' };
    case 'key':
      return { text: `You take the ${names.get(entry.key) ?? entry.key}.`, tone: 'success' };
    case 'loot':
      return entry.found.length === 0
        ? { text: 'Nothing worth taking.', tone: 'system' }
        : { text: `You find ${listItems(entry.found, names)}.`, tone: 'success' };
    case 'damage':
      if (entry.targets !== undefined) {
        return {
          text: `${entry.dice ?? ''} → ${entry.amount} damage to ${entry.targets.map(who).join(', ')}: ${plural(entry.marked, 'Hit Point')}.`.replace(/^ → /, ''),
          tone: 'combat',
        };
      }
      return { text: `You take ${entry.amount} damage.`, tone: 'fear' };
    case 'heal':
      return { text: `You recover ${entry.amount}.`, tone: 'hope' };
    case 'check':
      return { text: `${describeRoll(entry.roll)} ${describeOutcome(entry.outcome)}`, tone: toneFor(entry.outcome) };
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

/**
 * The dice, in words: "Hope 9 + Fear 4 +2 = 15 vs 13."
 *
 * The prototype rolled physical dice on screen; this reads them out instead,
 * which is the part of dice presentation a player actually needs to trust the
 * outcome. Only the parts that applied are named.
 */
export function describeRoll(roll: DualityRoll): string {
  const parts = [`Hope ${roll.hope} + Fear ${roll.fear}`];
  if (roll.advantageDie > 0) parts.push(`+ d6 ${roll.advantageDie}`);
  if (roll.advantageDie < 0) parts.push(`− d6 ${-roll.advantageDie}`);
  if (roll.helpBonus > 0) parts.push(`+ help ${roll.helpBonus}`);
  if (roll.modifier !== 0) parts.push(roll.modifier > 0 ? `+ ${roll.modifier}` : `− ${-roll.modifier}`);
  return `${parts.join(' ')} = ${roll.total} vs ${roll.difficulty}.`;
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
    for (const [trait, value] of Object.entries(character.traits) as [Trait, number][]) {
      if (best[trait] === undefined || value > best[trait]!) best[trait] = value;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Levelling up
// ---------------------------------------------------------------------------

/** Party members whose sheet is below the level the party has been granted. */
export function awaitingLevel(demo: DemoScene): string[] {
  return [...demo.sheets.values()].filter((s) => s.level < demo.scenario.partyLevel).map((s) => s.id);
}

export type LevelUpResult = { ok: true; level: number } | { ok: false; issues: LevelUpIssue[] };

/**
 * Take a level for one character.
 *
 * The plan is checked whole by `levelUp`; if it holds, the sheet is replaced,
 * the derived character rebuilt, and the live entity's pools grow to match —
 * the new slots arrive unmarked, and nothing marked is cleared. Refused during
 * a fight or a pending prompt, because the script world caches the party's
 * traits and a fresh one would orphan whatever is waiting.
 */
export function applyLevelUp(demo: DemoScene, characterId: string, plan: LevelUpPlan): LevelUpResult {
  const sheet = demo.sheets.get(characterId);
  if (sheet === undefined) return { ok: false, issues: [{ field: 'character', message: `no character "${characterId}"` }] };
  if (sheet.level >= demo.scenario.partyLevel) {
    return { ok: false, issues: [{ field: 'level', message: 'no level-up waiting' }] };
  }
  if (inCombat(demo) || demo.pending !== null) {
    return { ok: false, issues: [{ field: 'level', message: 'not in the middle of a fight or a conversation' }] };
  }

  const result = levelUp(sheet, SRD_CHARACTERS, plan);
  if (result.issues.length > 0) return { ok: false, issues: result.issues };

  const derived = deriveCharacter(result.sheet, SRD_CHARACTERS).character;
  demo.sheets.set(characterId, result.sheet);
  demo.characters.set(characterId, derived);

  const entity = demo.state.entity(characterId);
  if (entity !== undefined) {
    entity.hitPoints = { max: derived.hitPoints, marked: Math.min(entity.hitPoints.marked, derived.hitPoints) };
    entity.stress = { max: derived.stress, marked: Math.min(entity.stress.marked, derived.stress) };
    entity.armorSlots = { max: derived.armorScore, marked: Math.min(entity.armorSlots.marked, derived.armorScore) };
  }

  // The script world caches the party's best traits; a raised Strength has to
  // reach the next check.
  refreshWorld(demo);
  note(demo, `${result.sheet.name} reaches level ${result.sheet.level}.`, 'hope');
  return { ok: true, level: result.sheet.level };
}

// ---------------------------------------------------------------------------
// Equipping
// ---------------------------------------------------------------------------

export type EquipResult = { ok: true; slot: 'primary' | 'secondary' | 'armor' } | { ok: false; reason: string };

/** The item in the project whose `contentId` is this piece of SRD gear, if any. */
function itemForGear(demo: DemoScene, contentId: string | undefined): ItemDef | undefined {
  if (contentId === undefined) return undefined;
  return demo.project.items.find((item) => item.contentId === contentId);
}

/** Which slot a weapon goes in: shields and the like are secondary, the rest primary. */
function slotOf(weapon: WeaponDef): 'primary' | 'secondary' {
  return weapon.slot === 'secondary' ? 'secondary' : 'primary';
}

/**
 * Put a carried weapon or armor on a character.
 *
 * The pack is the party's, so anyone can wear anything it holds; the piece
 * comes out of the pack and whatever it replaces goes back in, as long as the
 * project has an item for it — a sheet's starting gear is SRD content that may
 * have no item, in which case it is simply set aside. The sheet is re-derived
 * and the live pools follow: Armor Slots rise or fall with the armor, nothing
 * marked is cleared. Armor cannot be changed mid-fight; a weapon can.
 */
export function equipItem(demo: DemoScene, characterId: string, itemId: string): EquipResult {
  const sheet = demo.sheets.get(characterId);
  if (sheet === undefined) return { ok: false, reason: `no character "${characterId}"` };
  const item = demo.project.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) return { ok: false, reason: `no item "${itemId}"` };
  if ((demo.scenario.items.get(itemId) ?? 0) < 1) return { ok: false, reason: `the party is not carrying ${item.name}` };
  if (demo.pending !== null) return { ok: false, reason: 'not in the middle of a conversation' };
  if (item.contentId === undefined) return { ok: false, reason: `${item.name} is not something that can be worn` };

  let next: CharacterSheet;
  let slot: 'primary' | 'secondary' | 'armor';
  let replaced: string | undefined;
  if (item.kind === 'weapon') {
    const weapon = SRD_CHARACTERS.weapons.get(item.contentId);
    if (weapon === undefined) return { ok: false, reason: `${item.name} points at no known weapon` };
    slot = slotOf(weapon);
    replaced = slot === 'primary' ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
    // Already in hand: nothing to swap, and taking it out of the pack would lose it.
    if (replaced === weapon.id) return { ok: false, reason: `${sheet.name} already wields the ${item.name}` };
    next = slot === 'primary' ? { ...sheet, primaryWeaponId: weapon.id } : { ...sheet, secondaryWeaponId: weapon.id };
  } else if (item.kind === 'armor') {
    if (inCombat(demo)) return { ok: false, reason: 'armor cannot be changed in a fight' };
    const armor = SRD_CHARACTERS.armors.get(item.contentId);
    if (armor === undefined) return { ok: false, reason: `${item.name} points at no known armor` };
    slot = 'armor';
    replaced = sheet.armorId;
    if (replaced === armor.id) return { ok: false, reason: `${sheet.name} already wears the ${item.name}` };
    next = { ...sheet, armorId: armor.id };
  } else {
    return { ok: false, reason: `${item.name} is not something that can be worn` };
  }

  // Out of the pack, and the old piece back in when the project has an item for it.
  demo.world.removeItem(itemId, 1);
  const returned = itemForGear(demo, replaced);
  if (returned !== undefined && returned.id !== itemId) demo.world.addItem(returned.id, 1);

  const derived = deriveCharacter(next, SRD_CHARACTERS).character;
  demo.sheets.set(characterId, next);
  demo.characters.set(characterId, derived);
  const entity = demo.state.entity(characterId);
  if (entity !== undefined) {
    entity.armorSlots = { max: derived.armorScore, marked: Math.min(entity.armorSlots.marked, derived.armorScore) };
  }
  // A new weapon is a new trait to roll: the world reads the sheet.
  refreshWorld(demo);
  note(demo, `${sheet.name} ${slot === 'armor' ? 'puts on' : 'takes up'} the ${item.name}.`, 'system');
  return { ok: true, slot };
}

/** What a character is wielding and wearing, by name, for a HUD line. */
export function gearOf(demo: DemoScene, characterId: string): { weapon: string; armor: string } {
  const character = demo.characters.get(characterId);
  return {
    weapon: character?.primaryWeapon?.name ?? 'Unarmed',
    armor: character?.sheet.armorId === undefined ? 'Unarmored' : (SRD_CHARACTERS.armors.get(character.sheet.armorId)?.name ?? 'Unarmored'),
  };
}

// ---------------------------------------------------------------------------
// Using what is carried
// ---------------------------------------------------------------------------

/**
 * Use a carried item, with whoever is selected as the actor.
 *
 * The item's `use` effects run through the same runner as an object's, so a
 * draught can heal, a scroll can start a conversation, and a script that stops
 * to ask something is answered through `answerPending` like any other. A
 * consumable is spent first — before its effects run, so a `loot` inside them
 * cannot hand it back. In a fight, using something is the character's action.
 */
export function useItem(demo: DemoScene, itemId: string): UseOutcome {
  if (demo.pending !== null) return { status: 'busy', lines: [] };
  const item = demo.project.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) return { status: 'missing', lines: [] };
  const actor = demo.party.selected;
  if (actor === null) return { status: 'unreachable', lines: [] };
  if ((demo.scenario.items.get(itemId) ?? 0) < 1) {
    return { status: 'refused', lines: note(demo, `The party is not carrying ${item.name}.`, 'system') };
  }
  if (item.use.length === 0) {
    return { status: 'refused', lines: note(demo, `There is nothing to do with ${item.name}.`, 'system') };
  }
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(actor)) {
    return { status: 'refused', lines: note(demo, 'There is no time — you have acted.', 'system') };
  }

  demo.scenario.actorId = actor;
  if (item.kind === 'consumable') demo.world.removeItem(itemId, 1);
  if (fighting) demo.encounter!.act(actor);
  const who = demo.sheets.get(actor)?.name ?? actor;
  const lines = note(demo, `${who} uses the ${item.name}.`, 'system');

  const runner = new ScriptRunner(demo.world, demo.rng);
  const result = runner.run(item.use);
  lines.push(...record(demo, result.journal));
  if (result.status === 'waiting') {
    demo.pending = { runner, prompt: result.prompt, interactable: null, recorded: result.journal.length, dialogue: null };
    return settle(demo, lines);
  }
  return settleTravel(demo, lines);
}
