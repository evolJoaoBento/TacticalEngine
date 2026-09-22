/**
 * Running an encounter: whose turn it is, and when the fight is over.
 *
 * There is no initiative, which makes this less like a turn queue and more
 * like a rule about attention. SRD 2.0, "TURN ORDER & ACTION ECONOMY":
 *
 * > Turns do not follow a traditional, rigid format: there is no
 * > explicit initiative mechanic and characters don't have a set number of
 * > actions they can take.
 *
 * The party acts until a roll hands the spotlight over — "Rolls with Shadow on an
 * action roll" or "Fails an action roll" — then the GM takes a turn, spotlighting
 * one adversary for free and spending a Shadow for each additional one, and
 * "after the GM turn is done, the spotlight goes back to the PCs."
 *
 * The SRD's optional Spotlight Tracker is the second policy here rather than a
 * different code path: tokens per character, one spent per action, refilled when
 * everyone has run out. The legacy prototype's action-token pool was a variant of
 * the same idea, so ported content has somewhere to land.
 *
 * Pure engine: it decides turns and reports events. It rolls nothing and moves
 * nothing — `attack.ts` does that, and the caller tells this what happened.
 */

import type { Spot } from '../grid/grid';
import { nextBand, type RangeBand } from '../rules/range';
import type { SceneState } from '../scene/state';

/** How the turn economy works. */
export type TurnPolicy =
  /** SRD default: the party acts until a roll passes the spotlight. */
  | 'spotlight'
  /** SRD optional Spotlight Tracker: a token budget per character. */
  | 'tracker';

/** SRD: "each player adds a certain number of tokens (we recommend 3)". */
export const DEFAULT_TOKENS_PER_CHARACTER = 3;

export interface EncounterOptions {
  policy?: TurnPolicy;
  tokensPerCharacter?: number;
}

export type Side = 'party' | 'gm';

export type EncounterOutcome = 'ongoing' | 'victory' | 'defeat';

export interface EncounterView {
  /** Whose turn it is. */
  side: Side;
  /** Party members who may act right now. */
  ready: readonly string[];
  /** Adversaries the GM has not yet spotlighted this turn. */
  waiting: readonly string[];
  /**
   * How many times the party has been handed the spotlight back. Not a
   * rules concept — a convenience for pacing, logs and effect durations.
   */
  round: number;
  outcome: EncounterOutcome;
  /** Shadow the GM must spend to spotlight one more adversary this turn. */
  nextSpotlightCost: number;
}

/** Something the caller may want to log or animate. */
export type EncounterEvent =
  | { kind: 'started'; encounter: string }
  | { kind: 'spotlight'; side: Side; round: number }
  | { kind: 'acted'; id: string; tokensLeft?: number }
  | { kind: 'adversaryActed'; id: string; badSpent: number }
  | { kind: 'tokensRefilled'; round: number }
  /** A character pushed their movement out a step, on a roll. */
  | { kind: 'pushed'; id: string; band: RangeBand }
  | { kind: 'ended'; encounter: string; outcome: EncounterOutcome };

/**
 * One encounter in progress.
 *
 * The caller drives it: tell it a character acted and whether their roll passed
 * the spotlight, tell it the GM spotlighted an adversary, and ask it whose turn
 * it is. It never reaches into the rules.
 */
export class EncounterRunner {
  readonly encounterId: string;
  readonly policy: TurnPolicy;
  readonly tokensPerCharacter: number;

  private readonly state: SceneState;
  private readonly tokens = new Map<string, number>();
  private readonly events: EncounterEvent[] = [];
  /** Adversaries already spotlighted in the current GM turn. */
  private readonly actedThisGmTurn = new Set<string>();
  /**
   * Where each party member may walk freely this spotlight: a circle round where they stood when
   * the spotlight came to the party, Close at first, and one distance step wider for each roll that
   * pushed it. Anchored when the spotlight comes, so a creature shoved about in the GM's turn is
   * measured from where that left them.
   */
  private readonly circles = new Map<string, { anchor: Spot; band: RangeBand }>();

  private side: Side = 'party';
  private roundCount = 1;
  private started = false;
  private finished: EncounterOutcome = 'ongoing';

  constructor(state: SceneState, encounterId: string, options: EncounterOptions = {}) {
    this.state = state;
    this.encounterId = encounterId;
    this.policy = options.policy ?? 'spotlight';
    this.tokensPerCharacter = Math.max(1, options.tokensPerCharacter ?? DEFAULT_TOKENS_PER_CHARACTER);
  }

  /** Begin. Marks the encounter started and fills the token budget. */
  start(): EncounterView {
    if (!this.started) {
      this.started = true;
      const encounter = this.state.encounter(this.encounterId);
      encounter.started = true;
      encounter.triggered = true;
      this.refillTokens(false);
      this.anchorCircles();
      this.events.push({ kind: 'started', encounter: this.encounterId });
      this.events.push({ kind: 'spotlight', side: 'party', round: this.roundCount });
    }
    return this.view();
  }

  get log(): readonly EncounterEvent[] {
    return this.events;
  }

