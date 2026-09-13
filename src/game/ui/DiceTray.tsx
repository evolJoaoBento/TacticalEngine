/**
 * The Duality Dice, landing.
 *
 * The roll is two d12s that mean different things — Light and Shadow —
 * so the pair is worth watching in a way a damage roll is not. This draws them
 * flat and shades them like solids: five facets around a face, a highlight, a
 * shadow beneath. There is no physics and nothing is decided here. The rules
 * rolled first; these dice are told what to land on and land on it.
 *
 * Everything it draws comes off the roll itself, tumble included, so the same
 * seed shows the same dice twice — and a view that hands it `millis: 0` gets
 * the settled result with no animation at all, which is what a test wants.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { RollShow } from '../demo-scene';

export interface DiceTrayProps {
  /** The roll to show, or null when there is nothing to watch. */
  roll: RollShow | null;
  /** How long the tumble lasts. Zero settles at once. */
  millis: number;
  /** Called when the dice have settled and been read. */
  onDone: (id: number) => void;
}

/** Gold for Light, violet for Shadow: the colours the prototype rolled in. */
const GOOD = { face: '#e8bd63', edge: '#a97c22', ink: '#3a2a06', glow: '#ffdb8a' };
const BAD = { face: '#9d80c4', edge: '#5c4185', ink: '#1d1030', glow: '#c9aef0' };

/** How long the settled result stays up before the next roll is shown. */
const HOLD = 700;

/**
 * A die face, drawn as a pentagon ringed by five facets.
 *
 * The facets are the same pentagon scaled out and split, each shaded a little
 * darker going round, which is enough for a flat shape to read as a solid.
 */
function Die(props: { value: number; spin: number; lift: number; colour: typeof GOOD; settled: boolean }): preact.JSX.Element {
  const { colour, spin, lift, settled } = props;
  const points = (radius: number, turn: number): string =>
    Array.from({ length: 5 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 5 + turn - Math.PI / 2;
      return `${(50 + radius * Math.cos(angle)).toFixed(2)},${(50 + radius * Math.sin(angle)).toFixed(2)}`;
    }).join(' ');

  const outer = Array.from({ length: 5 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const b = (Math.PI * 2 * (i + 1)) / 5 - Math.PI / 2;
    const inner = 27;
    const rim = 46;
    return [
      `${(50 + inner * Math.cos(a)).toFixed(2)},${(50 + inner * Math.sin(a)).toFixed(2)}`,
      `${(50 + inner * Math.cos(b)).toFixed(2)},${(50 + inner * Math.sin(b)).toFixed(2)}`,
      `${(50 + rim * Math.cos(b + 0.32)).toFixed(2)},${(50 + rim * Math.sin(b + 0.32)).toFixed(2)}`,
      `${(50 + rim * Math.cos(a - 0.32)).toFixed(2)},${(50 + rim * Math.sin(a - 0.32)).toFixed(2)}`,
    ].join(' ');
  });

  return (
    <svg
      viewBox="0 0 100 100"
      width="86"
      height="86"
      style={{
        display: 'block',
        transform: `translateY(${(-lift * 26).toFixed(2)}px) rotate(${spin.toFixed(1)}deg) scale(${settled ? 1 : 0.94})`,
        transition: settled ? 'transform 160ms cubic-bezier(.2,1.6,.4,1)' : 'none',
        filter: settled ? `drop-shadow(0 0 10px ${colour.glow}88)` : 'drop-shadow(0 6px 8px rgba(0,0,0,.55))',
      }}
    >
      {outer.map((shape, i) => (
        <polygon
          key={i}
          points={shape}
          fill={colour.edge}
          // Each facet a shade further from the light, which is up and left.
          opacity={0.45 + 0.11 * ((i + 3) % 5)}
          stroke={colour.ink}
          stroke-width="0.6"
          stroke-opacity="0.35"
        />
      ))}
      <polygon points={points(27, 0)} fill={colour.face} stroke={colour.edge} stroke-width="1.4" />
      <polygon points={points(27, 0)} fill="url(#dieSheen)" opacity="0.5" />
      <text
        x="50"
        y="50"
        text-anchor="middle"
        dominant-baseline="central"
        font-family="ui-sans-serif, system-ui, sans-serif"
        font-size="26"
        font-weight="700"
        fill={colour.ink}
      >
        {props.value}
      </text>
    </svg>
  );
}

