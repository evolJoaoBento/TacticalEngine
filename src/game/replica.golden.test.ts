/**
 * A replica, as the Rust must stand one up (`docs/SERVER.md`, phase 3, slice 2).
 *
 * Sessions played at random - walks, swings, the GM's turn (a third of them with the defender asked, so a
 * question can wait mid-turn), cards on the bar, fights begun and routed, questions answered, members linked,
 * unlinked and moved in the order, a conversation set aside, loadouts changed at a rest - and after every step how the game stands as a replica is told it (`replicaOf`), and what the
 * pointer asks answered against the game itself: the ground a walk reaches and where a push would ask a roll
 * (`reachableTiles`, `underPressureTiles`), the line a click would walk (`previewWalk`), for each card in the
 * selected member's hand whom it may be aimed at, where one aimed at the ground may land and whom it would
 * catch there (`abilityTargets`, `pointTiles`, `shapeAt`), and where a jump goes (`jumpOffered`, `jumpAim`,
 * `jumpReaches`). `UPDATE_GOLDEN=1 npx vitest run src/game/replica.golden.test.ts` writes
 * `server/fixtures/replica.json`; `server/hooks/tests/golden_replica.rs` stands each step up in a fresh Rust
 * session and asks it the same.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE, type Spot } from '../engine/grid/grid';
import { EQUIPMENT } from '../engine/content/equipment/catalogue';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { Response } from '../engine/script/runner';
import { answerPending, attackWithSelected, buildDemoScene, buildProjectScene, endTurn, moveSelectedTo, type DemoScene } from './demo-scene';
import { abilitiesOf, abilityTargets, pointTiles, rest, shapeAt, useAbility } from './demo-abilities';
import { dropCard } from './party-drop';
import { talkTo } from './interaction';
import { jumpAim, jumpOffered, jumpReaches, previewWalk, reachableTiles, startEncounter, underPressureTiles } from './movement';
import { hollowVaultMap } from './demo-map';
import { DEMO_ADVERSARIES, DEMO_CHARACTERS } from './demo-rules';
import { inCombat } from './moment';
import { travelTo } from './room';
import { syncTalks } from './talks';
import { replicaOf } from './replica';
import { contentJson } from './shipped';
import { barWorkshop } from '../../tests/fixtures/bar-workshop';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../server/fixtures/replica.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;
const num = (n: number): number | null => (Number.isFinite(n) ? n : null);
const round = (n: number): number => Math.round(n * 1000) / 1000;

function answerFor(demo: DemoScene, g: Rng): Response {
  const p = demo.pending;
  if (p === null) return { kind: 'continue' };
  if (p.kind !== 'script') {
    const options = p.prompt.kind === 'choice' ? p.prompt.options : [];
    return options.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: g.pick(options).index };
  }
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

/** A tile near whoever is selected, now and then anywhere on the map. */
function near(demo: DemoScene, g: Rng): number {
  const selected = demo.party.selected;
  const at = selected === null ? NO_TILE : (demo.state.entity(selected)?.tile ?? NO_TILE);
  if (at !== NO_TILE && g.nextInt(4) > 0) {
    const x = Math.min(demo.grid.width - 1, Math.max(0, demo.grid.xOf(at) + g.nextInt(13) - 6));
    const y = Math.min(demo.grid.height - 1, Math.max(0, demo.grid.yOf(at) + g.nextInt(13) - 6));
    return demo.grid.indexOf(x, y);
  }
  return g.nextInt(demo.grid.size);
}

const spotIn = (demo: DemoScene, g: Rng, tile: number): Spot => ({ x: round(demo.grid.xOf(tile) + (g.next() - 0.5) * 0.9), y: round(demo.grid.yOf(tile) + (g.next() - 0.5) * 0.9) });

