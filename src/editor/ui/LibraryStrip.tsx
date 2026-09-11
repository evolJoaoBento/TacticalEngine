/**
 * The strip along the bottom of the board: tabs of things to put down, a
 * search across all of them, and the one in hand marked.
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
}

export function LibraryStrip(props: LibraryStripProps): preact.JSX.Element {
  const [tabId, setTabId] = useState(props.tabs[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const tab = props.tabs.find((t) => t.id === (props.activeTab ?? tabId)) ?? props.tabs[0];
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
        {items.length === 0 ? <div class="ph-empty">Nothing matches.</div> : null}
        {items.map((item) => (
          <button
            key={`${item.tab}:${item.id}`}
            class={item.id === props.picked ? 'ph-card ph-on' : 'ph-card'}
            data-item={item.id}
            title={item.detail === undefined ? item.label : `${item.label} · ${item.detail}`}
            onClick={() => { setTabId(item.tab); setQuery(''); props.onPick(item); }}
          >
            <span class="ph-thumb" style={item.swatch === undefined ? undefined : { background: item.swatch }}>
              {item.tab === 'tiles' ? <svg viewBox="0 0 80 80" width="72" height="72" aria-hidden="true" class="ph-tile-icon">
                {item.id === 'tile-stairs' ? <>
                  <path d="M10 53l30 17 30-17V23L40 6v10l-10 6v10l-10 6v10z" fill="#686275" />
                  <path d="M10 53l30 17V60L20 48m0-10l30 17V45L30 32m0-10l30 17V29L40 16" fill="#9e96b0" />
                  <path d="M40 6l30 17-10 6-30-17M30 22l30 17-10 6-30-17M20 38l30 17-10 5-30-17" fill="#c5bdd5" />
                </> : <g transform={item.id === 'tile-floor' ? 'translate(0 40) scale(1 .35)' : item.id === 'tile-wall' ? 'translate(18 0) scale(.55 1)' : ''}>
                  <path d="M10 24L40 7l30 17-30 17z" fill="#c5bdd5" />
                  <path d="M10 24l30 17v33L10 57z" fill="#9e96b0" />
                  <path d="M40 41l30-17v33L40 74z" fill="#686275" />
                </g>}
              </svg> : item.swatch === undefined ? <span class="ph-glyph">{item.label.slice(0, 1)}</span> : null}
            </span>
            <span class="ph-card-label">{item.label}</span>
            {item.detail === undefined ? null : <span class="ph-card-detail">{item.detail}</span>}
          </button>
        ))}
      </div>
    </footer>
  );
}
