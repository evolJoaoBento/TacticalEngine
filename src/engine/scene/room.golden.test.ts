/**
 * A room stood up from its document, as the Rust server must stand it up (`docs/SERVER.md`, phase 2).
 *
 * Each room here is built as the game builds one: the palette and structures a project declares
 * (`paletteForProject`), the grid (`gridFromScene`, with the building layer and the solid props), the
 * play state (`sceneStateFromScene`: the things that stand in the way, every encounter's creatures,
 * the party on the spawns), the things that can be used (`interactablesOf`) and the ground that wakes an
 * encounter (`TriggerIndex`). The rooms are the default project's and the demo's, the captured
 * version-1 project's with its objects as they were and made props, and rooms written here from a seed,
 * with every part a room can have in every state worth reading. Then rooms grown and snapshots
 * restored across the growth; prop functions turned into the objects they play as; portals paired;
 * and a use refused, or what it would run. `UPDATE_GOLDEN=1 npx vitest run
 * src/engine/scene/room.golden.test.ts` writes `server/fixtures/room.json`;
 * `server/engine/tests/golden_room.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../core/rng';
import { NO_TILE, type TileGrid } from '../grid/grid';
import { createBad, type Currency } from '../rules/resources';
import { buildDemoScene } from '../../game/demo-scene';
import { hollowVaultMap } from '../../game/demo-map';
import { DEMO_ADVERSARIES } from '../../game/demo-rules';
import { pieceProfile, structureTypes, buildingKey } from './building';
import { decoCentre, decoCovers, decoFootprint } from './deco-span';
import { gridFromScene, paletteForProject } from './grid-from-scene';
import { openingEffects, useInteractable } from './interact';
import { migrateDocument } from './migrate';
import { propFunctionSchema, type PropFunction, type PropFunctionKind } from './prop-function-schema';
import { containerItems, definitionOf, findFunction, FUNCTION_KINDS, interactablesOf, objectOfProp, objectsToProps, pairsOf, pairTaken, portalPartner, portalsWith, stepsOf } from './prop-functions';
import { growthToReach, grownScene, shiftSnapshot, MAX_GROWN, type Reach } from './reshape';
import { projectSchema, sceneSchema, type Interactable, type ProjectDoc, type SceneDoc } from './schema';
import { createPartyEntity, placementsOf, SceneState, sceneStateFromScene, type EntityState } from './state';
import { TriggerIndex } from './triggers';
import type { ScriptWorld } from '../script/runner';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../../server/fixtures/room.json');
const repo = (path: string): unknown => JSON.parse(readFileSync(resolve(here, '../../..', path), 'utf8'));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;
const num = (value: number): number | null => (Number.isFinite(value) ? value : null);

type Project = Pick<ProjectDoc, 'terrainPalette' | 'structureTypes'>;
type Stats = [string, { hitPoints: number; stress: number }][];
interface Member {
  id: string;
  definition: string;
  hitPoints: number;
  stress: number;
  armorSlots: number;
}

// --- A room built ------------------------------------------------------------------------------------

function specOf(grid: TileGrid) {
  return {
    width: grid.width,
    height: grid.height,
    origin: { ...grid.origin },
    palette: grid.palette.types.map((t) => ({ id: t.id, name: t.name, passable: t.passable, cost: num(t.cost), providesCover: t.providesCover, blocksSight: t.blocksSight, structure: t.structure ?? null })),
    heights: [...grid.heights],
    terrain: [...grid.terrain],
    overlay: [...grid.overlay],
    lift: [...grid.lift],
    barred: [...grid.barred],
  };
}

/** What a snapshot does not hold: where each thing stands and what it covers, and what stands in the way. */
function layoutOf(state: SceneState) {
  const s = state as unknown as { blockingInteractables: Set<number>; interactableTiles: Map<string, number>; interactableFootprints: Map<string, number[]>; passableWhenOpen: Set<string> };
  return {
    blocking: [...s.blockingInteractables].sort((a, b) => a - b),
    tiles: Object.fromEntries(s.interactableTiles),
    footprints: Object.fromEntries(s.interactableFootprints),
    doors: [...s.passableWhenOpen].sort(),
  };
}

