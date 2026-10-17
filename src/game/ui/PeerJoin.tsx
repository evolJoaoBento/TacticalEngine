/**
 * A guest meeting the host of a peer game (`docs/PEER.md`), before their page boots (`?peer=join`): their name, and
 * the handshake either way round - the host's invitation code pasted and a reply written to send back, or, for a host
 * not waiting with an invitation (a guest whose page was opened again, their seat kept for them), a code of the
 * guest's own written first and the host's answer pasted. Once the channel is open, the project the game is played
 * over is read through it, and the page boots over that (`project-store.ts`). Shown over the loading curtain; gone once
 * the project is in - and from then on the page watches for its link to the host dropping (`PeerRejoin.tsx`).
 *
 * Opened with a room's link (`?room=`, where the Rust server carries the codes - `relay.ts`), one **Join** does it:
 * the guest's code left at the room, and the host letting them in (`meetAtRoom`) - or turning them away, which they
 * are told. A tab that joined at that room before - reloaded - joins again by itself, the host's page letting a player
 * already at the game in without asking. The codes stay below, for when the room does not answer.
 */

import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ask, reply, type Asked } from '../peer/connect';
import { joinedOver, keepRoom, lastName, meetAtRoom, nameFrom, peerSelf, renamed, roomKept, LONGEST_NAME } from '../peer/peer-play';
import { roomOf } from '../peer/relay';
import { CopyButton } from './PeerInvites';
import { watchRejoin } from './PeerRejoin';

type Stage = { at: 'paste' } | { at: 'making' } | { at: 'reply'; code: string } | { at: 'asking'; asked: Asked } | { at: 'meeting' } | { at: 'joining' };

/** Why a room did not answer, as the guest is told it; and that the host turned them away. */
const UNANSWERED = 'Your host did not answer: their page may be closed. Ask them for a new link, or use codes below.';
const TURNED_AWAY = 'The host did not let you in.';

/** How long a guest waits at a room for the host to let them in (ms): the host may be in the middle of something. */
export const JOIN_WAIT = 5 * 60_000;

