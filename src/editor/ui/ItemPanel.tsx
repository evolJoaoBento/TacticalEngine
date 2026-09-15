/**
 * The Items panel: what the party can carry, and what a chest gives them.
 *
 * One list for both halves, because they only mean anything together — a loot
 * table names items, and an item's own effects are the same list every other
 * panel edits. The kinds are the SRD's shape of a thing rather than a taxonomy:
 * a key is a thing a door asks for, a consumable is spent by using it, a weapon
 * or armour points at SRD content through `contentId` so equipping is a lookup
 * rather than a copy, and a trinket is everything else.
 *
 * A table's entries are weighted against each other, not against a hundred, so
 * the panel shows the odds it works out to rather than asking for percentages.
 */

import { useState } from 'preact/hooks';
import type { EditorSession } from '../session';
import {
  addItem,
  addLootTable,
  removeItem,
  removeLootTable,
  updateItem,
  updateLootTable,
} from '../session';
import { itemSchema, lootTableSchema, type ItemDef, type LootTable } from '../../engine/content/items';
import type { QuestDef } from '../../engine/content/quests';
import type { ContentPack } from '../../engine/content/pack/import';
import { EffectList } from './EffectList';

export interface ItemPanelProps {
  session: EditorSession;
  onChange: () => void;
  onClose: () => void;
  /** What an item's own effects can name. */
  hookIds: readonly string[];
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
  /** The vendored SRD content a weapon or armour item stands for. */
  content: ContentPack;
}

/** Sorted `id → name` pairs, so a dropdown reads as words and writes an id. */
function options(map: ReadonlyMap<string, { id: string; name: string }>): { id: string; name: string }[] {
  return [...map.values()].map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
}

const KINDS: readonly ItemDef['kind'][] = ['key', 'consumable', 'weapon', 'armor', 'trinket'];

const field: Record<string, string | number> = {
  padding: '3px 5px',
  background: 'var(--ph-field)',
  color: 'inherit',
  border: '1px solid var(--ph-line)',
  borderRadius: '3px',
  font: 'inherit',
  boxSizing: 'border-box',
};

const button = (active: boolean): Record<string, string | number> => ({
  padding: '3px 8px',
  border: `1px solid ${active ? 'var(--ph-accent)' : 'var(--ph-line)'}`,
  borderRadius: '3px',
  background: active ? 'var(--ph-accent-bg)' : 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
});

const labelled = (text: string, control: preact.JSX.Element): preact.JSX.Element => (
  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--ph-muted)' }}>
    {text}
    {control}
  </label>
);