/** As much of a project as standing a room up reads: its ground and its structures. */
const partOf = (project: Project): Project => clone({
  ...(project.terrainPalette === undefined ? {} : { terrainPalette: project.terrainPalette }),
  ...(project.structureTypes === undefined ? {} : { structureTypes: project.structureTypes }),
});

const partyOf = (members: readonly Member[]): EntityState[] =>
  members.map((m) => createPartyEntity(m.id, m.definition, NO_TILE, { hitPoints: m.hitPoints, stress: m.stress, armorSlots: m.armorSlots }));

function standUp(project: Project, scene: SceneDoc, stats: Stats, party: readonly Member[], bad: Currency | null) {
  // Always the project's own: the structures are a registry `paletteForProject` refills.
  const { grid, issues } = gridFromScene(scene, paletteForProject(project));
  const built = sceneStateFromScene(scene, grid, {
    adversaries: new Map(stats.map(([id, s]) => [id, { id, ...s }])),
    party: partyOf(party),
    ...(bad === null ? {} : { bad: { ...bad } }),
  });
  return { grid, gridIssues: issues, ...built };
}

function room(name: string, project: Project, scene: SceneDoc, stats: Stats, party: readonly Member[], bad: Currency | null) {
  const { grid, gridIssues, state, issues } = standUp(project, scene, stats, party, bad);
  const index = new TriggerIndex(scene, grid);
  const at = Array.from({ length: grid.size }, (_, tile) => index.at(tile));
  const every = Array.from({ length: grid.size }, (_, tile) => tile);
  const standing = clone(state.snapshot());
  const hits = [];
  for (let n = 0; n < 12; n++) {
    const hit = index.firstAlong(every, state);
    if (hit === null) break;
    hits.push(hit);
    state.encounter(hit.encounter).triggered = true;
  }
  return {
    name,
    project: partOf(project),
    scene: clone(scene),
    stats,
    party,
    bad,
    grid: specOf(grid),
    gridIssues,
    placements: placementsOf(scene, grid),
    state: standing,
    stateIssues: issues,
    layout: layoutOf(state),
    interactables: clone(interactablesOf(scene)),
    triggers: { size: index.size, at, hits, encounters: clone(state.snapshot().encounters) },
    decos: scene.decos.map((deco) => ({
      footprint: decoFootprint(deco),
      centre: decoCentre(deco),
      // Every tile round the block and a little past it, both ways: the block's edges are its whole meaning.
      covers: [-1, 0, 1, 2, 3, 4].flatMap((dy) => [-1, 0, 1, 2, 3, 4].map((dx) => decoCovers(deco, { x: deco.position.x + dx, y: deco.position.y + dy }))),
    })),
  };
}

/** Every structure a project knows, and what it is to somebody standing on it at a few stretches. */
function profiles(project: Project) {
  paletteForProject(project);
  const ids = structureTypes().map((s) => s.id);
  return { project: partOf(project), ids, profiles: [...ids, 'nothing'].map((id) => [0.25, 0.5, 1, 1.75, 4].map((stretch) => pieceProfile(id, stretch))) };
}

// --- Rooms written from a seed ---------------------------------------------------------------------------

const KINDS = ['chest', 'door', 'pillar', 'portal', 'scripted'] as const;
const TRAITS = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'] as const;

