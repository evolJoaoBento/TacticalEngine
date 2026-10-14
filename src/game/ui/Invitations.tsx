/**
 * Inviting somebody new, from the main menu (`accounts.ts`; the server's `accounts.rs`): the player's own invitation
 * - one link that makes one account, spent once it has - and, for admin, every player, who invited them, and a new
 * invitation for one of them or for everybody at once.
 */

import { useEffect, useState } from 'preact/hooks';
import { invitationAddress, listPlayers, myInvitation, renewInvitations, type Invitation, type Player, type SignedIn } from '../accounts';
import './menu.css';

export function Invitations(props: { account: SignedIn; onBack: () => void }): preact.JSX.Element {
  const [mine, setMine] = useState<Invitation | null | 'asking'>('asking');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const read = (): void => {
    void myInvitation().then(setMine);
    if (props.account.admin) void listPlayers().then(setPlayers);
  };
  useEffect(read, [props.account.id]);
  const renew = async (who: string | null): Promise<void> => {
    const answer = await renewInvitations(who);
    setSaid('refused' in answer ? answer.refused : who === null ? 'Everybody has a new invitation.' : `${players?.find((p) => p.id === who)?.name ?? who} has a new invitation.`);
    setCopied(false);
    read();
  };
  const nameOf = (id: string): string => players?.find((player) => player.id === id)?.name ?? id;

  return (
    <div className="menu-load" data-testid="invitations">
      <section className="menu-game menu-join">
        <header>
          <h2>Your invitation</h2>
        </header>
        {mine === 'asking' ? null : mine === null ? (
          <p className="menu-waiting-line">This server gives no invitations.</p>
        ) : mine.usedBy !== null ? (
          <p className="menu-waiting-line" data-testid="invite-spent">
            Your invitation made {mine.usedBy.name}'s account. Admin can give you another.
          </p>
        ) : (
          <>
            <p className="menu-waiting-line">It makes one account. Send it to somebody new:</p>
            <div className="menu-join-row">
              <input data-testid="invite-own-link" readOnly value={invitationAddress(mine.code)} onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="menu-go"
                data-testid="invite-own-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(invitationAddress(mine.code)).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </>
        )}
      </section>
      {players === null ? null : (
        <section className="menu-game" data-testid="invite-players">
          <header>
            <h2>Players</h2>
            <button type="button" className="menu-go" data-testid="invite-renew-all" onClick={() => void renew(null)}>
              New for everybody
            </button>
          </header>
          <ul className="menu-players">
            {players.map((player) => (
              <li key={player.id} data-player={player.id}>
                <span>
                  <b>{player.name}</b>
                  {player.invitedBy === null ? '' : `, invited by ${nameOf(player.invitedBy)}`}
                  {player.spent ? ' · invitation spent' : ''}
                </span>
                <button type="button" className="menu-link" data-testid="invite-renew" onClick={() => void renew(player.id)}>
                  New invitation
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {said === null ? null : (
        <p className="menu-sub" role="status" data-testid="invite-said">
          {said}
        </p>
      )}
      <button type="button" className="menu-back" data-testid="menu-back" onClick={props.onBack}>
        Back
      </button>
    </div>
  );
}
