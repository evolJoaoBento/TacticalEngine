/**
 * Walking, as the Rust server must walk (`docs/SERVER.md`, phase 2).
 *
 * Sessions of clicks on the ground and on things: the selected member walked where a click takes them
 * (`moveSelectedTo`) - aimed at a spot, beyond reach, into a trigger that begins its fight, and on inside
 * the fight within their circle - the line a click would walk and the swing a click on a creature would
 * close for (`previewWalk`, `previewStrike`), the ground they reach and where a push would take them, a
 * walk up to a thing to use it (`approachThenUse`) or to a creature to talk to it or strike it, and the
 * things of the last part between: uses, answers, the selection, travel - and the rolled moves: a push past
 * the circle, and a jump, aimed, with the Jump button's landings and the arc it draws. Each step's answer,
 * and after it the fight - its view, its log and every circle drawn - with everything `play.golden.test.ts`
 * records. What the fight answers is the next part's, so a step that would settle a fight with a blow still
 * waiting to be answered, and a jump whose fall hurts, are probed and not made. The output queues a view
 * drains every frame are drained after every step.
 * `UPDATE_GOLDEN=1 npx vitest run src/game/walk.golden.test.ts` writes `server/fixtures/walk.json`;
 * `server/hooks/tests/golden_walk.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE, type Spot } from '../engine/grid/grid';
import { EQUIPMENT } from '../engine/content/equipment/catalogue';
import type { ContentPack } from '../engine/content/pack/import';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { migrateDocument } from '../engine/scene/migrate';
import { interactablesOf } from '../engine/scene/prop-functions';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { Response } from '../engine/script/runner';
import { scenarioSnapshot } from '../engine/script/world';
import type { RangeBand } from '../engine/rules/range';
import { answerPending, buildDemoScene, buildProjectScene, moveSelectedTo, useSelectedOn, type DemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { DEMO_ADVERSARIES, DEMO_CHARACTERS } from './demo-rules';
import { talkTo, talksTo } from './interaction';
import { approachThenUse } from './arrival';
import { aimOfMove, closeToStrike, previewStrike, previewWalk, reachableTiles, underPressureTiles } from './movement';
import { jumpArc, planRunningJump } from './leap';
import { jumpAim, jumpOffered, jumpTo } from './rolled-move';
import { setUserSetting } from './user-settings';
import { inCombat } from './moment';
import { closeContainer, openContainer } from './prop-use';
import { travelTo } from './room';
import { syncTalks, talkingAside } from './talks';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../server/fixtures/walk.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;
const num = (value: number): number | null => (Number.isFinite(value) ? value : null);

/** The content as the Rust reads it, as `session.golden.test.ts` writes it. */
function contentJson(pack: ContentPack) {
  return {
    weapons: [...pack.weapons.values()].map(({ id, name, tier, slot, trait, range, damage, burden, features }) => ({ id, name, tier, slot, trait, range, damage, burden, features })),
    armors: [...pack.armors.values()].map(({ id, name, tier, baseThresholds, baseScore, features }) => ({ id, name, tier, baseThresholds, baseScore, features })),
    classes: [...pack.classes.values()].map(({ id, name, domains, startingEvasion, startingHitPoints }) => ({ id, name, domains, startingEvasion, startingHitPoints })),
    ancestries: [...pack.ancestries.values()].map(({ id, name }) => ({ id, name })),
    communities: [...pack.communities.values()].map(({ id, name }) => ({ id, name })),
    subclasses: [...pack.subclasses.values()].map(({ id, name, classId, domains, spellcastTrait }) => ({ id, name, classId, domains, ...(spellcastTrait === undefined ? {} : { spellcastTrait }) })),
    cards: [...pack.cards.values()].map(({ id, name, grant, domain, type, level, recallCost }) => ({ id, name, grant, ...(domain === undefined ? {} : { domain }), ...(type === undefined ? {} : { type }), ...(level === undefined ? {} : { level }), ...(recallCost === undefined ? {} : { recallCost }) })),
  };
}

// --- What a step is seen as --------------------------------------------------------------------------------

function fightView(demo: DemoScene) {
  const e = demo.encounter;
  if (e === null) return null;
  const circles = (e as unknown as { circles: Map<string, { anchor: Spot; band: RangeBand }> }).circles;
  return {
    id: e.encounterId,
    view: e.view(),
    // What it has reported: under the spotlight an action passes nothing on, and this is where it shows.
    log: e.log,
    circles: [...circles].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, c]) => [id, c.anchor, c.band]),
  };
}

