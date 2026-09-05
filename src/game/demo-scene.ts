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

import adversaryJson from '../../tools/srd-sources/seansbox/adversaries.json';
import { applyAttack, resolveAttack, type AttackProfile } from '../engine/combat/attack';
import { EncounterRunner } from '../engine/combat/encounter';
import {
  importSeansboxAdversaries,
  type RawAdversary,
} from '../engine/content/srd/seansbox-adversaries';
import type { AdversaryDef } from '../engine/content/types';
import { createRng, type Rng } from '../engine/core/rng';
import { NO_TILE, type TileGrid } from '../engine/grid/grid';
import { Pathfinder, type ReachableField } from '../engine/grid/pathfinding';
import { parseDice } from '../engine/rules/dice';
import { pcThresholds } from '../engine/rules/damage';
import { gridFromScene, tileOf } from '../engine/scene/grid-from-scene';
import { importLegacyScene, type LegacyMap } from '../engine/scene/legacy-import';
import { Party } from '../engine/scene/party';
import type { SceneDoc } from '../engine/scene/schema';
import { createPartyEntity, sceneStateFromScene, type SceneState } from '../engine/scene/state';
import { TriggerIndex } from '../engine/scene/triggers';

/** Adversary stat blocks, keyed by content id. */
export const SRD_ADVERSARIES: ReadonlyMap<string, AdversaryDef> = new Map(
  importSeansboxAdversaries(adversaryJson as RawAdversary[]).defs.map((def) => [def.id, def]),
);

/**
 * The prototype's homebrew Hollow Husk has no SRD stat block, so the demo stands
 * the SRD's Acid Burrower in its place — the same substitution the end-to-end
 * combat test makes.
 */
export const DEMO_ADVERSARY_ID = 'acid-burrower';

/** How far a party member may move in one go, in movement points. */
export const DEMO_MOVE_BUDGET = 8;

/** Tight bands, so a 22x16 map spans more than one of them. */
export const DEMO_BAND_TILES = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

/**
 * Which model an entity uses. Party members carry a class name and adversaries an
 * SRD content id; neither is a model id, so the demo maps them.
 */
export const DEMO_MODELS: Readonly<Record<string, string>> = {
  sentinel: 'knight',
  nightwalker: 'rogue',
  seer: 'mage',
  'acid-burrower': 'bramble',
  'hollow-husk': 'husk',
};

/** The party, in SRD terms. The character layer will replace this wholesale. */
const PARTY = [
  { id: 'kara', definition: 'sentinel', evasion: 11, hitPoints: 6, weapon: 'd10+3 phy', modifier: '+2' },
  { id: 'finn', definition: 'nightwalker', evasion: 13, hitPoints: 5, weapon: 'd8+2 phy', modifier: '+3' },
  { id: 'mira', definition: 'seer', evasion: 12, hitPoints: 5, weapon: 'd6+2 mag', modifier: '+2' },
] as const;

const LEVEL = 1;
const GAMBESON = { major: 5, severe: 11 };

export interface DemoScene {
  scene: SceneDoc;
  grid: TileGrid;
  state: SceneState;
  pathfinder: Pathfinder;
  party: Party;
  triggers: TriggerIndex;
  rng: Rng;
  /** Set while a fight is running. */
  encounter: EncounterRunner | null;
}

export function buildDemoScene(map: LegacyMap, seed = 'demo'): DemoScene {
  const imported = importLegacyScene(map);
  const scene = imported.scene;
  if (scene === null) throw new Error('the demo map could not be imported');

  const { grid } = gridFromScene(scene);
  const burrower = SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID);
  if (burrower === undefined) throw new Error(`missing adversary "${DEMO_ADVERSARY_ID}"`);

  const stats = new Map<string, { id: string; hitPoints: number; stress: number }>();
  for (const encounter of scene.encounters) {
    for (const placement of encounter.adversaries) {
      stats.set(placement.adversary, {
        id: placement.adversary,
        hitPoints: burrower.hitPoints,
        stress: burrower.stress,
      });
    }
  }

  const { state } = sceneStateFromScene(scene, grid, {
    adversaries: stats,
    party: PARTY.map((member) => ({
      ...createPartyEntity(member.id, member.definition, NO_TILE),
      hitPoints: { max: member.hitPoints, marked: 0 },
    })),
  });

  // The vault door is shut in the authored map; open it so the demo has somewhere
  // to walk and something to reach.
  const door = scene.interactables.find((i) => i.kind === 'door');
  if (door !== undefined) {
    state.interactable(door.id).open = true;
    state.setInteractableBlocking(tileOf(grid, door.position), false);
  }

  const pathfinder = new Pathfinder(grid);
  return {
    scene,
    grid,
    state,
    pathfinder,
    party: new Party(state, pathfinder, { moveBudget: DEMO_MOVE_BUDGET }),
    triggers: new TriggerIndex(scene, grid),
    rng: createRng(seed),
    encounter: null,
  };
}

/** Whether a fight is currently running. */
export function inCombat(demo: DemoScene): boolean {
  return demo.encounter !== null && demo.encounter.outcome === 'ongoing';
}

