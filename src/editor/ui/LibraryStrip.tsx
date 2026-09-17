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

/** The editor's greys, lit from the upper left: top, left face, right face. */
const TOP = '#cfcfcf';
const LEFT = '#a3a3a3';
const RIGHT = '#6f6f6f';
const GOLD = '#d7b96b';
const GLOW = '#5f8ad0';

/** An interactable kind, in the same isometric greys, with its one telling detail picked out. */
function ObjectIcon(props: { kind: string }): preact.JSX.Element {
  let body: preact.JSX.Element;
  switch (props.kind) {
    case 'chest':
      body = (
        <>
          <path d="M14 42L40 57v18L14 60z" fill={LEFT} />
          <path d="M40 57L66 42v18L40 75z" fill={RIGHT} />
          <path d="M14 34L40 49v8L14 42z" fill="#b3b3b3" />
          <path d="M40 49L66 34v8L40 57z" fill="#7d7d7d" />
          <path d="M14 34L40 19l26 15-26 15z" fill={TOP} />
          <path d="M24 47l6 3.5v8L24 55z" fill={GOLD} />
        </>
      );
      break;
    case 'door':
      body = (
        <>
          <path d="M16 20L42 35v40L16 60z" fill={LEFT} />
          <path d="M42 35l6-3.5v40L42 75z" fill={RIGHT} />
          <path d="M16 20l6-3.5 26 15-6 3.5z" fill={TOP} />
          <path d="M21 58L37 67V47Q37 39 29 37Q21 35 21 41z" fill="#7a5a3c" />
          <circle cx="33" cy="57" r="1.8" fill={GOLD} />
        </>
      );
      break;
    case 'pillar':
      body = (
        <>
          <ellipse cx="40" cy="67" rx="15" ry="6" fill={RIGHT} />
          <path d="M30 22h10v45H30z" fill="#b8b8b8" />
          <path d="M40 22h10v45H40z" fill="#7f7f7f" />
          <path d="M27 20v4c0 4 26 4 26 0v-4z" fill="#9a9a9a" />
          <ellipse cx="40" cy="20" rx="13" ry="5" fill={TOP} />
        </>
      );
      break;
    case 'portal':
      body = (
        <>
          <ellipse cx="40" cy="70" rx="20" ry="6" fill={RIGHT} />
          <ellipse cx="40" cy="40" rx="20" ry="30" fill="#9a9a9a" />
          <ellipse cx="40" cy="40" rx="14" ry="23" fill="#243f68" />
          <ellipse cx="40" cy="40" rx="9" ry="16" fill={GLOW} opacity=".85" />
          <path d="M40 27c7 3 7 23 0 26c-5-2-5-16 0-19" fill="none" stroke="#fff" stroke-width="1.6" opacity=".6" />
        </>
      );
      break;
    default:
      // A scripted object: a standing stone with a rune in it, the script being the rune.
      body = (
        <>
          <path d="M28 24L40 31v43L28 67z" fill={LEFT} />
          <path d="M40 31L52 24v43L40 74z" fill={RIGHT} />
          <path d="M28 24L40 12l12 12-12 7z" fill={TOP} />
          <path d="M31 39l6 3.5-4 6 5 3-3 6" fill="none" stroke={GLOW} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </>
      );
  }
  return (
    <svg viewBox="0 0 80 80" width="60" height="60" aria-hidden="true" class="ph-object-icon">
      {body}
    </svg>
  );
}

export function LibraryStrip(props: LibraryStripProps): preact.JSX.Element {
  const [tabId, setTabId] = useState(props.tabs[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const tab = props.tabs.find((t) => t.id === (props.activeTab ?? tabId)) ?? props.tabs[0];
  const items = searching ? filterLibrary(props.tabs, query) : (tab?.items ?? []);

  const face = (item: LibraryItem): preact.JSX.Element | null => {
    // The swatch first, because Tiles is every kind of tile now rather than four shapes
    // with ids of their own. `TileIcon` drew its glyph off a `tile-<shape>` id, and there
    // are no such ids left: a structure is a kind of tile, and shows the colour it declares.
    if (item.swatch !== undefined) return null;
    if (item.tab === 'objects') return <ObjectIcon kind={item.id} />;
    const picture = props.thumbnail?.(item) ?? null;
    if (picture === null) return <span class="ph-glyph">{item.label.slice(0, 1)}</span>;
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
