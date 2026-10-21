/**
 * Chat at the table (`docs/SERVER.md`, phase 6, slice 5; `shared-game.ts`, `chat` and `say`): what everybody at a
 * shared game has said, oldest first, and a line to say more (`ChatBox.tsx`). In the lobby it is a section of the
 * lobby's sheet (`inLobby`); once the game has started, a box in the panel above the log. Nothing at a game nobody
 * shares.
 */

import { useEffect, useState } from 'preact/hooks';
import { chat, onChat, onSharedTable, playingAs, say, sharedTable } from '../shared-game';
import { ChatBox } from './ChatBox';

export function Chat(props: { inLobby?: boolean }): preact.JSX.Element | null {
  const [table, setTable] = useState(sharedTable());
  const [lines, setLines] = useState(chat());
  useEffect(() => onSharedTable(setTable), []);
  useEffect(() => onChat(setLines), []);
  if (table === null || (props.inLobby !== true && !table.started)) return null;

  return (
    <ChatBox
      lines={lines.map((line, i) => ({ key: `${line.at}-${i}`, from: line.from, name: line.name, text: line.text }))}
      you={playingAs()}
      say={say}
      className={props.inLobby === true ? 'chat is-lobby' : 'play-box panel-box chat'}
      buttonClass="play-btn is-ghost"
      placeholder="Say something to the table"
      empty="Nothing said yet."
    />
  );
}
