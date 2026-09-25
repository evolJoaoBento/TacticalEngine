/**
 * The binder's gear pages: what a character carries, as cards in clear plastic sleeves.
 *
 * Opened by the Equipment divider's tab, the card pages turn over and the divider's black back lies
 * on the left leaf, with a sheet of plastic on it holding a labelled sleeve for each place gear goes
 * (primary weapon, secondary weapon, armour); the right leaf is the party's pack, every card in a
 * sleeve of its own. A card is put on by dragging it from the pack onto its sleeve, and taken off by
 * dragging it back; the Equip and Take off buttons do the same for a keyboard, and for tests that
 * would rather click. Each sheet is a real sheet protector: clear, with a white strip down its
 * binding edge punched where the rings go through. The one on the left lies on the back of the
 * binder's Equipment divider, whose Back tab (`LoadoutPanel.tsx`) turns back to the cards.
 *
 * The drag is pointer events, as the party cards' is (`PartyHud.tsx`): nothing here uses the HTML
 * drag-and-drop API, whose ghost image and drop rules a sleeve full of pictures would fight.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { CarriedCard, GearCard, GearView } from '../gear';
import type { GearSlot } from '../equip';
import { equipmentArt } from './equipment-art';
import './gear.css';

/** How far a press travels before it is a drag and not a click. */
const DRAG_START = 6;

const GLYPH: Record<string, string> = {
  weapon: 'M5 19l3-3M7 14l3 3M9.5 14.5L19 5V3h-2L7.5 12.5',
  armor: 'M7 4h10l3 3-2 3v10H6V10L4 7zM9 4c0 2 1.3 3 3 3s3-1 3-3',
  consumable: 'M10 3h4M10.5 3v5L6 16a3 3 0 002.7 5h6.6a3 3 0 002.7-5l-4.5-8V3',
  key: 'M8 14a4 4 0 110-8 4 4 0 010 8zM11 10h9M17 10v3M20 10v2',
  trinket: 'M6 8h12l-1 12H7zM9 8V6a3 3 0 016 0v2',
};

/**
 * A card as it is printed: its picture when the catalogue has one and it has been fetched, and
 * otherwise drawn from what it says - a glyph for what it is, the banner, the name, the numbers along
 * the middle, the feature or text beneath.
 */
export function GearFace({ card, className }: { card: GearCard; className?: string }): preact.JSX.Element {
  const src = equipmentArt(card.card);
  const [failed, setFailed] = useState(false);
  if (src !== null && !failed) {
    return <img className={`gear-face gear-picture ${className ?? ''}`} src={src} alt={card.name} draggable={false} onError={() => setFailed(true)} />;
  }
  return (
    <div className={`gear-face gear-drawn is-${card.kind} ${className ?? ''}`} aria-label={card.name}>
      <div className="gear-art">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={GLYPH[card.kind] ?? GLYPH.trinket} /></svg>
      </div>
      <div className="gear-banner">{card.banner}</div>
      <h3 className="gear-name">{card.name}</h3>
      {card.stats.length === 0 ? null : (
        <div className="gear-stats">
          {card.stats.map((stat, i) => (
            <span key={i} className="gear-stat"><b>{stat.text}</b>{stat.caption === undefined ? null : <small>{stat.caption}</small>}</span>
          ))}
        </div>
      )}
      <p className="gear-text">
        {card.feature === null ? card.text : <><b>{card.feature.name}:</b> {card.feature.text}</>}
      </p>
    </div>
  );
}

/** A card being carried across the binder: which one, from where, and where the pointer is. */
interface Held {
  card: GearCard;
  from: 'pack' | GearSlot;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moving: boolean;
}

export interface GearPagesProps {
  view: GearView;
  onEquip: (itemId: string) => void;
  onUnequip: (slot: GearSlot) => void;
  onUse: (itemId: string) => void;
  onClose: () => void;
  /** Why the last put-on or take-off did not happen, said on the plastic over the sheet. */
  issue?: string | null;
  /** The pages turning to these, or back to the cards: each film arrives or leaves with them. */
  turning?: 'in' | 'out' | null;
}

/** Which sleeve, or the pack, lies under a point on the screen. */
function dropAt(x: number, y: number): 'pack' | GearSlot | null {
  const under = typeof document === 'undefined' ? null : document.elementFromPoint(x, y);
  const sleeve = under?.closest<HTMLElement>('[data-slot]');
  if (sleeve !== null && sleeve !== undefined) return sleeve.dataset.slot as GearSlot;
  return under?.closest('[data-testid="pack"]') ? 'pack' : null;
}

/**
 * Both gear pages at once, since a drag crosses from one to the other: `left` is the plastic over
 * the sheet, `right` the pack. The binder places each on its own leaf.
 */
