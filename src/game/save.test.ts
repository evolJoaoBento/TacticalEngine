import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { tileOf } from '../engine/scene/grid-from-scene';
import {
  answerPending,
  buildDemoScene,
  startEncounter,
  travelTo,
  useSelectedOn,
  type DemoScene,
} from './demo-scene';
import { PIT_SCENE_ID } from './demo-scenes';
import { loadGame, loadGameText, saveBlockedBy, saveGame, saveSchema } from './save';

/**
 * Putting a campaign down and picking it up again.
 *
 * The thing under test is not "does it round-trip" — a JSON copy round-trips —
 * but whether what comes back is the same *game*: the same dice ahead of you,
 * the same wounds, the same rooms left the way you left them.
 */

const CHEST = 'chest-19-13';
const scene = (seed = 'demo'): DemoScene => buildDemoScene(demoMap(), seed);

function stand(demo: DemoScene, id: string): void {
  const object = demo.scene.interactables.find((i) => i.id === id)!;
  demo.state.moveEntity(
    demo.party.selected!,
    tileOf(demo.grid, { x: object.position.x - 1, y: object.position.y }),
  );
}

/** Open the vault chest, rolling if it asks. */
function loot(demo: DemoScene): void {
  stand(demo, CHEST);
  useSelectedOn(demo, CHEST);
  if (demo.pending !== null) answerPending(demo, { kind: 'roll' });
}

/** Save, put it through JSON, and load it into a scene built from scratch. */
function reload(demo: DemoScene, seed = 'demo'): DemoScene {
  const text = JSON.stringify(saveGame(demo));
  const fresh = scene(seed);
  const result = loadGameText(fresh, text);
  expect(result).toEqual({ ok: true });
  return fresh;
}

