/**
 * The main menu: what the page opens on (`game/start.ts`).
 *
 *   New Game    make a character, card by card, and begin a camp of your own (`NewGame.tsx`)
 *   Load Game   the game, played: the demo from the start or from a save, or a game you began and
 *               any save of it - never the editor
 *   Edit Game   the project with the editor, as the app has always opened
 *   (Change password, beside Sign out, for whoever is signed in: `ChangePassword.tsx`.)
 *   (Invite, beside them: the player's own invitation for somebody new, and admin's players: `Invitations.tsx`.)
 *   (Friends, beside them too, with how many are asking: `Friends.tsx`.)
 *   Store       art creators have published, with how they made it, and a vote on it (`Store.tsx`) -
 *               for whoever is signed in
 *   Play Together  where the server plays the game: the games you may join, no link needed - public ones, your
 *               friends' friends-only ones, and any keeping a seat for you (`joinable-games.ts`) - another's
 *               joined with the link its host sent (`?join=`), or any game Load Game lists, or a save of it,
 *               hosted - opened as a lobby others gather in before it starts (`?host=`, `Lobby.tsx`), found
 *               by whoever you say: everybody, your friends, or only those you send the link
 *
 * Every choice opens the page again with it written in the address, so a game starts on a clean
 * page. Saves are listed under the game they are of (`SaveSlot.project`), and are the signed-in
 * player's own (`browserStore`, `accounts.ts`); who that is, and Sign out, head the card.
 */

import { useEffect, useState } from 'preact/hooks';
import { GameProjects } from '../game-projects';
import { DEFAULT_SAVE_PROJECT, SaveSlots, browserStore, projectOfSlot, type SaveSlot } from '../save-slots';
import { NewGame } from './NewGame';
import type { SignedIn } from '../accounts';
import { Store } from './Store';
import { ChangePassword } from './ChangePassword';
import { Invitations } from './Invitations';
import { Friends } from './Friends';
import { readFriends } from '../friends';
import { listAccountSaves } from '../account-saves';
import { serverAllowed } from '../play-socket';
import { inviteFrom } from '../shared-game';
import { joinableLine, joinableSummary, listJoinable, type JoinableGame } from '../joinable-games';
import type { Visibility } from '../wire';
import './menu.css';

/** Open the page again, on what was chosen. */
export function openPage(query: string): void {
  window.location.assign(`${window.location.pathname}?${query}`);
}

