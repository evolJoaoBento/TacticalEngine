/**
 * The lobby (`docs/SERVER.md`, phase 5, slice 5): a game opened for others to join (`?host`), shown over the board
 * until its host starts it. The invitation to send; who has come; each character and who plays it - a seat nobody
 * has taken, by whoever wants it, their own left again, and anybody's by the host's word - and the host's Start,
 * which the others wait on. A save hosted again keeps each player's seat for them until they are back (`kept`).
 * Somebody with no account yet is sent the player's own invitation with the game's: it makes their account, and
 * they land here (`accounts.ts`, `invitationAddress`) - while it is not spent.
 * Until then nobody plays anybody (`engine::game::seats`). Nothing at a game nobody shares,
 * or once it has started (`shared-game.ts`). Who may find the game in the list of games to join - everybody, the
 * host's friends, or only those sent the link - the host says here, and the others see (phase 6, slice 3). And what
 * everybody says while they gather (`Chat.tsx`, phase 6, slice 5).
 */

import { useEffect, useState } from 'preact/hooks';
import { changeVisibility, hosting, invitationLink, membersLine, onSharedTable, playingAs, seat, seatFor, seatable, sharedTable, start } from '../shared-game';
import type { Visibility } from '../wire';
import { invitationAddress, myInvitation, type Invitation } from '../accounts';
import { InviteRow, SeatSelect } from './Players';
import { Chat } from './Chat';
import { PeerInvites } from './PeerInvites';
import { peering } from '../peer/peer-play';

/** Who may find the game, as the others are told it. */
const FINDABLE: Record<Visibility, string> = { friends: "The host's friends", public: 'Everybody', invite: 'Only those sent the link' };

export function Lobby(): preact.JSX.Element | null {
  const [table, setTable] = useState(sharedTable());
  useEffect(() => onSharedTable(setTable), []);
  const [mine, setMine] = useState<Invitation | null>(null);
  // Asked only at a lobby: a page with no shared game has nobody signed in to ask for.
  const gathering = table !== null && !table.started;
  // A peer game has no server: no accounts to invite, nobody to find it but those its host invites (`PeerInvites`).
  const peer = peering() !== null;
  useEffect(() => {
    if (gathering && !peer) void myInvitation().then(setMine);
  }, [gathering, peer]);
  if (table === null || table.started) return null;
  const nameOf = (account: string): string => table.members.find((member) => member.id === account)?.name ?? account;
  const you = playingAs();
  return (
    <div className="lobby-backdrop" data-testid="lobby">
      <div className="play-box lobby-sheet" role="dialog" aria-modal="true" aria-label="The lobby">
        <div className="settings-head">
          <h2>Gathering</h2>
        </div>
        <div className="settings-section">
          <div className="play-eyebrow">Invite your friends</div>
          {peer ? hosting() ? <PeerInvites /> : <div className="panel-sub">The host invites the players, each with a code of their own.</div> : <InviteRow link={invitationLink(table.invite)} />}
          {peer || mine === null || mine.usedBy !== null ? null : (
            <>
              <div className="panel-sub" style={{ margin: '6px 0 2px' }}>
                Somebody with no account yet: this one makes theirs with your invitation, and brings them here.
              </div>
              <InviteRow link={invitationAddress(mine.code, table.invite)} testid="invite-new-link" />
            </>
          )}
        </div>
        <div className="settings-section" hidden={peer}>
          <div className="play-eyebrow">Who can find it</div>
          {hosting() ? (
            <select data-testid="lobby-findable" value={table.visibility ?? 'invite'} onChange={(e) => void changeVisibility(e.currentTarget.value as Visibility)}>
              <option value="friends">Your friends</option>
              <option value="public">Everybody</option>
              <option value="invite">Only those you send the link</option>
            </select>
          ) : (
            <div className="panel-facts" data-testid="lobby-findable-said">
              {FINDABLE[table.visibility ?? 'invite']}
            </div>
          )}
        </div>
        <div className="settings-section">
          <div className="play-eyebrow">At the table</div>
          <div className="panel-facts" data-testid="lobby-members">
            {membersLine(table)}
          </div>
        </div>
        <div className="settings-section">
          <div className="play-eyebrow">Seats</div>
          <div className="panel-sub" style={{ marginBottom: '4px' }}>
            Whoever nobody takes, {nameOf(table.host)} plays.
          </div>
          {seatable().map((character) => {
            const seated = table.seats[character.id];
            const may = seatFor(character.id);
            const kept = seated === undefined ? table.kept?.[character.id] : undefined;
            return (
              <div key={character.id} className="panel-row players-seat" data-testid="lobby-seat" data-character={character.id}>
                <span style={{ flex: 1 }}>{character.name}</span>
                {may === 'choose' ? (
                  <>
                    {kept === undefined ? null : (
                      <span className="panel-sub" data-testid="lobby-kept">
                        Kept for {kept.name}
                      </span>
                    )}
                    <SeatSelect character={character.id} table={table} host />
                  </>
                ) : (
                  <span className="panel-sub" data-testid="lobby-seated">
                    {seated !== undefined ? (seated === you ? 'You' : nameOf(seated)) : table.kept?.[character.id] !== undefined ? `Kept for ${table.kept[character.id]!.name}` : nameOf(table.host)}
                  </span>
                )}
                {may === 'take' ? (
                  <button type="button" className="play-btn is-ghost" data-testid="lobby-take" onClick={() => void seat(character.id, you)}>
                    Take
                  </button>
                ) : may === 'leave' ? (
                  <button type="button" className="play-btn is-ghost" data-testid="lobby-leave" onClick={() => void seat(character.id, null)}>
                    Leave
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="settings-section">
          <div className="play-eyebrow">Talk</div>
          <Chat inLobby />
        </div>
        <div className="lobby-foot">
          {hosting() ? (
            <button type="button" className="play-btn" data-testid="lobby-start" onClick={() => void start()}>
              Start
            </button>
          ) : (
            <p className="settings-foot" data-testid="lobby-waiting">
              Waiting for {nameOf(table.host)} to start the game.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