/** Turn a name into an id the way every other "+ …" button does. */
function idFrom(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

type Open = { kind: 'item'; id: string } | { kind: 'table'; id: string } | null;

export function ItemPanel(props: ItemPanelProps): preact.JSX.Element {
  const { session } = props;
  const first = session.project.items[0];
  const [open, setOpen] = useState<Open>(first === undefined ? null : { kind: 'item', id: first.id });

  const item = open?.kind === 'item' ? (session.project.items.find((i) => i.id === open.id) ?? null) : null;
  const table = open?.kind === 'table' ? (session.project.lootTables.find((t) => t.id === open.id) ?? null) : null;
  const itemIds = session.project.items.map((i) => i.id);

  const editItem = (changes: Partial<ItemDef>): void => {
    if (item === null) return;
    session.run(updateItem(item.id, changes));
    props.onChange();
  };
  const editTable = (changes: Partial<LootTable>): void => {
    if (table === null) return;
    session.run(updateLootTable(table.id, changes));
    props.onChange();
  };

  const listButton = (id: string, label: string, mine: Open, remove: () => void): preact.JSX.Element => (
    <div key={id} style={{ display: 'flex', gap: '4px' }}>
      <button
        style={{ ...button(open?.kind === mine?.kind && open?.id === id), flex: 1, textAlign: 'left' }}
        data-entry={id}
        onClick={() => setOpen(mine)}
      >
        {label}
      </button>
      <button style={button(false)} title="Delete" onClick={remove}>
        ✕
      </button>
    </div>
  );

  return (
    <div
      data-testid="item-panel"
      style={{
        position: 'absolute',
        inset: '0',
        // Over the map, which is a canvas that would otherwise swallow clicks.
        pointerEvents: 'auto',
        zIndex: 2,
        background: 'var(--ph-surface)',
        border: '1px solid var(--ph-line)',
        borderRadius: '0',
        padding: '10px',
        display: 'flex',
        gap: '10px',
        overflow: 'hidden',
        color: 'var(--ph-text)',
        font: '12px/1.5 system-ui, sans-serif',
      }}
    >
      <div style={{ width: '180px', display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'auto' }}>
        <div style={{ fontWeight: 600, marginBottom: '2px' }}>Items</div>
        {session.project.items.map((entry) =>
          listButton(entry.id, entry.name, { kind: 'item', id: entry.id }, () => {
            if (!confirm(`Delete "${entry.name}"?`)) return;
            session.run(removeItem(entry.id));
            if (open?.kind === 'item' && open.id === entry.id) setOpen(null);
            props.onChange();
          }),
        )}
        <button
          style={button(false)}
          data-testid="add-item"
          onClick={() => {
            const typed = prompt('Item name', 'A thing');
            if (typed === null || typed === '') return;
            const id = idFrom(typed);
            if (id === '' || session.project.items.some((i) => i.id === id)) return;
            session.run(addItem(itemSchema.parse({ id, name: typed })));
            setOpen({ kind: 'item', id });
            props.onChange();
          }}
        >
          + Item
        </button>

        <div style={{ fontWeight: 600, margin: '8px 0 2px' }}>Loot tables</div>
        {session.project.lootTables.map((entry) =>
          listButton(entry.id, entry.id, { kind: 'table', id: entry.id }, () => {
            if (!confirm(`Delete "${entry.id}"?`)) return;
            session.run(removeLootTable(entry.id));
            if (open?.kind === 'table' && open.id === entry.id) setOpen(null);
            props.onChange();
          }),
        )}
        <button
          style={button(false)}
          data-testid="add-loot-table"
          onClick={() => {
            const typed = prompt('Loot table id', 'a-table');
            if (typed === null || typed === '') return;
            const id = idFrom(typed);
            const anything = session.project.items[0]?.id;
            if (id === '' || anything === undefined || session.project.lootTables.some((t) => t.id === id)) return;
            // A table must have an entry to be a table, so it starts with one.
            session.run(addLootTable(lootTableSchema.parse({ id, entries: [{ item: anything }] })));
            setOpen({ kind: 'table', id });
            props.onChange();
          }}
        >
          + Loot table
        </button>

        <div style={{ marginTop: 'auto' }}>
          <button style={button(false)} data-testid="close-items" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, overflow: 'auto' }}>
        {item === null && table === null ? (
          <div style={{ color: 'var(--ph-muted)' }}>
            Nothing selected. An item is a thing the party can carry; a loot table is what a chest draws from.
            A table needs at least one item to exist, so write an item first.
          </div>
        ) : null}

        {item === null ? null : (
          <>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                style={{ ...field, flex: 1 }}
                value={item.name}
                placeholder="name"
                data-testid="item-name"
                onInput={(e) => editItem({ name: (e.target as HTMLInputElement).value })}
              />
              <span style={{ color: 'var(--ph-muted)' }}>{item.id}</span>
            </div>
            <input
              style={field}
              value={item.description}
              placeholder="what it looks like in the pack"
              data-testid="item-description"
              onInput={(e) => editItem({ description: (e.target as HTMLInputElement).value })}
            />
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              {labelled(
                'is a',
                <select
                  style={{ ...field, width: '110px' }}
                  data-testid="item-kind"
                  value={item.kind}
                  onChange={(e) => editItem({ kind: (e.target as HTMLSelectElement).value as ItemDef['kind'] })}
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>,
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--ph-muted)' }}>
                <input
                  type="checkbox"
                  data-testid="item-stackable"
                  checked={item.stackable}
                  onChange={(e) => editItem({ stackable: (e.target as HTMLInputElement).checked })}
                />
                a second one adds to the count
              </label>
            </div>
            {item.kind === 'weapon' || item.kind === 'armor' ? (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {labelled(
                  'stands for',
                  <select
                    style={{ ...field, width: '200px' }}
                    data-testid="item-content-id"
                    value={item.contentId ?? ''}
                    onChange={(e) => {
                      const contentId = (e.target as HTMLSelectElement).value;
                      editItem({ contentId: contentId === '' ? undefined : contentId });
                    }}
                  >
                    <option value="">— nothing —</option>
                    {options(item.kind === 'weapon' ? props.content.weapons : props.content.armors).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>,
                )}
                <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>
                  Equipping is a lookup into the SRD content, not a copy of it.
                </span>
              </div>
            ) : null}

            <div style={{ color: 'var(--ph-label)', fontSize: '11px' }}>
              What using it does{item.kind === 'consumable' ? ' (and it is spent)' : ''}
            </div>
            <EffectList
              testId="item-effects"
              effects={item.use}
              onChange={(use) => editItem({ use })}
              sceneIds={props.sceneIds}
              dialogueIds={props.dialogueIds}
              encounterIds={props.encounterIds}
              quests={props.quests}
              hookIds={props.hookIds}
            />
            {item.use.length === 0 ? (
              <div style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>Nothing: it sits in the pack.</div>
            ) : null}
          </>
        )}

        {table === null ? null : (
          <>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{table.id}</strong>
              {labelled(
                'draws',
                <input
                  type="number"
                  min={0}
                  style={{ ...field, width: '56px' }}
                  data-testid="loot-rolls"
                  value={table.rolls}
                  onInput={(e) => editTable({ rolls: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })}
                />,
              )}
              <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>times</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }} data-testid="loot-entries">
              {table.entries.map((entry, i) => {
                const total = table.entries.reduce((sum, e) => sum + e.weight, 0);
                const odds = total === 0 ? 0 : Math.round((entry.weight / total) * 100);
                const range = typeof entry.quantity === 'object' ? entry.quantity : null;
                return (
                  <div key={i} style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }} data-entry-row={i}>
                    <select
                      style={{ ...field, width: '150px' }}
                      data-role="loot-item"
                      value={entry.item}
                      onChange={(e) =>
                        editTable({
                          entries: table.entries.map((x, j) =>
                            j === i ? { ...x, item: (e.target as HTMLSelectElement).value } : x,
                          ),
                        })
                      }
                    >
                      {itemIds.length === 0 ? <option value="">(no items yet)</option> : null}
                      {session.project.items.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      style={{ ...field, width: '52px' }}
                      data-role="loot-min"
                      title={range === null ? 'How many' : 'Fewest'}
                      value={range === null ? (entry.quantity as number) : range.min}
                      onInput={(e) => {
                        const value = Math.max(1, Number((e.target as HTMLInputElement).value) || 1);
                        const quantity = range === null ? value : { min: value, max: Math.max(value, range.max) };
                        editTable({ entries: table.entries.map((x, j) => (j === i ? { ...x, quantity } : x)) });
                      }}
                    />
                    {range === null ? null : (
                      <input
                        type="number"
                        min={range.min}
                        style={{ ...field, width: '52px' }}
                        data-role="loot-max"
                        title="Most"
                        value={range.max}
                        onInput={(e) => {
                          const value = Math.max(range.min, Number((e.target as HTMLInputElement).value) || range.min);
                          editTable({
                            entries: table.entries.map((x, j) => (j === i ? { ...x, quantity: { min: range.min, max: value } } : x)),
                          });
                        }}
                      />
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '11px', color: 'var(--ph-muted)' }}>
                      <input
                        type="checkbox"
                        data-role="loot-range"
                        title="A range rolled per drop"
                        checked={range !== null}
                        onChange={(e) => {
                          const on = (e.target as HTMLInputElement).checked;
                          const flat = range === null ? (entry.quantity as number) : range.min;
                          const quantity = on ? { min: flat, max: flat + 1 } : flat;
                          editTable({ entries: table.entries.map((x, j) => (j === i ? { ...x, quantity } : x)) });
                        }}
                      />
                      a range
                    </label>
                    <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>weight</span>
                    <input
                      type="number"
                      min={1}
                      style={{ ...field, width: '52px' }}
                      data-role="loot-weight"
                      value={entry.weight}
                      onInput={(e) =>
                        editTable({
                          entries: table.entries.map((x, j) =>
                            j === i ? { ...x, weight: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) } : x,
                          ),
                        })
                      }
                    />
                    {/* Weights are relative, so the useful reading is the odds. */}
                    <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }} data-role="loot-odds">
                      {odds}%
                    </span>
                    <button
                      style={button(false)}
                      title="Remove this entry"
                      disabled={table.entries.length <= 1}
                      onClick={() => editTable({ entries: table.entries.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button
                style={{ ...button(false), alignSelf: 'flex-start' }}
                data-testid="add-loot-entry"
                disabled={itemIds.length === 0}
                onClick={() =>
                  editTable({ entries: [...table.entries, { item: itemIds[0]!, quantity: 1, weight: 1 }] })
                }
              >
                + Entry
              </button>
            </div>
            <div style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>
              A table with no draws gives nothing; the odds are each entry's weight against the rest of the
              table, not a percentage that has to reach a hundred.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
