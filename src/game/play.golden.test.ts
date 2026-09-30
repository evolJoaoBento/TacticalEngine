/**
 * The things in a room used, and its creatures talked to, as the Rust server must play them
 * (`docs/SERVER.md`, phase 2).
 *
 * Sessions of what a player does with the room's things out of a fight: the party gathered beside a
 * thing and the thing used (`useSelectedOn`) - out of reach, refused, run - its prompts answered as a
 * player might (`answerPending`), the conversation it opens had reply by reply, a creature on nobody's
 * side talked to (`talkNow`), a container's window read and taken from and shut, the selection moved so
 * a conversation is set aside and brought back (`syncTalks`), and travel - by a script's `goto`, a
 * portal, or the way the party walks between rooms. Each step's answer, and after it the prompt waiting,
 * where the party is sent, the window open, the conversations set aside, everybody's place and pools,
 * the log's new lines and what a view is handed (numbers over heads, motions, dice), the room's things
 * and the scenario. A session is cut where a fight would begin: the fight is the next part's.
 * `UPDATE_GOLDEN=1 npx vitest run src/game/play.golden.test.ts` writes `server/fixtures/play.json`;
 * `server/hooks/tests/golden_play.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE } from '../engine/grid/grid';
import { EQUIPMENT } from '../engine/content/equipment/catalogue';
import type { ContentPack } from '../engine/content/pack/import';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { migrateDocument } from '../engine/scene/migrate';
import { interactablesOf } from '../engine/scene/prop-functions';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { Response } from '../engine/script/runner';
import { scenarioSnapshot } from '../engine/script/world';
import { answerPending, buildDemoScene, buildProjectScene, gatherParty, useSelectedOn, type DemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { DEMO_ADVERSARIES, DEMO_CHARACTERS } from './demo-rules';
import { talkNow, talksTo } from './interaction';
import { closeContainer, containerContents, openContainer, takeFromContainer } from './prop-use';
import { travelTo } from './room';
import { shopOf } from './shop';
import { syncTalks, talkingAside } from './talks';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../server/fixtures/play.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

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

function pendingView(demo: DemoScene) {
  const p = demo.pending;
  if (p === null) return null;
  if (p.kind !== 'script') return { kind: p.kind };
  const d = p.dialogue;
  return {
    prompt: p.prompt,
    interactable: p.interactable,
    recorded: p.recorded,
    with: p.with ?? null,
    dialogue:
      d === null
        ? null
        : { id: d.id, recorded: d.recorded, by: d.by ?? null, spokenNode: d.spokenNode, prompt: d.prompt, view: d.view === null ? null : { node: d.view.node.id, options: d.view.options } },
  };
}

interface Marks {
  log: number;
  floaters: number;
  motions: number;
  rolls: number;
}

const marks = (demo: DemoScene): Marks => ({ log: demo.log.length, floaters: demo.floaters.length, motions: demo.motions.length, rolls: demo.rolls.length });

function view(demo: DemoScene, since: Marks) {
  const open = openContainer(demo);
  return clone({
    scene: demo.scene.id,
    pending: pendingView(demo),
    destination: demo.destination,
    open,
    contents: open === null || shopOf(demo, open) !== null ? null : containerContents(demo, open).map((l) => [l.item, l.name, l.count]),
    aside: talkingAside(demo),
    selected: demo.party.selected,
    held: demo.party.members().filter((id) => demo.party.isHeld(id)),
    entities: demo.state.allEntities().map((e) => [e.id, e.faction, e.tile, e.at.x, e.at.y, e.alive, e.hitPoints, e.stress, e.good ?? null, [...e.conditions]]),
    log: demo.log.slice(since.log),
    floaters: demo.floaters.slice(since.floaters),
    motions: demo.motions.slice(since.motions),
    rolls: demo.rolls.slice(since.rolls).map(({ who, what, roll }) => ({ who, what, roll })),
    things: demo.state.snapshot().interactables,
    scenario: scenarioSnapshot(demo.scenario),
  });
}

// --- Answers, as a player might give them ------------------------------------------------------------------

function answerFor(demo: DemoScene, g: Rng): Response {
  const p = demo.pending;
  if (p === null || p.kind !== 'script') return { kind: 'continue' };
  if (g.nextInt(20) === 0) return { kind: 'cancel' };
  const d = p.dialogue;
  const prompt = d === null ? p.prompt : d.prompt;
  if (d !== null && d.view !== null && d.prompt === null) {
    const enabled = d.view.options.filter((o) => o.enabled);
    if (d.view.options.length === 0) return { kind: 'continue' };
    // Now and then a locked reply, or one that is not there: refused, and asked again.
    if (g.nextInt(10) === 0) return { kind: 'choose', index: g.pick([...d.view.options.map((o) => o.index), 99]) };
    return enabled.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: g.pick(enabled).index };
  }
  if (prompt === null) return { kind: 'continue' };
  switch (prompt.kind) {
    case 'check':
      return { kind: 'roll', ...(g.nextInt(3) === 0 ? { advantage: 1 } : {}), ...(g.nextInt(4) === 0 ? { disadvantage: 1 } : {}) };
    case 'choice':
      return { kind: 'choose', index: g.pick(prompt.options).index };
    case 'rolled':
      return { kind: 'answered' };
    default:
      return { kind: 'continue' };
  }
}

// --- A session ---------------------------------------------------------------------------------------------

/** Where to stand to use a thing: its own tile, or where it covers, for the party to be gathered round. */
function tileOfThing(demo: DemoScene, id: string): number {
  const covers = demo.state.interactableCovers(id);
  if (covers.length > 0) return covers[0]!;
  const thing = interactablesOf(demo.scene).find((t) => t.id === id);
  return thing === undefined ? NO_TILE : demo.grid.indexOf(thing.position.x, thing.position.y);
}