/** A tiny generator so the tumble is the roll's own, not the clock's. */
function faces(seed: number, step: number): number {
  let x = (seed * 1103515245 + step * 12345) >>> 0;
  x ^= x >>> 15;
  return (x % 12) + 1;
}

export function DiceTray(props: DiceTrayProps): preact.JSX.Element | null {
  const { roll, millis } = props;
  const [frame, setFrame] = useState(0);
  const started = useRef<number | null>(null);
  const shown = useRef<number | null>(null);

  useEffect(() => {
    if (roll === null) return;
    // A new roll starts its own tumble; the same roll re-rendered does not.
    if (shown.current !== roll.id) {
      shown.current = roll.id;
      started.current = null;
      setFrame(0);
    }
    if (millis <= 0) {
      const done = setTimeout(() => props.onDone(roll.id), 0);
      return () => clearTimeout(done);
    }
    let raf = 0;
    const tick = (now: number): void => {
      if (started.current === null) started.current = now;
      const elapsed = now - started.current;
      setFrame(elapsed);
      if (elapsed < millis + HOLD) raf = requestAnimationFrame(tick);
      else props.onDone(roll.id);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [roll?.id, millis]);

  if (roll === null) return null;
  const settled = millis <= 0 || frame >= millis;
  // Ease out, so the dice slow into their faces rather than stopping dead.
  const t = millis <= 0 ? 1 : Math.min(1, frame / millis);
  const eased = 1 - (1 - t) * (1 - t) * (1 - t);
  const seed = roll.roll.good * 31 + roll.roll.bad * 17 + roll.id;
  const step = Math.floor(t * 14);
  const spin = (1 - eased) * 540;
  const lift = Math.max(0, Math.sin(t * Math.PI * 2.5) * (1 - eased));

  const line = `Light ${roll.roll.good} + Shadow ${roll.roll.bad}${
    roll.roll.advantageDie === 0 ? '' : roll.roll.advantageDie > 0 ? ` + d6 ${roll.roll.advantageDie}` : ` − d6 ${-roll.roll.advantageDie}`
  }${roll.roll.helpBonus > 0 ? ` + help ${roll.roll.helpBonus}` : ''}${
    roll.roll.modifier === 0 ? '' : roll.roll.modifier > 0 ? ` + ${roll.roll.modifier}` : ` − ${-roll.roll.modifier}`
  } = ${roll.roll.total} vs ${roll.roll.difficulty}`;

  const verdict =
    roll.roll.outcome === 'criticalSuccess'
      ? 'critical success'
      : roll.roll.outcome === 'successWithGood'
        ? 'success with Light'
        : roll.roll.outcome === 'successWithBad'
          ? 'success with Shadow'
          : roll.roll.outcome === 'failureWithGood'
            ? 'failure with Light'
            : 'failure with Shadow';

  return (
    <div
      data-testid="dice-tray"
      data-good={roll.roll.good}
      data-bad={roll.roll.bad}
      data-total={roll.roll.total}
      data-settled={settled ? 'true' : 'false'}
      style={{
        position: 'absolute',
        top: '18%',
        left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        textAlign: 'center',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        color: '#e7edf3',
        textShadow: '0 1px 3px rgba(0,0,0,.9)',
      }}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="dieSheen" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55" />
            <stop offset="60%" stop-color="#ffffff" stop-opacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <div style={{ fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.75, marginBottom: '6px' }}>
        {roll.who} rolls {roll.what}
      </div>
      <div style={{ display: 'flex', gap: '18px', justifyContent: 'center', alignItems: 'flex-end' }}>
        <Die value={settled ? roll.roll.good : faces(seed, step)} spin={spin} lift={lift} colour={GOOD} settled={settled} />
        <Die value={settled ? roll.roll.bad : faces(seed + 7, step + 3)} spin={-spin} lift={lift * 0.8} colour={BAD} settled={settled} />
      </div>
      {/* The result is the settle: nothing to read until the dice stop. */}
      <div style={{ minHeight: '38px', marginTop: '8px', opacity: settled ? 1 : 0, transition: 'opacity 140ms' }}>
        <div style={{ fontSize: '13px' }}>{line}</div>
        <div
          style={{
            fontSize: '15px',
            fontWeight: 700,
            color: roll.roll.outcome.startsWith('success') || roll.roll.outcome === 'criticalSuccess' ? '#9fdca0' : '#e29a9a',
          }}
        >
          {verdict}
        </div>
      </div>
    </div>
  );
}
