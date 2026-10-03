/**
 * Dialogue as the Rust server must run it (`docs/SERVER.md`, phase 2). The conversation graph walks on
 * `script/` - it asks whether a condition holds, has effects run, answers their prompts, reads a check's
 * modifier - and `script/` is not ported yet. So this records those questions: every `evaluateOptional`,
 * `ScriptRunner` run and resume, and `checkModifier` the dialogue itself makes (not the ones a script
 * makes inside a run, which are the script's), each with its answer, step by step. The Rust walks the
 * same graph against that tape (`server/engine/tests/golden_dialogue.rs`) and must ask the same
 * questions, in the same order, and come to the same place; when `script` is ported, the real world
 * takes the tape's place.
 *
 * The dialogues are the game's (the demo's, the default project's) and a set written for the corners:
 * consequences, prompting `onEnter`s, checks that route and carry effects, dangling links, locked and
 * hidden replies. Each is driven by a seeded player who mostly plays it straight and sometimes does
 * what a player cannot - chooses after the end, resumes with nothing pending, starts again. Beside that:
 * `dialogueSchema`'s verdicts on the dialogue-level shape, `layoutDialogue`, `danglingLinks` and
 * `unreachableNodes`. `UPDATE_GOLDEN=1 npx vitest run src/engine/dialogue/dialogue.golden.test.ts`
 * writes `server/fixtures/dialogue.json` afresh.
 */

import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { SceneState, createPartyEntity } from '../scene/state';
import { SceneScriptWorld, createScenarioState } from '../script/world';
import { DEMO_DIALOGUES } from '../../game/demo-dialogue';
import { DialogueRunner, danglingLinks, unreachableNodes, type Dialogue, type DialogueStatus } from './dialogue';
import { dialogueSchema } from './schema';
import { layoutDialogue } from './layout';

/** What the dialogue asked `script/` during one step. `calls` is null while nothing is being recorded. */
const rec = vi.hoisted(() => ({ depth: 0, calls: null as unknown[] | null }));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

vi.mock('../script/conditions', async (importOriginal) => {
  const original = await importOriginal<typeof import('../script/conditions')>();
  const evaluateOptional: typeof original.evaluateOptional = (condition, context, bindings, dice) => {
    if (rec.calls === null || rec.depth > 0) return original.evaluateOptional(condition, context, bindings, dice);
    rec.depth++;
    try {
      const answer = original.evaluateOptional(condition, context, bindings, dice);
      rec.calls.push({ call: 'evaluate', condition: condition === undefined ? null : clone(condition), answer });
      return answer;
    } finally {
      rec.depth--;
    }
  };
  return { ...original, evaluateOptional };
});

vi.mock('../script/runner', async (importOriginal) => {
  const original = await importOriginal<typeof import('../script/runner')>();
  class RecordedRunner extends original.ScriptRunner {
    private readonly given: unknown;
    constructor(...args: ConstructorParameters<typeof original.ScriptRunner>) {
      super(...args);
      this.given = clone(args[2] ?? {});
    }
    private recorded<T>(call: object, go: () => T): T {
      if (rec.calls === null || rec.depth > 0) return go();
      rec.depth++;
      try {
        const result = go();
        rec.calls.push({ ...call, result: clone(result) });
        return result;
      } finally {
        rec.depth--;
      }
    }
    override run(...args: Parameters<InstanceType<typeof original.ScriptRunner>['run']>) {
      return this.recorded({ call: 'run', effects: clone(args[0]), options: this.given }, () => super.run(...args));
    }
    override resume(...args: Parameters<InstanceType<typeof original.ScriptRunner>['resume']>) {
      return this.recorded({ call: 'resume', response: clone(args[0]) }, () => super.resume(...args));
    }
  }
  return { ...original, ScriptRunner: RecordedRunner };
});

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/dialogue.json');

/** The world a conversation reads: a party of one in a small room, with a Presence and an Instinct. */
function worldFor(): SceneScriptWorld {
  const state = new SceneState({ id: 'pit' }, new TileGrid({ width: 4, height: 4 }));
  state.addEntity(createPartyEntity('kara', 'sentinel', 0));
  const world = new SceneScriptWorld(state, createScenarioState({}, 'kara'), { traits: { presence: 2, instinct: 1 } });
  // `checkModifier` is the world's; the dialogue asks it for the view, and only those asks are recorded.
  const checkModifier = world.checkModifier.bind(world);
  world.checkModifier = (trait, as) => {
    if (rec.calls === null || rec.depth > 0) return checkModifier(trait, as);
    rec.depth++;
    try {
      const answer = checkModifier(trait, as);
      rec.calls.push({ call: 'checkModifier', trait, as, answer });
      return answer;
    } finally {
      rec.depth--;
    }
  };
  return world;
}

