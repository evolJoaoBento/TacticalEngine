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

import { CHEST_LOOT, DEMO_ITEMS, DEMO_LOOT_TABLES } from './demo-items';
import { DEMO_TERRAIN, DEMO_VAULT_WALL_X, PIT_SCENE, PIT_SCENE_ID, groundAsTiles, lineUp } from './demo-scenes';
import { BEATEN_TINTS, VAULT_SOUTH_Y } from './demo-map';
import { SHIPPED_MODELS, openProject } from './project-open';
import { DEMO_QUESTS } from './demo-quests';
import { DEMO_CODE, DEMO_PROJECT_ABILITIES, DEMO_PROJECT_CARDS } from './demo-code';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { MAX_SLOTS } from '../engine/rules/resources';
import { walkCheck, type CountName } from '../engine/script/schema';
import { type DamageType, type ParsedDamage } from '../engine/rules/dice';
import type { MarkPool } from '../engine/rules/resources';
import { interactableSchema, projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { SceneStateSnapshot } from '../engine/scene/state';
import { DialogueRunner, type DialogueView } from '../engine/dialogue/dialogue';
import type { Dialogue } from '../engine/dialogue/schema';
import { DEMO_DIALOGUES, PILLAR_DIALOGUE_ID } from './demo-dialogue';
import { DICE_MILLIS, nameOf, note, type Floater, type LogLine, type Motion, type RollShow } from './log';
import { inCombat } from './moment';
import { interactablesOf, nearestCovered } from './prop-use';
import { DEMO_ADVERSARIES, DEMO_ADVERSARY_ID, DEMO_STAIR_ID, PARTY_SHEETS, DEMO_WEAPONS } from './demo-rules';
import { buildRuntime, characterContentFor, playablePlacements, syncAuthoredEncounters, worldOptions } from './room';
import { type DualityRoll, type RollOutcome } from '../engine/rules/duality';
import { ScriptRunner, type JournalEntry, type Prompt } from '../engine/script/runner';
import { createScenarioState, SceneScriptWorld, type ScenarioState } from '../engine/script/world';
import { evaluate } from '../engine/script/conditions';
import { type AttackOutcome } from '../engine/combat/attack';
import { type DefensePlan } from '../engine/combat/defense';
import { type AbilityDef } from '../engine/content/abilities';
import { type DamageSeverity } from '../engine/rules/damage';
import { EncounterRunner } from '../engine/combat/encounter';
import { deriveCharacter, startingPools, type CharacterSheet, type DerivedCharacter } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import type { AdversaryDef } from '../engine/content/types';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE, type TileGrid } from '../engine/grid/grid';
import { Pathfinder } from '../engine/grid/pathfinding';
import { tileOf } from '../engine/scene/grid-from-scene';
import { importLegacyScene, type LegacyMap } from '../engine/scene/legacy-import';
import { Party } from '../engine/scene/party';
import type { SceneDoc } from '../engine/scene/schema';
import { createPartyEntity, type SceneState } from '../engine/scene/state';
import { TriggerIndex } from '../engine/scene/triggers';

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
  /**
   * The placement ids each scene was last stood up from, by scene id.
   *
   * A snapshot remembers what *happened* in a room; this remembers what the
   * *document* said when it last did. The difference is what `syncAuthoredEncounters`
   * acts on: an id the document places and this does not know is new and is
   * brought in, and an id this knows and the document no longer places is gone
   * and is taken out. An id it knows that the state no longer holds is neither -
   * a creature a script removed stays removed rather than rising again.
   */
  syncedPlacements: Map<string, Set<string>>;
  /** A scene a script asked to travel to, acted on once the script settles. */
  destination: string | null;
  /** Conversations the project ships, by id. */
  dialogues: ReadonlyMap<string, Dialogue>;
  /** The narrative log, oldest first. */
  log: LogLine[];
  /**
   * Numbers to float over heads - "-2 HP", "+1 Stress", a condition's name -
   * written where the log line is and read by a view that draws them where
   * the creature stands. Cleared by whoever draws them; a headless run lets
   * them pile up harmlessly.
   */
  floaters: Floater[];
  /**
   * How creatures got where they now are - the path walked, or that they were
   * thrown - for a view that moves a token rather than putting it down. Read
   * and cleared by whoever draws; the board itself is already right.
   */
  motions: Motion[];
  /**
   * Whether somebody draws the motions. Then a walk is not over when the board
   * says so but when the tokens get there, and what the walk woke waits on
   * `arrive`. Headless, a walk is over at once.
   */
  animated: boolean;
  /**
   * The encounter a walk woke, not yet begun: the fight starts when the party
   * arrives at the trigger, not when the board crossed it. Nobody moves or
   * swings in between.
   */
  ambush: string | null;
  /** A thing to use or somebody to talk to once the walk up to them ends (the engine's, `approachThenUse`). */
  approaching: Approach | null;
  /** Waiting on the player: a script's roll or choice, or a defender's answer. */
  pending: Pending | null;
  /** Set while a fight is running. */
  encounter: EncounterRunner | null;
  /**
   * The GM's turn, while it is being played. It stops when a hit puts a
   * choice to the defender and picks up again when they answer.
   */
  gmTurn: GmTurn | null;
  /** Duality rolls the party has made and the view has not shown yet. */
  rolls: RollShow[];
  /**
   * How long a die takes to settle, in milliseconds. The rules never wait for
   * it — it is a view's business — so a test sets it to zero and reads the
   * result the moment it is asked for.
   */
  diceMillis: number;
  /**
   * Whether a hit on a party member asks them how they take it. The demo
   * decides for them by default — a test wants no prompt — and `main.ts`
   * turns it on for a player at the table.
   */
  askDefender: boolean;
}

