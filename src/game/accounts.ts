/**
 * Who is signed in, as the page knows it, and the way to sign in, up and out (`tools/accounts.ts`).
 *
 * The dev server holds the accounts and the session; the page asks it who the session cookie is
 * (`whoAmI`). It also remembers, in this browser, whose games and saves to show (`currentUser`), so a
 * page opened straight into a game - no menu - reads that player's own: `browserStore` in
 * `save-slots.ts` keeps each player's keys apart (`userKey`). Admin keeps the keys everything was kept
 * under before there were accounts, so what was saved then is admin's. Nobody signed in - the tests'
 * server keeps no accounts - is the same: the keys as they always were.
 */

/** Who is signed in, as the server tells it: never a password or a hash. */
export interface SignedIn {
  id: string;
  name: string;
  admin: boolean;
}

type Send = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const CURRENT = 'tactical:current-user';
const URL_BASE = '/__accounts';
const HEADER = 'x-tactical-save';

/** Whose games and saves this browser shows: the account last signed in here, or nobody. */
export function currentUser(): string | null {
  try {
    return globalThis.localStorage?.getItem(CURRENT) ?? null;
  } catch {
    return null;
  }
}

/** Remember whose games and saves to show, or forget (`null`). */
export function rememberUser(id: string | null): void {
  try {
    if (id === null) globalThis.localStorage?.removeItem(CURRENT);
    else globalThis.localStorage?.setItem(CURRENT, id);
  } catch {
    // A browser that will not keep it shows the keys as they always were.
  }
}

/**
 * A storage key as a player keeps it: their own, beside the same key of every other player. Admin, and
 * nobody, keep the key as it is - what was saved before there were accounts is admin's.
 */
export function userKey(key: string, user: string | null = currentUser()): string {
  if (user === null || user === 'admin') return key;
  return key.startsWith('tactical:') ? `tactical:u:${user}:${key.slice('tactical:'.length)}` : `u:${user}:${key}`;
}

/**
 * Who the session cookie says is signed in: an account, `null` for nobody, or `'none'` when the server
 * keeps no accounts at all (a build, or the tests' server) - when the game is played by nobody in
 * particular, as it always was.
 */
export async function whoAmI(send: Send = fetch): Promise<SignedIn | null | 'none'> {
  try {
    const response = await send(`${URL_BASE}/me`, { credentials: 'same-origin' });
    if (response.status === 404) return 'none';
    if (!response.ok) return null;
    return (await response.json()) as SignedIn;
  } catch {
    return 'none';
  }
}

/** Sign in, or make an account and sign in with it (`create`). The account, or why not. */
export async function signIn(name: string, password: string, create: boolean, send: Send = fetch): Promise<SignedIn | { refused: string }> {
  try {
    const response = await send(`${URL_BASE}/${create ? 'register' : 'login'}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', [HEADER]: '1' },
      body: JSON.stringify({ name, password }),
    });
    const body = (await response.json()) as SignedIn & { reason?: string };
    if (!response.ok) return { refused: body.reason ?? 'the server would not sign you in' };
    rememberUser(body.id);
    return body;
  } catch {
    return { refused: 'the server could not be reached' };
  }
}

/** Sign out: the session ends, and this browser forgets whose games to show. */
export async function signOut(send: Send = fetch): Promise<void> {
  try {
    await send(`${URL_BASE}/logout`, { method: 'POST', credentials: 'same-origin', headers: { [HEADER]: '1' } });
  } catch {
    // Signed out here whatever the server heard.
  }
  rememberUser(null);
}
