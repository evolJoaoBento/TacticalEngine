/**
 * A rest, as the page offers it (`docs/SERVER.md`, phase 5; the engine's `rest_call.rs`). The party rests together:
 * somebody calls a rest, short or long, with their own characters' two downtime moves; everybody who plays a
 * character agrees to it or not - one who would rather not calls it off - and chooses their own characters' moves;
 * once all have agreed and every one of the party has their moves, it is taken. A player alone - a game nobody
 * shares, or one where they play everybody - calls it with everybody's moves and it is taken at once, as it always
 * was. After three short rests the next must be long (`SHORT_RESTS`): the panel offers only a long one. The rest panel (`ui/RestPanel.tsx`) draws what `restPanelProps` reads here; the panel shows itself to every
 * page while a rest is called, and only its buttons put it away.
 */

import type { GameClient } from './client';
import type { RestCall, RestCallResult, RestPlan } from './demo-abilities';
import { hosting, playingAs, playsFor, sharedTable } from './shared-game';

/** How many short rests the party takes before its next rest must be long (the SRD's; the engine's `SHORT_RESTS`). */
export const SHORT_RESTS = 3;

/** One of the party, as the panel lists it: whether the page's player plays them. */
export interface RestMember {
  id: string;
  name: string;
  mine: boolean;
}

/** A project the party can work at on a long rest: a plan learned whose work is not all done. */
export interface RestProject {
  id: string;
  name: string;
  done: number;
  work: number;
}

/** The project plans learned and not finished, in the order they were learned. */
export function openProjects(board: { scenario: { projects: ReadonlyMap<string, number> }; project: { projectPlans?: readonly { id: string; name: string; work: number }[] } }): RestProject[] {
  const plans = board.project.projectPlans ?? [];
  return [...board.scenario.projects].flatMap(([id, done]) => {
    const plan = plans.find((p) => p.id === id);
    return plan === undefined || done >= plan.work ? [] : [{ id, name: plan.name, done, work: plan.work }];
  });
}

/** What the rest panel shows, and what its buttons do. */
export interface RestPanelProps {
  /** The rest called, if one is. */
  call: RestCall | null;
  /** Short rests since the last long one: at `SHORT_RESTS`, the next must be long. */
  shortRests: number;
  /** The projects a long rest's Work on a Project may go to. */
  projects: RestProject[];
  party: RestMember[];
  /** Whether the page's player is the only one who plays a character: a rest is called and taken at once. */
  alone: boolean;
  /** Whether the page's player is asked to agree to the rest called, and has not yet. */
  toVote: boolean;
  /** Whether the page's player may call off the rest called: whoever called it, or the host. */
  mayCancel: boolean;
  /** A player's name, by account. */
  playerOf: (account: string) => string;
  onCall: (kind: 'short' | 'long', moves: RestPlan['moves']) => void;
  onVote: (agree: boolean) => void;
  onChoose: (moves: RestPlan['moves']) => void;
  onCancel: () => void;
  onClose: () => void;
}

/**
 * Who plays a character at the page's game: each member's player, in the party's order - the account seated in
 * them, or the host. One, `''`, at no table.
 */
export function playersOf(party: readonly string[]): string[] {
  const table = sharedTable();
  if (table === null) return [''];
  return [...new Set(party.map((id) => table.seats[id] ?? table.host))];
}

/** What the rest panel reads off the game and the table. */
export function restView(call: RestCall | null, party: readonly string[], nameOf: (id: string) => string, shortRests = 0, projects: RestProject[] = []): Omit<RestPanelProps, 'onCall' | 'onVote' | 'onChoose' | 'onCancel' | 'onClose'> {
  const table = sharedTable();
  const you = playingAs() ?? '';
  const players = playersOf(party);
  return {
    call,
    shortRests,
    projects,
    party: party.map((id) => ({ id, name: nameOf(id), mine: playsFor(id) })),
    alone: players.length === 1 && players[0] === you,
    toVote: call !== null && call.voters.includes(you) && !call.agreed.includes(you),
    mayCancel: call !== null && (call.by === you || table === null || hosting()),
    playerOf: (account) => (account === you ? 'You' : (table?.members.find((member) => member.id === account)?.name ?? account)),
  };
}

/** The rest panel's props: what it shows, and its buttons played on the game, the panel put away when it is done. */
export function restPanelProps(game: GameClient, close: () => void, refresh: () => void): RestPanelProps {
  const party = game.board.party.members();
  // Whatever a button did, the page's own wish to see the panel is spent: from here it is up while a rest is called,
  // and goes on every page together when the rest is taken or called off.
  const done = (result: RestCallResult): void => {
    if (!result.ok) game.note(`Cannot rest: ${result.reason}.`, 'system');
    close();
    refresh();
  };
  return {
    ...restView(game.board.restCall, party, (id) => game.nameOf(id), game.board.shortRests, openProjects(game.board)),
    onCall: (kind, moves) => done(game.callRest(kind, moves)),
    onVote: (agree) => done(game.voteRest(agree)),
    onChoose: (moves) => done(game.chooseRest(moves)),
    onCancel: () => done(game.cancelRest()),
    onClose: () => {
      close();
      refresh();
    },
  };
}
