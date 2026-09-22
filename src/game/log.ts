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
import type { QuestDef } from '../engine/content/quests';
import type { DialogueView } from '../engine/dialogue/dialogue';
import { NO_TILE, type Spot } from '../engine/grid/grid';
import type { DualityRoll } from '../engine/rules/duality';
import type { ProjectDoc } from '../engine/scene/schema';
import type { SceneState } from '../engine/scene/state';
import type { CheckOutcome, LogTone } from '../engine/script/effects';
import type { JournalEntry } from '../engine/script/runner';
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

/** Somebody on the board swung at somebody else on it, for a token that lunges. */
export function swungAt(demo: Pick<Narration, 'state' | 'motions'>, attacker: string, target: string): void {
  const from = demo.state.entity(attacker);
  const at = demo.state.entity(target)?.tile ?? NO_TILE;
  if (from === undefined || from.tile === NO_TILE || at === NO_TILE) return;
  demo.motions.push({ id: attacker, lunge: { at } });
}

/** A blow landed on somebody on the board, for a token that flinches. */
export function struck(demo: Pick<Narration, 'state' | 'motions'>, id: string): void {
  const entity = demo.state.entity(id);
  if (entity === undefined || entity.tile === NO_TILE) return;
  demo.motions.push({ id, struck: true });
}

/** Float a number over somebody who is on the board. Nobody there, nothing floats. */
export function float(demo: Pick<Narration, 'state' | 'floaters'>, id: string, text: string, tone: LogTone): void {
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
function floatEntry(demo: Pick<Narration, 'state' | 'world' | 'floaters' | 'motions'>, entry: JournalEntry): void {
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
export function note(demo: Named & Pick<Narration, 'log'>, text: string, tone: LogTone): LogLine[] {
  // Every line goes through here or through `record`, and both want their
  // names findable, so the marking happens on the way in rather than at each
  // of the several dozen call sites that write a sentence.
  const line = withMentions(demo, { text, tone });
  demo.log.push(line);
  return [line];
}

/**
 * Add a node's spoken lines to the transcript, if they are not there already.
 *
 * What a character *says* lives in the dialogue view, not the journal, so a
 * transcript is written as nodes are entered — and only once each, because a
 * node offering replies keeps handing back the same view until one is picked.
 * `talking` remembers which node is already down. Returns what it added, so a
 * caller can report the lines from one step.
 */
export function speak(demo: Pick<Narration, 'log'>, talking: { spokenNode: string | null }, view: DialogueView): LogLine[] {
  if (talking.spokenNode === view.node.id) return [];
  talking.spokenNode = view.node.id;
  const lines = view.lines.map((line) => ({
    text: line.speaker === undefined ? line.text : `${line.speaker}: ${line.text}`,
    tone: 'narration' as const,
  }));
  demo.log.push(...lines);
  return lines;
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
 * A creature's name for the log: the sheet's, the stat block's, or its id.
 *
 * The stat block is asked of the world, which knows the content this fight is
 * being played with, rather than of whatever the shipped pack has under the id.
 */
export function nameOf(demo: Named, id: string): string {
  const sheet = demo.sheets.get(id);
  if (sheet !== undefined) return sheet.name;
  const entity = demo.state.entity(id);
  if (entity === undefined) return id;
  return demo.world.adversaryDef(entity.definition)?.name ?? id;
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

/**
 * Turn what a script did into what the player reads.
 *
 * Only the entries with something to say become lines; a flag being set is real
 * but not news. Everything a journal leaves for a view is written here — the
 * lines, the dice, the numbers over heads, the tokens' motions — and nothing
 * is acted on. What the *fight* makes of the same journal is `demo-scene.ts`'s
 * business, in `record`, which calls this first.
 */
export function writeDown(demo: Narration, journal: readonly JournalEntry[]): LogLine[] {
  const lines: LogLine[] = [];
  const names = new Map(demo.project.items.map((item) => [item.id, item.name]));
  const quests = new Map(demo.project.quests.map((quest) => [quest.id, quest]));
  const who = (id: string): string => nameOf(demo, id);
  for (const entry of journal) {
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
  return lines;
}

/** The sentence a journal entry reads as, or `null` for the ones that are not news. */
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
