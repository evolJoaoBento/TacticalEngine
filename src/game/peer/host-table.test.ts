/**
 * A peer game's table (`host-table.ts`): the host's page as the server, played by the very `.wasm` the page loads -
 * who opens, who joins, who may act, what the others are told. Needs `npm run wasm`, and says so without it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDocument } from '../../engine/scene/migrate';
import { projectSchema } from '../../engine/scene/schema';
import { shippedContent } from '../shipped';
import { WasmEngine } from '../wasm-engine';
import { HostTable, CHAT_LONGEST } from './host-table';
import type { Link } from './link';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../../public/wasm/engine.wasm');
const built = existsSync(WASM);
const project = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../../projects/default.json'), 'utf8'))));

type Said = Record<string, unknown> & { id?: number; ok?: Record<string, unknown>; error?: string };

/** A link the test holds the far end of: what the table sent, and a message sent to it. */
interface Far {
  link: Link;
  heard: Said[];
  ask(message: Record<string, unknown>): Said;
  close(): void;
}

let ids = 0;

function far(): Far {
  let toTable: (text: string) => void = () => undefined;
  let shut: () => void = () => undefined;
  const heard: Said[] = [];
  const link: Link = {
    send: (text) => void heard.push(JSON.parse(text) as Said),
    onText: (h) => {
      toTable = h;
    },
    onClose: (s) => {
      shut = s;
    },
    close: () => shut(),
  };
  return {
    link,
    heard,
    ask(message) {
      const id = ++ids;
      toTable(JSON.stringify({ ...message, id }));
      const said = heard.find((m) => m.id === id);
      if (said === undefined) throw new Error(`no answer to ${JSON.stringify(message)}`);
      return said;
    },
    close: () => shut(),
  };
}

const pushes = (at: Far): Said[] => at.heard.filter((m) => m.id === undefined);

async function opened(options: ConstructorParameters<typeof HostTable>[2] = {}): Promise<{ table: HostTable; host: Far; open: Said; party: string[] }> {
  const engine = await WasmEngine.load(readFileSync(WASM));
  const table = new HostTable(engine, { id: 'h', name: 'Hana' }, { now: () => 7, ...options });
  const host = far();
  table.attach(host.link, { id: 'h', name: 'Hana' }, true);
  const open = host.ask({ op: 'open', project, shipped: shippedContent(), table: { animated: false, askDefender: true }, rng: 12345, lobby: true });
  const board = open.ok?.['board'] as { replica: { sheets: { id: string }[] } };
  return { table, host, open, party: board.replica.sheets.map((sheet) => sheet.id) };
}

function guest(table: HostTable, id = 'g', name = 'Gus'): Far {
  const at = far();
  table.attach(at.link, { id, name });
  return at;
}

