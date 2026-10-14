/**
 * Who is at the game, in the settings beside the saves (`docs/SERVER.md`, phase 5, slice 3): the invitation a
 * friend opens to join it, everybody at it, and who plays each character - the host's to choose, everybody's to
 * see. Nothing at all where the page plays with no server, which has no table (`shared-game.ts`). The lobby shows
 * the same invitation and seats before a game starts (`Lobby.tsx`).
 */

import { useEffect, useState } from 'preact/hooks';
import type { SharedTable } from '../wire';
import { hosting, invitationLink, onSharedTable, seat, seatable, sharedTable } from '../shared-game';

/** The invitation's address, to select or copy. */
export function InviteRow({ link, testid = 'invite-link' }: { link: string; testid?: string }): preact.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="panel-row" style={{ gap: '4px' }}>
      <input className="players-invite" readOnly value={link} data-testid={testid} title="Send this to a friend to join the game" onFocus={(e) => e.currentTarget.select()} />
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
  );
}

/** Who plays a character, as the host chooses it: nobody, or anybody at the game. */
export function SeatSelect({ character, table, host }: { character: string; table: SharedTable; host: boolean }): preact.JSX.Element {
  return (
    <select
      data-testid="seat"
      data-character={character}
      disabled={!host}
      title={host ? 'Who plays this character' : 'The host says who plays whom'}
      value={table.seats[character] ?? ''}
      onChange={(e) => void seat(character, e.currentTarget.value === '' ? null : e.currentTarget.value)}
    >
      <option value="">Nobody</option>
      {table.members.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}
        </option>
      ))}
    </select>
  );
}

export function Players(): preact.JSX.Element | null {
  const [table, setTable] = useState(sharedTable());
  useEffect(() => onSharedTable(setTable), []);
  if (table === null) return null;
  const host = hosting();
  return (
    <div className="settings-players" data-testid="players">
      <div className="play-eyebrow">Players</div>
      <InviteRow link={invitationLink(table.invite)} />
      <div className="panel-facts" data-testid="players-members">
        {table.members.map((member) => (member.id === table.host ? `${member.name} (host)` : member.name)).join(' · ')}
      </div>
      {seatable().map((character) => (
        <label key={character.id} className="panel-row players-seat">
          <span style={{ flex: 1 }}>{character.name}</span>
          <SeatSelect character={character.id} table={table} host={host} />
        </label>
      ))}
    </div>
  );
}