const when = (at: number): string => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Saves({ saves, open }: { saves: SaveSlot[]; open: (slot: string) => void }): preact.JSX.Element | null {
  if (saves.length === 0) return null;
  return (
    <ul className="menu-saves">
      {saves.map((slot) => (
        <li key={slot.id} data-save={slot.id}>
          <button type="button" className="menu-save" data-testid="menu-load-save" onClick={() => open(slot.id)}>
            <b>{slot.name}</b>
            <span>{slot.where} · {when(slot.savedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MainMenu(props: { account?: SignedIn | null; onSignOut?: () => void }): preact.JSX.Element {
  const [view, setView] = useState<'main' | 'load' | 'new' | 'store' | 'together' | 'password' | 'invite' | 'friends'>('main');
  const [joining, setJoining] = useState('');
  const [joinRefused, setJoinRefused] = useState(false);
  const account = props.account ?? null;
  // How many players are asking to be friends, for the account's line.
  const [asking, setAsking] = useState(0);
  useEffect(() => {
    if (account !== null) void readFriends().then((read) => setAsking(read?.asking.length ?? 0));
  }, [account?.id]);
  const games = new GameProjects(browserStore());
  // The browser's saves - or, signed in where the server plays the game, the account's, kept there.
  const onServer = account !== null && serverAllowed();
  const [saves, setSaves] = useState<SaveSlot[]>(() => (onServer ? [] : new SaveSlots(browserStore()).list()));
  useEffect(() => {
    if (!onServer) return;
    void listAccountSaves(account.id).then((listed) => setSaves(listed ?? new SaveSlots(browserStore()).list()));
  }, [account?.id, onServer]);
  // The games this player may join without the link: those they may find, and those keeping a seat for them.
  const [joinable, setJoinable] = useState<JoinableGame[]>([]);
  useEffect(() => {
    if (onServer) void listJoinable().then(setJoinable);
  }, [account?.id, onServer]);
  // Who may find a game hosted from here.
  const [findable, setFindable] = useState<Visibility>('friends');
  const savesOf = (project: string): SaveSlot[] => saves.filter((slot) => projectOfSlot(slot) === project);
  // Every game, and the saves of each, opened as chosen - hosted for friends too (`?host`) from Play Together.
  const gameList = (also: string): preact.JSX.Element[] => [
    ...games.list().map((game) => (
      <section key={game.id} className="menu-game" data-game={game.id}>
        <header>
          <h2>{game.name}</h2>
          <button type="button" className="menu-go" data-testid="menu-continue" onClick={() => openPage(`play&project=${encodeURIComponent(game.id)}${also}`)}>
            Continue
          </button>
        </header>
        <Saves saves={savesOf(game.id)} open={(slot) => openPage(`play&project=${encodeURIComponent(game.id)}&load=${encodeURIComponent(slot)}${also}`)} />
      </section>
    )),
    <section key={DEFAULT_SAVE_PROJECT} className="menu-game" data-game={DEFAULT_SAVE_PROJECT}>
      <header>
        <h2>The Demo Vault</h2>
        <button type="button" className="menu-go" data-testid="menu-play-demo" onClick={() => openPage(`play${also}`)}>
          From the start
        </button>
      </header>
      <Saves saves={savesOf(DEFAULT_SAVE_PROJECT)} open={(slot) => openPage(`play&load=${encodeURIComponent(slot)}${also}`)} />
    </section>,
  ];
  const join = (): void => {
    const invite = inviteFrom(joining);
    if (invite === null) setJoinRefused(true);
    else openPage(`join=${encodeURIComponent(invite)}`);
  };

  return (
    <div className="menu" data-testid="main-menu">
      {view === 'new' ? (
        <NewGame onBack={() => setView('main')} games={games} />
      ) : view === 'store' && account !== null ? (
        <Store account={account} onBack={() => setView('main')} />
      ) : (
        <div className="menu-card">
          {account === null ? null : (
            <p className="menu-account" data-testid="menu-account">
              Signed in as <b>{account.name}</b>{account.admin ? ' (admin)' : ''} ·{' '}
              <button type="button" className="menu-link" data-testid="menu-friends" onClick={() => setView('friends')}>{asking === 0 ? 'Friends' : `Friends (${asking})`}</button> ·{' '}
              <button type="button" className="menu-link" data-testid="menu-invite" onClick={() => setView('invite')}>Invite</button> ·{' '}
              <button type="button" className="menu-link" data-testid="menu-password" onClick={() => setView('password')}>Change password</button> ·{' '}
              <button type="button" className="menu-link" data-testid="menu-sign-out" onClick={props.onSignOut}>Sign out</button>
            </p>
          )}
          <h1 className="menu-title">Tactical Engine</h1>
          {view === 'password' && account !== null ? (
            <ChangePassword onBack={() => setView('main')} />
          ) : view === 'friends' && account !== null ? (
            <Friends onBack={() => setView('main')} onChange={(read) => setAsking(read.asking.length)} />
          ) : view === 'invite' && account !== null ? (
            <Invitations account={account} onBack={() => setView('main')} />
          ) : view === 'main' ? (
            <>
              <p className="menu-sub">A party, a table, and whatever waits in the dark.</p>
              <nav className="menu-choices">
                <button type="button" className="menu-choice is-first" data-testid="menu-new" onClick={() => setView('new')}>
                  New Game<small>Make a character and begin at your camp</small>
                </button>
                <button type="button" className="menu-choice" data-testid="menu-load" onClick={() => setView('load')}>
                  Load Game<small>Play on from where you left off</small>
                </button>
                <button type="button" className="menu-choice" data-testid="menu-edit" onClick={() => openPage('edit')}>
                  Edit Game<small>The editor: rooms, creatures, cards and all</small>
                </button>
                {onServer ? (
                  <button type="button" className="menu-choice" data-testid="menu-together" onClick={() => setView('together')}>
                    Play Together<small>{joinableSummary(joinable) ?? 'Host a game for friends, or join theirs'}</small>
                  </button>
                ) : null}
                {account === null ? null : (
                  <button type="button" className="menu-choice" data-testid="menu-store" onClick={() => setView('store')}>
                    Store<small>Art from its makers, and how they made it</small>
                  </button>
                )}
              </nav>
            </>
          ) : view === 'together' ? (
            <div className="menu-load" data-testid="menu-together-list">
              {joinable.map((game) => (
                <section key={game.invite} className="menu-game menu-join" data-testid="menu-joinable" data-visibility={game.visibility}>
                  <header>
                    <h2>{game.project === '' ? 'A game' : game.project}</h2>
                    <button type="button" className="menu-go" data-testid="menu-joinable-join" onClick={() => openPage(`join=${encodeURIComponent(game.invite)}`)}>
                      Join
                    </button>
                  </header>
                  <p className="menu-waiting-line">{joinableLine(game)}</p>
                </section>
              ))}
              <section className="menu-game menu-join">
                <header>
                  <h2>Join a game</h2>
                </header>
                <form
                  className="menu-join-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    join();
                  }}
                >
                  <input
                    data-testid="menu-join-link"
                    placeholder="The link your host sent"
                    value={joining}
                    onInput={(e) => {
                      setJoining(e.currentTarget.value);
                      setJoinRefused(false);
                    }}
                  />
                  <button type="submit" className="menu-go" data-testid="menu-join">
                    Join
                  </button>
                </form>
                {joinRefused ? <p className="menu-join-refused" data-testid="menu-join-refused">That is not an invitation: paste the whole link your host sent.</p> : null}
              </section>
              <p className="menu-sub">Or host one: others join it, take their seats, and you start it together.</p>
              <label className="menu-field menu-findable">
                Who can find it
                <select data-testid="menu-findable" value={findable} onChange={(e) => setFindable(e.currentTarget.value as Visibility)}>
                  <option value="friends">Your friends</option>
                  <option value="public">Everybody</option>
                  <option value="invite">Only those you send the link</option>
                </select>
              </label>
              {gameList(`&host=${findable}`)}
              <button type="button" className="menu-back" data-testid="menu-back" onClick={() => setView('main')}>
                Back
              </button>
            </div>
          ) : (
            <div className="menu-load" data-testid="menu-load-list">
              {gameList('')}
              <button type="button" className="menu-back" data-testid="menu-back" onClick={() => setView('main')}>
                Back
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
