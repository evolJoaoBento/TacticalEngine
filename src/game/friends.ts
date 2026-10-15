/**
 * A player's friends (`docs/SERVER.md`, phase 6, slice 2; the server's `friends.rs`): their friends, who has asked
 * them, and whom they have asked - a request by name, accepted or declined, and either removing the other. An
 * account made with a player's invitation is that player's friend from the start.
 */

export const FRIENDS_URL = '/__friends';
const HEADER = 'x-tactical-save';

export interface Person {
  id: string;
  name: string;
}

export interface FriendsView {
  friends: Person[];
  /** Who has asked this player, not answered yet. */
  asking: Person[];
  /** Whom this player has asked, not answered yet. */
  asked: Person[];
}

type Send = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const people = (value: unknown): Person[] =>
  Array.isArray(value) ? value.filter((p): p is Person => typeof p === 'object' && p !== null && typeof (p as Person).id === 'string' && typeof (p as Person).name === 'string') : [];

const viewOf = (body: unknown): FriendsView => {
  const { friends, asking, asked } = (body ?? {}) as Record<string, unknown>;
  return { friends: people(friends), asking: people(asking), asked: people(asked) };
};

/** The signed-in player's friends; `null` for nobody signed in, or a server that keeps none. */
export async function readFriends(send: Send = fetch): Promise<FriendsView | null> {
  try {
    const response = await send(FRIENDS_URL, { credentials: 'same-origin', cache: 'no-store' });
    return response.ok ? viewOf(await response.json()) : null;
  } catch {
    return null;
  }
}

async function post(route: string, body: unknown, send: Send): Promise<FriendsView | { refused: string }> {
  try {
    const response = await send(`${FRIENDS_URL}/${route}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', [HEADER]: '1' },
      body: JSON.stringify(body),
    });
    const answer = await response.json();
    if (!response.ok) return { refused: (answer as { reason?: string }).reason ?? 'the server would not do it' };
    return viewOf(answer);
  } catch {
    return { refused: 'the server could not be reached' };
  }
}

/** Ask a player, by name, to be friends - friends at once if they had asked first. The friends after, or why not. */
export function askFriend(name: string, send: Send = fetch): Promise<FriendsView | { refused: string }> {
  return post('ask', { name }, send);
}

/** Accept a player's request, or decline it. */
export function answerFriend(from: string, accept: boolean, send: Send = fetch): Promise<FriendsView | { refused: string }> {
  return post('answer', { from, accept }, send);
}

/** A friend removed, or a request of one's own taken back. */
export function removeFriend(id: string, send: Send = fetch): Promise<FriendsView | { refused: string }> {
  return post('remove', { id }, send);
}
