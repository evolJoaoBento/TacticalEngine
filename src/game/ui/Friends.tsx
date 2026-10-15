/**
 * A player's friends, from the main menu (`friends.ts`; the server's `friends.rs`): asking somebody by name, the
 * requests they have been sent - accepted or declined - the ones they sent, which they may take back, and their
 * friends, any of whom they may remove or write to (`FriendMessages.tsx`), each with how much they have written
 * unread and whether they are around - in a game, or online; asked again every few seconds (`FRIENDS_EVERY`), for
 * what has come since - and at a game at once when a friend does something (`onFriendDid`).
 */

import { useEffect, useState } from 'preact/hooks';
import { FRIENDS_EVERY, answerFriend, onFriendDid, askFriend, presenceWord, readFriends, removeFriend, unreadOf, type FriendsView, type Person } from '../friends';
import { FriendMessages } from './FriendMessages';
import './menu.css';

export function Friends(props: { you: Person; onBack: () => void; onChange?: (view: FriendsView) => void }): preact.JSX.Element {
  const [view, setView] = useState<FriendsView | null>(null);
  const [name, setName] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  // The friend being written to, if any.
  const [talking, setTalking] = useState<Person | null>(null);
  const took = (next: FriendsView): void => {
    setView(next);
    props.onChange?.(next);
  };
  useEffect(() => {
    const ask = (): void => {
      void readFriends().then((read) => {
        if (read !== null) took(read);
      });
    };
    ask();
    const every = setInterval(ask, FRIENDS_EVERY);
    // At a game, asked again at once when a friend does something.
    const stop = onFriendDid(ask);
    return () => {
      clearInterval(every);
      stop();
    };
  }, []);
  const act = async (done: Promise<FriendsView | { refused: string }>): Promise<boolean> => {
    const answer = await done;
    if ('refused' in answer) {
      setRefused(answer.refused);
      return false;
    }
    setRefused(null);
    took(answer);
    return true;
  };

  if (talking !== null) {
    return (
      <div className="menu-load" data-testid="friends">
        <FriendMessages friend={talking} you={props.you} presence={view?.online[talking.id]} onBack={() => setTalking(null)} onRead={took} />
        <button type="button" className="menu-back" data-testid="menu-back" onClick={props.onBack}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="menu-load" data-testid="friends">
      <section className="menu-game menu-join">
        <header>
          <h2>Ask a friend</h2>
        </header>
        <form
          className="menu-join-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() !== '') void act(askFriend(name.trim())).then((asked) => asked && setName(''));
          }}
        >
          <input data-testid="friend-name" placeholder="Their name" value={name} maxLength={24} onInput={(e) => setName(e.currentTarget.value)} />
          <button type="submit" className="menu-go" data-testid="friend-ask">
            Ask
          </button>
        </form>
        {refused === null ? null : (
          <p className="menu-join-refused" role="alert" data-testid="friend-refused">
            {refused}
          </p>
        )}
      </section>
      {view === null ? null : (
        <>
          {view.asking.length === 0 ? null : (
            <section className="menu-game" data-testid="friends-asking">
              <header>
                <h2>Asking you</h2>
              </header>
              <ul className="menu-players">
                {view.asking.map((person) => (
                  <li key={person.id} data-person={person.id}>
                    <b>{person.name}</b>
                    <span>
                      <button type="button" className="menu-link" data-testid="friend-accept" onClick={() => void act(answerFriend(person.id, true))}>
                        Accept
                      </button>{' '}
                      ·{' '}
                      <button type="button" className="menu-link" data-testid="friend-decline" onClick={() => void act(answerFriend(person.id, false))}>
                        Decline
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="menu-game" data-testid="friends-list">
            <header>
              <h2>Friends</h2>
            </header>
            {view.friends.length === 0 && view.asked.length === 0 ? <p className="menu-waiting-line">None yet: ask somebody by their name.</p> : null}
            <ul className="menu-players">
              {view.friends.map((person) => (
                <li key={person.id} data-person={person.id} data-testid="friend" data-presence={view.online[person.id] ?? 'away'}>
                  <span>
                    <b>{person.name}</b>
                    {presenceWord(view.online[person.id]) === null ? null : (
                      <span className="menu-presence" data-testid="friend-presence">
                        {' '}
                        · {presenceWord(view.online[person.id])}
                      </span>
                    )}
                  </span>
                  <span>
                    <button type="button" className="menu-link" data-testid="friend-write" onClick={() => setTalking(person)}>
                      {unreadOf(view, person.id) === 0 ? 'Messages' : `Messages (${unreadOf(view, person.id)})`}
                    </button>{' '}
                    ·{' '}
                    <button type="button" className="menu-link" data-testid="friend-remove" onClick={() => void act(removeFriend(person.id))}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
              {view.asked.map((person) => (
                <li key={person.id} data-person={person.id} data-testid="friend-asked">
                  <span>
                    <b>{person.name}</b> · asked
                  </span>
                  <button type="button" className="menu-link" data-testid="friend-take-back" onClick={() => void act(removeFriend(person.id))}>
                    Take back
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <button type="button" className="menu-back" data-testid="menu-back" onClick={props.onBack}>
        Back
      </button>
    </div>
  );
}