/** What is left of the GM's turn. */
export interface GmTurn {
  /** Adversaries still to be spotlighted, in order. */
  remaining: string[];
  /** How many have acted so far, for the caller that counts. */
  acted: number;
  /** How many times each adversary has been spotlighted this turn — Relentless. */
  spotlights: Record<string, number>;
  /** Who has already played a stat-block feature this turn. */
  features: Record<string, boolean>;
  /**
   * Adversaries whose next spotlight a feature has already paid for: "spend 2
   * Shadow to spotlight up to five allies". They act without the GM being billed
   * again, which also means the turn does not stop when the pool is empty.
   */
  granted: Set<string>;
  /**
   * Those whose attack deals half damage on the turn they were handed:
   * "attacks they make while spotlighted in this way deal half damage".
   */
  halved: Set<string>;
}

/**
 * A script that stopped to ask the player something.
 *
 * `dialogue` is set when the thing it stopped *on* was a conversation: the
 * dialogue runs to its end, and only then does the script it interrupted carry
 * on. That nesting is why this is one object rather than two fields — the outer
 * runner has to be kept alive across the whole conversation.
 */
export type Pending = PendingScript | PendingDefense | PendingReaction | PendingDeath;

/**
 * "When a PC marks their last Hit Point, they must make a death move by
 * choosing one of the following options."
 *
 * The one question in the fight the engine cannot answer for the player, and
 * the fight stops for it: the GM's turn keeps its place, the queue behind it
 * does not move, and nobody counts who is left standing until it is answered -
 * which is the whole point, because two of the three moves can put the
 * character back on their feet.
 */
export interface PendingDeath {
  kind: 'death';
  /** A choice prompt, so a UI that can draw a script's choice can draw this. */
  prompt: Prompt;
  /** Who marked their last Hit Point. */
  who: string;
  /** The moves on offer, in the order the prompt lists them. */
  moves: readonly DeathMove[];
  /**
   * Cards that answer the fall itself, offered after the three moves.
   *
   * "When you mark your last Hit Point, instead of making a death move, you
   * can roll a d6 and clear a number of Hit Points equal to the result": a
   * card in place of the move, so it belongs in the same question rather than
   * in one asked before or after it.
   */
  offers: readonly ReactionOffer[];
}

