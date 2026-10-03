/**
 * The action bar, as the Rust server must run it (`docs/SERVER.md`, phase 2).
 *
 * Sessions of a party using its cards, in a fight and out of one: the bar as it stands for whoever is
 * selected (`abilityList` - what each card says, whether it can be used and why not, its uses, whom it may
 * be aimed at, its card), whom a card aimed at the ground would catch (`shapeAt`), and a card used
 * (`useAbility`) - on a pick that is there, one that is not, a tile, nothing - its roll answered or stepped
 * back from (the card put down again), tokens placed again when what refills them comes round
 * (`refillTokens`), and the fight going on around it: swings, the GM's turn, walks, the selection. After
 * each step its answer and everything `fight.golden.test.ts` records.
 * `UPDATE_GOLDEN=1 npx vitest run src/game/bar.golden.test.ts` writes `server/fixtures/bar.json`;
 * `server/hooks/tests/golden_bar.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../engine/core/rng';
import type { Spot } from '../engine/grid/grid';
import { EQUIPMENT } from '../engine/content/equipment/catalogue';
import type { ContentPack } from '../engine/content/pack/import';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { Response } from '../engine/script/runner';
import { scenarioSnapshot } from '../engine/script/world';
import type { RangeBand } from '../engine/rules/range';
import { answerPending, attackWithSelected, buildDemoScene, buildProjectScene, endTurn, moveSelectedTo, type DemoScene } from './demo-scene';
import { abilitiesOf, abilityList, pointTiles, refillTokens, shapeAt, useAbility } from './demo-abilities';
import { hollowVaultMap } from './demo-map';
import { DEMO_ADVERSARIES, DEMO_CHARACTERS } from './demo-rules';
import { startEncounter } from './movement';
import { inCombat } from './moment';
import { syncTalks } from './talks';
import { barWorkshop } from '../../tests/fixtures/bar-workshop';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../server/fixtures/bar.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

/** The content as the Rust reads it - the cards with their words, which the bar shows. */
function contentJson(pack: ContentPack) {
  return {
    weapons: [...pack.weapons.values()].map(({ id, name, tier, slot, trait, range, damage, burden, features }) => ({ id, name, tier, slot, trait, range, damage, burden, features })),
    armors: [...pack.armors.values()].map(({ id, name, tier, baseThresholds, baseScore, features }) => ({ id, name, tier, baseThresholds, baseScore, features })),
    classes: [...pack.classes.values()].map(({ id, name, domains, startingEvasion, startingHitPoints }) => ({ id, name, domains, startingEvasion, startingHitPoints })),
    ancestries: [...pack.ancestries.values()].map(({ id, name }) => ({ id, name })),
    communities: [...pack.communities.values()].map(({ id, name }) => ({ id, name })),
    subclasses: [...pack.subclasses.values()].map(({ id, name, classId, domains, spellcastTrait }) => ({ id, name, classId, domains, ...(spellcastTrait === undefined ? {} : { spellcastTrait }) })),
    cards: [...pack.cards.values()].map(({ id, name, grant, domain, type, level, recallCost, text, features }) => ({ id, name, grant, text, features, ...(domain === undefined ? {} : { domain }), ...(type === undefined ? {} : { type }), ...(level === undefined ? {} : { level }), ...(recallCost === undefined ? {} : { recallCost }) })),
  };
}

// --- What a step is seen as --------------------------------------------------------------------------------

function view(demo: DemoScene, since: number) {
  const e = demo.encounter;
  const circles = e === null ? [] : [...(e as unknown as { circles: Map<string, { anchor: Spot; band: RangeBand }> }).circles];
  const seen = clone({
    scene: demo.scene.id,
    fight: e === null ? null : { id: e.encounterId, view: e.view(), log: e.log, circles: circles.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, c]) => [id, c.anchor, c.band]) },
    pending: demo.pending === null ? null : demo.pending.kind === 'script' ? { prompt: demo.pending.prompt, dialogue: demo.pending.dialogue?.id ?? null } : { kind: demo.pending.kind, prompt: demo.pending.prompt },
    selected: demo.party.selected,
    bad: demo.state.bad,
    entities: demo.state.allEntities().map((x) => [x.id, x.faction, x.tile, x.at.x, x.at.y, x.alive, x.dead ?? null, x.hitPoints, x.stress, x.armorSlots, x.good ?? null, [...x.conditions], x.truce ?? null]),
    sheets: [...demo.sheets.values()].map((s) => [s.id, s.loadout ?? null]),
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

