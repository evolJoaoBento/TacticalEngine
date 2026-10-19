/**
 * The main menu: what the page opens on (`game/start.ts`).
 *
 *   New Game    make a character, card by card, and begin a camp of your own (`NewGame.tsx`)
 *   Load Game   the game, played: the demo from the start or from a save, or a game you began and
 *               any save of it - never the editor
 *   Edit Game   the project with the editor, as the app has always opened
 *   (Change password, beside Sign out, for whoever is signed in: `ChangePassword.tsx`.)
 *   (Invite, beside them: the player's own invitation for somebody new, and admin's players: `Invitations.tsx`.)
 *   (Friends, beside them too, with how many are asking and how much friends have written unread: `Friends.tsx` -
 *   told at once over the games' socket, opened to listen: `listenForFriends`.)
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
 * player's own (`browserStore`, `accounts.ts`); who that is, and Sign out, head the card. A shared game's
 * save of a game this browser has not got - another's camp - is listed on its own, and opened over the
 * project the server keeps beside it (`?saved=`).
 */

import { useEffect, useState } from 'preact/hooks';
import { GameProjects } from '../game-projects';
import { ASHWELL_ID, ashwellProject } from '../adventures/ashwell';
import { DEFAULT_SAVE_PROJECT, SaveSlots, browserStore, projectOfSlot, type SaveSlot } from '../save-slots';
import { NewGame } from './NewGame';
import type { SignedIn } from '../accounts';
import { Store } from './Store';
import { ChangePassword } from './ChangePassword';
import { Invitations } from './Invitations';
import { Friends } from './Friends';
import { FRIENDS_EVERY, listenForFriends, onFriendDid, readFriends, unreadOf, type FriendsView } from '../friends';
import { listAccountSaves } from '../account-saves';
import { PlaySocket, serverAllowed } from '../play-socket';
import { inviteFrom } from '../shared-game';
import { joinableLine, joinableSummary, listJoinable, type JoinableGame } from '../joinable-games';
import type { Visibility } from '../wire';
import { lastName, nameFrom, LONGEST_NAME } from '../peer/peer-play';
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
  const [view, setView] = useState<'main' | 'load' | 'new' | 'store' | 'together' | 'password' | 'invite' | 'friends' | 'peer'>('main');
  // The name a player goes by at a peer game, which has no accounts (`docs/PEER.md`).
  const [peerName, setPeerName] = useState(lastName() ?? props.account?.name ?? '');
  const [joining, setJoining] = useState('');
  const [joinRefused, setJoinRefused] = useState(false);
  const account = props.account ?? null;
  // How many players are asking to be friends, and how much friends have written unread, for the account's line.
  const [asking, setAsking] = useState(0);
  const waiting = (read: FriendsView | null): void => setAsking((read?.asking.length ?? 0) + unreadOf(read));
  useEffect(() => {
    if (account === null) return;
    const ask = (): void => void readFriends().then(waiting);
    ask();
    const every = setInterval(ask, FRIENDS_EVERY);
    const stop = onFriendDid(ask);
    return () => {
      clearInterval(every);
      stop();
    };
  }, [account?.id]);
  const games = new GameProjects(browserStore());
  // The browser's saves - or, signed in where the server plays the game, the account's, kept there.
  const onServer = account !== null && serverAllowed();
  // Where the server plays, the menu listens for its friends' doings on the games' socket, and is told at once.
  useEffect(() => {
    if (!onServer) return;
    return listenForFriends(() => new PlaySocket());
  }, [account?.id, onServer]);
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
  const savesOf = (project: string, from: SaveSlot[] = saves): SaveSlot[] => from.filter((slot) => projectOfSlot(slot) === project);
  // A shared game's saves of games this browser has not got: opened over the project kept with them.
  const known = new Set([DEFAULT_SAVE_PROJECT, ASHWELL_ID, ...games.list().map((game) => game.id)]);
  const elsewhere = saves.filter((slot) => slot.players !== undefined && !known.has(projectOfSlot(slot)));
  // Every game, and the saves of each, opened as chosen - hosted for friends too (`?host`) from Play Together.
  const gameList = (also: string, from: SaveSlot[] = saves): preact.JSX.Element[] => [
    ...games.list().filter((game) => game.id !== ASHWELL_ID).map((game) => (
      <section key={game.id} className="menu-game" data-game={game.id}>
        <header>
          <h2>{game.name}</h2>
          <button type="button" className="menu-go" data-testid="menu-continue" onClick={() => openPage(`play&project=${encodeURIComponent(game.id)}${also}`)}>
            Continue
          </button>
        </header>
        <Saves saves={savesOf(game.id, from)} open={(slot) => openPage(`play&project=${encodeURIComponent(game.id)}&load=${encodeURIComponent(slot)}${also}`)} />
      </section>
    )),
    // The Ashwell (`docs/ASHWELL.md`): kept as a game of its own, written afresh from this build each time it is opened.
    <section key={ASHWELL_ID} className="menu-game" data-game={ASHWELL_ID}>
      <header>
        <h2>The Ashwell</h2>
        <button type="button" className="menu-go" data-testid="menu-play-ashwell" onClick={() => games.write(ashwellProject()) && openPage(`play&project=${ASHWELL_ID}${also}`)}>
          From the start
        </button>
      </header>
      <Saves saves={savesOf(ASHWELL_ID, from)} open={(slot) => games.write(ashwellProject()) && openPage(`play&project=${ASHWELL_ID}&load=${encodeURIComponent(slot)}${also}`)} />
    </section>,
    <section key={DEFAULT_SAVE_PROJECT} className="menu-game" data-game={DEFAULT_SAVE_PROJECT}>
      <header>
        <h2>The Demo Vault</h2>
        <button type="button" className="menu-go" data-testid="menu-play-demo" onClick={() => openPage(`play${also}`)}>
          From the start
        </button>
      </header>
      <Saves saves={savesOf(DEFAULT_SAVE_PROJECT, from)} open={(slot) => openPage(`play&load=${encodeURIComponent(slot)}${also}`)} />
    </section>,
    ...(elsewhere.length === 0
      ? []
      : [
          <section key="played-together" className="menu-game" data-game="played-together" data-testid="menu-played-together">
            <header>
              <h2>Played together</h2>
            </header>
            <Saves saves={elsewhere} open={(slot) => openPage(`play&saved=${encodeURIComponent(slot)}&load=${encodeURIComponent(slot)}${also}`)} />
          </section>,
        ]),
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
            <Friends you={account} onBack={() => setView('main')} onChange={waiting} />
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
                <button type="button" className="menu-choice" data-testid="menu-peer" onClick={() => setView('peer')}>
                  Peer to Peer<small>Play with friends browser to browser, no server between you</small>
                </button>
                {account === null ? null : (
                  <button type="button" className="menu-choice" data-testid="menu-store" onClick={() => setView('store')}>
                    Store<small>Art from its makers, and how they made it</small>
                  </button>
                )}
              </nav>
            </>
          ) : view === 'peer' ? (
            <div className="menu-load" data-testid="menu-peer-list">
              <label className="menu-field">
                Your name
                <input data-testid="menu-peer-name" maxLength={LONGEST_NAME} placeholder="What the others call you" value={peerName} onInput={(e) => setPeerName(e.currentTarget.value)} />
              </label>
              <section className="menu-game menu-join">
                <header>
                  <h2>Join a game</h2>
                  <button type="button" className="menu-go" data-testid="menu-peer-join" onClick={() => openPage(`peer=join&as=${encodeURIComponent(nameFrom(peerName, 'Guest'))}`)}>
                    Join
                  </button>
                </header>
                <p className="menu-waiting-line">Your host sends you a code; you send a reply back.</p>
              </section>
              <p className="menu-sub">Or host one, the game kept in this browser: you invite each player with a code, they take their seats, and you start it together. Keep this page open while you play.</p>
              {/* The browser's saves: a peer game's host keeps its saves here, whatever a server keeps. */}
              {gameList(`&peer=host&as=${encodeURIComponent(nameFrom(peerName, 'Host'))}`, new SaveSlots(browserStore()).list())}
              <button type="button" className="menu-back" data-testid="menu-back" onClick={() => setView('main')}>
                Back
              </button>
            </div>
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
