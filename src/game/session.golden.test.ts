/**
 * A game played from a project, as the Rust server must play it (`docs/SERVER.md`, phase 2).
 *
 * `buildProjectScene` stands a game up from a project; then sessions of what happens to one between the
 * actions a player takes: travel between rooms and back to one remembered, a sheet added to the project
 * and the roster brought into step, one taken away, a sheet written back and the pools fitted to it,
 * wounds, the party gathered round a tile, a room left and entered again from a save, the world rebuilt,
 * lines written to the log with the names in them found. After each, the room, everybody in it, the
 * party, the rooms remembered, the log's new lines, the world's content and the scenario. The projects
 * are the demo's, the default project, and the default project carrying a stat block, a condition and a
 * step height of its own. What the app ships is written once, as the Rust is handed it.
 * `UPDATE_GOLDEN=1 npx vitest run src/game/session.golden.test.ts` writes `server/fixtures/session.json`;
 * `server/engine/tests/golden_session.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE } from '../engine/grid/grid';
import type { ContentPack } from '../engine/content/pack/import';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import { scenarioSnapshot } from '../engine/script/world';
import { buildDemoScene, buildProjectScene, gatherParty, setSheet, syncPools, syncRoster, refreshWorld, type DemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { DEMO_ADVERSARIES, DEMO_CHARACTERS } from './demo-rules';
import { enterSavedScene, syncAuthoredEncounters, travelTo } from './room';
import { nameOf, note } from './log';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../server/fixtures/session.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;
const num = (value: number): number | null => (Number.isFinite(value) ? value : null);

/** The content as the Rust reads it, each list in its map's order - as `runner.golden.test.ts` writes it. */
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

// --- What a session is seen as -----------------------------------------------------------------------------

/** What the world was built to read, off the world itself. */
function contentView(demo: DemoScene) {
  const w = demo.world as unknown as {
    traits: Record<string, number>; characters: Map<string, { evasion: number; armorScore: number; hitPoints: number; stress: number }>; adversaries: Map<string, { name: string; hitPoints: number }>; conditionDefs: Map<string, { name: string }>; bandTiles?: object;
    abilities: { id: string }[]; cards: (() => ContentPack['cards']) | null; movement?: { maxStepHeight: number; diagonals: boolean; diagonalCostMultiplier: number };
  };
  return {
    traits: { ...w.traits },
    // The world's own copy of each sheet: the TypeScript's reads the game's, live.
    characters: [...w.characters].map(([id, c]) => [id, c.evasion, c.armorScore, c.hitPoints, c.stress]),
    adversaries: [...w.adversaries].map(([id, a]) => [id, a.name, a.hitPoints]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)),
    bandTiles: w.bandTiles ?? null,
    conditions: [...w.conditionDefs].map(([id, def]) => [id, def.name]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)),
    abilities: w.abilities.map((a) => a.id),
    cards: w.cards === null ? null : [...w.cards().keys()],
    movement: w.movement === undefined ? null : { maxStepHeight: num(w.movement.maxStepHeight), diagonals: w.movement.diagonals, diagonalCostMultiplier: w.movement.diagonalCostMultiplier },
  };
}

/**
 * The world's content as last written: a view whose content has not changed since says `same`, which is
 * most of them, and the Rust holds its own unchanged in turn.
 */
let lastContent = '';

function contentOnce(demo: DemoScene): unknown {
  const content = contentView(demo);
  const text = JSON.stringify(content);
  if (text === lastContent) return 'same';
  lastContent = text;
  return content;
}