/**
 * The SRD's three, and the order they are offered in.
 *
 * Not the order the SRD prints them: stepping back from a question is always
 * its first option here, and the one that leaves the fight standing where it
 * is - the one the engine took before there was anything to ask - is Avoid
 * Death. Blaze of Glory and Risk It All both end a character on a bad day, and
 * neither should be what a closed prompt picks.
 */
export type DeathMove = 'avoid' | 'blaze' | 'risk';

/**
 * A card of the party's that answers something which has already happened: a
 * wound they took, a wound they dealt.
 *
 * The interrupt shape, not the automatic one. "You can spend 2 Light to clear a
 * Hit Point on an ally" is a decision, and the SRD gives it to the player, so
 * the fight stops and asks. A free reaction with nothing to weigh - Rise Up's
 * "clear a Stress" - never reaches here: it simply happens.
 */
export interface PendingReaction {
  kind: 'reaction';
  /** A choice prompt, so a UI that can draw a script's choice can draw this. */
  prompt: Prompt;
  /** What this character can play, in the order offered. Index 0 declines. */
  offers: readonly ReactionOffer[];
  /**
   * A swing waiting on this answer. The party's own blow stops between the
   * roll and the counting - "spend any number of tokens to add a d6 for each"
   * - and lands once the question is done with, whichever way it was answered.
   */
  landing?: HeldSwing;
  /**
   * A script stopped mid-roll behind this question: its dice are read and its
   * arms have not run, and it settles once the room has said what it says.
   */
  resuming?: ResumingScript;
  /**
   * Offers still to be put to somebody once this question is answered. A blow
   * can leave several people with something to say, and the queue is built
   * before the first is asked: `drainDamage` empties as it reports, so what is
   * not carried here is gone.
   */
  queued: readonly (readonly ReactionOffer[])[];
}

/** One card, ready to run, with everything the blow left behind. */
export interface ReactionOffer {
  by: string;
  ability: AbilityDef;
  /** Who the card is aimed at: whoever struck, or whoever was struck. */
  targets: readonly string[];
  /**
   * The other one, when the moment has two: "when an ally deals damage to an
   * adversary" binds the ally as the target and the adversary here, so a card
   * can reach past the first to the second. Left out, the target is both,
   * which is what every trigger with one creature in it means.
   */
  hit?: readonly string[];
  counts: Partial<Record<CountName, number>>;
  lastDamage?: { total: number; types: readonly DamageType[] };
  /**
   * The roll that raised it, for a card that asks what the dice said: "when
   * you critically succeed on an attack". Only a roll somebody watched land -
   * an adversary's d20 is not one, and nothing on a card asks about it.
   */
  roll?: { total: number; outcome: RollOutcome };
  /**
   * And the dice behind it, when the moment was a swing: a card that reuses the
   * attack roll rather than asking what it came to needs the throw itself.
   */
  swing?: DualityRoll;
}

/**
 * A hit that is waiting on the defender.
 *
 * The SRD makes taking damage a decision — mark an Armor Slot, mark a Stress
 * to Get Back Up, spend a Light on a Rune Ward, or let an ally stand in the
 * way. The engine can make it for you (`askDefender: false`, and every test
 * that predates the prompt does); with a player at the table it is asked.
 */
export interface PendingDefense {
  kind: 'defense';
  /** A choice prompt, so a UI that can draw a script's choice can draw this. */
  prompt: Prompt;
  attack: IncomingAttack;
  choices: readonly DefenseChoice[];
}

