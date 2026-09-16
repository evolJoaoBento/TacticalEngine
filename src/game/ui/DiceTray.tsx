/**
 * The Duality Dice, landing.
 *
 * The roll is two d12s that mean different things — Light and Shadow — so the
 * pair is worth watching in a way a damage roll is not. `Die.tsx` draws each one
 * as the solid it is; this sets the pair on the table, says what they came to,
 * and clears them once they have been read. There is no physics and nothing is
 * decided here. The rules rolled first; these dice are told what to land on and
 * land on it.
 *
 * The tumble comes off the roll itself, so the same roll throws the same way
 * twice — and a view that hands it `millis: 0` gets the settled result with no
 * animation at all, which is what a test wants.
 *
 * This is where the game's own rolls are watched: a swing, a reaction, a check
 * a script answered for the room. A check a player is asked for is thrown on a
 * card of its own instead (`RollStage.tsx`), which holds this one back while it
 * is up.
 */
import { useEffect } from 'preact/hooks';
import type { DualityRoll } from '../../engine/rules/duality';
import type { RollShow } from '../log';
import { Die, LIGHT_DIE, SHADOW_DIE, useTumble } from './Die';
import './hud.css';

export interface DiceTrayProps {
  /** The roll to show, or null when there is nothing to watch. */
  roll: RollShow | null;
  /** How long the tumble lasts. Zero settles at once. */
  millis: number;
  /** Called when the dice have settled and been read. */
  onDone: (id: number) => void;
}

/** How long the settled result stays up before the next roll is shown. */
const HOLD = 700;
/** How wide the dice are drawn here. */
const DIE = 92;

/** What the dice came to, in the order it was added up. */
export function readout(roll: DualityRoll): string {
  return `Light ${roll.good} + Shadow ${roll.bad}${
    roll.advantageDie === 0 ? '' : roll.advantageDie > 0 ? ` + d6 ${roll.advantageDie}` : ` − d6 ${-roll.advantageDie}`
  }${roll.helpBonus > 0 ? ` + help ${roll.helpBonus}` : ''}${
    roll.modifier === 0 ? '' : roll.modifier > 0 ? ` + ${roll.modifier}` : ` − ${-roll.modifier}`
  } = ${roll.total} vs ${roll.difficulty}`;
}

/** What the pair of them means. */
export function verdictOf(roll: DualityRoll): string {
  if (roll.outcome === 'criticalSuccess') return 'critical success';
  if (roll.outcome === 'successWithGood') return 'success with Light';
  if (roll.outcome === 'successWithBad') return 'success with Shadow';
  if (roll.outcome === 'failureWithGood') return 'failure with Light';
  return 'failure with Shadow';
}

export function DiceTray(props: DiceTrayProps): preact.JSX.Element | null {
  const { roll, millis } = props;
  const t = useTumble(roll?.id ?? null, millis);
  const settled = roll !== null && t >= 1;

  // Read, then gone: the pair holds a moment on what it landed on, unless there
  // is no time to hold for, and then the next roll in the queue comes up.
  useEffect(() => {
    if (roll === null || !settled) return;
    const done = setTimeout(() => props.onDone(roll.id), millis <= 0 ? 0 : HOLD);
    return () => clearTimeout(done);
  }, [roll?.id, settled, millis]);

  if (roll === null) return null;
  return (
    <div
      data-testid="dice-tray"
      data-good={roll.roll.good}
      data-bad={roll.roll.bad}
      data-total={roll.roll.total}
      data-settled={settled ? 'true' : 'false'}
      className="play dice"
    >
      <div className="dice-who">
        {roll.who} rolls {roll.what}
      </div>
      <div className="dice-pair">
        <Die value={roll.roll.good} seed={roll.id} t={t} colours={LIGHT_DIE} size={DIE} />
        <Die value={roll.roll.bad} seed={roll.id + 7} t={t} colours={SHADOW_DIE} size={DIE} />
      </div>
      {/* The result is the settle: nothing to read until the dice stop. */}
      <div className="dice-readout" style={{ opacity: settled ? 1 : 0 }}>
        <div className="dice-line">{readout(roll.roll)}</div>
        <div className={`dice-verdict ${roll.roll.success ? 'is-success' : 'is-failure'}`}>{verdictOf(roll.roll)}</div>
      </div>
    </div>
  );
}