function session(g: Rng, name: string, project: number, input: ProjectDoc, length: number) {
  const demo = buildProjectScene(projectSchema.parse(clone(input)), `play:${name}`);
  const start = view(demo, marks(demo));
  const steps: unknown[] = [];
  for (let n = 0; n < length; n++) {
    const since = marks(demo);
    const things = interactablesOf(demo.scene).map((t) => t.id);
    const talkers = demo.state.allEntities().filter((e) => talksTo(demo, e.id)).map((e) => e.id);
    // Mostly answering while something waits - though a player can walk off, or Tab away, or leave the room.
    const kind = g.pick(
      demo.pending !== null
        ? (['answer', 'answer', 'answer', 'answer', 'answer', 'use', 'select', 'pick', 'close', 'take', 'travel'] as const)
        : talkers.length > 0
          ? (['use', 'use', 'use', 'talk', 'talk', 'select', 'pick', 'pick', 'travel', 'take', 'close', 'answer'] as const)
          : (['use', 'use', 'use', 'use', 'select', 'pick', 'travel', 'take', 'close', 'answer'] as const),
    );
    let step: Record<string, unknown>;
    switch (kind) {
      case 'use': {
        const id = g.nextInt(12) === 0 ? 'nothing-here' : g.pick(things);
        // Gathered beside it, mostly; now and then from wherever they stand.
        const tile = g.nextInt(5) === 0 ? null : tileOfThing(demo, id);
        if (tile !== null && tile !== NO_TILE) gatherParty(demo, tile);
        step = { step: kind, id, gather: tile, result: useSelectedOn(demo, id) };
        break;
      }
      case 'answer': {
        const response = answerFor(demo, g);
        step = { step: kind, response, result: answerPending(demo, response) };
        break;
      }
      case 'talk': {
        const id = talkers.length === 0 ? 'nobody' : g.pick(talkers);
        const actor = demo.party.selected;
        const at = demo.state.entity(id)?.tile ?? NO_TILE;
        if (at !== NO_TILE) gatherParty(demo, at);
        step = { step: kind, id, actor, gather: at, result: actor === null ? null : talkNow(demo, actor, id) };
        break;
      }
      case 'select': {
        // Tab, and the conversations put where the selection says.
        const selected = demo.party.selectNext();
        step = { step: kind, selected, moved: syncTalks(demo) };
        break;
      }
      case 'pick': {
        // Somebody chosen by name - mostly one whose conversation is set aside - and the conversations moved.
        const aside = talkingAside(demo);
        const members = demo.party.members();
        const id = aside.length > 0 && g.nextInt(3) > 0 ? g.pick(aside) : members.length === 0 ? 'nobody' : g.pick(members);
        step = { step: kind, id, result: demo.party.select(id), moved: syncTalks(demo) };
        break;
      }
      case 'take': {
        const open = openContainer(demo);
        const lines = open === null || shopOf(demo, open) !== null ? [] : containerContents(demo, open);
        const item = lines.length === 0 ? 'nothing' : g.pick(lines).item;
        step = { step: kind, id: open, item, result: open === null || shopOf(demo, open) !== null ? null : takeFromContainer(demo, open, item) };
        break;
      }
      case 'close':
        closeContainer(demo);
        step = { step: kind };
        break;
      case 'travel': {
        const scene = g.pick(demo.project.scenes).id;
        step = { step: kind, scene, result: travelTo(demo, scene) };
        break;
      }
    }
    // A fight begins here, and the fight is the next part's: the session ends before this step.
    if (demo.encounter !== null) break;
    step['after'] = view(demo, since);
    steps.push(step);
  }
  return { name, project, start, steps };
}

