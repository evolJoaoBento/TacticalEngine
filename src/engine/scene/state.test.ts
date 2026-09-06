import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import { Pathfinder } from '../grid/pathfinding';
import { createFear } from '../rules/resources';
import { blankScene } from './grid-from-scene';
import { sceneSchema } from './schema';
import {
  SceneState,
  createAdversaryEntity,
  createPartyEntity,
  sceneStateFromScene,
  type Faction,
} from './state';

const makeState = (width = 5, height = 3) =>
  new SceneState({ id: 'room' }, new TileGrid({ width, height }));

describe('SceneState entities', () => {
  it('adds, finds and removes entities', () => {
    const state = makeState();
    state.addEntity(createPartyEntity('kara', 'sentinel', 0));
    expect(state.entity('kara')?.faction).toBe('party');
    expect(state.allEntities()).toHaveLength(1);
    expect(state.removeEntity('kara')).toBe(true);
    expect(state.removeEntity('kara')).toBe(false);
    expect(state.entity('kara')).toBeUndefined();
  });

  it('refuses to add the same id twice', () => {
    const state = makeState();
    state.addEntity(createPartyEntity('kara', 'sentinel', 0));
    expect(() => state.addEntity(createPartyEntity('kara', 'sentinel', 1))).toThrow(/already/);
  });

  it('filters by faction', () => {
    const state = makeState();
    state.addEntity(createPartyEntity('kara', 'sentinel', 0));
    state.addEntity(createAdversaryEntity('husk-1', 'hollow-husk', 4, { hitPoints: 5, stress: 3 }));
    expect(state.entitiesOf('party').map((e) => e.id)).toEqual(['kara']);
    expect(state.entitiesOf('adversary').map((e) => e.id)).toEqual(['husk-1']);
  });

  it('gives a party member Hope and an adversary none', () => {
    const state = makeState();
    state.addEntity(createPartyEntity('kara', 'sentinel', 0));
    state.addEntity(createAdversaryEntity('husk-1', 'hollow-husk', 4, { hitPoints: 5, stress: 3 }));
    expect(state.entity('kara')!.hope!.value).toBe(2);
    expect(state.entity('husk-1')!.hope).toBeUndefined();
  });
});

describe('occupancy index', () => {
  it('follows an entity as it moves', () => {
    const state = makeState();
    state.addEntity(createPartyEntity('kara', 'sentinel', 0));
    expect(state.occupantsOf(0)).toEqual(['kara']);
    state.moveEntity('kara', 7);
    expect(state.occupantsOf(0)).toEqual([]);
    expect(state.occupantsOf(7)).toEqual(['kara']);
    expect(state.entity('kara')!.tile).toBe(7);
  });

  it('empties when an entity is removed', () => {
    const state = makeState();
    state.addEntity(createPartyEntity('kara', 'sentinel', 3));
    state.removeEntity('kara');
    expect(state.occupantsOf(3)).toEqual([]);
    expect(state.isOccupied(3)).toBe(false);
  });

  it('ignores a move to the tile the entity is already on', () => {
    const state = makeState();
    state.addEntity(createPartyEntity('kara', 'sentinel', 2));
    state.moveEntity('kara', 2);
    expect(state.occupantsOf(2)).toEqual(['kara']);
  });

  it('throws when moving an entity that is not in the scene', () => {
    expect(() => makeState().moveEntity('ghost', 1)).toThrow(/no entity/);
  });

  it('does not count a fallen entity as occupying its tile', () => {
    const state = makeState();
    const husk = state.addEntity(
      createAdversaryEntity('husk-1', 'hollow-husk', 2, { hitPoints: 5, stress: 3 }),
    );
    expect(state.isOccupied(2)).toBe(true);
    husk.alive = false;
    expect(state.isOccupied(2)).toBe(false);
    expect(state.occupantsOf(2)).toEqual(['husk-1']); // the body is still there
  });
});

