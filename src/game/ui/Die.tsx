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
import { FACES, draw, tumble, type Face } from './d12';
import './hud.css';

/** A die's material: its colour in full light, at a glance, in shadow, and what it glows once landed. */
export interface DieColours {
  lit: string;
  mid: string;
  dark: string;
  glow: string;
}

/** Gold for Light, violet for Shadow: the colours the pips on the sheet wear. */
export const LIGHT_DIE: DieColours = { lit: '#ffe08a', mid: '#edb545', dark: '#a9761f', glow: '#ffdb8a' };
export const SHADOW_DIE: DieColours = { lit: '#cbaef2', mid: '#9a74d0', dark: '#5e4194', glow: '#c9aef0' };

/** A colour part of the way to another, as hex. Both must be `#rrggbb`. */
function mix(from: string, to: string, k: number): string {
  const channel = (at: number): string => {
    const a = parseInt(from.slice(1 + at * 2, 3 + at * 2), 16);
    const b = parseInt(to.slice(1 + at * 2, 3 + at * 2), 16);
    return Math.round(a + (b - a) * Math.max(0, Math.min(1, k))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/**
 * The material at this much light.
 *
 * `d12.ts` measures what each face catches and hands it over as a number; this ramps the die's
 * three colours through it, so twelve pentagons shade into one another instead of snapping between
 * three fills. The floor is what keeps a face turned away from the light a dark version of the
 * die's own colour and not a black one -- unlit is not the same as black, and painting it black is
 * half of what makes a rendering look flat.
 */
function shade(colours: DieColours, light: number): string {
  const level = 0.14 + light * 0.86;
  return level < 0.5 ? mix(colours.dark, colours.mid, level * 2) : mix(colours.mid, colours.lit, (level - 0.5) * 2);
}

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
  /** The solid to turn: the Duality d12 unless a d6 is handed in. */
  faces?: readonly Face[];
  /**
   * What to print on the face at the front, in place of the number the solid carries there.
   *
   * A die that counts a pool rather than a roll has to be able to read nothing: an empty pool is
   * zero, and no die has a zero on it. The die still turns to a real face - it is a real solid -
   * and that face is overprinted with what is being counted.
   */
  label?: string;
}

export function Die(props: DieProps): preact.JSX.Element {
  const { colours, size, t } = props;
  const solid = props.faces ?? FACES;
  const turn = tumble(props.value, props.seed, t, solid);
  const drawn = draw(turn, solid);
  const landed = t >= 1;
  // Three hops, each smaller than the last, and none at all once it is down.
  const hop = landed ? 0 : Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) ** 2;
  // The highlight is a gradient, and a gradient needs an id of its own: two dice share a page.
  const sheen = `die-sheen-${props.seed}-${props.value}`;
  const edge = mix(colours.dark, '#231a12', 0.5);
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
          filter: landed
            ? `drop-shadow(0 1.5px 1.5px #00000073) drop-shadow(0 0 ${Math.round(size * 0.1)}px ${colours.glow}80)`
            : 'drop-shadow(0 4px 4px #00000073)',
        }}
      >
        <defs>
          {/* Off the top left, the way the board is lit, and gone well before the far edge.
              The stops are set through `style`, not as `stopColor`/`stopOpacity` attributes: those
              are React's spelling, Preact passes them through unrecognised, and a stop with no
              colour on it is an opaque black one -- which paints the whole die black. */}
          <radialGradient id={sheen} cx="0.33" cy="0.2" r="0.72">
            <stop offset="0" style={{ stopColor: '#ffffff', stopOpacity: 0.42 }} />
            <stop offset="0.4" style={{ stopColor: '#ffffff', stopOpacity: 0.1 }} />
            <stop offset="1" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        {/* The silhouette, under the faces so no seam shows through, in the die's own dark tone. */}
        <polygon className="die-rim" points={drawn.rim} fill={edge} stroke={edge} />
        {drawn.faces.map((face) => (
          <polygon
            key={face.value}
            className="die-face"
            points={face.points}
            fill={shade(colours, face.light)}
            stroke={mix(shade(colours, face.light), colours.dark, 0.55)}
          />
        ))}
        {/* Over the faces but under the numbers: a highlight that washed the numerals out would be
            a worse lie than a flat die, since the number is the one thing a die has to say. */}
        <polygon className="die-sheen" points={drawn.rim} fill={`url(#${sheen})`} />
        {drawn.faces.map((face) => (
          <g key={face.value} transform={face.label}>
            <text className="die-number" x="0" y="0">
              {face.value === drawn.front && props.label !== undefined ? props.label : face.value}
            </text>
            {/* Six and nine are told apart the way they are on a real die. */}
            {face.value === 6 || face.value === 9 ? <rect className="die-bar" x="-16" y="26" width="32" height="7" rx="3" /> : null}
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
