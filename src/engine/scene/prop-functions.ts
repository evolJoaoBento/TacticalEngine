/**
 * What a prop's function does in play, and the parts every function is built from.
 *
 * The document stores the function an author chose (`prop-function-schema.ts`). Here each one is
 * turned into the object it plays as - the same `Interactable` the engine has always used, run by
 * the same `useInteractable`, keeping its state by the same id - so a prop with a function is used,
 * opened, shut, used up and saved exactly as an object is, by code that has been tested for longer
 * than props could do anything.
 *
 * **Adding a function.** Give it settings in `prop-function-schema.ts`, then a row in
 * `PROP_FUNCTIONS` saying three things: what using the prop does (`object`), what it does as a
 * step inside another function (`steps`), and whether it stands in the way until something opens
 * it (`opens`). Build all three out of `parts` and the other effects in `script/schema.ts` - that
 * is what `parts` is for. A lever that opens a door across the room is `[parts.toggle(doorId)]`;
 * a cursed chest is a Trapped whose failure is a `damage` effect and whose success is a Container.
 */

import { decoFootprint } from './deco-span';
import type { ContainerItem, PropFunction, PropFunctionKind } from './prop-function-schema';
import type { Deco, Effect, Interactable, SceneDoc } from './schema';

type CheckRequest = NonNullable<Interactable['check']>;
type CheckTrait = CheckRequest['trait'];

/** The parts. Every function below is some arrangement of these, and so can any new one be. */
export const parts = {
  /** Out of the way, if it is the kind of thing that gets out of the way. */
  open: (self: string): Effect => ({ kind: 'open', interactable: self }),
  /** In the way again; not on anybody standing in it. */
  close: (self: string): Effect => ({ kind: 'close', interactable: self }),
  /** Whichever of the two it is not. */
  toggle: (self: string): Effect => ({ kind: 'toggleOpen', interactable: self }),
  /** Show what it holds, to be taken out. */
  showContents: (self: string): Effect => ({ kind: 'openContainer', interactable: self }),
  /** Send whoever used it to the other end of a pair. */
  teleport: (pair: string): Effect => ({ kind: 'teleport', pair }),
  /** Dealt with: it will not do this again unless it is repeatable. */
  usedUp: (self: string): Effect => ({ kind: 'markUsed', interactable: self }),
  /** Roll a trait against a difficulty; one list on a success, one on a failure. */
  checkRequest: (trait: CheckTrait, difficulty: number, success: Effect[], failure: Effect[]): CheckRequest => ({
    trait,
    difficulty,
    // A critical is a success, and both dice settle it the same way either side: Trapped does not
    // tell a success with Light from one with Shadow, so both halves run the same steps.
    onCriticalSuccess: success,
    onSuccessWithGood: success,
    onSuccessWithBad: success,
    onFailureWithGood: failure,
    onFailureWithBad: failure,
  }),
  check: (trait: CheckTrait, difficulty: number, success: Effect[], failure: Effect[]): Effect => ({
    kind: 'check',
    check: parts.checkRequest(trait, difficulty, success, failure),
  }),
};

/** How a used prop behaves: everything an object is except where it stands and what it looks like. */
export type Behaviour = Pick<Interactable, 'kind' | 'blocksMovement' | 'repeatable'> & Partial<Omit<Interactable, 'id' | 'position' | 'model' | 'rotation'>>;

export interface PropFunctionDef<F extends PropFunction = PropFunction> {
  label: string;
  /** One line for the editor: what choosing it means. */
  summary: string;
  /** What using the prop does - the object it plays as. */
  object(fn: F, self: string, prop: Pick<Deco, 'solid'>): Behaviour;
  /** What it does as a step of another function: a Trapped prop's success, say. */
  steps(fn: F, self: string): Effect[];
  /** Whether it stands in the way until something opens it. */
  opens(fn: F): boolean;
  /** One with its settings at their defaults, for the editor to start from. */
  fresh(): F;
}

type Of<K extends PropFunctionKind> = Extract<PropFunction, { kind: K }>;

/** The steps of a function that might be nothing, which is what an unset success or failure is. */
export function stepsOf(fn: PropFunction | undefined, self: string): Effect[] {
  return fn === undefined ? [] : definitionOf(fn).steps(fn, self);
}

const opensOf = (fn: PropFunction | undefined): boolean => fn !== undefined && definitionOf(fn).opens(fn);

