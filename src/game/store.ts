/**
 * The store, as the page talks to it (`tools/store.ts`): the listings, publishing one, showing its work
 * later, a vote, getting a model into your own, taking one down, and where a listing's files are. The screens are `ui/Store.tsx`.
 */

export type Vote = 'like' | 'dislike';
/** How a listing says it was made. */
export type Claim = 'human-made' | 'ai-assisted' | 'ai-generated';

/** How each is said on a listing. */
export const CLAIM_LABEL: Readonly<Record<Claim, string>> = { 'human-made': 'Human made', 'ai-assisted': 'AI Assisted', 'ai-generated': 'AI Generated' };

/** A picture of the work, as the publish carries it. */
export interface ProofUpload {
  name: string;
  data: string;
}

/** A listing as the server shows it: the counts and the asker's own vote, never who voted what. */
export interface ListingView {
  id: string;
  title: string;
  description: string;
  /** How it was made, as its creator says, and how the store marks it: the claim once the work is shown, AI generated until then. */
  claim: Claim;
  mark: Claim;
  /** Whether it shows its work: How I Made It, and at least one Process Proof. */
  supported: boolean;
  /** Meant to be paid for; payments are not open yet. */
  forSale: boolean;
  /** How I Made It. */
  how: string;
  proofCount: number;
  kind: 'model' | 'image';
  fileName: string;
  creator: string;
  creatorName: string;
  created: number;
  likes: number;
  dislikes: number;
  /** 0 to 100; null with no votes yet. */
  authenticity: number | null;
  mine: Vote | null;
  own: boolean;
  /** Whether the asker has it in their own models already. */
  inYours: boolean;
  /** One of the engine's own models, listed by The engine. */
  engine?: true;
}

type Send = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const BASE = '/__store';
const HEADER = 'x-tactical-save';

/** The line the storefront reads for a listing: "Human-Crafted Authenticity: 94% (45 Likes / 3 Dislikes)". */
export function authenticityLine(listing: Pick<ListingView, 'likes' | 'dislikes' | 'authenticity'>): string {
  if (listing.authenticity === null) return 'Human-Crafted Authenticity: no votes yet';
  const likes = `${listing.likes} ${listing.likes === 1 ? 'Like' : 'Likes'}`;
  const dislikes = `${listing.dislikes} ${listing.dislikes === 1 ? 'Dislike' : 'Dislikes'}`;
  return `Human-Crafted Authenticity: ${listing.authenticity}% (${likes} / ${dislikes})`;
}

/** Where a listing's asset is, to see or to `download`. */
export function assetUrl(id: string, download = false): string {
  return `${BASE}/file/${encodeURIComponent(id)}/asset${download ? '?download' : ''}`;
}

/** Where one of a listing's pictures of the work is. */
export function proofUrl(id: string, n: number): string {
  return `${BASE}/file/${encodeURIComponent(id)}/proof/${n}`;
}

async function post(send: Send, route: string, body: unknown): Promise<{ ok: true; value: unknown } | { refused: string }> {
  try {
    const response = await send(`${BASE}/${route}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', [HEADER]: '1' },
      body: JSON.stringify(body),
    });
    const value = (await response.json()) as { reason?: string };
    return response.ok ? { ok: true, value } : { refused: value.reason ?? 'the store would not do that' };
  } catch {
    return { refused: 'the store could not be reached' };
  }
}

/** Every listing, newest first; or why there are none to show. */
export async function listListings(send: Send = fetch): Promise<ListingView[] | { refused: string }> {
  try {
    const response = await send(`${BASE}/list`, { credentials: 'same-origin' });
    if (!response.ok) return { refused: response.status === 404 ? 'this server keeps no store' : 'the store would not list' };
    return (await response.json()) as ListingView[];
  } catch {
    return { refused: 'the store could not be reached' };
  }
}

/** A file as the data URL the publish carries it in. */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Publish a listing: the asset, the words, how it was made, free or for sale, and the pictures of the
 * work if there are any. The listing, or why not.
 */
export async function publishListing(
  draft: { title: string; description: string; claim: Claim; forSale: boolean; how: string; asset: { name: string; data: string }; proofs: ProofUpload[] },
  send: Send = fetch,
): Promise<ListingView | { refused: string }> {
  const answer = await post(send, 'publish', draft);
  return 'refused' in answer ? answer : (answer.value as ListingView);
}

/** Show a listing's work, later: How I Made It, more pictures, its claim, free or for sale. The listing, or why not. */
export async function updateListing(
  id: string,
  changes: { how?: string; claim?: Claim; forSale?: boolean; addProofs?: ProofUpload[] },
  send: Send = fetch,
): Promise<ListingView | { refused: string }> {
  const answer = await post(send, 'update', { id, ...changes });
  return 'refused' in answer ? answer : (answer.value as ListingView);
}

/** Put a model listing into your own models (`your-models.ts`): the listing as it now stands, or why not. */
export async function getListing(id: string, send: Send = fetch): Promise<ListingView | { refused: string }> {
  const answer = await post(send, 'get', { id });
  return 'refused' in answer ? answer : (answer.value as { listing: ListingView }).listing;
}

/** Like or dislike a listing, or take a vote back (`null`). The listing as it now stands, or why not. */
export async function voteOn(id: string, vote: Vote | null, send: Send = fetch): Promise<ListingView | { refused: string }> {
  const answer = await post(send, 'vote', { id, vote });
  return 'refused' in answer ? answer : (answer.value as ListingView);
}

/** Take a listing down: its creator, or admin. Nothing, or why not. */
export async function removeListing(id: string, send: Send = fetch): Promise<string | null> {
  const answer = await post(send, 'remove', { id });
  return 'refused' in answer ? answer.refused : null;
}