describe('a peer game kept by its host\'s page', () => {
  if (!built) console.warn(`${WASM} is not built: \`npm run wasm\` builds it, and these are skipped until it is`);

  it.skipIf(!built)('is opened by the host as a lobby, answered in the server\'s shapes', async () => {
    const { open, party } = await opened();
    expect(open.error).toBeUndefined();
    expect(open.ok).toMatchObject({ seq: 0, you: 'h', invite: '', project: project.id, chat: [] });
    expect(open.ok?.['table']).toMatchObject({ host: 'h', members: [{ id: 'h', name: 'Hana' }], seats: {}, started: false, here: ['h'] });
    expect(typeof open.ok?.['game']).toBe('string');
    expect(party.length).toBeGreaterThan(1);
  });

  it.skipIf(!built)('is opened by nobody but the host, and joined before anything else is asked of it', async () => {
    const { table } = await opened();
    const gus = guest(table);
    expect(gus.ask({ op: 'open', project, shipped: shippedContent() }).error).toBe('only the host opens the game');
    expect(gus.ask({ op: 'call', call: 'board', args: [] }).error).toBe('no game: open one');
    expect((gus.ask({ op: 'project' }).ok as { project: { id: string } }).project.id).toBe(project.id);
  });

  it.skipIf(!built)('is joined: the guest stood where it is, the host told who came', async () => {
    const { table, host } = await opened();
    const gus = guest(table);
    const joined = gus.ask({ op: 'join', invite: 'peer' });
    expect(joined.ok).toMatchObject({ you: 'g', seq: 0, project: project.id });
    expect(joined.ok?.['table']).toMatchObject({ members: [{ id: 'h' }, { id: 'g', name: 'Gus' }], here: ['g', 'h'] });
    expect(pushes(host).at(-1)).toMatchObject({ table: { members: [{ id: 'h' }, { id: 'g' }] } });
    gus.close();
    expect(pushes(host).at(-1)).toMatchObject({ table: { here: ['h'] } });
  });

  it.skipIf(!built)('refuses what no page tells the game, and the tests\' hands to all but a host given them', async () => {
    const { table, host } = await opened();
    const gus = guest(table);
    gus.ask({ op: 'join' });
    expect(gus.ask({ op: 'call', call: 'restoreRng', args: [1] }).error).toBe('"restoreRng" is never told to the server\'s game');
    expect(host.ask({ op: 'call', call: 'restoreSeating', args: [null] }).error).toBe('"restoreSeating" is never told to the server\'s game');
    expect(gus.ask({ op: 'call', call: 'wound', args: ['x', 1] }).error).toBe('"wound" is the tests\' alone');
    expect(host.ask({ op: 'call', call: 'wound', args: ['x', 1] }).error).toBe('"wound" is the tests\' alone');
    const { host: trusted, party } = await opened({ testHands: true });
    expect(trusted.ask({ op: 'call', call: 'markStress', args: [party[0], 1] }).error).toBeUndefined();
  });

  it.skipIf(!built)('seats a guest who takes a seat before the start, the host\'s word after; nobody plays until then', async () => {
    const { table, host, party } = await opened();
    const gus = guest(table);
    gus.ask({ op: 'join' });
    const [mine, theirs] = party as [string, string];
    expect(gus.ask({ op: 'call', call: 'select', args: [mine] }).ok?.['answer']).toBe(false);
    expect(gus.ask({ op: 'seat', character: mine, account: 'g' }).ok?.['table']).toMatchObject({ seats: { [mine]: 'g' } });
    expect(pushes(host).at(-1)).toMatchObject({ table: { seats: { [mine]: 'g' } } });
    expect(gus.ask({ op: 'start' }).error).toBe('only the host starts the game');
    expect(host.ask({ op: 'start' }).ok?.['table']).toMatchObject({ started: true });
    expect(gus.ask({ op: 'seat', character: theirs, account: 'g' }).error).toBe('only the host says who plays whom');
    expect(gus.ask({ op: 'call', call: 'select', args: [theirs] }).ok?.['answer']).toBe(false);
    expect(gus.ask({ op: 'call', call: 'select', args: [mine] }).ok?.['answer']).toBe(true);
    expect(host.ask({ op: 'call', call: 'select', args: [mine] }).ok?.['answer']).toBe(false);
    expect(host.ask({ op: 'call', call: 'select', args: [theirs] }).ok?.['answer']).toBe(true);
    expect(host.ask({ op: 'seat', character: theirs, account: 'nobody' }).error).toBe('not at this game');
  });

  it.skipIf(!built)('pushes what an intent did to the others, numbered - each with their own selection - and a selection alone to nobody', async () => {
    const { table, host, party } = await opened();
    const gus = guest(table);
    gus.ask({ op: 'join' });
    const [mine, theirs] = party as [string, string];
    gus.ask({ op: 'seat', character: mine, account: 'g' });
    host.ask({ op: 'start' });
    gus.ask({ op: 'call', call: 'select', args: [mine] });
    const before = pushes(host).length;
    const selected = host.ask({ op: 'call', call: 'select', args: [theirs] });
    expect(selected.ok?.['seq']).toBe(4);
    // A selection is each page's own: nothing on the board the others see changed.
    expect(pushes(gus).filter((m) => m['push'] !== undefined)).toHaveLength(0);
    const reach = host.ask({ op: 'ask', ask: 'reach' }).ok as { tiles: number[] };
    const moved = host.ask({ op: 'call', call: 'moveSelectedTo', args: [reach.tiles.at(-1)] });
    expect(moved.error).toBeUndefined();
    const pushed = pushes(gus).find((m) => m['push'] !== undefined)?.['push'] as { by: string; seq: number; board: { replica: { party: { selected: string } } } };
    expect(pushed).toMatchObject({ by: 'h', seq: moved.ok?.['seq'] });
    expect(pushed.board.replica.party.selected).toBe(mine);
    expect(pushes(host).length).toBe(before);
  });

  it.skipIf(!built)('says what is said at the table to the others, kept for whoever comes after', async () => {
    const { table, host } = await opened();
    const gus = guest(table);
    gus.ask({ op: 'join' });
    expect(gus.ask({ op: 'say', text: '  hello  ' }).ok).toEqual({ line: { from: 'g', name: 'Gus', text: 'hello', at: 7 } });
    expect(pushes(host).at(-1)).toEqual({ chat: { from: 'g', name: 'Gus', text: 'hello', at: 7 } });
    expect(gus.ask({ op: 'say', text: 'x'.repeat(CHAT_LONGEST + 1) }).error).toBe(`a line is ${CHAT_LONGEST} characters at most`);
    expect(guest(table, 'k', 'Kit').ask({ op: 'join' }).ok?.['chat']).toHaveLength(1);
  });

  it.skipIf(!built)('loads the host\'s save alone, from the host\'s browser', async () => {
    const saves = new Map<string, string>();
    const { table, host } = await opened({ readSave: (slot) => (saves.has(slot) ? { text: saves.get(slot)! } : null) });
    const gus = guest(table);
    gus.ask({ op: 'join' });
    expect(gus.ask({ op: 'load', slot: 's1' }).error).toBe('only the host loads a save into a game others are at');
    expect(host.ask({ op: 'load', slot: 's1' }).error).toBe('no such save');
    expect(host.ask({ op: 'save', slot: 's1' }).error).toBe("the host's page keeps this game's saves");
  });

  it.skipIf(!built)('turns away a guest who says they are the host', async () => {
    const { table } = await opened();
    let closed = false;
    const at = far();
    table.attach({ ...at.link, close: () => void (closed = true) }, { id: 'h', name: 'Not Hana' });
    expect(closed).toBe(true);
    expect(table.table().members).toEqual([{ id: 'h', name: 'Hana' }]);
  });
});
