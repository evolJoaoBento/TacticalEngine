import { useEffect, useRef, useState } from 'preact/hooks';
import type { GrantedCard, LoadoutCard, LoadoutView, SheetStats } from '../demo-abilities';
import { CardFace, GrantedFace } from './CardFace';
import { CardArtImport } from './CardArtImport';
import { useGearPages } from './GearBinder';
import { Pips, type HudMember } from './PartyHud';
import type { GearView } from '../gear';
import type { GearSlot } from '../equip';
import './cards.css';
// The left leaf draws the same pools the party sheets do, in the same ink.
import './hud.css';

export interface LoadoutPanelProps {
  name: string;
  view: LoadoutView;
  resting: boolean;
  /** Who this is, for the sheet on the left leaf. Absent in the editor, where there is no party. */
  sheet?: HudMember;
  /**
   * The photograph taped to the sheet, as a data URL.
   *
   * A picture rather than the callback the party HUD takes: that one draws several members and asks
   * for each in turn, where a binder is open at exactly one character.
   */
  portrait?: string | null;
  issue: string | null;
  onSwap: (cardIn: string, cardOut: string | undefined) => void;
  onClose: () => void;
  /**
   * What they carry and what the party does, for the gear pages the sheet's Equipment button lays
   * over the binder (`GearBinder.tsx`). Absent - the editor's binder - there is no such button.
   */
  gear?: GearView;
  onEquip?: (itemId: string) => void;
  onUnequip?: (slot: GearSlot) => void;
  onUseItem?: (itemId: string) => void;
}

const NO_GEAR: GearView = { slots: [], carried: [] };
const nothing = (): void => undefined;
/**
 * How long the turn to the gear pages takes, and back: one sheet over the rings - `gear-turn-*` in
 * `gear.css`, each half of it half of this. The two have to agree.
 */
const GEAR_TURN_MS = 640;

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);
/** A threshold they do not have is `Infinity`, which is not a number anybody writes on a sheet. */
const threshold = (value: number): string => (Number.isFinite(value) ? `${value}` : '—');

/**
 * The block of numbers a paper sheet is mostly made of: what it takes to hit them, how hard a blow
 * must be to cost more than one Hit Point, and what they add to a roll.
 *
 * The thresholds are laid out the way the printed sheet does it -- the three bands in a line with
 * the two numbers between them -- because that is the shape a player reads damage against: find
 * where the number falls, read off how many Hit Points to mark.
 */
function SheetNumbers({ stats }: { stats: SheetStats }) {
  return <div className="sheet-stats" data-testid="sheet-stats">
    <div className="sheet-defence">
      <div className="sheet-shield" data-testid="sheet-evasion"><b>{stats.evasion}</b><span>Evasion</span></div>
      <div className="sheet-shield" data-testid="sheet-proficiency"><b>{stats.proficiency}</b><span>Proficiency</span></div>
      <div className="sheet-bands" data-testid="sheet-thresholds" aria-label={`Damage thresholds: Major ${threshold(stats.thresholds.major)}, Severe ${threshold(stats.thresholds.severe)}`}>
        <span>Minor<small>mark 1 HP</small></span>
        <b>{threshold(stats.thresholds.major)}</b>
        <span>Major<small>mark 2 HP</small></span>
        <b>{threshold(stats.thresholds.severe)}</b>
        <span>Severe<small>mark 3 HP</small></span>
      </div>
    </div>
    <div className="sheet-traits">
      {stats.traits.map(trait => <div key={trait.id} className={`sheet-trait${trait.spellcast ? ' is-spellcast' : ''}`} data-testid={`sheet-trait-${trait.id}`}>
        <b>{signed(trait.value)}</b><span>{trait.id}</span>{trait.spellcast ? <small>Spellcast</small> : null}
      </div>)}
    </div>
    {stats.experiences.length === 0 ? null : <div className="sheet-experiences">
      <h3>Experiences</h3>
      {stats.experiences.map(experience => <p key={experience.name}><span>{experience.name}</span><b>{signed(experience.modifier)}</b></p>)}
    </div>}
  </div>;
}

