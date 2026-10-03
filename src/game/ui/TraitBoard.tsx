/**
 * New Game's Traits step: the Traits card itself, laid on the table big enough to work on, and the
 * starting spread - +2 +1 +1 +0 +0 −1 - as six stickers on it, one on each trait, where the class leans
 * (`suggestedTraits`). The card is the one the row keeps afterwards (`TraitsFace`), stickers and all.
 *
 * A sticker dragged onto another trait trades places with the one there, and so does a sticker clicked
 * and then another: the spread is always the spread, however they move (`swapTraits`). The trait that
 * matters most - the one spells are cast with, or where the class leans (`keyTrait`) - is underlined.
 * Suggested puts them back as the class would have them; Choose sleeves the card and sets it in the row.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Traits } from '../../engine/character/sheet';
import type { Trait } from '../../engine/scene/schema';
import { TRAIT_ORDER, TRAIT_VERBS, swapTraits } from '../new-character';

/** How far a press travels before it is a drag and not a click, in pixels. */
const DRAG_START = 5;
/** How much of the table the card fills while it is being worked on: of its height, and of its width. */
const FILL = { down: 0.6, across: 0.55 };
/** Each trait's sticker is put on a little crooked, each its own way. */
const TILT: Readonly<Record<Trait, number>> = { agility: -7, strength: 5, finesse: -3, instinct: 8, presence: -5, knowledge: 3 };

const named = (trait: Trait): string => trait.charAt(0).toUpperCase() + trait.slice(1);

/** A modifier as the sheet prints it: +2, +0, −1. */
export const signed = (value: number): string => (value < 0 ? `−${-value}` : `+${value}`);

/** A sticker's colour, by what is printed on it. */
const tone = (value: number): string => (value >= 2 ? 'is-gold' : value === 1 ? 'is-green' : value < 0 ? 'is-red' : 'is-stone');

/** A sticker with a modifier on it. */
function Sticker(props: { trait: Trait; value: number; className?: string; pressable?: { busy: boolean; onPress: (e: PointerEvent) => void } }): preact.JSX.Element {
  const className = `trait-sticker ${tone(props.value)}${props.className ?? ''}`;
  const style = { '--tilt': `${TILT[props.trait]}deg` };
  return props.pressable === undefined ? (
    <span className={className} style={style} data-value={props.value}>
      {signed(props.value)}
    </span>
  ) : (
    <button type="button" className={className} style={style} data-testid="trait-token" data-trait={props.trait} data-value={props.value}
      disabled={props.pressable.busy} onPointerDown={props.pressable.onPress}>
      {signed(props.value)}
    </button>
  );
}

/**
 * The Traits card: each trait, what it is rolled for, and its sticker; the one that matters most
 * underlined. On the table the stickers can be pressed (`press`); in the row they are only stuck on.
 */
export function TraitsFace(props: {
  traits: Traits;
  keyTrait: Trait;
  press?: { held: Trait | null; dragged: Trait | null; busy: boolean; onPress: (trait: Trait, e: PointerEvent) => void };
}): preact.JSX.Element {
  const { press } = props;
  return (
    <div className="deal-face is-traits">
      <span className="deal-kind">Traits</span>
      <div className="traits-list">
        {TRAIT_ORDER.map((trait) => (
          <div key={trait} className={`traits-row${press?.held === trait ? ' is-held' : ''}`} data-trait-slot={trait}>
            <span className="traits-words">
              <b className={`trait-name${trait === props.keyTrait ? ' is-key' : ''}`} title={trait === props.keyTrait ? 'The trait that matters most to this character' : undefined}>
                {named(trait)}
              </b>
              <small>{TRAIT_VERBS[trait].join(' · ')}</small>
            </span>
            <Sticker trait={trait} value={props.traits[trait]} className={press?.dragged === trait ? ' is-dragged' : ''}
              {...(press === undefined ? {} : { pressable: { busy: press.busy, onPress: (e: PointerEvent) => press.onPress(trait, e) } })} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TraitBoard(props: {
  traits: Traits;
  suggested: Traits;
  keyTrait: Trait;
  className: string;
  sleeving: boolean;
  busy: boolean;
  onChange: (traits: Traits) => void;
  onChoose: () => void;
}): preact.JSX.Element {
  const [held, setHeld] = useState<Trait | null>(null);
  const [drag, setDrag] = useState<{ trait: Trait; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(2);
  const press = useRef<{ trait: Trait; x: number; y: number; moved: boolean } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  // The card at the size a card is on the table, zoomed to fill as much of it as it should.
  useLayoutEffect(() => {
    const fit = (): void => {
      const box = board.current;
      const face = card.current;
      if (box === null || face === null || face.offsetHeight === 0) return;
      setZoom(Math.min((box.clientHeight * FILL.down) / face.offsetHeight, (box.clientWidth * FILL.across) / face.offsetWidth));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const at = press.current;
      if (at === null) return;
      if (!at.moved && Math.hypot(e.clientX - at.x, e.clientY - at.y) < DRAG_START) return;
      at.moved = true;
      setDrag({ trait: at.trait, x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent): void => {
      const at = press.current;
      press.current = null;
      setDrag(null);
      if (at === null) return;
      if (at.moved) {
        // Dropped on another trait: the two stickers trade places.
        const onto = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-trait-slot]')?.dataset.traitSlot as Trait | undefined;
        if (onto !== undefined && onto !== at.trait) latest.current.onChange(swapTraits(latest.current.traits, at.trait, onto));
        setHeld(null);
        return;
      }
      // Clicked: lifted, and the next one clicked trades places with it.
      setHeld((was) => {
        if (was === null) return at.trait;
        if (was !== at.trait) latest.current.onChange(swapTraits(latest.current.traits, was, at.trait));
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const asSuggested = TRAIT_ORDER.every((trait) => props.traits[trait] === props.suggested[trait]);
  return (
    <div className={`trait-board${props.sleeving ? ' is-sleeving' : ''}`} data-testid="trait-board" ref={board} style={{ '--zoom': zoom }}>
      <div className="trait-holder">
        <div className="deal-card trait-card" ref={card}>
          <TraitsFace traits={props.traits} keyTrait={props.keyTrait}
            press={{
              held,
              dragged: drag?.trait ?? null,
              busy: props.busy,
              onPress: (trait, e) => {
                if (e.button !== 0 || props.busy) return;
                e.preventDefault();
                press.current = { trait, x: e.clientX, y: e.clientY, moved: false };
              },
            }} />
          <span className="deal-sleeve" />
        </div>
      </div>
      <div className="trait-actions">
        <button type="button" className="deal-button" data-testid="suggested-traits" disabled={props.busy || asSuggested} onClick={() => props.onChange({ ...props.suggested })}>
          Suggested for {props.className}
        </button>
        <button type="button" className="deal-button" data-testid="choose-traits" disabled={props.busy} onClick={props.onChoose}>
          Choose
        </button>
      </div>
      {drag === null ? null : (
        <span className="trait-flying" style={{ left: `${drag.x}px`, top: `${drag.y}px` }}>
          <Sticker trait={drag.trait} value={props.traits[drag.trait]} />
        </span>
      )}
    </div>
  );
}