function view(demo: DemoScene, since: number) {
  // Copied whole, now: the game goes on changing the pools, the lists and the maps this reads.
  return clone({
    scene: demo.scene.id,
    entities: demo.state.allEntities().map((e) => [e.id, e.faction, e.definition, e.tile, e.at.x, e.at.y, e.alive, e.hitPoints, e.stress, e.armorSlots, e.good ?? null, e.name ?? null]),
    selected: demo.party.selected,
    reach: (demo.party as unknown as { options: { combatReach: number } }).options.combatReach,
    members: demo.party.members(),
    derived: [...demo.characters.values()].map((c) => [c.sheet.id, c.evasion, c.hitPoints, c.stress, c.armorScore, c.proficiency]),
    sheets: [...demo.sheets.keys()],
    // The project's own copy of each sheet, which a sheet written back rewrites.
    party: demo.project.party.map((s) => [s.id, s.armorId ?? null, s.traits.agility, s.traits.strength]),
    snapshots: [...demo.snapshots.keys()],
    synced: [...demo.syncedPlacements].map(([scene, ids]) => [scene, [...ids]]),
    triggers: [...(demo.triggers as unknown as { byTile: Map<number, string> }).byTile].sort((a, b) => a[0] - b[0]),
    bad: { ...demo.state.bad },
    log: clone(demo.log.slice(since)),
    content: contentOnce(demo),
    scenario: scenarioSnapshot(demo.scenario),
  });
}

// --- A session ---------------------------------------------------------------------------------------------

// Two that overlap and sort apart by UTF-16 length and by bytes: 'Ünïcø Bo' is 8 units and 12 bytes, 'Bo Rin Ek' 9 of each.
const NAMES = ['Ann', 'Ünïcødé Ann', 'Bo', 'Bo Rin', 'Zed of the Fen', 'Mira', 'Ünïcø Bo', 'Bo Rin Ek'];
const ARMOURS = ['armor-leather-armor', 'armor-chainmail-armor', 'armor-gambeson-armor', 'nobody-made-this'];

