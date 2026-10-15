/**
 * Chat at the table (`docs/SERVER.md`, phase 6, slice 5; `shared-game.ts`, `chat` and `say`): what everybody at a
 * shared game has said, oldest first, and a line to say more. In the lobby it is a section of the lobby's sheet
 * (`inLobby`); once the game has started, a box in the panel above the log. Nothing at a game nobody shares.
 */

import { useEffect, useState } from 'preact/hooks';
import { chat, onChat, onSharedTable, playingAs, say, sharedTable } from '../shared-game';

/** How many lines the box shows: the newest. */
const SHOWN = 50;

export function Chat(props: { inLobby?: boolean }): preact.JSX.Element | null {
  const [table, setTable] = useState(sharedTable());
  const [lines, setLines] = useState(chat());
  const [text, setText] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => onSharedTable(setTable), []);
  useEffect(() => onChat(setLines), []);
  if (table === null || (props.inLobby !== true && !table.started)) return null;
  const you = playingAs();

  const send = async (): Promise<void> => {
    const said = text.trim();
    if (said === '') return;
    const why = await say(said);
    setRefused(why);
    if (why === null) setText('');
  };

  return (
    <div className={props.inLobby === true ? 'chat is-lobby' : 'play-box panel-box chat'} data-testid="chat">
      <div
        className="chat-lines"
        // The newest line is the one being read; keep it in view.
        ref={(el) => {
          if (el !== null) el.scrollTop = el.scrollHeight;
        }}
      >
        {lines.length === 0 ? <div className="panel-sub">Nothing said yet.</div> : null}
        {lines.slice(-SHOWN).map((line, i) => (
          <div key={`${line.at}-${i}`} className={line.from === you ? 'chat-line is-yours' : 'chat-line'} data-testid="chat-line" data-from={line.from}>
            <b>{line.name}</b> {line.text}
          </div>
        ))}
      </div>
      <form
        className="chat-say"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          data-testid="chat-input"
          placeholder="Say something to the table"
          value={text}
          maxLength={500}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setRefused(null);
          }}
        />
        <button type="submit" className="play-btn is-ghost" data-testid="chat-send" disabled={text.trim() === ''}>
          Say
        </button>
      </form>
      {refused === null ? null : (
        <div className="panel-sub chat-refused" role="alert" data-testid="chat-refused">
          {refused}
        </div>
      )}
    </div>
  );
}