const flag = (name: string) => ({ kind: 'flag', flag: name });
const logged = (text: string) => ({ kind: 'log', text, tone: 'narration' });

/** Dialogues for the corners the game's own do not reach. */
const CORNERS: unknown[] = [
  {
    id: 'corners',
    start: 'open',
    nodes: [
      {
        id: 'open',
        onEnter: [{ kind: 'setFlag', flag: 'met' }],
        lines: [{ speaker: 'Keeper', text: 'Well?' }, { text: 'The lamp gutters.' }],
        choices: [
          { text: 'Ask the price.', detail: 'It will cost you.', goto: 'price' },
          { text: 'Hidden unless known.', available: flag('knows'), goto: 'known' },
          { text: 'Locked unless met.', enabled: { kind: 'not', of: flag('met') }, goto: 'known' },
          {
            text: 'Talk them down.',
            check: { trait: 'presence', difficulty: 12, gotoOnSuccess: 'won', gotoOnFailure: 'lost' },
            effects: [logged('after the roll'), { kind: 'setFlag', flag: 'argued' }],
            goto: 'price',
          },
          { text: 'Read them.', check: { trait: 'instinct', difficulty: 10 }, goto: 'price' },
          { text: 'Read them, and leave.', check: { trait: 'knowledge', difficulty: 30 } },
          { text: 'Walk off the map.', goto: 'nowhere' },
          { text: 'Pick a door.', effects: [{ kind: 'choice', title: 'Which?', options: [{ label: 'Left', effects: [logged('left')] }, { label: 'Right', available: flag('knows') }, { label: 'Back' }] }], goto: 'price' },
          { text: 'Cast at them.', detail: 'Nobody here casts.', check: { trait: 'spellcast', difficulty: 8 }, goto: 'price' },
          { text: 'Draw on them.', check: { trait: 'weapon', difficulty: 'target' }, goto: 'price' },
          { text: 'Say something, then pick.', effects: [logged('You clear your throat.'), logged('And again.'), { kind: 'choice', options: [{ label: 'Stay', effects: [logged('stayed')] }, { label: 'Go' }] }], goto: 'hub' },
          { text: 'Leave.' },
        ],
      },
      { id: 'price', lines: [{ text: 'Everything has one.' }], goto: 'turn' },
      { id: 'turn', kind: 'consequence', onEnter: [{ kind: 'setFlag', flag: 'turned' }], goto: 'hub' },
      {
        id: 'hub',
        lines: [{ speaker: 'Keeper', text: 'Anything else?' }],
        choices: [
          { text: 'Only if turned twice.', available: { kind: 'all', of: [flag('turned'), flag('twice')] }, goto: 'open' },
          { text: 'Ask again.', goto: 'open' },
          { text: 'Nothing.', goto: 'bye' },
        ],
      },
      { id: 'known', onEnter: [{ kind: 'choice', options: [{ label: 'Nod' }, { label: 'Shrug', effects: [{ kind: 'setFlag', flag: 'knows' }] }] }], lines: [{ text: 'You know.' }], goto: 'hub' },
      { id: 'won', lines: [{ text: 'They step aside.' }] },
      { id: 'lost', kind: 'consequence', onEnter: [logged('They do not.')] },
      { id: 'gated', lines: [{ text: 'Every reply hidden, and on.' }], choices: [{ text: 'Never.', available: { kind: 'never' } }], goto: 'bye' },
      { id: 'bye', lines: [{ text: 'Go well.' }] },
      { id: 'orphan', lines: [{ text: 'Nobody comes here.' }], goto: 'also-missing' },
    ],
  },
  {
    id: 'walk-through',
    start: 'a',
    nodes: [
      { id: 'a', lines: [{ text: 'One.' }], goto: 'b' },
      { id: 'b', choices: [{ text: 'Gone.', available: { kind: 'never' } }], goto: 'c' },
      { id: 'c', kind: 'consequence', goto: 'gated' },
      { id: 'gated', onEnter: [logged('entered')], lines: [{ text: 'Last.' }] },
    ],
  },
  {
    id: 'ends-in-a-consequence',
    start: 'only',
    nodes: [{ id: 'only', kind: 'consequence', onEnter: [{ kind: 'setFlag', flag: 'done' }] }],
  },
  {
    id: 'a-dangling-start-branch',
    start: 'here',
    nodes: [
      { id: 'here', choices: [{ text: 'Into nothing.', goto: 'void' }, { text: 'Checked into nothing.', check: { trait: 'agility', difficulty: 2, gotoOnSuccess: 'void', gotoOnFailure: 'here' } }] },
    ],
  },
];

type Move = { act: string; index?: number; response?: unknown };

