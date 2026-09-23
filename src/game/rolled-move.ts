/**
 * The moves a roll stands in front of: a run under pressure, and a jump.
 *
 * Both are a click on the ground that `moveSelectedTo` hands over rather than walks, both ask
 * for an Agility Roll as a script - so the dice, the Light and Shadow, the spotlight and the
 * prompt are the ones every other roll in the game gets - and both do their walking when the
 * answer comes back. Apart from `demo-scene.ts` because that file is at its limit, and because
 * two of them is where they stopped being the tail of a click and became a kind of thing.
 */

import type { Spot } from '../engine/grid/grid';
import { ScriptRunner } from '../engine/script/runner';
import type { Effect } from '../engine/script/schema';
import { DEMO_MOVE_DIFFICULTY, jumpRulesFor } from './demo-rules';
import { answerPending, record, settleFight, type DemoScene } from './demo-scene';
import { jumpArc, leapTargets, planRunningJump, type JumpArc, type Leap } from './leap';
import { nameOf, note } from './log';
import { inCombat } from './moment';
import { arrive, walkTheMove, type MoveResult } from './movement';
import { bandLabel } from '../engine/rules/range';
import { pushCircle, pushPrompt } from './circle';
import { userSettings } from './user-settings';

/** Run a roll's script, and do `finish` with the answer: now when nothing was asked, else when it is given. */
function rollThen(demo: DemoScene, id: string, effects: Effect[], finish: (runner: ScriptRunner) => void): MoveResult {
  demo.scenario.actorId = id;
  const runner = new ScriptRunner(demo.world, demo.rng, { rollAs: 'actor' });
  const result = runner.run(effects);
  record(demo, result.journal);
  if (result.status === 'waiting') {
    demo.pending = { kind: 'script', runner, prompt: result.prompt, interactable: null, recorded: result.journal.length, dialogue: null, onDone: finish };
    return { moved: false, path: [], pending: true };
  }
  finish(runner);
  return { moved: true, path: [] };
}

/**
 * Movement Under Pressure: the Agility Roll between a fighter and a spot past their circle.
 *
 * The roll is the action. A success pushes the circle out one distance step - Close to Far, Far to
 * Very Far - for the rest of the spotlight, and walks as far towards the spot as the wider circle
 * allows. A failure moves nobody and hands the spotlight to the GM: the turn is over, as any failed
 * action roll ends it, and the prompt says so before the dice are thrown. Called off before they
 * are, nothing is spent.
 */
export function runForIt(
  demo: DemoScene,
  id: string,
  destination: number,
  aimed: Spot | undefined,
  _shortOf: { goal: number; aim: Spot | undefined },
): MoveResult {
  const opens = pushCircle(demo, id);
  if (opens === null) return { moved: false, path: [] };
  const effects: Effect[] = [{ kind: 'check', check: { trait: 'agility', difficulty: DEMO_MOVE_DIFFICULTY, prompt: pushPrompt(nameOf(demo, id), opens.band) } }];
  return rollThen(demo, id, effects, (runner) => {
    if (runner.cancelled && !runner.rolled) return;
    const name = nameOf(demo, id);
    if (runner.lastActionRoll?.success === true) {
      const band = demo.encounter?.push(id) ?? null;
      if (band !== null) note(demo, `${name} pushes out to ${bandLabel(band)} range for the rest of the turn.`, 'combat');
      walkTheMove(demo, id, destination, aimed, { fighting: true, short: true, act: false });
    } else {
      note(demo, `${name} is held where they are: the spotlight passes to the GM.`, 'combat');
    }
    // The roll was the action, and a failure ends the turn whatever the dice said about Light.
    if (inCombat(demo) && demo.encounter!.canAct(id)) demo.encounter!.act(id, { spotlightToGm: runner.spotlightToGm || runner.lastActionRoll?.success !== true });
    settleFight(demo);
  });
}

const blocks = (n: number): string => `${n} block${n === 1 ? '' : 's'}`;

