/**
 * The party, at a glance: who is selected, and how everyone is holding up.
 *
 * Damage is tracked as slots marked, not points lost, so the HUD shows
 * pips — each Hit Point, Stress and Armor Slot as its own small shape, one per
 * slot of the maximum: filled while they still have it, hollow once it is
 * marked off. That is what a player counts when deciding whether to take the
 * hit or spend the armor. The look is a sheet
 * of parchment (`hud.css`): gold for the one selected, Cinzel for names, and a
 * photograph of whoever it is taped to the corner.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import './hud.css';
import { dropTargetAt, type Drop } from '../party-drop';
import { chainSpans, strandedIds } from './party-chain';
import { WOUND_MS, markedNow, woundsSince } from './hud-wounds';
import { PIP_ICONS, type PipIcon } from './pool-icons';

export interface HudMember {
  id: string;
  name: string;
  /** Class name, for the line under the name. */
  role: string;
  selected: boolean;
  alive: boolean;
  hitPoints: { marked: number; max: number };
  stress: { marked: number; max: number };
  armorSlots: { marked: number; max: number };
  good?: { value: number; max: number };
  conditions: readonly string[];
  /** A level-up is waiting for this character. */
  canLevel: boolean;
  /** "Broadsword · Chainmail". */
  gear: string;
  /** Which group of walkers they are in, counted among the groups of more than one; null for somebody who walks alone. */
  group: number | null;
  /** In a conversation set aside while somebody else is selected: held until it is picked up again. */
  talking?: boolean;
}

export interface PartyHudProps {
  members: readonly HudMember[];
  /**
   * A picture of the model a character is drawn with, as a data URL, for the photo on their sheet.
   * A function rather than a field on the member: taking one needs a WebGL context and a built
   * model, so it is asked for while drawing rather than gathered for everybody up front. Null when
   * nothing can be drawn -- no model, or a browser that refused the canvas -- and the sheet simply
   * has no photograph on it.
   */
  portrait?: (id: string) => string | null;
  onSelect: (id: string) => void;
  onLevelUp: (id: string) => void;
  /** A card dragged and let go: to the side, onto another, or between two. */
  onDrop: (id: string, drop: Drop) => void;
}

/** How far a pointer moves with the button down before a press is a drag rather than a click, in pixels. */
const DRAG_START = 6;

/** A card being dragged: which, where it was picked up, how far it has gone, and what it is over. */
interface Dragging {
  id: string;
  fromX: number;
  fromY: number;
  dx: number;
  dy: number;
  target: Drop | null;
  /** Past `DRAG_START`: a card in the hand, and the release is a drop rather than a click. */
  lifted: boolean;
}

/**
 * Bars: `marked` of `max` lit, in the colour the sheet and the dice give that pool.
 *
 * Exported because the loadout binder draws the same pools on its left leaf. Two copies of this
 * would drift the moment one of them was tuned.
 *
 * `left` turns a row round to show what is left rather than what is marked. The rules count a Hit
 * Point, a Stress or an Armor Slot as it is marked off, and `marked` stays that number -- it is what
 * the engine holds and what the tests read from `data-marked`. But a row of hearts is read the way
 * every game has taught it: a full heart is one you still have, a hollow one is gone but part of
 * your maximum. Light already counts what is held, so it never needs turning.
 */
export function Pips(props: { label: string; marked: number; max: number; colour: string; testId: string; icon?: PipIcon; left?: boolean; lost?: { count: number; stamp: number } }) {
  const bars = [];
  const filled = props.left === true ? props.max - props.marked : props.marked;
  for (let i = 0; i < props.max; i++) {
    // The ones just lost are the first hollow ones: they break, red, and fade to the outline they now are.
    // Keyed by the wound, so a second blow on the same heart plays again rather than being the same element.
    const broken = props.lost !== undefined && i >= filled && i < filled + props.lost.count;
    const name = `${i < filled ? 'pip is-marked' : 'pip'}${broken ? ' is-lost' : ''}`;
    const key = broken ? `${i}:${props.lost!.stamp}` : i;
    bars.push(props.icon === undefined
      ? <span key={key} className={name} style={{ '--pip': props.colour }} />
      : <svg key={key} className={`${name} pip-icon`} style={{ '--pip': props.colour }} viewBox="0 0 16 16" aria-hidden="true"><path d={PIP_ICONS[props.icon]} /></svg>);
  }
  return (
    <div className="hud-pips" data-testid={props.testId} data-marked={props.marked} data-max={props.max}>
      <span>{props.label}</span>
      {bars}
    </div>
  );
}