export const PROP_FUNCTIONS: { readonly [K in PropFunctionKind]: PropFunctionDef<Of<K>> } = {
  container: {
    label: 'Container',
    summary: 'Opens a window of what is inside; each thing can be taken into the party pack.',
    object: (_fn, self, prop) => ({ kind: 'chest', blocksMovement: prop.solid === true, repeatable: true, effects: [parts.showContents(self)] }),
    steps: (_fn, self) => [parts.showContents(self)],
    opens: () => false,
    fresh: () => ({ kind: 'container', items: [] }),
  },
  door: {
    label: 'Door',
    summary: 'Stands in the way while shut. Using it opens it, and using it again shuts it.',
    object: (_fn, self) => ({ kind: 'door', blocksMovement: true, repeatable: true, toggles: true, effects: [parts.toggle(self)] }),
    steps: (_fn, self) => [parts.toggle(self)],
    opens: () => true,
    fresh: () => ({ kind: 'door' }),
  },
  trapped: {
    label: 'Trapped',
    summary: 'Asks for a roll first; one function runs on a success and another on a failure.',
    object: (fn, self, prop) => ({
      // A trap guarding a door is a door: in the way until the roll opens it.
      kind: opensOf(fn.success) || opensOf(fn.failure) ? 'door' : 'scripted',
      blocksMovement: opensOf(fn.success) || opensOf(fn.failure) || prop.solid === true,
      repeatable: fn.repeatable,
      check: parts.checkRequest(fn.trait, fn.difficulty, stepsOf(fn.success, self), stepsOf(fn.failure, self)),
    }),
    steps: (fn, self) => [parts.check(fn.trait, fn.difficulty, stepsOf(fn.success, self), stepsOf(fn.failure, self))],
    opens: (fn) => opensOf(fn.success) || opensOf(fn.failure),
    fresh: () => ({ kind: 'trapped', trait: 'finesse', difficulty: 12, repeatable: false }),
  },
  portal: {
    label: 'Portal',
    summary: 'One of a pair: using it sends you to the other portal with the same pair id.',
    object: (fn, _self, prop) => ({ kind: 'portal', blocksMovement: prop.solid === true, repeatable: true, effects: [parts.teleport(fn.pair)] }),
    steps: (fn) => [parts.teleport(fn.pair)],
    opens: () => false,
    fresh: () => ({ kind: 'portal', pair: '' }),
  },
  script: {
    label: 'Script',
    summary: 'Anything the engine can do, written out: effects, a check with its outcomes, a key.',
    object: (fn) => ({
      kind: fn.object,
      name: fn.name,
      flavor: fn.flavor,
      blocksMovement: fn.blocksMovement,
      effects: fn.effects,
      ...(fn.check === undefined ? {} : { check: fn.check }),
      repeatable: fn.repeatable,
      ...(fn.requiresKey === undefined ? {} : { requiresKey: fn.requiresKey }),
      lockedText: fn.lockedText,
      ...(fn.goto === undefined ? {} : { goto: fn.goto }),
      tags: fn.tags,
      data: fn.data,
    }),
    steps: (fn) => [...fn.effects, ...(fn.check === undefined ? [] : [{ kind: 'check' as const, check: fn.check }])],
    opens: (fn) => fn.object === 'door',
    fresh: () => ({ kind: 'script', object: 'scripted', name: '', flavor: '', blocksMovement: true, effects: [], repeatable: false, lockedText: '', tags: [], data: {} }),
  },
};

export function definitionOf<F extends PropFunction>(fn: F): PropFunctionDef<F> {
  return PROP_FUNCTIONS[fn.kind] as unknown as PropFunctionDef<F>;
}

/** The functions in the order the editor offers them. Script last: it is the one to reach for when nothing else fits. */
export const FUNCTION_KINDS: readonly PropFunctionKind[] = ['container', 'door', 'trapped', 'portal', 'script'];

/** A prop that can be used: one with a function and the id its state is kept by. */
export type UsableProp = Deco & { id: string; function: PropFunction };

export function isUsable(deco: Deco): deco is UsableProp {
  return deco.function !== undefined && deco.id !== undefined;
}

/** The object a usable prop plays as. */
export function objectOfProp(prop: UsableProp): Interactable {
  const behaviour = definitionOf(prop.function).object(prop.function, prop.id, prop);
  return {
    name: '',
    flavor: '',
    effects: [],
    lockedText: '',
    tags: [],
    data: {},
    ...behaviour,
    id: prop.id,
    position: prop.position,
    // Drawn as the prop it is, never a second time as an object.
    model: null,
    rotation: prop.rotation,
  };
}

/**
 * Every usable thing in a room: the objects it still has, and the props with a function. What the
 * game reads wherever it used to read `scene.interactables`.
 */
export function interactablesOf(scene: Pick<SceneDoc, 'interactables' | 'decos'>): Interactable[] {
  return [...scene.interactables, ...scene.decos.filter(isUsable).map(objectOfProp)];
}