/** What happened, and then the view's queues drained, as a view drains them every frame. */
function view(demo: DemoScene, since: number) {
  const seen = clone({
    scene: demo.scene.id,
    fight: fightView(demo),
    pending: demo.pending === null ? null : demo.pending.kind === 'script' ? { prompt: demo.pending.prompt, dialogue: demo.pending.dialogue?.id ?? null } : { kind: demo.pending.kind },
    open: openContainer(demo),
    aside: talkingAside(demo),
    selected: demo.party.selected,
    held: demo.party.members().filter((id) => demo.party.isHeld(id)),
    entities: demo.state.allEntities().map((e) => [e.id, e.faction, e.tile, e.at.x, e.at.y, e.alive, e.hitPoints, e.stress, [...e.conditions], e.truce ?? null]),
    log: demo.log.slice(since),
    floaters: demo.floaters,
    motions: demo.motions,
    rolls: demo.rolls.map(({ who, what, roll }) => ({ who, what, roll })),
    things: demo.state.snapshot().interactables,
    scenario: scenarioSnapshot(demo.scenario),
  });
  demo.floaters.length = 0;
  demo.motions.length = 0;
  demo.rolls.length = 0;
  return seen;
}

function fieldJson(field: ReturnType<typeof reachableTiles>) {
  const tiles = field.tiles();
  return { start: field.start, budget: num(field.budget), tiles, cost: tiles.map((t) => num(field.costTo(t))) };
}

// --- Answers, as a player might give them ------------------------------------------------------------------

function answerFor(demo: DemoScene, g: Rng): Response {
  const p = demo.pending;
  if (p === null || p.kind !== 'script') return { kind: 'continue' };
  const d = p.dialogue;
  if (d !== null && d.view !== null && d.prompt === null) {
    const enabled = d.view.options.filter((o) => o.enabled);
    return enabled.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: g.pick(enabled).index };
  }
  const prompt = d === null ? p.prompt : d.prompt;
  if (prompt === null) return { kind: 'continue' };
  switch (prompt.kind) {
    case 'check':
      return { kind: 'roll' };
    case 'choice':
      return { kind: 'choose', index: g.pick(prompt.options).index };
    case 'rolled':
      return { kind: 'answered' };
    default:
      return { kind: 'continue' };
  }
}

// --- A session ---------------------------------------------------------------------------------------------

const round = (n: number): number => Math.round(n * 20) / 20;

/** A blow or a crossing waiting to be answered: settling a fight now would answer it, which is the next part's. */
const unsettled = (demo: DemoScene): boolean => {
  const world = demo.world as unknown as { damaged: unknown[]; entered: unknown[] };
  return world.damaged.length > 0 || world.entered.length > 0;
};

/** A jump the selected member could be asked for, and the one it would be: probed first, since a fall that hurts is not made. */
function jumpStep(demo: DemoScene, destination: number, aim: Spot | undefined, auto: boolean): Record<string, unknown> {
  const id = demo.party.selected;
  const ready = demo.pending === null && id !== null && jumpOffered(demo);
  if (ready) {
    const leap = planRunningJump(demo, id!, destination, aim);
    if (leap !== null && (leap.fallDice > 0 || unsettled(demo))) return { step: 'jumpProbe', destination, aim: aim ?? null, fall: leap.fallDice };
  }
  setUserSetting('autoRollJumps', auto);
  const result = id === null ? null : jumpTo(demo, id, destination, aim);
  setUserSetting('autoRollJumps', false);
  return { step: 'jump', destination, aim: aim ?? null, auto, probed: ready, result };
}

/** Somebody down, or a creature fallen: the fight's answers to either are the next part's, so the session stops. */
const somebodyDown = (demo: DemoScene): boolean => demo.state.allEntities().some((e) => !e.alive);