export function PartyHud(props: PartyHudProps): preact.JSX.Element | null {
  // Who has just lost Hit Points, read off the sheets from one drawing to the next: the card
  // shakes and flushes, and the hearts that went break. Each wound has a stamp, so a second
  // blow before the first has faded starts over, and only its own timer takes it down.
  const before = useRef<Map<string, number> | null>(null);
  const stamp = useRef(0);
  const [wounds, setWounds] = useState<ReadonlyMap<string, { count: number; stamp: number }>>(new Map());
  const marks = props.members.map((member) => `${member.id}:${member.hitPoints.marked}`).join('|');
  useEffect(() => {
    const fresh = woundsSince(before.current ?? new Map(), props.members);
    before.current = markedNow(props.members);
    if (fresh.size === 0) return;
    const mine = ++stamp.current;
    const show = (): void => {
      // A roll still being read is over the table: the wound it decided shows once the card is put away.
      if (document.querySelector('.roll-backdrop') !== null) return void setTimeout(show, 120);
      setWounds((shown) => new Map([...shown, ...[...fresh].map(([id, count]) => [id, { count, stamp: mine }] as const)]));
      setTimeout(() => setWounds((shown) => new Map([...shown].filter(([, wound]) => wound.stamp !== mine))), WOUND_MS);
    };
    show();
  }, [marks]);

  // A card picked up follows the pointer, and what it is over is read off the other cards' boxes
  // on every move. The listeners are the window's, so a drag that leaves the column still ends;
  // a release after a lift is a drop, and the click the browser fires after it is not a click.
  const column = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Dragging | null>(null);
  const dragRef = useRef<Dragging | null>(null);
  const dropped = useRef(false);
  const setDragging = (next: Dragging | null): void => {
    dragRef.current = next;
    setDrag(next);
  };
  useEffect(() => {
    const boxes = () => [...(column.current?.querySelectorAll<HTMLElement>('.hud-card[data-member]') ?? [])].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset['member']!, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    const move = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null) return;
      const dx = e.clientX - d.fromX;
      const dy = e.clientY - d.fromY;
      const lifted = d.lifted || Math.hypot(dx, dy) >= DRAG_START;
      setDragging({ ...d, dx, dy, lifted, target: lifted ? dropTargetAt(boxes(), d.id, e.clientX, e.clientY) : null });
    };
    const up = (): void => {
      const d = dragRef.current;
      if (d === null) return;
      setDragging(null);
      if (!d.lifted) return;
      dropped.current = true;
      setTimeout(() => { dropped.current = false; }, 0);
      if (d.target !== null) props.onDrop(d.id, d.target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [props.onDrop]);

  // Where each chain runs, measured off the cards once they are laid out: from the middle of the
  // first card of a group to the middle of its last. Redone whenever the column's shape changes.
  const [chains, setChains] = useState<readonly { group: number; top: number; height: number }[]>([]);
  const shape = props.members.map((member) => `${member.id}:${member.group}`).join('|');
  useLayoutEffect(() => {
    const measure = (): void => {
      const cards = new Map([...(column.current?.querySelectorAll<HTMLElement>('.hud-card[data-member]') ?? [])].map((el) => [el.dataset['member']!, el]));
      const drawn = [];
      for (const span of chainSpans(props.members)) {
        const from = cards.get(span.from);
        const to = cards.get(span.to);
        if (from === undefined || to === undefined) continue;
        const top = from.offsetTop + from.offsetHeight / 2;
        drawn.push({ group: span.group, top, height: Math.max(0, to.offsetTop + to.offsetHeight / 2 - top) });
      }
      setChains(drawn);
    };
    measure();
    // A card grows when a condition lands or a level-up button appears, and everything below it
    // moves: the column's own height changes with any of theirs, so one watch on it is enough.
    const watch = typeof ResizeObserver === 'undefined' || column.current === null ? null : new ResizeObserver(measure);
    watch?.observe(column.current!);
    window.addEventListener('resize', measure);
    return () => {
      watch?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [shape, marks]);

  if (props.members.length === 0) return null;
  // The line a card would go in at: drawn on the card below the gap, or under the last card for the foot of the column.
  // Inside the cards rather than between them, so the column's children stay the keyed cards it is reordered by.
  const slot = (below: string | null): preact.JSX.Element | null =>
    drag?.target?.kind === 'between' && drag.target.below === below ? <div className={`hud-slot${below === null ? ' is-below' : ''}`} data-testid="drop-slot" aria-hidden="true" /> : null;
  const last = props.members[props.members.length - 1]!.id;
  // A card no chain reaches still says which group it is in, with a tab in the group's colour.
  const stranded = new Set(strandedIds(props.members));
  return (
    <div className={`play hud${drag?.lifted ? ' is-dragging' : ''}`} data-testid="hud" ref={column} data-drop={drag?.target?.kind}>
      {/* Behind the cards, and put away while one is in the hand: it is drawn to where the cards lie. */}
      {drag?.lifted === true ? null : chains.map((chain) => (
        <div key={`${chain.group}:${chain.top}`} className="hud-chain" data-testid="chain" data-group={chain.group} style={{ top: `${chain.top}px`, height: `${chain.height}px` }} />
      ))}
      {props.members.map((member) => {
        const shot = props.portrait?.(member.id) ?? null;
        const wound = wounds.get(member.id);
        const held = drag?.lifted === true && drag.id === member.id;
        const aside = held && drag!.target?.kind === 'aside';
        const under = drag?.lifted === true && drag.target?.kind === 'onto' && drag.target.id === member.id;
        return (
        <div
          key={member.id}
          className={`play-box hud-card${member.selected ? ' is-selected' : ''}${member.alive ? '' : ' is-down'}${wound === undefined ? '' : ' is-hurt'}${held ? ' is-held' : ''}${aside ? ' is-aside' : ''}${under ? ' is-under' : ''}`}
          style={{ '--group': member.group ?? 0, ...(held ? { transform: `translate(${drag!.dx}px, ${drag!.dy}px)${aside ? ' rotate(-4deg)' : ''}` } : {}) }}
          data-member={member.id}
          data-hurt={wound?.count}
          data-selected={member.selected}
          data-group={member.group ?? undefined}
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('button') !== null) return;
            setDragging({ id: member.id, fromX: e.clientX, fromY: e.clientY, dx: 0, dy: 0, target: null, lifted: false });
          }}
          onClick={() => {
            if (!dropped.current) props.onSelect(member.id);
          }}
        >
          {shot === null ? null : (
            <span className="hud-shot" data-testid="portrait">
              {/* Not the browser's own image drag: a press on the photo picks the card up, like a press anywhere else on it. */}
              <img src={shot} alt="" aria-hidden="true" draggable={false} />
            </span>
          )}
          <div className="hud-head">
            <span className="play-name">{member.name}</span>
            <span className="play-eyebrow">{member.role}</span>
          </div>
          {member.canLevel ? (
            <button
              className="play-btn is-primary hud-level"
              data-testid="level-up-button"
              onClick={(e) => {
                e.stopPropagation();
                props.onLevelUp(member.id);
              }}
            >
              Level up
            </button>
          ) : null}
          {wound === undefined ? null : (
            <span key={wound.stamp} className="hud-wound" data-testid="wound" aria-hidden="true">
              <b>-{wound.count}</b>
            </span>
          )}
          <Pips label="HP" marked={member.hitPoints.marked} max={member.hitPoints.max} colour="var(--play-hp)" icon="heart" left testId="hp" {...(wound === undefined ? {} : { lost: wound })} />
          <Pips label="Stress" marked={member.stress.marked} max={member.stress.max} colour="var(--play-stress)" icon="bolt" left testId="stress" />
          <Pips label="Armor" marked={member.armorSlots.marked} max={member.armorSlots.max} colour="var(--play-armor)" icon="shield" left testId="armor" />
          {member.good !== undefined ? (
            <Pips label="Light" marked={member.good.value} max={member.good.max} colour="var(--play-light)" icon="star" testId="good" />
          ) : null}
          <div className="hud-gear" data-testid="gear">
            {member.gear}
          </div>
          {stranded.has(member.id) ? <span className="hud-band" data-testid="group-tab" aria-hidden="true" /> : null}
          {member.conditions.length > 0 ? <div className="hud-conditions">{member.conditions.join(' · ')}</div> : null}
          {member.talking === true ? <div className="hud-talking" data-testid="hud-talking">In conversation</div> : null}
          {slot(member.id)}
          {member.id === last ? slot(null) : null}
        </div>
        );
      })}
    </div>
  );
}