export function useGearPages(props: GearPagesProps): { left: preact.JSX.Element; right: preact.JSX.Element; ghost: preact.JSX.Element | null; reading: preact.JSX.Element | null } {
  const [held, setHeld] = useState<Held | null>(null);
  const [over, setOver] = useState<'pack' | GearSlot | null>(null);
  const [reading, setReading] = useState<GearCard | null>(null);
  const heldRef = useRef<Held | null>(null);
  heldRef.current = held;
  const actions = useRef(props);
  actions.current = props;

  useEffect(() => {
    if (held === null) return;
    const move = (e: PointerEvent): void => {
      const now = heldRef.current;
      if (now === null) return;
      const moving = now.moving || Math.hypot(e.clientX - now.startX, e.clientY - now.startY) > DRAG_START;
      setHeld({ ...now, x: e.clientX, y: e.clientY, moving });
      setOver(moving ? dropAt(e.clientX, e.clientY) : null);
    };
    const up = (e: PointerEvent): void => {
      const now = heldRef.current;
      setHeld(null);
      setOver(null);
      if (now === null) return;
      // A press that never went anywhere is a click: hold the card up to read.
      if (!now.moving) { setReading(now.card); return; }
      const target = dropAt(e.clientX, e.clientY);
      if (now.from === 'pack' && target !== null && target !== 'pack' && target === now.card.fits) actions.current.onEquip(now.card.id);
      else if (now.from !== 'pack' && target === 'pack') actions.current.onUnequip(now.from);
    };
    const cancel = (): void => { setHeld(null); setOver(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [held !== null]);

  const press = (card: GearCard, from: 'pack' | GearSlot) => (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    setHeld({ card, from, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moving: false });
  };
  const dragging = held !== null && held.moving ? held : null;

  const left = (
    <div className="gear-film gear-sheet" data-testid="gear-slots" data-turning={props.turning ?? undefined}>
      <div className="gear-film-head">
        <span>Equipment</span>
      </div>
      <div className="gear-slots">
        {props.view.slots.map(({ slot, label, card }) => {
          const wanted = dragging !== null && dragging.from === 'pack' && dragging.card.fits === slot;
          return (
            <div key={slot} className={`gear-sleeve gear-slot${wanted ? ' is-wanted' : ''}${wanted && over === slot ? ' is-over' : ''}`} data-slot={slot} data-testid={`slot-${slot}`}>
              <span className="gear-label">{label}</span>
              {card === null ? <span className="gear-empty">Empty</span> : (
                <>
                  <div className={`gear-hold${dragging?.from === slot ? ' is-lifted' : ''}`} data-item={card.id} onPointerDown={press(card, slot)}>
                    <GearFace card={card} />
                  </div>
                  <button type="button" className="gear-act" data-testid="unequip" onClick={() => props.onUnequip(slot)}>Take off</button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {props.issue === null || props.issue === undefined ? null : <p className="gear-issue" role="alert" data-testid="gear-issue">{props.issue}</p>}
    </div>
  );

  const right = (
    <div className={`gear-film gear-pack${dragging !== null && dragging.from !== 'pack' ? ' is-wanted' : ''}${over === 'pack' ? ' is-over' : ''}`} data-testid="pack" data-turning={props.turning ?? undefined}>
      <div className="gear-film-head">
        <span>The party's pack</span>
        <small>{props.view.carried.length === 0 ? 'Nothing carried.' : 'Drag a card onto its sleeve to put it on.'}</small>
      </div>
      <div className="gear-grid">
        {props.view.carried.map((card: CarriedCard) => (
          <div key={card.id} className="gear-sleeve gear-carried" data-item={card.id}>
            <div className={`gear-hold${dragging?.from === 'pack' && dragging.card.id === card.id ? ' is-lifted' : ''}`} onPointerDown={press(card, 'pack')}>
              <GearFace card={card} />
            </div>
            {card.count > 1 ? <span className="gear-count" data-testid="item-count">×{card.count}</span> : null}
            <div className="gear-under">
              {card.worth === undefined ? null : <span className="gear-worth" data-testid="item-worth">worth {card.worth}</span>}
              {card.fits === null ? null : <button type="button" className="gear-act" data-testid="equip" onClick={() => props.onEquip(card.id)}>Equip</button>}
              {card.usable ? <button type="button" className="gear-act" data-testid="use-item" onClick={() => props.onUse(card.id)}>Use</button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const ghost = dragging === null ? null : (
    <div className="gear-ghost" style={{ left: `${dragging.x}px`, top: `${dragging.y}px` }} aria-hidden="true"><GearFace card={dragging.card} /></div>
  );

  const shown = reading === null ? null : (
    <div className="card-lightbox" role="dialog" aria-label={reading.name} onClick={() => setReading(null)}>
      <div className="card-detail gear-detail" onClick={(e) => e.stopPropagation()}>
        <GearFace card={reading} className="is-large" />
        <button autoFocus className="deck-close" onClick={() => setReading(null)}>Back to the pack</button>
      </div>
    </div>
  );

  return { left, right, ghost, reading: shown };
}