/** A player drawn off a stream: mostly straight, sometimes not. */
function playerMove(status: DialogueStatus | null, rng: Rng): Move {
  if (status === null) return { act: 'start' };
  const roll = rng.next();
  if (status.status === 'script') {
    const prompt = status.prompt;
    if (roll < 0.75) {
      if (prompt.kind === 'choice') return { act: 'resume', response: { kind: 'choose', index: prompt.options[rng.nextInt(prompt.options.length)]!.index } };
      if (prompt.kind === 'check') return { act: 'resume', response: rng.next() < 0.3 ? { kind: 'roll', advantage: 1 } : { kind: 'roll' } };
      if (prompt.kind === 'rolled') return { act: 'resume', response: { kind: 'answered' } };
      return { act: 'resume', response: { kind: 'continue' } };
    }
    // Choosing while a script waits starts another over it, which the dialogue allows.
    return roll < 0.9 ? { act: 'advance' } : { act: 'choose', index: rng.nextInt(3) };
  }
  if (status.status === 'talking') {
    const options = status.view.options;
    if (roll < 0.7 && options.length > 0) return { act: 'choose', index: options[rng.nextInt(options.length)]!.index };
    if (roll < 0.8) return { act: 'advance' };
    if (roll < 0.87) return { act: 'choose', index: rng.next() < 0.5 ? -1 : (status.view.node.choices ?? []).length + rng.nextInt(2) };
    if (roll < 0.94) return { act: 'resume', response: { kind: 'continue' } };
    return { act: 'start' };
  }
  const acts = ['choose', 'advance', 'resume', 'start'];
  const act = acts[rng.nextInt(acts.length)]!;
  return act === 'choose' ? { act, index: 0 } : act === 'resume' ? { act, response: { kind: 'continue' } } : { act };
}

function statusJson(status: DialogueStatus, since: number) {
  return {
    status: status.status,
    ...(status.status === 'talking' ? { view: { node: status.view.node.id, lines: status.view.lines, options: status.view.options } } : {}),
    ...(status.status === 'script' ? { prompt: status.prompt } : {}),
    journalLength: status.journal.length,
    newEntries: status.journal.slice(since),
  };
}

/** One conversation, played by a seeded player, with what was asked at each step. */
function play(dialogue: Dialogue, seed: string, knows: readonly string[], targets?: readonly string[], opening: readonly Move[] = []) {
  const world = worldFor();
  for (const name of knows) world.setFlag(name);
  const runner = new DialogueRunner(dialogue, world, createRng(`${seed}:dice`), targets === undefined ? {} : { targets });
  const player = createRng(`${seed}:player`);
  const steps: unknown[] = [];
  let status: DialogueStatus | null = null;
  let seen = 0;
  let afterEnd = 0;
  for (let step = 0; step < 40 && afterEnd < 3; step++) {
    const move: Move = opening[step] ?? playerMove(status, player);
    const calls: unknown[] = [];
    rec.calls = calls;
    try {
      status =
        move.act === 'start' ? runner.start()
        : move.act === 'choose' ? runner.choose(move.index!)
        : move.act === 'advance' ? runner.advance()
        : runner.resume(move.response as never);
    } finally {
      rec.calls = null;
    }
    steps.push({ move, calls, status: statusJson(status, seen) });
    seen = status.journal.length;
    if (status.status === 'ended') afterEnd++;
  }
  return { seed, knows, ...(targets === undefined ? {} : { targets }), steps, journal: clone(runner.entries) };
}

function flagsIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const item of value) flagsIn(item, into);
  else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record['kind'] === 'flag' && typeof record['flag'] === 'string') into.add(record['flag']);
    for (const inner of Object.values(record)) flagsIn(inner, into);
  }
  return into;
}