  get round(): number {
    return this.roundCount;
  }

  /** Whether a character may take an action right now. */
  canAct(id: string): boolean {
    if (this.outcome !== 'ongoing' || this.side !== 'party') return false;
    const entity = this.state.entity(id);
    if (entity === undefined || !entity.alive || entity.faction !== 'party') return false;
    return this.policy === 'spotlight' || (this.tokens.get(id) ?? 0) > 0;
  }

  /**
   * Record that a party member acted.
   *
   * `spotlightToGm` comes straight off the duality roll — the caller passes what
   * `resolveAttack` or a check reported, rather than this second-guessing the
   * rules. An action with no roll at all (moving, opening a door) passes false.
   */
  act(id: string, options: { spotlightToGm?: boolean } = {}): EncounterView {
    if (!this.canAct(id)) return this.view();

    if (this.policy === 'tracker') {
      const left = Math.max(0, (this.tokens.get(id) ?? 0) - 1);
      this.tokens.set(id, left);
      this.events.push({ kind: 'acted', id, tokensLeft: left });
    } else {
      this.events.push({ kind: 'acted', id });
    }

    if (this.checkEnd()) return this.view();

    // Under the tracker, running the party dry also hands the turn over — the
    // legacy prototype's "The party is spent." moment.
    const spent = this.policy === 'tracker' && this.readyCharacters().length === 0;
    if (options.spotlightToGm === true || spent) this.passToGm();
    return this.view();
  }

  /** Hand the spotlight to the GM without a roll having done it. */
  passToGm(): EncounterView {
    if (this.outcome !== 'ongoing' || this.side === 'gm') return this.view();
    this.side = 'gm';
    this.actedThisGmTurn.clear();
    this.events.push({ kind: 'spotlight', side: 'gm', round: this.roundCount });
    return this.view();
  }

  /**
   * What it costs the GM to spotlight another adversary this turn: the first is
   * free, and "the GM can spend additional Shadow to spotlight additional
   * adversaries."
   */
  get nextSpotlightCost(): number {
    return this.actedThisGmTurn.size === 0 ? 0 : 1;
  }

  /** Whether the GM can spotlight this adversary right now, and afford it. */
  canSpotlight(id: string): boolean {
    if (this.outcome !== 'ongoing' || this.side !== 'gm') return false;
    if (this.actedThisGmTurn.has(id)) return false;
    const entity = this.state.entity(id);
    if (entity === undefined || !entity.alive || entity.faction !== 'adversary') return false;
    return this.state.bad.value >= this.nextSpotlightCost;
  }

  /**
   * Spotlight an adversary, spending Shadow when it is not the first this turn.
   * The caller then resolves whatever that adversary does.
   */
  spotlight(id: string): EncounterView {
    if (!this.canSpotlight(id)) return this.view();
    const cost = this.nextSpotlightCost;
    if (cost > 0) {
      this.state.bad = { max: this.state.bad.max, value: this.state.bad.value - cost };
    }
    this.actedThisGmTurn.add(id);
    this.events.push({ kind: 'adversaryActed', id, badSpent: cost });
    this.checkEnd();
    return this.view();
  }

  /**
   * Spotlight an adversary the GM has already paid for.
   *
   * "Spend a Shadow to choose a target and spotlight all Giant Rats within Close
   * range of them", "spend 2 Shadow to spotlight the Head Guard and up to 2d4
   * allies": the feature's cost buys the spotlights it hands out, so charging
   * again here would bill the GM twice for the same move - and, once the pool
   * ran dry, quietly refuse the rest of what the feature said it did.
   */
  grantSpotlight(id: string): EncounterView {
    if (this.outcome !== 'ongoing' || this.side !== 'gm') return this.view();
    const entity = this.state.entity(id);
    if (entity === undefined || !entity.alive || entity.faction !== 'adversary') return this.view();
    this.actedThisGmTurn.add(id);
    this.events.push({ kind: 'adversaryActed', id, badSpent: 0 });
    this.checkEnd();
    return this.view();
  }

  /**
   * Relentless: "can be spotlighted up to X times per GM turn. Spend Shadow as
   * usual to spotlight them." The cap is the adversary's own business — the
   * caller counts — but the Shadow is spent here, like any other spotlight past
   * the first.
   */
  canSpotlightAgain(id: string): boolean {
    if (this.outcome !== 'ongoing' || this.side !== 'gm') return false;
    if (!this.actedThisGmTurn.has(id)) return false;
    const entity = this.state.entity(id);
    if (entity === undefined || !entity.alive || entity.faction !== 'adversary') return false;
    return this.state.bad.value >= 1;
  }

  spotlightAgain(id: string): EncounterView {
    if (!this.canSpotlightAgain(id)) return this.view();
    this.state.bad = { max: this.state.bad.max, value: this.state.bad.value - 1 };
    this.events.push({ kind: 'adversaryActed', id, badSpent: 1 });
    this.checkEnd();
    return this.view();
  }

