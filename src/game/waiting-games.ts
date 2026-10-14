/**
 * The games waiting for the player signed in (`play.rs`, `GET /__play/waiting`): those whose host loaded a save
 * that kept a seat for them, each with its invitation, so a player coming back joins from Play Together without
 * being sent the link again (`MainMenu.tsx`). A friend new to a game still needs the link.
 */

export const WAITING_URL = '/__play/waiting';

export interface WaitingGame {
  invite: string;
  /** The host's name. */
  host: string;
  /** The project's name. */
  project: string;
  /** The names of the characters kept for the player. */
  characters: string[];
  started: boolean;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** The games waiting for whoever is signed in: none when the server says nothing, or cannot be reached. */
export async function listWaiting(send: Fetch = (url, init) => fetch(url, init)): Promise<WaitingGame[]> {
  try {
    const response = await send(WAITING_URL, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return [];
    const { games } = (await response.json()) as { games?: unknown };
    return Array.isArray(games) ? games.filter(isWaiting) : [];
  } catch {
    return [];
  }
}

function isWaiting(game: unknown): game is WaitingGame {
  if (typeof game !== 'object' || game === null) return false;
  const { invite, host, project, characters, started } = game as Record<string, unknown>;
  return typeof invite === 'string' && invite !== '' && typeof host === 'string' && typeof project === 'string' && Array.isArray(characters) && characters.every((name) => typeof name === 'string') && typeof started === 'boolean';
}

/** What a waiting game is called in the menu: whose, and who is kept there. */
export function waitingLine(game: WaitingGame): string {
  const names = game.characters.length < 2 ? game.characters.join('') : `${game.characters.slice(0, -1).join(', ')} and ${game.characters.at(-1)}`;
  return `${game.host} kept ${names} for you${game.started ? ', and has begun' : ''}.`;
}