/** Tiles the selected member can reach right now. */
export function reachableTiles(demo: DemoScene, budget = DEMO_MOVE_BUDGET): ReachableField {
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
export function moveSelectedTo(demo: DemoScene, destination: number): MoveResult {
  const id = demo.party.selected;
  if (id === null || !demo.party.canCommand(id)) return { moved: false, path: [] };
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(id)) return { moved: false, path: [] };

  const field = demo.party.reachable(id, { inCombat: fighting });
  if (!field.canReach(destination)) return { moved: false, path: [] };

  const full = demo.party.moveTo(id, destination, { inCombat: fighting });
  if (full === null) return { moved: false, path: [] };

  // A trigger stops the move where it fired.
  const hit = demo.triggers.firstAlong(full, demo.state);
  const path = hit === null ? full : full.slice(0, full.indexOf(hit.tile) + 1);
  if (hit !== null) demo.state.moveEntity(id, hit.tile);

  if (!fighting) demo.party.follow(id, path);
  if (fighting) demo.encounter!.act(id);

  if (hit !== null) {
    startEncounter(demo, hit.encounter);
    return { moved: true, path, triggered: hit.encounter };
  }
  return { moved: true, path };
}

/** Begin a fight. Safe to call twice. */
export function startEncounter(demo: DemoScene, encounterId: string): EncounterRunner {
  if (demo.encounter !== null && demo.encounter.encounterId === encounterId) return demo.encounter;
  const runner = new EncounterRunner(demo.state, encounterId);
  runner.start();
  demo.encounter = runner;
  return runner;
}

const profileFor = (member: (typeof PARTY)[number]): AttackProfile => ({
  kind: 'pc',
  name: 'Weapon',
  modifier: parseDice(member.modifier)!,
  range: 'melee',
  damage: parseDice(member.weapon)!,
  proficiency: 1,
});

const memberOf = (id: string) => PARTY.find((m) => m.id === id);

/**
 * The selected character attacks an adversary.
 *
 * Returns null when the attack could not be attempted at all, so a UI can say why
 * without the engine having rolled anything.
 */
export function attackWithSelected(
  demo: DemoScene,
  targetId: string,
): { hit: boolean; refused: string | null; hitPointsMarked: number } | null {
  const id = demo.party.selected;
  const member = id === null ? undefined : memberOf(id);
  const attacker = id === null ? undefined : demo.state.entity(id);
  const target = demo.state.entity(targetId);
  if (member === undefined || attacker === undefined || target === undefined) return null;
  if (inCombat(demo) && !demo.encounter!.canAct(id!)) return null;

  const def = SRD_ADVERSARIES.get(target.definition) ?? SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
  const outcome = resolveAttack(demo.rng, {
    grid: demo.grid,
    attacker,
    target,
    profile: profileFor(member),
    defender: { difficulty: def.difficulty, thresholds: def.thresholds },
    options: { bandTiles: DEMO_BAND_TILES },
  });
  if (outcome.refused !== null) return { hit: false, refused: outcome.refused, hitPointsMarked: 0 };

  const applied = applyAttack(demo.state, outcome);
  if (inCombat(demo)) demo.encounter!.act(id!, { spotlightToGm: outcome.spotlightToGm });
  return { hit: outcome.hit, refused: null, hitPointsMarked: applied.hitPointsMarked };
}

/**
 * Play the GM's turn: spotlight adversaries while the Fear lasts, each attacking
 * the nearest party member it can reach.
 */
export function playGmTurn(demo: DemoScene): number {
  const encounter = demo.encounter;
  if (encounter === null || encounter.outcome !== 'ongoing' || encounter.view().side !== 'gm') return 0;

  let acted = 0;
  for (const id of encounter.view().waiting) {
    if (!encounter.canSpotlight(id)) break;
    encounter.spotlight(id);
    acted++;
    attackNearestPartyMember(demo, id);
    if (encounter.outcome !== 'ongoing') break;
  }
  encounter.endGmTurn();
  return acted;
}

function attackNearestPartyMember(demo: DemoScene, adversaryId: string): void {
  const adversary = demo.state.entity(adversaryId);
  if (adversary === undefined || !adversary.alive) return;

  const targets = demo.state.entitiesOf('party').filter((e) => e.alive);
  if (targets.length === 0) return;
  // Nearest, then by id, so the same state always produces the same target.
  const target = targets.sort(
    (a, b) =>
      demo.grid.manhattanDistance(adversary.tile, a.tile) -
        demo.grid.manhattanDistance(adversary.tile, b.tile) || a.id.localeCompare(b.id),
  )[0]!;

  const member = memberOf(target.id);
  const def = SRD_ADVERSARIES.get(adversary.definition) ?? SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
  const outcome = resolveAttack(demo.rng, {
    grid: demo.grid,
    attacker: adversary,
    target,
    profile: {
      kind: 'adversary',
      name: def.attackName,
      modifier: def.attackModifier,
      range: def.attackRange,
      damage: def.attackDamage,
    },
    defender: {
      difficulty: member?.evasion ?? 11,
      thresholds: pcThresholds(LEVEL, GAMBESON),
    },
    options: { bandTiles: DEMO_BAND_TILES },
  });
  if (outcome.refused === null) applyAttack(demo.state, outcome);
}
