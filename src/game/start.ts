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
import { rememberUser, signOut, whoAmI, type SignedIn } from './accounts';
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
  const chosen = ['edit', 'play', 'project', 'load', 'boot'].some((key) => asked.has(key));
  return {
    menu: asked.has('menu') || (boot !== 'builtin' && !chosen),
    locked: asked.has('play') || asked.has('project'),
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

/** The sign-in card until somebody is signed in, and then the menu - theirs. */
function MenuGate(props: { first: SignedIn | null | 'none' }): preact.JSX.Element {
  const [account, setAccount] = useState<SignedIn | null | 'none'>(props.first);
  if (account === null) return h(SignIn, { onSignedIn: setAccount });
  if (account === 'none') return h(MainMenu, { account: null });
  return h(MainMenu, {
    account,
    onSignOut: () => {
      void signOut().then(() => setAccount(null));
    },
  });
}