/** The bar as a view shows it. */
function barOf(demo: DemoScene, id: string | null) {
  if (id === null) return null;
  return abilityList(demo, id).map(({ ability, text, scripted, usable, reason, usesLeft, targets, card }) => ({ id: ability.id, text, scripted, usable, reason, usesLeft, targets, card }));
}

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
      // Now and then stepped back from: a card used puts itself down again.
      return g.nextInt(4) === 0 ? { kind: 'cancel' } : { kind: 'roll' };
    case 'choice':
      return { kind: 'choose', index: g.pick(prompt.options).index };
    case 'rolled':
      return { kind: 'answered' };
    default:
      return { kind: 'continue' };
  }
}

// --- A session ---------------------------------------------------------------------------------------------

const REFILLS = ['session', 'longRest', 'rest', 'scene'] as const;

function session(g: Rng, name: string, project: number, input: ProjectDoc, length: number, asks: boolean, toured = false) {
  const demo = buildProjectScene(projectSchema.parse(clone(input)), `bar:${name}`);
  demo.askDefender = asks;
  const start = view(demo, 0);
  const steps: unknown[] = [];
  if (toured) {
    // On purpose: the yard's fight, a mark that spends the action and leaves the spotlight, the bar of one
    // who has acted, of one with no Stress slot left, and of one beside somebody fallen - who is raised.
    const step = (made: Record<string, unknown>, since: number): void => {
      made['after'] = view(demo, since);
      steps.push(made);
    };
    let since = demo.log.length;
    startEncounter(demo, 'the-yard');
    step({ step: 'fight', id: 'the-yard' }, since);
    const first = demo.party.selected!;
    since = demo.log.length;
    abilityList(demo, first);
    step({ step: 'use', id: first, ability: 'kit-mark', targets: ['yard-1'], point: null, result: useAbility(demo, first, 'kit-mark', ['yard-1']) }, since);
    since = demo.log.length;
    step({ step: 'list', id: first, result: barOf(demo, first) }, since);
    // The one foe the mark left Vulnerable is the only one the finisher may pick: no pick given, it is taken.
    since = demo.log.length;
    abilityList(demo, first);
    step({ step: 'use', id: first, ability: 'kit-finish', targets: [], point: null, result: useAbility(demo, first, 'kit-finish', []) }, since);
    since = demo.log.length;
    const strained = demo.party.selectNext()!;
    step({ step: 'select', selected: strained, moved: syncTalks(demo) }, since);
    const body = demo.state.entity(strained)!;
    body.stress = { ...body.stress, marked: body.stress.max };
    since = demo.log.length;
    step({ step: 'strain', id: strained }, since);
    since = demo.log.length;
    step({ step: 'list', id: strained, result: barOf(demo, strained) }, since);
    const fallen = demo.party.members().find((m) => m !== first && m !== strained)!;
    const down = demo.state.entity(fallen)!;
    down.hitPoints = { ...down.hitPoints, marked: down.hitPoints.max };
    down.alive = false;
    since = demo.log.length;
    step({ step: 'fell', id: fallen }, since);
    since = demo.log.length;
    step({ step: 'list', id: strained, result: barOf(demo, strained) }, since);
    since = demo.log.length;
    const raiser = demo.party.members().find((m) => m !== first && m !== strained && m !== fallen)!;
    abilityList(demo, raiser);
    step({ step: 'use', id: raiser, ability: 'kit-raise', targets: [fallen], point: null, result: useAbility(demo, raiser, 'kit-raise', [fallen]) }, since);
  }
  const fights = demo.scene.encounters.filter((e) => e.adversaries.length > 0).map((e) => e.id);
  for (let n = 0; n < length; n++) {
    const since = demo.log.length;
    const fighting = inCombat(demo);
    const selected = demo.party.selected;
    const kinds = demo.pending !== null
      ? (['answer', 'answer', 'answer', 'list'] as const)
      : fighting
        ? (['use', 'use', 'use', 'use', 'list', 'shape', 'attack', 'endTurn', 'endTurn', 'select', 'select', 'move', 'refill'] as const)
        : (['use', 'use', 'use', 'list', 'shape', 'fight', 'select', 'move', 'refill'] as const);
    const kind = g.pick(kinds);
    let step: Record<string, unknown>;
    switch (kind) {
      case 'list':
        step = { step: kind, id: selected, result: barOf(demo, selected) };
        break;
      case 'use': {
        const mine = selected === null ? [] : abilitiesOf(demo, selected).filter((a) => a.kind === 'action');
        const ability = mine.length === 0 ? null : g.pick(mine);
        if (selected === null || ability === null) {
          step = { step: kind, id: selected, ability: null, result: null };
          break;
        }
        const listed = abilityList(demo, selected).find((v) => v.ability.id === ability.id);
        const valid = listed?.targets ?? [];
        // A pick that is there, nothing, or now and then one that is not.
        const roll = g.nextInt(6);
        const targets = roll === 0 ? [g.pick(demo.state.allEntities()).id] : roll === 1 || valid.length === 0 ? [] : [g.pick(valid)];
        const tiles = pointTiles(demo, selected, ability);
        const point = tiles.length === 0 ? undefined : g.nextInt(5) === 0 ? undefined : g.pick(tiles);
        step = { step: kind, id: selected, ability: ability.id, targets, point: point ?? null, result: useAbility(demo, selected, ability.id, targets, point === undefined ? {} : { point }) };
        break;
      }
      case 'shape': {
        const aimed = selected === null ? [] : abilitiesOf(demo, selected).filter((a) => a.target.kind === 'point');
        const ability = aimed.length === 0 ? null : g.pick(aimed);
        const tiles = ability === null || selected === null ? [] : pointTiles(demo, selected, ability);
        const tile = tiles.length === 0 ? null : g.pick(tiles);
        step = { step: kind, id: selected, ability: ability?.id ?? null, tile, result: ability === null || selected === null || tile === null ? null : shapeAt(demo, selected, ability, tile), tiles: tiles.length };
        break;
      }
      case 'refill': {
        const events = REFILLS.filter(() => g.nextInt(2) === 0);
        refillTokens(demo, events);
        step = { step: kind, events };
        break;
      }
      case 'fight': {
        const id = fights.length === 0 ? null : g.pick(fights);
        if (id !== null) startEncounter(demo, id);
        step = { step: kind, id };
        break;
      }
      case 'attack': {
        const foes = demo.state.allEntities().filter((x) => x.alive && x.faction === 'adversary').map((x) => x.id);
        const id = foes.length === 0 ? 'nobody' : g.pick(foes);
        step = { step: kind, id, result: attackWithSelected(demo, id) };
        break;
      }
      case 'endTurn':
        step = { step: kind, result: endTurn(demo) };
        break;
      case 'move': {
        const from = selected === null ? 0 : (demo.state.entity(selected)?.tile ?? 0);
        const x = Math.min(demo.grid.width - 1, Math.max(0, demo.grid.xOf(from) + g.nextInt(9) - 4));
        const y = Math.min(demo.grid.height - 1, Math.max(0, demo.grid.yOf(from) + g.nextInt(9) - 4));
        const destination = demo.grid.indexOf(x, y);
        step = { step: kind, destination, result: moveSelectedTo(demo, destination) };
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
    }
    step['after'] = view(demo, since);
    steps.push(step);
  }
  return { name, project, ...(asks ? { asks } : {}), start, steps };
}

function golden() {
  const g = createRng('bar');
  const demo = buildDemoScene(hollowVaultMap(), 'bar');
  const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
  const projects: [string, ProjectDoc][] = [['the demo', clone(demo.project)], ['default', fallback], ['the workshop', barWorkshop(fallback)]];
  const sessions: ReturnType<typeof session>[] = [];
  projects.forEach(([name, project], at) => {
    for (let s = 0; s < [4, 4, 8][at]!; s++) sessions.push(session(g, `${name} ${s}`, at, project, 60, s % 3 === 2));
  });
  for (let s = 0; s < 2; s++) sessions.push(session(g, `the workshop, toured ${s}`, 2, projects[2]![1], 30, false, true));
  return {
    about: 'the action bar, for the Rust port; written by src/game/bar.golden.test.ts',
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

describe('the action bar, for the Rust port', () => {
  it('matches server/fixtures/bar.json', () => {
    const written = golden();
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(written)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(clone(written));
  }, 300_000);
});