describe('blockedFor', () => {
  const setup = () => {
    const state = makeState();
    state.addEntity(createPartyEntity('kara', 'sentinel', 5));
    state.addEntity(createPartyEntity('finn', 'nightwalker', 6));
    state.addEntity(createAdversaryEntity('husk-1', 'hollow-husk', 7, { hitPoints: 5, stress: 3 }));
    return state;
  };

  it('blocks every other living creature by default', () => {
    const blocked = setup().blockedFor('kara');
    expect(blocked(5)).toBe(false); // its own tile
    expect(blocked(6)).toBe(true);
    expect(blocked(7)).toBe(true);
    expect(blocked(8)).toBe(false);
  });

  it('lets a mover pass factions the caller marks transparent', () => {
    const passAllies: Faction[] = ['party'];
    const blocked = setup().blockedFor('kara', passAllies);
    expect(blocked(6)).toBe(false);
    expect(blocked(7)).toBe(true);
  });

  it('stops blocking once a creature falls', () => {
    const state = setup();
    state.entity('husk-1')!.alive = false;
    expect(state.blockedFor('kara')(7)).toBe(false);
  });

  it('blocks tiles held by an interactable that blocks movement', () => {
    const state = setup();
    state.setInteractableBlocking(9, true);
    expect(state.blockedFor('kara')(9)).toBe(true);
    state.setInteractableBlocking(9, false);
    expect(state.blockedFor('kara')(9)).toBe(false);
  });

  it('drives the pathfinder without the grid changing', () => {
    const state = makeState(5, 3);
    // A wall of creatures down the middle column.
    state.addEntity(createAdversaryEntity('a', 'hollow-husk', state.grid.indexOf(2, 0), { hitPoints: 1, stress: 1 }));
    state.addEntity(createAdversaryEntity('b', 'hollow-husk', state.grid.indexOf(2, 1), { hitPoints: 1, stress: 1 }));
    state.addEntity(createAdversaryEntity('c', 'hollow-husk', state.grid.indexOf(2, 2), { hitPoints: 1, stress: 1 }));
    state.addEntity(createPartyEntity('kara', 'sentinel', state.grid.indexOf(0, 1)));

    const pathfinder = new Pathfinder(state.grid);
    const field = pathfinder.reachable(state.grid.indexOf(0, 1), 20, {
      isBlocked: state.blockedFor('kara'),
    });
    expect(field.canReach(state.grid.indexOf(4, 1))).toBe(false);

    state.entity('b')!.alive = false;
    const after = pathfinder.reachable(state.grid.indexOf(0, 1), 20, {
      isBlocked: state.blockedFor('kara'),
    });
    expect(after.canReach(state.grid.indexOf(4, 1))).toBe(true);
  });
});

describe('interactable, encounter, flag and key state', () => {
  it('creates state lazily and keeps it per id', () => {
    const state = makeState();
    expect(state.interactable('chest')).toEqual({
      used: false,
      open: false,
      removed: false,
      data: {},
    });
    state.interactable('chest').open = true;
    expect(state.interactable('chest').open).toBe(true);
    expect(state.interactable('door').open).toBe(false);
  });

  it('tracks encounters separately', () => {
    const state = makeState();
    state.encounter('group-1').started = true;
    expect(state.encounter('group-1').started).toBe(true);
    expect(state.encounter('group-2').started).toBe(false);
  });

});