/**
 * A swing of the party's that has hit and not yet been counted, held while the
 * one who threw it decides what to put behind it.
 *
 * The same moment the GM's swing stops at, and held the same way a hit is held
 * while its defender decides: as data, not as a closure, because everything
 * else about a paused fight is data too.
 */
export interface HeldSwing {
  attacker: string;
  target: string;
  outcome: AttackOutcome;
  /** The weapon's name, for the line the log writes when it lands. */
  weapon: string;
  melee: boolean;
  /** What the weapon's damage is, for a blow that has to be counted again. */
  damage: ParsedDamage;
  direct?: boolean;
  /** What the room put behind it while it was held. */
  boost?: number;
  /** The roll counts twice - Smite's charge, spent on this swing. */
  doubled?: boolean;
  /** And counts as this instead of the weapon's own kind of damage. */
  types?: readonly DamageType[];
  /** Hit Points a card fixed outright, in place of counting the damage at all. */
  forced?: number;
  /** Or the band it lands in, which armor can still step down. */
  severity?: DamageSeverity;
  /** Or the band it lands in at worst: a floor under a blow counted as usual. */
  floor?: DamageSeverity;
  /**
   * Where in the swing it was stopped, for a question that has to be answered
   * before the next stage rather than before it lands.
   *
   * `rolled` is the moment after the Duality Dice and before anything has come
   * of them, which is where a card that rerolls them is asked. Everything else
   * is held at the usual place - the blow has landed and is being counted - and
   * carries no stage at all.
   */
  stage?: 'rolled';
  /**
   * The roll has paid out already -- the Light, the Shadow, a critical's Stress -- so landing counts
   * only the blow. Set in `afterRolled`, where nothing can change the Duality Dice any more.
   */
  settled?: true;
}

/** One hit, as it stands while the defender decides. */
export interface IncomingAttack {
  attacker: string;
  /** Who takes it — not always who it was aimed at, once someone steps in. */
  defender: string;
  outcome: AttackOutcome;
  /** The adversary's stat block, for the lines the log writes. */
  def: AdversaryDef;
  /** Cards already spent against this hit, so one card fires once. */
  used: string[];
  /**
   * The band a feature named for it mid-swing, in place of the dice: "spend a
   * Shadow to deal Severe damage instead of their standard damage". A band the
   * block's own passive names is read off the stat block instead, so it is not
   * carried here.
   */
  severity?: DamageSeverity;
  /** Bands a card of the defender's stepped it down, after the armor. */
  stepped?: number;
}

/** Something the defender's side can do about a hit. */
export type DefenseChoice =
  | { kind: 'plan'; label: string; plan: DefensePlan }
  /** Nothing to answer with, or nothing chosen: the blow simply misses. */
  | { kind: 'none'; label: string }
  /** A card whose own effects answer the attack — Vanishing Dodge on a miss. */
  | { kind: 'react'; label: string; by: string; ability: AbilityDef }
  /**
   * A card that answers the blow with a script of its own: thorns that take
   * dice off it, a step that gets out of its way. Offered without a number,
   * because what it is worth is not known until it has been played, and the
   * blow is put to the defender again once it has.
   */
  | { kind: 'script'; label: string; by: string; ability: AbilityDef }
  | { kind: 'redirect'; label: string; by: string; ability: AbilityDef }
  | { kind: 'reroll'; label: string; by: string; ability: AbilityDef; what: 'attack' | 'damage' };

export interface PendingScript {
  kind: 'script';
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
  /** The creature a conversation is with, bound as the `target` of everything said in it. */
  with?: string;
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
  /** The member having it: held while it is set aside for somebody else (`game/talks.ts`). */
  by?: string;
  /**
   * The node whose lines are already in the log.
   *
   * What a character *says* lives in the view, not the journal, so a transcript
   * has to be written as nodes are entered — and only once each, because a node
   * offering replies keeps handing back the same view until one is picked.
   */
  spokenNode: string | null;
}