/**
 * How many columns the card grid is showing.
 *
 * `repeat(auto-fill, minmax(175px, 1fr))` works the number out from the width, so CSS knows it and
 * nothing else does -- which is why a row could not be squared off in a stylesheet. The used track
 * list does say, though: `grid-template-columns` computes to one length per column. A
 * `ResizeObserver` keeps the count honest as the window changes, rather than measuring once and
 * being wrong for the rest of the session.
 */
function useColumns(ref: { current: HTMLDivElement | null }): { columns: number; width: number } {
  const [track, setTrack] = useState({ columns: 1, width: 0 });
  useEffect(() => {
    const grid = ref.current;
    if (grid === null) return;
    const measure = (): void => {
      // A grid on a leaf that has been turned away from is `display: none`, and a grid with no
      // layout reports a collapsed track list. Reading that would shrink the page size, re-chunk
      // the whole binder underneath whoever is reading it, and strand cards on leaves that did not
      // exist a moment ago -- so a grid with no width is left alone and the last good count stands.
      if (grid.clientWidth === 0) return;
      const tracks = getComputedStyle(grid).gridTemplateColumns;
      const list = tracks === 'none' ? [] : tracks.split(/\s+/).filter(Boolean);
      const columns = Math.max(1, list.length);
      const width = parseFloat(list[0] ?? '0') || 0;
      // Only when it has actually changed: measuring sets state, state re-renders, the render
      // resizes what is being measured. Writing the same numbers back keeps that going round, which
      // is what "ResizeObserver loop completed with undelivered notifications" is complaining about.
      setTrack((was) => (was.columns === columns && was.width === width ? was : { columns, width }));
    };
    measure();
    // Absent under jsdom, where there is no layout to observe anyway.
    if (typeof ResizeObserver === 'undefined') return;
    const watching = new ResizeObserver(measure);
    watching.observe(grid);
    return () => watching.disconnect();
  }, [ref]);
  return track;
}

/**
 * How many rows of cards fit on a page.
 *
 * The pages are only pages if nothing scrolls, so the number has to come from the room there
 * actually is rather than from a guess. A rendered slot is measured where there is one; where a
 * page holds nothing but empty sleeves the height comes off the column width instead, because a
 * sleeve carries no label and is shorter than a slot -- measuring one would fit a row too many and
 * push the last one off the page.
 */
