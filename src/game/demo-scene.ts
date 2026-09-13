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
import { PIT_SCENE, PIT_SCENE_ID } from './demo-scenes';
import { DEMO_QUESTS } from './demo-quests';
import { SRD_HOOKS } from '../engine/script/native-hooks';
import { compileHooks, mergeHooks, type HookMap } from '../engine/script/hooks';
import { DEMO_CODE, DEMO_PROJECT_ABILITIES, DEMO_PROJECT_CARDS } from './demo-code';
import { SRD_CONDITIONS, type ConditionDef } from '../engine/content/conditions';
import { MAX_SLOTS } from '../engine/rules/resources';
import { walkCheck, walkEffects, type Condition, type CountName, type Effect, type TargetSelector } from '../engine/script/schema';
import { rollDice } from '../engine/rules/dice';
import type { DamageType } from '../engine/rules/dice';
import type { ItemDef, LootTable } from '../engine/content/items';
import type { QuestDef } from '../engine/content/quests';
import type { Currency, MarkPool } from '../engine/rules/resources';
import { interactableSchema, projectSchema, type CodeDef, type ProjectDoc } from '../engine/scene/schema';
import type { EntityState, SceneStateSnapshot } from '../engine/scene/state';
import { DialogueRunner, type DialogueView } from '../engine/dialogue/dialogue';
import type { Dialogue } from '../engine/dialogue/schema';
import { DEMO_DIALOGUES, PILLAR_DIALOGUE_ID } from './demo-dialogue';
import { useInteractable } from '../engine/scene/interact';
import type { Trait } from '../engine/scene/primitives';
import type { CheckOutcome, LogTone } from '../engine/script/effects';
import { BAD_DIE_SIDES, GOOD_DIE_SIDES, rollDuality, withFaces, type DualityRoll, type RollOutcome } from '../engine/rules/duality';
import type { CountdownCue } from '../engine/rules/countdown';
import type { CountdownMoved, RunningCountdown } from '../engine/script/countdowns';
import { ScriptRunner, type JournalEntry, type Prompt, type Response } from '../engine/script/runner';
import type { CheckTrait } from '../engine/script/schema';
import { createScenarioState, SceneScriptWorld, useKey, type Payout, type SceneScriptWorldOptions, type ScenarioState } from '../engine/script/world';
import { NO_BINDINGS, evaluate, evaluateOptional } from '../engine/script/conditions';
import { maxTilesForBand, reaches, type RangeBand } from '../engine/rules/range';
import { levelUp, type LevelUpIssue, type LevelUpPlan } from '../engine/character/progression';
import { applyAttack, applyRoll, resolveAttack, type AttackOutcome, type AttackProfile } from '../engine/combat/attack';
import { evaluateTarget } from '../engine/combat/targeting';
import { adversaryTraits, attackDamageOf } from '../engine/combat/adversary-features';
import {
  canPayFor,
  previewPlan,
  resolveDefensePlan,
  type Defender,
  type DefensePlan,
} from '../engine/combat/defense';
import { abilitySchema, cardOf, loadoutOf, readsATarget, type AbilityDef } from '../engine/content/abilities';
import { gain, unmarked } from '../engine/rules/resources';
import {
  hpForSeverity,
  isSevere,
  reduceSeverity,
  SEVERITY_ORDER,
  resolveDamage,
  rollDamage,
  rollReduction,
  type DamageRollResult,
  type DamageSeverity,
  type IncomingDamage,
  type ResolvedDamage,
} from '../engine/rules/damage';
import type { ParsedDamage } from '../engine/rules/dice';
import { EncounterRunner } from '../engine/combat/encounter';
import {
  attackProfile,
  blankSheet,
  deriveCharacter,
  startingPools,
  type CharacterSheet,
  type DerivedCharacter,
} from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { mergePack, type ContentPack, type WeaponDef } from '../engine/content/pack/import';
import { STARTER_ABILITIES, STARTER_ADVERSARIES, STARTER_CHARACTERS, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import type { AdversaryDef } from '../engine/content/types';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE, type Spot, type TileGrid } from '../engine/grid/grid';
import { DEFAULT_MOVEMENT, Pathfinder, tracePath, type MovementRules, type ReachableField } from '../engine/grid/pathfinding';
import { DEFAULT_WALK, smoothPath, type WalkRules } from '../engine/grid/walk';
import { gridFromScene, tileOf } from '../engine/scene/grid-from-scene';
import { importLegacyScene, type LegacyMap } from '../engine/scene/legacy-import';
import { Party } from '../engine/scene/party';
import type { SceneDoc } from '../engine/scene/schema';
import { createAdversaryEntity, createPartyEntity, sceneStateFromScene, type SceneState } from '../engine/scene/state';
import { TriggerIndex } from '../engine/scene/triggers';

/** Adversary stat blocks, keyed by content id, from the pack the engine ships with. */
export const DEMO_ADVERSARIES: ReadonlyMap<string, AdversaryDef> = STARTER_ADVERSARIES;

/**
 * The prototype's creature types are its own homebrew, and the starter pack has
 * no stat block under those names, so the demo stands one of its own in their
 * place — the same substitution the end-to-end combat test makes.
 *
 * Every creature the legacy map places currently becomes this one. Giving the
 * map's three types a stat block each is a small change to `LEGACY_ADVERSARY_IDS`
 * and would put the variety back.
 */
export const DEMO_ADVERSARY_ID = 'hollow-knight';

/** The way out of the vault, added by the demo because the legacy map had none. */
export const DEMO_STAIR_ID = 'stair-down';

/** Tight bands, so a 22x16 map spans more than one of them. */
export const DEMO_BAND_TILES = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

/**
 * Nobody walks in an L on a battlemap: every creature in the demo steps
 * diagonally, at the price of a diagonal, and does not cut a corner it could
 * not squeeze through.
 */
export const DEMO_MOVEMENT: MovementRules = { ...DEFAULT_MOVEMENT, diagonals: true, diagonalCostMultiplier: Math.SQRT2 };

/** The body a creature in the demo walks with. */
export const DEMO_WALK: WalkRules = { ...DEFAULT_WALK, maxStepHeight: DEMO_MOVEMENT.maxStepHeight };

/**
 * Which model an entity uses. Party members carry a class name and adversaries an
 * SRD content id; neither is a model id, so the demo maps them.
 */
export const DEMO_MODELS: Readonly<Record<string, string>> = {
  // The starter pack's three classes, on the hero bodies the library has. A
  // class without a line here would stand as the magenta placeholder - which is
  // the library's honest "asked for a model I do not have", so this is a map to
  // keep complete rather than a fallback to hide behind.
  sentinel: 'knight',
  cutpurse: 'rogue',
  emberwright: 'mage',
  // Its adversaries. One without a line draws the stand-in body rather than the
  // placeholder, because `fallbackFor` answers for adversaries in `main.ts`.
  'hollow-knight': 'husk',
  'briar-wraith': 'bramble',
};

/** Classes, ancestries, communities, armor and weapons, from the pack we ship. */
export const DEMO_CHARACTERS = STARTER_CHARACTERS;

/**
 * The demo party, as authored character sheets.
 *
 * Everything mechanical — Evasion, Hit Points, damage thresholds, Armor Slots and
 * the trait each attack rolls — is derived from the class, ancestry and equipment
 * these name, rather than written down here.
 */