function session(g: Rng, name: string, project: number, input: ProjectDoc, length: number) {
  const demo = buildProjectScene(projectSchema.parse(clone(input)), `walk:${name}`);
  const start = view(demo, 0);
  const steps: unknown[] = [];
  for (let n = 0; n < length; n++) {
    const since = demo.log.length;
    const fighting = inCombat(demo);
    const selected = demo.party.selected;
    const at = selected === null ? NO_TILE : (demo.state.entity(selected)?.tile ?? NO_TILE);
    const aTile = (): number => {
      if (at !== NO_TILE && g.nextInt(4) > 0) {
        const x = Math.min(demo.grid.width - 1, Math.max(0, demo.grid.xOf(at) + g.nextInt(13) - 6));
        const y = Math.min(demo.grid.height - 1, Math.max(0, demo.grid.yOf(at) + g.nextInt(13) - 6));
        return demo.grid.indexOf(x, y);
      }
      return g.nextInt(demo.grid.size);
    };
    const aSpot = (tile: number): Spot => ({ x: round(demo.grid.xOf(tile) + (g.next() - 0.5) * 0.9), y: round(demo.grid.yOf(tile) + (g.next() - 0.5) * 0.9) });
    const talkers = demo.state.allEntities().filter((e) => talksTo(demo, e.id)).map((e) => e.id);
    const foes = demo.state.entitiesOf('adversary').filter((e) => e.alive).map((e) => e.id);
    const things = interactablesOf(demo.scene).map((t) => t.id);
    const kinds = demo.pending !== null
      ? (['answer', 'answer', 'answer', 'move', 'select'] as const)
      : fighting
        ? (['move', 'move', 'move', 'move', 'preview', 'reach', 'reach', 'approach', 'approach', 'strike', 'previewStrike', 'use', 'select', 'shove', 'jump', 'jump', 'arc', 'jumpAim'] as const)
        : (['move', 'move', 'move', 'move', 'move', 'preview', 'reach', 'approach', 'approach', 'talk', 'strike', 'previewStrike', 'select', 'travel', 'close', 'jump', 'jump', 'arc', 'jumpAim'] as const);
    const kind = g.pick(kinds);
    let step: Record<string, unknown>;
    switch (kind) {
      case 'move': {
        const destination = aTile();
        const aim = g.nextInt(2) === 0 ? aSpot(destination) : undefined;
        const ready = demo.pending === null && selected !== null && demo.party.canCommand(selected) && (!fighting || demo.encounter!.canAct(selected));
        if (ready && unsettled(demo) && aimOfMove(demo, selected!, destination, aim, fighting).run) {
          // A push settles the fight after it, and a blow is waiting to be answered: probed, and not made.
          step = { step: 'probe', destination, aim: aim ?? null, run: true };
          break;
        }
        step = { step: kind, destination, aim: aim ?? null, probed: ready, result: moveSelectedTo(demo, destination, aim) };
        break;
      }
      case 'preview': {
        const destination = aTile();
        step = { step: kind, destination, aim: aSpot(destination), result: null };
        step['result'] = previewWalk(demo, destination, step['aim'] as Spot);
        break;
      }
      case 'reach': {
        const budget = g.nextInt(3) === 0 ? g.pick([1.5, 3, 6]) : undefined;
        step = { step: kind, budget: budget ?? null, result: fieldJson(reachableTiles(demo, budget)), pressure: underPressureTiles(demo) };
        break;
      }
      case 'jump': {
        const destination = aTile();
        step = jumpStep(demo, destination, g.nextInt(2) === 0 ? aSpot(destination) : undefined, g.nextInt(4) === 0);
        break;
      }
      case 'arc': {
        const destination = aTile();
        const aim = g.nextInt(2) === 0 ? aSpot(destination) : undefined;
        step = { step: kind, destination, aim: aim ?? null, result: selected === null ? null : jumpArc(demo, selected, destination, aim) };
        break;
      }
      case 'jumpAim': {
        const aimed = jumpAim(demo);
        step = { step: kind, result: aimed === null ? null : aimed.tiles };
        break;
      }
      case 'shove': {
        // Put somewhere by something other than a walk - a shove, a script: outside their circle, maybe.
        const destination = aTile();
        const spot = aSpot(destination);
        const ok = selected !== null && demo.grid.isPassable(destination);
        if (ok) demo.state.placeEntity(selected!, spot.x, spot.y);
        step = { step: kind, id: selected, at: ok ? spot : null };
        break;
      }
      case 'approach': {
        const id = things.length === 0 ? 'nothing' : g.pick(things);
        step = { step: kind, id, result: approachThenUse(demo, id) };
        break;
      }
      case 'talk': {
        // In a fight a conversation's end settles it: not while a blow waits to be answered.
        const id = talkers.length === 0 || (fighting && unsettled(demo)) ? 'nobody' : g.pick(talkers);
        step = { step: kind, id, actor: selected, result: selected === null ? null : talkTo(demo, selected, id) };
        break;
      }
      case 'strike': {
        const id = foes.length === 0 ? null : g.pick(foes);
        const band = g.pick(['melee', 'veryClose', 'close'] as const);
        const target = id === null ? undefined : demo.state.entity(id);
        step = { step: kind, id, band, result: selected === null || target === undefined ? null : closeToStrike(demo, selected, target, band) };
        break;
      }
      case 'previewStrike': {
        const id = foes.length === 0 ? 'nobody' : g.pick(foes);
        step = { step: kind, id, result: previewStrike(demo, id) };
        break;
      }
      case 'use': {
        const id = things.length === 0 ? 'nothing' : g.pick(things);
        step = { step: kind, id, result: useSelectedOn(demo, id) };
        break;
      }
      case 'answer': {
        const response = answerFor(demo, g);
        step = { step: kind, response, result: answerPending(demo, response) };
        break;
      }
      case 'select': {
        const next = demo.party.selectNext();
        step = { step: kind, selected: next, moved: syncTalks(demo) };
        break;
      }
      case 'travel': {
        const scene = g.pick(demo.project.scenes).id;
        step = { step: kind, scene, result: travelTo(demo, scene) };
        break;
      }
      case 'close':
        closeContainer(demo);
        step = { step: kind };
        break;
    }
    if (somebodyDown(demo)) break;
    step['after'] = view(demo, since);
    steps.push(step);
  }
  return { name, project, start, steps };
}