  /** End the GM turn: "the spotlight goes back to the PCs." */
  endGmTurn(): EncounterView {
    if (this.outcome !== 'ongoing' || this.side !== 'gm') return this.view();
    this.side = 'party';
    this.roundCount++;
    this.actedThisGmTurn.clear();
    this.anchorCircles();
    // Under the tracker, a fresh round is when everyone gets their tokens back.
    if (this.policy === 'tracker' && this.readyCharacters().length === 0) this.refillTokens(true);
    this.events.push({ kind: 'spotlight', side: 'party', round: this.roundCount });
    return this.view();
  }

  /** Every living party member's circle drawn afresh round where they stand, at Close. */
  private anchorCircles(): void {
    this.circles.clear();
    for (const entity of this.state.entitiesOf('party')) {
      if (entity.alive) this.circles.set(entity.id, { anchor: { ...entity.at }, band: 'close' });
    }
  }

  /**
   * The circle a party member may move freely in right now: its centre and its band. Null for
   * anybody who is not a living party member, or before the fight has started.
   */
  circleOf(id: string): { anchor: Spot; band: RangeBand } | null {
    const circle = this.circles.get(id);
    if (circle === undefined) {
      // Somebody who joined mid-fight, or stood up again: their circle is where they are.
      const entity = this.state.entity(id);
      if (!this.started || entity === undefined || !entity.alive || entity.faction !== 'party') return null;
      const fresh = { anchor: { ...entity.at }, band: 'close' as const };
      this.circles.set(id, fresh);
      return fresh;
    }
    return circle;
  }

  /**
   * Draw a character's circle afresh round where they now stand, keeping its band: for somebody
   * something else moved - a shove, a script - clean out of the circle they had.
   */
  reanchor(id: string): void {
    const entity = this.state.entity(id);
    const circle = this.circles.get(id);
    if (entity !== undefined && circle !== undefined) circle.anchor = { ...entity.at };
  }

  /** The band a push would open for a character: one step out, or null when there is none past their circle. */
  pushOpens(id: string): RangeBand | null {
    const circle = this.circleOf(id);
    return circle === null ? null : nextBand(circle.band);
  }

  /** Widen a character's circle by one distance step, on a roll that did: the band it is now, or null when it could not. */
  push(id: string): RangeBand | null {
    const circle = this.circleOf(id);
    const band = circle === null ? null : nextBand(circle.band);
    if (circle === null || band === null) return null;
    circle.band = band;
    this.events.push({ kind: 'pushed', id, band });
    return band;
  }

  /** Tokens a character has left. Always `Infinity` under the spotlight policy. */
  tokensFor(id: string): number {
    return this.policy === 'tracker' ? (this.tokens.get(id) ?? 0) : Infinity;
  }

  /**
   * Settle the fight now if it is already decided.
   *
   * Normally nobody has to ask: acting and spotlighting both count who is left
   * standing, and one of the two happens after every blow. The exception is a
   * blow struck by somebody who cannot act - a character taking one final
   * action on their way through the veil - whose swing `act` refuses and
   * therefore never counts. Returns whether the fight is over.
   */
  settleIfDecided(): boolean {
    return this.checkEnd();
  }

  get outcome(): EncounterOutcome {
    return this.finished;
  }

  /** End the encounter early — an objective met, a truce, a script saying so. */
  end(outcome: EncounterOutcome = 'victory'): EncounterView {
    if (this.finished === 'ongoing') this.settle(outcome);
    return this.view();
  }

  view(): EncounterView {
    return {
      side: this.side,
      ready: this.readyCharacters(),
      waiting: this.waitingAdversaries(),
      round: this.roundCount,
      outcome: this.finished,
      nextSpotlightCost: this.nextSpotlightCost,
    };
  }

  private readyCharacters(): string[] {
    return this.state
      .entitiesOf('party')
      .filter((e) => e.alive && (this.policy === 'spotlight' || (this.tokens.get(e.id) ?? 0) > 0))
      .map((e) => e.id);
  }

  private waitingAdversaries(): string[] {
    return this.state
      .entitiesOf('adversary')
      .filter((e) => e.alive && !this.actedThisGmTurn.has(e.id))
      .map((e) => e.id);
  }

  private refillTokens(announce: boolean): void {
    for (const member of this.state.entitiesOf('party')) {
      if (member.alive) this.tokens.set(member.id, this.tokensPerCharacter);
    }
    if (announce) this.events.push({ kind: 'tokensRefilled', round: this.roundCount });
  }

  /** Victory when no adversary stands, defeat when no party member does. */
  private checkEnd(): boolean {
    if (this.finished !== 'ongoing') return true;
    const partyStanding = this.state.entitiesOf('party').some((e) => e.alive);
    const foesStanding = this.state.entitiesOf('adversary').some((e) => e.alive);
    if (!partyStanding) return this.settle('defeat');
    if (!foesStanding) return this.settle('victory');
    return false;
  }

  private settle(outcome: EncounterOutcome): boolean {
    this.finished = outcome;
    this.state.encounter(this.encounterId).ended = true;
    this.events.push({ kind: 'ended', encounter: this.encounterId, outcome });
    return true;
  }
}