describe('snapshot and restore', () => {
  const populate = (state: SceneState): SceneState => {
    state.addEntity(createPartyEntity('kara', 'sentinel', 5));
    state.addEntity(createAdversaryEntity('husk-1', 'hollow-husk', 7, { hitPoints: 5, stress: 3 }));
    state.entity('kara')!.conditions.add('vulnerable');
    state.entity('husk-1')!.hitPoints.marked = 2;
    state.interactable('chest').open = true;
    state.interactable('pillar').data['lit'] = true;
    state.encounter('group-1').started = true;
    state.fear = createFear(4);
    return state;
  };

  it('produces JSON-safe data — the legacy Sets could not be serialised', () => {
    const snapshot = populate(makeState()).snapshot();
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(snapshot.entities['kara']!.conditions).toEqual(['vulnerable']);
    expect(snapshot.fear.value).toBe(4);
  });

  it('round-trips through JSON, rebuilding the occupancy index', () => {
    const original = populate(makeState());
    const json = JSON.parse(JSON.stringify(original.snapshot())) as ReturnType<
      SceneState['snapshot']
    >;

    const restored = makeState();
    restored.restore(json);

    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restored.occupantsOf(5)).toEqual(['kara']);
    expect(restored.occupantsOf(7)).toEqual(['husk-1']);
    expect(restored.entity('kara')!.conditions.has('vulnerable')).toBe(true);
    expect(restored.entity('husk-1')!.hitPoints.marked).toBe(2);
    expect(restored.interactable('pillar').data['lit']).toBe(true);
  });

  it('replaces previous state on restore rather than merging into it', () => {
    const state = populate(makeState());
    state.restore({
      sceneId: 'room',
      entities: {},
      interactables: {},
      encounters: {},
      fear: createFear(0),
    });
    expect(state.allEntities()).toEqual([]);
    expect(state.occupantsOf(5)).toEqual([]);
    expect(state.interactable('chest').open).toBe(false);
  });

  it('does not alias the snapshot into live state', () => {
    const original = populate(makeState());
    const snapshot = original.snapshot();
    original.interactable('chest').data['x'] = 1;
    expect(snapshot.interactables['chest']!.data).toEqual({});
  });

  it('stops a smashed-open door blocking again after a restore', () => {
    // The blocking index is built from the document, so it comes back believing
    // every door is still standing. Only the snapshot knows which ones are not.
    const state = makeState();
    state.placeInteractable('door', 9);
    state.setInteractableBlocking(9, true);
    state.interactable('door').removed = true;
    const snapshot = state.snapshot();

    const restored = makeState();
    restored.placeInteractable('door', 9);
    restored.setInteractableBlocking(9, true);
    restored.restore(snapshot);
    expect(restored.blockedFor('nobody')(9)).toBe(false);
  });

  it('keeps an opened chest in the way', () => {
    // Open is not gone: an opened chest still sits where it sat. Only the things
    // registered as walk-through-when-open — doors — clear their tile.
    const state = makeState();
    state.placeInteractable('chest', 9);
    state.setInteractableBlocking(9, true);
    state.openInteractable('chest');
    expect(state.blockedFor('nobody')(9)).toBe(true);

    const restored = makeState();
    restored.placeInteractable('chest', 9);
    restored.setInteractableBlocking(9, true);
    restored.restore(state.snapshot());
    expect(restored.blockedFor('nobody')(9)).toBe(true);
  });

  it('lets an opened door through, and still lets it through after a restore', () => {
    // Opening a door has to clear its tile, and every way back into the room —
    // a snapshot restored, a save reloaded — has to agree, because the blocking
    // index is rebuilt from a document that still says the door is shut.
    const state = makeState();
    state.placeInteractable('door', 9, true);
    state.setInteractableBlocking(9, true);
    expect(state.blockedFor('nobody')(9)).toBe(true);
    state.openInteractable('door');
    expect(state.blockedFor('nobody')(9)).toBe(false);

    const restored = makeState();
    restored.placeInteractable('door', 9, true);
    restored.setInteractableBlocking(9, true);
    restored.restore(state.snapshot());
    expect(restored.blockedFor('nobody')(9)).toBe(false);
  });

  // Flags and keys are the campaign's, not the room's: a scene snapshot must not
  // carry them, or returning to a room would restore stale ones over the real.
  it('leaves flags and keys out of a scene snapshot entirely', () => {
    const snapshot = populate(makeState()).snapshot();
    expect(Object.keys(snapshot)).not.toContain('flags');
    expect(Object.keys(snapshot)).not.toContain('keys');
  });
});

