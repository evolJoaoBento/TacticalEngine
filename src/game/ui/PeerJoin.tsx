/**
 * A guest meeting the host of a peer game (`docs/PEER.md`), before their page boots (`?peer=join`): their name, the
 * host's invitation code pasted, a reply code written to send back - and once the host has pasted it, the channel
 * open, the project the game is played over read through it, and the page boots over that (`project-store.ts`).
 * Shown over the loading curtain; gone once the project is in.
 */

import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { reply } from '../peer/connect';
import { joinedOver, lastName, nameFrom, peerSelf, renamed, LONGEST_NAME } from '../peer/peer-play';
import { CopyButton } from './PeerInvites';

type Stage = { at: 'paste' } | { at: 'making' } | { at: 'reply'; code: string } | { at: 'joining' };

function PeerJoin({ joined }: { joined: (project: unknown) => void }): preact.JSX.Element {
  const [name, setName] = useState(new URLSearchParams(location.search).get('as') ?? lastName() ?? '');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>({ at: 'paste' });
  const [problem, setProblem] = useState<string | null>(null);

  const make = async (): Promise<void> => {
    setProblem(null);
    renamed(nameFrom(name, 'Guest'));
    setStage({ at: 'making' });
    try {
      const made = await reply(code, peerSelf());
      setStage({ at: 'reply', code: made.code });
      const channel = await made.channel;
      setStage({ at: 'joining' });
      const said = await joinedOver(channel).send({ op: 'project' });
      if (said.error !== undefined) throw new Error(said.error);
      joined((said.ok as { project: unknown }).project);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
      setStage({ at: 'paste' });
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
            <div className="settings-section">
              <div className="play-eyebrow">The host's code</div>
              <textarea className="players-invite peer-code" data-testid="peer-code" rows={4} value={code} placeholder="Paste the invitation code your host sent" onInput={(e) => setCode(e.currentTarget.value)} />
            </div>
            {problem === null ? null : (
              <p className="panel-sub" data-testid="peer-join-problem">
                {problem}
              </p>
            )}
            <div className="lobby-foot">
              <button type="button" className="play-btn" data-testid="peer-make-reply" disabled={stage.at === 'making' || code.trim() === ''} onClick={() => void make()}>
                {stage.at === 'making' ? 'Writing your reply…' : 'Write my reply'}
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
          done(project);
        },
      }),
      at,
    );
  });
}