/** Every tile a usable thing covers, for the ones that cover more than the tile they stand on. */
export function footprintOf(scene: Pick<SceneDoc, 'decos'>, id: string): { x: number; y: number }[] {
  const prop = scene.decos.find((deco) => deco.id === id && deco.function !== undefined);
  return prop === undefined ? [] : decoFootprint(prop);
}

/** The first function of a kind anywhere in a function, nested ones included. */
export function findFunction<K extends PropFunctionKind>(fn: PropFunction | undefined, kind: K): Of<K> | undefined {
  if (fn === undefined) return undefined;
  if (fn.kind === kind) return fn as Of<K>;
  if (fn.kind === 'trapped') return findFunction(fn.success, kind) ?? findFunction(fn.failure, kind);
  return undefined;
}

/** What a container holds, wherever in a prop's function the container is. */
export function containerItems(fn: PropFunction | undefined): readonly ContainerItem[] {
  return findFunction(fn, 'container')?.items ?? [];
}

/** Every pair id a function answers to, nested portals included. */
export function pairsOf(fn: PropFunction | undefined): string[] {
  if (fn === undefined) return [];
  if (fn.kind === 'portal') return [fn.pair];
  if (fn.kind === 'trapped') return [...pairsOf(fn.success), ...pairsOf(fn.failure)];
  return [];
}

/** As much of a project as pairing looks at: its rooms and what stands in them. */
type Rooms = { readonly scenes: readonly { readonly id: string; readonly decos: readonly Deco[] }[] };

/** Every portal in a project with this pair id, and the room it stands in. An empty id pairs with nothing. */
export function portalsWith(project: Rooms, pair: string): { scene: string; prop: UsableProp }[] {
  const found: { scene: string; prop: UsableProp }[] = [];
  if (pair.trim() === '') return found;
  for (const scene of project.scenes) {
    for (const deco of scene.decos) if (isUsable(deco) && pairsOf(deco.function).includes(pair)) found.push({ scene: scene.id, prop: deco });
  }
  return found;
}

/** The other end of a pair from this prop, or nothing when it has none yet. */
export function portalPartner(project: Rooms, pair: string, from: string | null): { scene: string; prop: UsableProp } | null {
  return portalsWith(project, pair).find((portal) => portal.prop.id !== from) ?? null;
}

/**
 * Whether a pair id can be given to this prop: a pair is two, so an id two *other* props already
 * answer to is taken. Hands back the props that hold it, for the editor to name.
 */
export function pairTaken(project: Rooms, pair: string, self: string | undefined): string[] {
  const others = portalsWith(project, pair).filter((portal) => portal.prop.id !== self);
  return others.length >= 2 ? others.map((portal) => portal.prop.id) : [];
}

/** What each kind of object is drawn with when it names no model of its own. */
export const OBJECT_BODIES: Readonly<Record<string, string>> = { door: 'door-prop', chest: 'chest-prop', pillar: 'pillar', portal: 'portal-prop' };

/**
 * Turn a room's objects into props, each with a Script function that says everything the object
 * said. Same id, same place, same facing, same behaviour - `objectOfProp` gives back the object it
 * was - so a save that remembers a door opened by its id still finds it open.
 *
 * An object with nothing to draw it with stays an object. A prop is drawn, and a `scripted` object
 * with no model was never drawn in play at all: giving it a body would make it appear.
 *
 * Changes the room in place and says whether it changed anything, so a caller can tell a project
 * that still had objects from one that never did.
 */
export function objectsToProps(scene: Pick<SceneDoc, 'interactables' | 'decos'>): boolean {
  const kept: Interactable[] = [];
  let changed = false;
  for (const object of scene.interactables) {
    const model = object.model ?? OBJECT_BODIES[object.kind];
    if (model === undefined) {
      kept.push(object);
      continue;
    }
    scene.decos.push({
      id: object.id,
      model,
      position: { ...object.position },
      rotation: object.rotation,
      function: {
        kind: 'script',
        object: object.kind,
        name: object.name,
        flavor: object.flavor,
        blocksMovement: object.blocksMovement,
        effects: object.effects,
        ...(object.check === undefined ? {} : { check: object.check }),
        repeatable: object.repeatable,
        ...(object.requiresKey === undefined ? {} : { requiresKey: object.requiresKey }),
        lockedText: object.lockedText,
        ...(object.goto === undefined ? {} : { goto: object.goto }),
        tags: object.tags,
        data: object.data,
      },
    });
    changed = true;
  }
  scene.interactables = kept;
  return changed;
}