describe('sceneStateFromScene', () => {
  const scene = sceneSchema.parse({
    ...blankScene('room', 6, 3),
    spawns: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ],
    interactables: [
      { id: 'door', kind: 'door', position: { x: 3, y: 1 } },
      { id: 'rug', kind: 'scripted', position: { x: 4, y: 1 }, blocksMovement: false },
    ],
    encounters: [
      {
        id: 'group-1',
        adversaries: [
          { id: 'bramble-a', adversary: 'tangle-bramble', position: { x: 5, y: 0 } },
          { id: 'bramble-b', adversary: 'tangle-bramble', position: { x: 5, y: 2 } },
        ],
      },
    ],
  });

  const stats = new Map([['tangle-bramble', { id: 'tangle-bramble', hitPoints: 1, stress: 3 }]]);
  const build = (options: Parameters<typeof sceneStateFromScene>[2] = {}) =>
    sceneStateFromScene(scene, new TileGrid({ width: 6, height: 3 }), {
      adversaries: stats,
      ...options,
    });

  it('places every adversary with its stat block', () => {
    const { state, issues } = build();
    expect(issues).toEqual([]);
    expect(state.entitiesOf('adversary').map((e) => e.id)).toEqual(['bramble-a', 'bramble-b']);
    expect(state.entity('bramble-a')!.hitPoints.max).toBe(1);
    expect(state.entity('bramble-a')!.stress.max).toBe(3);
    expect(state.entity('bramble-a')!.tile).toBe(state.grid.indexOf(5, 0));
  });

  it('leaves the encounter unstarted — adversaries stand there dormant', () => {
    const { state } = build();
    expect(state.encounter('group-1').started).toBe(false);
  });

  it('honours a per-placement Hit Point override', () => {
    const wounded = sceneSchema.parse({
      ...scene,
      encounters: [
        {
          id: 'group-1',
          adversaries: [
            {
              id: 'bramble-a',
              adversary: 'tangle-bramble',
              position: { x: 5, y: 0 },
              hitPoints: 4,
            },
          ],
        },
      ],
    });
    const { state } = sceneStateFromScene(wounded, new TileGrid({ width: 6, height: 3 }), {
      adversaries: stats,
    });
    expect(state.entity('bramble-a')!.hitPoints.max).toBe(4);
  });

  it('reports a placement whose stat block is missing, and keeps the rest', () => {
    const { state, issues } = build({ adversaries: new Map() });
    expect(state.entitiesOf('adversary')).toEqual([]);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ entry: 'bramble-a', field: 'adversary' });
    expect(issues[0]!.message).toMatch(/no stat block for adversary "tangle-bramble"/);
  });

  it('registers only the interactables that block movement', () => {
    const { state } = build();
    const blocked = state.blockedFor('nobody');
    expect(blocked(state.grid.indexOf(3, 1))).toBe(true);
    expect(blocked(state.grid.indexOf(4, 1))).toBe(false);
  });

  it('seats the party on the spawn points, repeating them when it runs out', () => {
    const { state } = build({
      party: [
        createPartyEntity('kara', 'sentinel', -1),
        createPartyEntity('finn', 'nightwalker', -1),
        createPartyEntity('mira', 'seer', -1),
      ],
    });
    expect(state.entity('kara')!.tile).toBe(state.grid.indexOf(0, 0));
    expect(state.entity('finn')!.tile).toBe(state.grid.indexOf(0, 1));
    expect(state.entity('mira')!.tile).toBe(state.grid.indexOf(0, 0));
    expect([...state.occupantsOf(state.grid.indexOf(0, 0))].sort()).toEqual(['kara', 'mira']);
  });

  it('carries the GM Fear in from the previous scene', () => {
    expect(build({ fear: createFear(7) }).state.fear.value).toBe(7);
    expect(build().state.fear.value).toBe(0);
  });

  it('produces a state the pathfinder can route around', () => {
    const { state } = build({ party: [createPartyEntity('kara', 'sentinel', -1)] });
    const pathfinder = new Pathfinder(state.grid);
    const field = pathfinder.reachable(state.entity('kara')!.tile, Infinity, {
      isBlocked: state.blockedFor('kara'),
    });
    // The door blocks (3, 1); the route detours around it.
    expect(field.canReach(state.grid.indexOf(3, 1))).toBe(false);
    expect(field.canReach(state.grid.indexOf(4, 1))).toBe(true);
    // The brambles hold their own tiles.
    expect(field.canReach(state.grid.indexOf(5, 0))).toBe(false);
  });
});
