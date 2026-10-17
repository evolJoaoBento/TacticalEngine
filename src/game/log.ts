/**
 * What the player reads of the game: the narrative log, the numbers that float
 * over heads, the lunges and flinches a token makes, the dice the table watches
 * settle — and the words for all of it.
 *
 * Nothing here decides anything. A function in this file is handed what a
 * script or a swing left behind and writes it down where a view will find it;
 * the fight is neither consulted nor changed. That is why it is its own module:
 * `demo-scene.ts` runs the game and this says what happened, and the dependency
 * runs one way, from there to here.
 */

import type { CharacterSheet } from '../engine/character/sheet';
import { type Spot } from '../engine/grid/grid';
import type { DualityRoll } from '../engine/rules/duality';
import type { ProjectDoc } from '../engine/scene/schema';
import type { SceneState } from '../engine/scene/state';
import type { LogTone } from '../engine/script/effects';
import type { ScenarioState, SceneScriptWorld } from '../engine/script/world';

/** How somebody got where they are: along a path, or flung - or that a blow landed on them. */
export interface Motion {
  id: string;
  /** The tiles walked, the first the one left. */
  path?: readonly number[];
  /** The line actually crossed, from where they stood to where they stopped; the path when left out. */
  route?: readonly Spot[];
  /**
   * The last leg of `route` is a jump, arcing this many blocks over the straight line between its
   * ends: the token gathers, flies the arc the aim drew and lands, rather than walking it.
   */
  leap?: number;
  /** Drawn only once the roll that decided it has been read: the card is accepted, then the token goes. */
  wait?: true;
  thrown?: true;
  /** A wound landed; the token takes it. */
  struck?: true;
  /** They swung at this tile; the token lunges that way. */
  lunge?: { at: number };
  /** Through a portal: put down where they are now, not walked there from where they were. */
  teleport?: true;
}

/** One number over one head, in the tone the matching log line has. */
export interface Floater {
  id: string;
  text: string;
  tone: LogTone;
}

/** A line in the narrative pane. */
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
 * The part of a game a line is written against.
 *
 * `DemoScene` has all of this and twenty fields more. A function here names
 * only the part it reads, so its signature says what a line depends on: the
 * board and the sheets, for who is called what; the world, for what a stat
 * block or a condition is called; the project, for what an item or a quest is
 * called; who is acting, for a check that names no roller; and the four
 * queues a view drains.
 */
export interface Narration {
  readonly state: Pick<SceneState, 'entity' | 'entitiesOf'>;
  readonly world: Pick<SceneScriptWorld, 'adversaryDef' | 'conditionName'>;
  readonly sheets: ReadonlyMap<string, Pick<CharacterSheet, 'name'>>;
  readonly project: Pick<ProjectDoc, 'items' | 'quests'>;
  readonly scenario: Pick<ScenarioState, 'actorId'>;
  readonly log: LogLine[];
  readonly floaters: Floater[];
  readonly motions: Motion[];
  readonly rolls: RollShow[];
}

/** Enough to say who somebody is: the board, the sheets, and the world's names for the rest. */
type Named = Pick<Narration, 'state' | 'sheets' | 'world'>;

/** Put one line in the log, and return it. */
export function note(demo: Named & Pick<Narration, 'log'>, text: string, tone: LogTone): LogLine[] {
  // Every line goes through here or through `record`, and both want their
  // names findable, so the marking happens on the way in rather than at each
  // of the several dozen call sites that write a sentence.
  const line = withMentions(demo, { text, tone });
  demo.log.push(line);
  return [line];
}

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
export function showRoll(demo: Pick<Narration, 'rolls'>, who: string, what: string, roll: DualityRoll): void {
  demo.rolls.push({ id: ++rollCount, who, what, roll });
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
function withMentions(demo: Named, line: LogLine): LogLine {
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

/**
 * A creature's name for the log: the sheet's, its own - a placement's name - the stat block's, or its id.
 *
 * The stat block is asked of the world, which knows the content this fight is
 * being played with, rather than of whatever the shipped pack has under the id.
 */
export function nameOf(demo: Named, id: string): string {
  const sheet = demo.sheets.get(id);
  if (sheet !== undefined) return sheet.name;
  const entity = demo.state.entity(id);
  if (entity === undefined) return id;
  return entity.name ?? demo.world.adversaryDef(entity.definition)?.name ?? id;
}