/**
 * The default project with what its rooms never meet: a portal to another room and one with no partner, a
 * conversation nobody wrote, a script that sends the party away and then asks for a roll, a condition that
 * ends on the bearer's next roll and one that swells their Hit Points, loot named from the catalogue in a
 * project with no items of its own, and a party with no talent for anything.
 */
function provingGround(base: ProjectDoc): ProjectDoc {
  const project = clone(base);
  const [vault, pit] = project.scenes;
  const near = (scene: typeof vault, dx: number, dy: number) => ({ x: scene!.spawns[0]!.x + dx, y: scene!.spawns[0]!.y + dy });
  // Written as a document holds them; the schema reads them when the project is parsed below.
  type Deco = ProjectDoc['scenes'][number]['decos'][number];
  const prop = (id: string, at: { x: number; y: number }, fn: unknown): Deco => ({ id, model: 'crate', position: at, rotation: 0, function: fn }) as Deco;
  const script = (effects: unknown[], extra: object = {}) => ({ kind: 'script', effects, repeatable: true, ...extra });
  const catalogue = EQUIPMENT.items.slice(0, 3).map((item) => ({ item: item.id, quantity: { min: 2, max: 3 }, weight: 1 }));
  vault!.decos.push(
    prop('crossing-a', near(vault, 2, 0), { kind: 'portal', pair: 'crossing' }),
    prop('lonely-gate', near(vault, 3, 0), { kind: 'portal', pair: 'lonely' }),
    prop('silent-idol', near(vault, 4, 0), script([{ kind: 'startDialogue', dialogue: 'nobody-wrote-this' }])),
    prop('hasty-stair', near(vault, 2, 2), script([{ kind: 'goto', scene: pit!.id }], { check: { trait: 'finesse', difficulty: 10 } })),
    // Steadied, then a roll at once: the roll is what ends it.
    prop('steady-stone', near(vault, 3, 2), script([{ kind: 'applyCondition', condition: 'steady', target: { kind: 'actor' } }, { kind: 'applyCondition', condition: 'hale', target: { kind: 'actor' } }], { check: { trait: 'instinct', difficulty: 8 } })),
    prop('catalogue-chest', near(vault, 4, 2), script([{ kind: 'loot', table: 'catalogue-loot' }])),
  );
  pit!.decos.push(prop('crossing-b', near(pit, 1, 1), { kind: 'portal', pair: 'crossing' }));
  return projectSchema.parse({
    ...project,
    items: [],
    lootTables: [...project.lootTables, { id: 'catalogue-loot', rolls: 2, entries: catalogue }],
    conditionDefs: [
      ...project.conditionDefs,
      { id: 'steady', name: 'Steady', endsWhen: 'rolls' },
      { id: 'hale', name: 'Hale', modifiers: [{ stat: 'hitPoints', bonus: 2 }] },
    ],
    // Footnote in hand, so a roll that goes wrong can be answered.
    party: project.party.map((sheet) => ({
      ...sheet,
      traits: { agility: -2, strength: -2, finesse: -3, instinct: -2, presence: -2, knowledge: -2 },
      ...((sheet.domainCards ?? []).includes('footnote') ? { loadout: ['footnote', ...(sheet.loadout ?? []).filter((c) => c !== 'footnote')] } : {}),
    })),
  });
}