/**
 * Put each party member's pools in step with what their sheet and their
 * conditions say the maximum is: Tava's Armor adds an Armor Slot while it
 * lasts, and takes it back when it ends. Marks are kept, clamped.
 */
/**
 * Write a sheet back.
 *
 * A character is written down twice — the map the game reads and the list the
 * project carries — and the two must not drift: a level taken at the table, a
 * card swapped, a save restored, all of it belongs in the document, or the
 * next time the party is rebuilt from it the change is gone. Every place that
 * changes a sheet goes through here.
 */
export function setSheet(demo: Pick<DemoScene, 'sheets' | 'project' | 'characters'>, sheet: CharacterSheet): void {
  demo.sheets.set(sheet.id, sheet);
  const at = demo.project.party.findIndex((s) => s.id === sheet.id);
  if (at >= 0) demo.project.party[at] = characterSheetSchema.parse(sheet);
  demo.characters.set(
    sheet.id,
    deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character,
  );
}

/**
 * Bring the party on the board into step with the party in the project.
 *
 * A character added in the Party panel has a sheet and nothing else: nobody
 * derived them, nothing stood them on the map. Pressing Play is when they
 * arrive - beside whoever the party is standing around, with the pools a fresh
 * sheet starts with, and a line in the log saying so. The spotlight tracker
 * reads the party off the board each time it asks who is ready, so a newcomer
 * can walk into a fight and act in it.
 *
 * One removed from the panel walks off the same way, but not out of a fight:
 * pulling a creature out from under a spotlight that may be on them is not an
 * edit, so a leaver waits for the fight to end and goes on the next Play.
 *
 * Idempotent: the panel slugs a typed name into an id, and two Newcomers are
 * one id, which the board already has.
 */
export function syncRoster(demo: Pick<DemoScene, 'scene' | 'grid' | 'state' | 'party' | 'sheets' | 'characters' | 'world' | 'project' | 'log' | 'encounter'>): { joined: string[]; left: string[] } {
  const joined: string[] = [];
  const left: string[] = [];

  for (const sheet of demo.project.party) {
    if (demo.state.entity(sheet.id) !== undefined) continue;
    demo.sheets.set(sheet.id, sheet);
    const character = deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character;
    demo.characters.set(sheet.id, character);
    const pools = startingPools(character);
    demo.state.addEntity({
      ...createPartyEntity(sheet.id, sheet.classId, roomBeside(demo)),
      hitPoints: { ...pools.hitPoints },
      stress: { ...pools.stress },
      armorSlots: { ...pools.armorSlots },
      ...(pools.good === undefined ? {} : { good: { ...pools.good } }),
    });
    if (demo.party.selected === null) demo.party.select(sheet.id);
    joined.push(sheet.id);
    note(demo, `${nameOf(demo, sheet.id)} joins the party.`, 'system');
  }

  if (!inCombat(demo)) {
    const listed = new Set(demo.project.party.map((s) => s.id));
    for (const entity of demo.state.entitiesOf('party')) {
      if (listed.has(entity.id)) continue;
      // The name before the body goes, or the log would read an id.
      const name = nameOf(demo, entity.id);
      demo.state.removeEntity(entity.id);
      demo.sheets.delete(entity.id);
      demo.characters.delete(entity.id);
      if (demo.party.selected === entity.id) demo.party.selectNext();
      left.push(entity.id);
      note(demo, `${name} leaves the party.`, 'system');
    }
  }

  return { joined, left };
}

/**
 * The nearest free tile to the party: next to whoever is selected, failing
 * that next to anyone standing, failing that the room's first spawn. Off the
 * board when the room has no floor to give, which is what a sheet without a
 * scene gets at boot too.
 */