export const PARTY_SHEETS: readonly CharacterSheet[] = [
  blankSheet('kara', 'sentinel', {
    name: 'Kara',
    traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
    ancestryId: 'stoneborn',
    communityId: 'wayfarer',
    armorId: 'ringmail',
    primaryWeaponId: 'longsword',
    subclassId: 'shieldbearer',
    domainCards: ['power-slash', 'iron-stance'],
    experiences: [{ name: 'Held the line', modifier: 2 }],
  }),
  blankSheet('finn', 'cutpurse', {
    name: 'Finn',
    traits: { agility: 2, strength: -1, finesse: 2, instinct: 1, presence: 0, knowledge: 0 },
    ancestryId: 'sylvan',
    communityId: 'guildsworn',
    armorId: 'padded-coat',
    primaryWeaponId: 'hunting-bow',
    subclassId: 'lampsnuffer',
    domainCards: ['quick-hands', 'backstab'],
    experiences: [{ name: 'Knows a locksmith', modifier: 2 }],
  }),
  blankSheet('mira', 'emberwright', {
    name: 'Mira',
    traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 2 },
    ancestryId: 'human',
    communityId: 'guildsworn',
    armorId: 'padded-coat',
    primaryWeaponId: 'ember-staff',
    subclassId: 'flamecaller',
    domainCards: ['arcane-ward', 'healing-word'],
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

/** A line in the narrative pane. */
/** How somebody got where they are: along a path, or flung - or that a blow landed on them. */
export interface Motion {
  id: string;
  /** The tiles walked, the first the one left. */
  path?: readonly number[];
  /** The line actually crossed, from where they stood to where they stopped; the path when left out. */
  route?: readonly Spot[];
  thrown?: true;
  /** A wound landed; the token takes it. */
  struck?: true;
  /** They swung at this tile; the token lunges that way. */
  lunge?: { at: number };
}

/** One number over one head, in the tone the matching log line has. */
export interface Floater {
  id: string;
  text: string;
  tone: LogTone;
}

export interface LogLine {
  text: string;
  tone: LogTone;
  /**
   * The creatures this line names, and where in it their names are.
   *
   * Collected once, where the line is written and the board is to hand, so the
   * panel does not have to know what a creature is called. A UI that wants to
   * point at somebody hovers the name; one that does not can ignore this and
   * print `text`.
   */
  mentions?: readonly { id: string; name: string }[];
}

/**
 * A Duality roll waiting to be shown: two dice the table watches settle.
 *
 * Only the party rolls these — an adversary rolls a d20, which has nothing to
 * watch — so anything in this queue is a player's roll. The rules are already
 * settled by the time one lands here: the faces are what was rolled, and the
 * dice are shown landing on them rather than deciding anything.
 */
export interface RollShow {
  /** Rising, so a view can tell a new roll from the same one re-rendered. */
  id: number;
  /** Who rolled it, ready to print. */
  who: string;
  /** What the roll was for: "the Broadsword", "Agility". */
  what: string;
  roll: DualityRoll;
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

const DEATH_MOVES: readonly DeathMove[] = ['avoid', 'blaze', 'risk'];

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

/** The waiting script, when what is waiting is a script and not a defender. */
export function scriptPending(demo: DemoScene): PendingScript | null {
  return demo.pending !== null && demo.pending.kind === 'script' ? demo.pending : null;
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
  /** Shadow is the GM's across the session, not the room's. */
  bad?: Currency;
  /** The project's loot tables, so a chest in any room pays out. */
  lootTables?: ReadonlyMap<string, LootTable>;
  /** The project's abilities, conditions and stat blocks, for the world's modifiers. */
  project?: Pick<ProjectDoc, 'abilities' | 'conditionDefs' | 'code' | 'adversaries'> & ProjectContent;
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
function buildRuntime(
  scene: SceneDoc,
  characters: ReadonlyMap<string, DerivedCharacter>,
  scenario: ScenarioState,
  options: RuntimeOptions = {},
): SceneRuntime {
  const { grid } = gridFromScene(scene);

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
    party: new Party(state, pathfinder, { combatReach: DEMO_BAND_TILES.close, rules: DEMO_MOVEMENT }),
    triggers: new TriggerIndex(scene, grid),
    world: new SceneScriptWorld(state, scenario, worldOptions(characters, options.lootTables, scene, options.project)),
  };
}

/**
 * What a script world needs from the demo: the party's best traits for an
 * object's check, each sheet for a card's roll, the stat blocks for an
 * adversary's Difficulty, and the map's range bands. One place, because the
 * world is rebuilt whenever a sheet changes and a site that forgot the stat
 * blocks would roll every spell against the fallback numbers.
 */
/**
 * The same for conditions: a project may write its own, and inherits the
 * SRD's for everything it does not name.
 *
 * Without this an authored project knows no conditions at all — the schema
 * defaults the list to empty — so Restrained would hold nobody in place and a
 * Chilled arm would swing as well as a warm one. Only the demo, which seeds
 * the list by hand, ever worked.
 */
function withSrdConditions(defs: readonly ConditionDef[]): readonly ConditionDef[] {
  const own = new Set(defs.map((def) => def.id));
  return [...defs, ...SRD_CONDITIONS.filter((def) => !own.has(def.id))];
}

export function worldOptions(
  characters: ReadonlyMap<string, DerivedCharacter>,
  lootTables?: ReadonlyMap<string, LootTable>,
  scene?: SceneDoc,
  project?: Pick<ProjectDoc, 'abilities' | 'conditionDefs' | 'code' | 'adversaries'> & ProjectContent,
): SceneScriptWorldOptions {
  return {
    traits: traitsFor(characters),
    characters,
    adversaries: adversaryDefsFor(project),
    bandTiles: DEMO_BAND_TILES,
    movement: DEMO_MOVEMENT,
    // A stat block's features travel with the block. The engine used to merge a shipped
    // catalogue's adversary features in here, so a scene placing a creature got that creature's
    // feature without anyone writing it down; with no catalogue to inherit from, what a project
    // places is what a project carries. Every shipped adversary has `features: []`, so nothing
    // the app does changes — and an imported pack brings its own.
    abilities: project?.abilities ?? STARTER_ABILITIES,
    // Read as the project stands, each time: a card handed to somebody after this world was built
    // is in their hands at once, exactly as an ability written into the project always was.
    cards: () => characterContentFor(project).cards,
    conditionDefs: withSrdConditions(project?.conditionDefs ?? []),
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

export function hooksFor(code: readonly CodeDef[] | undefined): HookMap {
  if (code === undefined || code.length === 0) return SRD_HOOKS;
  // Keyed on what the code *says*, not on the array holding it: the editor
  // rewrites an entry in place, and a cache keyed on identity would go on
  // running the version the author has just changed.
  const signature = code.map((entry) => `${entry.id}\x00${entry.source}`).join('\x01');
  if (compiled !== null && compiled.signature === signature) return compiled.hooks;
  const hooks = mergeHooks(SRD_HOOKS, compileHooks(code).hooks);
  compiled = { signature, hooks };
  return hooks;
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
export function setSheet(demo: DemoScene, sheet: CharacterSheet): void {
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
export function syncRoster(demo: DemoScene): { joined: string[]; left: string[] } {
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
function roomBeside(demo: DemoScene): number {
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
export function gatherParty(demo: DemoScene, tile: number): void {
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
function freeTileNear(demo: DemoScene, from: number): number {
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

export function syncPools(demo: DemoScene): void {
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

/**
 * The stat block an entity answers to.
 *
 * Read out of the world, which knows the content this fight is being played
 * with: a project that carries its own creature is answered with that creature
 * rather than with whatever the shipped pack happens to have under the id.
 */
export function adversaryDefOf(demo: DemoScene, entityId: string): AdversaryDef | undefined {
  const entity = demo.state.entity(entityId);
  if (entity === undefined) return undefined;
  return demo.world.adversaryDef(entity.definition);
}

/** The same, for the fight, which always has a stat block to read. */
function statBlock(demo: DemoScene, entityId: string): AdversaryDef {
  return adversaryDefOf(demo, entityId) ?? DEMO_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
}

/** Rebuild the script world after a sheet changed under it. */
export function refreshWorld(demo: DemoScene): void {
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

/** What each party member is carrying, pool-wise, right now. */
function poolsOf(demo: DemoScene): Map<string, PartyPools> {
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

  // Entering a room is the moment its document and its state have to agree: a
  // remembered room is restored from a snapshot taken before the designer
  // edited it, and a freshly built one has just read the document anyway.
  syncAuthoredEncounters(demo);

  if (selected !== null && demo.party.members().includes(selected)) demo.party.select(selected);
}

/** The placements a scene can actually stand up: the ones the play grid has a tile for. */
function playablePlacements(scene: SceneDoc, grid: TileGrid): Set<string> {
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
export function syncAuthoredEncounters(demo: DemoScene): void {
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
    party: [...PARTY_SHEETS],
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
  // Everything is read out of the *project*, not out of the literals it was
  // parsed from. `projectSchema.parse` copies, so keeping the originals would
  // leave the editor and the game editing two documents that only look alike —
  // a scene added in one would be invisible to the other.
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
function bindTurn(demo: DemoScene): void {
  demo.world.spotlightSpent = (id) => (demo.gmTurn?.spotlights[id] ?? 0) > 0;
}

/** Whether a fight is currently running. */
export function inCombat(demo: DemoScene): boolean {
  return demo.encounter !== null && demo.encounter.outcome === 'ongoing';
}

/** Tiles the selected member can reach right now. */
export function reachableTiles(demo: DemoScene, budget?: number): ReachableField {
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
export function moveSelectedTo(demo: DemoScene, destination: number, aimed?: Spot): MoveResult {
  // A script waiting on the player blocks everything else; see `useSelectedOn`.
  // So does an ambush the party is still walking into.
  if (demo.pending !== null || demo.ambush !== null) return { moved: false, path: [] };
  const id = demo.party.selected;
  if (id === null || !demo.party.canCommand(id)) return { moved: false, path: [] };
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(id)) return { moved: false, path: [] };

  const field = demo.party.reachable(id, { inCombat: fighting });
  let goal = destination;
  let aim = aimed;
  let short = false;
  if (!field.canReach(destination)) {
    // Beyond reach is not a refusal. Out of a fight the walk goes to the
    // reachable spot nearest the one aimed at - a click across a chasm or on a
    // shut door walks up to it. In a fight it goes as far along the way as one
    // move allows, and says so.
    const nearest = nearestReachable(demo, field, aimed ?? demo.grid.spotOf(destination), fighting ? destination : NO_TILE);
    if (nearest === NO_TILE || nearest === demo.state.entity(id)!.tile) return { moved: false, path: [] };
    goal = nearest;
    aim = aimed === undefined ? undefined : clampInto(demo.grid, aimed, nearest);
    short = fighting;
  }
  const stood = { ...demo.state.entity(id)!.at };
  const walk = demo.party.walkTo(id, goal, aim === undefined ? { inCombat: fighting } : { inCombat: fighting, at: aim });
  if (short && walk !== null) note(demo, `${nameOf(demo, id)} can go no further this turn.`, 'combat');
  if (walk === null) return { moved: false, path: [] };
  const full = walk.path;

  // A trigger stops the move where it fired: on the trigger's tile, and the
  // line is cut there too, since a straightened walk might have crossed it.
  const hit = demo.triggers.firstAlong(full, demo.state);
  const path = hit === null ? full : full.slice(0, full.indexOf(hit.tile) + 1);
  if (hit !== null) demo.state.moveEntity(id, hit.tile);
  const route = hit === null ? walk.route : demo.party.lineAlong(id, path, stood, demo.grid.spotOf(hit.tile), fighting);
  demo.motions.push({ id, path, route });

  if (!fighting) {
    // Each follower crosses their own line, round the same corners.
    for (const [follower, walk] of demo.party.followAlong(id, path, route)) {
      demo.motions.push({ id: follower, path: walk.path, route: walk.route });
    }
  }
  if (fighting) demo.encounter!.act(id);

  if (hit !== null) {
    demo.ambush = hit.encounter;
    if (!demo.animated) arrive(demo);
    return { moved: true, path, triggered: hit.encounter };
  }
  return { moved: true, path };
}

/**
 * The walkers are where the board put them. Whatever the walk woke begins now.
 * Whoever draws the tokens calls this when the last of them stops; headless,
 * the move itself does.
 */
export function arrive(demo: DemoScene): boolean {
  if (demo.ambush === null) return false;
  const encounter = demo.ambush;
  demo.ambush = null;
  startEncounter(demo, encounter);
  return true;
}

/**
 * Bring the selected member into reach of a target before a swing: nothing
 * when already in reach, the walk to the nearest spot the weapon reaches from
 * when one is within this move, and otherwise as far along the way as the
 * move allows - `short`, the action spent on the walk.
 */
function closeToStrike(demo: DemoScene, id: string, target: EntityState, range: RangeBand): 'inReach' | 'closed' | 'short' {
  const attacker = demo.state.entity(id)!;
  const fighting = inCombat(demo);
  const strikeFrom = strikeTile(demo, id, target, range);
  if (strikeFrom === attacker.tile) return 'inReach';
  if (strikeFrom !== NO_TILE) {
    walkSelected(demo, id, strikeFrom, fighting);
    return 'closed';
  }
  const field = demo.party.reachable(id, { inCombat: fighting });
  let best = attacker.tile;
  let bestDistance = demo.grid.euclideanDistance(attacker.tile, target.tile);
  for (const tile of field.tiles()) {
    const distance = demo.grid.euclideanDistance(tile, target.tile);
    if (distance < bestDistance || (distance === bestDistance && tile < best)) {
      best = tile;
      bestDistance = distance;
    }
  }
  if (best !== attacker.tile) {
    walkSelected(demo, id, best, fighting);
    note(demo, `${nameOf(demo, id)} closes in, but cannot reach ${nameOf(demo, target.id)} this turn.`, 'combat');
    if (fighting) demo.encounter!.act(id);
  }
  return 'short';
}

/**
 * The tile the selected member would strike a target from: their own when it
 * is already in reach, else the cheapest to walk to this move that the weapon
 * reaches from; `NO_TILE` when none is.
 */
function strikeTile(demo: DemoScene, id: string, target: EntityState, range: RangeBand): number {
  const attacker = demo.state.entity(id)!;
  const inReach = (tile: number): boolean =>
    evaluateTarget(demo.grid, tile, target.tile, range, { bandTiles: DEMO_BAND_TILES }).refusal === null;
  if (inReach(attacker.tile)) return attacker.tile;
  const field = demo.party.reachable(id, { inCombat: inCombat(demo) });
  let best = NO_TILE;
  let bestCost = Infinity;
  for (const tile of field.tiles()) {
    if (tile === attacker.tile || !inReach(tile)) continue;
    const cost = field.costTo(tile);
    if (cost < bestCost || (cost === bestCost && tile < best)) {
      best = tile;
      bestCost = cost;
    }
  }
  return best;
}

/** Walk the selected member to a tile, and tell the board the line they took. */
function walkSelected(demo: DemoScene, id: string, tile: number, fighting: boolean): void {
  const walk = demo.party.walkTo(id, tile, { inCombat: fighting });
  if (walk !== null) demo.motions.push({ id, path: walk.path, route: walk.route });
}

/**
 * The line a click on an adversary would walk before the swing: none when
 * already in reach or nothing would move.
 */
export function previewStrike(demo: DemoScene, targetId: string): Spot[] | null {
  if (demo.pending !== null || demo.ambush !== null) return null;
  const id = demo.party.selected;
  const character = id === null ? undefined : demo.characters.get(id);
  const target = demo.state.entity(targetId);
  if (id === null || character === undefined || target === undefined || !target.alive) return null;
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(id)) return null;
  const attacker = demo.state.entity(id)!;
  const from = strikeTile(demo, id, target, attackProfile(character).range);
  if (from === NO_TILE || from === attacker.tile) return null;
  return demo.party.planWalk(id, from, { inCombat: fighting })?.route ?? null;
}

/** The line a click would walk: what is walked this move, and what lies beyond it. */
export interface WalkPreview {
  route: Spot[];
  /** In a fight, the rest of the way to where the click aimed, past what one move allows. */
  beyond: Spot[];
}

/**
 * What `moveSelectedTo` would do with a click on a spot, without doing it:
 * the line drawn on the ground as the pointer moves. Null when nothing would
 * move - nobody selected, a script waiting, nowhere to go.
 */
export function previewWalk(demo: DemoScene, destination: number, aimed: Spot): WalkPreview | null {
  if (demo.pending !== null || demo.ambush !== null) return null;
  const id = demo.party.selected;
  if (id === null || !demo.party.canCommand(id)) return null;
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(id)) return null;
  if (!demo.grid.isTile(destination)) return null;

  const field = demo.party.reachable(id, { inCombat: fighting });
  if (field.canReach(destination)) {
    const walk = demo.party.planWalk(id, destination, { inCombat: fighting, at: aimed });
    return walk === null ? null : { route: walk.route, beyond: [] };
  }
  const nearest = nearestReachable(demo, field, aimed, fighting ? destination : NO_TILE);
  if (nearest === NO_TILE || nearest === demo.state.entity(id)!.tile) return null;
  const walk = demo.party.planWalk(id, nearest, { inCombat: fighting, at: clampInto(demo.grid, aimed, nearest) });
  if (walk === null) return null;
  if (!fighting) return { route: walk.route, beyond: [] };
  // The rest of the way, from where this move stops to where the click aimed.
  const whole = demo.party.reachable(id, { inCombat: true, budget: Infinity });
  const path = tracePath(whole, destination);
  const rest = path === null ? null : path.slice(path.indexOf(nearest));
  const beyond =
    rest === null || rest.length < 2
      ? []
      : smoothPath(demo.grid, rest, demo.state.blockedFor(id), DEMO_WALK, { start: walk.route[walk.route.length - 1]!, end: aimed });
  return { route: walk.route, beyond };
}

/**
 * The reachable tile a walk beyond reach ends on. Given a tile the way to
 * which is only too long (`along`), the furthest tile along that way still in
 * reach; otherwise the reachable tile nearest the spot aimed at, as the crow
 * flies. `NO_TILE` when nothing at all is in reach.
 */
function nearestReachable(demo: DemoScene, field: ReachableField, aimed: Spot, along: number): number {
  const id = demo.party.selected!;
  if (along !== NO_TILE) {
    // The bounded field is a view over shared buffers: keep it before asking
    // for the way there without a budget.
    const inReach = field.clone();
    const whole = demo.party.reachable(id, { inCombat: true, budget: Infinity });
    const path = tracePath(whole, along);
    if (path !== null) {
      for (let i = path.length - 1; i >= 0; i--) if (inReach.canReach(path[i]!)) return path[i]!;
    }
    return NO_TILE;
  }
  let best = NO_TILE;
  let bestDistance = Infinity;
  for (const tile of field.tiles()) {
    const distance = Math.hypot(demo.grid.xOf(tile) - aimed.x, demo.grid.yOf(tile) - aimed.y);
    if (distance < bestDistance || (distance === bestDistance && tile < best)) {
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

/** The spot within a tile nearest to one aimed at outside it. */
function clampInto(grid: TileGrid, aimed: Spot, tile: number): Spot {
  const x = grid.xOf(tile);
  const y = grid.yOf(tile);
  return { x: Math.min(x + 0.49, Math.max(x - 0.49, aimed.x)), y: Math.min(y + 0.49, Math.max(y - 0.49, aimed.y)) };
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
): { hit: boolean; refused: string | null; hitPointsMarked: number; waiting?: boolean } | null {
  if (demo.pending !== null || demo.ambush !== null) return null;
  const id = demo.party.selected;
  const character = id === null ? undefined : demo.characters.get(id);
  const attacker = id === null ? undefined : demo.state.entity(id);
  const target = demo.state.entity(targetId);
  if (character === undefined || attacker === undefined || target === undefined) return null;
  if (inCombat(demo) && !demo.encounter!.canAct(id!)) return null;

  const profile = attackProfile(character);
  // The first thing a player does is click the enemy across the room. Out of
  // reach, the attacker walks to the nearest spot the weapon reaches from -
  // the move within Close is part of the action - and swings from there. With
  // nowhere in reach this move, they close as far as one move allows, and the
  // walk is the action.
  if (closeToStrike(demo, id!, target, profile.range) === 'short') return { hit: false, refused: 'outOfRange', hitPointsMarked: 0 };
  const melee = profile.range === 'melee';
  const outcome = resolveAttack(demo.rng, {
    grid: demo.grid,
    attacker,
    target,
    profile,
    // Difficulty and thresholds with the target's conditions folded in.
    defender: demo.world.defenderOf(target),
    options: {
      bandTiles: DEMO_BAND_TILES,
      bonus: demo.world.rollBonus(id!, 'attackRoll', { melee }),
      damageBonus: demo.world.rollBonus(id!, 'damageRoll', { melee }),
      goodDieSides: demo.world.goodDieSides(id!),
      // What the two of them say about each other: the Assassin's advantage
      // while Hidden, the Gaoler's shield in the way.
      ...demo.world.advantageFor(id!, targetId),
    },
  });
  if (outcome.refused !== null) return { hit: false, refused: outcome.refused, hitPointsMarked: 0 };

  // The blow has landed and has not been counted: the party's half of the
  // moment the GM's swing already stops at. A card that adds to its own damage
  // roll is asked here, before the thresholds read anything, and the swing is
  // held until the question is done with.
  const held: HeldSwing = {
    attacker: id!,
    target: targetId,
    outcome,
    weapon: profile.name,
    melee,
    damage: profile.damage,
    ...(profile.direct === undefined ? {} : { direct: profile.direct }),
  };
  // One stage earlier than that, and the only one where the roll itself can
  // still be changed: "after an ally attempts an action roll but before the
  // consequences take place". Nobody has been told whether it hit.
  if (outcome.dualityRoll !== undefined) {
    const box = { held };
    // A swing is a roll with the weapon's trait, and says so.
    const groups = rollingOffers(demo, id!, outcome.dualityRoll, box, undefined, profile.trait);
    // A free card fired itself and rerolled from inside `offersFor`; the box
    // holds what it left, and everything from here reads that instead.
    if (demo.pending !== null) return { hit: box.held.outcome.hit, refused: null, hitPointsMarked: 0, waiting: true };
    if (groups.length > 0 && demo.askDefender) {
      const [first, ...queued] = groups;
      askReaction(demo, first!, queued, { ...box.held, stage: 'rolled' });
      return { hit: box.held.outcome.hit, refused: null, hitPointsMarked: 0, waiting: true };
    }
    return afterRolled(demo, box.held);
  }
  return afterRolled(demo, held);
}

/**
 * The rest of the party's swing, once nothing more is going to change the
 * dice: the blow has landed or gone wide, and what is left is counting it.
 *
 * Split out of `attackWithSelected` because a card that rerolls the Duality
 * Dice has to settle first - the questions asked here are asked about a hit,
 * and whether there is one is exactly what the reroll decides.
 */
function afterRolled(
  demo: DemoScene,
  held: HeldSwing,
): { hit: boolean; refused: string | null; hitPointsMarked: number; waiting?: boolean } {
  // The roll pays out here, before anybody answers the damage roll, which is
  // the SRD's order: a Light it gave can pay for a card played on the blow, and
  // the Stress a critical clears is cleared before the card marks one. Landing
  // counts only the blow after this.
  if (held.settled !== true) {
    applyRoll(demo.state, held.outcome);
    held = { ...held, settled: true };
  }
  const { outcome, target: targetId } = held;
  // The blow has landed and has not been counted: the party's half of the
  // moment the GM's swing already stops at. A card that adds to its own damage
  // roll is asked here, before the thresholds read anything, and the swing is
  // held until the question is done with.
  if (outcome.hit && outcome.damageRoll !== undefined) {
    const box = { held };
    const offers = offersFor(demo, held.attacker, ['rollingDamage'], [targetId], {}, {
      lastDamage: { total: outcome.damageRoll.total, types: held.damage.types ?? ['physical'] },
      landing: box,
      ...(outcome.dualityRoll === undefined ? {} : { roll: outcome.dualityRoll }),
    });
    // A card that stopped to ask something of its own is holding the blow now,
    // and lands it when it is answered.
    if (demo.pending !== null) return { hit: outcome.hit, refused: null, hitPointsMarked: 0, waiting: true };
    if (offers.length > 0 && demo.askDefender) {
      askReaction(demo, offers, [], box.held);
      return { hit: outcome.hit, refused: null, hitPointsMarked: 0, waiting: true };
    }
    return landPartyAttack(demo, box.held);
  }
  return landPartyAttack(demo, held);
}

/**
 * Who in the party has something to say about a roll that has just been made,
 * before anything comes of it.
 *
 * The same shape `playPartyRolled` builds for the moment afterwards, and the
 * same bindings: whoever rolled is bound as the target, so `self` tells a card
 * that answers its holder's own roll from one that answers an ally's.
 *
 * The swing goes along in its box, because a free card fires from inside
 * `offersFor` rather than being handed back - and a free card that rerolled the
 * dice has to leave the new swing somewhere the caller will read it.
 */
function rollingOffers(
  demo: DemoScene,
  roller: string,
  roll: DualityRoll,
  landing?: { held: HeldSwing },
  /** What the check said it was for, when the roll came from one. */
  tags?: readonly string[],
  /** And which trait it was thrown with, for a card that asks. */
  trait?: CheckTrait,
): ReactionOffer[][] {
  const bound = {
    roll: {
      total: roll.total,
      outcome: roll.outcome,
      ...(tags === undefined ? {} : { tags }),
      ...(trait === undefined ? {} : { trait }),
    },
    swing: roll,
    ...(landing === undefined ? {} : { landing }),
  };
  const groups: ReactionOffer[][] = [];
  for (const member of demo.state.entitiesOf('party')) {
    if (!member.alive) continue;
    const theirs = offersFor(demo, member.id, ['partyRolling'], [roller], {}, bound);
    if (theirs.length > 0) groups.push(theirs);
  }
  return groups;
}

/**
 * The blow as it finally arrives, once the room has spoken.
 *
 * A swing nobody added to is the one that was rolled. One that grew has to be
 * counted again from the top - thresholds, resistance, Armor Slots - because
 * what the attack rules resolved was the smaller number. The defender's own
 * reduction is rolled again with it: they are rolling against the blow that
 * arrived, not the one that was on its way.
 *
 * A blow that was forced is counted least of all: "instead of rolling for
 * damage" means the Hit Points are the number the card named, and nothing -
 * thresholds, resistance, Armor Slots - stands between it and the target. The
 * dice the attack already rolled are thrown away, which costs the fight
 * nothing: they were rolled from the seed and never read.
 */
function counted(demo: DemoScene, held: HeldSwing): AttackOutcome {
  return atLeast(held, rolled(demo, held));
}

/**
 * "You never deal damage beneath a target's Major damage threshold (the target
 * always marks a minimum of 2 Hit Points)."
 *
 * A floor, not a swap: the blow is counted as it was rolled - resistance,
 * thresholds, whatever armor answered with - and only then lifted, because the
 * card says what the target marks rather than what the attack rolled.
 */
function atLeast(held: HeldSwing, outcome: AttackOutcome): AttackOutcome {
  const { floor } = held;
  if (floor === undefined || outcome.damage === undefined) return outcome;
  if (SEVERITY_ORDER.indexOf(outcome.damage.finalSeverity) >= SEVERITY_ORDER.indexOf(floor)) return outcome;
  const damage: ResolvedDamage = { ...outcome.damage, finalSeverity: floor, hpMarked: hpForSeverity(floor) };
  return { ...outcome, damage, hitPointsMarked: damage.hpMarked };
}

/** The blow as the dice and the cards left it, before any floor under it. */
function rolled(demo: DemoScene, held: HeldSwing): AttackOutcome {
  const { outcome, boost, forced } = held;
  const target = demo.state.entity(held.target);
  // A named band is counted like any other blow of that band: the thresholds
  // are simply not the thing that named it, and armor still answers.
  if (held.severity !== undefined && forced === undefined && target !== undefined) {
    const defender = demo.world.defenderOf(target);
    const damage = resolveDamage(
      { amount: 0, types: held.damage.types ?? [], severity: held.severity, ...(held.direct === undefined ? {} : { direct: held.direct }) },
      defender.thresholds,
      { armorSlotsMarked: 0, armorSlotsAvailable: unmarked(target.armorSlots) },
    );
    return { ...outcome, damage, hitPointsMarked: damage.hpMarked };
  }
  if (forced !== undefined && forced > 0) {
    const damage: ResolvedDamage = {
      incoming: 0,
      reduced: 0,
      severity: severityOfHitPoints(forced),
      finalSeverity: severityOfHitPoints(forced),
      armorSlotsSpent: 0,
      hpMarked: forced,
    };
    return { ...outcome, damage, hitPointsMarked: forced };
  }
  // Nothing to recount unless something changed the blow's size or its kind.
  const changed = (boost !== undefined && boost > 0) || held.doubled === true || held.types !== undefined;
  if (!changed || outcome.damageRoll === undefined || target === undefined) return outcome;
  const defender = demo.world.defenderOf(target);
  // Doubled first, then what the room added: "double the result of your damage
  // roll" is about the roll, not about the card that came after it.
  const total = outcome.damageRoll.total * (held.doubled === true ? 2 : 1) + (boost ?? 0);
  const types = held.types ?? held.damage.types ?? [];
  const damage = resolveDamage(
    { amount: total, types, ...(held.direct === undefined ? {} : { direct: held.direct }) },
    defender.thresholds,
    {
      armorSlotsMarked: 0,
      armorSlotsAvailable: unmarked(target.armorSlots),
      ...(defender.defenses === undefined ? {} : { defenses: defender.defenses }),
      ...(() => {
        const rolled = rollReduction(demo.rng, types, defender.defenses ?? {});
        return rolled === 0 ? {} : { rolledReduction: rolled };
      })(),
    },
  );
  return { ...outcome, damageRoll: { ...outcome.damageRoll, total }, damage, hitPointsMarked: damage.hpMarked };
}

/**
 * What band a blow that skipped the thresholds counts as.
 *
 * The severity is not decoration: a stat block reacts to Severe damage, and a
 * feature that answers one has to hear about a forced blow as well. The rules
 * read the same table backwards - one Hit Point is Minor, two Major, three
 * Severe, four Massive - so this is the crossing, not a guess.
 */
function severityOfHitPoints(marked: number): DamageSeverity {
  return marked >= 4 ? 'massive' : marked >= 3 ? 'severe' : marked >= 2 ? 'major' : 'minor';
}

/**
 * The rest of the party's swing, once nobody has anything more to put behind
 * it: the damage lands, the log says so, and everything that answers a wound
 * gets its turn.
 */
function landPartyAttack(
  demo: DemoScene,
  held: HeldSwing,
): { hit: boolean; refused: string | null; hitPointsMarked: number } {
  const { attacker: id, target: targetId, weapon } = held;
  const character = demo.characters.get(id)!;
  const profile = { name: weapon };
  const outcome = counted(demo, held);
  // What the one being swung at already owed, read before this blow's own
  // riders run: a card that marks an adversary here must not pay its holder on
  // the very swing that marked them.
  const owed = demo.world.payoutsOn(targetId, 'attacked');

  // A swing held for its damage roll has paid the roll out already (`afterRolled`);
  // one that never stopped - a blaze of glory - pays it here, with the blow.
  const applied = applyAttack(demo.state, outcome, held.settled === true ? { roll: false } : {});
  demo.world.endsOnAttack(id!);
  if (outcome.hit) {
    // How much it dealt as well as how much it marked: a card that answers
    // somebody else's blow throws that number, and the party's own swing was
    // the one thing in the fight that never said what it rolled.
    demo.world.noteDamage(targetId, {
      attacker: id!,
      hitPoints: applied.hitPointsMarked,
      damage: outcome.damageRoll?.total ?? 0,
      types: held.types ?? held.damage.types ?? ['physical'],
      severe: outcome.damage !== undefined && isSevere(outcome.damage.severity),
    });
    demo.world.endsOnHit(targetId);
    if (applied.hitPointsMarked > 0) demo.world.endsOnDamage(targetId);
    defeatMinions(demo, targetId, outcome.damageRoll?.total ?? 0);
  }
  if (outcome.dualityRoll !== undefined) {
    showRoll(demo, character.sheet.name, `the ${profile.name}`, outcome.dualityRoll);
  }
  if (outcome.hit) noteReduction(demo, nameOf(demo, targetId), outcome.damage);
  note(
    demo,
    outcome.hit
      ? `${character.sheet.name} ${outcome.critical ? 'lands a critical with' : 'hits with'} the ${profile.name}: ${applied.hitPointsMarked} Hit Point${applied.hitPointsMarked === 1 ? '' : 's'} on ${nameOf(demo, targetId)}.`
      : `${character.sheet.name} swings the ${profile.name} at ${nameOf(demo, targetId)} and misses.`,
    'combat',
  );
  swungAt(demo, id, targetId);
  if (outcome.hit) {
    float(demo, targetId, `-${applied.hitPointsMarked} HP`, 'combat');
    struck(demo, targetId);
  } else float(demo, targetId, 'miss', 'system');
  // After the swing is in the log and before `act`, which is where the
  // encounter decides whether anyone is left standing: what answers a wound
  // reads after the wound, and a phase change has to put its next form on the
  // map or the party wins against a creature that was going to stand back up.
  if (outcome.hit) {
    playDamageReactions(demo);
    playDefeatReactions(demo);
    // "When you deal damage to an adversary, you can spend 2 Light to…": the
    // player's own rider on their own swing, offered after the blow is in the
    // log and before the turn is spent. A question left standing here holds
    // nothing up - the GM's turn is started by the player pressing pass, never
    // by the swing that ended theirs.
    playAttackRiders(demo, id!, targetId, applied.hitPointsMarked, outcome.dualityRoll);
    // And the other side of it: whoever was swung at counts the swing, the
    // same way the party does when the GM swings at them.
    playAttackedOn(demo, targetId, id!);
  } else {
    playMissRiders(demo, id!, targetId, outcome.dualityRoll);
  }
  // "The next PC to make an attack against that adversary can clear a Stress
  // or gain a Light": hit or miss, and paid to whoever swung.
  playPayouts(demo, id!, targetId, owed, outcome.dualityRoll);
  // What the room makes of the roll itself: "when a PC rolls with Shadow while
  // within Far range of the Dragon". Before `act`, so anything it costs them
  // is settled by the same `settleFight` as the swing.
  if (outcome.dualityRoll !== undefined) playPartyRolled(demo, id!, outcome.dualityRoll);
  if (inCombat(demo)) {
    // A swing from somebody who cannot act is refused, and `act` is where the
    // encounter counts who is left standing - so a Blaze of Glory that fells
    // the last adversary would leave a fight nobody had won. The fight is
    // asked outright instead.
    if (demo.encounter!.canAct(id!)) demo.encounter!.act(id!, { spotlightToGm: outcome.spotlightToGm });
    else demo.encounter!.settleIfDecided();
  }
  settleFight(demo);
  // The swing is over before a clock moves: a countdown that goes off now is
  // answering the roll that was just made, not interrupting it. This attack
  // never goes through the runner, so its cues are raised by hand.
  if (outcome.dualityRoll !== undefined) {
    tickCountdowns(demo, { kind: 'actionRoll', attack: true, outcome: outcome.dualityRoll.outcome });
  }
  if (applied.hitPointsMarked > 0) {
    tickCountdowns(demo, { kind: 'hpMarked', id: targetId, marked: applied.hitPointsMarked });
  }
  return { hit: outcome.hit, refused: null, hitPointsMarked: applied.hitPointsMarked };
}

/**
 * Play the GM's turn: spotlight adversaries while the Shadow lasts, each attacking
 * the nearest party member it can reach.
 */
export function playGmTurn(demo: DemoScene): number {
  const encounter = demo.encounter;
  if (encounter === null || encounter.outcome !== 'ongoing' || encounter.view().side !== 'gm') return 0;
  if (demo.gmTurn !== null || demo.pending !== null) return 0;
  // "Temporary … until they next act": the party has had their turn, whether
  // they ended it or a roll with Shadow took the spotlight off them, so what a
  // creature put on them for a moment comes off — the same way an adversary
  // shakes one off on its spotlight. Without this a hold the SRD ends with a
  // Strength Roll, which nothing here can ask for, would last the whole fight.
  clearPartyTemporary(demo);
  demo.gmTurn = {
    remaining: [...encounter.view().waiting],
    acted: 0,
    spotlights: {},
    features: {},
    granted: new Set(),
    halved: new Set(),
  };
  return runGmTurn(demo);
}

/**
 * Play what is left of the GM's turn.
 *
 * A hit can stop it: the defender is asked how they take it, and until they
 * answer nothing else moves. `answerPending` calls this again, so the rest of
 * the adversaries act on the far side of the question.
 */
export function runGmTurn(demo: DemoScene): number {
  const encounter = demo.encounter;
  const turn = demo.gmTurn;
  if (encounter === null || turn === null) return 0;

  while (turn.remaining.length > 0 && demo.pending === null && encounter.outcome === 'ongoing') {
    const id = turn.remaining[0]!;
    const again = (turn.spotlights[id] ?? 0) > 0;
    // A spotlight an ally was handed is already paid for, and has to be taken
    // before the Shadow is read: a Leader that spent its last Shadow rallying the
    // room would otherwise end the turn before anyone it rallied could move.
    const granted = turn.granted.delete(id);
    if (!granted && again && !encounter.canSpotlightAgain(id)) {
      // Relentless is an option the GM pays for, not an obligation: one the
      // pool cannot afford another turn for steps aside, and the rest of the
      // room - which may be standing on spotlights a feature already bought -
      // still acts.
      turn.remaining.shift();
      continue;
    }
    // A fresh creature the GM cannot pay for does end the turn: everything
    // behind it in the queue costs the same, and a granted spotlight is always
    // at the head.
    if (!granted && !again && !encounter.canSpotlight(id)) break;
    if (granted) encounter.grantSpotlight(id);
    else if (again) encounter.spotlightAgain(id);
    else encounter.spotlight(id);
    turn.spotlights[id] = (turn.spotlights[id] ?? 0) + 1;
    turn.acted++;
    // Relentless: "can be spotlighted up to X times per GM turn. Spend Shadow as
    // usual." It keeps its place at the head of the queue until it runs out of
    // spotlights or the GM runs out of Shadow.
    const allowed = adversaryTraits(statBlock(demo, id)).spotlights;
    if (turn.spotlights[id]! >= allowed) turn.remaining.shift();
    adversaryTurn(demo, id);
    // "While spotlighted in this way": the half is the price of the turn the
    // Leader handed over, and it is over when that turn is. A second spotlight
    // the GM paid for in the ordinary way swings at full strength.
    turn.halved.delete(id);
  }
  // Still waiting on a defender: the turn keeps its place.
  if (demo.pending !== null) return turn.acted;

  demo.gmTurn = null;
  encounter.endGmTurn();
  settleFight(demo);
  return turn.acted;
}

/**
 * Hand the spotlight to the GM and play the GM's turn.
 *
 * Under the spotlight policy the spotlight only passes on a roll with Shadow or
 * a failure; this is the party choosing to stop — "we hold and see what they
 * do" — and it is the button a player presses when everyone has acted.
 */
export function endTurn(demo: DemoScene): number {
  const encounter = demo.encounter;
  if (encounter === null || encounter.outcome !== 'ongoing') return 0;
  if (encounter.view().side === 'party') encounter.passToGm();
  return playGmTurn(demo);
}

/** Temporary conditions end on the party members carrying them. */
function clearPartyTemporary(demo: DemoScene): void {
  for (const entity of demo.state.entitiesOf('party')) {
    if (!entity.alive) continue;
    const cleared: string[] = [];
    for (const condition of [...entity.conditions]) {
      if ((entity.conditionDurations.get(condition) ?? 'permanent') !== 'temporary') continue;
      entity.conditions.delete(condition);
      entity.conditionDurations.delete(condition);
      cleared.push(condition);
    }
    if (cleared.length > 0) note(demo, `${nameOf(demo, entity.id)} shakes off ${cleared.join(' and ')}.`, 'good');
  }
  syncPools(demo);
}

/** Fights whose end has already been announced. */
const announced = new WeakSet<EncounterRunner>();

/**
 * Creatures whose fall has already been answered.
 *
 * By the entity rather than by its id: a summons hands out the ids the room no
 * longer holds, so the second `husk-s1` to stand up is a different creature
 * and gets its own last word.
 */
const mourned = new WeakSet<EntityState>();

/**
 * "When the Realm-Breaker marks their last HP, replace them with the
 * Undefeated Champion and immediately spotlight them."
 *
 * The last thing a stat block does. It has to happen before anybody counts who
 * is left standing - a fight the party has not won yet is not over - so this
 * runs on the killing blow rather than at the end of the turn, and remembers
 * who it has already answered so a second look does not play it twice.
 */
function playDefeatReactions(demo: DemoScene): void {
  for (const entity of demo.state.entitiesOf('adversary')) {
    if (entity.alive || mourned.has(entity)) continue;
    mourned.add(entity);
    for (const ability of demo.world.reactionsFor(entity.id, 'defeated')) {
      if (ability.effects.length === 0) continue;
      if (!affordableReaction(demo, entity.id, ability)) continue;
      spendFeatureCost(demo, entity.id, ability, 'reaction');
      runAdversaryScript(demo, entity.id, ability);
    }
  }
}

/**
 * Characters who are down and have already made their death move.
 *
 * By the entity, like `mourned`, so a summons handing out an id the room no
 * longer holds cannot confuse it. Standing back up clears the mark: "when a PC
 * marks their last Hit Point" is every time they do, so an ally who clears a
 * Hit Point on the unconscious has bought them a second death move as well as
 * a second wind.
 */
const fallen = new WeakSet<EntityState>();

/**
 * "When a PC marks their last Hit Point, they must make a death move."
 *
 * Raised wherever a blow is settled, and before anybody counts who is left
 * standing - `checkEnd` only runs when the encounter is asked to spotlight or
 * to act, and a question left standing here stops the GM's turn before it asks
 * for either. So a lone character who Risks It All and wins is still in a
 * fight that is going on.
 *
 * One at a time. A blow that puts two of the party down asks about the first,
 * and the second is asked once that answer is in.
 */
function playDeathMoves(demo: DemoScene): void {
  if (demo.pending !== null) return;
  for (const entity of demo.state.entitiesOf('party')) {
    // Standing back up is noticed here, because settling a blow is the last
    // thing every path that can heal one does.
    if (entity.alive) {
      fallen.delete(entity);
      continue;
    }
    // Nobody asks a character who is already past the veil for a death move.
    if (entity.dead === true || fallen.has(entity)) continue;
    const character = demo.characters.get(entity.id);
    if (character === undefined) continue;
    fallen.add(entity);
    note(demo, `${character.sheet.name} marks their last Hit Point.`, 'bad');
    // "When this ally would make a death move, they clear a Hit Point
    // instead": read before the question is put, because a character the sigil
    // catches never makes the move at all.
    const sigil = demo.world.insteadOfDeath(entity.id);
    if (sigil !== null) {
      demo.world.clearCondition(entity.id, sigil.condition);
      demo.world.heal({ kind: 'entity', id: entity.id }, sigil.clears);
      fallen.delete(entity);
      note(demo, `${character.sheet.name}: ${sigil.says}`, 'good');
      continue;
    }
    // With nobody at the table to ask - every test that predates the prompt,
    // and the engine driving itself - the move is Avoid Death, which is what
    // falling did before there was a choice about it.
    if (!demo.askDefender) {
      applyDeathMove(demo, entity.id, 'avoid');
      continue;
    }
    askDeathMove(demo, entity.id, deathOffers(demo, entity.id));
    return;
  }
}

/**
 * The cards a character holds that answer their own fall.
 *
 * The `defeated` trigger, which a stat block already uses for the last thing
 * it does; on a card it is the one thing that happens *instead* of a death
 * move. Nobody is bound but the holder: the blow that did it has been read and
 * counted by now, and what these say is about the character, not the knife.
 */
function deathOffers(demo: DemoScene, id: string): ReactionOffer[] {
  return offersFor(demo, id, ['defeated'], [id], {});
}

/** The question itself: one character, the three ways out of it, and any card. */
function askDeathMove(demo: DemoScene, id: string, offers: readonly ReactionOffer[]): void {
  demo.pending = {
    kind: 'death',
    who: id,
    moves: DEATH_MOVES,
    offers,
    prompt: {
      kind: 'choice',
      title: `${nameOf(demo, id)} must make a death move`,
      options: [
        {
          index: 0,
          label: 'Avoid Death',
          detail: 'Drop unconscious until an ally clears a Hit Point. Roll the Light Die: on your level or under, a scar.',
        },
        {
          index: 1,
          label: 'Blaze of Glory',
          detail: 'One final action. It automatically critically succeeds, and then you cross through the veil.',
        },
        {
          index: 2,
          label: 'Risk It All',
          detail: 'Roll the Duality Dice. Light higher and you stay up; Shadow higher and you die; matching and you stand with everything cleared.',
        },
        // "Instead of making a death move": after the three, because stepping
        // back from a question takes its first option and that has to be the
        // one which changes nothing.
        ...offers.map((offer, at) => ({
          index: DEATH_MOVES.length + at,
          label: offer.ability.name,
          detail: offer.ability.text,
        })),
      ],
    },
  };
}

/** Do what was chosen. Each move is the SRD's own, and each is final. */
function applyDeathMove(demo: DemoScene, id: string, move: DeathMove): void {
  if (move === 'avoid') return avoidDeath(demo, id);
  if (move === 'risk') return riskItAll(demo, id);
  return blazeOfGlory(demo, id);
}

/**
 * "They temporarily drop unconscious... After your character falls
 * unconscious, roll your Light Die. If its value is equal to or less than your
 * character's level, they gain a scar."
 *
 * Being unconscious is what a fallen entity already is: it cannot act and
 * cannot be targeted, and clearing one of its marked Hit Points brings it
 * back. The scar is the part that was missing, and it is rolled here rather
 * than on waking because that is where the SRD puts it.
 */
function avoidDeath(demo: DemoScene, id: string): void {
  const character = demo.characters.get(id);
  if (character === undefined) return;
  note(demo, `${character.sheet.name} drops unconscious.`, 'system');
  const good = demo.rng.die(GOOD_DIE_SIDES);
  if (good > character.sheet.level) {
    note(demo, `The Light Die reads ${good}: no scar this time.`, 'system');
    return;
  }
  scar(demo, id, good);
}

/**
 * "Permanently cross out a Light slot."
 *
 * On the sheet, because it outlives the scene: the next fight this character
 * walks into is derived from the sheet and starts a Light short. The pool they
 * are carrying right now loses the slot too, and whatever was sitting in it.
 */
function scar(demo: DemoScene, id: string, rolled: number): void {
  const character = demo.characters.get(id);
  const entity = demo.state.entity(id);
  if (character === undefined || entity === undefined) return;
  // Through `setSheet`, so the project's copy of the party carries it too and
  // the character is re-derived over it: `deriveCharacter` folds scars into
  // the Light pool's maximum, so nothing here has to write that by hand.
  const sheet = demo.sheets.get(id) ?? character.sheet;
  setSheet(demo, { ...sheet, scars: (sheet.scars ?? 0) + 1 });
  const held = entity.good ?? character.good;
  const max = Math.max(0, held.max - 1);
  entity.good = { max, value: Math.min(held.value, max) };
  note(
    demo,
    `The Light Die reads ${rolled}. ${character.sheet.name} takes a scar: a Light slot crossed out for good.`,
    'bad',
  );
  // "If you ever cross out your last Light slot, your character's journey ends."
  if (max > 0) return;
  entity.dead = true;
  note(demo, `That was the last slot. ${character.sheet.name}'s journey ends here.`, 'bad');
}

/**
 * "Roll your Duality Dice. If the Light Die is higher, your character stays on
 * their feet and clears a number of Hit Points or Stress equal to the value of
 * the Light Die... If the Shadow Die is higher, your character crosses through
 * the veil of death. If the Duality Dice show matching results, your character
 * stays up and clears all Hit Points and Stress."
 *
 * Nothing is being beaten and a death move is not an action roll, so the dice
 * are rolled the way a reaction rolls them: no Light gained, no Shadow for the
 * GM, no move handed over off the back of it.
 *
 * Simplified: "you can divide the Light Die value between Hit Points and Stress
 * however you'd prefer" is one more question than the moment can carry, and a
 * character at zero Hit Points wants Hit Points. They are cleared first, and
 * whatever the die has left over goes on Stress.
 */
function riskItAll(demo: DemoScene, id: string): void {
  const character = demo.characters.get(id);
  const entity = demo.state.entity(id);
  if (character === undefined || entity === undefined) return;
  const who = character.sheet.name;
  const roll = rollDuality(demo.rng, { difficulty: 0, reaction: true });
  note(demo, `${who} risks it all: Light ${roll.good}, Shadow ${roll.bad}.`, roll.bad > roll.good ? 'bad' : 'good');
  if (roll.bad > roll.good) return veil(demo, id);

  const target: TargetSelector = { kind: 'entity', id };
  if (roll.good === roll.bad) {
    demo.world.heal(target, entity.hitPoints.max);
    demo.world.clearStress(id, entity.stress.max);
    note(demo, `The dice match. ${who} stands up with nothing marked at all.`, 'good');
    return;
  }
  const hitPoints = demo.world.heal(target, roll.good);
  const stress = demo.world.clearStress(id, roll.good - hitPoints);
  note(
    demo,
    `${who} stays on their feet: ${hitPointWord(hitPoints)} cleared${stress > 0 ? ` and ${stress} Stress` : ''}.`,
    'good',
  );
}

/**
 * "Take one final action. It automatically critically succeeds (with GM
 * approval), and then you cross through the veil of death."
 *
 * The final action is a swing, at the nearest adversary the character's weapon
 * can still reach - by id on a tie, the same rule every other swing here uses.
 * It costs nothing: the character is dying on the GM's turn, out of sequence,
 * and `act` refuses a fallen creature anyway, so no token and no spotlight is
 * spent on it.
 *
 * A character with nobody in reach still crosses. There is no rule that hands
 * the action back.
 */
function blazeOfGlory(demo: DemoScene, id: string): void {
  const character = demo.characters.get(id);
  const attacker = demo.state.entity(id);
  if (character === undefined || attacker === undefined) return;
  note(demo, `${character.sheet.name} goes out in a blaze of glory.`, 'good');

  const profile = attackProfile(character);
  const melee = profile.range === 'melee';
  const foes = demo.state.entitiesOf('adversary').filter((foe) => foe.alive).map((foe) => foe.id);
  for (const targetId of byDistance(demo, id, foes)) {
    const target = demo.state.entity(targetId)!;
    const outcome = resolveAttack(demo.rng, {
      grid: demo.grid,
      attacker,
      target,
      profile,
      defender: demo.world.defenderOf(target),
      options: {
        bandTiles: DEMO_BAND_TILES,
        automatic: 'criticalSuccess',
        bonus: demo.world.rollBonus(id, 'attackRoll', { melee }),
        damageBonus: demo.world.rollBonus(id, 'damageRoll', { melee }),
        ...demo.world.advantageFor(id, targetId),
      },
    });
    // Out of reach, or behind something: the next one along is asked.
    if (outcome.refused !== null) continue;
    // The veil first, so whatever the blow sets off - a phase change, a death
    // throe, the fight ending - is read in a room this character has already
    // left. The swing still lands: it was thrown before they crossed.
    veil(demo, id);
    landPartyAttack(demo, {
      attacker: id,
      target: targetId,
      outcome,
      weapon: profile.name,
      melee,
      damage: profile.damage,
      ...(profile.direct === undefined ? {} : { direct: profile.direct }),
    });
    return;
  }
  note(demo, `${character.sheet.name} looks for one last swing and finds nothing in reach.`, 'system');
  veil(demo, id);
}

/**
 * A card played in place of the death move, and what happens if it was not
 * enough.
 *
 * "Instead of making a death move" is a trade, not a reprieve: a card that
 * leaves the character on the floor has spent itself and bought nothing, so
 * the three moves are put again - without the cards this time, because the one
 * that was going to work has been played.
 */
function playDeathCard(demo: DemoScene, id: string, offer: ReactionOffer): void {
  playReaction(demo, offer, [], false);
  if (demo.pending !== null) return;
  if (demo.state.entity(id)?.alive === true) return;
  askDeathMove(demo, id, []);
}

/** Crossing through: down, and past anything that clears a Hit Point. */
function veil(demo: DemoScene, id: string): void {
  const entity = demo.state.entity(id);
  if (entity === undefined) return;
  entity.alive = false;
  entity.dead = true;
  note(demo, `${nameOf(demo, id)} crosses through the veil of death.`, 'bad');
}

/**
 * What the end of a fight does, once: the scene's conditions end, the
 * abilities that refresh with the scene refresh, and the log says who won.
 */
export function settleFight(demo: DemoScene): void {
  // Before anything answers a wound: whoever was moved, felled or stood back
  // up during the turn is in or out of the zones on the board.
  demo.world.refreshZones();
  // And what the ground makes of anybody who has just walked onto it, before
  // the wounds are answered - so a creature hurt by a circle is hurt in the
  // same moment as one hurt by a blade, and everything that answers a wound
  // hears about both together.
  playZoneEntries(demo);
  playDamageReactions(demo);
  playDefeatReactions(demo);
  // The party's half of the same moment, and the reason it is here rather than
  // at the end of the turn: a character who Risks It All and stands is one the
  // encounter must never have counted out.
  playDeathMoves(demo);
  // And then, with nothing left to ask, who is standing. The encounter counts
  // that when somebody acts or is spotlighted, and a blow struck out of a
  // reaction is neither - Glancing Blow answers a swing that has already
  // passed the spotlight to a GM with nobody left to spotlight. The pending
  // guard is what keeps a death move in front of it: two of the three moves
  // put the character back on their feet, and the fight must not be called
  // over their head.
  if (demo.pending === null) demo.encounter?.settleIfDecided();
  // "If the Gorgon is defeated, all petrification countdowns end" - and the
  // Ashen Tyrant's death throes go off instead. Here because this is where a
  // death is noticed, whoever dealt it.
  for (const moved of demo.world.reapCountdowns()) playCountdown(demo, moved);
  const encounter = demo.encounter;
  if (encounter === null || encounter.outcome === 'ongoing' || announced.has(encounter)) return;
  announced.add(encounter);
  demo.state.clearConditions('scene');
  // The clocks stop with the fight: a countdown armed by a creature has
  // nothing left to count once the encounter is over, and a standard one
  // would otherwise keep ticking on a chest roll in the quiet afterwards. A
  // countdown nobody owns is the scene's own and goes on running.
  demo.world.endCreatureCountdowns();
  syncPools(demo);
  for (const key of [...demo.scenario.abilityUses.keys()]) {
    const ability = demo.project.abilities.find((a) => key.endsWith(`/${a.id}`));
    if (ability?.uses?.per === 'scene') demo.scenario.abilityUses.delete(key);
  }
  for (const key of [...demo.scenario.abilityTokens.keys()]) {
    const ability = demo.project.abilities.find((a) => key.endsWith(`/${a.id}`));
    if (ability?.tokens?.refill === 'scene') demo.scenario.abilityTokens.delete(key);
  }
  note(
    demo,
    encounter.outcome === 'victory' ? 'The last of them falls. The fight is over.' : 'The party falls.',
    encounter.outcome === 'victory' ? 'success' : 'bad',
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

  // "When the Sorcerer is in the spotlight for the first time...": before
  // anything else the turn does, so a creature that spends its whole turn
  // tearing free of a hold has still had its spotlight. Something that cannot
  // react at all - Stunned, Asleep - arms nothing: `reactionsFor` says so.
  // "They can't act yet": Slow spends the whole spotlight on a token, and the
  // creature does nothing else with it - no feature, no swing, not even
  // shaking off what is holding it.
  if (playSpotlightReactions(demo, adversaryId)) return;

  takeSpotlight(demo, adversaryId, adversary);

  // "Temporarily" is one spotlight. Whatever the creature did with the turn -
  // tore free, swung, erupted - what was put on it comes off at the end of it,
  // so a debuff that blocks nothing still costs the party's caster a turn and
  // still buys the party a round. A creature that spent its whole spotlight
  // gathering itself (Slow, above) never reaches here, and keeps what it has.
  clearTemporaryConditions(demo, adversaryId);
}

/** What the creature does with the spotlight, once it is sure it has one. */
function takeSpotlight(demo: DemoScene, adversaryId: string, adversary: EntityState): void {
  // Unable to act — Stunned, Asleep: the spotlight goes on shaking it off. A
  // temporary condition clears; one that only ends on damage or a Shadow
  // (Asleep) costs the GM a Shadow, if they have one, else the turn is lost.
  if (demo.world.blocks(adversaryId, 'act')) {
    clearTemporaryConditions(demo, adversaryId);
    if (demo.world.blocks(adversaryId, 'act')) clearWithBad(demo, adversaryId);
    return;
  }
  // Held in place: the spotlight goes on tearing free instead of attacking.
  if (demo.world.blocks(adversaryId, 'move')) {
    clearTemporaryConditions(demo, adversaryId);
    return;
  }

  const targets = demo.state.entitiesOf('party').filter((e) => e.alive);
  if (targets.length === 0) return;

  // A stat-block feature worth using beats a plain swing.
  const feature = adversaryFeature(demo, adversaryId);
  if (feature !== null) {
    useAdversaryFeature(demo, adversaryId, feature.ability, feature.targets);
    return;
  }
  // Nearest, then by id, so the same state always produces the same target.
  const target = targets.sort(
    (a, b) =>
      demo.grid.manhattanDistance(adversary.tile, a.tile) -
        demo.grid.manhattanDistance(adversary.tile, b.tile) || a.id.localeCompare(b.id),
  )[0]!;

  const def = statBlock(demo, adversary.id);
  approach(demo, adversary.id, target.tile, def.attackRange);
  attackPartyMember(demo, adversaryId, target.id);
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
  demo: DemoScene,
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
 * A feature this adversary would rather use than swing, and who it is aimed at.
 *
 * The bar is deliberately low and deliberately fixed. A feature that goes off
 * around the adversary has to catch more than one of the party — otherwise a
 * Stress buys less than a claw would. One that names a creature ("make an
 * attack against a target within Close range") only needs someone in reach,
 * and takes the nearest, by id on a tie, exactly as a swing does. An area
 * feature is preferred to an aimed one, and the block's own order decides the
 * rest. Nothing here is random, so a seeded fight replays.
 */
function adversaryFeature(demo: DemoScene, adversaryId: string): { ability: AbilityDef; targets: string[] } | null {
  if (!inCombat(demo)) return null;
  // One feature a turn, however many spotlights Relentless buys: an adversary
  // that erupted goes back to teeth and claws for the rest of the turn.
  if (demo.gmTurn?.features[adversaryId] === true) return null;
  const entity = demo.state.entity(adversaryId);
  if (entity === undefined) return null;
  const def = statBlock(demo, adversaryId);
  const was = demo.scenario.actorId;
  demo.scenario.actorId = adversaryId;
  try {
    let aimed: { ability: AbilityDef; targets: string[] } | null = null;
    let itself: { ability: AbilityDef; targets: string[] } | null = null;
    for (const ability of demo.world.abilitiesForAdversary(def.id)) {
      if (ability.kind !== 'action' || ability.effects.length === 0) continue;
      if ((ability.cost.stress ?? 0) > unmarked(entity.stress)) continue;
      if (featureBad(ability) > demo.state.bad.value) continue;
      if (featureUsesLeft(demo, adversaryId, ability) <= 0) continue;
      // "If the Hydra has any marked HP": what the block says about when the
      // feature is worth using at all, read with the creature as the actor.
      if (!evaluateOptional(ability.available, demo.world, NO_BINDINGS)) continue;
      // "A target with 3 or more bramble tokens": asked of each of them in
      // turn, before anything is spent, so a feature nobody qualifies for is
      // one the GM never reaches for.
      const caught = demo.world
        .resolveTargets({ kind: 'allies', range: ability.target.range }, NO_BINDINGS)
        .filter((id) => worthAiming(demo, adversaryId, ability, id));
      // "Spotlight all Giant Rats within Close range of them": worth a Shadow
      // when there is a swarm to call, and the same swing for nothing when
      // there is not, so the GM only reaches for it when someone answers.
      const swarm = swarmSelector(ability);
      if (swarm !== null) {
        if (caught.length === 0) continue;
        const at = nearestOf(demo, adversaryId, caught);
        const joining = demo.world
          .resolveTargets(swarm, { targets: [at], hit: [] })
          .filter((id) => id !== adversaryId && !demo.world.spotlightSpent(id));
        if (joining.length > 0) return { ability, targets: [at] };
        continue;
      }
      if (readsATarget(ability.effects)) {
        if (aimed === null && caught.length > 0) aimed = { ability, targets: [nearestOf(demo, adversaryId, caught)] };
        continue;
      }
      // A feature aimed at nobody but itself — a heal, a shout — catches no one
      // by definition, and neither does a summons: what it puts on the map is
      // not on it yet. Whether either is worth a turn is what its cost, its
      // uses and `available` say.
      // "Spend a Shadow to spotlight two other Demons within Far range": worth
      // it only when there is somebody to hand a turn to, and never worth more
      // Shadow than the spotlights it buys - a plain spotlight costs one.
      if (spotlightsAllies(ability)) {
        const called = spotlightCandidates(demo, adversaryId, ability);
        if (called.length === 0 || featureBad(ability) > called.length) continue;
        if (itself === null) itself = { ability, targets: [] };
        continue;
      }
      if (
        ability.target.kind === 'self' ||
        summonsSomething(ability) ||
        armsCountdown(ability) ||
        worksOnItsOwnSide(ability)
      ) {
        if (itself === null) itself = { ability, targets: [] };
        continue;
      }
      if (caught.length >= 2) return { ability, targets: [] };
    }
    return aimed ?? itself;
  } finally {
    demo.scenario.actorId = was;
  }
}

/** Whether a feature hands the GM's turn to its own side. */
function spotlightsAllies(ability: AbilityDef): boolean {
  return ability.effects.some((effect) => effect.kind === 'spotlight');
}

/**
 * Who a feature that spotlights allies could actually hand a turn to.
 *
 * The same list the effect will draw from - everyone its selector catches,
 * less the one acting and anyone who has already had this turn - so the GM
 * never pays for a rally nobody answers. It rolls nothing: how many of them
 * the feature takes is the effect's business, and rolling here would spend a
 * seeded number twice.
 */
function spotlightCandidates(demo: DemoScene, adversaryId: string, ability: AbilityDef): string[] {
  const was = demo.scenario.actorId;
  demo.scenario.actorId = adversaryId;
  try {
    const called = new Set<string>();
    for (const effect of ability.effects) {
      if (effect.kind !== 'spotlight') continue;
      for (const id of demo.world.resolveTargets(effect.targets ?? { kind: 'adversaries', range: 'far' }, NO_BINDINGS)) {
        if (id !== adversaryId && !demo.world.spotlightSpent(id)) called.add(id);
      }
    }
    return [...called];
  } finally {
    demo.scenario.actorId = was;
  }
}

/** Whether a feature puts creatures on the map. */
function summonsSomething(ability: AbilityDef): boolean {
  return ability.effects.some((effect) => effect.kind === 'summon');
}

/**
 * Whether a feature is aimed at its own side: the Vampire opening one of its
 * followers to close its own wound.
 *
 * Like a heal or a summons it catches nobody, so the picker would otherwise
 * wait for a crowd that never comes. Anything that names the party - a
 * selector of theirs, or an effect that falls back to the chosen target -
 * disqualifies it, so this only ever says yes to a feature the block does
 * entirely among its own.
 */
function worksOnItsOwnSide(ability: AbilityDef): boolean {
  let ownSide = false;
  let outward = false;
  // The effects that fall to the ones the roll beat when nothing is said.
  // `heal` is not one of them: with no target it clears the actor's own, which
  // is the whole point of a feature a block uses on itself.
  const aimedByDefault = ['attack', 'applyCondition', 'clearCondition', 'push', 'markArmor', 'damage'];
  walkEffects(ability.effects, (effect: Effect) => {
    const selector = (effect as { target?: TargetSelector }).target;
    if (selector === undefined) {
      if (aimedByDefault.includes(effect.kind)) outward = true;
      return;
    }
    if (selector.kind === 'adversaries') ownSide = true;
    if (selector.kind === 'allies' || selector.kind === 'party' || selector.kind === 'target' || selector.kind === 'hit') {
      outward = true;
    }
  });
  return ownSide && !outward;
}

/**
 * Whether a feature arms a clock. Like a summons, it catches nobody when it is
 * used — what it does happens later — so the picker has to be told that using
 * it is the point.
 */
function armsCountdown(ability: AbilityDef): boolean {
  return ability.effects.some((effect) => effect.kind === 'countdown');
}

/**
 * The selector a feature calls its own kind in with, if it has one: the
 * `joinedBy` on the attack it makes.
 */
function swarmSelector(ability: AbilityDef): TargetSelector | null {
  for (const effect of ability.effects) {
    if (effect.kind === 'attack' && effect.joinedBy !== undefined) return effect.joinedBy;
  }
  return null;
}

/** A list ordered by how far it is from a creature, by id on a tie. */
function byDistance(demo: DemoScene, from: string, ids: readonly string[]): string[] {
  const here = demo.state.entity(from)!.tile;
  return [...ids].sort(
    (a, b) =>
      demo.grid.manhattanDistance(here, demo.state.entity(a)!.tile) -
        demo.grid.manhattanDistance(here, demo.state.entity(b)!.tile) || a.localeCompare(b),
  );
}

/** The nearest of a list to a creature, by id on a tie: the same rule a swing uses. */
function nearestOf(demo: DemoScene, from: string, ids: readonly string[]): string {
  return byDistance(demo, from, ids)[0]!;
}

/**
 * "Once per scene" on a stat block, counted the way a card's uses are: under
 * the creature's own id, so two of the same adversary each get their own, and
 * cleared when the fight ends.
 */
function featureUsesLeft(demo: DemoScene, adversaryId: string, ability: AbilityDef): number {
  if (ability.uses === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, ability.uses.count - (demo.scenario.abilityUses.get(useKey(adversaryId, ability.id)) ?? 0));
}

/** Play one, paying for it, with the adversary as the actor its script reads. */
/**
 * What the GM pays to use a feature.
 *
 * A block that says "Spend a Shadow to…" is taken at its word. An *action* that
 * names no cost at all still costs a Shadow, because otherwise the best feature
 * is simply what the adversary does every turn and its teeth never come into
 * it. A reaction is not chosen, so nothing is invented for it: "when the
 * Burrower takes Severe damage, all creatures within Close range are bathed in
 * acidic blood" happens, and an empty pool does not stop it.
 */
function featureBad(ability: AbilityDef, as: 'action' | 'reaction' = 'action'): number {
  const stated = ability.cost.bad ?? 0;
  if (stated > 0) return stated;
  if (as === 'reaction') return 0;
  return (ability.cost.stress ?? 0) === 0 && (ability.cost.good ?? 0) === 0 ? 1 : 0;
}

function useAdversaryFeature(demo: DemoScene, adversaryId: string, ability: AbilityDef, targets: readonly string[]): void {
  if (demo.gmTurn !== null) demo.gmTurn.features[adversaryId] = true;
  spendFeatureCost(demo, adversaryId, ability);
  runAdversaryScript(demo, adversaryId, ability, targets);
  settleFight(demo);
}

/** What using a stat block's feature costs the GM: Shadow out of the pool, a use off the card. */
function spendFeatureCost(
  demo: DemoScene,
  adversaryId: string,
  ability: AbilityDef,
  as: 'action' | 'reaction' = 'action',
): void {
  const bad = featureBad(ability, as);
  if (bad > 0) {
    demo.state.bad = { ...demo.state.bad, value: Math.max(0, demo.state.bad.value - bad) };
    note(demo, `The GM spends ${bad} Shadow.`, 'bad');
  }
  if (ability.uses !== undefined) {
    const key = useKey(adversaryId, ability.id);
    demo.scenario.abilityUses.set(key, (demo.scenario.abilityUses.get(key) ?? 0) + 1);
  }
}

/**
 * "When the Hunter is in the spotlight for the first time, activate the
 * countdown": the features that answer the spotlight itself.
 *
 * "For the first time" is `uses`, which every one of these carries, so nothing
 * here has to remember whose turn it is — the card runs out after one. It is a
 * reaction, so it does not spend the turn's one feature: the creature arms its
 * clock and then still swings.
 */
function playSpotlightReactions(demo: DemoScene, adversaryId: string): boolean {
  const entity = demo.state.entity(adversaryId);
  if (entity === undefined) return false;
  // Every one of them runs even once the turn is spent: a creature that spends
  // its spotlight gathering itself has still been spotlighted, and a clock that
  // arms on that is armed.
  let ended = false;
  for (const ability of demo.world.reactionsFor(adversaryId, 'spotlighted')) {
    if (ability.effects.length === 0) continue;
    if (!affordableReaction(demo, adversaryId, ability)) continue;
    // "When you spotlight the Lieutenant, mark a Stress to also spotlight two
    // allies": a Lieutenant standing alone would otherwise bleed a Stress
    // every turn for a rally nobody answers.
    if (spotlightsAllies(ability) && spotlightCandidates(demo, adversaryId, ability).length === 0) continue;
    spendFeatureCost(demo, adversaryId, ability, 'reaction');
    if (runAdversaryScript(demo, adversaryId, ability)) ended = true;
  }
  return ended;
}

/**
 * Advance every countdown this cue speaks to, and play the ones that reach 0.
 *
 * Countdowns are the one thing in a fight that nobody takes a turn to move:
 * the party rolls, a clock ticks, and some turns later something goes off.
 * This is where the table's events reach them.
 */
function tickCountdowns(demo: DemoScene, cue: CountdownCue): void {
  for (const moved of demo.world.advanceCountdowns(cue, demo.rng)) playCountdown(demo, moved);
}

/** Say what a countdown did, and run its effects if it went off. */
function playCountdown(demo: DemoScene, moved: CountdownMoved): void {
  if (!moved.fired) {
    note(demo, `${moved.countdown.name}: ${moved.value} to go.`, 'bad');
    return;
  }
  note(demo, `${moved.countdown.name} triggers.`, 'bad');
  runCountdown(demo, moved.countdown);
}

/**
 * A countdown going off, with the creature that armed it acting.
 *
 * That creature may be dead — the Ashen Tyrant's death throes are a countdown
 * that triggers *because* it fell — so nothing here asks whether it is still
 * standing. Its effects otherwise run exactly as a feature's do, which is what
 * lets a countdown summon something and have it act.
 */
function runCountdown(demo: DemoScene, countdown: RunningCountdown): void {
  const was = demo.scenario.actorId;
  demo.scenario.actorId = countdown.owner;
  // The same aim a stat block's own feature gets. "When it triggers, move the
  // Hunter in a straight line to a point within Far range" is the GM's charge
  // on a clock, and there is nobody at that end of the table to click a tile
  // for it either. A countdown the party armed is left unaimed, the way it was:
  // the nearest party member is the wrong end of the room for one of theirs.
  const aim =
    countdown.owner !== null && demo.state.entity(countdown.owner)?.faction === 'adversary'
      ? aimedAt(demo, countdown.owner)
      : NO_TILE;
  const runner = new ScriptRunner(demo.world, demo.rng, {
    targets: [],
    hit: [],
    rollAs: 'actor',
    ...(aim === NO_TILE ? {} : { point: aim }),
  });
  const result = runner.run(countdown.effects);
  record(demo, result.journal);
  demo.scenario.actorId = was;
  afterAdversaryScript(demo, result.journal);
  settleFight(demo);
}

function runAdversaryScript(
  demo: DemoScene,
  adversaryId: string,
  ability: AbilityDef,
  targets: readonly string[] = [],
  hit: readonly string[] = [],
  /**
   * What the blow that called for this feature left behind: the Hit Points it
   * marked, and the damage it rolled so `dice: 'same'` can throw it back. A
   * feature nobody hit reads zero, which is what it should see.
   */
  from: {
    counts?: Partial<Record<CountName, number>>;
    lastDamage?: { total: number; types?: readonly DamageType[] };
    roll?: { total: number; outcome: RollOutcome };
  } = {},
): boolean {
  const stress = ability.cost.stress ?? 0;
  if (stress > 0) demo.world.markStress(adversaryId, stress);
  note(demo, `The ${nameOf(demo, adversaryId)} uses ${ability.name}.`, 'combat');
  const was = demo.scenario.actorId;
  demo.scenario.actorId = adversaryId;
  const runner = new ScriptRunner(demo.world, demo.rng, {
    targets: [...targets],
    hit: [...hit],
    rollAs: 'actor',
    // Where the GM aims a charge. There is nobody at that end of the table to
    // click a tile, so a stat block that says "to a point within Far range"
    // runs at the nearest party member - the same rule its swing already uses
    // when it picks whom to hit. Bound whether or not the feature reads it: a
    // script that never asks for a point never notices.
    ...(aimedAt(demo, adversaryId) === NO_TILE ? {} : { point: aimedAt(demo, adversaryId) }),
    ...(from.counts === undefined ? {} : { counts: from.counts }),
    ...(from.lastDamage === undefined ? {} : { lastDamage: from.lastDamage }),
    ...(from.roll === undefined ? {} : { roll: from.roll }),
  });
  const result = runner.run(ability.effects);
  record(demo, result.journal);
  demo.scenario.actorId = was;
  afterAdversaryScript(demo, result.journal);
  return result.journal.some((entry) => entry.kind === 'spotlightEnded');
}

/**
 * The tile a stat block's charge runs at: the nearest party member's, or
 * nowhere when none of them is standing.
 */
function aimedAt(demo: DemoScene, adversaryId: string): number {
  const standing = demo.state.entitiesOf('party').filter((e) => e.alive && e.tile !== NO_TILE);
  if (standing.length === 0 || demo.state.entity(adversaryId)?.tile === NO_TILE) return NO_TILE;
  const nearest = nearestOf(demo, adversaryId, standing.map((e) => e.id));
  return demo.state.entity(nearest)?.tile ?? NO_TILE;
}

/**
 * What the ground does to somebody who has just walked onto it.
 *
 * The same trick `playPayouts` uses: the condition carries the script, and an
 * ability is built around it so it runs down the one path every script runs
 * down. The zone's owner acts, it being their spell - so a roll it makes hands
 * *them* the Light, and a `push` knocks the intruder away from *them*. Ground
 * nobody owns runs with the one who walked in on both sides of it.
 *
 * Never a question: walking into a fire is not a decision anybody makes after
 * the fact.
 */
function playZoneEntries(demo: DemoScene): void {
  for (const crossing of demo.world.drainEntered()) {
    const def = demo.world.conditionDef(crossing.condition);
    if (def?.onEnter === undefined || def.onEnter.effects.length === 0) continue;
    const walked = demo.state.entity(crossing.id);
    if (walked === undefined || !walked.alive) continue;
    const by = crossing.owner !== null && demo.state.entity(crossing.owner)?.alive === true ? crossing.owner : crossing.id;
    const ability = abilitySchema.parse({
      id: `zone-${crossing.condition}`,
      name: def.name,
      // On no card anybody holds: nothing puts it in a hand or a vault, and it is played here and
      // nowhere else.
      source: { card: `zone-${crossing.condition}` },
      text: 'The ground they just stepped onto.',
      kind: 'reaction',
      action: false,
      auto: true,
      effects: def.onEnter.effects,
    });
    playReaction(demo, { by, ability, targets: [crossing.id], counts: {} }, [], false);
  }
}

/** What the cards said about a roll, as the response that settles it. */
function answerFrom(said: readonly JournalEntry[]): Response {
  let reroll: 'good' | 'bad' | 'both' | undefined;
  let name = false;
  let raise = 0;
  for (const entry of said) {
    if (entry.kind === 'dualityRerolled') reroll = entry.which;
    if (entry.kind === 'rollNamed') name = true;
    if (entry.kind === 'rollRaised') raise += entry.by;
  }
  return {
    kind: 'answered',
    ...(reroll === undefined ? {} : { reroll }),
    ...(name ? { name: true } : {}),
    ...(raise > 0 ? { raise } : {}),
  };
}

/**
 * Put the roll to the room before the check reads it.
 *
 * The runner stops after the dice when somebody is holding a card that answers
 * one - and only then, so every chest, door and conversation runs as it always
 * did. What comes back is offered here, and the check settles around it.
 */
function offerOnRoll(
  demo: DemoScene,
  waiting: PendingScript,
  roll: DualityRoll,
  tags?: readonly string[],
  trait?: CheckTrait,
): UseOutcome {
  const roller = demo.scenario.actorId;
  const groups = roller === null ? [] : rollingOffers(demo, roller, roll, undefined, tags, trait);
  if (groups.length === 0 || !demo.askDefender) return resumeRolled(demo, waiting, { kind: 'answered' });
  const said: JournalEntry[] = [];
  const [first, ...queued] = groups;
  askReaction(demo, first!, queued, undefined, { script: waiting, said });
  return { status: 'waiting', lines: [] };
}

/** Carry the held script on, with what the room said about its roll. */
function resumeRolled(demo: DemoScene, waiting: PendingScript, response: Response): UseOutcome {
  demo.pending = waiting;
  return answerPending(demo, response);
}

/**
 * What a creature owed whoever swung at them, put to them as a card would be.
 *
 * The debt sits on the one who was marked and is collected by the one who
 * swung, because the card that wrote it has never heard of them: Lead by
 * Example pays "the next PC", whoever that turns out to be. It is offered
 * rather than taken, both because the SRD says *can* and because a bare script
 * written into `demo.pending` here would sit on top of whatever the swing's
 * own riders were already asking.
 *
 * Spending it is the last thing the script does, so a debt let pass is left
 * standing for the next one to swing - and with nobody at the table to ask, it
 * is simply not collected, the way every other optional card is not.
 *
 * Only the party's weapon swing reaches this. A card that swings through the
 * runner is a second path and does not pay yet.
 */
function playPayouts(
  demo: DemoScene,
  attacker: string,
  target: string,
  owed: readonly Payout[],
  roll?: { total: number; outcome: RollOutcome },
): void {
  const asked: ReactionOffer[][] = [];
  for (const debt of owed) {
    if (!demo.state.entity(target)?.conditions.has(debt.condition)) continue;
    // "When you succeed with Light against an adversary in this shadow": read
    // with the one who swung acting, the bearer bound and the roll they made
    // bound too, so the gate is the same `rolled` every card asks with.
    if (debt.when !== undefined) {
      const was = demo.scenario.actorId;
      demo.scenario.actorId = attacker;
      const holds = evaluate(debt.when, demo.world, {
        targets: [target],
        hit: [target],
        ...(roll === undefined ? {} : { roll }),
      });
      demo.scenario.actorId = was;
      if (!holds) continue;
    }
    const name = demo.world.conditionName(debt.condition);
    const ability = abilitySchema.parse({
      id: `payout-${debt.condition}`,
      name,
      // Not a card of theirs: a debt handed to whoever swung. It sits on no card anybody holds,
      // which is what keeps it out of every hand and out of the vault.
      source: { card: `payout-${debt.condition}` },
      text: 'What somebody else left you.',
      kind: 'reaction',
      action: false,
      // "The target must mark a Stress" is nobody's decision; a debt somebody
      // may decline is offered.
      auto: debt.auto === true,
      // Spent by whoever collects it - unless the condition is the standing
      // price itself, which is still there for the next one to swing.
      effects: debt.keeps === true
        ? [...debt.effects]
        : [...debt.effects, { kind: 'clearCondition', condition: debt.condition, target: { kind: 'target' } }],
    });
    const offer: ReactionOffer = { by: attacker, ability, targets: [target], counts: {} };
    if (debt.auto === true) {
      playReaction(demo, offer, [], false);
      continue;
    }
    asked.push([offer]);
  }
  if (asked.length > 0) offerReactions(demo, asked);
}

/**
 * What a stat block's script did to the GM's turn: who swung with a swarm, who
 * arrived, and who was handed the spotlight. One place, because every caller
 * that runs an adversary's effects owes all three.
 */
function afterAdversaryScript(demo: DemoScene, journal: readonly JournalEntry[]): void {
  spendSwarmSpotlights(demo, journal);
  spotlightArrivals(demo, journal);
  spotlightAllies(demo, journal);
  spotlightSelf(demo, journal);
  spotlightReplacements(demo, journal);
}

/**
 * "The Construct can then take the spotlight again."
 *
 * Back to the head of the queue, and granted: whatever said so has paid for
 * the turn, so the GM is not billed and the turn does not stop for want of
 * Shadow it never owed. It is filtered out first because a creature with a
 * Relentless spotlight still to come is already standing there.
 */
function spotlightSelf(demo: DemoScene, journal: readonly JournalEntry[]): void {
  const turn = demo.gmTurn;
  if (turn === null) return;
  for (const entry of journal) {
    if (entry.kind !== 'spotlightedAgain' || entry.id === null) continue;
    if (demo.state.entity(entry.id)?.alive !== true) continue;
    turn.remaining = turn.remaining.filter((waiting) => waiting !== entry.id);
    turn.remaining.unshift(entry.id);
    turn.granted.add(entry.id);
  }
}

/**
 * "…and immediately spotlight them": what a phase change stands up acts at
 * once, on the coin the feature already paid. The one it replaced is taken out
 * of the queue - it is not on the map any more.
 */
function spotlightReplacements(demo: DemoScene, journal: readonly JournalEntry[]): void {
  const turn = demo.gmTurn;
  if (turn === null) return;
  for (const entry of journal) {
    if (entry.kind !== 'replaced') continue;
    // Whatever is no longer on the map has no turn coming: the one replaced,
    // and anything else a script took away.
    turn.remaining = turn.remaining.filter((waiting) => demo.state.entity(waiting) !== undefined);
    if (!entry.spotlight) continue;
    const arriving = entry.ids.filter((id) => !turn.remaining.includes(id));
    turn.remaining.unshift(...arriving);
    for (const id of arriving) turn.granted.add(id);
  }
}

/**
 * "Spend 2 Shadow to spotlight up to five allies within Far range."
 *
 * They go to the head of the queue and act on this turn, and the Shadow the
 * feature cost is all the GM pays: `granted` tells `runGmTurn` not to charge
 * for them. One that was already waiting further down is moved rather than
 * added, or it would take two turns out of one spotlight.
 */
function spotlightAllies(demo: DemoScene, journal: readonly JournalEntry[]): void {
  const turn = demo.gmTurn;
  // Nothing to hand out when nobody is taking a GM turn: a countdown that
  // fires on a player's roll, or a scene script, has no queue to put anyone at
  // the head of, and the creatures named simply wait for the next turn.
  if (turn === null) return;
  for (const entry of journal) {
    if (entry.kind !== 'spotlighted') continue;
    const called = entry.ids.filter((id) => demo.state.entity(id)?.alive === true);
    turn.remaining = turn.remaining.filter((waiting) => !called.includes(waiting));
    turn.remaining.unshift(...called);
    for (const id of called) {
      turn.granted.add(id);
      if (entry.halfDamage) turn.halved.add(id);
    }
  }
}

/**
 * "…and is immediately spotlighted": what a feature summons into the middle of
 * the GM's own turn acts now, at the head of the queue, rather than waiting
 * for the next one.
 *
 * Everything summoned without that line needs nothing done to it: the
 * encounter reads the map for who is waiting, so it is in next turn's queue by
 * standing there.
 */
function spotlightArrivals(demo: DemoScene, journal: readonly JournalEntry[]): void {
  const turn = demo.gmTurn;
  if (turn === null) return;
  for (const entry of journal) {
    if (entry.kind !== 'summoned' || !entry.spotlight) continue;
    const arriving = entry.ids.filter((id) => !turn.remaining.includes(id));
    turn.remaining.unshift(...arriving);
    // The feature's own cost brought them and gave them the spotlight, so the
    // GM is not billed again for the turn they walk into - and the turn does
    // not stop for want of Shadow it never owed.
    for (const id of arriving) turn.granted.add(id);
  }
}

/**
 * A creature that swung with the swarm has taken its turn.
 *
 * "Spotlight all Giant Rats within Close range" hands them the spotlight for
 * this attack and no other: without this the rats that piled in would each
 * come round again on their own and swing a second time.
 */
function spendSwarmSpotlights(demo: DemoScene, journal: readonly JournalEntry[]): void {
  const turn = demo.gmTurn;
  if (turn === null) return;
  for (const entry of journal) {
    if (entry.kind !== 'attack' || entry.joined === undefined) continue;
    for (const id of entry.joined) {
      turn.remaining = turn.remaining.filter((waiting) => waiting !== id);
      turn.spotlights[id] = (turn.spotlights[id] ?? 0) + 1;
      // The Shadow the feature cost bought this swing: `grantSpotlight` marks
      // them as having acted without billing the GM a second time.
      demo.encounter?.grantSpotlight(id);
    }
  }
}

/**
 * "When the Knight takes damage from an attack within Melee range, mark a
 * Stress to deal 1d10+5 physical damage to the attacker": the features that
 * answer a wound, played once for each blow that landed.
 *
 * Three triggers come off the same queue, in the order the SRD words them:
 * `tookDamage` for anything that got through, `tookHitPoints` for the ones
 * that say "when they mark HP", and `tookSevere` for a Severe wound. Whoever
 * dealt it is bound as the target, because most of these hit back, and the
 * reach the feature names is read against where that creature is standing.
 */
function playDamageReactions(demo: DemoScene): void {
  const asked: ReactionOffer[][] = [];
  // A feature that answers a wound can deal one of its own - the Ogre's charge
  // cuts through whoever hurt it - and that blow is noted behind the drain
  // being read, because `drainDamage` clears as it reports. So the room is
  // drained until it is quiet. The cap is for two creatures answering each
  // other: a ring of counter-blows stops rather than hangs the fight.
  for (let pass = 0; pass < 4; pass++) {
    const took = demo.world.drainDamage();
    if (took.length === 0) break;
    for (const note of took) {
      const entity = demo.state.entity(note.id);
      if (entity === undefined || !entity.alive) continue;
      const attacker = note.attacker !== null && demo.state.entity(note.attacker)?.alive === true ? note.attacker : null;
      const triggers: NonNullable<AbilityDef['trigger']>[] = ['tookDamage'];
      if (note.hitPoints > 0) triggers.push('tookHitPoints');
      if (note.severe) triggers.push('tookSevere');
      const counts = { hitPointsTaken: note.hitPoints };
      const bound = attacker === null ? [] : [attacker];
      const lastDamage = { total: note.damage, types: note.types };

      // The party's half of the same rule. A card they can afford and would
      // choose is offered; one that costs nothing and asks nothing simply runs.
      if (entity.faction === 'party') {
        const offers = offersFor(demo, note.id, triggers, bound, counts, { lastDamage });
        if (offers.length > 0) asked.push(offers);
        // And what the rest of the party makes of one of their own being hit.
        // Everyone standing hears it, wherever they are: a card that cares how
        // far away it happened says so in its own gate, the way the reach on a
        // stat block's feature is read from the reactor.
        for (const other of demo.state.entitiesOf('party')) {
          if (other.id === note.id || !other.alive) continue;
          const theirs = offersFor(demo, other.id, ['allyTookDamage'], bound, counts, { lastDamage });
          if (theirs.length > 0) asked.push(theirs);
        }
        asked.push(...nearbyOffers(demo, note.id, bound, counts, lastDamage));
        continue;
      }
      if (entity.faction !== 'adversary') continue;

      for (const trigger of triggers) {
        for (const ability of demo.world.reactionsFor(note.id, trigger, { targets: bound, hit: bound, counts })) {
          if (ability.effects.length === 0) continue;
          if (!affordableReaction(demo, note.id, ability)) continue;
          spendFeatureCost(demo, note.id, ability, 'reaction');
          runAdversaryScript(demo, note.id, ability, bound, bound, { counts, lastDamage });
        }
      }
      asked.push(...nearbyOffers(demo, note.id, bound, counts, lastDamage));
    }
  }
  // Every note is read before anyone is asked: `drainDamage` clears as it
  // reports, so an offer left behind a question would never be made.
  offerReactions(demo, asked);
}

/**
 * What everybody else in the room makes of somebody being hurt.
 *
 * Whoever dealt it is bound as the target and whoever took it as the hit, so a
 * feature can ask how far away either of them is: the Shark smells blood at
 * Close range from the one bleeding, not from the one who cut them. A stat
 * block's own runs where it stands; a card comes back to be offered.
 */
function nearbyOffers(
  demo: DemoScene,
  wounded: string,
  dealer: readonly string[],
  counts: Partial<Record<CountName, number>>,
  lastDamage: { total: number; types: readonly DamageType[] },
): ReactionOffer[][] {
  const asked: ReactionOffer[][] = [];
  for (const other of [...demo.state.entitiesOf('party'), ...demo.state.entitiesOf('adversary')]) {
    if (other.id === wounded || !other.alive) continue;
    if (other.faction === 'party') {
      // The same two bindings the stat block's half of this gets: whoever
      // dealt it as the target, whoever took it as the hit.
      const theirs = offersFor(demo, other.id, ['nearbyTookDamage'], dealer, counts, {
        lastDamage,
        hit: [wounded],
      });
      if (theirs.length > 0) asked.push(theirs);
      continue;
    }
    if (other.faction !== 'adversary') continue;
    for (const ability of demo.world.reactionsFor(other.id, 'nearbyTookDamage', {
      targets: [...dealer],
      hit: [wounded],
      counts,
    })) {
      if (ability.effects.length === 0 || !affordableReaction(demo, other.id, ability)) continue;
      spendFeatureCost(demo, other.id, ability, 'reaction');
      runAdversaryScript(demo, other.id, ability, dealer, [wounded], { counts, lastDamage });
    }
  }
  return asked;
}

/**
 * What a party member can play about something that has already happened, and
 * what they simply do.
 *
 * The free reactions run here - "when you mark 1 or more Hit Points from an
 * attack, clear a Stress" is not a decision - and what is left is handed back
 * to be put to the player.
 */
function offersFor(
  demo: DemoScene,
  id: string,
  triggers: readonly NonNullable<AbilityDef['trigger']>[],
  bound: readonly string[],
  counts: Partial<Record<CountName, number>>,
  /** Everything else the moment left behind, all of it optional. */
  left: {
    lastDamage?: { total: number; types: readonly DamageType[] };
    /**
     * A swing of the holder's waiting on these cards, carried in a box because
     * a card that runs on its own runs *here*, and what it said about the blow
     * has to reach the caller that is still holding it. Without this the free
     * half of a card - a Sigil rolling the dice it collected - would be written
     * to the log and then thrown away.
     */
    landing?: { held: HeldSwing };
    /** The roll that raised the moment, for a card that asks what it was. */
    roll?: { total: number; outcome: RollOutcome; tags?: readonly string[]; trait?: CheckTrait };
    /** And its dice, for a card that puts the same roll against somebody else. */
    swing?: DualityRoll;
    /** Who else the moment names, when it names two - see `ReactionOffer`. */
    hit?: readonly string[];
  } = {},
): ReactionOffer[] {
  const { lastDamage, landing, roll } = left;
  const beaten = left.hit ?? bound;
  const offers: ReactionOffer[] = [];
  const seen = new Set<string>();
  for (const trigger of triggers) {
    const bindings = {
      targets: [...bound],
      hit: [...beaten],
      counts,
      ...(roll === undefined ? {} : { roll }),
    };
    for (const ability of demo.world.reactionsFor(id, trigger, bindings)) {
      if (ability.effects.length === 0 || seen.has(ability.id)) continue;
      seen.add(ability.id);
      const holder = defenderFor(demo, id);
      if (holder === null || !canPlay(demo, id, holder, ability)) continue;
      const offer: ReactionOffer = {
        by: id,
        ability,
        targets: [...bound],
        ...(left.hit === undefined ? {} : { hit: [...left.hit] }),
        counts,
        ...(lastDamage === undefined ? {} : { lastDamage }),
        ...(roll === undefined ? {} : { roll }),
        ...(left.swing === undefined ? {} : { swing: left.swing }),
      };
      // Free and automatic is not a question: it happens, the way a stat
      // block's own reactions do.
      if (ability.auto && (ability.cost.good ?? 0) === 0 && (ability.cost.stress ?? 0) === 0) {
        const ran: JournalEntry[] = [];
        // The landing goes with it: a card that finishes at once is folded
        // into the box below, and one that stops to ask something lands the
        // blow itself when it is answered.
        playReaction(demo, offer, [], false, landing?.held, ran);
        if (landing !== undefined) landing.held = asAnswered(demo, landing.held, ran) ?? landing.held;
        continue;
      }
      offers.push(offer);
    }
  }
  return offers;
}

/**
 * Put the first group of offers to the player and keep the rest for after.
 *
 * With nobody at the table to ask - a test, or the demo deciding for the party
 * - an optional card is simply not played: spending someone's Light for them is
 * worse than letting the moment pass.
 */
function offerReactions(demo: DemoScene, groups: readonly (readonly ReactionOffer[])[]): void {
  const waiting = groups.filter((group) => group.length > 0);
  if (waiting.length === 0 || !demo.askDefender) return;
  const pending = demo.pending;
  if (pending !== null) {
    // Somebody is already being asked about a card of their own: queue behind
    // them rather than drop this one. Behind any other question - a defence
    // prompt, a script waiting on a roll - the offer is dropped, which nothing
    // reaches today: the blows are all resolved by the time these are read.
    if (pending.kind === 'reaction') demo.pending = { ...pending, queued: [...pending.queued, ...waiting] };
    return;
  }
  const [first, ...queued] = waiting;
  askReaction(demo, first!, queued);
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

/** The question itself: one character, their cards, and letting it pass. */
function askReaction(
  demo: DemoScene,
  offers: readonly ReactionOffer[],
  queued: readonly (readonly ReactionOffer[])[],
  landing?: HeldSwing,
  resuming?: ResumingScript,
): void {
  const who = nameOf(demo, offers[0]!.by);
  demo.pending = {
    kind: 'reaction',
    offers,
    queued,
    ...(landing === undefined ? {} : { landing }),
    ...(resuming === undefined ? {} : { resuming }),
    prompt: {
      kind: 'choice',
      title: `${who} can answer that`,
      body: offers.map((offer) => offer.ability.name).join(', '),
      options: [
        { index: 0, label: 'Let it pass' },
        ...offers.map((offer, index) => ({
          index: index + 1,
          label: `${offer.ability.name}${costOf(offer.ability) === '' ? '' : ` (${costOf(offer.ability)})`}`,
        })),
      ],
    },
  };
}

/**
 * Run one of the party's reactions: pay for it, then play its script with the
 * numbers the blow left behind.
 *
 * A card that stops to ask something keeps the floor, exactly as an interrupt
 * does, and whatever was queued behind it is asked when it finishes.
 */
function playReaction(
  demo: DemoScene,
  offer: ReactionOffer,
  queued: readonly (readonly ReactionOffer[])[] = [],
  /**
   * Whether finishing this card is what the fight was waiting on.
   *
   * A free reaction runs in the middle of the blow that raised it - inside the
   * GM's own turn - and must not pick that turn up again from there: the
   * caller is still playing it. Only a card the player was asked about, or one
   * that stopped to ask something of its own, resumes anything.
   */
  resume = false,
  /** A swing of theirs waiting on this card, to be landed once it is done. */
  landing?: HeldSwing,
  /** Where to report what the card did, for a caller still holding the blow. */
  into?: JournalEntry[],
  /** A script stopped mid-roll, to be carried on once this card is done. */
  resuming?: ResumingScript,
): void {
  if (!payFor(demo, offer.by, offer.ability)) {
    if (resume) afterReaction(demo, queued, landing, resuming);
    return;
  }
  note(demo, `${nameOf(demo, offer.by)}: ${offer.ability.name}.`, 'good');
  const was = demo.scenario.actorId;
  demo.scenario.actorId = offer.by;
  const runner = new ScriptRunner(demo.world, demo.rng, {
    targets: [...offer.targets],
    hit: [...(offer.hit ?? offer.targets)],
    rollAs: 'actor',
    counts: offer.counts,
    ...(offer.lastDamage === undefined ? {} : { lastDamage: offer.lastDamage }),
    ...(offer.roll === undefined ? {} : { roll: offer.roll }),
    ...(offer.swing === undefined ? {} : { swing: offer.swing }),
  });
  const result = runner.run(offer.ability.effects);
  record(demo, result.journal);
  if (into !== undefined) into.push(...result.journal);
  if (result.status === 'waiting') {
    demo.pending = {
      kind: 'script',
      runner,
      prompt: result.prompt,
      interactable: null,
      recorded: result.journal.length,
      dialogue: null,
      onDone: (done) => {
        demo.scenario.actorId = was;
        // "Then place this card in your vault" reads at the end of the card,
        // and a card that stopped to roll something has its end here rather
        // than above: without this a reaction that vaults only vaults when it
        // had nothing to ask.
        vaultAfter(demo, offer.by, offer.ability, runner);
        if (into !== undefined) into.push(...done.entries);
        afterReaction(demo, queued, asAnswered(demo, landing, done.entries), resuming);
      },
    };
    return;
  }
  demo.scenario.actorId = was;
  vaultAfter(demo, offer.by, offer.ability, runner);
  if (resume) afterReaction(demo, queued, asAnswered(demo, landing, result.journal), resuming);
}

/**
 * "Then place this card in your vault."
 *
 * Out of the loadout and into the vault, which is where the SRD puts a card
 * that has spent itself - and is the whole limit on the three that cost
 * nothing else. Getting it back is `swapCard` and the Recall Cost, like any
 * other card down there.
 *
 * The sheet is rewritten, so the world is rebuilt over it: a card that is no
 * longer in the loadout is no longer offering its reactions or its modifiers.
 */
export function vaultAfter(demo: DemoScene, id: string, ability: AbilityDef, runner: ScriptRunner): void {
  // Only a chosen card has a vault to go to. The loadout below is what says it was chosen: a
  // granted card is never in one.
  const cardId = cardOf(ability);
  if (!runner.vaulted) return;
  const sheet = demo.sheets.get(id);
  const character = demo.characters.get(id);
  if (sheet === undefined || character === undefined) return;
  const loadout = loadoutOf(character);
  if (!loadout.includes(cardId)) return;
  setSheet(demo, { ...sheet, loadout: loadout.filter((held) => held !== cardId) });
  refreshWorld(demo);
  syncPools(demo);
  note(demo, `${nameOf(demo, id)} places ${ability.name} in the vault.`, 'system');
}

/**
 * The swing, with whatever the card said about it.
 *
 * The same sum the GM's side makes, read off the same journal entries, plus
 * the one thing a card can say that is not a sum: a number of Hit Points to
 * mark instead of rolling. Both are read here rather than written, so the
 * thresholds and the Armor Slots read what actually arrives.
 */
function asAnswered(demo: DemoScene, held: HeldSwing | undefined, journal: readonly JournalEntry[]): HeldSwing | undefined {
  // The dice first: a card that put one of them back in the cup changes what
  // the rest of this is even about, and a swing that has become a miss has no
  // damage for the riders below to add to.
  const landing = asRerolled(demo, held, journal);
  if (landing === undefined || landing.outcome.damageRoll === undefined) return landing;
  let added = 0;
  let doubled = false;
  let types: readonly DamageType[] | undefined;
  let forced: number | undefined;
  let band: DamageSeverity | undefined;
  let floor: DamageSeverity | undefined;
  for (const entry of journal) {
    if (entry.kind === 'damageBoosted') added += entry.by;
    if (entry.kind === 'damageDoubled') doubled = true;
    if (entry.kind === 'damageRetyped') types = entry.types;
    // "The maximum result of one of your damage dice instead of rolling it."
    // Simplified: the lowest die of the roll is the one lifted, which is the
    // one anybody would choose and saves asking. Read here rather than in the
    // script because only the blow knows what the faces came up.
    if (entry.kind === 'dieMaxed') added += liftLowest(landing.outcome.damageRoll);
    // "You can reroll any 1s or 2s": thrown again where the faces can be seen,
    // and what comes up stands - a reroll is a reroll, not a pick of the two.
    if (entry.kind === 'damageRerolled') added += rerollLow(demo, landing.outcome.damageRoll, entry.below);
    // Two cards forcing one blow is not a thing the SRD writes; the larger
    // wins, so the order they were played in decides nothing.
    if (entry.kind === 'hitPointsForced') forced = Math.max(forced ?? 0, entry.to);
    if (entry.kind === 'severityForced') {
      if (entry.least === true) floor = worse(floor, entry.severity);
      else band = worse(band, entry.severity);
    }
  }
  if (added <= 0 && !doubled && types === undefined && forced === undefined && band === undefined && floor === undefined) {
    return landing;
  }
  return {
    ...landing,
    ...(added <= 0 ? {} : { boost: (landing.boost ?? 0) + added }),
    ...(doubled ? { doubled: true } : {}),
    ...(types === undefined ? {} : { types }),
    ...(forced === undefined ? {} : { forced: Math.max(landing.forced ?? 0, forced) }),
    ...(band === undefined ? {} : { severity: worse(landing.severity, band) }),
    ...(floor === undefined ? {} : { floor: worse(landing.floor, floor) }),
  };
}

/**
 * The swing rebuilt around Duality Dice that were thrown again.
 *
 * The named die goes back in the cup, `withFaces` reads the whole roll from the
 * new pair - a matched pair is a critical however it got there - and the attack
 * is resolved once more with that roll supplied, so nothing about the throw is
 * drawn twice.
 *
 * The damage *is* rolled again, and that is right rather than wasteful: a swing
 * that has become a critical needs a critical's dice, and one that has become a
 * miss needs none. The dice the first attempt rolled are thrown away, which
 * costs the fight nothing - they came off the seed and were never read.
 *
 * Simplified: "reroll their dice" is the two Duality Dice. An advantage die and
 * the Help dice stand, being properties of the roll rather than of the hands
 * that threw it.
 */
function asRerolled(demo: DemoScene, held: HeldSwing | undefined, journal: readonly JournalEntry[]): HeldSwing | undefined {
  if (held === undefined) return held;
  const roll = held.outcome.dualityRoll;
  if (roll === undefined) return held;
  let which: 'good' | 'bad' | 'both' | null = null;
  let named = false;
  let raised = 0;
  for (const entry of journal) {
    if (entry.kind === 'dualityRerolled') which = entry.which;
    if (entry.kind === 'rollNamed') named = true;
    if (entry.kind === 'rollRaised') raised += entry.by;
  }
  if (which === null && !named && raised === 0) return held;

  const attacker = demo.state.entity(held.attacker);
  const target = demo.state.entity(held.target);
  const character = demo.characters.get(held.attacker);
  if (attacker === undefined || target === undefined || character === undefined) return held;

  // Drawn in the printed order, so a seed replays a reroll exactly.
  const faces: { good?: number; bad?: number } = {};
  if (which !== null && which !== 'bad') faces.good = demo.rng.die(roll.goodSides ?? GOOD_DIE_SIDES);
  if (which !== null && which !== 'good') faces.bad = demo.rng.die(BAD_DIE_SIDES);
  let thrown = withFaces(roll, faces);
  // A number put behind it goes on first; a named total makes up the rest.
  if (raised > 0) thrown = withFaces({ ...thrown, modifier: thrown.modifier + raised }, {});
  // A named total moves the number and leaves the dice alone.
  if (named && !thrown.success) {
    thrown = withFaces({ ...thrown, modifier: thrown.modifier + (thrown.difficulty - thrown.total) }, {});
  }
  note(
    demo,
    `${nameOf(demo, held.attacker)} throws again: ${describeRoll(thrown)}`,
    thrown.success ? 'good' : 'bad',
  );

  const profile = attackProfile(character);
  const outcome = resolveAttack(demo.rng, {
    grid: demo.grid,
    attacker,
    target,
    profile,
    defender: demo.world.defenderOf(target),
    options: {
      bandTiles: DEMO_BAND_TILES,
      bonus: demo.world.rollBonus(held.attacker, 'attackRoll', { melee: held.melee }),
      damageBonus: demo.world.rollBonus(held.attacker, 'damageRoll', { melee: held.melee }),
      ...demo.world.advantageFor(held.attacker, held.target),
      roll: thrown,
    },
  });
  // A swing that was in range when it was thrown is in range now: nobody has
  // moved. A refusal here would be the geometry disagreeing with itself.
  if (outcome.refused !== null) return held;
  // What the room had already put behind the old blow is dropped with it: a
  // boost was added to dice that are gone. Nothing ships a card that boosts
  // before the reroll is asked, and this says which way that falls if one does.
  // A roll that had already paid out does not pay again for its new dice. Nothing ships a card that
  // rerolls after `afterRolled`; this says which way that falls if one does.
  return {
    attacker: held.attacker,
    target: held.target,
    outcome,
    weapon: held.weapon,
    melee: held.melee,
    damage: held.damage,
    ...(held.direct === undefined ? {} : { direct: held.direct }),
    ...(held.settled === undefined ? {} : { settled: held.settled }),
  };
}

/**
 * What lifting one die to its highest face is worth on a roll already made.
 *
 * The lowest of them, because that is the one a player would pick and there is
 * nothing else to weigh. A roll with no dice in it - a flat weapon, a blow
 * whose damage was forced - is worth nothing, which is the honest answer.
 */
function rerollLow(demo: DemoScene, roll: DamageRollResult | undefined, below: number): number {
  if (roll === undefined || roll.rolls.length === 0) return 0;
  let moved = 0;
  for (const face of roll.rolls) {
    if (face >= below) continue;
    const fresh = rollDice(demo.rng, { count: 1, sides: roll.expression.sides, modifier: 0 }).total;
    moved += fresh - face;
  }
  return moved;
}

/**
 * What throwing the low faces of a blow again is worth, for better or worse.
 *
 * The dice come off the same seeded stream as everything else, and what they
 * come up is what stands: "reroll any 1s or 2s" is not "roll them again and
 * keep the better", and a card that could only help would be a different card.
 */
function liftLowest(roll: DamageRollResult | undefined): number {
  if (roll === undefined || roll.rolls.length === 0) return 0;
  return Math.max(0, roll.expression.sides - Math.min(...roll.rolls));
}

/** The harder of two bands, for the same reason the larger of two forced numbers wins. */
function worse(a: DamageSeverity | undefined, b: DamageSeverity): DamageSeverity {
  if (a === undefined) return b;
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

/** Ask the next character what they make of it, or let the fight carry on. */
function afterReaction(
  demo: DemoScene,
  queued: readonly (readonly ReactionOffer[])[],
  landing?: HeldSwing,
  resuming?: ResumingScript,
): void {
  if (demo.pending !== null) return;
  const waiting = queued.filter((group) => group.length > 0);
  if (waiting.length > 0) {
    const [first, ...rest] = waiting;
    askReaction(demo, first!, rest, landing, resuming);
    return;
  }
  // A script held mid-roll picks up where it stopped, told what was said.
  if (resuming !== undefined) {
    resumeRolled(demo, resuming.script, answerFrom(resuming.said));
    return;
  }
  // Whatever was said about it, the blow still lands - unless it was stopped
  // one stage earlier than that, in which case the stages it has not been
  // through yet are still to come.
  if (landing !== undefined) {
    if (landing.stage === 'rolled') {
      const { stage: _done, ...rest } = landing;
      afterRolled(demo, rest);
    } else {
      landPartyAttack(demo, landing);
    }
  }
  // A fall that happened behind this queue was held until the queue drained,
  // and so was the reckoning: a card with no swing waiting on it reaches
  // nothing else that settles the fight.
  playDeathMoves(demo);
  if (demo.pending === null) settleFight(demo);
  if (demo.gmTurn !== null) runGmTurn(demo);
}

/**
 * What the room makes of a roll the party made.
 *
 * "When a PC rolls a failure with Shadow while within Close range of the Demon,
 * they lose a Light." The one who rolled is bound as the target - which is how
 * a feature measures the distance to them - and what the roll was is read by a
 * `rolled` condition on the feature's own gate.
 *
 * Both sides answer it. The GM's features read the party's rolls as they
 * always did; the party's own cards hear them too, which is what "when you
 * fail an action roll" and "when an ally fails an action roll" each need, and
 * `self` is the question that tells those two apart.
 */
function playPartyRolled(demo: DemoScene, roller: string, roll: DualityRoll): void {
  if (demo.state.entity(roller)?.faction !== 'party') return;
  const bindings = { targets: [roller], hit: [roller], roll: { total: roll.total, outcome: roll.outcome } };
  // Spent before anybody is asked: what the roller was carrying for their next
  // roll was carried into this one, and this is it.
  demo.world.endsOnRoll(roller);
  // The party's half of the same moment. Whoever rolled is bound as the
  // target, so a card that only answers its holder's own roll says `self` and
  // one that answers an ally's says nothing.
  const asked: ReactionOffer[][] = [];
  for (const member of demo.state.entitiesOf('party')) {
    if (!member.alive) continue;
    const theirs = offersFor(demo, member.id, ['partyRolled'], [roller], {}, { roll: bindings.roll });
    if (theirs.length > 0) asked.push(theirs);
  }
  offerReactions(demo, asked);
  for (const entity of [...demo.state.entitiesOf('adversary')]) {
    if (!entity.alive) continue;
    for (const ability of demo.world.reactionsFor(entity.id, 'partyRolled', bindings)) {
      if (ability.effects.length === 0) continue;
      if (!affordableReaction(demo, entity.id, ability)) continue;
      spendFeatureCost(demo, entity.id, ability, 'reaction');
      runAdversaryScript(demo, entity.id, ability, [roller], [roller], { roll: bindings.roll });
    }
  }
}

/**
 * The rolls a script made on the party's behalf, in the order they were made.
 *
 * The same two entries the countdown cues read: a check is rolled by whoever
 * the script is acting as, and an attack names its own roller.
 */
function rollsFrom(demo: DemoScene, journal: readonly JournalEntry[]): { roller: string; roll: DualityRoll }[] {
  const rolls: { roller: string; roll: DualityRoll }[] = [];
  for (const entry of journal) {
    if (entry.kind === 'check') {
      const roller = demo.scenario.actorId;
      if (roller !== null && demo.state.entity(roller)?.faction === 'party') rolls.push({ roller, roll: entry.roll });
    }
    if (entry.kind === 'attack' && entry.roll !== undefined) {
      if (demo.state.entity(entry.attacker)?.faction === 'party') rolls.push({ roller: entry.attacker, roll: entry.roll });
    }
  }
  return rolls;
}

/**
 * "This bonus lasts until after the next attack made against you."
 *
 * Raised once a swing at somebody is over, whether it landed or went wide -
 * the card counts attacks, not wounds. It carries no numbers: what a blow did
 * is what `tookDamage` and its two siblings are for.
 */
function playAttackedOn(demo: DemoScene, defenderId: string, attackerId: string): void {
  const entity = demo.state.entity(defenderId);
  if (entity === undefined || !entity.alive) return;
  const bound = demo.state.entity(attackerId)?.alive === true ? [attackerId] : [];
  if (entity.faction === 'party') {
    offerReactions(demo, [offersFor(demo, defenderId, ['attacked'], bound, {})]);
    return;
  }
  for (const ability of demo.world.reactionsFor(defenderId, 'attacked', { targets: bound, hit: bound })) {
    if (ability.effects.length === 0) continue;
    if (!affordableReaction(demo, defenderId, ability)) continue;
    spendFeatureCost(demo, defenderId, ability, 'reaction');
    runAdversaryScript(demo, defenderId, ability, bound, bound);
  }
}

/** Whether the GM can pay for a stat block's reaction right now. */
function affordableReaction(demo: DemoScene, adversaryId: string, ability: AbilityDef): boolean {
  const entity = demo.state.entity(adversaryId);
  if (entity === undefined) return false;
  if ((ability.cost.stress ?? 0) > unmarked(entity.stress)) return false;
  if (featureBad(ability, 'reaction') > demo.state.bad.value) return false;
  return featureUsesLeft(demo, adversaryId, ability) > 0;
}

/**
 * Move within Close range towards a tile, stopping as soon as the target is in
 * the attack's reach. Adversaries do not roll to move, per the SRD.
 */
function approach(demo: DemoScene, adversaryId: string, targetTile: number, reach: RangeBand): void {
  const adversary = demo.state.entity(adversaryId);
  if (adversary === undefined || adversary.tile === NO_TILE) return;
  // The same measure the swing will use: a corner-to-corner neighbour is
  // already in Melee and does not walk to a side first.
  const already = demo.world.bandBetween(adversary.tile, targetTile);
  if (already !== null && reaches(already, reach)) return;

  const field = demo.pathfinder.reachable(adversary.tile, maxTilesForBand('close', DEMO_BAND_TILES), {
    rules: DEMO_MOVEMENT,
    isBlocked: demo.state.blockedFor(adversaryId),
  });
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
  if (best === adversary.tile) return;
  const stood = { ...adversary.at };
  const path = tracePath(field, best);
  const route =
    path === null
      ? undefined
      : smoothPath(demo.grid, path, demo.state.blockedFor(adversaryId), DEMO_WALK, { start: stood, end: demo.grid.spotOf(best) });
  demo.state.moveEntity(adversaryId, best);
  demo.motions.push(path === null ? { id: adversaryId } : route === undefined ? { id: adversaryId, path } : { id: adversaryId, path, route });
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

/**
 * "…or the GM spends a Shadow on their turn to clear this condition": the Shadow
 * is spent when there is one, on whatever holds the adversary from acting.
 */
function clearWithBad(demo: DemoScene, adversaryId: string): void {
  const adversary = demo.state.entity(adversaryId);
  if (adversary === undefined || demo.state.bad.value < 1) return;
  const held = demo.world.blocking(adversaryId, 'act');
  if (held.length === 0) return;
  demo.state.bad = { ...demo.state.bad, value: demo.state.bad.value - 1 };
  for (const condition of held) {
    adversary.conditions.delete(condition);
    adversary.conditionDurations.delete(condition);
  }
  note(demo, `The GM spends a Shadow: the ${nameOf(demo, adversaryId)} shakes off ${held.join(' and ')}.`, 'bad');
}

/**
 * Returns whether the attack was made at all (false when out of reach). A hit
 * may leave the defender deciding: `demo.pending` is set and the GM's turn
 * waits for the answer.
 */
function attackPartyMember(demo: DemoScene, adversaryId: string, targetId: string): boolean {
  const adversary = demo.state.entity(adversaryId);
  const target = demo.state.entity(targetId);
  if (adversary === undefined || target === undefined) return false;
  const character = demo.characters.get(target.id);
  const def = statBlock(demo, adversaryId);
  // What its passives make of this swing, at this target: "1d10+4 instead of
  // their standard damage", "double damage to PCs with 0 Light".
  const swing = demo.world.standardAttackOf(def.id, { attacker: adversaryId, target: targetId });
  const rolled = resolveAttack(demo.rng, {
    grid: demo.grid,
    attacker: adversary,
    target,
    profile: {
      kind: 'adversary',
      name: def.attackName,
      modifier: def.attackModifier,
      range: def.attackRange,
      // A Horde's standard attack changes once half its Hit Points are
      // marked; a passive that swaps the damage outright wins over that, the
      // way the block's own words read.
      damage: swing.damage ?? attackDamageOf(def, adversary.hitPoints),
      ...(swing.direct === undefined ? {} : { direct: swing.direct }),
      ...(swing.double === undefined ? {} : { double: swing.double }),
    },
    // The target defends with the Evasion and thresholds their sheet derives,
    // plus whatever their conditions add; the defence step below decides the
    // Armor Slots and reactions, so none are marked here.
    defender: demo.world.defenderOf(target),
    options: { bandTiles: DEMO_BAND_TILES, armorSlotsMarked: 0, ...demo.world.advantageFor(adversaryId, targetId) },
  });
  if (rolled.refused !== null) return false;
  // The other side of the party's own swing: what the one being swung at makes
  // whoever swings at them pay. "When they target you with an attack" is the
  // aiming rather than the landing, so it is collected here - the swing was
  // made, and whether it lands is still to come.
  //
  // Everything that reaches this today is `auto`; a debt somebody may decline
  // would be put to them in the middle of the GM's turn, which nothing on
  // either side ships.
  playPayouts(demo, adversaryId, targetId, demo.world.payoutsOn(targetId, 'attacked'));
  // "Attacks they make while spotlighted in this way deal half damage": the
  // price of a turn the Leader handed them. Halved before the defence step, so
  // the thresholds and the Armor Slots are read against what actually lands,
  // and spent on the way out - a Relentless second spotlight, paid for in the
  // ordinary way, swings at full strength.
  const answered = boostDamage(demo, adversaryId, targetId, rolled);
  // A blow that names its band is not halved either: half of Severe is not a
  // number the rules know, and "deal Severe damage" is what the feature said.
  const outcome = answered.severity === undefined ? halveIfRallied(demo, adversaryId, answered.outcome) : answered.outcome;

  // A miss is usually over at once — unless the target holds a card that
  // answers one, like Vanishing Dodge.
  if (!outcome.hit || outcome.damageRoll === undefined || character === undefined) {
    applyAttack(demo.state, outcome);
    demo.world.endsOnAttack(adversaryId);
    note(demo, `The ${def.name}'s ${def.attackName} misses ${character?.sheet.name ?? target.id}.`, 'combat');
    playAttackedOn(demo, targetId, adversaryId);
    offerMiss(demo, { attacker: adversaryId, defender: targetId, outcome, def, used: [] });
    return true;
  }
  offerOrLand(demo, {
    attacker: adversaryId,
    defender: targetId,
    outcome,
    def,
    used: [],
    ...(answered.severity === undefined ? {} : { severity: answered.severity }),
  });
  return true;
}

/** Half the damage of a swing the creature only got to make because an ally said so. */
function halveIfRallied(
  demo: DemoScene,
  adversaryId: string,
  outcome: ReturnType<typeof resolveAttack>,
): ReturnType<typeof resolveAttack> {
  const turn = demo.gmTurn;
  if (turn === null || !turn.halved.has(adversaryId) || outcome.damageRoll === undefined) return outcome;
  const total = Math.ceil(outcome.damageRoll.total / 2);
  note(demo, `${nameOf(demo, adversaryId)} strikes on somebody else's word, for half.`, 'combat');
  return { ...outcome, damageRoll: { ...outcome.damageRoll, total } };
}

/**
 * "Before rolling damage for the Construct's attack, mark a Stress to gain a
 * +10 bonus to the damage roll": what the room adds to a blow that has landed
 * and has not been counted yet.
 *
 * Raised as `rollingDamage` on the one swinging and as `allyRollingDamage` on
 * every other adversary still standing, because half of these are about
 * somebody else's hit - "when another adversary deals damage to a target within
 * Far range of the Turret" - and a Demon that cannot bear to be outdone must
 * not be outdone by itself. The one being hit is bound as the target for both,
 * so a feature's `withinRange` is read from the reactor to the defender, which
 * is the reach every one of them names.
 *
 * It lands after a Horde's swap and after doubling, both of which are on the
 * profile the dice were rolled from, and before the defence, so thresholds and
 * Armor Slots read what actually arrives. A rally's half comes after it rather
 * than before: "attacks they make while spotlighted in this way deal half
 * damage" is about the attack, and what the room adds to its damage roll is
 * part of that roll. Only the GM's own swing raises it:
 * a scripted `attack` inside a feature keeps its outcome inside the world, and
 * nothing there asks the room for a bonus yet.
 */
function boostDamage(
  demo: DemoScene,
  attackerId: string,
  targetId: string,
  outcome: ReturnType<typeof resolveAttack>,
): { outcome: ReturnType<typeof resolveAttack>; severity?: DamageSeverity } {
  if (!outcome.hit || outcome.damageRoll === undefined) return { outcome };
  const bound = { targets: [targetId], hit: [targetId] };
  const standing = demo.state
    .entitiesOf('adversary')
    .filter((e) => e.alive && e.id !== attackerId)
    .map((e) => e.id);
  let added = 0;
  let band: DamageSeverity | undefined;
  const answering: [string, 'rollingDamage' | 'allyRollingDamage'][] = [
    [attackerId, 'rollingDamage'],
    ...standing.map((id): [string, 'allyRollingDamage'] => [id, 'allyRollingDamage']),
  ];
  for (const [id, trigger] of answering) {
    for (const ability of demo.world.reactionsFor(id, trigger, bound)) {
      if (ability.effects.length === 0) continue;
      if (!affordableReaction(demo, id, ability)) continue;
      spendFeatureCost(demo, id, ability, 'reaction');
      const was = demo.scenario.actorId;
      demo.scenario.actorId = id;
      const runner = new ScriptRunner(demo.world, demo.rng, { targets: [targetId], hit: [targetId], rollAs: 'actor' });
      const result = runner.run(ability.effects);
      record(demo, result.journal);
      demo.scenario.actorId = was;
      for (const entry of result.journal) {
        if (entry.kind === 'damageBoosted') added += entry.by;
        if (entry.kind === 'severityForced') band = worse(band, entry.severity);
      }
      afterAdversaryScript(demo, result.journal);
    }
  }
  // A named band wins: a blow that is not being rolled for cannot be added to,
  // so whatever was put behind it goes quiet rather than being counted twice.
  if (band !== undefined) {
    note(demo, `The blow lands as ${band} damage.`, 'bad');
    return { outcome, severity: band };
  }
  if (added <= 0) return { outcome };
  note(demo, `The blow lands harder by ${added}.`, 'bad');
  return { outcome: { ...outcome, damageRoll: { ...outcome.damageRoll, total: outcome.damageRoll.total + added } } };
}

/**
 * Minion (X): "defeated when they take any damage. For every X damage a PC
 * deals, defeat an additional Minion within range the attack would succeed
 * against." The extras are the nearest of the same kind, which is how a table
 * plays it without arguing about which rat dies.
 */
function defeatMinions(demo: DemoScene, targetId: string, damage: number): void {
  const target = demo.state.entity(targetId);
  if (target === undefined) return;
  const per = adversaryTraits(statBlock(demo, targetId)).minion;
  if (per === undefined || damage <= 0) return;

  const fell = (entity: EntityState): void => {
    entity.hitPoints = { ...entity.hitPoints, marked: entity.hitPoints.max };
    entity.alive = false;
  };
  if (target.alive) {
    fell(target);
    note(demo, `The ${nameOf(demo, targetId)} goes down at a touch.`, 'combat');
  }
  const extras = Math.floor(damage / per);
  if (extras <= 0) return;
  const nearby = demo.state
    .entitiesOf('adversary')
    .filter((e) => e.alive && e.id !== targetId && e.definition === target.definition)
    .filter((e) => {
      const band = demo.world.bandTo(targetId, e.id);
      return band !== null && reaches(band, 'veryClose');
    })
    .slice(0, extras);
  for (const entity of nearby) fell(entity);
  if (nearby.length > 0) {
    note(demo, `The blow carries: ${nearby.length} more go down.`, 'combat');
  }
}

// ---------------------------------------------------------------------------
// The defender's choice
// ---------------------------------------------------------------------------

/**
 * The damage a hit is carrying right now — and whether armour has any answer
 * to it, which a passive on the block decides ("the Ogre's attacks deal direct
 * damage"). The defence is resolved a second time from this, so what the
 * profile said about the swing has to be said again here or it is lost.
 *
 * The damage roll is *not* made again — this carries the one the swing rolled.
 * A defender whose own passive reduces by dice does roll those twice on this
 * path, once for the number the swing reported and once for the hit that
 * lands; only the second is applied, and no shipped party member has one.
 */
function incomingOf(demo: DemoScene, attack: IncomingAttack): IncomingDamage {
  // A band named mid-swing, or one the block's own passive names for it.
  // Only whether it goes through armor: the dice a passive swapped in, and any
  // doubling, are already in the number the swing reported. This is the second
  // read of `direct` for one attack, and it happens after the swing resolved:
  // a passive gating `direct` on state its own hit changes would answer
  // differently here than it did there. No shipped block does, and the gate
  // belongs on the swing, not on the defence.
  const swing = demo.world.standardAttackOf(attack.def.id, { attacker: attack.attacker, target: attack.defender });
  const severity = attack.severity ?? swing.severity;
  return {
    amount: attack.outcome.damageRoll?.total ?? 0,
    types: attack.def.attackDamage.types ?? [],
    ...(swing.direct === undefined ? {} : { direct: swing.direct }),
    ...(severity === undefined ? {} : { severity }),
  };
}

/**
 * What a successful attack does beyond its damage: Momentum hands the GM a
 * Shadow, Terrifying costs every PC in Close range a Light and hands over a Shadow
 * as well.
 */
function landedFeatures(demo: DemoScene, attack: IncomingAttack, hitPointsMarked: number): void {
  const traits = adversaryTraits(attack.def);
  let bad = 0;
  if (traits.momentum) bad += 1;
  if (traits.terrifying) {
    bad += 1;
    const shaken: string[] = [];
    for (const entity of demo.state.entitiesOf('party')) {
      if (!entity.alive || entity.good === undefined) continue;
      const band = demo.world.bandTo(attack.attacker, entity.id);
      if (band === null || !reaches(band, 'close')) continue;
      if (entity.good.value <= 0) continue;
      entity.good = { max: entity.good.max, value: entity.good.value - 1 };
      shaken.push(nameOf(demo, entity.id));
    }
    if (shaken.length > 0) note(demo, `Terrifying: ${shaken.join(', ')} lose a Light.`, 'bad');
  }
  if (bad > 0) {
    const gained = gain(demo.state.bad, bad);
    demo.state.bad = gained.currency;
    if (gained.applied > 0) note(demo, `The GM gains ${gained.applied} Shadow.`, 'bad');
  }
  playAttackRiders(demo, attack.attacker, attack.defender, hitPointsMarked);
}

/**
 * What a stat block hangs on its own standard attack: "targets who mark HP
 * from the Zombie's attacks must also mark a Stress".
 *
 * `dealtHit` answers the swing landing, however the defender answered it;
 * `dealtDamage` only fires when a Hit Point was actually marked, which is the
 * difference between "on a successful attack" and "targets who mark HP". Both
 * run with the one it hit bound as the target and as the hit, so a rider can
 * be written either way. A stat block's rider runs on its own; a card's is
 * offered to the player, because "you can spend 2 Light to…" is theirs to
 * decide - and a free one that asks nothing simply happens.
 *
 * Nothing rides a blow that put its target down: pushing a body or taking a
 * Light off someone lying unconscious reads as noise in the log, and the rules
 * hang these on what the target does about the damage, which a fallen creature
 * no longer does.
 */
function playAttackRiders(
  demo: DemoScene,
  attackerId: string,
  defenderId: string,
  hitPointsMarked: number,
  /**
   * The roll the swing was made with, when somebody watched it land. "When you
   * critically succeed on a weapon attack" is a question about this, and a
   * card asking it reads nothing without it.
   */
  roll?: DualityRoll,
): void {
  // Nothing is put to somebody who is no longer there: the one swing a dead
  // character makes is Blaze of Glory's, and its critical would otherwise be
  // offered to them as something to answer.
  if (demo.state.entity(attackerId)?.alive !== true) return;
  if (demo.state.entity(defenderId)?.alive !== true) return;
  const triggers: NonNullable<AbilityDef['trigger']>[] = hitPointsMarked > 0 ? ['dealtHit', 'dealtDamage'] : ['dealtHit'];
  const counts = { hitPointsDealt: hitPointsMarked };
  // The summary a `rolled` gate reads, and the dice themselves for a card that
  // puts the same attack roll against somebody else.
  const said = roll === undefined ? {} : { roll: { total: roll.total, outcome: roll.outcome }, swing: roll };
  if (demo.state.entity(attackerId)?.faction === 'party') {
    offerReactions(demo, [offersFor(demo, attackerId, triggers, [defenderId], counts, said)]);
    return;
  }
  for (const trigger of triggers) {
    for (const ability of demo.world.reactionsFor(attackerId, trigger, { targets: [defenderId], hit: [defenderId], counts, ...said })) {
      if (ability.effects.length === 0) continue;
      runAdversaryScript(demo, attackerId, ability, [defenderId], [defenderId], { counts });
    }
  }
}

/**
 * "When you fail an attack, you can mark a Stress to deal weapon damage using
 * half your Proficiency."
 *
 * The other half of `playAttackRiders`, and it belongs here rather than after
 * the turn is spent: a miss hands the spotlight to the GM, and a question
 * raised on the far side of that is one the player answers on somebody else's
 * turn. Whoever was swung at is bound as the target, so a card that still
 * reaches them can.
 *
 * Only the party's side. Nothing in the SRD gives a stat block something to do
 * about its own miss, and a GM swing that misses already has `offerMiss` for
 * what the *defender* makes of it.
 */
function playMissRiders(demo: DemoScene, attackerId: string, defenderId: string, roll?: DualityRoll): void {
  if (demo.state.entity(attackerId)?.alive !== true) return;
  if (demo.state.entity(defenderId)?.alive !== true) return;
  if (demo.state.entity(attackerId)?.faction !== 'party') return;
  const said = roll === undefined ? {} : { roll: { total: roll.total, outcome: roll.outcome } };
  offerReactions(demo, [offersFor(demo, attackerId, ['dealtMiss'], [defenderId], {}, said)]);
}

/** Everything the defence rules need to know about whoever is taking the hit. */
function defenderFor(demo: DemoScene, id: string): Defender | null {
  const entity = demo.state.entity(id);
  if (entity === undefined) return null;
  // The same defender the automatic path builds, resistances included: a
  // player asked how they take a hit must not be offered worse numbers than
  // the ones the engine would have used for them.
  const against = demo.world.defenderOf(entity);
  return {
    thresholds: against.thresholds,
    ...(against.defenses === undefined ? {} : { defenses: against.defenses }),
    armorSlots: demo.world.armorFor(id),
    stress: entity.stress,
    ...(entity.good === undefined ? {} : { good: entity.good }),
    reactions: demo.world.reactionsOf(id),
  };
}

const costOf = (ability: AbilityDef): string =>
  [ability.cost.good === undefined ? '' : `${ability.cost.good} Light`, ability.cost.stress === undefined ? '' : `${ability.cost.stress} Stress`]
    .filter((part) => part !== '')
    .join(' and ');

const hitPointWord = (n: number): string => `${n} Hit Point${n === 1 ? '' : 's'}`;

/**
 * "The Knight turns aside 3 of it": the damage a passive took off before the
 * thresholds were read. Without this the number in the next line is a mystery
 * — a hit for 11 that marks nothing looks like a bug rather than plate armor.
 */
function noteReduction(demo: DemoScene, who: string, resolved: ResolvedDamage | undefined): void {
  if (resolved === undefined || resolved.reduced <= 0) return;
  note(demo, `${who} turns aside ${resolved.reduced} of it.`, 'combat');
}

/**
 * What the defender's side can do about this hit.
 *
 * The first is always "take it", so there is always an answer; the rest are
 * the Armor Slot, the reactions the defender can pay for, and the interrupts
 * an ally in range holds. Each says what it would cost and what it would
 * leave — a player should not have to do the arithmetic the engine just did.
 */
export function defenseChoices(demo: DemoScene, attack: IncomingAttack): DefenseChoice[] {
  const defender = defenderFor(demo, attack.defender);
  if (defender === null) return [];
  const damage = incomingOf(demo, attack);
  const bare: DefensePlan = { armorSlots: 0, reactions: [] };
  // Every plan is offered against this one. A defender whose own passive still
  // has dice to roll has no number until the hit lands, so the label drops it
  // rather than promising a nothing.
  const bareHp = previewPlan(damage, defender, bare);
  const straight = bareHp ?? 0;
  const choices: DefenseChoice[] = [
    { kind: 'plan', label: bareHp === null ? 'Take it' : `Take it — ${hitPointWord(bareHp)}`, plan: bare },
  ];

  const room = unmarked(defender.armorSlots) > 0;
  const withArmor = room ? previewPlan(damage, defender, { armorSlots: 1, reactions: [] }) : null;
  if (withArmor !== null && withArmor < straight) {
    choices.push({ kind: 'plan', label: `Mark an Armor Slot — ${hitPointWord(withArmor)}`, plan: { armorSlots: 1, reactions: [] } });
  }

  const own = demo.world
    .reactionsFor(attack.defender, 'incomingDamage')
    .filter((a) => a.reaction !== undefined && !attack.used.includes(a.id) && canPlay(demo, attack.defender, defender, a));
  for (const ability of own) {
    if (ability.reaction?.kind === 'redirect') continue; // an ally's card, offered below
    for (const slots of room ? [0, 1] : [0]) {
      const plan: DefensePlan = { armorSlots: slots, reactions: [ability] };
      const after = previewPlan(damage, defender, plan);
      // A plan that changes nothing is not a choice; one whose dice are not
      // yet rolled (a Rune Ward) has no number to show and is always offered.
      if (after !== null && after >= (slots === 1 ? (withArmor ?? straight) : straight)) continue;
      const armorPart = slots === 1 ? 'Armor Slot and ' : '';
      const cost = costOf(ability);
      const result = after === null ? '' : ` — ${hitPointWord(after)}`;
      choices.push({ kind: 'plan', label: `${armorPart}${ability.name}${cost === '' ? '' : ` (${cost})`}${result}`, plan });
    }
  }

  // And what the defender's own cards say in their own words. A script is not
  // a plan: nothing can be previewed and nothing can be composed with an Armor
  // Slot in advance, so it is offered on its own and the blow comes back round
  // once it has been played.
  for (const ability of demo.world.reactionsFor(attack.defender, 'incomingDamage', {
    targets: [attack.attacker],
    hit: [attack.attacker],
  })) {
    if (ability.reaction !== undefined || ability.effects.length === 0) continue;
    if (attack.used.includes(ability.id) || !canPlay(demo, attack.defender, defender, ability)) continue;
    const cost = costOf(ability);
    choices.push({
      kind: 'script',
      label: `${ability.name}${cost === '' ? '' : ` (${cost})`}`,
      by: attack.defender,
      ability,
    });
  }

  // What the rest of the party can do about it.
  for (const entity of demo.state.entitiesOf('party')) {
    if (!entity.alive || entity.id === attack.defender) continue;
    const helper = defenderFor(demo, entity.id);
    if (helper === null) continue;
    const name = nameOf(demo, entity.id);
    for (const ability of demo.world.reactionsFor(entity.id, 'incomingDamage')) {
      if (ability.reaction?.kind !== 'redirect' || attack.used.includes(ability.id) || !canPlay(demo, entity.id, helper, ability)) continue;
      const band = demo.world.bandTo(entity.id, attack.defender);
      if (band === null || !reaches(band, ability.target.range)) continue;
      choices.push({ kind: 'redirect', label: `${name}: ${ability.name} (${costOf(ability)})`, by: entity.id, ability });
    }
    for (const ability of demo.world.reactionsFor(entity.id, 'attackHit')) {
      if (ability.reaction?.kind !== 'reroll' || attack.used.includes(ability.id) || !canPlay(demo, entity.id, helper, ability)) continue;
      const band = demo.world.bandTo(entity.id, attack.attacker);
      if (band === null || !reaches(band, ability.target.range)) continue;
      const what = ability.reaction.what;
      const cost = costOf(ability);
      if (what !== 'damage') {
        choices.push({ kind: 'reroll', label: `${name}: ${ability.name} — reroll the attack (${cost})`, by: entity.id, ability, what: 'attack' });
      }
      if (what !== 'attack') {
        choices.push({ kind: 'reroll', label: `${name}: ${ability.name} — reroll the damage (${cost})`, by: entity.id, ability, what: 'damage' });
      }
    }
  }
  return choices;
}

/**
 * A blow that went wide, and someone who can do something about it.
 *
 * "When an attack made against you fails, you can spend a Light to …" — the
 * card's own effects are the answer, so any card written that way is offered
 * here without the engine knowing what it does.
 */
function offerMiss(demo: DemoScene, attack: IncomingAttack): void {
  if (!demo.askDefender) return;
  const holder = defenderFor(demo, attack.defender);
  if (holder === null) return;
  const cards = demo.world
    // The one who swung is bound as the target: a card that hits back names
    // them, and one that asks how close they are reads the same binding.
    .reactionsFor(attack.defender, 'attackMissed', { targets: [attack.attacker], hit: [attack.attacker] })
    .filter((ability) => ability.effects.length > 0 && canPlay(demo, attack.defender, holder, ability));
  if (cards.length === 0) return;
  const choices: DefenseChoice[] = [
    { kind: 'none', label: 'Let it go wide' },
    ...cards.map((ability) => ({
      kind: 'react' as const,
      label: `${ability.name}${costOf(ability) === '' ? '' : ` (${costOf(ability)})`}`,
      by: attack.defender,
      ability,
    })),
  ];
  demo.pending = {
    kind: 'defense',
    attack,
    choices,
    prompt: {
      kind: 'choice',
      title: `${attack.def.attackName} goes wide`,
      body: `${nameOf(demo, attack.defender)} can answer it.`,
      options: choices.map((choice, index) => ({ index, label: choice.label })),
    },
  };
}

/** Ask, if there is anything to ask; otherwise take the hit the engine's way. */
function offerOrLand(demo: DemoScene, attack: IncomingAttack): void {
  if (demo.askDefender) {
    const choices = defenseChoices(demo, attack);
    if (choices.length > 1) {
      const damage = incomingOf(demo, attack);
      demo.pending = {
        kind: 'defense',
        attack,
        choices,
        prompt: {
          kind: 'choice',
          title: `${attack.def.attackName} on ${nameOf(demo, attack.defender)}`,
          body: `${damage.severity ?? damage.amount} ${(damage.types ?? []).join(' and ') || 'physical'} damage${damage.direct === true ? ', direct' : ''}. How does it land?`,
          options: choices.map((choice, index) => ({ index, label: choice.label })),
        },
      };
      return;
    }
  }
  landAttack(demo, attack, null);
}

/**
 * The blow, with what the defender's own card said about it.
 *
 * Softening comes off the total the swing rolled, so everything downstream -
 * thresholds, Armor Slots, the reduction a passive rolls - reads the number
 * that actually arrived. Avoiding is not a miss and not a nothing: the attack
 * roll succeeded and then found nobody, so the swing is spent and the riders
 * that answer a landed blow never run.
 *
 * Either way the blow is put to the defender again, because a card and an
 * Armor Slot are both answers and the SRD lets somebody give both.
 */
function answeredWith(demo: DemoScene, attack: IncomingAttack, journal: readonly JournalEntry[]): void {
  let softened = 0;
  let avoided = false;
  let stepped = 0;
  let raised = 0;
  for (const entry of journal) {
    if (entry.kind === 'blowSoftened') softened += entry.by;
    if (entry.kind === 'blowAvoided') avoided = true;
    if (entry.kind === 'severityStepped') stepped += entry.steps;
    if (entry.kind === 'evasionRaised') raised += entry.by;
  }
  const who = nameOf(demo, attack.defender);

  // "A bonus to your Evasion equal to the result against the attack": the d20
  // is measured again against a Difficulty that just went up. A natural 20 is
  // past arguing with, and a bonus that was not enough changes nothing.
  const gm = attack.outcome.gmRoll;
  if (raised > 0 && gm !== undefined) {
    note(demo, `${who} sees it coming: ${raised} more to beat.`, 'good');
    if (!gm.critical && gm.total < gm.difficulty + raised) {
      demo.world.endsOnAttack(attack.attacker);
      note(demo, `The ${attack.def.name}'s ${attack.def.attackName} misses ${who}.`, 'combat');
      playAttackedOn(demo, attack.defender, attack.attacker);
      settleFight(demo);
      return;
    }
  }
  if (avoided) {
    demo.world.endsOnAttack(attack.attacker);
    note(demo, `The ${attack.def.name}'s ${attack.def.attackName} finds nothing where ${who} was.`, 'combat');
    playAttackedOn(demo, attack.defender, attack.attacker);
    settleFight(demo);
    return;
  }
  const roll = attack.outcome.damageRoll;
  const softer =
    softened <= 0 || roll === undefined
      ? attack
      : { ...attack, outcome: { ...attack.outcome, damageRoll: { ...roll, total: Math.max(0, roll.total - softened) } } };
  if (softened > 0) note(demo, `${who} turns aside ${softened} of it.`, 'good');
  offerOrLand(demo, stepped <= 0 ? softer : { ...softer, stepped: (softer.stepped ?? 0) + stepped });
}

/**
 * Take the hit: with the plan the defender chose, or — when `plan` is null —
 * with the one the engine decides, which is what happens when nobody is being
 * asked.
 */
function landAttack(demo: DemoScene, attack: IncomingAttack, plan: DefensePlan | null): void {
  const target = demo.state.entity(attack.defender);
  const defender = defenderFor(demo, attack.defender);
  if (target === undefined || defender === null) return;
  const who = nameOf(demo, attack.defender);
  const damage = incomingOf(demo, attack);

  const defense =
    plan === null
      ? demo.world.defend(attack.defender, damage, demo.rng)
      : resolveDefensePlan(demo.rng, damage, defender, plan);
  if (plan !== null) {
    // `world.defend` pays for what it decided; a chosen plan is paid here.
    if (defense.goodSpent > 0) demo.world.spendGood(attack.defender, defense.goodSpent);
    if (defense.stressMarked > 0) demo.world.markStress(attack.defender, defense.stressMarked);
  }
  for (const used of defense.reactions) {
    const cost = costOf(used.ability);
    note(demo, `${who}: ${used.ability.name}${used.rolled === undefined ? '' : ` (${used.rolled})`}${cost === '' ? '' : `, ${cost}`}.`, 'good');
  }

  // "When the target marks an Armor Slot, they reduce the severity of the
  // attack by an additional threshold": read here rather than in the defence,
  // because only the blow that has been answered knows whether a slot was
  // marked for it. Whichever way the defence was decided - the plan a player
  // chose, or the one the engine took on their behalf - it comes through here.
  const aid = demo.world.armorAid(attack.defender);
  const aided =
    aid.steps <= 0 || defense.resolved.armorSlotsSpent <= 0 || defense.resolved.hpMarked <= 0
      ? defense.resolved
      : (() => {
          const band = reduceSeverity(defense.resolved.finalSeverity, aid.steps);
          note(demo, `The aura around ${who} takes it down to ${band === 'none' ? 'nothing' : band}.`, 'good');
          return { ...defense.resolved, finalSeverity: band, hpMarked: hpForSeverity(band) };
        })();
  // "If this spell causes a creature who would be damaged to instead mark no
  // Hit Points, the effect ends." The blow it saved them from is the one that
  // spends it; a blow it merely softened is not.
  if (aid.endsWhenItSaves.length > 0 && defense.resolved.hpMarked > 0 && aided.hpMarked === 0) {
    for (const name of aid.endsWhenItSaves) demo.world.clearCondition(attack.defender, name);
    note(demo, `The aura around ${who} goes out.`, 'good');
  }

  // A card that steps the band does it after the armor, because what it is
  // paying for is the step the armor did not make.
  const resolved =
    attack.stepped === undefined || attack.stepped <= 0
      ? aided
      : (() => {
          const band = reduceSeverity(aided.finalSeverity, attack.stepped);
          note(demo, `${who} rides it down to ${band === 'none' ? 'nothing' : band}.`, 'good');
          return { ...aided, finalSeverity: band, hpMarked: hpForSeverity(band) };
        })();
  const final: AttackOutcome = {
    ...attack.outcome,
    targetId: attack.defender,
    damage: resolved,
    hitPointsMarked: resolved.hpMarked,
  };
  applyAttack(demo.state, final);
  demo.world.endsOnAttack(attack.attacker);
  // This path builds its own outcome rather than going through `world.attack`,
  // so the blow is noted by hand - without it a card the defender holds for
  // exactly this moment would never hear about it.
  demo.world.noteDamage(attack.defender, {
    attacker: attack.attacker,
    hitPoints: final.hitPointsMarked,
    damage: damage.amount,
    types: damage.types,
    severe: isSevere(resolved.finalSeverity),
  });
  landedFeatures(demo, attack, final.hitPointsMarked);
  playAttackedOn(demo, attack.defender, attack.attacker);
  const ended = [...demo.world.endsOnHit(attack.defender), ...(final.hitPointsMarked > 0 ? demo.world.endsOnDamage(attack.defender) : [])];
  for (const condition of ended) note(demo, `${who} is no longer ${condition}.`, 'system');
  noteReduction(demo, who, resolved);
  note(
    demo,
    final.hitPointsMarked === 0
      ? `The ${attack.def.name}'s ${attack.def.attackName} hits ${who}, and is turned aside.`
      : `The ${attack.def.name}'s ${attack.def.attackName} ${final.critical ? 'tears into' : 'hits'} ${who}: ${hitPointWord(final.hitPointsMarked)}.`,
    'combat',
  );
  settleFight(demo);
}

/**
 * Do what the defender's side chose. A plan ends the hit; an interrupt changes
 * it and asks again, because standing in the way is a new defender's decision
 * and a reroll is a new hit.
 */
export function applyDefenseChoice(demo: DemoScene, attack: IncomingAttack, choice: DefenseChoice): void {
  if (choice.kind === 'none') return;
  if (choice.kind === 'plan') {
    landAttack(demo, attack, choice.plan);
    return;
  }
  if (choice.kind === 'script') {
    if (!payFor(demo, choice.by, choice.ability)) return landAttack(demo, attack, null);
    const damage = incomingOf(demo, attack);
    const was = demo.scenario.actorId;
    demo.scenario.actorId = choice.by;
    const runner = new ScriptRunner(demo.world, demo.rng, {
      targets: [attack.attacker],
      hit: [attack.attacker],
      rollAs: 'actor',
      lastDamage: { total: damage.amount, types: damage.types ?? [] },
    });
    const result = runner.run(choice.ability.effects);
    record(demo, result.journal);
    const carried = { ...attack, used: [...attack.used, choice.ability.id] };
    if (result.status === 'waiting') {
      // The card stopped to ask something of its own - how many thorns to
      // spend - and the blow waits with it, the way the party's own swing
      // waits on a card that answers it.
      demo.pending = {
        kind: 'script',
        runner,
        prompt: result.prompt,
        interactable: null,
        recorded: result.journal.length,
        dialogue: null,
        onDone: (done) => {
          demo.scenario.actorId = was;
          answeredWith(demo, carried, done.entries);
          // The question this card asked was the last thing the fight was
          // waiting on, and nothing above resumes the GM's turn for it.
          if (demo.pending === null && demo.gmTurn !== null) runGmTurn(demo);
        },
      };
      return;
    }
    demo.scenario.actorId = was;
    answeredWith(demo, carried, result.journal);
    return;
  }
  if (choice.kind === 'react') {
    if (!payFor(demo, choice.by, choice.ability)) return;
    const was = demo.scenario.actorId;
    demo.scenario.actorId = choice.by;
    const runner = new ScriptRunner(demo.world, demo.rng, { targets: [attack.attacker], rollAs: 'actor' });
    const result = runner.run(choice.ability.effects);
    record(demo, result.journal);
    if (result.status === 'waiting') {
      // A card that stops to ask something keeps the floor; the GM's turn
      // resumes when the script is done, as it does for any other card.
      demo.pending = {
        kind: 'script',
        runner,
        prompt: result.prompt,
        interactable: null,
        recorded: result.journal.length,
        dialogue: null,
        onDone: () => {
          demo.scenario.actorId = was;
          runGmTurn(demo);
        },
      };
      return;
    }
    demo.scenario.actorId = was;
    return;
  }
  const helper = nameOf(demo, choice.by);
  if (choice.kind === 'redirect') {
    if (!payFor(demo, choice.by, choice.ability)) return landAttack(demo, attack, null);
    note(demo, `${helper} steps in front of ${nameOf(demo, attack.defender)}: ${choice.ability.name}.`, 'good');
    offerOrLand(demo, { ...attack, defender: choice.by, used: [...attack.used, choice.ability.id] });
    return;
  }

  if (!payFor(demo, choice.by, choice.ability)) return landAttack(demo, attack, null);
  const adversary = demo.state.entity(attack.attacker);
  const target = demo.state.entity(attack.defender);
  if (adversary === undefined || target === undefined) return landAttack(demo, attack, null);
  const used = [...attack.used, choice.ability.id];

  if (choice.what === 'damage') {
    // The same swing, a new damage roll: the attack still landed.
    const rolled = rollDamage(demo.rng, attack.def.attackDamage, {});
    note(demo, `${helper}: ${choice.ability.name}. The blow rolls again — ${rolled.total}.`, 'good');
    offerOrLand(demo, { ...attack, outcome: { ...attack.outcome, damageRoll: rolled }, used });
    return;
  }

  const again = resolveAttack(demo.rng, {
    grid: demo.grid,
    attacker: adversary,
    target,
    profile: {
      kind: 'adversary',
      name: attack.def.attackName,
      modifier: attack.def.attackModifier,
      range: attack.def.attackRange,
      damage: attack.def.attackDamage,
    },
    defender: demo.world.defenderOf(target),
    options: { bandTiles: DEMO_BAND_TILES, armorSlotsMarked: 0 },
  });
  note(demo, `${helper}: ${choice.ability.name}. The ${attack.def.name} swings again.`, 'good');
  if (again.refused !== null || !again.hit || again.damageRoll === undefined) {
    applyAttack(demo.state, again);
    demo.world.endsOnAttack(attack.attacker);
    note(demo, `The ${attack.def.name}'s ${attack.def.attackName} misses ${nameOf(demo, attack.defender)}.`, 'combat');
    settleFight(demo);
    return;
  }
  offerOrLand(demo, { ...attack, outcome: again, used });
}

/** Pay a reaction's cost. Returns false when it turned out they could not. */
function payFor(demo: DemoScene, id: string, ability: AbilityDef): boolean {
  const entity = demo.state.entity(id);
  if (entity === undefined) return false;
  const good = ability.cost.good ?? 0;
  const stress = ability.cost.stress ?? 0;
  if (good > 0 && !demo.world.spendGood(id, good)) return false;
  if (stress > 0) demo.world.markStress(id, stress);
  // "Once per rest" is part of the price. Every path that plays a card of the
  // party's - a reaction they were offered, a defence they chose, a card in
  // place of a death move - pays here, so this is the one place that has to
  // count it. An action card is counted by `useAbility` instead, which knows
  // it can also be put back down again.
  spendUse(demo, id, ability);
  return true;
}

/** Take one use off a limited card, wherever it was played from. */
function spendUse(demo: DemoScene, id: string, ability: AbilityDef): void {
  if (ability.uses === undefined) return;
  const key = useKey(id, ability.id);
  demo.scenario.abilityUses.set(key, (demo.scenario.abilityUses.get(key) ?? 0) + 1);
}

/**
 * Whether a character can play this card in answer to something right now.
 *
 * What it costs and what is left of it. `canPayFor` reads the pools alone -
 * it is the engine's, and the engine has no idea how many times a card has
 * been played this rest - so every offer on this side asks both questions
 * together or a "once per rest" card is offered on every blow.
 */
function canPlay(
  demo: DemoScene,
  id: string,
  defender: Pick<Defender, 'good' | 'stress'>,
  ability: AbilityDef,
): boolean {
  return canPayFor(defender, ability) && featureUsesLeft(demo, id, ability) > 0;
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
  // Nor is anything used on the way into an ambush.
  if (demo.pending !== null || demo.ambush !== null) return { status: 'busy', lines: [] };

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
      kind: 'script',
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

  // A hit waiting on the defender. Stepping back from the question is taking
  // it as it comes — the first choice is always "take it".
  if (waiting.kind === 'defense') {
    const index = response.kind === 'choose' ? response.index : 0;
    const choice = waiting.choices[index] ?? waiting.choices[0];
    const before = demo.log.length;
    demo.pending = null;
    if (choice !== undefined) applyDefenseChoice(demo, waiting.attack, choice);
    // An interrupt may have opened another question; otherwise the GM's turn
    // picks up where it stopped.
    if (demo.pending === null) runGmTurn(demo);
    return settle(demo, demo.log.slice(before));
  }

  // A card of the party's, offered because something already happened. The
  // first option is always letting it pass, and stepping back from the
  // question is choosing it.
  if (waiting.kind === 'reaction') {
    const index = response.kind === 'choose' ? response.index : 0;
    const chosen = index > 0 ? waiting.offers[index - 1] : undefined;
    const before = demo.log.length;
    demo.pending = null;
    // What the card journals is read back by a script waiting on this answer,
    // which is how "reroll their dice" reaches the roll it is about.
    if (chosen === undefined) afterReaction(demo, waiting.queued, waiting.landing, waiting.resuming);
    else playReaction(demo, chosen, waiting.queued, true, waiting.landing, waiting.resuming?.said, waiting.resuming);
    return settle(demo, demo.log.slice(before));
  }

  // A character who marked their last Hit Point. Stepping back from the
  // question is the first move on the list, which is Avoid Death.
  if (waiting.kind === 'death') {
    const index = response.kind === 'choose' ? response.index : 0;
    const card = waiting.offers[index - waiting.moves.length];
    const before = demo.log.length;
    demo.pending = null;
    if (card === undefined) applyDeathMove(demo, waiting.who, waiting.moves[index] ?? waiting.moves[0]!);
    else playDeathCard(demo, waiting.who, card);
    // Somebody else may have gone down to the same blow.
    playDeathMoves(demo);
    if (demo.pending === null) runGmTurn(demo);
    return settle(demo, demo.log.slice(before));
  }

  // A conversation on top of the script takes the answer first.
  if (waiting.dialogue !== null) return answerDialogue(demo, waiting, waiting.dialogue, response);

  const result = waiting.runner.resume(response);
  // Only the part that has not been shown yet.
  const lines = record(demo, result.journal.slice(waiting.recorded));
  if (result.status === 'waiting') {
    const held: PendingScript = { ...waiting, prompt: result.prompt, recorded: result.journal.length };
    // The dice are read and nothing has come of them: the one prompt the room
    // answers rather than the player, so it is not put on screen as a question.
    if (result.prompt.kind === 'rolled') {
      demo.pending = null;
      const asked = offerOnRoll(demo, held, result.prompt.roll, result.prompt.tags, result.prompt.trait);
      return { status: asked.status, lines: [...lines, ...asked.lines] };
    }
    demo.pending = held;
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
  const waiting = scriptPending(demo);
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
  const waiting = scriptPending(demo);
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

/** Somebody on the board swung at somebody else on it, for a token that lunges. */
export function swungAt(demo: DemoScene, attacker: string, target: string): void {
  const from = demo.state.entity(attacker);
  const at = demo.state.entity(target)?.tile ?? NO_TILE;
  if (from === undefined || from.tile === NO_TILE || at === NO_TILE) return;
  demo.motions.push({ id: attacker, lunge: { at } });
}

/** A blow landed on somebody on the board, for a token that flinches. */
export function struck(demo: DemoScene, id: string): void {
  const entity = demo.state.entity(id);
  if (entity === undefined || entity.tile === NO_TILE) return;
  demo.motions.push({ id, struck: true });
}

/** Float a number over somebody who is on the board. Nobody there, nothing floats. */
export function float(demo: DemoScene, id: string, text: string, tone: LogTone): void {
  const entity = demo.state.entity(id);
  if (entity === undefined || entity.tile === NO_TILE) return;
  demo.floaters.push({ id, text, tone });
}

/**
 * The number a journal entry puts over a head, if it puts one.
 *
 * The rule is: what changed a pool, or put a condition on someone, floats;
 * what happened to the room, the story or the party as a whole stays in the
 * log. A miss floats too, since the swing was watched.
 */
function floatEntry(demo: DemoScene, entry: JournalEntry): void {
  switch (entry.kind) {
    case 'attack':
      swungAt(demo, entry.attacker, entry.target);
      if (entry.hit) {
        float(demo, entry.target, `-${entry.hitPointsMarked} HP`, 'combat');
        struck(demo, entry.target);
      } else float(demo, entry.target, 'miss', 'system');
      return;
    case 'damage':
      if (entry.targets === undefined) return;
      // One target reads as the slots it lost; several as the one total that
      // landed on each, since each marked its own.
      for (const id of entry.targets) {
        float(demo, id, entry.targets.length === 1 ? `-${entry.marked} HP` : `${entry.amount} damage`, 'combat');
        struck(demo, id);
      }
      return;
    case 'heal':
      // A shared healing is one total handed round a Hit Point at a time, and
      // the journal has only the total; "+6" over each of five heads would be
      // a lie, so it stays in the log.
      if (entry.spread === true) return;
      for (const id of entry.ids ?? []) float(demo, id, `+${entry.amount}`, 'good');
      return;
    case 'stress':
      if (entry.cleared > 0) float(demo, entry.id, `-${entry.cleared} Stress`, 'good');
      else float(demo, entry.id, `+${entry.marked} Stress`, 'bad');
      return;
    case 'armor':
      float(demo, entry.id, `+${entry.cleared} Armor`, 'good');
      return;
    case 'condition':
      if (entry.applied) float(demo, entry.id, demo.world.conditionName(entry.condition), 'combat');
      return;
    case 'good':
      if (entry.id !== undefined) float(demo, entry.id, `+${entry.gained} Light`, 'good');
      return;
    default:
      return;
  }
}

/** Put one line in the log, and return it. */
export function note(demo: DemoScene, text: string, tone: LogTone): LogLine[] {
  // Every line goes through here or through `record`, and both want their
  // names findable, so the marking happens on the way in rather than at each
  // of the several dozen call sites that write a sentence.
  const line = withMentions(demo, { text, tone });
  demo.log.push(line);
  return [line];
}

/**
 * Turn what a script did into what the player reads.
 *
 * Only the entries with something to say become lines; a flag being set is real
 * but not news.
 */
/** How long two dice take to tumble and settle, unless a view says otherwise. */
export const DICE_MILLIS = 900;

let rollCount = 0;

/**
 * Queue a Duality roll for whoever is drawing dice.
 *
 * There are exactly two places a party member's Duality roll reaches the game:
 * a journal entry, for everything a script rolls — a card's attack, a check, a
 * reaction roll — and `attackWithSelected`, which is the one swing that never
 * goes through the runner. Anything else that shows dice would show them
 * twice.
 */
function showRoll(demo: DemoScene, who: string, what: string, roll: DualityRoll): void {
  demo.rolls.push({ id: ++rollCount, who, what, roll });
}

/** The faces a journal entry rolled, if a party member rolled them. */
function rolledIn(entry: JournalEntry): { roll: DualityRoll; who: string; what: string } | null {
  if (entry.kind === 'check') return { roll: entry.roll, who: '', what: 'the check' };
  if (entry.kind === 'attack' && entry.roll !== undefined) {
    return { roll: entry.roll, who: entry.attacker, what: entry.weapon };
  }
  if (entry.kind === 'reaction' && entry.roll !== undefined) {
    return { roll: entry.roll, who: entry.id, what: 'the reaction' };
  }
  return null;
}

export function record(demo: DemoScene, journal: readonly JournalEntry[]): LogLine[] {
  const lines: LogLine[] = [];
  const names = new Map(demo.project.items.map((item) => [item.id, item.name]));
  const quests = new Map(demo.project.quests.map((quest) => [quest.id, quest]));
  const who = (id: string): string => nameOf(demo, id);
  for (const entry of journal) {
    // Travel is remembered rather than taken: the rest of this script belongs to
    // the room it was asked in. `settleTravel` spends it once nothing waits.
    if (entry.kind === 'goto') demo.destination = entry.scene;
    const rolled = rolledIn(entry);
    if (rolled !== null) {
      // A check is rolled by whoever the script is acting as; an attack and a
      // reaction roll each name their own roller.
      const roller = rolled.who === '' ? demo.scenario.actorId : rolled.who;
      showRoll(demo, roller === null ? '' : who(roller), rolled.what, rolled.roll);
    }
    const line = describeEntry(entry, names, quests, who, (c) => demo.world.conditionName(c));
    if (line !== null) lines.push(withMentions(demo, line));
    floatEntry(demo, entry);
    if (entry.kind === 'moved' && entry.walked !== true) demo.motions.push({ id: entry.id, thrown: true });
    else if (entry.kind === 'moved' && entry.route !== undefined) demo.motions.push({ id: entry.id, route: entry.route });
  }
  demo.log.push(...lines);
  // A condition a script put on or took off someone may move a pool's maximum.
  syncPools(demo);
  // Clocks move on what the *party* does: "it ticks down when a PC makes an
  // attack roll". A stat block's own roll is the GM's move, and a countdown
  // fired by a countdown must not advance the one that fired it, so the cues
  // are raised after the whole journal is in, never during it.
  for (const { roller, roll } of rollsFrom(demo, journal)) playPartyRolled(demo, roller, roll);
  for (const cue of cuesFrom(demo, journal)) tickCountdowns(demo, cue);
  return lines;
}

/**
 * What a script did that a countdown might be waiting for: a party member's
 * action roll, and any Hit Points anyone marked.
 *
 * A check is rolled by whoever the script is acting as, so it counts as the
 * party's only when the party is acting; an attack names its own roller. Hit
 * Points are nobody's side - "when they mark HP, tick down this countdown by
 * the number of HP marked" is written about the countdown's owner, and the
 * board only hands the cue to the countdown whose owner marked them.
 */
function cuesFrom(demo: DemoScene, journal: readonly JournalEntry[]): CountdownCue[] {
  const isParty = (id: string | null): boolean =>
    id !== null && demo.state.entity(id)?.faction === 'party';
  const cues: CountdownCue[] = [];
  for (const entry of journal) {
    if (entry.kind === 'check' && isParty(demo.scenario.actorId)) {
      cues.push({ kind: 'actionRoll', attack: false, outcome: entry.roll.outcome });
    }
    if (entry.kind === 'attack') {
      if (entry.roll !== undefined && isParty(entry.attacker)) {
        cues.push({ kind: 'actionRoll', attack: true, outcome: entry.roll.outcome });
      }
      if (entry.hitPointsMarked > 0) {
        cues.push({ kind: 'hpMarked', id: entry.target, marked: entry.hitPointsMarked });
      }
    }
  }
  return cues;
}

/**
 * The creatures a line names, so a UI can point at them.
 *
 * Read off the board rather than threaded through every sentence: a line is
 * written by a dozen different branches, and every one of them already calls
 * the same `nameOf`. Matching afterwards means a new sentence gets this for
 * nothing.
 *
 * Longest name first, so "Acid Burrower" is not found as "Acid" when something
 * on the map is called that; and a name is only a mention where it stands as a
 * whole word.
 */
function withMentions(demo: DemoScene, line: LogLine): LogLine {
  const found: { id: string; name: string }[] = [];
  const everybody = [...demo.state.entitiesOf('party'), ...demo.state.entitiesOf('adversary')];
  const named = everybody
    .map((e) => ({ id: e.id, name: nameOf(demo, e.id) }))
    .sort((a, b) => b.name.length - a.name.length);
  let left = line.text;
  for (const one of named) {
    if (one.name === '' || found.some((f) => f.id === one.id)) continue;
    const at = left.indexOf(one.name);
    if (at === -1) continue;
    const before = at === 0 ? ' ' : left[at - 1]!;
    const after = left[at + one.name.length] ?? ' ';
    if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue;
    found.push(one);
    // Blank it out so a shorter name inside it is not found again.
    left = `${left.slice(0, at)}${' '.repeat(one.name.length)}${left.slice(at + one.name.length)}`;
  }
  return found.length === 0 ? line : { ...line, mentions: found };
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
    if (drop.quantity <= 1) return name;
    // "2 Healing draught" reads as a typo. An item name is written singular,
    // so more than one of it takes an s - unless it already ends in one, or is
    // a word that is its own plural, which is what gold and coin and armor all
    // are and why the exceptions are worth listing rather than guessing.
    const uncountable = /^(gold|silver|ammunition|armor|armour)$/i.test(name);
    const plural = uncountable || /s$/i.test(name) ? name : `${name}s`;
    return `${drop.quantity} ${plural}`;
  });
  if (parts.length <= 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
}

function describeEntry(
  entry: JournalEntry,
  names: ReadonlyMap<string, string>,
  quests: ReadonlyMap<string, QuestDef>,
  who: (id: string) => string,
  /** What a condition is called, rather than the id it is keyed by. */
  called: (condition: string) => string,
): LogLine | null {
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  switch (entry.kind) {
    case 'attack':
      return entry.hit
        ? {
            // "3 turned aside" is the target's own armor, and without it a hit
            // for 11 that marks nothing reads as a bug.
            text: `${who(entry.attacker)} ${entry.critical ? 'lands a critical with' : 'hits with'} the ${entry.weapon}${entry.joined === undefined ? '' : `, ${entry.joined.length + 1} of them at once`}: ${plural(entry.hitPointsMarked, 'Hit Point')} on ${who(entry.target)}${entry.reduced === undefined ? '' : `, ${entry.reduced} turned aside`}.`,
            tone: 'combat',
          }
        : { text: `${who(entry.attacker)} swings the ${entry.weapon} at ${who(entry.target)} and misses.`, tone: 'combat' };
    case 'stress':
      if (entry.cleared > 0) return { text: `${who(entry.id)} clears ${plural(entry.cleared, 'Stress')}.`, tone: 'good' };
      return {
        text: `${who(entry.id)} marks ${plural(entry.marked, 'Stress')}${entry.hitPoints > 0 ? ' and, with no slot left, a Hit Point' : ''}.`,
        tone: 'bad',
      };
    case 'armor':
      return { text: `${who(entry.id)} clears ${plural(entry.cleared, 'Armor Slot')}.`, tone: 'good' };
    case 'condition': {
      // The condition's name, not the id it is keyed by: "Kara is Holding the
      // Line" rather than "Kara is holding-the-line".
      const name = called(entry.condition);
      return entry.applied
        ? { text: `${who(entry.id)} is ${name}.`, tone: 'combat' }
        : { text: `${who(entry.id)} is no longer ${name}.`, tone: 'system' };
    }
    case 'moved':
      return entry.walked === true
        ? { text: `${who(entry.id)} crosses the ground.`, tone: 'combat' }
        : { text: `${who(entry.id)} is thrown back.`, tone: 'combat' };
    case 'marked':
      return { text: `${who(entry.id)} marks the ground where they stand.`, tone: 'good' };
    case 'rollRaised':
      return { text: `Another ${entry.by} goes behind the roll.`, tone: 'good' };
    case 'countdown':
      return { text: `${entry.name} begins: ${entry.value}.`, tone: 'bad' };
    case 'replaced': {
      const first = entry.ids[0];
      if (first === undefined) return null;
      return {
        text: `${entry.was} is gone: ${entry.ids.length === 1 ? who(first) : `${entry.ids.length} ${who(first)}s`} in their place.`,
        tone: 'bad',
      };
    }
    case 'spotlighted': {
      const called = entry.ids.map(who).join(', ');
      return {
        text: `${called} ${entry.ids.length === 1 ? 'is' : 'are'} called into the fight${entry.halfDamage ? ', striking for half' : ''}.`,
        tone: 'bad',
      };
    }
    case 'summoned': {
      const first = entry.ids[0];
      if (first === undefined) return null;
      const name = who(first);
      return {
        text: `${entry.ids.length} ${name}${entry.ids.length === 1 ? '' : 's'} arrive${entry.ids.length === 1 ? 's' : ''}.`,
        tone: 'bad',
      };
    }
    case 'reaction':
      return {
        text: `${who(entry.id)} reacts: ${entry.total} against ${entry.difficulty} — ${entry.success ? 'holds' : 'fails'}.`,
        tone: entry.success ? 'system' : 'success',
      };
    case 'refused':
      return { text: `That cannot happen: ${entry.reason}.`, tone: 'system' };
    case 'defended': {
      const cost = [entry.goodSpent > 0 ? `${entry.goodSpent} Light` : '', entry.stressMarked > 0 ? `${entry.stressMarked} Stress` : ''].filter((c) => c !== '').join(' and ');
      return { text: `${who(entry.id)}: ${entry.ability}${entry.rolled === undefined ? '' : ` (${entry.rolled})`}${cost === '' ? '' : `, ${cost}`}.`, tone: 'good' };
    }
    case 'goodSpent':
      return { text: `Spends ${plural(entry.amount, 'Light')}.`, tone: 'good' };
    case 'experience':
      return { text: `Draws on "${entry.name}" (+${entry.modifier}).`, tone: 'good' };
    case 'good':
      return entry.id === undefined ? null : { text: `${who(entry.id)} gains ${plural(entry.gained, 'Light')}.`, tone: 'good' };
    case 'goodLost':
      return { text: `${who(entry.id)} loses ${plural(entry.lost, 'Light')}.`, tone: 'bad' };
    case 'badLost':
      return { text: `The GM loses ${plural(entry.lost, 'Shadow')}.`, tone: 'good' };
    // Quest events are news, unlike the flags underneath them: the journal
    // changed, and the player should hear it without opening the journal.
    case 'quest': {
      const name = quests.get(entry.quest)?.name ?? entry.quest;
      if (entry.change === 'started') return { text: `New quest: ${name}.`, tone: 'system' };
      if (entry.change === 'completed') return { text: `Quest complete: ${name}.`, tone: 'success' };
      return { text: `Quest failed: ${name}.`, tone: 'bad' };
    }
    case 'levelUp':
      return { text: `The party reaches level ${entry.level}.`, tone: 'good' };
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
    case 'key': {
      // "You take the The Warden's word": an item may carry its own article,
      // and a sentence that adds one is written by somebody who has not read
      // the item's name. If it starts with one, it does not need ours.
      const named = names.get(entry.key) ?? entry.key;
      const article = /^(the|a|an) /i.test(named) ? '' : 'the ';
      return { text: `You take ${article}${named}.`, tone: 'success' };
    }
    case 'loot':
      return entry.found.length === 0
        ? { text: 'Nothing worth taking.', tone: 'system' }
        : { text: `You find ${listItems(entry.found, names)}.`, tone: 'success' };
    case 'damage':
      if (entry.targets !== undefined) {
        return {
          text: `${entry.dice ?? ''} → ${entry.amount} damage to ${entry.targets.map(who).join(', ')}: ${plural(entry.marked, 'Hit Point')}${entry.reduced === undefined ? '' : `, ${entry.reduced} turned aside`}.`.replace(/^ → /, ''),
          tone: 'combat',
        };
      }
      return { text: `You take ${entry.amount} damage.`, tone: 'bad' };
    case 'heal':
      return { text: `You recover ${entry.amount}.`, tone: 'good' };
    case 'check':
      if (entry.reused === true) {
        return {
          text:
            entry.hit.length > 0
              ? `The same roll (${entry.roll.total}) carries to ${entry.hit.map(who).join(', ')}.`
              : `The same roll (${entry.roll.total}) reaches nobody else.`,
          tone: toneFor(entry.outcome),
        };
      }
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
 * The dice, in words: "Light 9 + Shadow 4 +2 = 15 vs 13."
 *
 * The prototype rolled physical dice on screen; this reads them out instead,
 * which is the part of dice presentation a player actually needs to trust the
 * outcome. Only the parts that applied are named.
 */
export function describeRoll(roll: DualityRoll): string {
  const parts = [`Light ${roll.good} + Shadow ${roll.bad}`];
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
    case 'successWithGood':
      return 'Success, with Light.';
    case 'successWithBad':
      return 'Success, with Shadow.';
    case 'failureWithGood':
      return 'Failure, with Light.';
    case 'failureWithBad':
      return 'Failure, with Shadow.';
  }
}

function toneFor(outcome: CheckOutcome): LogTone {
  if (outcome === 'criticalSuccess') return 'success';
  return outcome.startsWith('success') ? 'good' : 'bad';
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

  const result = levelUp(sheet, characterContentFor(demo.project), plan);
  if (result.issues.length > 0) return { ok: false, issues: result.issues };

  setSheet(demo, result.sheet);
  const derived = demo.characters.get(characterId)!;

  const entity = demo.state.entity(characterId);
  if (entity !== undefined) {
    entity.hitPoints = { max: derived.hitPoints, marked: Math.min(entity.hitPoints.marked, derived.hitPoints) };
    entity.stress = { max: derived.stress, marked: Math.min(entity.stress.marked, derived.stress) };
    entity.armorSlots = { max: derived.armorScore, marked: Math.min(entity.armorSlots.marked, derived.armorScore) };
  }

  // The script world caches the party's best traits; a raised Strength has to
  // reach the next check.
  refreshWorld(demo);
  note(demo, `${result.sheet.name} reaches level ${result.sheet.level}.`, 'good');
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
    const weapon = characterContentFor(demo.project).weapons.get(item.contentId);
    if (weapon === undefined) return { ok: false, reason: `${item.name} points at no known weapon` };
    slot = slotOf(weapon);
    replaced = slot === 'primary' ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
    // Already in hand: nothing to swap, and taking it out of the pack would lose it.
    if (replaced === weapon.id) return { ok: false, reason: `${sheet.name} already wields the ${item.name}` };
    next = slot === 'primary' ? { ...sheet, primaryWeaponId: weapon.id } : { ...sheet, secondaryWeaponId: weapon.id };
  } else if (item.kind === 'armor') {
    if (inCombat(demo)) return { ok: false, reason: 'armor cannot be changed in a fight' };
    const armor = characterContentFor(demo.project).armors.get(item.contentId);
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

  setSheet(demo, next);
  const derived = demo.characters.get(characterId)!;
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
    armor:
      character?.sheet.armorId === undefined
        ? 'Unarmored'
        : (characterContentFor(demo.project).armors.get(character.sheet.armorId)?.name ?? 'Unarmored'),
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
    demo.pending = { kind: 'script', runner, prompt: result.prompt, interactable: null, recorded: result.journal.length, dialogue: null };
    return settle(demo, lines);
  }
  return settleTravel(demo, lines);
}