function session(g: Rng, name: string, project: number, input: ProjectDoc, length: number) {
  const demo = buildProjectScene(projectSchema.parse(clone(input)), `session:${name}`);
  lastContent = '';
  const start = view(demo, 0);
  const ops: unknown[] = [];
  let joined = 0;
  const saves: { scene: string; snapshot: unknown }[] = [];
  for (let n = 0; n < length; n++) {
    const since = demo.log.length;
    const kind = g.pick(['travel', 'travel', 'join', 'join', 'leave', 'setSheet', 'wound', 'gather', 'gather', 'save', 'load', 'refresh', 'note', 'select', 'place', 'edit', 'edit', 'disband', 'overlap'] as const);
    const members = demo.state.entitiesOf('party');
    let op: Record<string, unknown>;
    switch (kind) {
      case 'travel': {
        const scene = g.nextInt(6) === 0 ? 'nowhere' : g.pick(demo.project.scenes).id;
        op = { op: kind, scene, result: travelTo(demo, scene) };
        break;
      }
      case 'join': {
        const template = g.pick(demo.project.party.length > 0 ? demo.project.party : input.party);
        const sheet = characterSheetSchema.parse({ ...clone(template), id: `joiner-${joined++}`, name: g.pick(NAMES) });
        demo.project.party.push(sheet);
        op = { op: kind, sheet: clone(sheet), result: syncRoster(demo) };
        break;
      }
      case 'leave': {
        if (demo.project.party.length === 0) {
          op = { op: 'leave', index: -1, result: syncRoster(demo) };
          break;
        }
        const index = g.nextInt(demo.project.party.length);
        demo.project.party.splice(index, 1);
        op = { op: kind, index, result: syncRoster(demo) };
        break;
      }
      case 'setSheet': {
        if (demo.sheets.size === 0) {
          op = { op: 'refresh' };
          refreshWorld(demo);
          break;
        }
        const was = g.pick([...demo.sheets.values()]);
        // Every Armor Slot marked first, so armour worn smaller has marks to lose.
        const standing = demo.state.entity(was.id);
        if (standing !== undefined) standing.armorSlots.marked = standing.armorSlots.max;
        const sheet = { ...clone(was), armorId: g.pick(ARMOURS), traits: { ...was.traits, agility: g.nextInt(4) - 1, strength: g.nextInt(4) - 1 } };
        setSheet(demo, sheet);
        syncPools(demo);
        op = { op: kind, sheet: clone(sheet), marked: standing?.id ?? null };
        break;
      }
      case 'wound': {
        const who = members.length === 0 ? null : g.pick(members);
        if (who !== null) {
          who.hitPoints.marked = Math.min(who.hitPoints.max, g.nextInt(4));
          who.stress.marked = Math.min(who.stress.max, g.nextInt(3));
          who.armorSlots.marked = Math.min(who.armorSlots.max, g.nextInt(4));
          demo.state.bad.value = Math.min(demo.state.bad.max, g.nextInt(5));
        }
        op = { op: kind, id: who?.id ?? null, hitPoints: who?.hitPoints.marked ?? 0, stress: who?.stress.marked ?? 0, armorSlots: who?.armorSlots.marked ?? 0, bad: demo.state.bad.value };
        break;
      }
      case 'gather': {
        // On whoever is selected, now and then: their own tile is free to them.
        const selected = demo.state.entity(demo.party.selected ?? '');
        // Or deep in a wall, where the search has nowhere to go but through it - which it must not.
        const walled: number[] = [];
        for (let tile = 0; tile < demo.grid.size; tile++) {
          let shut = !demo.grid.isPassable(tile);
          demo.grid.forEachNeighbor(tile, false, (next) => {
            if (demo.grid.isPassable(next)) shut = false;
          });
          if (shut) walled.push(tile);
        }
        const tile = g.nextInt(8) === 0 ? NO_TILE : selected !== undefined && g.nextInt(3) === 0 ? selected.tile : walled.length > 0 && g.nextInt(3) === 0 ? g.pick(walled) : g.nextInt(demo.grid.size);
        gatherParty(demo, tile);
        op = { op: kind, tile };
        break;
      }
      case 'save':
        saves.push({ scene: demo.scene.id, snapshot: clone(demo.state.snapshot()) });
        op = { op: kind };
        break;
      case 'load': {
        const save = saves.length === 0 ? null : g.pick(saves);
        if (save === null) {
          op = { op: 'refresh' };
          refreshWorld(demo);
          break;
        }
        op = { op: kind, scene: save.scene, snapshot: save.snapshot, result: enterSavedScene(demo, save.scene, clone(save.snapshot) as never) };
        break;
      }
      case 'disband': {
        // Everybody taken out of the project, and somebody back in: the one who arrives to nobody is selected.
        // Half the time nobody comes back until later: a room entered with nobody in it has nobody selected.
        demo.project.party.splice(0, demo.project.party.length);
        const gone = syncRoster(demo);
        if (g.nextInt(2) === 0) {
          op = { op: kind, sheet: null, result: [gone, null] };
          break;
        }
        const sheet = characterSheetSchema.parse({ ...clone(input.party[0]!), id: `joiner-${joined++}`, name: g.pick(NAMES) });
        demo.project.party.push(sheet);
        op = { op: kind, sheet: clone(sheet), result: [gone, syncRoster(demo)] };
        break;
      }
      case 'edit': {
        // Back from the editor: a creature renamed, dropped or added, a trigger moved - the room made to agree.
        const encounters = demo.scene.encounters;
        const placed = encounters.flatMap((e) => e.adversaries);
        const how = g.pick(['rename', 'drop', 'add', 'trigger'] as const);
        if (how === 'rename' && placed.length > 0) {
          const one = g.pick(placed);
          const name = g.pick([null, 'Gorm', 'Ünïcø Bo']);
          if (name === null) delete one.name;
          else one.name = name;
        } else if (how === 'drop' && placed.length > 0) {
          const from = g.pick(encounters.filter((e) => e.adversaries.length > 0));
          from.adversaries.splice(g.nextInt(from.adversaries.length), 1);
        } else if (how === 'add' && encounters.length > 0) {
          g.pick(encounters).adversaries.push({ id: `added-${n}`, adversary: g.pick(['hollow-knight', 'rot-hound']), position: { x: g.nextInt(demo.grid.width + 2), y: g.nextInt(demo.grid.height) } });
        } else if (how === 'trigger' && encounters.length > 0) {
          g.pick(encounters).triggerCells = Array.from({ length: g.nextInt(4) }, () => ({ x: g.nextInt(demo.grid.width), y: g.nextInt(demo.grid.height) }));
        }
        syncAuthoredEncounters(demo);
        op = { op: kind, how, encounters: clone(encounters) };
        break;
      }
      case 'refresh':
        refreshWorld(demo);
        op = { op: kind };
        break;
      case 'note': {
        const everybody = demo.state.allEntities();
        const words = Array.from({ length: 1 + g.nextInt(3) }, () => (everybody.length > 0 && g.nextInt(3) > 0 ? nameOf(demo, g.pick(everybody).id) + g.pick(['', 's', ' ', '!']) : g.pick(['strikes', 'the', 'Annex', 'and', 'Bo-Rin', 'Ünïcø Bo Rin Ek'])));
        const text = words.join(g.pick([' ', ' and ', ', ']));
        const tone = g.pick(['system', 'narration', 'combat']);
        note(demo, text, tone as never);
        op = { op: kind, text, tone };
        break;
      }
      case 'select':
        op = { op: kind, result: demo.party.selectNext() };
        break;
      case 'overlap': {
        // Two names that overlap in a line, and sort apart by UTF-16 length and by bytes.
        const two = [...demo.sheets.values()].slice(0, 2);
        const renamed = two.map((sheet, i) => ({ ...clone(sheet), name: i === 0 ? 'Ünïcø Bo' : 'Bo Rin Ek' }));
        for (const sheet of renamed) setSheet(demo, sheet);
        note(demo, 'Ünïcø Bo Rin Ek', 'narration');
        op = { op: kind, sheets: clone(renamed) };
        break;
      }
      case 'place': {
        const who = members.length === 0 ? null : g.pick(members);
        const tile = who === null ? NO_TILE : who.tile;
        const at = tile === NO_TILE ? null : { x: Math.round((demo.grid.xOf(tile) + (g.next() - 0.5) * 0.8) * 20) / 20, y: Math.round((demo.grid.yOf(tile) + (g.next() - 0.5) * 0.8) * 20) / 20 };
        if (who !== null && at !== null) demo.state.placeEntity(who.id, at.x, at.y);
        op = { op: kind, id: who?.id ?? null, at };
        break;
      }
    }
    op['after'] = view(demo, since);
    ops.push(op);
  }
  return { name, project, start, ops };
}

