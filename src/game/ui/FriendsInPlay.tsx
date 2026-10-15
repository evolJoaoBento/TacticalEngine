/**
 * A player's friends during a game (`docs/SERVER.md`, phase 6): the menu's (`Friends.tsx`) - asking, answering, and
 * writing to them (`FriendMessages.tsx`) - on a sheet over the table, opened from a button above the table's chat
 * that says how many are asking and how much they have written unread, asked again at once when a friend asks, answers
 * or writes (`onFriendDid`, the game's connection telling it) and every few seconds besides (`FRIENDS_EVERY`) while the
 * sheet is shut. Escape shuts the sheet. Nothing where the page plays as nobody on the server (`friends.ts`, `playAs`).
 */

import { useEffect, useState } from 'preact/hooks';
import { FRIENDS_EVERY, onFriendDid, onPlayingAs, playingAs, readFriends, unreadOf, type FriendsView } from '../friends';
import { Friends } from './Friends';
import './chat.css';

export function FriendsInPlay(): preact.JSX.Element | null {
  const [you, setYou] = useState(playingAs());
  const [view, setView] = useState<FriendsView | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => onPlayingAs(setYou), []);
  // Asked again at once when a friend does something (`onFriendDid`), and every few seconds besides, while the sheet
  // is shut; open, the friends' list asks, and says.
  useEffect(() => {
    if (you === null || open) return;
    const ask = (): void => {
      void readFriends().then((read) => {
        if (read !== null) setView(read);
      });
    };
    ask();
    const every = setInterval(ask, FRIENDS_EVERY);
    const stop = onFriendDid(ask);
    return () => {
      clearInterval(every);
      stop();
    };
  }, [you?.id, open]);
  // Escape shuts the sheet, and nothing behind it hears the key (`SettingsModal.tsx`, `ESCAPE_IS_TAKEN`).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  if (you === null) return null;
  const waiting = (view?.asking.length ?? 0) + unreadOf(view);

  return (
    <>
      <div className="play-friends">
        <button type="button" className={waiting === 0 ? 'play-btn' : 'play-btn is-waiting'} data-testid="play-friends" title="Your friends, and what they have written" onClick={() => setOpen(true)}>
          {waiting === 0 ? 'Friends' : `Friends (${waiting})`}
        </button>
      </div>
      {open ? (
        <div className="settings-backdrop" data-testid="friends-sheet" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="play-box settings-sheet" role="dialog" aria-modal="true" aria-label="Friends" onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
            <div className="settings-head">
              <h2>Friends</h2>
            </div>
            <Friends you={you} onBack={() => setOpen(false)} onChange={setView} />
          </div>
        </div>
      ) : null}
    </>
  );
}
