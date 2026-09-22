/**
 * Standing a room up, and moving the party between rooms.
 *
 * A `DemoScene` is a campaign's half — the party, the project, the log — laid
 * over a room's half: the scene, its grid, its state, its script world. This
 * file builds the room's half (`buildRuntime`), says what the script world
 * needs from the game to do it (`worldOptions`, and the content it reads),
 * and swaps one room for another (`travelTo`, `enterSavedScene`, `install`)
 * with the campaign's half carried across. It reads the demo's rules and the
 * engine, and knows `DemoScene` only as a type: nothing here calls back into
 * the game, so `demo-scene.ts` imports from here and never the other way.
 */

import { startingPools, type DerivedCharacter } from '../engine/character/sheet';
import { SRD_CONDITIONS, type ConditionDef } from '../engine/content/conditions';
import type { LootTable } from '../engine/content/items';
import { mergePack, type ContentPack } from '../engine/content/pack/import';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import type { AdversaryDef } from '../engine/content/types';
import { NO_TILE, type TileGrid } from '../engine/grid/grid';
import { Pathfinder } from '../engine/grid/pathfinding';
import type { Currency, MarkPool } from '../engine/rules/resources';
import { gridFromScene, paletteForProject, tileOf } from '../engine/scene/grid-from-scene';
import { Party } from '../engine/scene/party';
import type { Trait } from '../engine/scene/primitives';
import type { CodeDef, ProjectDoc, SceneDoc } from '../engine/scene/schema';
import { createAdversaryEntity, createPartyEntity, sceneStateFromScene, type SceneState, type SceneStateSnapshot } from '../engine/scene/state';
import { TriggerIndex } from '../engine/scene/triggers';
import { compileHooks, type HookMap } from '../engine/script/hooks';
import { SceneScriptWorld, type SceneScriptWorldOptions, type ScenarioState } from '../engine/script/world';
import { DEMO_ADVERSARIES, DEMO_BAND_TILES, DEMO_CHARACTERS, movementFor } from './demo-rules';
import type { DemoScene, UseOutcome } from './demo-scene';
import { note, type LogLine } from './log';

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
  /** Shadow is the GM's across the session, not the room's. */
  bad?: Currency;
  /** The project's loot tables, so a chest in any room pays out. */
  lootTables?: ReadonlyMap<string, LootTable>;
  /** The project's abilities, conditions and stat blocks, for the world's modifiers. */
  project?: Pick<ProjectDoc, 'abilities' | 'conditionDefs' | 'code' | 'adversaries'> & Partial<Pick<ProjectDoc, 'terrainPalette' | 'structureTypes' | 'jump'>> & ProjectContent;
  /** Ask the defender how they take a hit, rather than deciding for them. */
  askDefender?: boolean;
}

/** The pools a character carries between rooms. */
export interface PartyPools {
  hitPoints: MarkPool;
  stress: MarkPool;
  armorSlots: MarkPool;
  /** Optional only because `EntityState` makes it so; party members always have it. */
  good?: Currency;
}

/**
 * Build the mutable half of a scene.
 *
 * Split out of `buildDemoScene` so travelling can do exactly this again for the
 * room being entered, with the party's pools carried in rather than rolled back
 * to full.
 */
