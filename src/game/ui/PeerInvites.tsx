/**
 * The host of a peer game inviting players (`docs/PEER.md`), in the lobby and the players' panel in place of a
 * server's invitation link: one invitation for each guest - a code to send them, their reply pasted back, and they
 * are at the table (`peer-play.ts`, `inviteGuest`). A guest's page shows nothing here: only the host invites.
 */

import { useState } from 'preact/hooks';
import { hostTable, inviteGuest, type Invited } from '../peer/peer-play';

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

export function PeerInvites(): preact.JSX.Element | null {
  const [opens, setOpens] = useState<Open[]>(kept);
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
      {opens.map((open) => (
        <InvitationRow key={open.key} open={open} change={(next) => change(open.key, next)} />
      ))}
      <button type="button" className="play-btn is-ghost" data-testid="peer-invite" onClick={() => void add()}>
        Invite a player
      </button>
    </div>
  );
}
