import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { tileOf } from '../engine/scene/grid-from-scene';
import {
  answerPending,
  buildDemoScene,
  useSelectedOn,
  type DemoScene,
} from './demo-scene';
import { DEMO_STAIR_ID } from './demo-rules';
import { travelTo } from './room';
import { PIT_SCENE_ID } from './demo-scenes';

/**
 * Leaving a room and coming back.
 *
 * The campaign is the thing under test here, not the scene: what has to survive
 * a doorway is the party's wounds, the keys they carry, the flags they set, and
 * the state of everything they left behind.
 */

const CHEST = 'chest-19-13';
const scene = (seed = 'demo'): DemoScene => buildDemoScene(demoMap(), seed);
const vaultId = (demo: DemoScene): string => demo.project.scenes[0]!.id;

function stand(demo: DemoScene, id: string): void {
  const object = demo.scene.interactables.find((i) => i.id === id)!;
  demo.state.moveEntity(
    demo.party.selected!,
    tileOf(demo.grid, { x: object.position.x - 1, y: object.position.y }),
  );
}

/** The vault's door, and the tile it stands on. */
function doorTile(demo: DemoScene): number {
  const door = demo.scene.interactables.find((i) => i.kind === 'door')!;
  return tileOf(demo.grid, door.position);
}

describe('travelling between scenes', () => {
  it('ships two scenes in one project', () => {
    const demo = scene();
    expect(demo.project.scenes.map((s) => s.id)).toContain(PIT_SCENE_ID);
    expect(demo.project.scenes.length).toBe(2);
  });

  it('arrives in the other room, on its spawns', () => {
    const demo = scene();
    const vault = demo.scene.id;
    expect(travelTo(demo, PIT_SCENE_ID)).toBe(true);

    expect(demo.scene.id).toBe(PIT_SCENE_ID);
    expect(demo.scene.id).not.toBe(vault);
    // The grid, pathfinder and party all belong to the new room.
    expect(demo.grid.width).toBe(demo.scene.width);
    const tiles = demo.scene.spawns.map((p) => tileOf(demo.grid, p));
    for (const id of demo.party.members()) {
      expect(tiles).toContain(demo.state.entity(id)!.tile);
    }
  });

  it('reads the arriving scene’s intro, which nothing ever read before', () => {
    const demo = scene();
    travelTo(demo, PIT_SCENE_ID);
    expect(demo.log.some((l) => l.text.includes('round chamber'))).toBe(true);
  });

  it('refuses to travel nowhere, or to the room it is already in', () => {
    const demo = scene();
    expect(travelTo(demo, 'no-such-scene')).toBe(false);
    expect(travelTo(demo, demo.scene.id)).toBe(false);
  });

  it('carries wounds through the door', () => {
    const demo = scene();
    const hurt = demo.party.selected!;
    demo.state.entity(hurt)!.hitPoints.marked = 2;
    demo.state.entity(hurt)!.stress.marked = 1;

    travelTo(demo, PIT_SCENE_ID);

    expect(demo.state.entity(hurt)!.hitPoints.marked).toBe(2);
    expect(demo.state.entity(hurt)!.stress.marked).toBe(1);
  });

  it('carries the GM’s Shadow, which is the session’s and not the room’s', () => {
    const demo = scene();
    demo.state.bad = { ...demo.state.bad, value: 4 };
    travelTo(demo, PIT_SCENE_ID);
    expect(demo.state.bad.value).toBe(4);
  });

  it('carries flags and keys, so a key found here opens a door there', () => {
    const demo = scene();
    demo.world.giveKey('wardens-word');
    demo.world.setFlag('met-the-warden');

    travelTo(demo, PIT_SCENE_ID);

    // The world was rebuilt for the new room; the campaign state was not.
    expect(demo.world.hasKey('wardens-word')).toBe(true);
    expect(demo.world.hasFlag('met-the-warden')).toBe(true);
  });

  it('leaves a room as it was found on returning to it', () => {
    const demo = scene();
    stand(demo, CHEST);
    useSelectedOn(demo, CHEST);
    answerPending(demo, { kind: 'roll' });
    expect(demo.world.interactableState(CHEST).used).toBe(true);

    const vault = demo.scene.id;
    travelTo(demo, PIT_SCENE_ID);
    travelTo(demo, vault);

    // The chest is still open; the room remembered.
    expect(demo.scene.id).toBe(vault);
    expect(demo.world.interactableState(CHEST).used).toBe(true);
    // Walk back over to it — arriving puts the party on the spawns.
    stand(demo, CHEST);
    expect(useSelectedOn(demo, CHEST).status).toBe('refused');
  });

  it('finds the vault door still open on the way back', () => {
    // Coming back rebuilds the room from a document that says the door is shut,
    // then restores the snapshot over it. If only the snapshot's flags came back
    // and not the tile it cleared, the party would be walled in on return.
    const demo = scene();
    const tile = doorTile(demo);
    const mover = demo.party.selected!;
    const vault = demo.scene.id;
    demo.world.openInteractable(demo.scene.interactables.find((i) => i.kind === 'door')!.id);
    expect(demo.state.blockedFor(mover)(tile)).toBe(false);

    travelTo(demo, PIT_SCENE_ID);
    travelTo(demo, vault);
    expect(doorTile(demo)).toBe(tile);
    expect(demo.state.blockedFor(mover)(tile)).toBe(false);
  });

  it('puts the party on the spawns when it comes back, not where it left', () => {
    const demo = scene();
    const vault = demo.scene.id;
    stand(demo, CHEST);
    const away = demo.state.entity(demo.party.selected!)!.tile;

    travelTo(demo, PIT_SCENE_ID);
    travelTo(demo, vault);

    // A restored snapshot must not bring back stale party entities.
    expect(demo.state.entitiesOf('party').length).toBe(demo.party.members().length);
    const spawns = demo.scene.spawns.map((p) => tileOf(demo.grid, p));
    expect(spawns).toContain(demo.state.entity(demo.party.selected!)!.tile);
    expect(demo.state.entity(demo.party.selected!)!.tile).not.toBe(away);
  });

  it('locks the strongbox until the Warden gives up the word', () => {
    const demo = scene();
    travelTo(demo, PIT_SCENE_ID);
    stand(demo, 'strongbox');

    const locked = useSelectedOn(demo, 'strongbox');
    expect(locked.status).toBe('refused');
    expect(demo.log.at(-1)?.text).toContain('will not shift');

    demo.world.giveKey('wardens-word');
    expect(useSelectedOn(demo, 'strongbox').status).toBe('done');
  });

  it('travels when a portal is used, once the script has finished', () => {
    const demo = scene();
    stand(demo, DEMO_STAIR_ID);
    const result = useSelectedOn(demo, DEMO_STAIR_ID);

    expect(result.status).toBe('done');
    expect(demo.scene.id).toBe(PIT_SCENE_ID);
    expect(demo.destination).toBeNull();
  });

  it('makes the round trip on the two portals alone', () => {
    const demo = scene();
    const vault = demo.scene.id;
    stand(demo, DEMO_STAIR_ID);
    useSelectedOn(demo, DEMO_STAIR_ID);
    expect(demo.scene.id).toBe(PIT_SCENE_ID);

    stand(demo, 'stair-up');
    useSelectedOn(demo, 'stair-up');
    expect(demo.scene.id).toBe(vault);
  });

  it('abandons a fight rather than dragging it through the door', () => {
    const demo = scene();
    const encounter = demo.scene.encounters[0]!;
    const foe = encounter.adversaries[0]!.id;
    demo.state.entity(foe)!.hitPoints.marked = 3;

    travelTo(demo, PIT_SCENE_ID);
    expect(demo.encounter).toBeNull();

    // The adversary is where it was, still hurt, when the party comes back.
    travelTo(demo, vaultId(demo));
    expect(demo.state.entity(foe)!.hitPoints.marked).toBe(3);
  });

  it('replays identically from the same seed across a round trip', () => {
    const play = (): string => {
      const demo = scene('fixed');
      const vault = demo.scene.id;
      stand(demo, CHEST);
      useSelectedOn(demo, CHEST);
      answerPending(demo, { kind: 'roll' });
      travelTo(demo, PIT_SCENE_ID);
      travelTo(demo, vault);
      return JSON.stringify(demo.log);
    };
    expect(play()).toBe(play());
  });
});