function roomBeside(demo: Pick<DemoScene, 'scene' | 'grid' | 'state' | 'party'>): number {
  const standing = demo.state.entitiesOf('party').filter((e) => e.tile !== NO_TILE);
  const selected = standing.find((e) => e.id === demo.party.selected);
  const spawn = demo.scene.spawns[0];
  const from = selected?.tile ?? standing[0]?.tile ?? (spawn === undefined ? NO_TILE : tileOf(demo.grid, spawn));
  return freeTileNear(demo, from);
}

/**
 * Stand the party around a tile: whoever is selected on it or as near as the
 * floor allows, the rest on the nearest free tiles after them. What a
 * designer pressing "play from here" means, and what a script that gathers
 * the party somewhere means too. Nobody is walked: they are put down.
 */
export function gatherParty(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'world'>, tile: number): void {
  if (!demo.grid.isTile(tile)) return;
  const living = demo.state.entitiesOf('party').filter((e) => e.alive);
  const first = living.find((e) => e.id === demo.party.selected);
  const order = first === undefined ? living : [first, ...living.filter((e) => e !== first)];
  for (const member of order) {
    // Off the board while the search runs, so their old tile is not "taken" and
    // the one they stand on now is.
    demo.state.moveEntity(member.id, NO_TILE);
    const spot = freeTileNear(demo, tile);
    if (spot !== NO_TILE) demo.state.moveEntity(member.id, spot);
  }
  demo.world.refreshZones();
}