export function buildRuntime(
  scene: SceneDoc,
  characters: ReadonlyMap<string, DerivedCharacter>,
  scenario: ScenarioState,
  options: RuntimeOptions = {},
): SceneRuntime {
  // With the project's own kinds of tile: a room laid from them is otherwise a room of nothing.
  const { grid } = gridFromScene(scene, options.project === undefined ? undefined : paletteForProject(options.project));

  // Stat blocks the document carries itself, which win over the shipped pack:
  // a room may bring the creature it places rather than borrow one.
  const carried = new Map((options.project?.adversaries ?? []).map((def) => [def.id, def]));

  const stats = new Map<string, { id: string; hitPoints: number; stress: number }>();
  for (const encounter of scene.encounters) {
    for (const placement of encounter.adversaries) {
      // Still no substitution: a room that names a creature nobody can look up
      // is a broken document, and saying so beats quietly fielding something
      // else. The project is simply asked before the pack.
      const definition = carried.get(placement.adversary) ?? DEMO_ADVERSARIES.get(placement.adversary);
      if (definition === undefined) {
        throw new Error(`"${scene.id}" places adversary "${placement.adversary}", which has no stat block`);
      }
      stats.set(placement.adversary, {
        id: placement.adversary,
        hitPoints: definition.hitPoints,
        stress: definition.stress,
      });
    }
  }

  const { state } = sceneStateFromScene(scene, grid, {
    adversaries: stats,
    // Whoever the *project* says the party is — a room is stood up for the
    // characters the document carries, not for the ones the demo ships.
    party: [...characters].map(([id, character]) => {
      const carried = options.pools?.get(id);
      const pools = carried ?? startingPools(character);
      return {
        ...createPartyEntity(id, character.sheet.classId, NO_TILE),
        hitPoints: { ...pools.hitPoints },
        stress: { ...pools.stress },
        armorSlots: { ...pools.armorSlots },
        ...(pools.good === undefined ? {} : { good: { ...pools.good } }),
      };
    }),
    ...(options.bad === undefined ? {} : { bad: { ...options.bad } }),
  });

  const pathfinder = new Pathfinder(grid);
  return {
    scene,
    grid,
    state,
    pathfinder,
    party: new Party(state, pathfinder, { combatReach: DEMO_BAND_TILES.close, rules: movementFor(options.project) }),
    triggers: new TriggerIndex(scene, grid),
    world: new SceneScriptWorld(state, scenario, worldOptions(characters, options.lootTables, scene, options.project)),
  };
}

/**
 * The same for conditions: a project may write its own, and inherits the
 * starter pack's and the engine's for everything it does not name - in that
 * order, the project's winning over both.
 *
 * Without this an authored project knows no conditions at all — the schema
 * defaults the list to empty — so Restrained would hold nobody in place and
 * Hidden would hide nobody. Only the demo, which seeds
 * the list by hand, ever worked. The pack's own come in between so that a
 * starter card played where nobody wrote its conditions down still has them:
 * the ring Warding Flame draws, and Hold the Line's two.
 */
function withShippedConditions(defs: readonly ConditionDef[]): readonly ConditionDef[] {
  const seen = new Set(defs.map((def) => def.id));
  const merged = [...defs];
  for (const def of [...STARTER_CONDITIONS, ...SRD_CONDITIONS]) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    merged.push(def);
  }
  return merged;
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
  project?: Pick<ProjectDoc, 'abilities' | 'conditionDefs' | 'code' | 'adversaries'> & Partial<Pick<ProjectDoc, 'jump'>> & ProjectContent,
): SceneScriptWorldOptions {
  return {
    traits: traitsFor(characters),
    characters,
    adversaries: adversaryDefsFor(project),
    bandTiles: DEMO_BAND_TILES,
    movement: movementFor(project),
    // A stat block's features travel with the block. The engine used to merge a shipped
    // catalogue's adversary features in here, so a scene placing a creature got that creature's
    // feature without anyone writing it down; with no catalogue to inherit from, what a project
    // places is what a project carries. Every shipped adversary has `features: []`, so nothing
    // the app does changes — and an imported pack brings its own.
    abilities: project?.abilities ?? STARTER_ABILITIES,
    // Read as the project stands, each time: a card handed to somebody after this world was built
    // is in their hands at once, exactly as an ability written into the project always was.
    cards: () => characterContentFor(project).cards,
    conditionDefs: withShippedConditions(project?.conditionDefs ?? []),
    // The engine's native hooks, then the project's own code, which may
    // override one of them by using the same id. Asked for each time: the
    // editor rewrites a hook in place, and the table plays what it now says.
    hooks: () => hooksFor(project?.code),
    ...(lootTables === undefined ? {} : { lootTables }),
  };
}

/**
 * Compile a project's code once and cache it: a world is rebuilt whenever a
 * sheet changes, and recompiling every card's logic each time would be waste.
 * Compile errors are dropped here — `editor/validate.ts` reports them where a
 * designer can see them.
 */
let compiled: { signature: string; hooks: HookMap } | null = null;

/** What a project with no code runs: nothing. The engine ships no hooks of its own. */
const NO_HOOKS: HookMap = new Map();