function aFunction(g: Rng, depth: number): unknown {
  const kind = g.pick(depth > 1 ? FUNCTION_KINDS.filter((k) => k !== 'trapped') : FUNCTION_KINDS);
  switch (kind) {
    case 'container':
      return { kind, items: g.nextInt(3) === 0 ? [] : [{ item: 'rope', count: 1 + g.nextInt(3) }, { item: 'torch' }] };
    case 'door':
      return { kind };
    case 'portal':
      return { kind, pair: g.pick(['a', 'b', '', ' a ']) };
    case 'interaction':
      return { kind, dialogue: g.pick(['', 'talk', ' talk ']) };
    case 'shop':
      return g.nextInt(2) === 0 ? { kind } : { kind, shop: { currency: 'gold', buysAt: 30, stock: [{ item: 'rope', price: 2 }] } };
    case 'trapped':
      return {
        kind,
        trait: g.pick(TRAITS),
        ...(g.nextInt(2) === 0 ? { difficulty: 5 + g.nextInt(20) } : {}),
        ...(g.nextInt(2) === 0 ? { repeatable: g.nextInt(2) === 0 } : {}),
        ...(g.nextInt(3) > 0 ? { success: aFunction(g, depth + 1) } : {}),
        ...(g.nextInt(3) > 0 ? { failure: aFunction(g, depth + 1) } : {}),
      };
    case 'script':
      return {
        kind,
        ...(g.nextInt(4) > 0 ? { object: g.pick(KINDS) } : {}),
        ...(g.nextInt(2) === 0 ? { name: 'Lever' } : {}),
        ...(g.nextInt(2) === 0 ? { flavor: 'It creaks.' } : {}),
        ...(g.nextInt(2) === 0 ? { blocksMovement: g.nextInt(2) === 0 } : {}),
        ...(g.nextInt(2) === 0 ? { effects: [{ kind: 'setFlag', flag: 'pulled' }] } : {}),
        ...(g.nextInt(3) === 0 ? { check: { trait: g.pick(TRAITS), difficulty: 12, onSuccessWithGood: [{ kind: 'log', text: 'Yes.' }] } } : {}),
        ...(g.nextInt(2) === 0 ? { repeatable: g.nextInt(2) === 0 } : {}),
        ...(g.nextInt(3) === 0 ? { requiresKey: g.pick(['brass-key', '']) } : {}),
        ...(g.nextInt(3) === 0 ? { lockedText: 'Shut fast.' } : {}),
        ...(g.nextInt(4) === 0 ? { goto: 'elsewhere' } : {}),
        ...(g.nextInt(4) === 0 ? { tags: ['lever'] } : {}),
        ...(g.nextInt(4) === 0 ? { data: { lit: true, count: 2 } } : {}),
      };
  }
}

function anObject(g: Rng, id: string, width: number, height: number): unknown {
  return {
    id,
    kind: g.pick(KINDS),
    position: { x: g.nextInt(width), y: g.nextInt(height) },
    ...(g.nextInt(2) === 0 ? { name: 'A thing' } : {}),
    ...(g.nextInt(2) === 0 ? { flavor: 'Dust.' } : {}),
    ...(g.nextInt(3) === 0 ? { model: g.pick([null, 'crate']) } : {}),
    ...(g.nextInt(2) === 0 ? { rotation: g.nextInt(4) } : {}),
    ...(g.nextInt(2) === 0 ? { blocksMovement: g.nextInt(2) === 0 } : {}),
    ...(g.nextInt(4) === 0 ? { toggles: g.nextInt(2) === 0 } : {}),
    ...(g.nextInt(2) === 0 ? { effects: [{ kind: 'giveKey', key: 'brass-key' }] } : {}),
    ...(g.nextInt(3) === 0 ? { check: { trait: 'finesse', difficulty: 10, onFailureWithBad: [{ kind: 'log', text: 'No.' }] } } : {}),
    ...(g.nextInt(2) === 0 ? { repeatable: g.nextInt(2) === 0 } : {}),
    ...(g.nextInt(3) === 0 ? { requiresKey: 'brass-key' } : {}),
    ...(g.nextInt(3) === 0 ? { lockedText: g.pick(['', 'Barred.']) } : {}),
    ...(g.nextInt(4) === 0 ? { goto: 'elsewhere' } : {}),
  };
}

/** A palette of the project's own, some of it structures, and structures of its own built from the four. */
const OWN: Project = {
  terrainPalette: [
    { id: 'floor', name: '', passable: true, cost: 1, providesCover: false, blocksSight: false },
    { id: 'mud', name: 'Mud', passable: true, cost: 3, providesCover: false, blocksSight: false },
    { id: 'rock', name: 'Rock', passable: false, cost: 1, providesCover: true, blocksSight: true },
    { id: 'ledge', name: 'Ledge', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'floor' },
    { id: 'rampart', name: 'Rampart', passable: true, cost: 2, providesCover: true, blocksSight: false, structure: 'wall' },
    { id: 'stair', name: 'Stair', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'stairs' },
    { id: 'plinth', name: 'Plinth', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'plinth' },
  ],
  structureTypes: [
    { id: 'plinth', name: 'Plinth', atoms: [{ shape: 'block' }, { shape: 'floor', at: [0, 1, 0] }] },
    { id: 'doorway', name: '', atoms: [{ shape: 'wall', at: [0, 0.75, 0] }, { shape: 'wall' }] },
    { id: 'lowwall', name: '', atoms: [{ shape: 'wall', at: [0, -0.5, 0] }] },
    { id: 'floor', name: 'Thick floor', atoms: [{ shape: 'block' }] },
    { id: 'odd', name: '', atoms: [{ shape: 'nothing' }, { shape: 'stairs', at: [0.5, 0.25, -0.5] }] },
  ],
};