function golden() {
  const project = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../projects/default.json'), 'utf8')) as { dialogues?: unknown[] };
  const dialogues: Dialogue[] = [...DEMO_DIALOGUES, ...(project.dialogues ?? []).map((d) => dialogueSchema.parse(d)), ...CORNERS.map((d) => dialogueSchema.parse(d))];

  const runs = dialogues.map((dialogue) => {
    const flags = [...flagsIn(dialogue)].sort();
    const plays = [];
    for (let i = 0; i < (CORNERS.some((c) => (c as Dialogue).id === dialogue.id) ? 40 : 16); i++) {
      const knows = i % 2 === 0 ? [] : flags.filter((_, j) => (i + j) % 3 !== 0);
      plays.push(play(dialogue, `${dialogue.id}:${i}`, knows, i === 3 ? ['kara'] : undefined));
    }
    // A reply chosen while another's script waits, after that script has already written to the journal:
    // the new script's journal is read on from where the old one stood, so its first entries are not kept.
    const talkFirst = (dialogue.nodes[0]!.choices ?? []).findIndex((c) => c.text.startsWith('Say something'));
    if (talkFirst >= 0) {
      const say = { act: 'choose', index: talkFirst };
      plays.push(play(dialogue, `${dialogue.id}:over`, [], undefined, [{ act: 'start' }, say, say, { act: 'choose', index: 0 }, say, { act: 'resume', response: { kind: 'choose', index: 0 } }]));
    }
    return { dialogue, plays };
  });

  // A repeated node id, which the schema refuses, is refused again by the runner.
  const repeated = { id: 'twice', start: 'a', nodes: [{ id: 'a', lines: [] }, { id: 'a', lines: [] }] } as unknown as Dialogue;
  let refusal = '';
  try {
    new DialogueRunner(repeated, worldFor(), createRng('x'));
  } catch (error) {
    refusal = (error as Error).message;
  }

  // Graphs for the readers, parsed or not: dangling, unreachable, repeated, and ids that sort by UTF-16 unit.
  const graphs: unknown[] = [
    ...dialogues,
    repeated,
    {
      id: 'order',
      start: '\u{1F600}',
      nodes: [
        { id: '\u{1F600}', lines: [], goto: '\uFB01', choices: [{ text: 't', goto: 'zz', check: { trait: 'agility', difficulty: 1, gotoOnSuccess: '\u{1F601}', gotoOnFailure: 'Z' } }] },
        { id: '\uE000', lines: [] },
        { id: 'b', lines: [] },
        { id: 'A', lines: [], position: { x: -12.5, y: 3 } },
      ],
    },
    { id: 'no-start', start: 'missing', nodes: [{ id: 'x', lines: [], goto: 'y' }, { id: 'y', lines: [], goto: 'x' }] },
  ];
  const readers = graphs.map((graph) => {
    const dialogue = graph as Dialogue;
    return {
      dialogue: graph,
      dangling: danglingLinks(dialogue),
      unreachable: unreachableNodes(dialogue),
      ...(dialogue.nodes.some((n, i) => dialogue.nodes.findIndex((m) => m.id === n.id) !== i)
        ? {}
        : {
            layout: Object.fromEntries(layoutDialogue(dialogue)),
            layoutNarrow: Object.fromEntries(layoutDialogue(dialogue, { columnWidth: 100, rowHeight: 33.5 })),
          }),
    };
  });

  // The schema's verdicts on the dialogue-level shape. What is inside a condition or an effect is the
  // script's schema, and waits for its port; nothing here fails for that alone.
  const good = { id: 'shape', start: 'a', nodes: [{ id: 'a', lines: [{ text: 'hi' }], choices: [{ text: 'go', goto: 'b' }] }, { id: 'b' }] };
  const node = good.nodes[0]!;
  const shapes: unknown[] = [
    good,
    { ...good, extra: true },
    { ...good, id: 'Not-Kebab' }, { ...good, id: 'a--b' }, { ...good, id: 'a_b-c9' }, { ...good, id: '' }, { ...good, id: 7 },
    { ...good, start: '' }, { ...good, start: 'zzz' }, { ...good, nodes: [] }, { ...good, nodes: 'a' },
    { ...good, nodes: [node, node] },
    { ...good, nodes: [{ ...node, id: '' }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, kind: 'consequence' }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, kind: 'said' }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, position: { x: 1, y: -2.5 } }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, position: { x: 1 } }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, lines: [{ speaker: 'S', text: '' }] }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, lines: [{ speaker: 3, text: 'x' }] }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, lines: [{}] }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, goto: '' }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, choices: [{ text: '' }] }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, choices: [{ text: 'x', goto: '' }] }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, choices: [{ text: 'x', detail: 4 }] }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, choices: [{ text: 'x', check: { trait: 'agility', difficulty: 3, gotoOnSuccess: '' } }] }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, choices: [{ text: 'x', check: { trait: 'agility', difficulty: 3, gotoOnFailure: 'b' } }] }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, choices: 'many' }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, onEnter: [] }, good.nodes[1]] },
    { ...good, nodes: [{ ...node, speaker: 'ignored' }, good.nodes[1]] },
    null, [], 'dialogue',
  ];
  const parse = shapes.map((value) => {
    const result = dialogueSchema.safeParse(value);
    return result.success ? { value, parsed: result.data } : { value, issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) };
  });

  return {
    about: 'src/engine/dialogue played for the Rust port; written by src/engine/dialogue/dialogue.golden.test.ts',
    runs,
    repeated: { dialogue: repeated, refusal },
    readers,
    parse,
  };
}

describe('dialogue, as the Rust server must run it', () => {
  it('is what server/fixtures/dialogue.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
