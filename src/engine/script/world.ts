/**
 * The bridge from a running scene to a script.
 *
 * `ScriptRunner` is deliberately ignorant of `SceneState` — it talks to a
 * `ScriptWorld` interface, so a test can drive a script against a stub and a
 * replay can drive one against a restored snapshot. This is the implementation
 * that connects it to the real thing.
 *
 * Scenario variables live here rather than in `SceneState` because they outlive a
 * scene: the one-shot's `mood` is chosen in the pit and read in the theater
 * (docs/research/legacy-campaign.md §1.1). They serialise with the rest.
 */

import { markHitPoints, clear as clearPool } from '../rules/resources';
import type { SceneState } from '../scene/state';
import type { Trait } from '../scene/schema';
import type { ScriptValue } from './conditions';
import type { TargetSelector } from './effects';
import type { ScriptWorld } from './runner';

/** Variables that outlive a scene, plus who is acting. */
export interface ScenarioState {
  variables: Record<string, ScriptValue>;
  /** The character a script's `actor` selector refers to. */
  actorId: string | null;
}

export function createScenarioState(
  variables: Record<string, ScriptValue> = {},
  actorId: string | null = null,
): ScenarioState {
  return { variables: { ...variables }, actorId };
}

export interface SceneScriptWorldOptions {
  /**
   * Trait modifiers for the acting character. The character layer does not exist
   * yet, so a scenario supplies these; when it does, this reads from the sheet.
   */
  traits?: Partial<Record<Trait, number>>;
}

/** A `ScriptWorld` backed by a live scene. */
export class SceneScriptWorld implements ScriptWorld {
  readonly state: SceneState;
  readonly scenario: ScenarioState;
  private readonly traits: Partial<Record<Trait, number>>;

  constructor(state: SceneState, scenario: ScenarioState, options: SceneScriptWorldOptions = {}) {
    this.state = state;
    this.scenario = scenario;
    this.traits = options.traits ?? {};
  }

  // ---- reads ---------------------------------------------------------------

  hasFlag(flag: string): boolean {
    return this.state.hasFlag(flag);
  }

  hasKey(key: string): boolean {
    return this.state.hasKey(key);
  }

  getVar(name: string): ScriptValue {
    // An unset variable reads as null rather than undefined, so conditions
    // comparing against null behave the way content expects.
    return this.scenario.variables[name] ?? null;
  }

  interactableState(id: string): { used: boolean; open: boolean; removed: boolean } {
    const s = this.state.interactable(id);
    return { used: s.used, open: s.open, removed: s.removed };
  }

  encounterState(id: string): { started: boolean; ended: boolean; triggered: boolean } {
    const s = this.state.encounter(id);
    return { started: s.started, ended: s.ended, triggered: s.triggered };
  }

  countAlive(faction: 'party' | 'adversary'): number {
    return this.state.entitiesOf(faction).filter((e) => e.alive).length;
  }

  traitModifier(trait: Trait): number {
    return this.traits[trait] ?? 0;
  }

  // ---- writes --------------------------------------------------------------

  setFlag(flag: string): void {
    this.state.setFlag(flag);
  }

  clearFlag(flag: string): void {
    this.state.clearFlag(flag);
  }

  giveKey(key: string): void {
    this.state.giveKey(key);
  }

  setVar(name: string, value: ScriptValue): void {
    this.scenario.variables[name] = value;
  }

  openInteractable(id: string): void {
    this.state.interactable(id).open = true;
  }

  removeInteractable(id: string): void {
    const s = this.state.interactable(id);
    s.removed = true;
    // A removed interactable stops blocking the tile it stood on.
    const tile = this.state.interactableTile(id);
    if (tile >= 0) this.state.setInteractableBlocking(tile, false);
  }

  markInteractableUsed(id: string): void {
    this.state.interactable(id).used = true;
  }

  startEncounter(id: string): void {
    this.state.encounter(id).started = true;
    this.state.encounter(id).triggered = true;
  }

  endEncounter(id: string): void {
    this.state.encounter(id).ended = true;
  }

  damage(target: TargetSelector, amount: number, _source?: string): number {
    let total = 0;
    for (const entity of this.resolve(target)) {
      const result = markHitPoints(entity.hitPoints, amount);
      entity.hitPoints = result.hitPoints;
      if (result.fell) entity.alive = false;
      total += result.hpMarked;
    }
    return total;
  }

  heal(target: TargetSelector, amount: number): number {
    let total = 0;
    for (const entity of this.resolve(target)) {
      const result = clearPool(entity.hitPoints, amount);
      entity.hitPoints = result.pool;
      // Clearing a Hit Point brings an unconscious character back up.
      if (result.applied > 0 && entity.hitPoints.marked < entity.hitPoints.max) entity.alive = true;
      total += result.applied;
    }
    return total;
  }

  private resolve(target: TargetSelector): ReturnType<SceneState['allEntities']> {
    if (target.kind === 'entity') {
      const entity = this.state.entity(target.id);
      return entity === undefined ? [] : [entity];
    }
    if (target.kind === 'party') {
      return this.state.entitiesOf('party').filter((e) => e.alive);
    }
    const id = this.scenario.actorId;
    const actor = id === null ? undefined : this.state.entity(id);
    return actor === undefined ? [] : [actor];
  }
}