const SHAPES = ['block', 'floor', 'wall', 'stairs', 'plinth', 'doorway', 'lowwall', 'odd', 'unknown'];

function written(g: Rng, i: number): { project: Project; scene: SceneDoc; stats: Stats; party: Member[]; bad: Currency | null } {
  const own = g.nextInt(2) === 0;
  const project: Project = own ? OWN : {};
  const ids = own ? OWN.terrainPalette!.map((t) => t.id) : ['floor', 'difficult', 'cover', 'wall', 'platform', 'steps', 'block', 'barrier', 'void'];
  const width = 3 + g.nextInt(10);
  const height = 2 + g.nextInt(9);
  const count = width * height;
  const terrain = Array.from({ length: count }, () => (g.nextInt(12) === 0 ? g.pick(['lava', 'flor']) : g.pick(ids)));
  const heights = Array.from({ length: count }, () => (g.nextInt(20) === 0 ? g.pick([40000, -40000, 70000, 32768]) : g.nextInt(5) - 1));
  const pieces: Record<string, unknown> = {};
  let last: { x: number; y: number; level: number } | null = null;
  for (let n = g.nextInt(3) === 0 ? 0 : g.nextInt(30); n > 0; n--) {
    // Now and then on top of the last one, level and all - a tie the later piece wins - or far away.
    const place: { x: number; y: number; level: number } =
      last !== null && g.nextInt(5) === 0
        ? { ...last }
        : g.nextInt(15) === 0
          ? { x: 999_998 + g.nextInt(3), y: -999_999 - g.nextInt(2), level: 0 }
          : { x: g.nextInt(width + 4) - 2, y: g.nextInt(height + 4) - 2, level: (g.nextInt(16) - 4) / 4 };
    last = place;
    const piece = {
      ...place,
      ...(g.nextInt(3) === 0 ? { height: (1 + g.nextInt(16)) / 4 } : {}),
      shape: g.pick(SHAPES),
      material: g.pick(['stone', 'wood', 'grass']),
      rotation: g.nextInt(4),
      ...(g.nextInt(5) > 0 ? { tile: g.nextInt(8) === 0 ? 'unheard-of' : g.pick(ids) } : {}),
    };
    // An overlap numbered as the editor numbers it, or as any number a document may carry.
    let key = g.nextInt(6) === 0 ? `${buildingKey(piece)}#${2 + g.nextInt(12)}` : buildingKey(piece);
    for (let k = 1; key in pieces; k++) key = `${buildingKey(piece)}#${k}`;
    pieces[key] = piece;
  }
  const decos = [];
  for (let n = g.nextInt(6); n > 0; n--) {
    const usable = g.nextInt(2) === 0;
    decos.push({
      ...(usable || g.nextInt(3) === 0 ? { id: `prop-${n}` } : {}),
      model: 'crate',
      position: g.nextInt(10) === 0 ? { x: 999_999 + g.nextInt(2), y: -1_000_000 + g.nextInt(2) } : { x: g.nextInt(width + 2) - 1, y: g.nextInt(height + 2) - 1 },
      ...(g.nextInt(2) === 0 ? { rotation: g.nextInt(7) / 2 } : {}),
      ...(g.nextInt(2) === 0 ? { span: 1 + g.nextInt(4) } : {}),
      ...(g.nextInt(2) === 0 ? { solid: g.nextInt(3) > 0 } : {}),
      ...(usable ? { function: aFunction(g, 0) } : {}),
    });
  }
  const interactables = Array.from({ length: g.nextInt(4) }, (_, n) => anObject(g, `thing-${n}`, width, height));
  const known = ['rat', 'husk', 'bandit'];
  const claimed: { x: number; y: number }[] = [];
  const cell = (): { x: number; y: number } => {
    // Some of them another encounter's already: the first to claim a cell keeps it.
    const next = claimed.length > 0 && g.nextInt(3) === 0 ? { ...g.pick(claimed) } : { x: g.nextInt(width + 2), y: g.nextInt(height + 2) };
    claimed.push(next);
    return next;
  };
  const encounters = Array.from({ length: g.nextInt(4) }, (_, e) => ({
    id: `fight-${e}`,
    adversaries: Array.from({ length: g.nextInt(4) }, (_, a) => ({
      id: `foe-${e}-${a}`,
      adversary: g.nextInt(6) === 0 ? 'nobody-knows' : g.pick(known),
      position: g.nextInt(6) === 0 ? { x: width + g.nextInt(3), y: -1 - g.nextInt(2) } : { x: g.nextInt(width), y: g.nextInt(height) },
      ...(g.nextInt(3) === 0 ? { hitPoints: 1 + g.nextInt(9) } : {}),
      ...(g.nextInt(4) === 0 ? { name: 'Grub' } : {}),
      ...(g.nextInt(4) === 0 ? { model: 'grub' } : {}),
      ...(g.nextInt(4) === 0 ? { interaction: g.nextInt(2) === 0 ? { kind: 'friendly', dialogue: 'talk' } : { kind: 'threshold', dialogue: 'talk' } } : {}),
    })),
    triggerCells: Array.from({ length: g.nextInt(6) }, cell),
    ...(g.nextInt(4) === 0 ? { startsOnTrigger: false } : {}),
    ...(g.nextInt(4) === 0 ? { bystanders: g.nextInt(2) === 0 } : {}),
  }));
  const scene = sceneSchema.parse({
    id: `room-${i}`,
    width,
    height,
    terrain,
    heights,
    ...(g.nextInt(3) === 0 ? { tints: Array.from({ length: count }, () => g.pick(['', '#224'])) } : {}),
    spawns: Array.from({ length: 1 + g.nextInt(3) }, () => ({ x: g.nextInt(width), y: g.nextInt(height) })),
    interactables,
    encounters,
    decos,
    ...(g.nextInt(4) > 0 ? { buildingTiles: pieces } : {}),
    ...(g.nextInt(3) === 0 ? { origin: { x: g.nextInt(5) - 2, y: g.nextInt(5) - 2 } } : {}),
  });
  const stats: Stats = known.map((id) => [id, { hitPoints: 1 + g.nextInt(8), stress: g.nextInt(4) }]);
  const party = Array.from({ length: g.nextInt(6) }, (_, n) => ({ id: `hero-${n}`, definition: g.pick(['guardian', 'bard']), hitPoints: 5 + g.nextInt(3), stress: 6, armorSlots: g.nextInt(4) }));
  const bad = g.nextInt(3) === 0 ? createBad(g.nextInt(12)) : null;
  return { project, scene, stats, party, bad };
}