/**
 * Make a jump: the roll first, where there is one, then the walk to where it is made from -
 * when the landing was past their range, and only then -
 * then the landing - which happens whatever the dice said.
 *
 * They always land, and land alone: whoever was walking with them stays behind (`Party.unlink`).
 * A failed roll lands them Prone, and a fall past a safe drop is damage
 * either way, halved by a success; it is direct, since no armour is between a body and the
 * ground. In a fight the roll is the action, as a run's is, and a drop that asks for no roll
 * is a move like any other and spends it the same.
 *
 * A jump that was rolled for is drawn once the roll has been read: the motion says `wait`, and
 * the token stands where it was until the card is accepted - unless the player has the dice
 * thrown for them (`read` false), and then there is no card to wait on and it goes at once.
 *
 * Which trait, which die, whether a success halves it and what a failure leaves them with are
 * the project's jump rules; the sentence above is what they say when a project says nothing.
 */
function leapTo(demo: DemoScene, id: string, leap: Leap, read = true): MoveResult {
  const name = nameOf(demo, id);
  const rules = jumpRulesFor(demo.project);
  // The condition by the name the player reads, as every other line in the log has it.
  const lands = rules.failCondition === '' ? '' : demo.project.conditionDefs.find((def) => def.id === rules.failCondition)?.name ?? rules.failCondition;
  // In whole blocks, as it is thought of: a block stood beside a floor tile is three quarters up, and is a block.
  const high = blocks(Math.max(1, Math.round(Math.abs(leap.rise))));
  // Across the ground rather than up or down it: said in tiles, which is what was aimed.
  const level = Math.abs(leap.rise) <= rules.stepHeight;
  const across = Math.max(1, Math.round(leap.across));
  const what = level ? `jumps ${across} tile${across === 1 ? '' : 's'}` : leap.rise > 0 ? `jumps up ${high}` : `drops ${high}`;
  const land = (success: boolean | null, spotlightToGm?: boolean): void => {
    const fighting = inCombat(demo);
    if (leap.walk !== undefined) {
      // The run-up, to the spot along it the jump comes into range from - not to a tile's centre.
      const walked = walkTheMove(demo, id, leap.from, leap.fromAt, { fighting, short: false, act: false });
      // Walked into something on the way: the ambush has them, and the jump is not made.
      if (walked.triggered !== undefined || demo.state.entity(id)!.tile !== leap.from) return;
    }
    // Down from a bad landing, they get up to jump, as they would to walk.
    if (demo.world.clearCondition(id, 'prone')) note(demo, `${name} gets up.`, fighting ? 'combat' : 'system');
    const stood = { ...demo.state.entity(id)!.at };
    demo.state.placeEntity(id, leap.at.x, leap.at.y);
    // One line for the board, the walk and the jump at the end of it: a token glides along the
    // last motion it was given, so a second one would cut the walk short and fly from where it stood.
    const walk = demo.motions.findIndex((motion) => motion.id === id && motion.route !== undefined);
    const approach = walk < 0 ? { path: [leap.from], route: [stood] } : demo.motions.splice(walk, 1)[0]!;
    demo.motions.push({ id, path: [...(approach.path ?? [leap.from]), leap.to], route: [...(approach.route ?? [stood]), { ...leap.at }], leap: leap.lift, ...(success !== null && read ? { wait: true as const } : {}) });
    note(demo, `${name} ${what}.`, fighting ? 'combat' : 'system');
    // A jump is not followed. The ones walking with them cannot make it, and left linked they would
    // walk round to wherever the jumper went next as if the gap were floor. So the jumper goes on
    // alone, and the rest stay where they stood; the cards' chain shows the split, and dragging a
    // card back links them again.
    if (demo.party.unlink(id)) note(demo, `${name} goes on alone: the others stay where they are.`, fighting ? 'combat' : 'system');
    // Landed on a trigger: what a walk onto it would have woken, a jump onto it wakes. Over the
    // wall is a way into the vault, and the husks are no less there for it.
    const woke = demo.triggers.firstAlong([leap.to], demo.state);
    if (woke !== null) {
      demo.ambush = woke.encounter;
      if (!demo.animated) arrive(demo);
    }
    const after: Effect[] = [];
    const fall = `${leap.fallDice}d${rules.fallDie}`;
    if (leap.fallDice > 0) after.push({ kind: 'damage', dice: fall, type: 'physical', direct: true, target: { kind: 'actor' }, source: 'the fall', ...(success === true && rules.halfOnSuccess ? { half: true } : {}) });
    if (success === false && rules.failCondition !== '') after.push({ kind: 'applyCondition', condition: rules.failCondition, target: { kind: 'actor' } });
    if (after.length > 0) {
      demo.scenario.actorId = id;
      record(demo, new ScriptRunner(demo.world, demo.rng, { rollAs: 'actor' }).run(after).journal);
    }
    if (fighting && demo.encounter!.canAct(id)) demo.encounter!.act(id, spotlightToGm === undefined ? {} : { spotlightToGm });
    settleFight(demo);
  };
  if (leap.difficulty === null) {
    land(null);
    return { moved: true, path: [leap.from, leap.to] };
  }
  const roll = `${rules.rollTrait[0]!.toUpperCase()}${rules.rollTrait.slice(1)} Roll`;
  const failing = lands === '' ? '' : `, and lands ${lands} on a failure`;
  const hurts = leap.fallDice === 0 ? '' : ` ${name} takes ${leap.fallDice}d${rules.fallDie} from the fall${rules.halfOnSuccess ? ', half on a success' : ''}.`;
  const asked = level ? `Jump ${across} tile${across === 1 ? '' : 's'}` : `${leap.rise > 0 ? 'Jump up' : 'Drop'} ${high}`;
  const prompt = `${asked}: a${/^[AEIOU]/.test(roll) ? 'n' : ''} ${roll}.${hurts} ${name} lands either way${failing}.`;
  return rollThen(demo, id, [{ kind: 'check', check: { trait: rules.rollTrait, difficulty: leap.difficulty, prompt } }], (runner) => {
    if (runner.cancelled && !runner.rolled) return;
    land(runner.lastActionRoll?.success === true, runner.spotlightToGm);
  });
}