/** One thing done in the game, as the dice fall - in the yard, mostly the turn passed, and never a rout. */
function act(demo: DemoScene, g: Rng, yard = false): void {
  if (demo.pending !== null) {
    answerPending(demo, answerFor(demo, g));
    return;
  }
  const selected = demo.party.selected;
  const fighting = inCombat(demo);
  const kind = g.pick(fighting
    ? yard
      ? (['endTurn', 'endTurn', 'endTurn', 'select', 'move'] as const)
      : (['move', 'move', 'attack', 'attack', 'endTurn', 'select', 'use', 'use', 'party', 'rout'] as const)
    : (['move', 'move', 'move', 'select', 'fight', 'use', 'party', 'talk', 'loadout', 'travel'] as const));
  const members = demo.party.members();
  switch (kind) {
    case 'move': {
      const tile = near(demo, g);
      moveSelectedTo(demo, tile, g.nextInt(2) === 0 ? spotIn(demo, g, tile) : undefined);
      return;
    }
    case 'attack': {
      const foes = demo.state.entitiesOf('adversary').filter((e) => e.alive).map((e) => e.id);
      if (foes.length > 0) attackWithSelected(demo, g.pick(foes));
      return;
    }
    case 'endTurn':
      endTurn(demo);
      return;
    case 'travel': {
      // To another room and, later, back: the rooms left behind are the replica's too.
      const others = demo.project.scenes.map((s) => s.id).filter((id) => id !== demo.scene.id);
      if (others.length > 0) travelTo(demo, g.pick(others));
      return;
    }
    case 'select':
      demo.party.selectNext();
      syncTalks(demo);
      return;
    case 'fight': {
      const fights = demo.scene.encounters.filter((e) => e.adversaries.length > 0 && e.adversaries.every((a) => a.interaction === undefined)).map((e) => e.id);
      if (fights.length > 0) startEncounter(demo, g.pick(fights));
      return;
    }
    case 'party': {
      // Linked, unlinked, or moved in the order, as the HUD's portraits are dragged.
      if (members.length < 2) return;
      const [a, b] = g.shuffle([...members]) as [string, string];
      const pick = g.nextInt(4);
      if (pick === 0) demo.party.link(a, b);
      else if (pick === 1) demo.party.unlink(a);
      else dropCard(demo.party, a, pick === 2 ? { kind: 'between', above: b, below: null } : { kind: 'aside' });
      return;
    }
    case 'talk': {
      // Somebody to talk to, talked to, and the next selected: the conversation is set aside, its speaker held.
      const talkers = demo.scene.encounters.flatMap((e) => e.adversaries).filter((a) => a.interaction?.dialogue !== undefined).map((a) => a.id).filter((id) => demo.state.entity(id)?.alive === true);
      if (selected === null || talkers.length === 0) return;
      talkTo(demo, selected, g.pick(talkers));
      demo.party.selectNext();
      syncTalks(demo);
      return;
    }
    case 'loadout': {
      // A loadout changed at a rest: the sheet the replica is sent is not the one the project wrote.
      const who = g.pick(members);
      const held = demo.characters.get(who)?.cards.map((c) => c.id) ?? [];
      if (held.length === 0) return;
      rest(demo, 'short', { moves: {}, loadouts: { [who]: g.shuffle([...held]).slice(0, 1 + g.nextInt(held.length)) } });
      return;
    }
    case 'rout': {
      // Every foe down at once, and the turn passed: the fight is won, and over.
      for (const foe of demo.state.entitiesOf('adversary')) {
        foe.hitPoints = { ...foe.hitPoints, marked: foe.hitPoints.max };
        foe.alive = false;
      }
      endTurn(demo);
      return;
    }
    case 'use': {
      if (selected === null) return;
      const mine = abilitiesOf(demo, selected).filter((a) => a.kind === 'action');
      if (mine.length === 0) return;
      const ability = g.pick(mine);
      const tiles = pointTiles(demo, selected, ability);
      if (tiles.length > 0) {
        useAbility(demo, selected, ability.id, [], { point: g.pick(tiles) });
        return;
      }
      const valid = abilityTargets(demo, selected, ability);
      useAbility(demo, selected, ability.id, valid.length === 0 ? [] : [g.pick(valid)]);
      return;
    }
  }
}

/** What the pointer asks, answered by the game itself. */
function questions(demo: DemoScene, g: Rng) {
  const selected = demo.party.selected;
  const field = reachableTiles(demo);
  const tiles = field.tiles();
  const reach = { start: field.start, budget: num(field.budget), tiles, cost: tiles.map((t) => num(field.costTo(t))) };
  const pressure = underPressureTiles(demo);
  const previews = [0, 1, 2].map(() => {
    const destination = near(demo, g);
    const aim = spotIn(demo, g, destination);
    return { destination, aim, result: clone(previewWalk(demo, destination, aim)) };
  });
  const cards = selected === null
    ? []
    : abilitiesOf(demo, selected)
        .filter((ability) => ability.kind === 'action')
        .map((ability) => {
          const targets = abilityTargets(demo, selected, ability);
          const landing = pointTiles(demo, selected, ability);
          const shapes = landing.length === 0 ? [] : [g.pick(landing), g.pick(landing)].map((tile) => ({ tile, caught: shapeAt(demo, selected, ability, tile) }));
          return { id: selected, ability: ability.id, targets, tiles: landing, shapes };
        });
  const jump = {
    offered: jumpOffered(demo),
    aim: jumpAim(demo)?.tiles ?? null,
    reaches: selected === null
      ? []
      : [0, 1, 2].map(() => {
          const destination = near(demo, g);
          const aim = g.nextInt(2) === 0 ? spotIn(demo, g, destination) : null;
          return { destination, aim, result: jumpReaches(demo, selected, destination, aim ?? undefined) };
        }),
  };
  return { reach, pressure, previews, cards, jump };
}

function session(g: Rng, name: string, project: number, input: ProjectDoc, length: number, asks: boolean, yard = false) {
  const demo = buildProjectScene(projectSchema.parse(clone(input)), `replica:${name}`);
  demo.askDefender = asks;
  const steps: unknown[] = [];
  for (let n = 0; n < length; n++) {
    // The yard's knot of foes by the door swings at once: the GM's turn stops on the defender, a creature
    // already spotlighted - what a replica is told of a turn half played.
    if (n === 1 && yard) startEncounter(demo, 'the-yard');
    else if (n > 0) act(demo, g, yard);
    const replica = clone(replicaOf(demo));
    steps.push({ replica, asks: clone(questions(demo, g)) });
  }
  return { name, project, steps };
}

function golden() {
  const g = createRng('replica');
  const demo = buildDemoScene(hollowVaultMap(), 'replica');
  const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
  const projects: [string, ProjectDoc][] = [['the demo', clone(demo.project)], ['default', fallback], ['the workshop', barWorkshop(fallback)]];
  const sessions: ReturnType<typeof session>[] = [];
  projects.forEach(([name, project], at) => {
    for (let s = 0; s < [3, 3, 6][at]!; s++) sessions.push(session(g, `${name} ${s}`, at, project, 40, s % 3 === 1));
  });
  for (let s = 0; s < 2; s++) sessions.push(session(g, `the yard ${s}`, 2, projects[2]![1], 40, true, true));
  return {
    about: 'how the game stands after every step, as a replica is told it, and what the pointer asks; written by src/game/replica.golden.test.ts',
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

describe('a replica, for the Rust port', () => {
  it('matches server/fixtures/replica.json', () => {
    const written = golden();
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(written)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(clone(written));
  }, 300_000);
});