// --- Rooms grown ---------------------------------------------------------------------------------------

function reshaped(g: Rng, built: ReturnType<typeof written>, at: number) {
  const { project, scene, stats, party, bad } = built;
  const reach: Reach = {
    minX: g.nextInt(scene.width + 4) - 4,
    minY: g.nextInt(scene.height + 4) - 4,
    maxX: g.nextInt(scene.width + 5),
    maxY: g.nextInt(scene.height + 5),
  };
  const cap = g.pick([MAX_GROWN, 8, 14]);
  const growth = growthToReach(scene, reach, cap);
  if (growth === null) return { room: at, reach, cap, growth };
  const fill = g.pick([undefined, 'floor']);
  const grown = grownScene(scene, growth, fill);
  const larger = { ...scene, ...grown } as SceneDoc;
  // A game played in the room before it grew, restored into it after - and back.
  const before = standUp(project, scene, stats, party, bad).state;
  const after = standUp(project, larger, stats, party, bad).state;
  const played = before.snapshot();
  after.restore(played);
  const back = standUp(project, scene, stats, party, bad).state;
  back.restore(after.snapshot());
  return { room: at, reach, cap, growth, fill: fill ?? null, grown: clone(grown), restored: after.snapshot(), undone: back.snapshot() };
}

function shifts(g: Rng, built: ReturnType<typeof written>, at: number) {
  const { project, scene, stats, party, bad } = built;
  const snapshot = standUp(project, scene, stats, party, bad).state.snapshot();
  return Array.from({ length: 3 }, () => {
    const [dx, dy] = [g.nextInt(7) - 3, g.nextInt(7) - 3];
    const [width, height] = [Math.max(1, scene.width + g.nextInt(5) - 2), Math.max(1, scene.height + g.nextInt(5) - 2)];
    const fallback = g.pick([NO_TILE, 0]);
    return { room: at, dx, dy, width, height, fallback, shifted: shiftSnapshot(snapshot, scene.width, dx, dy, width, height, fallback) };
  });
}