/** What the Jump button arms the bar with: the id the board's aiming reads, which no card can have. */
export const JUMP_ID = 'jump:button';

/** Whether the selected member may be offered a jump at all: somebody who can act, in a project that has jumping. */
export function jumpOffered(demo: DemoScene): boolean {
  const id = demo.party.selected;
  if (id === null || !demo.party.canCommand(id) || !jumpRulesFor(demo.project).enabled) return false;
  return !inCombat(demo) || demo.encounter!.canAct(id);
}

/**
 * Arm a jump: the landings to light, as the bar's aiming holds a card's. Null, with a line in
 * the log saying why, when there is nowhere to jump to from anywhere this move reaches.
 */
export function jumpAim(demo: DemoScene): { characterId: string; abilityId: string; name: string; valid: string[]; tiles: number[] } | null {
  const id = demo.party.selected;
  if (id === null || demo.pending !== null || demo.ambush !== null || !jumpOffered(demo)) return null;
  const tiles = leapTargets(demo, id);
  if (tiles.length > 0) return { characterId: id, abilityId: JUMP_ID, name: 'Jump', valid: [], tiles };
  note(demo, `${nameOf(demo, id)} has nowhere to jump to from here.`, 'system');
  return null;
}

/**
 * Jump to where the aim pointed: from where they stand when that reaches, and otherwise with
 * the walk to the nearest spot it can be made from in front of it.
 *
 * With the player's "roll jumps automatically" on, the dice are thrown at once: the same roll,
 * shown and logged and paid for the same, without the prompt between the click and the dice.
 */
export function jumpTo(demo: DemoScene, id: string, destination: number, aim?: Spot): MoveResult {
  if (demo.pending !== null || demo.ambush !== null || demo.party.selected !== id || !jumpOffered(demo)) return { moved: false, path: [] };
  const leap = planRunningJump(demo, id, destination, aim);
  if (leap === null) return { moved: false, path: [] };
  const made = leapTo(demo, id, leap, !userSettings().autoRollJumps);
  if (made.pending !== true || !userSettings().autoRollJumps) return made;
  answerPending(demo, { kind: 'roll' });
  return { moved: demo.state.entity(id)?.tile === destination, path: [leap.from, leap.to] };
}

/** Whether a jump aimed at a tile is one that can be made, walk and all: what a click there is allowed to be. */
export function jumpReaches(demo: DemoScene, id: string, destination: number, aim?: Spot): boolean {
  return planRunningJump(demo, id, destination, aim) !== null;
}

/** The arc to draw while the bar is armed with a jump and the pointer is over a tile; null for anything else. */
export function aimedArc(demo: DemoScene, armed: { abilityId: string; characterId: string; aimed?: number; aimedAt?: Spot } | null): JumpArc | null {
  return armed === null || armed.abilityId !== JUMP_ID || armed.aimed === undefined ? null : jumpArc(demo, armed.characterId, armed.aimed, armed.aimedAt);
}
