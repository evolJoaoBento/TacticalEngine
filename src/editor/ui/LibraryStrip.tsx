/**
 * The strip along the bottom of the board: tabs of things to put down, a
 * search across all of them, and the one in hand marked.
 */

import { useState } from 'preact/hooks';
import { filterLibrary, type LibraryItem, type LibraryTab } from '../library';
import { Icon } from './icons';

/** What the strip needs to draw a mode's tabs and report a pick. */
export interface LibraryStripProps {
  tabs: readonly LibraryTab[];
  /** The id the tool holds, marked on its card. */
  picked: string;
  onPick: (item: LibraryItem) => void;
  /** Which strip this is, for a test: `terrain-library`, `combat-library`. */
  testId: string;
}

export function LibraryStrip(props: LibraryStripProps): preact.JSX.Element {
  const [tabId, setTabId] = useState(props.tabs[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const tab = props.tabs.find((t) => t.id === tabId) ?? props.tabs[0];
  const items = searching ? filterLibrary(props.tabs, query) : (tab?.items ?? []);

  return (
    <footer class="ph-library ph-panel" data-testid={props.testId}>
      <div class="ph-library-tabs">
        {props.tabs.map((t) => (
          <button
            key={t.id}
            class={t.id === tab?.id && !searching ? 'ph-tab ph-on' : 'ph-tab'}
            data-tab={t.id}
            onClick={() => {
              setTabId(t.id);
              setQuery('');
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
        {items.length === 0 ? <div class="ph-empty">Nothing matches.</div> : null}
        {items.map((item) => (
          <button
            key={`${item.tab}:${item.id}`}
            class={item.id === props.picked ? 'ph-card ph-on' : 'ph-card'}
            data-item={item.id}
            title={item.detail === undefined ? item.label : `${item.label} · ${item.detail}`}
            onClick={() => props.onPick(item)}
          >
            <span class="ph-thumb" style={item.swatch === undefined ? undefined : { background: item.swatch }}>
              {item.swatch === undefined ? <span class="ph-glyph">{item.label.slice(0, 1)}</span> : null}
            </span>
            <span class="ph-card-label">{item.label}</span>
            {item.detail === undefined ? null : <span class="ph-card-detail">{item.detail}</span>}
          </button>
        ))}
      </div>
    </footer>
  );
}
