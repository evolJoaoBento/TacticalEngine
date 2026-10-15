/**
 * A box of things said, oldest first, and a line to say more: what is said at a shared game's table (`Chat.tsx`) and
 * what friends write each other (`FriendMessages.tsx`). It keeps the newest line in view, and shows why a line was
 * refused until the next is typed; what is said, and to whom, is its caller's.
 */

import { useState } from 'preact/hooks';
import './chat.css';

/** A line as the box shows it: who said it (their id and name), and what. */
export interface SaidLine {
  key: string;
  from: string;
  name: string;
  text: string;
}

/** How many lines the box shows: the newest. */
const SHOWN = 50;

export function ChatBox(props: {
  lines: SaidLine[];
  /** Whose lines are this player's own. */
  you: string | null;
  /** Something said: `null` once it has been, or why not. */
  say: (text: string) => Promise<string | null>;
  className: string;
  buttonClass: string;
  placeholder: string;
  empty: string;
  /** The box's own test id; its parts' are the same everywhere (`chat-line`, `chat-input`...). */
  testid?: string;
}): preact.JSX.Element {
  const [text, setText] = useState('');
  const [refused, setRefused] = useState<string | null>(null);

  const send = async (): Promise<void> => {
    const said = text.trim();
    if (said === '') return;
    const why = await props.say(said);
    setRefused(why);
    if (why === null) setText('');
  };

  return (
    <div className={props.className} data-testid={props.testid ?? 'chat'}>
      <div
        className="chat-lines"
        // The newest line is the one being read; keep it in view.
        ref={(el) => {
          if (el !== null) el.scrollTop = el.scrollHeight;
        }}
      >
        {props.lines.length === 0 ? <div className="panel-sub">{props.empty}</div> : null}
        {props.lines.slice(-SHOWN).map((line) => (
          <div key={line.key} className={line.from === props.you ? 'chat-line is-yours' : 'chat-line'} data-testid="chat-line" data-from={line.from}>
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
          placeholder={props.placeholder}
          value={text}
          maxLength={500}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setRefused(null);
          }}
        />
        <button type="submit" className={props.buttonClass} data-testid="chat-send" disabled={text.trim() === ''}>
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