// --- Prop functions --------------------------------------------------------------------------------------

function functions(g: Rng) {
  return Array.from({ length: 300 }, () => {
    const fn = propFunctionSchema.parse(aFunction(g, 0)) as PropFunction;
    const solid = g.pick([undefined, true, false]);
    const prop = { id: 'thing', model: 'crate', position: { x: 3, y: 4 }, rotation: 0.5, ...(solid === undefined ? {} : { solid }), function: fn };
    return {
      prop,
      object: clone(objectOfProp(prop)),
      steps: stepsOf(fn, 'thing'),
      opens: definitionOf(fn).opens(fn),
      found: FUNCTION_KINDS.map((kind: PropFunctionKind) => findFunction(fn, kind) ?? null),
      items: containerItems(fn),
      pairs: pairsOf(fn),
    };
  });
}

function portals(g: Rng) {
  return Array.from({ length: 12 }, (_, p) => {
    const project = {
      scenes: Array.from({ length: 1 + g.nextInt(3) }, (_, s) => ({
        id: `scene-${s}`,
        decos: Array.from({ length: g.nextInt(4) }, (_, d) => ({
          ...(g.nextInt(6) > 0 ? { id: `portal-${s}-${d}` } : {}),
          model: 'arch',
          position: { x: d, y: s },
          rotation: 0,
          ...(g.nextInt(6) > 0 ? { function: propFunctionSchema.parse(g.nextInt(3) === 0 ? aFunction(g, 0) : { kind: 'portal', pair: g.pick(['a', 'b', '', ' ']) }) } : {}),
        })),
      })),
    };
    const ids = [...project.scenes.flatMap((s) => s.decos.map((d) => d.id ?? null)), 'stranger', null];
    const pairs = ['a', 'b', '', ' ', ' a'];
    const view = (found: { scene: string; prop: { id: string } }[]) => found.map((f) => ({ scene: f.scene, prop: f.prop.id }));
    return {
      seed: p,
      project,
      asked: pairs.map((pair) => ({
        pair,
        with: view(portalsWith(project as never, pair)),
        partner: ids.map((from) => {
          const found = portalPartner(project as never, pair, from);
          return found === null ? null : { scene: found.scene, prop: found.prop.id };
        }),
        taken: ids.map((self) => pairTaken(project as never, pair, self ?? undefined)),
      })),
    };
  });
}

// --- Using a thing -----------------------------------------------------------------------------------------

class Ran extends Error {}

/** A use refused before anything runs, or what it would run: every reading a use makes first, answered. */
function uses(things: readonly Interactable[]) {
  const cases = [];
  for (const [index, thing] of things.entries()) {
    for (const state of [{ used: false, open: false, removed: false }, { used: true, open: false, removed: false }, { used: false, open: true, removed: false }, { used: true, open: true, removed: true }, { used: true, open: true, removed: false }]) {
      for (const hasKey of [false, true]) {
        for (const repeatable of [false, true]) {
          const asked: string[] = [];
          const world = new Proxy(
            {},
            {
              get: (_, key) => {
                if (key === 'interactableState') return () => ({ ...state });
                if (key === 'hasKey') return (k: string) => (asked.push(k), hasKey);
                return () => {
                  throw new Ran();
                };
              },
            },
          ) as ScriptWorld;
          let refused = null;
          try {
            const result = useInteractable(thing, world, createRng('unused'), { repeatable });
            if (result.status === 'refused') refused = { reason: result.reason, text: result.text };
          } catch (error) {
            if (!(error instanceof Ran)) throw error;
          }
          cases.push({ thing: index, state, hasKey, repeatable, asked, refused });
        }
      }
    }
  }
  return cases;
}

// --- The rooms ---------------------------------------------------------------------------------------------

