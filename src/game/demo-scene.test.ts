import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { blankScene, tileOf } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import {
  answerPending,
  moveSelectedTo,
  buildDemoScene,
  reachableInteractable,
  useSelectedOn,
  type DemoScene,
} from './demo-scene';
import { scriptPending } from './moment';
import { worldOptions } from './room';

/**
 * Using the vault's own furniture.
 *
 * The legacy map authored three objects — a vault door on a Finesse 13, a
 * trapped chest on a Finesse 12, a pillar on a Strength 12 — and every one of
 * them was imported, validated, saved and never run, because nothing in the
 * engine could use a thing. These cover the verb over that real content rather
 * than over a fixture, so a change to the importer that quietly drops a check
 * fails here.
 */

const CHEST = 'chest-19-13';

/** Put the selected member next to something, so reach is not what is under test. */
function stand(demo: DemoScene, interactableId: string): void {
  const object = demo.scene.interactables.find((i) => i.id === interactableId)!;
  const beside = { x: object.position.x - 1, y: object.position.y };
  demo.state.moveEntity(demo.party.selected!, tileOf(demo.grid, beside));
}

const scene = (): DemoScene => buildDemoScene(demoMap());

describe('using the demo vault', () => {
  it('imported the authored checks that used to go nowhere', () => {
    const demo = scene();
    const chest = demo.scene.interactables.find((i) => i.id === CHEST)!;
    expect(chest.check?.trait).toBe('finesse');
    expect(chest.check?.difficulty).toBe(12);
    // Both halves of the roll were written by the original author.
    expect(chest.check?.onSuccessWithGood?.length).toBeGreaterThan(0);
    expect(chest.check?.onFailureWithBad?.length).toBeGreaterThan(0);
  });

  it('refuses a thing across the room', () => {
    const demo = scene();
    const result = useSelectedOn(demo, CHEST);
    expect(result.status).toBe('unreachable');
    expect(demo.log.at(-1)?.text).toBe('It is out of reach.');
  });

  it('stops for the roll when you are standing next to it', () => {
    const demo = scene();
    stand(demo, CHEST);
    const result = useSelectedOn(demo, CHEST);
    expect(result.status).toBe('waiting');
    expect(demo.pending?.prompt.kind).toBe('check');
    expect(scriptPending(demo)?.interactable).toBe(CHEST);
    // The chest's own words reached the log before the roll was asked for.
    expect(demo.log.some((l) => l.text.length > 0)).toBe(true);
  });

  it('resolves the roll and writes the authored outcome to the log', () => {
    const demo = scene();
    stand(demo, CHEST);
    useSelectedOn(demo, CHEST);
    const before = demo.log.length;
    const result = answerPending(demo, { kind: 'roll' });

    expect(result.status).toBe('done');
    expect(demo.pending).toBeNull();
    expect(demo.log.length).toBeGreaterThan(before);
    // One of those lines is the outcome of the duality roll.
    expect(demo.log.some((l) => /with (Light|Shadow)|critical/i.test(l.text))).toBe(true);
  });

  it('does not repeat the lines it already showed once the roll comes in', () => {
    const demo = scene();
    stand(demo, CHEST);
    useSelectedOn(demo, CHEST);
    answerPending(demo, { kind: 'roll' });

    // A runner's journal is cumulative, so the flavour shown before the roll is
    // in the journal again after it. The log should still hold it once.
    const counts = new Map<string, number>();
    for (const line of demo.log) counts.set(line.text, (counts.get(line.text) ?? 0) + 1);
    const repeated = [...counts.entries()].filter(([, n]) => n > 1);
    expect(repeated).toEqual([]);
  });

  it('marks the chest used, so it cannot be opened twice', () => {
    const demo = scene();
    stand(demo, CHEST);
    useSelectedOn(demo, CHEST);
    answerPending(demo, { kind: 'roll' });

    expect(demo.world.interactableState(CHEST).used).toBe(true);
    expect(useSelectedOn(demo, CHEST).status).toBe('refused');
  });

  it('holds the floor while a script is waiting on the player', () => {
    const demo = scene();
    stand(demo, CHEST);
    const before = demo.state.entity(demo.party.selected!)!.tile;
    useSelectedOn(demo, CHEST);
    expect(demo.pending).not.toBeNull();

    // Walking away from an open lock prompt and then rolling it would let a
    // player pick the lock from across the room.
    expect(moveSelectedTo(demo, before - 3).moved).toBe(false);
    expect(demo.state.entity(demo.party.selected!)!.tile).toBe(before);
    expect(useSelectedOn(demo, CHEST).status).toBe('busy');

    answerPending(demo, { kind: 'roll' });
    expect(demo.pending).toBeNull();
  });

  it('lets a player back out of the roll', () => {
    const demo = scene();
    stand(demo, CHEST);
    useSelectedOn(demo, CHEST);
    const result = answerPending(demo, { kind: 'cancel' });
    expect(result.status).toBe('done');
    expect(demo.pending).toBeNull();
  });

  it('names what is within reach, and nothing when there is nothing', () => {
    const demo = scene();
    expect(reachableInteractable(demo)).toBeNull();
    stand(demo, CHEST);
    expect(reachableInteractable(demo)).toBe(CHEST);
  });

  it('is replayable: the same seed opens the chest the same way', () => {
    const play = (): string => {
      const demo = buildDemoScene(demoMap(), 'fixed-seed');
      stand(demo, CHEST);
      useSelectedOn(demo, CHEST);
      answerPending(demo, { kind: 'roll' });
      return JSON.stringify(demo.log);
    };
    expect(play()).toBe(play());
  });

  it('rolls against the party sheets rather than a bare die', () => {
    const demo = scene();
    // The traits come from the derived characters, so a check is the party's
    // best hand at it — not an unmodified d12 pair.
    expect(demo.world.traitModifier('finesse')).not.toBe(0);
  });
});

describe('the conditions a project inherits', () => {
  it("knows the starter pack's and the engine's, under its own", () => {
    const project = projectSchema.parse({
      id: 'bare',
      name: 'Bare',
      scenes: [sceneSchema.parse(blankScene('room', 4, 4))],
      startScene: 'room',
      conditionDefs: [{ id: 'restrained', name: 'Pinned', text: 'The project says so.' }],
    });
    const defs = worldOptions(new Map(), undefined, undefined, project).conditionDefs ?? [];
    const named = new Map(defs.map((def) => [def.id, def.name]));
    // Hold the Line's two, and Warding Flame's ring, ship with the pack rather than the engine.
    expect(named.get('holding-the-line')).toBe('Holding the Line');
    expect(named.get('caught-in-the-line')).toBe('Caught');
    expect(named.get('warding-flame-ring')).toBe('Warding Flame');
    expect(named.has('vulnerable')).toBe(true);
    // The engine's own are the three its rules read; a card's or a stat block's travels with its pack.
    expect(SRD_CONDITIONS.map((def) => def.id)).toEqual(['vulnerable', 'hidden', 'restrained']);
    // The project's own wins, and nothing is listed twice.
    expect(named.get('restrained')).toBe('Pinned');
    expect(new Set(defs.map((def) => def.id)).size).toBe(defs.length);
  });
});