/**
 * The default project with a trip-wire that lays its user prone, a war horn that begins the vault's fight,
 * and a white flag that ends it and stands every creature down - for the fight to begin, stop and begin
 * again, and somebody to get up.
 */
function drillYard(base: ProjectDoc): ProjectDoc {
  const project = clone(base);
  const vault = project.scenes[0]!;
  const fight = vault.encounters.find((e) => e.startsOnTrigger && e.adversaries.length > 0)!.id;
  const near = (dx: number, dy: number) => ({ x: vault.spawns[0]!.x + dx, y: vault.spawns[0]!.y + dy });
  const prop = (id: string, at: { x: number; y: number }, effects: unknown[]) => ({ id, model: 'crate', position: at, rotation: 0, function: { kind: 'script', effects, repeatable: true, blocksMovement: false } });
  // A platform a block up beside the door: a step will not climb it, and a jump onto it asks a roll.
  for (let dy = -1; dy <= 1; dy++) for (let dx = 5; dx <= 7; dx++) vault.heights[(vault.spawns[0]!.y + dy) * vault.width + vault.spawns[0]!.x + dx] = 3;
  vault.decos.push(
    prop('trip-wire', near(2, 0), [{ kind: 'applyCondition', condition: 'prone', target: { kind: 'actor' } }]) as never,
    prop('war-horn', near(2, 1), [{ kind: 'startEncounter', encounter: fight, intro: 'A horn sounds across the vault.' }]) as never,
    prop('white-flag', near(3, 1), [{ kind: 'endEncounter', encounter: fight }]) as never,
  );
  // The platform's far corner wakes the fight: a jump can land on it.
  vault.encounters.find((e) => e.id === fight)!.triggerCells.push(near(7, -1));
  return projectSchema.parse(project);
}

/** The drill yard for somebody who cannot jump: no tile is near enough to land on. */
function stiffLegs(base: ProjectDoc): ProjectDoc {
  return projectSchema.parse({ ...clone(base), jump: { rangeBase: 0, rangePerPoint: 0 } });
}

