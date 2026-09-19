/**
 * A check, asked and thrown the way Baldur's Gate 3 asks for one.
 *
 * The room darkens and blurs behind a card that names the roll, sets the two
 * dice down beside what the roller adds to them, and waits: Roll, or Cancel and
 * go back to exploring. Roll throws them — they tumble and land on what the
 * rules already decided — and the card holds until Accept, so the result is read
 * before the room moves on.
 *
 * Only the throw this card made is shown on it: the card remembers the newest
 * roll in the queue as it answers, so whatever lands after that is its own.
 * Every other Duality roll — a swing, a reaction, a check answered by a script
 * driving the game — goes to the tray behind, which waits while the card is up.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Pending } from '../demo-scene';
import type { DualityRoll } from '../../engine/rules/duality';
import type { Prompt, Response } from '../../engine/script/runner';
import type { RollShow } from '../log';
import { DiceTray, verdictOf } from './DiceTray';
import { Die, LIGHT_DIE, SHADOW_DIE, useTumble } from './Die';
import './hud.css';

export interface RollStageProps {
  /** Duality rolls waiting to be watched, oldest first. */
  rolls: readonly RollShow[];
  /** How long a roll tumbles. Zero lands it at once. */
  millis: number;
  pending: Pending | null;
  /** The Light the roller has to spend on an Experience. */
  actorGood: number;
  /** A creature's name, for a card that has to say who the roll is against. */
  nameOf: (id: string) => string;
  onAnswer: (response: Response) => void;
  /** This roll has been read; take it out of the queue. */
  onDone: (id: number) => void;
}

/**
 * What is actually being asked, which is not always the outermost thing waiting:
 * a reply that calls for a roll raises its check *inside* the conversation.
 */
export function asked(pending: Pending | null): Prompt | null {
  const talking = pending !== null && pending.kind === 'script' ? pending.dialogue : null;
  return talking?.prompt ?? (talking === null ? (pending?.prompt ?? null) : null);
}

/** A check tumbles longer than a roll in the tray: it is the one the player asked for. */
const THROW = 1.7;
/** How big the dice are drawn on the card, and in the tray. */
const DIE = 104;
/** How long each term of the sum holds before the next one lands on it. */
const STEP = 600;

/** A trait reads as the sheet's own word, capitalised: "Agility", "Spellcast". */
const named = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/**
 * What the dice came to, term by term, the way a table reads a roll out: the
 * two dice, whatever was added to them, the total, and what it was against.
 */
function tally(roll: DualityRoll, trait: string): { text: string; tone: string }[] {
  const steps = [
    { text: `Light ${roll.good}`, tone: 'is-good' },
    { text: `+ Shadow ${roll.bad}`, tone: 'is-bad' },
  ];
  if (roll.advantageDie > 0) steps.push({ text: `+ d6 ${roll.advantageDie}`, tone: 'is-good' });
  if (roll.advantageDie < 0) steps.push({ text: `\u2212 d6 ${-roll.advantageDie}`, tone: 'is-bad' });
  if (roll.helpBonus > 0) steps.push({ text: `+ help ${roll.helpBonus}`, tone: 'is-good' });
  if (roll.modifier !== 0) {
    steps.push({ text: `${roll.modifier > 0 ? '+' : '\u2212'} ${Math.abs(roll.modifier)} ${trait}`, tone: 'is-mod' });
  }
  steps.push({ text: `= ${roll.total}`, tone: 'is-total' });
  steps.push({ text: `vs ${roll.difficulty}`, tone: 'is-vs' });
  return steps;
}