describe('saving a game', () => {
  it('names the project, the room, and where the dice had got to', () => {
    const demo = scene();
    const save = saveGame(demo)!;
    expect(save.projectId).toBe(demo.project.id);
    expect(save.sceneId).toBe(demo.scene.id);
    expect(save.rng).toBe(demo.rng.save());
    expect(saveSchema.parse(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('includes the room being played, not only the ones left behind', () => {
    const demo = scene();
    // `snapshots` is "rooms I have left"; a save that trusted it would reload
    // into a pristine version of the room you were standing in.
    expect(demo.snapshots.size).toBe(0);
    expect(Object.keys(saveGame(demo)!.scenes)).toEqual([demo.scene.id]);
  });

  it('refuses mid-fight', () => {
    const demo = scene();
    const encounter = demo.scene.encounters[0]!;
    startEncounter(demo, encounter.id);
    expect(saveBlockedBy(demo)).toMatch(/fight/);
    expect(saveGame(demo)).toBeNull();
  });

  it('refuses while a script is waiting on an answer', () => {
    const demo = scene();
    stand(demo, CHEST);
    useSelectedOn(demo, CHEST);
    expect(demo.pending).not.toBeNull();
    expect(saveBlockedBy(demo)).toMatch(/conversation/);
    expect(saveGame(demo)).toBeNull();
  });
});

describe('loading a game', () => {
  it('comes back in the same room, with the same log', () => {
    const demo = scene();
    loot(demo);
    travelTo(demo, PIT_SCENE_ID);

    const back = reload(demo);
    expect(back.scene.id).toBe(PIT_SCENE_ID);
    expect(back.log).toEqual(demo.log);
  });

  it('carries the pack, the flags and the variables', () => {
    const demo = scene();
    loot(demo);
    demo.scenario.flags.add('warden-appeased');
    demo.scenario.variables['mood'] = 'grim';
    expect(demo.scenario.items.size).toBeGreaterThan(0);

    const back = reload(demo);
    expect([...back.scenario.items]).toEqual([...demo.scenario.items]);
    expect([...back.scenario.flags]).toEqual([...demo.scenario.flags]);
    expect(back.scenario.variables).toEqual(demo.scenario.variables);
  });

  it('refills the scenario in place, so the live room still reads it', () => {
    const demo = scene();
    const scenario = demo.scenario;
    loot(demo);
    const back = reload(demo);

    // The world the loaded scene is playing with has to be looking at the same
    // object the save filled, or a `hasItem` check in that room reads nothing.
    expect(back.world.scenario).toBe(back.scenario);
    for (const [id, quantity] of back.scenario.items) {
      expect(back.world.hasItem(id, quantity)).toBe(true);
    }
    // And the object identity survived the load rather than being replaced.
    expect(demo.scenario).toBe(scenario);
  });

  it('leaves the party where it stood, not on the spawns', () => {
    const demo = scene();
    const mover = demo.party.selected!;
    stand(demo, CHEST);
    const tile = demo.state.entity(mover)!.tile;
    const spawns = demo.scene.spawns.map((p) => tileOf(demo.grid, p));
    expect(spawns).not.toContain(tile);

    const back = reload(demo);
    expect(back.state.entity(mover)!.tile).toBe(tile);
  });

  it('remembers wounds', () => {
    const demo = scene();
    const wounded = demo.party.selected!;
    demo.state.entity(wounded)!.hitPoints.marked = 2;
    demo.state.entity(wounded)!.stress.marked = 3;

    const back = reload(demo);
    expect(back.state.entity(wounded)!.hitPoints.marked).toBe(2);
    expect(back.state.entity(wounded)!.stress.marked).toBe(3);
  });

  it('remembers rooms that are not the one being played', () => {
    const demo = scene();
    loot(demo);
    expect(demo.state.interactable(CHEST).used).toBe(true);
    const vault = demo.scene.id;
    travelTo(demo, PIT_SCENE_ID);

    const back = reload(demo);
    expect(back.scene.id).toBe(PIT_SCENE_ID);
    expect(back.snapshots.get(vault)!.interactables[CHEST]!.used).toBe(true);
    // And going back finds it that way.
    travelTo(back, vault);
    expect(back.state.interactable(CHEST).used).toBe(true);
  });

  it('picks the dice stream up where it stopped', () => {
    // The point of saving the RNG position: what happens next has to be what
    // would have happened next. A save that only copied the seed would replay
    // rolls the session already spent.
    const demo = scene();
    // Spend dice first, so a load that only copied the seed would be rolling
    // numbers this session already used.
    demo.rng.dice(6, 12);
    const back = reload(demo);
    loot(demo);
    loot(back);
    expect(back.log.map((l) => l.text)).toEqual(demo.log.map((l) => l.text));
    expect([...back.scenario.items]).toEqual([...demo.scenario.items]);
  });

  it('does not simply restart the seed', () => {
    const demo = scene();
    // Spend some dice, then save; loading and rolling must not repeat them.
    demo.rng.dice(6, 12);
    const back = reload(demo);
    expect(back.rng.save()).toBe(demo.rng.save());
    expect(back.rng.save()).not.toBe(scene().rng.save());
  });

  it('refuses a save that belongs to another project', () => {
    const demo = scene();
    const save = saveGame(demo)!;
    const result = loadGame(scene(), { ...save, projectId: 'someone-elses-campaign' });
    expect(result.ok).toBe(false);
  });

  it('refuses a save with no state for the room it names', () => {
    const demo = scene();
    const save = saveGame(demo)!;
    const result = loadGame(scene(), { ...save, sceneId: PIT_SCENE_ID });
    expect(result.ok).toBe(false);
  });

  it('reports damaged text rather than throwing', () => {
    expect(loadGameText(scene(), 'not json at all').ok).toBe(false);
    expect(loadGameText(scene(), '{"formatVersion":2}').ok).toBe(false);
  });

  it('drops a fight and a pending prompt on load', () => {
    const demo = scene();
    const save = saveGame(demo)!;
    const playing = scene();
    stand(playing, CHEST);
    useSelectedOn(playing, CHEST);
    expect(playing.pending).not.toBeNull();

    expect(loadGame(playing, save).ok).toBe(true);
    expect(playing.pending).toBeNull();
    expect(playing.encounter).toBeNull();
  });
});
