/**
 * One die on the table.
 *
 * `d12.ts` turns the solid and flattens it; this puts it on screen and gives it
 * the throw: the die tumbles, hops twice, and lights up on the face it lands on.
 * Nothing is decided here — the value it is handed is the value it lands on, and
 * a view that asks for no time at all gets the landed die and no animation,
 * which is what a test wants.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { draw, tumble } from './d12';
import './hud.css';

/** Three bands of light for a die's faces, and what it glows once it lands. */
export interface DieColours {
  lit: string;
  mid: string;
  dark: string;
  glow: string;
}

/** Gold for Light, violet for Shadow: the colours the pips on the sheet wear. */
export const LIGHT_DIE: DieColours = { lit: '#ffe08a', mid: '#edb545', dark: '#a9761f', glow: '#ffdb8a' };
export const SHADOW_DIE: DieColours = { lit: '#cbaef2', mid: '#9a74d0', dark: '#5e4194', glow: '#c9aef0' };

export interface DieProps {
  /** The face it lands on. */
  value: number;
  /** Which throw this is, so the same roll tumbles the same way twice. */
  seed: number;
  /** How far through the throw, 0 to 1; at 1 the die has landed. */
  t: number;
  colours: DieColours;
  /** How wide it is drawn, in pixels. */
  size: number;
}

export function Die(props: DieProps): preact.JSX.Element {
  const { colours, size, t } = props;
  const turn = tumble(props.value, props.seed, t);
  const drawn = draw(turn);
  const landed = t >= 1;
  // Three hops, each smaller than the last, and none at all once it is down.
  const hop = landed ? 0 : Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) ** 2;
  const bands = [colours.lit, colours.mid, colours.dark];
  return (
    <span className="die" style={{ width: `${size}px`, height: `${size}px` }}>
      <svg
        data-testid="die"
        data-face={drawn.front}
        className={`die-solid${landed ? ' is-landed' : ''}`}
        viewBox="0 0 100 100"
        width={size}
        height={size}
        style={{
          transform: `translateY(${(-hop * size * 0.34).toFixed(2)}px)`,
          filter: landed ? `drop-shadow(0 2px 0 #1a120d) drop-shadow(0 0 ${Math.round(size * 0.12)}px ${colours.glow}aa)` : 'drop-shadow(0 3px 2px #0009)',
        }}
      >
        {/* The silhouette, drawn under the faces in ink: one heavy line round the die, as on the board. */}
        <polygon className="die-rim" points={drawn.rim} />
        {drawn.faces.map((face) => (
          <g key={face.value}>
            <polygon className="die-face" points={face.points} fill={bands[face.band]} />
            <g transform={face.label}>
              <text className="die-number" x="0" y="0">
                {face.value}
              </text>
              {/* Six and nine are told apart the way they are on a real die. */}
              {face.value === 6 || face.value === 9 ? <rect className="die-bar" x="-16" y="26" width="32" height="7" rx="3" /> : null}
            </g>
          </g>
        ))}
      </svg>
      <span className="die-shadow" style={{ opacity: `${(0.5 - hop * 0.36).toFixed(2)}`, transform: `translateX(-50%) scale(${(1 - hop * 0.45).toFixed(2)})` }} />
    </span>
  );
}

/**
 * How far through a throw the clock is, as 0 to 1.
 *
 * Keyed by the throw: a new one starts from nothing, the same one re-rendered
 * keeps its place, and a throw of no length at all is already landed.
 */
export function useTumble(throwId: number | null, millis: number): number {
  const [clock, setClock] = useState<{ id: number | null; at: number }>({ id: null, at: 0 });
  const frame = useRef(0);
  useEffect(() => {
    if (throwId === null) return;
    if (millis <= 0) {
      setClock({ id: throwId, at: 1 });
      return;
    }
    let start: number | null = null;
    const tick = (now: number): void => {
      start ??= now;
      const gone = Math.min(1, (now - start) / millis);
      setClock({ id: throwId, at: gone });
      if (gone < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [throwId, millis]);
  return clock.id === throwId ? clock.at : 0;
}