export function RollStage(props: RollStageProps): preact.JSX.Element | null {
  const asking = asked(props.pending);
  const check = asking !== null && asking.kind === 'check' ? asking : null;
  /** The Experience to Utilize on the roll being asked for, if any. */
  const [experience, setExperience] = useState('');
  /**
   * What this card threw, once it has thrown.
   *
   * A ref rather than state: answering redraws the whole overlay before a state
   * change would land, and in that first redraw the tray would take the throw.
   */
  const thrown = useRef<{ after: number; title: string; trait: string } | null>(null);
  const mine = thrown.current === null ? undefined : props.rolls.find((roll) => roll.id > thrown.current!.after);
  // Roll was pressed and nothing was rolled — a check the room answered its own
  // way — so there is nothing for the card to hold.
  if (thrown.current !== null && mine === undefined) thrown.current = null;

  const millis = props.millis <= 0 ? 0 : Math.round(props.millis * THROW);
  const t = useTumble(mine?.id ?? null, millis);
  const settled = mine !== undefined && t >= 1;
  // The sum arrives a term at a time once the dice are down; a card with no
  // time to take over it has the whole thing at once, which is what a test wants.
  const steps = mine === undefined ? [] : tally(mine.roll, thrown.current?.trait ?? '');
  /** Where the total falls in the sum, so it can be lifted out of the line and set under it. */
  const totalAt = steps.findIndex((step) => step.tone === 'is-total');
  /**
   * Whether the roll reached what it was against.
   *
   * The total against the difficulty, and nothing else. `roll.success` is a different question --
   * a Duality roll succeeds with Light or with Shadow, and a critical is its own case -- so the
   * number under the sum is coloured by the one thing it is actually showing.
   */
  const made = mine !== undefined && mine.roll.total >= mine.roll.difficulty;
  const [shown, setShown] = useState(0);
  const tallied = settled && shown >= steps.length;
  useEffect(() => {
    if (!settled) {
      setShown(0);
      return;
    }
    if (millis <= 0) {
      setShown(steps.length);
      return;
    }
    if (shown >= steps.length) return;
    const next = setTimeout(() => setShown((was) => was + 1), shown === 0 ? 480 : STEP);
    return () => clearTimeout(next);
  }, [settled, shown, steps.length, millis]);
  const focus = useRef<HTMLButtonElement | null>(null);
  const phase = mine !== undefined ? (settled ? 'read' : 'throwing') : check !== null ? 'ask' : 'none';
  useEffect(() => {
    focus.current?.focus();
  }, [phase]);

  const trait = check === null ? '' : named(check.trait);
  const picked = check?.experiences.find((one) => one.name === experience);
  const spendable = props.actorGood >= 1;
  const bonus = (check?.modifier ?? 0) + (spendable ? (picked?.modifier ?? 0) : 0);
  const title = check?.prompt ?? `Roll ${trait}`;
  const against = check === null || check.targets.length === 0 ? null : check.targets.map(props.nameOf).join(', ');

  const cancel = (): void => {
    setExperience('');
    props.onAnswer({ kind: 'cancel' });
  };
  const roll = (): void => {
    const chosen = experience;
    setExperience('');
    thrown.current = { after: props.rolls.reduce((top, waiting) => Math.max(top, waiting.id), 0), title, trait };
    props.onAnswer(chosen === '' || !spendable ? { kind: 'roll' } : { kind: 'roll', experience: chosen });
  };
  const accept = (): void => {
    const id = mine!.id;
    thrown.current = null;
    props.onDone(id);
  };

  // Nothing is being asked: the tray has the floor, for the rolls the game makes
  // on its own.
  if (phase === 'none') return <DiceTray roll={props.rolls[0] ?? null} millis={props.millis} onDone={props.onDone} />;

  return (
    <div
      className="roll-backdrop"
      // The room is blurred out behind the card, and stays out of reach until the
      // card is done with — but a press on it must not take the keys away from it.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        className="play-box roll-card"
        role="dialog"
        aria-modal="true"
        aria-label={mine === undefined ? title : `${thrown.current!.title} — the dice`}
        data-testid={mine === undefined ? 'check-prompt' : 'roll-result'}
        {...(mine === undefined
          ? {}
          : { 'data-good': mine.roll.good, 'data-bad': mine.roll.bad, 'data-total': mine.roll.total, 'data-settled': settled ? 'true' : 'false' })}
        // The overlay's own keys — Enter passes the turn, Tab picks the next
        // character — are not this card's, and the card is what has the floor.
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== 'Escape') return;
          event.preventDefault();
          if (mine === undefined) cancel();
          else if (tallied) accept();
          else if (settled) setShown(steps.length);
        }}
      >
        <div className="play-eyebrow">{mine === undefined ? `${trait} Roll` : `${thrown.current!.trait} Roll`}</div>
        <div className="roll-title">{mine === undefined ? title : thrown.current!.title}</div>
        {against !== null && mine === undefined ? <div className="roll-against">Against {against}</div> : null}

        {/* What the roll is against stays up while the dice are in the air, so the
            card holds still from the asking to the reading of it. */}
        <div className="roll-dc" data-testid="difficulty">
          <span className="play-eyebrow">Difficulty</span>
          <b>{mine !== undefined ? mine.roll.difficulty : check !== null && check.difficulty !== 'target' ? check.difficulty : 'Theirs'}</b>
        </div>

        <div className="roll-table">
          <span className="roll-die">
            <Die value={mine === undefined ? 12 : mine.roll.good} seed={mine?.id ?? 1} t={mine === undefined ? 1 : t} colours={LIGHT_DIE} size={DIE} />
            <span className="roll-die-name is-good">Light</span>
          </span>
          <span className="roll-die">
            <Die value={mine === undefined ? 12 : mine.roll.bad} seed={(mine?.id ?? 1) + 7} t={mine === undefined ? 1 : t} colours={SHADOW_DIE} size={DIE} />
            <span className="roll-die-name is-bad">Shadow</span>
          </span>
          {mine === undefined || mine.roll.modifier !== 0 ? (
            <span className="roll-die">
              <span className="roll-mod">{signed(mine === undefined ? bonus : mine.roll.modifier)}</span>
              <span className="roll-die-name">{mine === undefined ? trait : thrown.current!.trait}</span>
            </span>
          ) : null}
        </div>

        {mine === undefined && check !== null && check.experiences.length > 0 ? (
          <div className="roll-bonuses">
            <span className="play-eyebrow">Utilize an Experience · 1 Light</span>
            {check.experiences.map((one) => (
              <button
                key={one.name}
                type="button"
                data-testid="experience-pick"
                className={`play-btn is-ghost roll-chip${experience === one.name ? ' is-on' : ''}`}
                disabled={!spendable}
                title={spendable ? undefined : 'No Light to spend'}
                aria-pressed={experience === one.name}
                onClick={() => setExperience(experience === one.name ? '' : one.name)}
              >
                {one.name} {signed(one.modifier)}
              </button>
            ))}
          </div>
        ) : null}

        {/* Nothing to read until the dice stop, and then one term at a time. The
            room it takes is held from the start, so the card does not jump as the
            numbers arrive; a press anywhere on it skips to the end of the sum. */}
        {mine !== undefined ? (
          <div className="roll-outcome" onClick={() => setShown(steps.length)}>
            {/* The sum reads across the line; what it came to drops out of that line and sits
                centred under it. It is still one of the terms and still arrives in its turn as the
                sum is read out -- it is only drawn apart, because the total is the number a player
                is actually waiting for and it should not be one item among six. */}
            <div className="roll-steps">
              {steps.slice(0, shown).map((step, i) =>
                step.tone === 'is-total' ? null : (
                  <span key={i} data-testid="step" className={`roll-step ${step.tone}`}>
                    {step.text}
                  </span>
                ),
              )}
            </div>
            {shown > totalAt && totalAt >= 0 ? (
              <div data-testid="step" className={`roll-total ${made ? 'is-made' : 'is-missed'}`}>
                {mine.roll.total}
              </div>
            ) : null}
            {tallied ? (
              <div
                data-testid="verdict"
                className={`roll-verdict ${mine.roll.success ? 'is-success' : 'is-failure'}${mine.roll.critical ? ' is-critical' : ''}`}
              >
                {verdictOf(mine.roll)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="roll-actions">
          {mine === undefined ? (
            <>
              <button type="button" className="play-btn" data-testid="cancel-roll" onClick={cancel}>
                Cancel
              </button>
              <button type="button" ref={focus} className="play-btn is-primary is-throw" data-testid="roll" onClick={roll}>
                Roll {trait} {signed(bonus)}
              </button>
            </>
          ) : (
            <button
              type="button"
              ref={focus}
              className="play-btn is-primary is-throw"
              data-testid="accept"
              style={{ visibility: tallied ? 'visible' : 'hidden' }}
              onClick={accept}
            >
              Accept
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