function golden() {
  const g = createRng('session');
  const demo = buildDemoScene(hollowVaultMap(), 'session');
  const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
  // The default project carrying a stat block, a condition and a step height of its own.
  const knight = DEMO_ADVERSARIES.get('hollow-knight')!;
  const carrying = projectSchema.parse({
    ...clone(fallback),
    adversaries: [...clone(fallback.adversaries), { ...clone(knight), name: 'The Rusted Knight', hitPoints: 9, stress: 2 }],
    conditionDefs: [{ ...clone(SRD_CONDITIONS[0]!), name: 'Held Fast' }],
    jump: { stepHeight: 0.35 },
    // And an object as rooms held them before props could be used, for the game to make a prop of.
    scenes: clone(fallback.scenes).map((scene, i) => (i === 0 ? { ...scene, interactables: [{ id: 'old-chest', kind: 'chest', position: { x: scene.spawns[0]!.x + 1, y: scene.spawns[0]!.y }, effects: [{ kind: 'giveKey', key: 'brass-key' }] }] } : scene)),
  });
  const projects: [string, ProjectDoc][] = [['the demo', clone(demo.project)], ['default', fallback], ['default, carrying its own', carrying]];
  const sessions: ReturnType<typeof session>[] = [];
  projects.forEach(([name, project], at) => {
    for (let s = 0; s < 5; s++) sessions.push(session(g, `${name} ${s}`, at, project, 40));
  });
  return {
    about: 'a game played from a project for the Rust port; written by src/game/session.golden.test.ts',
    shipped: {
      characters: contentJson(DEMO_CHARACTERS),
      adversaries: [...DEMO_ADVERSARIES.values()],
      abilities: STARTER_ABILITIES,
      conditions: [...STARTER_CONDITIONS, ...SRD_CONDITIONS],
    },
    // Each once: a session names the one it was played from.
    projects: projects.map(([, project]) => clone(project)),
    sessions,
  };
}

describe('a game, as the Rust server must play it', () => {
  it('is what server/fixtures/session.json holds', () => {
    const now = clone(golden());
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  }, 300_000);
});