function PeerJoin({ joined }: { joined: (project: unknown) => void }): preact.JSX.Element {
  const [name, setName] = useState(new URLSearchParams(location.search).get('as') ?? lastName() ?? '');
  const [code, setCode] = useState('');
  const [answer, setAnswer] = useState('');
  const [stage, setStage] = useState<Stage>({ at: 'paste' });
  const [problem, setProblem] = useState<string | null>(null);

  const failed = (failure: unknown): void => {
    setProblem(failure instanceof Error ? failure.message : String(failure));
    setStage({ at: 'paste' });
  };
  const over = async (channel: RTCDataChannel): Promise<void> => {
    setStage({ at: 'joining' });
    const said = await joinedOver(channel).send({ op: 'project' });
    if (said.error !== undefined) throw new Error(said.error);
    joined((said.ok as { project: unknown }).project);
  };
  const make = async (): Promise<void> => {
    setProblem(null);
    renamed(nameFrom(name, 'Guest'));
    setStage({ at: 'making' });
    try {
      const made = await reply(code, peerSelf());
      setStage({ at: 'reply', code: made.code });
      await over(await made.channel);
    } catch (failure) {
      failed(failure);
    }
  };
  const askFirst = async (): Promise<void> => {
    setProblem(null);
    renamed(nameFrom(name, 'Guest'));
    setStage({ at: 'making' });
    try {
      setStage({ at: 'asking', asked: await ask(peerSelf()) });
    } catch (failure) {
      failed(failure);
    }
  };
  const room = roomOf();
  const viaRoom = async (at: string): Promise<void> => {
    setProblem(null);
    renamed(nameFrom(name, 'Guest'));
    setStage({ at: 'meeting' });
    try {
      const channel = await meetAtRoom(at, { within: JOIN_WAIT });
      if (channel === 'refused') throw new Error(TURNED_AWAY);
      if (channel === null) throw new Error(UNANSWERED);
      keepRoom(at);
      await over(channel);
    } catch (failure) {
      failed(failure);
    }
  };
  // Reloaded, after joining at this room: joined again, nobody clicking.
  useEffect(() => {
    if (room !== null && roomKept(room) && name.trim() !== '') void viaRoom(room);
  }, []);
  const answered = async (asked: Asked): Promise<void> => {
    setProblem(null);
    try {
      await over(await asked.accept(answer));
    } catch (failure) {
      asked.close();
      failed(failure);
    }
  };

  return (
    <div className="lobby-backdrop" style={{ zIndex: 1001 }} data-testid="peer-join">
      <div className="play-box lobby-sheet" role="dialog" aria-modal="true" aria-label="Join a game">
        <div className="settings-head">
          <h2>Join a game</h2>
        </div>
        {stage.at === 'paste' || stage.at === 'making' ? (
          <>
            <div className="settings-section">
              <div className="play-eyebrow">Your name</div>
              <input className="players-invite" data-testid="peer-name" maxLength={LONGEST_NAME} value={name} placeholder="What the others call you" onInput={(e) => setName(e.currentTarget.value)} />
            </div>
            {room === null ? null : (
              <div className="lobby-foot" style={{ marginBottom: '8px' }}>
                <button type="button" className="play-btn" data-testid="peer-room-join" disabled={stage.at === 'making'} onClick={() => void viaRoom(room)}>
                  Join
                </button>
              </div>
            )}
            <div className="settings-section">
              <div className="play-eyebrow">{room === null ? "The host's code" : "Or, with your host's code"}</div>
              <textarea className="players-invite peer-code" data-testid="peer-code" rows={4} value={code} placeholder="Paste the invitation code your host sent" onInput={(e) => setCode(e.currentTarget.value)} />
            </div>
            {problem === null ? null : (
              <p className="panel-sub" data-testid="peer-join-problem">
                {problem}
              </p>
            )}
            <div className="lobby-foot" style={{ gap: '8px' }}>
              <button type="button" className="play-btn is-ghost" data-testid="peer-ask-first" disabled={stage.at === 'making'} title="For a host who is not waiting with an invitation: you were at the game, and are coming back" onClick={() => void askFirst()}>
                No code? Write one for my host
              </button>
              <button type="button" className="play-btn" data-testid="peer-make-reply" disabled={stage.at === 'making' || code.trim() === ''} onClick={() => void make()}>
                {stage.at === 'making' ? 'Writing…' : 'Write my reply'}
              </button>
            </div>
          </>
        ) : stage.at === 'reply' ? (
          <div className="settings-section">
            <div className="play-eyebrow">Send this back to your host</div>
            <div className="panel-row" style={{ gap: '6px' }}>
              <textarea className="players-invite peer-code" data-testid="peer-reply" rows={4} readOnly value={stage.code} onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={stage.code} testid="peer-reply-copy" />
            </div>
            <p className="panel-sub" data-testid="peer-join-waiting">
              Waiting for your host to paste it…
            </p>
          </div>
        ) : stage.at === 'asking' ? (
          <div className="settings-section">
            <div className="play-eyebrow">Send this to your host</div>
            <div className="panel-row" style={{ gap: '6px' }}>
              <textarea className="players-invite peer-code" data-testid="peer-ask-code" rows={4} readOnly value={stage.asked.code} onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={stage.asked.code} testid="peer-ask-copy" />
            </div>
            <div className="play-eyebrow" style={{ marginTop: '8px' }}>
              Paste the answer they send back
            </div>
            <div className="panel-row" style={{ gap: '6px' }}>
              <textarea className="players-invite peer-code" data-testid="peer-ask-answer" rows={3} value={answer} onInput={(e) => setAnswer(e.currentTarget.value)} />
              <button type="button" className="play-btn" data-testid="peer-ask-connect" disabled={answer.trim() === ''} onClick={() => void answered(stage.asked)}>
                Connect
              </button>
            </div>
          </div>
        ) : stage.at === 'meeting' ? (
          <p className="panel-sub" data-testid="peer-join-meeting">
            Waiting for your host to let you in…
          </p>
        ) : (
          <p className="panel-sub" data-testid="peer-join-joining">
            Connected. Joining the game…
          </p>
        )}
      </div>
    </div>
  );
}

/** The host met and the project read: what the page boots over. */
export function joinPeer(): Promise<unknown> {
  return new Promise((done) => {
    const at = document.createElement('div');
    document.body.appendChild(at);
    render(
      h(PeerJoin, {
        joined: (project) => {
          render(null, at);
          at.remove();
          watchRejoin();
          done(project);
        },
      }),
      at,
    );
  });
}
