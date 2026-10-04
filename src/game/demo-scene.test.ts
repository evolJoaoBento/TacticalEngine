import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { blankScene, tileOf } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { buildDemoScene, reachableInteractable, type DemoScene } from './demo-scene';
import { worldOptions } from './room';
import { interactablesOf } from '../engine/scene/prop-functions';

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
  const object = interactablesOf(demo.scene).find((i) => i.id === interactableId)!;
  const beside = { x: object.position.x - 1, y: object.position.y };
  demo.state.moveEntity(demo.party.selected!, tileOf(demo.grid, beside));
}

const scene = (): DemoScene => buildDemoScene(hollowVaultMap());

describe('using the demo vault', () => {
  it('imported the authored checks that used to go nowhere', () => {
    const demo = scene();
    const chest = interactablesOf(demo.scene).find((i) => i.id === CHEST)!;
    expect(chest.check?.trait).toBe('finesse');
    expect(chest.check?.difficulty).toBe(12);
    // Both halves of the roll were written by the original author.
    expect(chest.check?.onSuccessWithGood?.length).toBeGreaterThan(0);
    expect(chest.check?.onFailureWithBad?.length).toBeGreaterThan(0);
  });

  it('names what is within reach, and nothing when there is nothing', () => {
    const demo = scene();
    expect(reachableInteractable(demo)).toBeNull();
    stand(demo, CHEST);
    expect(reachableInteractable(demo)).toBe(CHEST);
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
    expect(SRD_CONDITIONS.map((def) => def.id)).toEqual(['vulnerable', 'hidden', 'restrained', 'prone']);
    // The project's own wins, and nothing is listed twice.
    expect(named.get('restrained')).toBe('Pinned');
    expect(new Set(defs.map((def) => def.id)).size).toBe(defs.length);
  });
});
