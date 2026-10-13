/**
 * Who is at the game, in the settings beside the saves (`docs/SERVER.md`, phase 5, slice 3): the invitation a
 * friend opens to join it, everybody at it, and who plays each character - the host's to choose, everybody's to
 * see. Nothing at all where the page plays with no server, which has no table (`shared-game.ts`).
 */

import { useEffect, useState } from 'preact/hooks';
import { hosting, invitationLink, onSharedTable, seat, seatable, sharedTable } from '../shared-game';

export function Players(): preact.JSX.Element | null {
  const [table, setTable] = useState(sharedTable());
  const [copied, setCopied] = useState(false);
  useEffect(() => onSharedTable(setTable), []);
  if (table === null) return null;
  const host = hosting();
  const link = invitationLink(table.invite);
  return (
    <div className="settings-players" data-testid="players">
      <div className="play-eyebrow">Players</div>
      <div className="panel-row" style={{ gap: '4px' }}>
        <input className="players-invite" readOnly value={link} data-testid="invite-link" title="Send this to a friend to join the game" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="play-btn is-ghost"
          data-testid="invite-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="panel-facts" data-testid="players-members">
        {table.members.map((member) => (member.id === table.host ? `${member.name} (host)` : member.name)).join(' · ')}
      </div>
      {seatable().map((character) => (
        <label key={character.id} className="panel-row players-seat">
          <span style={{ flex: 1 }}>{character.name}</span>
          <select
            data-testid="seat"
            data-character={character.id}
            disabled={!host}
            title={host ? 'Who plays this character' : 'The host says who plays whom'}
            value={table.seats[character.id] ?? ''}
            onChange={(e) => void seat(character.id, e.currentTarget.value === '' ? null : e.currentTarget.value)}
          >
            <option value="">Nobody</option>
            {table.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
