import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import { Pathfinder } from '../grid/pathfinding';
import { createFear } from '../rules/resources';
import {
  SceneState,
  createAdversaryEntity,
  createPartyEntity,
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

  it('records flags and keys', () => {
    const state = makeState();
    expect(state.hasFlag('met-hag')).toBe(false);
    state.setFlag('met-hag');
    expect(state.hasFlag('met-hag')).toBe(true);
    state.giveKey('brass');
    expect(state.hasKey('brass')).toBe(true);
    expect(state.hasKey('iron')).toBe(false);
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
    state.setFlag('met-hag');
    state.giveKey('brass');
    state.fear = createFear(4);
    return state;
  };

  it('produces JSON-safe data — the legacy Sets could not be serialised', () => {
    const snapshot = populate(makeState()).snapshot();
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(snapshot.entities['kara']!.conditions).toEqual(['vulnerable']);
    expect(snapshot.flags).toEqual(['met-hag']);
    expect(snapshot.keys).toEqual(['brass']);
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
    expect(restored.hasKey('brass')).toBe(true);
  });

  it('replaces previous state on restore rather than merging into it', () => {
    const state = populate(makeState());
    state.restore({
      sceneId: 'room',
      entities: {},
      interactables: {},
      encounters: {},
      flags: [],
      keys: [],
      fear: createFear(0),
    });
    expect(state.allEntities()).toEqual([]);
    expect(state.hasFlag('met-hag')).toBe(false);
    expect(state.occupantsOf(5)).toEqual([]);
    expect(state.interactable('chest').open).toBe(false);
  });

  it('does not alias the snapshot into live state', () => {
    const original = populate(makeState());
    const snapshot = original.snapshot();
    original.setFlag('later');
    original.interactable('chest').data['x'] = 1;
    expect(snapshot.flags).toEqual(['met-hag']);
    expect(snapshot.interactables['chest']!.data).toEqual({});
  });
});
