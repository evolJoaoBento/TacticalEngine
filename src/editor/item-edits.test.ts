import { describe, it, expect } from 'vitest';
import { itemSchema, lootTableSchema } from '../engine/content/items';
import { blankScene } from '../engine/scene/grid-from-scene';
import { interactableSchema, projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importContentPack } from '../engine/content/pack/import';
import {
  EditorSession,
  addItem,
  addLootTable,
  removeItem,
  removeLootTable,
  updateItem,
  updateLootTable,
} from './session';
import { validateProject } from './validate';

/**
 * Items and the tables that hand them out, as documents. The panel is a view
 * over these; the thing worth testing here is that deleting one half does not
 * quietly repair the other — the validator's job is to say what now names
 * nothing, and it can only do that if the reference survives the delete.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = (name: string): unknown[] =>
  JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/daggersearch/core/${name}.json`, 'utf8'));
const content = importContentPack({
  weapons: read('weapons'),
  armors: read('armors'),
  classes: read('classes'),
  ancestries: read('ancestries'),
  communities: read('communities'),
  subclasses: read('subclasses'),
  domainCards: read('domain-cards'),
}).content;

const KEY = { id: 'brass-key', name: 'A brass key', kind: 'key' };
const TABLE = { id: 'chest', rolls: 2, entries: [{ item: 'brass-key', weight: 3 }] };

function project(): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', 6, 4))],
    items: [itemSchema.parse(KEY)],
    lootTables: [lootTableSchema.parse(TABLE)],
    startScene: 'room',
  });
}

const session = (): EditorSession => new EditorSession(project());

describe('items in the project', () => {
  it('adds and removes one, putting it back where it was', () => {
    const s = session();
    s.run(addItem(itemSchema.parse({ id: 'rope', name: 'Rope' })));
    expect(s.project.items.map((i) => i.id)).toEqual(['brass-key', 'rope']);

    expect(s.run(removeItem('brass-key'))).toBe(true);
    expect(s.project.items.map((i) => i.id)).toEqual(['rope']);
    s.undo();
    expect(s.project.items.map((i) => i.id)).toEqual(['brass-key', 'rope']);
  });

  it('coalesces keystrokes in one field and starts again on another', () => {
    const s = session();
    for (const name of ['A', 'A b', 'A br', 'A brass key, worn']) s.run(updateItem('brass-key', { name }));
    expect(s.project.items[0]!.name).toBe('A brass key, worn');
    s.run(updateItem('brass-key', { kind: 'trinket' }));
    s.undo();
    expect(s.project.items[0]!.kind).toBe('key');
    expect(s.project.items[0]!.name).toBe('A brass key, worn');
  });

  it('carries an effect list, which round-trips through the schema', () => {
    const s = session();
    s.run(
      updateItem('brass-key', {
        kind: 'consumable',
        use: [{ kind: 'heal', amount: 2, target: { kind: 'actor' } }],
      }),
    );
    const parsed = projectSchema.parse(JSON.parse(JSON.stringify(s.project)));
    expect(parsed.items[0]!.use).toEqual([{ kind: 'heal', amount: 2, target: { kind: 'actor' } }]);
  });

  it('reports a weapon item standing for SRD content that does not exist', () => {
    const s = session();
    s.run(updateItem('brass-key', { kind: 'weapon', contentId: 'vorpal-nonsense' }));
    expect(validateProject(s.project, { characterContent: content }).map((p) => p.message).join(' ')).toContain(
      'vorpal-nonsense',
    );
    s.run(updateItem('brass-key', { contentId: 'broadsword' }));
    expect(validateProject(s.project, { characterContent: content })).toEqual([]);
  });

  it('reports a door wanting a key nobody can carry', () => {
    const s = session();
    const scene = s.project.scenes[0]!;
    scene.interactables.push(
      interactableSchema.parse({ id: 'door-1', kind: 'door', position: { x: 1, y: 1 }, requiresKey: 'no-such-key' }),
    );
    expect(validateProject(s.project).map((p) => p.message).join(' ')).toContain('no-such-key');
  });

  it('does not repair a table that named a deleted item — it reports it', () => {
    const s = session();
    s.run(removeItem('brass-key'));
    expect(s.project.lootTables[0]!.entries[0]!.item).toBe('brass-key');
    expect(validateProject(s.project).map((p) => p.message).join(' ')).toContain('brass-key');
  });
});

describe('loot tables in the project', () => {
  it('adds, edits and removes one', () => {
    const s = session();
    s.run(addLootTable(lootTableSchema.parse({ id: 'pockets', entries: [{ item: 'brass-key' }] })));
    expect(s.project.lootTables.map((t) => t.id)).toEqual(['chest', 'pockets']);

    s.run(updateLootTable('pockets', { rolls: 3 }));
    expect(s.project.lootTables[1]!.rolls).toBe(3);

    expect(s.run(removeLootTable('pockets'))).toBe(true);
    s.undo();
    expect(s.project.lootTables.map((t) => t.id)).toEqual(['chest', 'pockets']);
  });

  it('removing a table that is not there is a no-op, not an undo step', () => {
    const s = session();
    expect(s.run(removeLootTable('nope'))).toBe(false);
    expect(s.canUndo).toBe(false);
  });

  it('keeps a quantity range through the schema, and rejects one that runs backwards', () => {
    const s = session();
    s.run(updateLootTable('chest', { entries: [{ item: 'brass-key', quantity: { min: 2, max: 5 }, weight: 1 }] }));
    const parsed = projectSchema.parse(JSON.parse(JSON.stringify(s.project)));
    expect(parsed.lootTables[0]!.entries[0]!.quantity).toEqual({ min: 2, max: 5 });

    s.run(updateLootTable('chest', { entries: [{ item: 'brass-key', quantity: { min: 5, max: 2 }, weight: 1 }] }));
    expect(projectSchema.safeParse(JSON.parse(JSON.stringify(s.project))).success).toBe(false);
  });
});
