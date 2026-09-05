import { describe, it, expect } from 'vitest';
import { createRng, type Rng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { SceneState, createPartyEntity } from '../scene/state';
import { log, setFlag, type Effect } from '../script/effects';
import { SceneScriptWorld, createScenarioState } from '../script/world';
import {
  DialogueRunner,
  danglingLinks,
  unreachableNodes,
  type Dialogue,
  type DialogueStatus,
} from './dialogue';

function scriptedRng(faces: number[]): Rng {
  let i = 0;
  const take = (): number => {
    if (i >= faces.length) throw new Error('scriptedRng exhausted');
    return faces[i++]!;
  };
  const rng: Rng = {
    next: () => take() / 100,
    nextInt: () => take(),
    die: () => take(),
    dice: (count) => Array.from({ length: count }, take),
    pick: (items) => items[0]!,
    shuffle: (items) => items,
    fork: () => rng,
    save: () => i,
    restore: (s) => {
      i = s;
    },
  };
  return rng;
}

function world(): { world: SceneScriptWorld; state: SceneState } {
  const state = new SceneState({ id: 'pit' }, new TileGrid({ width: 4, height: 4 }));
  state.addEntity(createPartyEntity('kara', 'sentinel', 0));
  return {
    world: new SceneScriptWorld(state, createScenarioState({}, 'kara'), {
      traits: { presence: 2, instinct: 1 },
    }),
    state,
  };
}

/**
 * The Shadow Hag's bargain, as a dialogue — the legacy one-shot's three-way branch
 * (docs/research/legacy-campaign.md §3), which is the shape a BG3 conversation
 * takes: gated knowledge, a social check, and a choice that sets the story
 * variable everything downstream reads.
 */
const hag: Dialogue = {
  id: 'hag',
  start: 'open',
  nodes: [
    {
      id: 'open',
      onEnter: [setFlag('met-hag')],
      lines: [
        { speaker: 'Shadow Hag', text: 'Her voice is dry leaves on stone. "You want out of the pit."' },
      ],
      choices: [
        {
          text: 'What is your price?',
          goto: 'price',
        },
        {
          text: 'You know where the cranks are.',
          detail: 'Only if you have heard of them.',
          available: { kind: 'flag', flag: 'knows-cranks' },
          goto: 'cranks',
        },
        {
          text: '"Step aside."',
          detail: 'Presence 14',
          check: {
            trait: 'presence',
            difficulty: 14,
            onSuccessWithHope: [log('She steps back, amused.', 'success')],
            onFailureWithFear: [log('She laughs at you.', 'fear')],
            gotoOnSuccess: 'cowed',
            gotoOnFailure: 'price',
          },
        },
        {
          text: 'Draw steel.',
          effects: [{ kind: 'setVar', name: 'mood', value: 'vengeful' }, setFlag('hag-hostile')],
          goto: 'fight',
        },
      ],
    },
    {
      id: 'price',
      lines: [{ speaker: 'Shadow Hag', text: '"Your blessings. All four."' }],
      choices: [
        {
          text: 'Agree.',
          effects: [
            { kind: 'setVar', name: 'mood', value: 'insulted' },
            { kind: 'giveKey', key: 'backdoor' },
          ],
        },
        { text: 'Refuse.', goto: 'fight' },
      ],
    },
    {
      id: 'cranks',
      lines: [{ speaker: 'Shadow Hag', text: '"Clever. Then you know what they are worth."' }],
      goto: 'price',
    },
    { id: 'cowed', lines: [{ text: 'She moves aside without a word.' }] },
    {
      id: 'fight',
      onEnter: [{ kind: 'startEncounter', encounter: 'hag' }],
      lines: [{ text: 'Shadows tear loose from the walls.' }],
    },
  ],
};

const talking = (status: DialogueStatus) => {
  if (status.status !== 'talking') throw new Error(`expected talking, got ${status.status}`);
  return status.view;
};

describe('walking a conversation', () => {
  it('enters the first node, runs its onEnter, and shows the lines', () => {
    const { world: w, state } = world();
    const view = talking(new DialogueRunner(hag, w, createRng(1)).start());
    expect(view.node.id).toBe('open');
    expect(view.lines[0]!.speaker).toBe('Shadow Hag');
    expect(state.hasFlag('met-hag')).toBe(true);
  });

  it('hides a reply the player has not earned, and shows it once they have', () => {
    const { world: w, state } = world();
    expect(talking(new DialogueRunner(hag, w, createRng(1)).start()).options.map((o) => o.text)).toEqual([
      'What is your price?',
      '"Step aside."',
      'Draw steel.',
    ]);

    state.setFlag('knows-cranks');
    const known = talking(new DialogueRunner(hag, w, createRng(1)).start());
    expect(known.options.map((o) => o.text)).toContain('You know where the cranks are.');
    // Indices stay the authored ones, so a filtered list cannot mis-route a pick.
    expect(known.options.map((o) => o.index)).toEqual([0, 1, 2, 3]);
  });

  it('marks which replies need a roll, with the modifier already applied', () => {
    const { world: w } = world();
    const view = talking(new DialogueRunner(hag, w, createRng(1)).start());
    const persuade = view.options.find((o) => o.text === '"Step aside."')!;
    expect(persuade.check).toEqual({ trait: 'presence', difficulty: 14, modifier: 2 });
    expect(view.options[0]!.check).toBeUndefined();
  });

  it('follows a reply to the next node and runs its effects', () => {
    const { world: w, state } = world();
    const runner = new DialogueRunner(hag, w, createRng(1));
    runner.start();
    const view = talking(runner.choose(3)); // Draw steel
    expect(view.node.id).toBe('fight');
    expect(w.getVar('mood')).toBe('vengeful');
    expect(state.hasFlag('hag-hostile')).toBe(true);
    expect(state.encounter('hag').started).toBe(true);
  });

  it('walks through a node that only narrates', () => {
    const { world: w, state } = world();
    state.setFlag('knows-cranks');
    const runner = new DialogueRunner(hag, w, createRng(1));
    runner.start();
    // 'cranks' has no choices and a goto, so it hands straight on to 'price'.
    const view = talking(runner.choose(1));
    expect(view.node.id).toBe('price');
  });

  it('ends when a reply leads nowhere further', () => {
    const { world: w } = world();
    const runner = new DialogueRunner(hag, w, createRng(1));
    runner.start();
    runner.choose(0); // price
    const done = runner.choose(0); // Agree
    expect(done.status).toBe('ended');
    expect(w.getVar('mood')).toBe('insulted');
  });

  it('shows a closing line rather than swallowing it, and ends on advance', () => {
    const { world: w } = world();
    const runner = new DialogueRunner(hag, w, createRng(1));
    runner.start();
    const last = talking(runner.choose(3)); // Draw steel -> 'fight'
    expect(last.node.id).toBe('fight');
    expect(last.lines[0]!.text).toBe('Shadows tear loose from the walls.');
    expect(last.options).toEqual([]);
    expect(runner.advance().status).toBe('ended');
  });

  it('will not advance past a node that is waiting for a reply', () => {
    const { world: w } = world();
    const runner = new DialogueRunner(hag, w, createRng(1));
    runner.start();
    expect(talking(runner.advance()).node.id).toBe('open');
  });

  it('ignores a reply that is not on offer', () => {
    const { world: w } = world();
    const runner = new DialogueRunner(hag, w, createRng(1));
    runner.start();
    const same = talking(runner.choose(1)); // gated: knows-cranks is unset
    expect(same.node.id).toBe('open');
    expect(talking(runner.choose(99)).node.id).toBe('open');
  });
});

describe('a reply that costs a roll', () => {
  it('pauses for the roll, then routes on success', () => {
    const { world: w } = world();
    // Hope 8, Fear 6 -> 14 + 2 = 16 against 14: a success with Hope.
    const runner = new DialogueRunner(hag, w, scriptedRng([8, 6]));
    runner.start();

    const waiting = runner.choose(2);
    expect(waiting.status).toBe('script');
    if (waiting.status !== 'script' || waiting.prompt.kind !== 'check') throw new Error('expected a check');
    expect(waiting.prompt).toMatchObject({ trait: 'presence', difficulty: 14, modifier: 2 });

    const after = runner.resume({ kind: 'roll' });
    expect(talking(after).node.id).toBe('cowed');
    expect(after.journal.some((e) => e.kind === 'log' && e.text === 'She steps back, amused.')).toBe(true);
  });

  it('routes elsewhere on failure', () => {
    const { world: w } = world();
    const runner = new DialogueRunner(hag, w, scriptedRng([2, 3]));
    runner.start();
    runner.choose(2);
    const after = runner.resume({ kind: 'roll' });
    expect(talking(after).node.id).toBe('price');
    expect(after.journal.some((e) => e.kind === 'log' && e.text === 'She laughs at you.')).toBe(true);
  });

  it('records the roll in the journal so a log can show it', () => {
    const { world: w } = world();
    const runner = new DialogueRunner(hag, w, scriptedRng([8, 6]));
    runner.start();
    runner.choose(2);
    const after = runner.resume({ kind: 'roll' });
    const check = after.journal.find((e) => e.kind === 'check');
    if (check?.kind !== 'check') throw new Error('expected a check entry');
    expect(check.roll.total).toBe(16);
    expect(check.outcome).toBe('successWithHope');
  });
});

describe('a locked-but-visible reply', () => {
  const gated: Dialogue = {
    id: 'gated',
    start: 'a',
    nodes: [
      {
        id: 'a',
        lines: [{ text: 'A locked door.' }],
        choices: [
          {
            text: 'Unlock it.',
            detail: 'Needs the brass key.',
            enabled: { kind: 'hasKey', key: 'brass' },
            effects: [setFlag('unlocked')],
          },
        ],
      },
    ],
  };

  it('shows the reply but refuses it until the condition holds', () => {
    const { world: w, state } = world();
    const runner = new DialogueRunner(gated, w, createRng(1));
    const view = talking(runner.start());
    expect(view.options[0]).toMatchObject({ text: 'Unlock it.', enabled: false });

    expect(talking(runner.choose(0)).node.id).toBe('a');
    expect(state.hasFlag('unlocked')).toBe(false);

    state.giveKey('brass');
    const unlocked = new DialogueRunner(gated, w, createRng(1));
    unlocked.start();
    expect(unlocked.choose(0).status).toBe('ended');
    expect(state.hasFlag('unlocked')).toBe(true);
  });
});

describe('a reply whose effects need an answer of their own', () => {
  const nested: Dialogue = {
    id: 'nested',
    start: 'a',
    nodes: [
      {
        id: 'a',
        lines: [{ text: 'He offers two things.' }],
        choices: [
          {
            text: 'Accept.',
            effects: [
              {
                kind: 'choice',
                title: 'Which?',
                options: [
                  { label: 'The coin.', effects: [setFlag('took-coin')] },
                  { label: 'The blade.', effects: [setFlag('took-blade')] },
                ],
              },
            ],
            goto: 'b',
          },
        ],
      },
      { id: 'b', lines: [{ text: 'He nods.' }] },
    ],
  };

  it('surfaces the inner prompt and carries on afterwards', () => {
    const { world: w, state } = world();
    const runner = new DialogueRunner(nested, w, createRng(1));
    runner.start();

    const waiting = runner.choose(0);
    expect(waiting.status).toBe('script');
    if (waiting.status !== 'script' || waiting.prompt.kind !== 'choice') throw new Error('expected a choice');
    expect(waiting.prompt.options.map((o) => o.label)).toEqual(['The coin.', 'The blade.']);

    const after = runner.resume({ kind: 'choose', index: 1 });
    expect(state.hasFlag('took-blade')).toBe(true);
    expect(talking(after).node.id).toBe('b');
  });
});

describe('authoring checks', () => {
  it('finds links to nodes that do not exist', () => {
    const broken: Dialogue = {
      id: 'broken',
      start: 'a',
      nodes: [{ id: 'a', lines: [], choices: [{ text: 'go', goto: 'nowhere' }] }],
    };
    expect(danglingLinks(broken)).toEqual(['nowhere']);
    expect(danglingLinks(hag)).toEqual([]);
  });

  it('finds nodes nothing can reach', () => {
    const orphaned: Dialogue = {
      id: 'orphaned',
      start: 'a',
      nodes: [
        { id: 'a', lines: [] },
        { id: 'lost', lines: [] },
      ],
    };
    expect(unreachableNodes(orphaned)).toEqual(['lost']);
    expect(unreachableNodes(hag)).toEqual([]);
  });

  it('ends rather than crashing on a dangling link at runtime', () => {
    const broken: Dialogue = {
      id: 'broken',
      start: 'a',
      nodes: [{ id: 'a', lines: [], choices: [{ text: 'go', goto: 'nowhere' }] }],
    };
    const { world: w } = world();
    const runner = new DialogueRunner(broken, w, createRng(1));
    runner.start();
    expect(runner.choose(0).status).toBe('ended');
  });

  it('refuses a dialogue with a repeated node id', () => {
    const { world: w } = world();
    const duplicated: Dialogue = {
      id: 'dupe',
      start: 'a',
      nodes: [
        { id: 'a', lines: [] },
        { id: 'a', lines: [] },
      ],
    };
    expect(() => new DialogueRunner(duplicated, w, createRng(1))).toThrow(/repeats node "a"/);
  });
});

describe('determinism', () => {
  it('replays a whole conversation from a seed and the same answers', () => {
    const play = (): string => {
      const { world: w } = world();
      const runner = new DialogueRunner(hag, w, createRng('talk'));
      runner.start();
      runner.choose(2);
      const after = runner.resume({ kind: 'roll' });
      return JSON.stringify(after.journal);
    };
    expect(play()).toBe(play());
  });

  it('reaches different endings from the same seed on different answers', () => {
    const { world: w } = world();
    const a = new DialogueRunner(hag, w, createRng('talk'));
    a.start();
    a.choose(3);

    const { world: w2 } = world();
    const b = new DialogueRunner(hag, w2, createRng('talk'));
    b.start();
    b.choose(0);

    expect(w.getVar('mood')).toBe('vengeful');
    expect(w2.getVar('mood')).toBe(null);
  });
});

describe('effects a dialogue defers upward', () => {
  it('journals a scene change rather than performing it', () => {
    const leaving: Dialogue = {
      id: 'leaving',
      start: 'a',
      nodes: [
        {
          id: 'a',
          lines: [],
          choices: [{ text: 'Through the gate.', effects: [{ kind: 'goto', scene: 'the-pit' } as Effect] }],
        },
      ],
    };
    const { world: w } = world();
    const runner = new DialogueRunner(leaving, w, createRng(1));
    runner.start();
    const done = runner.choose(0);
    expect(done.journal).toContainEqual({ kind: 'goto', scene: 'the-pit' });
  });
});
