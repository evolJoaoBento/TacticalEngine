/**
 * The main menu: what the page opens on (`game/start.ts`).
 *
 *   New Game    make a character, card by card, and begin a camp of your own (`NewGame.tsx`)
 *   Load Game   the game, played: the demo from the start or from a save, or a game you began and
 *               any save of it - never the editor
 *   Edit Game   the project with the editor, as the app has always opened
 *   Store       art creators have published, with how they made it, and a vote on it (`Store.tsx`) -
 *               for whoever is signed in
 *
 * Every choice opens the page again with it written in the address, so a game starts on a clean
 * page. Saves are listed under the game they are of (`SaveSlot.project`), and are the signed-in
 * player's own (`browserStore`, `accounts.ts`); who that is, and Sign out, head the card.
 */

import { useState } from 'preact/hooks';
import { GameProjects } from '../game-projects';
import { DEFAULT_SAVE_PROJECT, SaveSlots, browserStore, projectOfSlot, type SaveSlot } from '../save-slots';
import { NewGame } from './NewGame';
import type { SignedIn } from '../accounts';
import { Store } from './Store';
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
  const [view, setView] = useState<'main' | 'load' | 'new' | 'store'>('main');
  const account = props.account ?? null;
  const games = new GameProjects(browserStore());
  const saves = new SaveSlots(browserStore()).list();
  const savesOf = (project: string): SaveSlot[] => saves.filter((slot) => projectOfSlot(slot) === project);

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
              <button type="button" className="menu-link" data-testid="menu-sign-out" onClick={props.onSignOut}>Sign out</button>
            </p>
          )}
          <h1 className="menu-title">Tactical Engine</h1>
          {view === 'main' ? (
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
                {account === null ? null : (
                  <button type="button" className="menu-choice" data-testid="menu-store" onClick={() => setView('store')}>
                    Store<small>Art from its makers, and how they made it</small>
                  </button>
                )}
              </nav>
            </>
          ) : (
            <div className="menu-load" data-testid="menu-load-list">
              {games.list().map((game) => (
                <section key={game.id} className="menu-game" data-game={game.id}>
                  <header>
                    <h2>{game.name}</h2>
                    <button type="button" className="menu-go" data-testid="menu-continue" onClick={() => openPage(`play&project=${encodeURIComponent(game.id)}`)}>
                      Continue
                    </button>
                  </header>
                  <Saves saves={savesOf(game.id)} open={(slot) => openPage(`play&project=${encodeURIComponent(game.id)}&load=${encodeURIComponent(slot)}`)} />
                </section>
              ))}
              <section className="menu-game" data-game={DEFAULT_SAVE_PROJECT}>
                <header>
                  <h2>The Demo Vault</h2>
                  <button type="button" className="menu-go" data-testid="menu-play-demo" onClick={() => openPage('play')}>
                    From the start
                  </button>
                </header>
                <Saves saves={savesOf(DEFAULT_SAVE_PROJECT)} open={(slot) => openPage(`play&load=${encodeURIComponent(slot)}`)} />
              </section>
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
