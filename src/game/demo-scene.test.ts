import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { tileOf } from '../engine/scene/grid-from-scene';
import {
  answerPending,
  buildDemoScene,
  reachableInteractable,
  useSelectedOn,
  type DemoScene,
} from './demo-scene';

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
    expect(chest.check?.onSuccessWithHope?.length).toBeGreaterThan(0);
    expect(chest.check?.onFailureWithFear?.length).toBeGreaterThan(0);
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
    expect(demo.pending?.interactable).toBe(CHEST);
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
    expect(demo.log.some((l) => /with (Hope|Fear)|critical/i.test(l.text))).toBe(true);
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