export function hooksFor(code: readonly CodeDef[] | undefined): HookMap {
  if (code === undefined || code.length === 0) return NO_HOOKS;
  // Keyed on what the code *says*, not on the array holding it: the editor
  // rewrites an entry in place, and a cache keyed on identity would go on
  // running the version the author has just changed.
  const signature = code.map((entry) => `${entry.id}\x00${entry.source}`).join('\x01');
  if (compiled !== null && compiled.signature === signature) return compiled.hooks;
  const hooks = compileHooks(code).hooks;
  compiled = { signature, hooks };
  return hooks;
}

/**
 * The stat blocks a scene's adversaries answer to.
 *
 * Every id a room places resolves, because `buildRuntime` refuses a room that
 * names one nobody can look up. The scene is still taken as an argument so a
 * caller reads as asking about a room rather than about the SRD.
 */
export function adversaryDefsFor(
  project?: Pick<ProjectDoc, 'adversaries'>,
): ReadonlyMap<string, AdversaryDef> {
  const own = project?.adversaries ?? [];
  if (own.length === 0) return DEMO_ADVERSARIES;
  const merged = new Map(DEMO_ADVERSARIES);
  for (const def of own) merged.set(def.id, def);
  return merged;
}

/** The seven lists of character content a project may carry of its own. */
export type ProjectContent = Pick<
  ProjectDoc,
  'classes' | 'ancestries' | 'communities' | 'subclasses' | 'cards' | 'weapons' | 'armors'
>;

/**
 * The character content a project is played with.
 *
 * The pack the app ships is the base, and anything the project carries is laid
 * over it id for id: a campaign can bring its own class, or a test the single
 * card it is about, without either borrowing from a shipped deck.
 *
 * A project that carries nothing is played with the pack itself, handed back
 * unwrapped — this is read on every sheet write, so the ordinary case does no
 * work at all.
 */
