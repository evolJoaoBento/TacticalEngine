import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { tileOf } from '../engine/scene/grid-from-scene';
import { answerPending, buildDemoScene, useSelectedOn, type DemoScene } from './demo-scene';
import { KNOWS_THE_NAME, PILLAR_DIALOGUE_ID } from './demo-dialogue';

/**
 * Talking to the pillar.
 *
 * This is the nesting that makes conversation different from every other effect:
 * a script stops on `startDialogue`, the conversation runs — and can itself stop
 * for a roll — and only when it ends does the script that opened it carry on.
 */

const PILLAR = 'pillar-14-7';

function stand(demo: DemoScene, id: string): void {
  const object = demo.scene.interactables.find((i) => i.id === id)!;
  demo.state.moveEntity(
    demo.party.selected!,
    tileOf(demo.grid, { x: object.position.x - 1, y: object.position.y }),
  );
}

const scene = (seed = 'demo'): DemoScene => buildDemoScene(demoMap(), seed);

/** The reply labels the player can currently see. */
const options = (demo: DemoScene): string[] =>
  demo.pending?.dialogue?.view?.options.map((o) => o.text) ?? [];

/**
 * Play the conversation out to its end.
 *
 * `advance()` deliberately will not skip a node that is offering replies, so a
 * driver has to pick one; the bound stops a routing bug becoming a hung test.
 */
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

describe('the pillar conversation', () => {
  it('ships as document data, not as engine code', () => {
    const demo = scene();
    // It parsed through `dialogueSchema`, so a project file could hold it.
    expect(demo.dialogues.get(PILLAR_DIALOGUE_ID)?.nodes.length).toBeGreaterThan(3);
  });

  it('opens when the pillar is used, and shows the first replies', () => {
    const demo = scene();
    stand(demo, PILLAR);
    const result = useSelectedOn(demo, PILLAR);

    expect(result.status).toBe('waiting');
    expect(demo.pending?.dialogue?.id).toBe(PILLAR_DIALOGUE_ID);
    expect(demo.log.some((l) => l.text.includes('opens its eyes'))).toBe(true);
    expect(options(demo).length).toBeGreaterThan(2);
  });

  it('hides the reply that depends on knowing the name', () => {
    const demo = scene();
    stand(demo, PILLAR);
    useSelectedOn(demo, PILLAR);
    // The gated line is not merely disabled; it is not offered at all.
    expect(options(demo).some((t) => t.startsWith('Warden.'))).toBe(false);

    const known = scene();
    known.world.setFlag(KNOWS_THE_NAME);
    stand(known, PILLAR);
    useSelectedOn(known, PILLAR);
    expect(options(known).some((t) => t.startsWith('Warden.'))).toBe(true);
  });

  it('learns the name by asking, which unlocks the reply on a later visit', () => {
    const demo = scene();
    stand(demo, PILLAR);
    useSelectedOn(demo, PILLAR);

    const askWhoYouAre = options(demo).indexOf('Who are you?');
    expect(askWhoYouAre).toBeGreaterThanOrEqual(0);
    answerPending(demo, { kind: 'choose', index: askWhoYouAre });

    // The node's onEnter set the flag, so the world remembers after the talking.
    expect(demo.world.hasFlag(KNOWS_THE_NAME)).toBe(true);
  });

  it('stops for the roll a reply costs, then routes on its outcome', () => {
    const demo = scene();
    stand(demo, PILLAR);
    useSelectedOn(demo, PILLAR);

    const toVault = options(demo).findIndex((t) => t.includes('came for the vault'));
    answerPending(demo, { kind: 'choose', index: toVault });

    const politely = options(demo).findIndex((t) => t.includes('politely'));
    expect(politely).toBeGreaterThanOrEqual(0);
    answerPending(demo, { kind: 'choose', index: politely });

    // A reply that costs a check hands out an inner prompt, not a view.
    expect(demo.pending?.dialogue?.prompt?.kind).toBe('check');
    expect(demo.pending?.dialogue?.view).toBeNull();

    answerPending(demo, { kind: 'roll' });
    // Whichever way it went, the conversation moved somewhere and said something.
    expect(demo.log.some((l) => /with (Hope|Fear)|critical/i.test(l.text))).toBe(true);
  });

  it('ends the conversation, and the pillar can be talked to again', () => {
    const demo = scene();
    stand(demo, PILLAR);
    useSelectedOn(demo, PILLAR);

    // The silent reply has no goto, so choosing it ends the conversation.
    const leave = options(demo).findIndex((t) => t.startsWith('[Say nothing'));
    expect(leave).toBeGreaterThanOrEqual(0);
    answerPending(demo, { kind: 'choose', index: leave });

    // Terminal nodes are shown before they end, so this may need one more step.
    playToEnd(demo);

    expect(demo.pending).toBeNull();
    expect(demo.world.interactableState(PILLAR).used).toBe(true);
    // Used, but repeatable: the Warden can be spoken to again.
    expect(useSelectedOn(demo, PILLAR).status).toBe('waiting');
    expect(demo.pending?.dialogue).not.toBeNull();
  });

  it('never repeats a line, across the whole nested conversation', () => {
    const demo = scene();
    stand(demo, PILLAR);
    useSelectedOn(demo, PILLAR);
    const toVault = options(demo).findIndex((t) => t.includes('came for the vault'));
    answerPending(demo, { kind: 'choose', index: toVault });
    const politely = options(demo).findIndex((t) => t.includes('politely'));
    answerPending(demo, { kind: 'choose', index: politely });
    answerPending(demo, { kind: 'roll' });
    playToEnd(demo);

    // Both runners keep cumulative journals; the log must still hold each line once.
    const counts = new Map<string, number>();
    for (const line of demo.log) counts.set(line.text, (counts.get(line.text) ?? 0) + 1);
    expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('is replayable: the same seed holds the same conversation', () => {
    const play = (): string => {
      const demo = scene('fixed');
      stand(demo, PILLAR);
      useSelectedOn(demo, PILLAR);
      const toVault = options(demo).findIndex((t) => t.includes('came for the vault'));
      answerPending(demo, { kind: 'choose', index: toVault });
      const politely = options(demo).findIndex((t) => t.includes('politely'));
      answerPending(demo, { kind: 'choose', index: politely });
      answerPending(demo, { kind: 'roll' });
      playToEnd(demo);
      return JSON.stringify(demo.log);
    };
    expect(play()).toBe(play());
  });
});
