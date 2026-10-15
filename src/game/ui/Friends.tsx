/**
 * A player's friends, from the main menu (`friends.ts`; the server's `friends.rs`): asking somebody by name, the
 * requests they have been sent - accepted or declined - the ones they sent, which they may take back, and their
 * friends, any of whom they may remove.
 */

import { useEffect, useState } from 'preact/hooks';
import { answerFriend, askFriend, readFriends, removeFriend, type FriendsView } from '../friends';
import './menu.css';

export function Friends(props: { onBack: () => void; onChange?: (view: FriendsView) => void }): preact.JSX.Element {
  const [view, setView] = useState<FriendsView | null>(null);
  const [name, setName] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const took = (next: FriendsView): void => {
    setView(next);
    props.onChange?.(next);
  };
  useEffect(() => {
    void readFriends().then((read) => {
      if (read !== null) took(read);
    });
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
                <li key={person.id} data-person={person.id} data-testid="friend">
                  <b>{person.name}</b>
                  <button type="button" className="menu-link" data-testid="friend-remove" onClick={() => void act(removeFriend(person.id))}>
                    Remove
                  </button>
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
