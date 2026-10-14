/**
 * What the page opens on: the main menu, or a game, and in which of the two ways a game is played.
 *
 * The page opens on the main menu, and each of its choices opens the page again with what was
 * chosen written in the address, so a game always starts from a clean page:
 *
 *   ?edit                    Edit Game: the project, with the editor (Ctrl+E) - what the app always was
 *   ?play                    Load Game: the same, played - no editor, no Ctrl+E
 *   ?project=<id>            a game New Game began, from this browser (`game-projects.ts`), played
 *   ?load=<slot>             and a save of it loaded as it opens
 *   ?join=<invitation>       another's game on the server, joined: its project, played (`shared-game.ts`)
 *   ?invite=<code>           a player's invitation: the sign-in card starts on making an account with it (`accounts.ts`)
 *   ?host                    and the game opened for others to join, as a lobby they gather in before it starts
 *   ?menu                    the menu, whatever else is asked
 *
 * A server started for the tests (`TACTICAL_BOOT=builtin`) opens straight on the game, as every
 * suite expects; `?menu` is how the menu's own tests reach it. So does any address that already asks
 * for a way to open (`?boot=`).
 */

import { h, render } from 'preact';
import { BOOT } from 'virtual:boot-project';
import { MainMenu } from './ui/MainMenu';
import { SignIn } from './ui/SignIn';
import { invitationOf } from './shared-game';
import { invitationCodeOf, rememberUser, signOut, whoAmI, type SignedIn } from './accounts';
import { useState } from 'preact/hooks';
import { CardArtImports, loadCardArtIndex, useCardArtImports, useCardArtIndex } from './ui/card-art';
import { sharedBrowserStore } from './save-slots';

export interface Start {
  /** Open on the main menu instead of a game. */
  menu: boolean;
  /** Played only: the editor is not there to open. */
  locked: boolean;
  /** Open in the editor. */
  edit: boolean;
  /** A save to load as it opens. */
  load: string | null;
}

export function startOf(search: string = globalThis.location?.search ?? '', boot: 'file' | 'builtin' = BOOT): Start {
  const asked = new URLSearchParams(search);
  const chosen = ['edit', 'play', 'project', 'load', 'boot', 'join', 'host'].some((key) => asked.has(key));
  return {
    menu: asked.has('menu') || (boot !== 'builtin' && !chosen),
    locked: asked.has('play') || asked.has('project') || asked.has('join') || asked.has('host'),
    edit: asked.has('edit'),
    load: asked.get('load'),
  };
}

/**
 * Put the main menu up in place of the game, and never return: whatever is chosen opens the page
 * again. The loading curtain is the game's, and goes.
 */
export async function showMainMenu(): Promise<never> {
  // New Game deals cards, so it needs the card art the game reads at boot - which the menu comes before.
  useCardArtImports(new CardArtImports(sharedBrowserStore()));
  useCardArtIndex(await loadCardArtIndex());
  // Who is signed in: an account, nobody (sign in first), or - a server that keeps no accounts - play as
  // anybody, as the menu always did.
  const who = await whoAmI();
  if (who === null) rememberUser(null);
  else if (who !== 'none') rememberUser(who.id);
  document.getElementById('curtain')?.remove();
  render(h(MenuGate, { first: who }), document.getElementById('app')!);
  return new Promise<never>(() => undefined);
}

/**
 * A page opened with a game's invitation (`?join=`) while nobody is signed in, where the server keeps accounts:
 * the sign-in card first - starting on making an account when a player's invitation came with it (`?invite=`) -
 * and then the page opened again, signed in, to join. Returns at once for anybody signed in, or a server that
 * keeps no accounts.
 */
export async function signInToJoin(): Promise<void> {
  if (invitationOf() === null || (await whoAmI()) !== null) return;
  document.getElementById('curtain')?.remove();
  render(h(SignIn, { invite: invitationCodeOf(), joining: true, onSignedIn: () => window.location.reload() }), document.getElementById('app')!);
  return new Promise<never>(() => undefined);
}

/** The address without a player's invitation, once it has made an account or met somebody signed in. */
function forgetInvitationCode(): void {
  const asked = new URLSearchParams(window.location.search);
  if (!asked.has('invite')) return;
  asked.delete('invite');
  const rest = asked.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${rest === '' ? '' : `?${rest}`}`);
}

/** The sign-in card until somebody is signed in, and then the menu - theirs. */
function MenuGate(props: { first: SignedIn | null | 'none' }): preact.JSX.Element {
  const [account, setAccount] = useState<SignedIn | null | 'none'>(props.first);
  if (account === null) return h(SignIn, { invite: invitationCodeOf(), onSignedIn: setAccount });
  forgetInvitationCode();
  if (account === 'none') return h(MainMenu, { account: null });
  return h(MainMenu, {
    account,
    onSignOut: () => {
      void signOut().then(() => setAccount(null));
    },
  });
}