describe('carrying things between rooms', () => {
  it('fills the pack when the vault chest is opened', () => {
    const demo = scene();
    stand(demo, CHEST);
    useSelectedOn(demo, CHEST);
    answerPending(demo, { kind: 'roll' });

    // The legacy chest's `loot` named no table until the demo gave it one.
    const carried = [...demo.scenario.items.entries()];
    expect(carried.length).toBeGreaterThan(0);
    expect(demo.log.some((l) => l.text.startsWith('You find'))).toBe(true);
  });

  it('carries the pack through a door', () => {
    const demo = scene();
    demo.world.addItem('gold', 30);
    travelTo(demo, PIT_SCENE_ID);
    expect(demo.world.itemCount('gold')).toBe(30);
  });

  it('opens the strongbox only for the word, and pays out when it does', () => {
    const demo = scene();
    travelTo(demo, PIT_SCENE_ID);
    stand(demo, 'strongbox');

    expect(useSelectedOn(demo, 'strongbox').status).toBe('refused');
    expect(demo.world.itemCount('gold')).toBe(0);

    // The word is what the Warden gives up, and it is an item like any other.
    demo.world.giveKey('wardens-word');
    expect(useSelectedOn(demo, 'strongbox').status).toBe('done');
    expect(demo.world.itemCount('gold')).toBeGreaterThan(0);
  });

  it('names what was found rather than saying something vague', () => {
    const demo = scene();
    travelTo(demo, PIT_SCENE_ID);
    stand(demo, 'strongbox');
    demo.world.giveKey('wardens-word');
    useSelectedOn(demo, 'strongbox');

    const line = demo.log.find((l) => l.text.startsWith('You find'))!;
    expect(line.text).toMatch(/Gold|draught|carapace/i);
  });
});