export function characterContentFor(project?: ProjectContent): ContentPack {
  if (project === undefined) return DEMO_CHARACTERS;
  const carries =
    project.classes.length > 0 ||
    project.ancestries.length > 0 ||
    project.communities.length > 0 ||
    project.subclasses.length > 0 ||
    project.cards.length > 0 ||
    project.weapons.length > 0 ||
    project.armors.length > 0;
  return carries ? mergePack(DEMO_CHARACTERS, project) : DEMO_CHARACTERS;
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

/** What each party member is carrying, pool-wise, right now. */
function poolsOf(demo: Pick<DemoScene, 'state'>): Map<string, PartyPools> {
  const pools = new Map<string, PartyPools>();
  for (const entity of demo.state.entitiesOf('party')) {
    pools.set(entity.id, {
      hitPoints: { ...entity.hitPoints },
      stress: { ...entity.stress },
      armorSlots: { ...entity.armorSlots },
      ...(entity.good === undefined ? {} : { good: { ...entity.good } }),
    });
  }
  return pools;
}

/**
 * Move the party to another scene.
 *
 * Wounds, Stress, Light and Shadow travel; where everyone stood does not — the
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
    bad: demo.state.bad,
    lootTables: new Map(demo.project.lootTables.map((table) => [table.id, table])),
    project: demo.project,
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

  // A marked spot is a tile, and a tile means nothing in another room.
  demo.world.forgetSpots();
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
function install(demo: Pick<DemoScene, 'scene' | 'grid' | 'state' | 'pathfinder' | 'party' | 'triggers' | 'world' | 'project' | 'syncedPlacements' | 'destination' | 'pending' | 'encounter'>, runtime: SceneRuntime, selected: string | null): void {
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

  // Entering a room is the moment its document and its state have to agree: a
  // remembered room is restored from a snapshot taken before the designer
  // edited it, and a freshly built one has just read the document anyway.
  syncAuthoredEncounters(demo);

  if (selected !== null && demo.party.members().includes(selected)) demo.party.select(selected);
}

/** The placements a scene can actually stand up: the ones the play grid has a tile for. */
export function playablePlacements(scene: SceneDoc, grid: TileGrid): Set<string> {
  const ids = new Set<string>();
  for (const encounter of scene.encounters) {
    for (const placement of encounter.adversaries) {
      if (grid.indexOf(placement.position.x, placement.position.y) !== NO_TILE) ids.add(placement.id);
    }
  }
  return ids;
}

/**
 * Make the room being played agree with the room the document describes.
 *
 * Called on every entry into a scene and on the way back from the editor, and
 * deliberately not a rebuild: wounds, Shadow, opened chests and a fight in
 * progress all survive it. What it reconciles is the *cast*, against
 * `demo.syncedPlacements` rather than against the state, because "the document
 * places it and the state does not hold it" has two very different causes. A
 * placement the last sync never saw is new and is brought in; one it saw and
 * the document has since dropped is taken out; one it saw that the state has
 * since lost was killed, replaced or otherwise spent, and is left alone.
 *
 * The trigger index is rebuilt from the document each time. It holds no fired
 * state - `TriggerIndex` is a lookup - so a designer's new trigger cell works
 * immediately and an old one does not come back to life.
 */
export function syncAuthoredEncounters(demo: Pick<DemoScene, 'scene' | 'grid' | 'state' | 'party' | 'triggers' | 'project' | 'syncedPlacements'>): void {
  // Back from the editor: a step is as high as the project says now, which may not be what it said.
  demo.party.setRules(movementFor(demo.project));
  const known = demo.syncedPlacements.get(demo.scene.id);
  const placed = playablePlacements(demo.scene, demo.grid);
  if (known !== undefined) {
    for (const encounter of demo.scene.encounters) {
      for (const placement of encounter.adversaries) {
        if (!placed.has(placement.id) || known.has(placement.id)) continue;
        if (demo.state.entity(placement.id) !== undefined) continue;
        // The project is asked before the pack, the way the load path asks it: a
        // room may carry the creature it places rather than borrow one. No
        // substitution either way -- a document naming a creature nobody can look
        // up is broken, and saying so beats quietly fielding something else.
        const definition =
          demo.project.adversaries.find((def) => def.id === placement.adversary) ??
          DEMO_ADVERSARIES.get(placement.adversary);
        if (definition === undefined) {
          throw new Error(`"${demo.scene.id}" places adversary "${placement.adversary}", which has no stat block`);
        }
        demo.state.addEntity(createAdversaryEntity(
          placement.id,
          placement.adversary,
          demo.grid.indexOf(placement.position.x, placement.position.y),
          { hitPoints: placement.hitPoints ?? definition.hitPoints, stress: definition.stress },
        ));
      }
    }
    for (const id of known) {
      if (!placed.has(id)) demo.state.removeEntity(id);
    }
  }
  demo.syncedPlacements.set(demo.scene.id, placed);
  demo.triggers = new TriggerIndex(demo.scene, demo.grid);
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
    project: demo.project,
  });
  // Everything the snapshot holds wins, pools and party tiles included; the
  // freshly built state is only here for the grid and the blocking index.
  runtime.state.restore(snapshot);
  install(demo, runtime, null);
  return true;
}

/**
 * Take on the ground the document now describes, and say whether it was the same room.
 *
 * Nearly always it is - a tile painted, a wall stamped - and the grid everybody holds takes the
 * new ground into itself. A room that has grown is another shape, and a grid is as big as it
 * was made: so the game in it is stood up again on a new one, the way a save is loaded, with
 * everybody where they were (`SceneState.restore` reads the room a snapshot was taken in, and
 * moves them with it). Whoever a growth undone leaves standing on nothing goes back to where
 * the party comes in. False means the caller is holding a grid that is no longer the room.
 */
export function takeGround(demo: DemoScene, scene: SceneDoc, active: TileGrid, fresh: TileGrid): boolean {
  if (active.fits(fresh)) {
    active.adopt(fresh);
    return true;
  }
  if (scene.id !== demo.scene.id) return false;
  const selected = demo.party.selected;
  const snapshot = demo.state.snapshot();
  enterSavedScene(demo, scene.id, snapshot);
  const door = scene.spawns[0];
  for (const entity of demo.state.entitiesOf('party')) {
    if (entity.tile === NO_TILE && snapshot.entities[entity.id]?.tile !== NO_TILE && door !== undefined) demo.state.moveEntity(entity.id, tileOf(demo.grid, door));
  }
  if (selected !== null && demo.party.members().includes(selected)) demo.party.select(selected);
  return false;
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
