/**
 * A player's friends (`docs/SERVER.md`, phase 6, slice 2; the server's `friends.rs`): their friends, who has asked
 * them, and whom they have asked - a request by name, accepted or declined, and either removing the other. An
 * account made with a player's invitation is that player's friend from the start. And what friends write each other
 * (slice 6; the server's `messages.rs`): a conversation read, written to, and read up to a message.
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
  /** How many messages each friend has written this player that they have not read, by the friend's id. */
  unread: Record<string, number>;
}

/** Something one friend wrote another: numbered as the server took it, `at` its time (ms). */
export interface Message {
  n: number;
  from: string;
  text: string;
  at: number;
}

/** What this player and a friend have written each other, oldest first. */
export interface Conversation {
  with: Person;
  messages: Message[];
}

/** How often an open conversation asks for what is new, and the friends for what is unread (ms). */
export const CONVERSATION_EVERY = 3000;
export const FRIENDS_EVERY = 10_000;

/** All a friend has written this player unread - every friend's, without one. */
export function unreadOf(view: FriendsView | null, friend?: string): number {
  if (view === null) return 0;
  return friend === undefined ? Object.values(view.unread).reduce((sum, count) => sum + count, 0) : (view.unread[friend] ?? 0);
}

type Send = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const people = (value: unknown): Person[] =>
  Array.isArray(value) ? value.filter((p): p is Person => typeof p === 'object' && p !== null && typeof (p as Person).id === 'string' && typeof (p as Person).name === 'string') : [];

const counts = (value: unknown): Record<string, number> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)) : {};

const viewOf = (body: unknown): FriendsView => {
  const { friends, asking, asked, unread } = (body ?? {}) as Record<string, unknown>;
  return { friends: people(friends), asking: people(asking), asked: people(asked), unread: counts(unread) };
};

const conversationOf = (body: unknown): Conversation => {
  const { with: other, messages } = (body ?? {}) as Record<string, unknown>;
  const written = Array.isArray(messages)
    ? messages.filter((m): m is Message => typeof m === 'object' && m !== null && typeof m.n === 'number' && typeof m.from === 'string' && typeof m.text === 'string' && typeof m.at === 'number')
    : [];
  return { with: people([other])[0] ?? { id: '', name: '' }, messages: written };
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

async function post<T = FriendsView>(route: string, body: unknown, send: Send, read: (body: unknown) => T = viewOf as (body: unknown) => T): Promise<T | { refused: string }> {
  try {
    const response = await send(`${FRIENDS_URL}/${route}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', [HEADER]: '1' },
      body: JSON.stringify(body),
    });
    const answer = await response.json();
    if (!response.ok) return { refused: (answer as { reason?: string }).reason ?? 'the server would not do it' };
    return read(answer);
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

/** What this player and a friend have written each other; `null` for no friend of theirs, or no server. */
export async function readConversation(friend: string, send: Send = fetch): Promise<Conversation | null> {
  try {
    const response = await send(`${FRIENDS_URL}/messages/${encodeURIComponent(friend)}`, { credentials: 'same-origin', cache: 'no-store' });
    return response.ok ? conversationOf(await response.json()) : null;
  } catch {
    return null;
  }
}

/** Something written to a friend: the conversation after, or why not. */
export function writeTo(friend: string, text: string, send: Send = fetch): Promise<Conversation | { refused: string }> {
  return post('say', { to: friend, text }, send, conversationOf);
}

/** A friend's messages read up to one (its `n`): the friends after, what is unread with them. */
export function readUpTo(friend: string, upTo: number, send: Send = fetch): Promise<FriendsView | { refused: string }> {
  return post('read', { id: friend, upTo }, send);
}