function useRows(box: { current: HTMLDivElement | null }, columnWidth: number, gap: number): number {
  const [rows, setRows] = useState(1);
  useEffect(() => {
    const outer = box.current;
    if (outer === null) return;
    const measure = (): void => {
      if (outer.clientHeight === 0 || columnWidth === 0) return;
      // The body of the leaf on show -- not the first in the document, which may be on a leaf that
      // has been turned away from and so has no height at all. Its height is already what is left
      // after the heading and the pager have taken theirs, so nothing is subtracted from it:
      // taking them off again is what left room for a second row and then refused to use it.
      const body = outer.querySelector('.deck-page:not([hidden]) .deck-page-body');
      const room = body?.getBoundingClientRect().height ?? 0;
      if (room === 0) return;
      // From the column width, never from a rendered card: how many rows fit decides what is
      // rendered, so measuring what was rendered is a loop that settles wherever it likes. A face
      // is `aspect-ratio: .66` inside 5px of sleeve either side, under a one-line label.
      const row = (columnWidth - 10) / 0.66 + 14 + 26;
      const fits = Math.max(1, Math.floor((room + gap) / (row + gap)));
      setRows((was) => (was === fits ? was : fits));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // Bolted to the box, which is always there: a ref that moves between leaves keeps its identity,
    // so an effect keyed on it never re-runs and the observer stays on a node that has been hidden.
    const watching = new ResizeObserver(measure);
    watching.observe(outer);
    return () => watching.disconnect();
  }, [box, columnWidth, gap]);
  return rows;
}

/** How long the cover takes to swing shut: the length of `binder-open` in `cards.css`. */
const CLOSE_MS = 460;

/** Where the punched holes fall down a leaf: the first centre and the pitch, as `cards.css` tiles them. */
const FIRST_HOLE = 49;
const HOLE_PITCH = 78;

/**
 * Which two pairs of holes the rings go through: the pair either side of the middle of the leaf.
 *
 * The holes tile down from the top at a fixed pitch, so how many there are depends on how tall the
 * binder is drawn, and "the centre pairs" moves with it. Fixed offsets put the rings in the middle
 * of one window and near the foot of a shorter one.
 */
function useRingHoles(ref: { current: HTMLDivElement | null }): { a: number; b: number } {
  const [at, setAt] = useState({ a: FIRST_HOLE + 4 * HOLE_PITCH, b: FIRST_HOLE + 6 * HOLE_PITCH });
  useEffect(() => {
    const spread = ref.current;
    if (spread === null) return;
    const measure = (): void => {
      if (spread.clientHeight === 0) return;
      const holes = Math.max(2, Math.floor((spread.clientHeight - FIRST_HOLE - 10) / HOLE_PITCH) + 1);
      const middle = (holes - 1) / 2;
      const apart = Math.max(1, Math.round(holes / 8));
      const a = FIRST_HOLE + Math.max(0, Math.floor(middle) - apart) * HOLE_PITCH;
      const b = FIRST_HOLE + Math.min(holes - 1, Math.ceil(middle) + apart) * HOLE_PITCH;
      setAt((was) => (was.a === a && was.b === b ? was : { a, b }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watching = new ResizeObserver(measure);
    watching.observe(spread);
    return () => watching.disconnect();
  }, [ref]);
  return at;
}

export function LoadoutPanel(props: LoadoutPanelProps): preact.JSX.Element {
  const { view } = props;
  const full = view.loadout.length >= view.limit;
  const [out, setOut] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('all');
  const [inspect, setInspect] = useState<LoadoutCard | GrantedCard | null>(null);
  // Bumped when imported art changes, so every face of that card redraws.
  const [artVersion, setArtVersion] = useState(0);
  // The gear pages: plastic over the sheet with a sleeve for each place gear goes, and the pack
  // over the pockets opposite. Called whether or not they are open, as hooks must be.
  const [gearOpen, setGearOpen] = useState(false);
  // Getting there is turning to a divider: under the card pages on the right lies a black divider
  // whose tab reads Equipment. Its tab turns the card pages and the divider over the rings together -
  // the pages swinging up off the right leaf for the first half of the turn, the divider's black back
  // coming down over the character sheet for the second, meeting edge-on over the rings - and the
  // pack is the page they uncover. On the left the divider's tab reads Back, and turns them home the
  // same way. The pages stay until the turn is done. With motion reduced it is simply there.
  const [gearTurn, setGearTurn] = useState<'in' | 'out' | null>(null);
  const turnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(turnTimer.current), []);
  const turnGear = (open: boolean): void => {
    clearTimeout(turnTimer.current);
    if (typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setGearOpen(open);
      setGearTurn(null);
      return;
    }
    if (open) setGearOpen(true);
    setGearTurn(open ? 'in' : 'out');
    turnTimer.current = setTimeout(() => {
      setGearTurn(null);
      if (!open) setGearOpen(false);
    }, GEAR_TURN_MS);
  };
  const gear = useGearPages({
    view: props.gear ?? NO_GEAR,
    onEquip: props.onEquip ?? nothing,
    onUnequip: props.onUnequip ?? nothing,
    onUse: props.onUseItem ?? nothing,
    onClose: () => turnGear(false),
    issue: props.issue,
    turning: gearTurn,
  });
  const root = useRef<HTMLDivElement>(null);
  const inspectTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (inspect) root.current?.querySelector<HTMLButtonElement>('.card-lightbox button')?.focus();
    else inspectTrigger.current?.focus();
  }, [inspect]);
  const chosen = view.loadout.some(c => c.id === out) ? out : null;
  const domains = [...new Set([...view.loadout, ...view.vault].map(c => c.domain))].sort();
  // The slots the hand is not using, drawn as the empty pockets they are. Only while nothing is
  // filtered: a search that hides cards must not put empty sleeves where they were standing.
  const empties = query === '' && domain === 'all' ? Math.max(0, view.limit - view.loadout.length) : 0;
  // One measurement for all three grids: they are the same grid in the same column of the page, so
  // they always break into the same number of columns.
  const handGrid = useRef<HTMLDivElement>(null);
  const scrollBox = useRef<HTMLDivElement>(null);
  const spreadBox = useRef<HTMLDivElement>(null);
  const ringAt = useRingHoles(spreadBox);
  const { columns, width } = useColumns(handGrid);
  // 12, because that is what `.deck-grid` actually sets. This said 18 while the stylesheet said 16:
  // the row count was being worked out against a gap that was not on the page, which is the sort of
  // quiet disagreement that costs a whole row and looks like a mystery.
  const rows = useRows(scrollBox, width, 12);
  /** A leaf of the binder: as many sleeves as fit, every one of them filled or empty. */
  const perPage = Math.max(1, columns * rows);
  const [page, setPage] = useState(0);
  const fillers = (count: number, from: number): preact.JSX.Element[] =>
    Array.from({ length: Math.max(0, count) }, (_, i) => <div key={`pocket-${from + i}`} className="deck-pocket" data-testid="empty-pocket" aria-hidden="true"><span /></div>);
  const matches = (c: LoadoutCard) => (domain === 'all' || c.domain === domain)
    && `${c.name} ${c.text} ${c.type}`.toLowerCase().includes(query.toLowerCase());
  const renderCard = (card: LoadoutCard, active: boolean) => (
    <article key={card.id} className={`deck-slot ${chosen === card.id ? 'is-selected' : ''}`} data-card={card.id}>
      <button className="card-inspect" aria-label={`Inspect ${card.name}`} onClick={e => { inspectTrigger.current = e.currentTarget; setInspect(card); }}><CardFace card={card} /></button>
      {active ? (full ? <label className="deck-select">
        <input type="radio" name="vault-out" checked={chosen === card.id} onChange={() => setOut(card.id)} data-testid="pick-out" />
        {chosen === card.id ? 'Selected to vault' : 'Make room'}
      </label> : <span className="deck-ready">In your hand</span>) : (
        <button className="deck-recall" data-testid="recall" disabled={full && chosen === null}
          title={full && chosen === null ? 'Choose an active card to make room' : 'Bring this card into your active loadout'}
          onClick={() => { props.onSwap(card.id, full ? chosen ?? undefined : undefined); setOut(null); }}>
          Recall{!props.resting && card.recallCost > 0 ? ` (${card.recallCost} Stress)` : ' · Free'}
        </button>
      )}
    </article>
  );
  // What they have without choosing it has no domain, so a domain filter hides it; a search reaches it.
  const matchesGranted = (c: GrantedCard) => domain === 'all'
    && `${c.name} ${c.text} ${c.from}`.toLowerCase().includes(query.toLowerCase());
  const renderGranted = (card: GrantedCard) => (
    <article key={card.id} className="granted-slot" data-card={card.id}>
      <button className="card-inspect" aria-label={`Inspect ${card.name}`} onClick={e => { inspectTrigger.current = e.currentTarget; setInspect(card); }}><GrantedFace card={card} /></button>
      <span className="deck-ready">{card.from}</span>
    </article>
  );
  // Each section fills as many leaves as it needs, and a section always gets at least one -- an
  // empty vault is a blank page in the binder, not a page that is missing.
  const handCards = view.loadout.filter(matches);
  const grantedCards = view.granted.filter(matchesGranted);
  const vaultCards = view.vault.filter(matches);
  const leaf = (key: string, heading: string, count: string, note: string, cards: preact.JSX.Element[], owed: number, empty: preact.JSX.Element | null, testId?: string) => {
    const slots = Math.max(cards.length + owed, 1);
    return Array.from({ length: Math.ceil(slots / perPage) }, (_, i) => ({
      key: `${key}-${i}`, heading, note, testId, from: i * perPage,
      count: `${count}${Math.ceil(slots / perPage) > 1 ? ` · ${i + 1}/${Math.ceil(slots / perPage)}` : ''}`,
      cards: cards.slice(i * perPage, (i + 1) * perPage),
      empty: i === 0 ? empty : null,
    }));
  };
  const leaves = [
    ...leaf('hand', 'Active hand', `${view.loadout.length} / ${view.limit}`,
      full ? 'Choose a card to make room for a recall.' : 'These cards are ready for your adventure.',
      handCards.map(c => renderCard(c, true)), empties,
      handCards.length === 0 ? <p className="deck-empty">{view.loadout.length ? 'No active cards match your filters.' : 'Nothing active.'}</p> : null),
    ...(view.granted.length > 0 && domain === 'all'
      ? leaf('granted', 'Always in play', `${view.granted.length} ${view.granted.length === 1 ? 'card' : 'cards'}`,
        `Granted by what ${props.name} is, or lent by what is on them: no limit, and never vaulted.`,
        grantedCards.map(renderGranted), 0,
        grantedCards.length === 0 ? <p className="deck-empty">Nothing always in play matches your search.</p> : null, 'granted-zone')
      : []),
    ...leaf('vault', 'The vault', `${view.vault.length} ${view.vault.length === 1 ? 'card' : 'cards'}`,
      'Your reserve. Recall a card to change your hand.',
      vaultCards.map(c => renderCard(c, false)), 0,
      vaultCards.length === 0 ? <p className="deck-empty">{view.vault.length ? 'No vaulted cards match your filters.' : 'The vault is empty. New cards beyond your active hand wait here.'}</p> : null),
  ];
  // Filtering rebuilds the binder, so go back to its first page rather than to wherever the old
  // page happened to be; and never hold a page that the new set no longer has.
  const shown = Math.min(page, leaves.length - 1);
  useEffect(() => setPage(0), [query, domain]);
  /**
   * The turn itself: the leaf coming into view swings about the rings down its left edge.
   *
   * Only the arriving leaf moves. The one being left is `display: none` the moment the page
   * changes, and nothing can be animated out of that -- showing both would mean holding two leaves
   * open at once, which is how the page size came to be measured off the wrong one twice already.
   *
   * Driven from here rather than by a class, because a CSS animation will not play again when the
   * same element turns a second time unless it is remounted, and remounting a leaf rebuilds every
   * card on it and drops whatever had focus.
   */
  const leafRef = useRef<HTMLElement | null>(null);
  const cameFrom = useRef(shown);
  useEffect(() => {
    const leaf = leafRef.current;
    const from = cameFrom.current;
    cameFrom.current = shown;
    // Opening the binder is not a turn, and neither matchMedia nor animate exists under jsdom.
    if (leaf === null || from === shown) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof leaf.animate !== 'function') return;
    const back = shown < from;
    leaf.animate(
      [
        { transform: `perspective(1500px) rotateY(${back ? -32 : 32}deg) translateX(${back ? -12 : 16}px)`, opacity: 0, offset: 0 },
        { transform: `perspective(1500px) rotateY(${back ? -6 : 6}deg) translateX(0)`, opacity: 1, offset: 0.7 },
        { transform: 'perspective(1500px) rotateY(0deg) translateX(0)', opacity: 1, offset: 1 },
      ],
      { duration: 300, easing: 'cubic-bezier(.22,.72,.28,1)' },
    );
  }, [shown]);
  /**
   * Closing takes as long as the cover takes to swing shut.
   *
   * The owner unmounts this the moment `onClose` is called, and nothing can be animated out of a
   * panel that is no longer there -- so the panel closes itself first and tells its owner after.
   * With motion reduced there is no swing to wait for and it goes at once. `CLOSE_MS` is the
   * length of `binder-open` in `cards.css`; the two have to agree.
   */
  const [closing, setClosing] = useState(false);
  const shut = (): void => {
    if (closing) return;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { props.onClose(); return; }
    setClosing(true);
    setTimeout(props.onClose, CLOSE_MS);
  };
  // A click on the table round the binder shuts it. The press has to begin out there too: a drag
  // that starts in the search box and lets go outside is a text selection, and its click lands on
  // the backdrop as the nearest thing both ends share.
  const pressedOutside = useRef(false);
  return <div className={`deck-backdrop${closing ? ' is-closing' : ''}`} data-testid="loadout-backdrop"
    onPointerDown={e => { e.stopPropagation(); pressedOutside.current = e.target === e.currentTarget; }}
    onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget && pressedOutside.current) shut(); }}>
    <div ref={root} tabIndex={-1} className="deck-browser" role="dialog" aria-modal="true" aria-label={`${props.name} loadout`} data-testid="loadout"
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); if (inspect) setInspect(null); else shut(); }
        // Turn the page with the arrows -- but not while reading a card, and not while the caret is
        // in the search box, where the arrows belong to the text.
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inspect && !gearOpen && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
          e.preventDefault();
          setPage(e.key === 'ArrowLeft' ? Math.max(0, shown - 1) : Math.min(leaves.length - 1, shown + 1));
        }
        if (e.key === 'Tab') {
          const nodes = [...(root.current?.querySelectorAll<HTMLElement>(inspect ? '.card-lightbox button' : 'button:not(:disabled), input, select') ?? [])].filter(n => n.offsetParent !== null);
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { e.preventDefault(); first?.focus(); }
        }
      }}>
      {/* No header band. The binder is the two leaves and the rings between them, so the only
          chrome left is the way out, floated on the board itself. Whose loadout it is is written
          at the head of the sheet, where a binder would have it. */}
      {/* Not while a card is held up to read. Esc there puts the card down, not the binder away, so
          a button saying "Close Esc" beside it promised something the key would not do -- and
          "Back to collection" is already the way out of the reader. */}
      {/* No Close button: a click on the table round the binder shuts it, as Esc does. */}
      {/* The binder lies open: the character on the left leaf, the pockets on the right, rings down
          the middle. Only the right leaf turns -- who you are does not change page. */}
      <div className="deck-spread" ref={spreadBox}>
        <aside className="deck-sheet" data-testid="loadout-sheet">
          {/* The leaf is the binder's board; the paper is a sheet lying on it, with board showing
              round three sides of it. */}
          <div className="sheet-paper">
          {/* The head of the sheet: who they are and how they are holding up on the left, their
              photograph on the right. A row of its own, because a float does nothing inside a
              flex column -- which is how the photo first ended up stranded above the name. */}
          <div className="sheet-top">
            <div className="sheet-id">
              <div className="deck-eyebrow">{props.sheet?.role ?? 'Character'}{view.stats === undefined ? '' : ` · Level ${view.stats.level}`}</div>
              <h2 className="sheet-name">{props.name}</h2>
              {props.sheet === undefined ? null : <>
                <Pips label="HP" marked={props.sheet.hitPoints.marked} max={props.sheet.hitPoints.max} colour="var(--play-hp)" icon="heart" left testId="sheet-hp" />
                <Pips label="Stress" marked={props.sheet.stress.marked} max={props.sheet.stress.max} colour="var(--play-stress)" icon="bolt" left testId="sheet-stress" />
                <Pips label="Armor" marked={props.sheet.armorSlots.marked} max={props.sheet.armorSlots.max} colour="var(--play-armor)" icon="shield" left testId="sheet-armor" />
                {props.sheet.good === undefined ? null
                  : <Pips label="Light" marked={props.sheet.good.value} max={props.sheet.good.max} colour="var(--play-light)" icon="star" testId="sheet-light" />}
              </>}
            </div>
            {props.portrait === null || props.portrait === undefined ? null : (
              <span className="hud-shot sheet-shot" data-testid="sheet-portrait">
                <img src={props.portrait} alt="" aria-hidden="true" />
              </span>
            )}
          </div>
          {view.stats === undefined ? null : <SheetNumbers stats={view.stats} />}
          {props.sheet === undefined ? null : <>
            <p className="sheet-line"><span>Gear</span><b>{props.sheet.gear}</b></p>
            {props.sheet.conditions.length > 0 ? <p className="sheet-line"><span>Conditions</span><b>{props.sheet.conditions.join(' · ')}</b></p> : null}
          </>}
          {/* One line for the three counts: the pocket page opposite already says each of them over
              its own section, and the paper has better things to spend three rows on. */}
          <p className="sheet-line" data-testid="sheet-counts"><span>Cards</span><b>{view.loadout.length} / {view.limit} in hand · {view.granted.length} always · {view.vault.length} in the vault</b></p>
          {/* A refused recall says so here now that there is no footer band to say it in. It is
              the only word a player gets about why a swap did not happen, so it keeps its name. */}
          {props.issue === null ? null : <p className="sheet-issue" role="alert" data-testid="loadout-issue">{props.issue}</p>}
          </div>
          {/* The divider's back, turned over onto the sheet with the card pages: black card, its tab out
              of the left edge reading Back, the equipment sheet lying on it. */}
          {gearOpen ? (
            <div className="gear-divider" data-turning={gearTurn ?? undefined}>
              <button type="button" className="gear-tab is-back" data-testid="close-gear" onClick={() => turnGear(false)}>Back</button>
              {gear.left}
            </div>
          ) : null}
        </aside>
        {/* Two rings, through the centre pairs of holes -- the leaves are punched all the way down,
            as binder paper is, but a binder only has the two rings. */}
        <div className="deck-rings" aria-hidden="true" style={{ '--ring-a': `${ringAt.a}px`, '--ring-b': `${ringAt.b}px` }}><b /><i /><i /></div>
        <div className="deck-pocketpage">
      {/* The card pages, all of them, as one stack that turns: over the rings to the divider under
          them, and back. Put out of sight - not away - while the divider is open, so every page keeps
          its measured size. The divider's tab sticks out past the stack's edge, and turns with it. */}
      <div className="deck-leafstack" data-turning={gearTurn ?? undefined} data-turned={gearOpen && gearTurn === null ? '' : undefined}>
      {props.gear === undefined ? null : <button type="button" className="gear-tab" data-testid="open-gear" onClick={() => turnGear(true)}>Equipment</button>}
      <div className="deck-toolbar"><label className="deck-search">Search cards<input aria-label="Search cards" placeholder="Name, effect, or card type…" value={query} onInput={e => setQuery(e.currentTarget.value)} /></label>
        <label>Domain<select aria-label="Domain" value={domain} onChange={e => setDomain(e.currentTarget.value)}><option value="all">All domains</option>{domains.map(d => <option key={d} value={d}>{d}</option>)}</select></label>
        <p>Inspect a card to read it.<br />{props.resting ? 'Resting · recall is free.' : 'Recall costs the card’s Recall Cost in Stress.'}</p></div>
      <div className="deck-scroll" ref={scrollBox}>
        {/* Every leaf is rendered and all but one is put away, rather than the others being thrown
            out: a card off the open page is still in the binder, and anything looking for it --
            a filter's count, a test, a reader -- should still find it there. */}
        {leaves.map((leaf, at) => (
          <section key={leaf.key} className="deck-page" hidden={at !== shown} data-testid={leaf.testId} aria-hidden={at !== shown}
            ref={at === shown ? leafRef : undefined}>
            <div className="deck-section-title"><h2>{leaf.heading}</h2><span>{leaf.count}</span><p>{leaf.note}</p></div>
            <div className="deck-page-body">
              {/* Measured on the leaf that is open, never on one that has been turned away from:
                  a hidden leaf has no layout, and measuring it is what re-chunked the binder. */}
              <div className="deck-grid" ref={at === shown ? handGrid : undefined}>
                {leaf.cards}
                {fillers(perPage - leaf.cards.length, leaf.from)}
              </div>
              {leaf.empty}
            </div>
          </section>
        ))}
        {/* The page turn. A binder has no scrollbar, so this is the only way across it. */}
        <nav className="deck-pager" data-testid="pager">
          <button type="button" className="deck-turn" data-testid="prev-page" aria-label="Previous page"
            disabled={shown === 0} onClick={() => setPage(shown - 1)}>‹</button>
          <span className="deck-leaf">{leaves[shown]?.heading ?? ''} · {shown + 1} of {leaves.length}</span>
          <button type="button" className="deck-turn" data-testid="next-page" aria-label="Next page"
            disabled={shown >= leaves.length - 1} onClick={() => setPage(shown + 1)}>›</button>
        </nav>
      </div>
      </div>
      {/* The pack: the page after the divider, uncovered as the stack turns away. */}
      {gearOpen ? gear.right : null}
      {gearTurn === null ? null : <span data-testid="gear-turning" hidden />}
        </div>
      </div>
      {inspect && <div className="card-lightbox" role="dialog" aria-label={inspect.name} onClick={() => setInspect(null)}>
        <div className="card-detail" onClick={e => e.stopPropagation()}>
          {'recallCost' in inspect
            ? <CardFace key={`${inspect.id}:${artVersion}`} card={inspect} expanded />
            : <GrantedFace key={`${inspect.id}:${artVersion}`} card={inspect} expanded />}
          <button autoFocus className="deck-close" onClick={() => setInspect(null)}>Back to collection</button>
          <CardArtImport cardId={inspect.id} onChanged={() => setArtVersion(v => v + 1)} /></div>
      </div>}
      {gear.reading}
    </div>
    {gear.ghost}
  </div>;
}
