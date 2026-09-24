/**
 * What a shop sells: a line per item - its price, and how many there are (empty is as many as the
 * party can pay for) - and the item it is paid in. The same control for a merchant's interaction
 * (`CreatureInteraction`) and a prop with the Shop function (`PropFunctionEditor`), since a shop is
 * the same thing whoever keeps it.
 */

import { useState } from 'preact/hooks';
import type { Shop } from '../../engine/scene/prop-function-schema';

export interface StockEditorProps {
  /** Tells two editors on one panel apart. */
  prefix?: string;
  shop: Shop;
  items: readonly { id: string; name: string }[];
  onChange: (shop: Shop) => void;
}

export function StockEditor(props: StockEditorProps): preact.JSX.Element {
  const prefix = props.prefix ?? '';
  const { shop, items } = props;
  const [adding, setAdding] = useState(items[0]?.id ?? '');
  const nameOf = (item: string): string => items.find((known) => known.id === item)?.name ?? item;
  const change = (at: number, line: Partial<Shop['stock'][number]>): void =>
    props.onChange({ ...shop, stock: shop.stock.map((old, i) => (i === at ? { ...old, ...line } : old)) });
  const whole = (value: string): number | undefined => {
    const n = Math.round(Number(value));
    return value.trim() === '' || !Number.isFinite(n) || n < 0 ? undefined : n;
  };
  return (
    <div data-testid={`${prefix}shop-stock`}>
      <label class="ph-heading">
        Paid in
        <select class="ph-select" data-testid={`${prefix}shop-currency`} value={shop.currency} onChange={(e) => props.onChange({ ...shop, currency: e.currentTarget.value })}>
          {items.some((known) => known.id === shop.currency) ? null : <option value={shop.currency}>{shop.currency} (missing)</option>}
          {items.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>
      <label class="ph-heading">
        Buys back at, % of worth
        <input
          class="ph-input"
          type="number"
          min="0"
          max="100"
          step="5"
          placeholder="50"
          data-testid={`${prefix}shop-buys-at`}
          title="What it pays for what the party sells it, as a share of the thing's worth: its own price for its own lines, else the item's value. Empty is half; a fence pays less, a temple more, up to 100; 0 buys nothing."
          value={shop.buysAt ?? ''}
          onChange={(e) => {
            const typed = e.currentTarget.value.trim();
            const n = Math.round(Number(typed));
            const { buysAt: _gone, ...rest } = shop;
            props.onChange(typed === '' || !Number.isFinite(n) ? rest : { ...rest, buysAt: Math.min(100, Math.max(0, n)) });
          }}
        />
      </label>
      {shop.stock.length === 0 ? (
        <div class="ph-note">Nothing for sale yet. Add what it sells below.</div>
      ) : (
        <div class="ph-row ph-note" style={{ margin: 0 }}>
          <span style={{ flex: 1 }}>Sells</span>
          <span style={{ width: '56px' }}>price</span>
          <span style={{ width: '56px' }}>how many</span>
          <span style={{ width: '26px' }} />
        </div>
      )}
      {shop.stock.map((line, at) => (
        <div key={`${line.item}-${at}`} class="ph-row" data-stock={line.item}>
          <span style={{ flex: 1 }}>{nameOf(line.item)}</span>
          <input
            class="ph-input"
            style={{ width: '56px' }}
            type="number"
            min="0"
            step="1"
            data-testid={`${prefix}shop-price`}
            aria-label={`Price of ${nameOf(line.item)}`}
            title="Price, in what it is paid in"
            value={line.price}
            onChange={(e) => change(at, { price: whole(e.currentTarget.value) ?? 0 })}
          />
          <input
            class="ph-input"
            style={{ width: '56px' }}
            type="number"
            min="1"
            step="1"
            placeholder="∞"
            data-testid={`${prefix}shop-count`}
            aria-label={`How many ${nameOf(line.item)} it has`}
            title="How many it has to sell. Empty is as many as the party can pay for."
            value={line.count ?? ''}
            onChange={(e) => {
              const n = whole(e.currentTarget.value);
              const { count: _gone, ...rest } = line;
              props.onChange({ ...shop, stock: shop.stock.map((old, i) => (i === at ? (n === undefined || n === 0 ? rest : { ...rest, count: n }) : old)) });
            }}
          />
          <button class="ph-chip" title="Stop selling it" data-testid={`${prefix}shop-remove`} onClick={() => props.onChange({ ...shop, stock: shop.stock.filter((_, i) => i !== at) })}>
            ✕
          </button>
        </div>
      ))}
      <div class="ph-row">
        <select class="ph-select" data-testid={`${prefix}shop-pick`} aria-label="Something to sell" value={adding} onChange={(e) => setAdding(e.currentTarget.value)}>
          {items.length === 0 ? <option value="">The project has no items yet</option> : null}
          {items.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
        <button
          class="ph-chip"
          data-testid={`${prefix}shop-add`}
          disabled={adding === '' || shop.stock.some((line) => line.item === adding)}
          onClick={() => props.onChange({ ...shop, stock: [...shop.stock, { item: adding, price: 1 }] })}
        >
          Sell
        </button>
      </div>
    </div>
  );
}
