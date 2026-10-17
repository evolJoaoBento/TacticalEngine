/**
 * The host of a peer game inviting players (`docs/PEER.md`), in the lobby and the players' panel in place of a
 * server's invitation link: one invitation for each guest - a code to send them, their reply pasted back, and they
 * are at the table (`peer-play.ts`, `inviteGuest`). And the other way round, for a player who sends a code of their
 * own first - one whose link dropped, or whose page was opened again: pasted here, answered with a code to send back
 * (`answerGuest`), and they are back at the table, their seat theirs still. Where the Rust server serves the page,
 * first of all a link (`openHostRoom`, `relay.ts`): everybody who opens it joins with one click, the codes carried for
 * them - the codes still here for anybody it does not work for. A guest's page shows nothing here.
 */

import { useEffect, useState } from 'preact/hooks';
import { answerGuest, hostRoomLink, hostTable, inviteGuest, onHostRoom, type Invited } from '../peer/peer-play';

/** A code's Copy: the text onto the clipboard, and said once it is. */
export function CopyButton({ text, testid }: { text: string; testid: string }): preact.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="play-btn is-ghost" data-testid={testid} onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

interface Open {
  key: number;
  invited: Invited | null;
  reply: string;
  state: 'making' | 'waiting' | 'connecting' | 'joined' | 'failed';
  said: string;
}

let nextKey = 0;

/** One invitation: its code, the reply pasted, and how it went. */
function InvitationRow({ open, change }: { open: Open; change: (next: Partial<Open>) => void }): preact.JSX.Element {
  const connect = async (): Promise<void> => {
    if (open.invited === null) return;
    change({ state: 'connecting', said: 'Connecting…' });
    try {
      const who = await open.invited.accept(open.reply);
      change({ state: 'joined', said: `${who.name} is at the table.` });
    } catch (failure) {
      change({ state: 'failed', said: failure instanceof Error ? failure.message : String(failure) });
    }
  };
  if (open.state === 'making') {
    return (
      <p className="panel-sub" data-testid="peer-invite-making">
        Writing an invitation…
      </p>
    );
  }
  return (
    <div className="peer-invitation" data-testid="peer-invitation" data-state={open.state}>
      {open.state === 'joined' ? null : (
        <>
          <div className="panel-sub">Send this code to one player:</div>
          <div className="panel-row" style={{ gap: '4px' }}>
            <textarea className="players-invite peer-code" rows={2} readOnly value={open.invited?.code ?? ''} data-testid="peer-invite-code" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={open.invited?.code ?? ''} testid="peer-invite-copy" />
          </div>
          <div className="panel-sub">Paste the reply they send back:</div>
          <div className="panel-row" style={{ gap: '4px' }}>
            <textarea className="players-invite peer-code" rows={2} value={open.reply} data-testid="peer-invite-reply" onInput={(e) => change({ reply: e.currentTarget.value })} />
            <button type="button" className="play-btn" data-testid="peer-invite-connect" disabled={open.state === 'connecting' || open.reply.trim() === ''} onClick={() => void connect()}>
              Connect
            </button>
          </div>
        </>
      )}
      {open.said === '' ? null : (
        <p className="panel-sub" data-testid="peer-invite-said">
          {open.said}
        </p>
      )}
    </div>
  );
}

/** Kept across the lobby and the panel, so an invitation made in one is still there in the other. */
let kept: Open[] = [];

/** A player's own code, pasted by the host, and the answer written back. */
interface Answering {
  pasted: string;
  state: 'pasting' | 'answering' | 'waiting' | 'joined' | 'failed';
  code: string;
  said: string;
}

const NONE: Answering = { pasted: '', state: 'pasting', code: '', said: '' };
let answering: Answering = NONE;

/** A player's own code pasted, an answer written to send back, and them at the table once they paste it. */
function AnswerBox(): preact.JSX.Element {
  const [at, setAt] = useState(answering);
  const change = (next: Partial<Answering>): void => {
    answering = { ...answering, ...next };
    setAt(answering);
  };
  const answer = async (): Promise<void> => {
    change({ state: 'answering', said: '' });
    try {
      const answered = await answerGuest(answering.pasted);
      change({ state: 'waiting', code: answered.code, said: `Send this back to ${answered.who.name}:` });
      const who = await answered.joined;
      change({ state: 'joined', said: `${who.name} is at the table.` });
    } catch (failure) {
      change({ state: 'failed', said: failure instanceof Error ? failure.message : String(failure) });
    }
  };
  return (
    <div className="peer-invitation" data-testid="peer-answer" data-state={at.state}>
      <div className="panel-sub">A player sent you a code? Paste it:</div>
      <div className="panel-row" style={{ gap: '4px' }}>
        <textarea className="players-invite peer-code" rows={2} value={at.pasted} data-testid="peer-answer-paste" onInput={(e) => change({ pasted: e.currentTarget.value, ...(at.state === 'answering' ? {} : { state: 'pasting', code: '', said: '' }) })} />
        <button type="button" className="play-btn" data-testid="peer-answer-go" disabled={at.state === 'answering' || at.state === 'waiting' || at.pasted.trim() === ''} onClick={() => void answer()}>
          Answer
        </button>
      </div>
      {at.said === '' ? null : (
        <p className="panel-sub" data-testid="peer-answer-said">
          {at.said}
        </p>
      )}
      {at.state === 'waiting' ? (
        <div className="panel-row" style={{ gap: '4px' }}>
          <textarea className="players-invite peer-code" rows={2} readOnly value={at.code} data-testid="peer-answer-code" onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={at.code} testid="peer-answer-copy" />
        </div>
      ) : null}
    </div>
  );
}

export function PeerInvites(): preact.JSX.Element | null {
  const [opens, setOpens] = useState<Open[]>(kept);
  const [link, setLink] = useState(hostRoomLink());
  useEffect(() => onHostRoom(setLink), []);
  if (hostTable() === null) return null;
  const update = (next: Open[]): void => {
    kept = next;
    setOpens(next);
  };
  const change = (key: number, next: Partial<Open>): void => update(kept.map((open) => (open.key === key ? { ...open, ...next } : open)));
  const add = async (): Promise<void> => {
    const key = nextKey++;
    update([...kept, { key, invited: null, reply: '', state: 'making', said: '' }]);
    try {
      const invited = await inviteGuest();
      change(key, { invited, state: 'waiting' });
    } catch (failure) {
      change(key, { state: 'failed', said: failure instanceof Error ? failure.message : String(failure) });
    }
  };
  return (
    <div className="peer-invites" data-testid="peer-invites">
      {link === null ? null : (
        <div className="peer-invitation" data-testid="peer-room">
          <div className="panel-sub">Send everybody this link:</div>
          <div className="panel-row" style={{ gap: '4px' }}>
            <input className="players-invite" readOnly value={link} data-testid="peer-room-link" title="Whoever opens it joins the game" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={link} testid="peer-room-copy" />
          </div>
          <div className="panel-sub">Or, for anybody it does not work for, codes:</div>
        </div>
      )}
      {opens.map((open) => (
        <InvitationRow key={open.key} open={open} change={(next) => change(open.key, next)} />
      ))}
      <button type="button" className="play-btn is-ghost" data-testid="peer-invite" onClick={() => void add()}>
        Invite a player
      </button>
      <AnswerBox />
    </div>
  );
}