function golden() {
  const g = createRng('room');
  const rooms = [];
  const things: Interactable[] = [];
  const stats = (scene: SceneDoc, project: Pick<ProjectDoc, 'adversaries'>): Stats => {
    const carried = new Map(project.adversaries.map((a) => [a.id, a]));
    const ids = new Set(scene.encounters.flatMap((e) => e.adversaries.map((a) => a.adversary)));
    return [...ids].flatMap((id) => {
      const def = carried.get(id) ?? DEMO_ADVERSARIES.get(id);
      return def === undefined ? [] : [[id, { hitPoints: def.hitPoints, stress: def.stress }] as Stats[number]];
    });
  };
  const members = (n: number): Member[] => Array.from({ length: n }, (_, i) => ({ id: `member-${i}`, definition: 'warrior', hitPoints: 6, stress: 6, armorSlots: 3 }));

  // The demo, and the proof that a room built here is the demo's own room.
  const demo = buildDemoScene(hollowVaultMap(), 'room');
  const party = demo.state.entitiesOf('party');
  const demoMembers: Member[] = party.map((e) => ({ id: e.id, definition: e.definition, hitPoints: e.hitPoints.max, stress: e.stress.max, armorSlots: e.armorSlots.max }));
  const built = standUp(demo.project, demo.scene, stats(demo.scene, demo.project), demoMembers, null);
  expect(specOf(built.grid)).toEqual(specOf(demo.grid));
  const theirs = clone(demo.state.snapshot());
  for (const e of Object.values(theirs.entities)) delete (e as { good?: unknown }).good;
  const ours = clone(built.state.snapshot());
  for (const e of Object.values(ours.entities)) delete (e as { good?: unknown }).good;
  expect(ours).toEqual(theirs);
  for (const scene of demo.project.scenes) {
    rooms.push(room(`the demo: ${scene.id}`, demo.project, scene, stats(scene, demo.project), demoMembers, null));
    things.push(...interactablesOf(scene));
  }

  // The default project, and the captured version-1 one with its objects as they were and made props.
  const projects: [string, ProjectDoc][] = [
    ['projects/default.json', projectSchema.parse(migrateDocument(repo('projects/default.json')))],
    ['tests/fixtures/v1/project.json', projectSchema.parse(migrateDocument(repo('tests/fixtures/v1/project.json')))],
  ];
  const converted: unknown[] = [];
  for (const [file, project] of projects) {
    for (const scene of project.scenes) {
      rooms.push(room(`${file}: ${scene.id}`, project, scene, stats(scene, project), members(4), createBad(3)));
      things.push(...interactablesOf(scene));
      const props = structuredClone(scene);
      const changed = objectsToProps(props);
      converted.push({ room: rooms.length - 1, changed, interactables: clone(props.interactables), decos: clone(props.decos) });
      if (changed) rooms.push(room(`${file}: ${scene.id}, its objects made props`, project, props, stats(scene, project), members(2), null));
    }
  }

  const grown = [];
  const shifted = [];
  for (let i = 0; i < 120; i++) {
    const w = written(g, i);
    const at = rooms.length;
    rooms.push(room(`written ${i}`, w.project, w.scene, w.stats, w.party, w.bad));
    things.push(...interactablesOf(w.scene));
    const props = structuredClone(w.scene);
    converted.push({ room: at, changed: objectsToProps(props), interactables: clone(props.interactables), decos: clone(props.decos) });
    grown.push(reshaped(g, w, at));
    if (i % 3 === 0) shifted.push(...shifts(g, w, at));
  }

  // Each different thing once, and the written rooms' first hundred of them.
  const seen = new Set<string>();
  const kept = things.filter((thing) => {
    const key = JSON.stringify(thing);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 220);

  return {
    about: 'a room stood up from its document for the Rust port; written by src/engine/scene/room.golden.test.ts',
    rooms,
    profiles: [profiles({}), profiles(OWN), profiles(demo.project)],
    grown,
    shifted,
    functions: functions(g),
    portals: portals(g),
    converted,
    things: clone(kept),
    runs: kept.map((thing) => openingEffects(thing)),
    uses: uses(kept),
  };
}

describe('a room, as the Rust server must stand it up', () => {
  it('is what server/fixtures/room.json holds', () => {
    const now = clone(golden());
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  }, 120_000);
});