/** The drill yard walked on purpose: prone, a horn, a fight walked in, a shove, a flag, the horn again. */
function tour(g: Rng, name: string, project: number, input: ProjectDoc, round: number) {
  const demo = buildProjectScene(projectSchema.parse(clone(input)), `walk:${name}`);
  const start = view(demo, 0);
  const steps: unknown[] = [];
  const record = (step: Record<string, unknown>, since: number): void => {
    step['after'] = view(demo, since);
    steps.push(step);
  };
  const near = (): number => {
    const at = demo.state.entity(demo.party.selected ?? '')?.tile ?? 0;
    return demo.grid.indexOf(Math.min(demo.grid.width - 1, Math.max(0, demo.grid.xOf(at) + g.nextInt(7) - 3)), Math.min(demo.grid.height - 1, Math.max(0, demo.grid.yOf(at) + g.nextInt(7) - 3)));
  };
  const approach = (id: string): void => {
    const since = demo.log.length;
    record({ step: 'approach', id, result: approachThenUse(demo, id) }, since);
  };
  const move = (to?: number): void => {
    const since = demo.log.length;
    const destination = to ?? near();
    const id = demo.party.selected;
    const fighting = inCombat(demo);
    const ready = demo.pending === null && id !== null && demo.party.canCommand(id) && (!fighting || demo.encounter!.canAct(id));
    if (ready && unsettled(demo) && aimOfMove(demo, id!, destination, undefined, fighting).run) {
      record({ step: 'probe', destination, aim: null, run: true }, since);
      return;
    }
    record({ step: 'move', destination, aim: null, probed: ready, result: moveSelectedTo(demo, destination) }, since);
  };
  const reach = (budget?: number): void => {
    const since = demo.log.length;
    record({ step: 'reach', budget: budget ?? null, result: fieldJson(reachableTiles(demo, budget)), pressure: underPressureTiles(demo) }, since);
  };
  const answer = (): void => {
    for (let k = 0; k < 4 && demo.pending !== null; k++) {
      const since = demo.log.length;
      const response = answerFor(demo, g);
      record({ step: 'answer', response, result: answerPending(demo, response) }, since);
    }
  };
  const push = (): void => {
    // As far as the push opens: six tiles out, the first way that is a push past the circle.
    const since = demo.log.length;
    const id = demo.party.selected;
    const at = demo.state.entity(id ?? '')?.tile ?? NO_TILE;
    const fighting = inCombat(demo);
    const ready = demo.pending === null && id !== null && demo.party.canCommand(id) && (!fighting || demo.encounter!.canAct(id));
    const out = (dx: number, dy: number): number => (at === NO_TILE ? NO_TILE : demo.grid.indexOf(demo.grid.xOf(at) + dx, demo.grid.yOf(at) + dy));
    const ways = [out(6, 0), out(0, 6), out(0, -6), out(-6, 0)].filter((tile) => tile !== NO_TILE);
    const destination = ways.find((tile) => ready && fighting && aimOfMove(demo, id!, tile, undefined, true).run) ?? ways[0] ?? NO_TILE;
    record({ step: 'move', destination, aim: null, probed: ready, result: moveSelectedTo(demo, destination) }, since);
  };
  const jump = (dx: number, dy: number, auto: boolean): void => {
    const since = demo.log.length;
    const at = demo.state.entity(demo.party.selected ?? '')?.tile ?? NO_TILE;
    const destination = at === NO_TILE ? NO_TILE : demo.grid.indexOf(Math.min(demo.grid.width - 1, Math.max(0, demo.grid.xOf(at) + dx)), Math.min(demo.grid.height - 1, Math.max(0, demo.grid.yOf(at) + dy)));
    record(jumpStep(demo, destination, undefined, auto), since);
    answer();
  };
  const shove = (): number => {
    const since = demo.log.length;
    const id = demo.party.selected;
    const at = demo.state.entity(id ?? '')?.tile ?? NO_TILE;
    const spot = { x: demo.grid.xOf(at) + 5, y: demo.grid.yOf(at) };
    const ok = id !== null && at !== NO_TILE && demo.grid.isPassable(demo.grid.indexOf(spot.x, spot.y));
    if (ok) demo.state.placeEntity(id!, spot.x, spot.y);
    record({ step: 'shove', id, at: ok ? spot : null }, since);
    return at;
  };
  const door = demo.scene.spawns[0]!;
  const leap = (dx: number, dy: number, auto: boolean): void => {
    // Where the platform is, not where they are: a run-up when it is far.
    const since = demo.log.length;
    record(jumpStep(demo, demo.grid.indexOf(door.x + dx, door.y + dy), undefined, auto), since);
  };
  const cancel = (): void => {
    if (demo.pending === null) return;
    const since = demo.log.length;
    record({ step: 'answer', response: { kind: 'cancel' }, result: answerPending(demo, { kind: 'cancel' }) }, since);
  };
  const aim = (): void => {
    const since = demo.log.length;
    const aimed = jumpAim(demo);
    record({ step: 'jumpAim', result: aimed === null ? null : aimed.tiles }, since);
  };
  const next = (): void => {
    const since = demo.log.length;
    record({ step: 'select', selected: demo.party.selectNext(), moved: syncTalks(demo) }, since);
  };
  const gather = (): void => {
    // Everybody back to where they came in: the ones who do nothing in the fight are then by the flag.
    demo.scene.spawns.forEach((spawn) => {
      next();
      const since = demo.log.length;
      const destination = demo.grid.indexOf(spawn.x, spawn.y);
      record({ step: 'move', destination, aim: null, probed: false, result: moveSelectedTo(demo, destination) }, since);
    });
  };
  {
    // One fight a tour: a roll with Shadow hands the spotlight to the GM, whose turn is the next part's.
    gather();
    // Out of a fight: laid down and up again, then onto the platform - asked, asked again, let go, made.
    approach('trip-wire');
    move();
    aim();
    leap(6, 0, false);
    leap(3, 0, false);
    cancel();
    leap(6, 0, false);
    answer();
    leap(3, (round % 3) - 1, true);
    answer();
    // The fight: by landing on the platform's corner, or by the horn after a flag with no
    // fight to stop (and a flag marks the fight ended, which a trigger wakes no more).
    if (round % 2 === 0) {
      leap(6, 0, true);
      answer();
      leap(7, -1, false);
      answer();
    } else {
      approach('white-flag');
      approach('war-horn');
    }
    next();
    reach();
    // Put down past the platform, their circle drawn there, then sent back across it: the long way round,
    // which a fight allows as long as it stays inside the circle.
    {
      const id = demo.party.selected;
      const spot = { x: door.x + 8, y: door.y + (round % 3) - 1 };
      if (id !== null && demo.state.bodyFree(demo.grid.indexOf(spot.x, spot.y), id)) {
        demo.state.placeEntity(id, spot.x, spot.y);
        record({ step: 'shove', id, at: spot }, demo.log.length);
        move(demo.grid.indexOf(door.x + 4, spot.y));
        answer();
        next();
      }
    }
    // Each of them once in the fight: pushes out of the circle, and a jump.
    let letGo = false;
    for (let k = 0; k < 3; k++) {
      if (k === round % 3) jump(2, 0, false);
      else push();
      // The first push of some fights let go unrolled: nobody moves, and nobody has acted.
      if (!letGo && round < 3 && demo.pending !== null) {
        cancel();
        letGo = true;
      }
      answer();
      next();
    }
    // One put down outside their circle, pressed; then the last one waves the flag.
    const from = shove();
    reach(3);
    reach();
    // Sent back where they stood: inside the circle, however far the walk round.
    if (from !== NO_TILE) move(from);
    // Somebody who can still act, put down beside the flag to wave it.
    for (let k = 0; k < 6 && inCombat(demo) && !demo.encounter!.canAct(demo.party.selected ?? ''); k++) next();
    const id = demo.party.selected;
    const by = [[3, 2], [2, 2], [4, 2], [4, 1], [4, 0], [3, 0]].map(([dx, dy]) => ({ x: door.x + dx!, y: door.y + dy! }));
    const spot = by.find((s) => demo.grid.isPassable(demo.grid.indexOf(s.x, s.y)) && demo.state.bodyFree(demo.grid.indexOf(s.x, s.y), id ?? ''));
    if (inCombat(demo) && id !== null && spot !== undefined) {
      demo.state.placeEntity(id, spot.x, spot.y);
      record({ step: 'shove', id, at: spot }, demo.log.length);
    }
    approach('white-flag');
    // Stood down, and roused again: the flag's truce does not outlast the horn.
    if (!inCombat(demo)) approach('war-horn');
    next();
    move();
  }
  return { name, project, start, steps };
}