/** The nearest free passable tile to `from`, `from` itself when it is one; `NO_TILE` for nowhere. */
export function freeTileNear(demo: Pick<DemoScene, 'grid' | 'state'>, from: number): number {
  if (from === NO_TILE) return NO_TILE;
  const grid = demo.grid;
  const free = (tile: number): boolean => demo.state.bodyFree(tile);
  if (free(from)) return from;
  // Breadth-first, so the first free tile found is the closest one.
  const seen = new Set<number>([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    let found = NO_TILE;
    grid.forEachNeighbor(queue[i]!, false, (next) => {
      if (found !== NO_TILE || seen.has(next)) return;
      seen.add(next);
      if (free(next)) found = next;
      else if (grid.isPassable(next)) queue.push(next);
    });
    if (found !== NO_TILE) return found;
  }
  return NO_TILE;
}

export function syncPools(demo: Pick<DemoScene, 'state' | 'characters' | 'world'>): void {
  for (const entity of demo.state.entitiesOf('party')) {
    const character = demo.characters.get(entity.id);
    if (character === undefined) continue;
    const fit = (pool: MarkPool, max: number): MarkPool =>
      pool.max === max ? pool : { max, marked: Math.min(pool.marked, max) };
    entity.armorSlots = fit(entity.armorSlots, Math.min(MAX_SLOTS, Math.max(0, character.armorScore + demo.world.poolBonus(entity.id, 'armorScore'))));
    entity.hitPoints = fit(entity.hitPoints, Math.min(MAX_SLOTS, Math.max(1, character.hitPoints + demo.world.poolBonus(entity.id, 'hitPoints'))));
    entity.stress = fit(entity.stress, Math.min(MAX_SLOTS, Math.max(1, character.stress + demo.world.poolBonus(entity.id, 'stress'))));
  }
}

/**
 * What changing a sheet at the table touches: the sheet and what is derived
 * from it, the moment (no fight, no prompt), the world rebuilt to read it, and
 * the log that says so. `applyLevelUp` and `equipItem` both take exactly this.
 */
export type SheetChange = Pick<
  DemoScene,
  'sheets' | 'characters' | 'project' | 'scenario' | 'pending' | 'encounter' | 'state' | 'world' | 'scene' | 'gmTurn' | 'log'
>;

/** Rebuild the script world after a sheet changed under it. */
export function refreshWorld(
  demo: Pick<DemoScene, 'world' | 'state' | 'scenario' | 'characters' | 'project' | 'scene' | 'gmTurn'>,
): void {
  demo.world = new SceneScriptWorld(
    demo.state,
    demo.scenario,
    worldOptions(demo.characters, new Map(demo.project.lootTables.map((table) => [table.id, table])), demo.scene, demo.project),
  );
  bindTurn(demo);
  // A rebuilt world reads the ground again: a save loaded back into the middle
  // of a fight has zones on the board and creatures standing in them.
  demo.world.refreshZones();
}

export function buildDemoScene(map: LegacyMap, seed = 'demo'): DemoScene {
  const imported = importLegacyScene(map);
  const vault = imported.scene;
  if (vault === null) throw new Error('the demo map could not be imported');

  // The prototype's husks are homebrew ids with no SRD stat block. Point them
  // at the one imported adversary that stands in for them *in the document*,
  // rather than substituting at runtime: what the project says is then what it
  // plays, and saving it and loading it back gives the same fight.
  if (!DEMO_ADVERSARIES.has(DEMO_ADVERSARY_ID)) throw new Error(`missing adversary "${DEMO_ADVERSARY_ID}"`);
  for (const encounter of vault.encounters) {
    for (const placement of encounter.adversaries) {
      if (!DEMO_ADVERSARIES.has(placement.adversary)) placement.adversary = DEMO_ADVERSARY_ID;
    }
  }

  vault.encounters.push(lineUp()); // one of every stat block along the back wall, never fought
  // The room relaid as tiles: flagstone inside the vault, road where the trail and the water run.
  groundAsTiles(vault, (x, y) => x >= DEMO_VAULT_WALL_X && y < VAULT_SOUTH_Y, (x, y) => BEATEN_TINTS.has(vault.tints?.[y * vault.width + x] ?? ''));

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
    // The party holds the starter pack's cards, so the starter pack's abilities
    // are what those cards do. Nothing else is listed: stat-block features used to be
    // inherited from a shipped catalogue, and now travel with whatever pack carries the
    // block.
    cards: [...DEMO_PROJECT_CARDS],
    abilities: [...STARTER_ABILITIES, ...DEMO_PROJECT_ABILITIES],
    code: [...DEMO_CODE],
    // The pack's own conditions first, so a card that ships one wins over a
    // rules condition of the same name. Nothing clashes today; the order is the
    // statement of which owns the id when something does.
    conditionDefs: [...STARTER_CONDITIONS, ...SRD_CONDITIONS.filter((c) => !STARTER_CONDITIONS.some((s) => s.id === c.id))],
    party: [...PARTY_SHEETS], assets: [...SHIPPED_MODELS], terrainPalette: [...DEMO_TERRAIN], weapons: [...DEMO_WEAPONS],
    startScene: vault.id,
  });

  // The legacy `loot` effect named no table, because the prototype had no items.
  // Point it at one, so opening the chest actually pays out.
  const vaultDoc = project.scenes.find((scene) => scene.id === vault.id)!;
  for (const object of vaultDoc.interactables) {
    if (object.check === undefined) continue;
    walkCheck(object.check, (effect) => {
      if (effect.kind === 'loot' && effect.table === undefined) effect.table = CHEST_LOOT;
    });
  }

  return buildProjectScene(project, seed);
}

/**
 * Stand a game up from a project document.
 *
 * Nothing here knows anything about the demo: hand it a project — a party, a
 * scene to open on, whatever the rest of it holds — and it plays. That is the
 * claim `docs/CRPG-GAPS.md` makes about the editor, so it is worth being a
 * function rather than the tail of one that starts from a legacy map.
 */
