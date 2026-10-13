/**
 * The lobby (`docs/SERVER.md`, phase 5, slice 5): a game opened for others to join (`?host`), shown over the board
 * until its host starts it. The invitation to send; who has come; each character and who plays it - a seat nobody
 * has taken, by whoever wants it, their own left again, and anybody's by the host's word - and the host's Start,
 * which the others wait on. A save hosted again keeps each player's seat for them until they are back (`kept`).
 * Until then nobody plays anybody (`engine::game::seats`). Nothing at a game nobody shares,
 * or once it has started (`shared-game.ts`).
 */

import { useEffect, useState } from 'preact/hooks';
import { hosting, invitationLink, onSharedTable, playingAs, seat, seatFor, seatable, sharedTable, start } from '../shared-game';
import { InviteRow, SeatSelect } from './Players';

export function Lobby(): preact.JSX.Element | null {
  const [table, setTable] = useState(sharedTable());
  useEffect(() => onSharedTable(setTable), []);
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
          <InviteRow link={invitationLink(table.invite)} />
        </div>
        <div className="settings-section">
          <div className="play-eyebrow">At the table</div>
          <div className="panel-facts" data-testid="lobby-members">
            {table.members.map((member) => (member.id === table.host ? `${member.name} (host)` : member.name)).join(' · ')}
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