/**
 * The proving ground walked on purpose, each thing in turn, every prompt answered: the conversation nobody
 * wrote, the stone that steadies and then asks for a roll, loot named from the catalogue, the lonely gate,
 * the stair that sends the party away and then asks for a roll, and a portal to another room - there and
 * back, by the portal and by the door.
 */
function tour(g: Rng, name: string, project: number, input: ProjectDoc) {
  const demo = buildProjectScene(projectSchema.parse(clone(input)), `play:${name}`);
  const start = view(demo, marks(demo));
  const steps: unknown[] = [];
  const answerAll = (): void => {
    for (let k = 0; k < 6 && demo.pending !== null; k++) {
      const since = marks(demo);
      const response = answerFor(demo, g);
      steps.push({ step: 'answer', response, result: answerPending(demo, response), after: view(demo, since) });
    }
  };
  const use = (id: string): void => {
    const since = marks(demo);
    const tile = tileOfThing(demo, id);
    if (tile !== NO_TILE) gatherParty(demo, tile);
    steps.push({ step: 'use', id, gather: tile, result: useSelectedOn(demo, id), after: view(demo, since) });
    answerAll();
  };
  const travel = (scene: string): void => {
    const since = marks(demo);
    steps.push({ step: 'travel', scene, result: travelTo(demo, scene), after: view(demo, since) });
  };
  const [vault, pit] = demo.project.scenes;
  for (let round = 0; round < 3; round++) {
    for (const id of ['silent-idol', 'steady-stone', 'catalogue-chest', 'lonely-gate', 'steady-stone', 'hasty-stair']) {
      if (demo.scene.id !== vault!.id) travel(vault!.id);
      use(id);
    }
    if (demo.scene.id !== vault!.id) travel(vault!.id);
    use('crossing-a');
    if (demo.scene.id === pit!.id) use('crossing-b');
  }
  return { name, project, start, steps };
}

function golden() {
  const g = createRng('play');
  const demo = buildDemoScene(hollowVaultMap(), 'play');
  const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
  const projects: [string, ProjectDoc][] = [['the demo', clone(demo.project)], ['default', fallback], ['the proving ground', provingGround(fallback)]];
  const sessions: ReturnType<typeof session>[] = [];
  projects.forEach(([name, project], at) => {
    for (let s = 0; s < 8; s++) sessions.push(session(g, `${name} ${s}`, at, project, 40));
  });
  sessions.push(tour(g, 'the proving ground, toured', 2, projects[2]![1]));
  return {
    about: 'the things in a room used and its creatures talked to, for the Rust port; written by src/game/play.golden.test.ts',
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

describe('the things in a room, as the Rust server must use them', () => {
  it('is what server/fixtures/play.json holds', () => {
    const now = clone(golden());
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  }, 300_000);
});
