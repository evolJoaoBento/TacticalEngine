/**
 * What a player and a friend write each other (`docs/SERVER.md`, phase 6, slice 6; `friends.ts`): the conversation,
 * asked for again every few seconds while it is open (`CONVERSATION_EVERY` - nothing pushes it outside a game), read
 * up to its newest as it is shown, and a line to write more (`ChatBox.tsx`); whether the friend is around beside
 * their name.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { CONVERSATION_EVERY, presenceWord, readConversation, readUpTo, writeTo, type Conversation, type FriendsView, type Person, type Presence } from '../friends';
import { ChatBox } from './ChatBox';

export function FriendMessages(props: { friend: Person; you: Person; presence?: Presence | undefined; onBack: () => void; onRead: (view: FriendsView) => void }): preact.JSX.Element {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  // Nothing to read: no longer friends, or no server to ask.
  const [gone, setGone] = useState(false);
  // The newest message shown, and read; and whether anything has been.
  const conversationShown = useRef(false);
  const newest = useRef<number | undefined>(undefined);
  const shown = (next: Conversation): void => {
    setConversation(next);
    newest.current = next.messages.at(-1)?.n;
    if (newest.current === undefined) return;
    void readUpTo(props.friend.id, newest.current).then((view) => {
      if (!('refused' in view)) props.onRead(view);
    });
  };
  useEffect(() => {
    const ask = (): void => {
      void readConversation(props.friend.id).then((read) => {
        setGone(read === null);
        // Shown, and read, again only when something came.
        if (read !== null && (conversationShown.current === false || read.messages.at(-1)?.n !== newest.current)) {
          conversationShown.current = true;
          shown(read);
        }
      });
    };
    ask();
    const every = setInterval(ask, CONVERSATION_EVERY);
    return () => clearInterval(every);
  }, [props.friend.id]);

  const say = async (text: string): Promise<string | null> => {
    const written = await writeTo(props.friend.id, text);
    if ('refused' in written) return written.refused;
    shown(written);
    return null;
  };
  const nameOf = (id: string): string => (id === props.you.id ? props.you.name : props.friend.name);

  return (
    <section className="menu-game" data-testid="friend-messages" data-person={props.friend.id}>
      <header>
        <h2>
          {props.friend.name}
          {presenceWord(props.presence) === null ? null : (
            <span className="menu-presence" data-testid="friend-messages-presence">
              {' '}
              · {presenceWord(props.presence)}
            </span>
          )}
        </h2>
        <button type="button" className="menu-link" data-testid="friend-messages-back" onClick={props.onBack}>
          All friends
        </button>
      </header>
      {gone ? (
        <p className="menu-waiting-line" data-testid="friend-messages-gone">
          Nothing to read: you are not friends, or the server cannot be reached.
        </p>
      ) : conversation === null ? null : (
        <ChatBox
          lines={conversation.messages.map((m) => ({ key: String(m.n), from: m.from, name: nameOf(m.from), text: m.text }))}
          you={props.you.id}
          say={say}
          className="chat is-friend"
          buttonClass="menu-go"
          placeholder={`Write to ${props.friend.name}`}
          empty="Nothing written yet."
          testid="friend-chat"
        />
      )}
    </section>
  );
}