function golden() {
  const g = createRng('walk');
  const demo = buildDemoScene(hollowVaultMap(), 'walk');
  const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
  const projects: [string, ProjectDoc][] = [['the demo', clone(demo.project)], ['default', fallback], ['the drill yard', drillYard(fallback)], ['stiff legs', stiffLegs(drillYard(fallback))]];
  const sessions: ReturnType<typeof session>[] = [];
  projects.forEach(([name, project], at) => {
    for (let s = 0; s < [10, 10, 6, 4][at]!; s++) sessions.push(session(g, `${name} ${s}`, at, project, at === 3 ? 30 : 40));
  });
  for (let round = 0; round < 6; round++) sessions.push(tour(g, `the drill yard, toured ${round}`, 2, projects[2]![1], round));
  return {
    about: 'walking, for the Rust port; written by src/game/walk.golden.test.ts',
    shipped: {
      characters: contentJson(DEMO_CHARACTERS),
      adversaries: [...DEMO_ADVERSARIES.values()],
      abilities: STARTER_ABILITIES,
      conditions: [...STARTER_CONDITIONS, ...SRD_CONDITIONS],
      items: EQUIPMENT.items.map(({ id, name }) => ({ id, name })),
    },
    projects: projects.map(([, project]) => clone(project)),
    sessions,
  };
}

describe('walking, as the Rust server must walk', () => {
  it('is what server/fixtures/walk.json holds', () => {
    const now = clone(golden());
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  }, 300_000);
});