export function buildProjectScene(project: ProjectDoc, seed = 'project'): DemoScene {
  // Everything is read out of the *project*, not the literals it was parsed from: `projectSchema.parse`
  // copies, so keeping the originals would leave the editor and the game editing two documents that
  // only look alike — a scene added in one would be invisible to the other.
  openProject(project); // objects are props with a function now, and the models folder is every project's
  const sheets = new Map<string, CharacterSheet>(project.party.map((sheet) => [sheet.id, sheet]));

  // Derive every sheet once, with the project's abilities folded in; the pools
  // a character enters a scene with come straight off it, so nothing about
  // them is written down twice.
  const characters = new Map<string, DerivedCharacter>();
  for (const sheet of sheets.values()) {
    characters.set(sheet.id, deriveCharacter(sheet, characterContentFor(project), project.abilities).character);
  }

  const opening = project.scenes.find((scene) => scene.id === project.startScene);
  if (opening === undefined) throw new Error(`the project opens on "${project.startScene}", which it does not have`);

  const scenario = createScenarioState();
  const lootTables = new Map(project.lootTables.map((table) => [table.id, table]));
  const runtime = buildRuntime(opening, characters, scenario, { lootTables, project });

  const demo: DemoScene = {
    ...runtime,
    sheets,
    characters,
    rng: createRng(seed),
    scenario,
    project,
    snapshots: new Map(),
    // The opening room was just stood up from its document, so every placement
    // in it is already known. Leaving this empty would make the first sync -
    // the one on the way back from the editor - think the whole cast was new.
    syncedPlacements: new Map([[opening.id, playablePlacements(opening, runtime.grid)]]),
    destination: null,
    dialogues: new Map(project.dialogues.map((d) => [d.id, d])),
    log: [],
    floaters: [],
    motions: [],
    animated: false,
    ambush: null,
    approaching: null,
    pending: null,
    encounter: null,
    gmTurn: null,
    rolls: [],
    diceMillis: DICE_MILLIS,
    askDefender: false,
  };
  bindTurn(demo);
  return demo;
}

/**
 * Tell the world who has already acted this GM turn.
 *
 * The world runs the scripts and knows nothing about whose turn it is; the
 * turn lives here. A swarm feature is the one thing that needs both, so this
 * is the one wire between them, and it is re-tied whenever the world is
 * rebuilt.
 */
function bindTurn(demo: Pick<DemoScene, 'world' | 'gmTurn'>): void {
  demo.world.spotlightSpent = (id) => (demo.gmTurn?.spotlights[id] ?? 0) > 0;
}

/**
 * Whether one creature is what an ability is looking for: "a target with 3 or
 * more bramble tokens".
 *
 * Read from the user's chair with the candidate bound as the target, which is
 * the same pair of chairs every other gate is read from. One place, because
 * the player's list of who they may click and the GM's list of who is worth a
 * Stress have to agree.
 */
export function worthAiming(
  demo: Pick<DemoScene, 'world' | 'scenario'>,
  userId: string,
  ability: AbilityDef,
  candidateId: string,
): boolean {
  if (ability.target.when === undefined) return true;
  const was = demo.scenario.actorId;
  demo.scenario.actorId = userId;
  try {
    return evaluate(ability.target.when, demo.world, { targets: [candidateId], hit: [candidateId] });
  } finally {
    demo.scenario.actorId = was;
  }
}

/**
 * A script stopped mid-roll, waiting on whatever the room says about it.
 *
 * The conversation-inside-a-script pattern, one level smaller: the outer script
 * is held while its question is put, and `said` collects what the answering
 * cards journalled so the roll can be settled around it.
 */
export interface ResumingScript {
  script: PendingScript;
  said: JournalEntry[];
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

/** The nearest thing the selected member could use right now, if any. */
export function reachableInteractable(demo: Pick<DemoScene, 'scene' | 'grid' | 'state' | 'party'>): string | null {
  const actor = demo.party.selected;
  if (actor === null) return null;
  const here = demo.state.entity(actor)?.tile ?? NO_TILE;
  if (here === NO_TILE) return null;
  for (const object of interactablesOf(demo.scene)) {
    const there = nearestCovered(demo, object.id, here);
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
/** What a walk is for: the thing to use, or the creature to talk to, and who is walking there. */
export interface Approach {
  kind: 'use' | 'talk';
  id: string;
  who: string;
}

