import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { tileOf } from '../engine/scene/grid-from-scene';
import { validateProject } from '../editor/validate';
import { answerPending, buildDemoScene, travelTo, useSelectedOn, type DemoScene } from './demo-scene';
import { PIT_SCENE_ID } from './demo-scenes';
import {
  OBJECTIVE_OPEN_THE_STRONGBOX,
  OBJECTIVE_WIN_THE_WORD,
  WARDENS_WORD_QUEST,
} from './demo-quests';
import { loadGameText, saveGame } from './save';

/**
 * The demo's quest, played through.
 *
 * A quest is only real if content drives it: the conversation starts it, the
 * roll ticks a step, the strongbox closes it, and the journal says so at each
 * point. This follows one party through all of that.
 */

const PILLAR = 'pillar-14-7';
const scene = (seed = 'demo'): DemoScene => buildDemoScene(demoMap(), seed);

function stand(demo: DemoScene, id: string): void {
  const object = demo.scene.interactables.find((i) => i.id === id)!;
  demo.state.moveEntity(
    demo.party.selected!,
    tileOf(demo.grid, { x: object.position.x - 1, y: object.position.y }),
  );
}

const options = (demo: DemoScene): string[] =>
  demo.pending?.dialogue?.view?.options.map((o) => o.text) ?? [];

function choose(demo: DemoScene, containing: string): void {
  const view = demo.pending!.dialogue!.view!;
  const option = view.options.find((o) => o.text.includes(containing))!;
  answerPending(demo, { kind: 'choose', index: option.index });
}

function playToEnd(demo: DemoScene, limit = 20): void {
  for (let i = 0; i < limit && demo.pending !== null; i++) {
    const view = demo.pending.dialogue?.view;
    if (view !== null && view !== undefined && view.options.length > 0) {
      answerPending(demo, { kind: 'choose', index: view.options[0]!.index });
    } else if (demo.pending.dialogue?.prompt?.kind === 'check') {
      answerPending(demo, { kind: 'roll' });
    } else {
      answerPending(demo, { kind: 'continue' });
    }
  }
}

/** Talk to the Warden and ask politely, whichever way the roll goes. */
function askTheWarden(demo: DemoScene): boolean {
  stand(demo, PILLAR);
  useSelectedOn(demo, PILLAR);
  expect(options(demo).some((t) => t.includes('came for the vault'))).toBe(true);
  choose(demo, 'came for the vault');
  choose(demo, 'politely');
  answerPending(demo, { kind: 'roll' });
  playToEnd(demo);
  return demo.scenario.items.has('wardens-word');
}

describe('the demo quest', () => {
  it('ships in the project, and validates clean', () => {
    const demo = scene();
    expect(demo.project.quests.map((q) => q.id)).toEqual([WARDENS_WORD_QUEST]);
    expect(validateProject(demo.project).filter((p) => /quest|objective/i.test(p.message))).toEqual([]);
  });

  it('starts when the pillar wakes, and the log says so', () => {
    const demo = scene();
    expect(demo.scenario.quests.has(WARDENS_WORD_QUEST)).toBe(false);
    stand(demo, PILLAR);
    useSelectedOn(demo, PILLAR);
    expect(demo.scenario.quests.get(WARDENS_WORD_QUEST)?.status).toBe('active');
    expect(demo.log.some((l) => l.text.includes("New quest: The Warden's Word"))).toBe(true);
  });

  it('does not announce the quest twice when the pillar is used twice', () => {
    const demo = scene();
    stand(demo, PILLAR);
    useSelectedOn(demo, PILLAR);
    playToEnd(demo);
    useSelectedOn(demo, PILLAR);
    playToEnd(demo);
    expect(demo.log.filter((l) => l.text.startsWith('New quest')).length).toBe(1);
  });

  it('ticks the first step when the word is won, and the second downstairs', () => {
    // Search seeds for one where the Presence roll lands; the rules are
    // deterministic per seed, so whichever seed passes always passes.
    let demo: DemoScene | null = null;
    for (let seed = 0; seed < 40 && demo === null; seed++) {
      const candidate = scene(`quest-${seed}`);
      if (askTheWarden(candidate)) demo = candidate;
    }
    expect(demo).not.toBeNull();
    const progress = demo!.scenario.quests.get(WARDENS_WORD_QUEST)!;
    expect(progress.status).toBe('active');
    expect(progress.done.has(OBJECTIVE_WIN_THE_WORD)).toBe(true);
    expect(demo!.log.some((l) => l.text.includes('Objective complete: Get the word'))).toBe(true);

    travelTo(demo!, PIT_SCENE_ID);
    stand(demo!, 'strongbox');
    expect(useSelectedOn(demo!, 'strongbox').status).toBe('done');
    expect(progress.done.has(OBJECTIVE_OPEN_THE_STRONGBOX)).toBe(true);
    expect(progress.status).toBe('completed');
    expect(demo!.log.some((l) => l.text.includes("Quest complete: The Warden's Word"))).toBe(true);
  });

  it('leaves the quest open when the Warden refuses', () => {
    let demo: DemoScene | null = null;
    for (let seed = 0; seed < 40 && demo === null; seed++) {
      const candidate = scene(`refuse-${seed}`);
      if (!askTheWarden(candidate)) demo = candidate;
    }
    expect(demo).not.toBeNull();
    const progress = demo!.scenario.quests.get(WARDENS_WORD_QUEST)!;
    expect(progress.status).toBe('active');
    expect(progress.done.size).toBe(0);
  });

  it('survives a save', () => {
    const demo = scene();
    stand(demo, PILLAR);
    useSelectedOn(demo, PILLAR);
    playToEnd(demo);
    const fresh = scene();
    expect(loadGameText(fresh, JSON.stringify(saveGame(demo))).ok).toBe(true);
    expect(fresh.scenario.quests.get(WARDENS_WORD_QUEST)?.status).toBe('active');
  });
});
