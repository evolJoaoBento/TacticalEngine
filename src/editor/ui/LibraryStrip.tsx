/**
 * The strip along the bottom of the board: tabs of things to put down, a
 * search across all of them, and the one in hand marked.
 *
 * Every card shows what it puts down. Tiles and objects are drawn here, since
 * neither has a model of its own; ground is its colour; a prop or a creature is
 * a picture of its model, which the editor cannot draw and so is handed in as
 * `thumbnail`. A letter is the last resort, for a browser that gives no picture.
 */

import { useState } from 'preact/hooks';
import { filterLibrary, type LibraryItem, type LibraryTab } from '../library';
import { Icon } from './icons';

/** What the strip needs to draw a mode's tabs and report a pick. */
export interface LibraryStripProps {
  activeTab?: string;
  onTab?: (tab: string) => void;
  tabs: readonly LibraryTab[];
  /** The id the tool holds, marked on its card. */
  picked: string;
  onPick: (item: LibraryItem) => void;
  /** Which strip this is, for a test: `terrain-library`, `combat-library`. */
  testId: string;
  /**
   * A picture of an item's model, or null when there is none to show. `standIn` when the picture
   * is of the body the board draws in place of a model the item does not have yet.
   */
  thumbnail?: (item: LibraryItem) => { url: string; standIn: boolean } | null;
}

export function LibraryStrip(props: LibraryStripProps): preact.JSX.Element {
  const [tabId, setTabId] = useState(props.tabs[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const tab = props.tabs.find((t) => t.id === (props.activeTab ?? tabId)) ?? props.tabs[0];
  const items = searching ? filterLibrary(props.tabs, query) : (tab?.items ?? []);

  const face = (item: LibraryItem): preact.JSX.Element | null => {
    // A kind of tile is its model's picture when it names a model, over the colour it declares,
    // which is what the card is when it names none - or while the picture is still being drawn.
    if (item.swatch !== undefined && item.model === undefined) return null;
    const picture = props.thumbnail?.(item) ?? null;
    if (picture === null) return item.swatch !== undefined ? null : <span class="ph-glyph">{item.label.slice(0, 1)}</span>;
    return (
      <>
        <img src={picture.url} alt="" draggable={false} />
        {picture.standIn ? (
          <span class="ph-stand-in" title="No model of its own yet: the board draws this stand-in until it has one">
            stand-in
          </span>
        ) : null}
      </>
    );
  };

  return (
    <footer class="ph-library ph-panel" data-testid={props.testId}>
      <div class="ph-library-tabs">
        {props.tabs.map((t) => (
          <button
            key={t.id}
            class={`ph-tab${t.id === tab?.id && !searching ? ' ph-on' : ''}${t.items.length === 0 ? ' ph-tab-empty' : ''}`}
            title={t.items.length === 0 ? 'Nothing here yet' : undefined}
            data-tab={t.id}
            onClick={() => {
              setTabId(t.id);
              setQuery('');
              props.onTab?.(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
        <label class="ph-search">
          <Icon name="search" size={14} />
          <input
            value={query}
            placeholder="Search"
            data-testid="library-search"
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="ph-library-row">
        {/* A search that missed and a tab with nothing in it are different news. */}
        {items.length === 0 ? (
          <div class="ph-empty">{searching ? 'Nothing matches.' : `Nothing in ${tab?.label ?? 'this tab'} yet.`}</div>
        ) : null}
        {items.map((item) => (
          <button
            key={`${item.tab}:${item.id}`}
            class={item.id === props.picked ? 'ph-card ph-on' : 'ph-card'}
            data-item={item.id}
            title={item.detail === undefined ? item.label : `${item.label} · ${item.detail}`}
            onClick={() => { setTabId(item.tab); setQuery(''); props.onPick(item); }}
          >
            <span class="ph-thumb" style={item.swatch === undefined ? undefined : { background: item.swatch }}>
              {face(item)}
            </span>
            <span class="ph-card-label">{item.label}</span>
            {item.detail === undefined ? null : <span class="ph-card-detail">{item.detail}</span>}
          </button>
        ))}
      </div>
    </footer>
  );
}
