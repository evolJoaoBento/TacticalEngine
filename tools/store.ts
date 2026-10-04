import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { keepsAccounts, type Account } from './accounts.ts';
import { tidyId } from './your-models.ts';

/**
 * The store: art creators publish - a model or a picture - and **show their work**, and everybody signed
 * in says whether they believe it (`src/game/ui/Store.tsx`).
 *
 * A listing says how it was made - **Human made**, **AI Assisted** or **AI Generated** (`claim`) - and
 * whether it is **free** or **for sale**. Its **evidence** is **How I Made It** (a paragraph about the
 * process) and **Process Proof** (pictures of the workspace, drafts - up to six). A listing without
 * evidence is **marked AI**, whatever it claims (`markOf`), and there is nothing yet to vote on; its
 * creator can show their work later (`update`), and then its claim stands. A listing can be **for sale**
 * only with evidence and a claim of human made or AI assisted - AI assisted work sells on how the AI
 * was used being shown - and never AI generated (`judgeSale`). There are no payments yet: a listing for
 * sale says so, and only its creator can get it until payments open.
 *
 * With evidence, everybody else signed in can **Like** it, believing the proof, or **Dislike** it, seeing
 * signs of AI or no real evidence - one vote each, changed or taken back, never on their own. The
 * storefront reads **Human-Crafted Authenticity: 94% (45 Likes / 3 Dislikes)** (`authenticity`), worked
 * out here from the votes, which are never handed to the page - only the counts and the asker's own.
 * Its creator, or admin, can take a listing down.
 *
 * **Every model the engine has is in the store** (`engineListings`): each `.glb` in `public/models` is a
 * free listing by *The engine*, claiming what `projects/art-provenance.json` says of it - AI generated
 * unless marked otherwise - and marked AI like any other until admin shows its work. It comes and goes
 * with its file, and is never taken down here. **Get** on a model (`get`) puts it into the player's
 * own models (`tools/your-models.ts`), which the editor offers under every project they open; a picture
 * is downloaded, as before. Either way a listing for sale is its creator's alone until payments open.
 *
 * **The routes are the Rust server's now** (`server/serve/src/store.rs`, `docs/SERVER.md`), over the same
 * files; the functions here stay the reference it is held to (`tests/unit/store.golden.test.ts` writes
 * `server/fixtures/store.json` from them).
 *
 * Kept by the dev server in `data/store/` (git ignored, as the accounts are): `listings.json`, and the
 * files beside it under names this makes, never names it was sent. Routes under `/__store/`: `list`
 * (GET), `file/<listing>/asset` and `file/<listing>/proof/<n>` (GET), and `publish`, `update`, `vote`,
 * `get`, `remove` (POST, the page's own, signed in). None of it when the tests are serving
 * (`TACTICAL_BOOT=builtin`): every route answers 404.
 */

export const STORE_URL = '/__store';
export const LISTINGS_FILE = 'data/store/listings.json';
/** The most a publish or an update may weigh: the file and the proof, sent as base64. */
export const PUBLISH_LIMIT = 128 * 1024 * 1024;
/** How many pictures of the work a listing may show. */
export const MOST_PROOFS = 6;

export type AssetKind = 'model' | 'image';
export type Vote = 'like' | 'dislike';
export type Claim = 'human-made' | 'ai-assisted' | 'ai-generated';
const CLAIMS: readonly Claim[] = ['human-made', 'ai-assisted', 'ai-generated'];

export interface Listing {
  id: string;
  title: string;
  description: string;
  /** How it was made, as its creator says. */
  claim: Claim;
  /** Whether it is meant to be paid for; payments are not open yet. */
  forSale: boolean;
  /** How I Made It: the creator's paragraph about their process. */
  how: string;
  kind: AssetKind;
  /** The asset's file, under this listing's own name for it, and the name it was published under. */
  file: string;
  fileName: string;
  /** Process Proof: pictures of the workspace or drafts, in the order given. */
  proofs: string[];
  creator: string;
  creatorName: string;
  created: number;
  votes: Record<string, Vote>;
  /** One of the engine's own models: `file` is its name in `public/models`. */
  engine?: true;
}

/** A listing as the page sees it: its mark, the counts and the asker's own vote, never who voted what. */
export interface ListingView extends Omit<Listing, 'votes' | 'file' | 'proofs'> {
  /** How the store marks it: its claim when it shows its work, AI generated until it does. */
  mark: Claim;
  /** Whether it shows its work: How I Made It, and at least one Process Proof. */
  supported: boolean;
  proofCount: number;
  likes: number;
  dislikes: number;
  /** The share of votes that are likes, 0 to 100, rounded; null with no votes yet. */
  authenticity: number | null;
  mine: Vote | null;
  own: boolean;
  /** Whether the asker has it in their own models already. */
  inYours: boolean;
}

/** Whether a listing shows its work: How I Made It, and at least one picture of it. */
export function supported(listing: Pick<Listing, 'how' | 'proofs'>): boolean {
  return listing.how.trim() !== '' && listing.proofs.length > 0;
}

/** How the store marks a listing: as it claims, once it shows its work; AI generated until then. */
export function markOf(listing: Pick<Listing, 'how' | 'proofs' | 'claim'>): Claim {
  return supported(listing) ? listing.claim : 'ai-generated';
}

/** Why a listing may not be for sale, or nothing when it may: it needs its work shown, and never AI generated. */
export function judgeSale(listing: Pick<Listing, 'how' | 'proofs' | 'claim' | 'forSale'>): string | null {
  if (!listing.forSale) return null;
  if (listing.claim === 'ai-generated') return 'AI generated work is not for sale';
  if (!supported(listing)) return 'to be for sale, show your work: How I Made It and at least one Process Proof';
  return null;
}

/** The share of votes that are likes, as a whole percent; null when nobody has voted. */
export function authenticity(likes: number, dislikes: number): number | null {
  const all = likes + dislikes;
  return all === 0 ? null : Math.round((likes / all) * 100);
}

/** A listing as the page sees it, for this asker, who has these listings in their own models. */
export function viewOf(listing: Listing, asker: string | null, yours: ReadonlySet<string> = new Set()): ListingView {
  const votes = Object.values(listing.votes);
  const likes = votes.filter((vote) => vote === 'like').length;
  const dislikes = votes.length - likes;
  const { votes: _votes, file: _file, proofs, ...rest } = listing;
  return {
    ...rest,
    mark: markOf(listing),
    supported: supported(listing),
    proofCount: proofs.length,
    likes,
    dislikes,
    authenticity: authenticity(likes, dislikes),
    mine: asker === null ? null : (listing.votes[asker] ?? null),
    own: asker === listing.creator,
    inYours: yours.has(listing.id),
  };
}

/** Where the engine's models are, from the project root. */
export const ENGINE_MODELS = 'public/models';

/** A model file's name as a title: `bandit-cutter.glb` is Bandit Cutter. */
export const titleOf = (file: string): string => tidyId(file).split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/** An engine model's listing id: the same for its file every time, so its votes stay with it. */
export const engineListingId = (file: string): string => createHash('sha256').update(`engine:${file}`).digest('hex').slice(0, 16);

/**
 * The listings with the engine's models brought up to date: one for each file there is, claimed as
 * its art mark says (`provenance`, `model:<id>`), and none for a file that has gone. The rest are left
 * as they are. Says whether anything changed, so the file is written only then.
 */
export function engineListings(
  listings: readonly Listing[],
  files: readonly { file: string; created: number }[],
  provenance: Readonly<Record<string, string>>,
): { listings: Listing[]; changed: boolean } {
  const present = new Set(files.map((entry) => entry.file));
  const kept = listings.filter((listing) => listing.engine !== true || present.has(listing.file));
  let changed = kept.length !== listings.length;
  const listed = new Set(kept.filter((listing) => listing.engine === true).map((listing) => listing.file));
  for (const { file, created } of files) {
    if (listed.has(file)) continue;
    const mark = provenance[`model:${tidyId(file)}`];
    kept.push({
      id: engineListingId(file), title: titleOf(file), description: 'One of the engine’s own models: every project has it.',
      claim: mark === 'human-made' || mark === 'ai-assisted' ? mark : 'ai-generated', forSale: false, how: '', kind: 'model',
      file, fileName: file, proofs: [], creator: 'admin', creatorName: 'The engine', created, votes: {}, engine: true,
    });
    changed = true;
  }
  return { listings: kept, changed };
}

/** What a file is, from its first bytes: a binary glTF, a PNG, a JPEG, a WebP - or nothing the store takes. */
export function sniff(bytes: Uint8Array): { kind: AssetKind; ext: string; type: string } | null {
  const at = (i: number, ...values: number[]): boolean => values.every((value, j) => bytes[i + j] === value);
  if (at(0, 0x67, 0x6c, 0x54, 0x46)) return { kind: 'model', ext: 'glb', type: 'model/gltf-binary' };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { kind: 'image', ext: 'png', type: 'image/png' };
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: 'image', ext: 'jpg', type: 'image/jpeg' };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { kind: 'image', ext: 'webp', type: 'image/webp' };
  return null;
}

const text = (value: unknown, most: number): string | null => (typeof value === 'string' && value.trim().length <= most ? value.trim() : null);
/** A file sent as base64 or a data URL, read as Node reads base64: leniently. */
export const decode = (value: unknown): Uint8Array | null => {
  if (typeof value !== 'string') return null;
  const data = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  try {
    return new Uint8Array(Buffer.from(data, 'base64'));
  } catch {
    return null;
  }
};

/** Pictures of the work, from a body: each a PNG, JPEG or WebP - or why not. */
function judgeProofs(value: unknown, room: number): { ok: true; proofs: { bytes: Uint8Array; ext: string }[] } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, proofs: [] };
  if (!Array.isArray(value)) return { ok: false, reason: 'the Process Proof is a list of pictures' };
  if (value.length > room) return { ok: false, reason: `a listing shows ${MOST_PROOFS} pictures of the work at most` };
  const proofs: { bytes: Uint8Array; ext: string }[] = [];
  for (const proof of value as { data?: unknown }[]) {
    const bytes = decode(proof?.data);
    const kind = bytes === null ? null : sniff(bytes);
    if (bytes === null || kind === null || kind.kind !== 'image') return { ok: false, reason: 'the Process Proof is PNG, JPEG or WebP pictures' };
    proofs.push({ bytes, ext: kind.ext });
  }
  return { ok: true, proofs };
}

export interface PublishDraft {
  title: string;
  description: string;
  claim: Claim;
  forSale: boolean;
  how: string;
  asset: { bytes: Uint8Array; kind: AssetKind; ext: string; name: string };
  proofs: { bytes: Uint8Array; ext: string }[];
}

/**
 * A publish, from its body: a title, the words, how it was made, free or for sale, the asset, and the
 * pictures of the work if any - or why not. Nothing but the title and the asset is needed: a listing
 * without evidence is marked AI until its work is shown. For sale needs the evidence now.
 */
export function judgePublish(body: string): { ok: true; draft: PublishDraft } | { ok: false; reason: string } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  const title = text(parsed['title'], 80);
  if (title === null || title === '') return { ok: false, reason: 'a listing needs a title, of 80 characters at most' };
  const description = text(parsed['description'] ?? '', 2000);
  const how = text(parsed['how'] ?? '', 2000);
  if (description === null || how === null) return { ok: false, reason: 'the description and How I Made It are 2000 characters at most' };
  const claim = (parsed['claim'] ?? 'ai-generated') as Claim;
  if (!CLAIMS.includes(claim)) return { ok: false, reason: 'a listing is human made, AI assisted or AI generated' };
  const forSale = parsed['forSale'] === true;
  const asset = parsed['asset'] as { name?: unknown; data?: unknown } | undefined;
  const assetBytes = decode(asset?.data);
  const assetKind = assetBytes === null ? null : sniff(assetBytes);
  if (assetBytes === null || assetKind === null) return { ok: false, reason: 'the asset is a .glb model or a PNG, JPEG or WebP picture' };
  const name = typeof asset?.name === 'string' ? asset.name.replace(/[^\w .-]/g, '').slice(0, 80) || `asset.${assetKind.ext}` : `asset.${assetKind.ext}`;
  const proofs = judgeProofs(parsed['proofs'], MOST_PROOFS);
  if (!proofs.ok) return proofs;
  const sale = judgeSale({ how, proofs: proofs.proofs.map(() => ''), claim, forSale });
  if (sale !== null) return { ok: false, reason: sale };
  return { ok: true, draft: { title, description, claim, forSale, how, asset: { bytes: assetBytes, kind: assetKind.kind, ext: assetKind.ext, name }, proofs: proofs.proofs } };
}

export interface UpdateDraft {
  id: string;
  how?: string;
  claim?: Claim;
  forSale?: boolean;
  addProofs: { bytes: Uint8Array; ext: string }[];
}

/** Showing the work later, from a body: How I Made It, more pictures, the claim, free or for sale - or why not. */
export function judgeUpdate(body: string, has: (id: string) => number | null): { ok: true; draft: UpdateDraft } | { ok: false; reason: string } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  const id = parsed['id'];
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return { ok: false, reason: 'no such listing' };
  const shown = has(id);
  if (shown === null) return { ok: false, reason: 'no such listing' };
  const draft: UpdateDraft = { id, addProofs: [] };
  if (parsed['how'] !== undefined) {
    const how = text(parsed['how'], 2000);
    if (how === null) return { ok: false, reason: 'How I Made It is 2000 characters at most' };
    draft.how = how;
  }
  if (parsed['claim'] !== undefined) {
    if (!CLAIMS.includes(parsed['claim'] as Claim)) return { ok: false, reason: 'a listing is human made, AI assisted or AI generated' };
    draft.claim = parsed['claim'] as Claim;
  }
  if (parsed['forSale'] !== undefined) draft.forSale = parsed['forSale'] === true;
  const proofs = judgeProofs(parsed['addProofs'], MOST_PROOFS - shown);
  if (!proofs.ok) return proofs;
  draft.addProofs = proofs.proofs;
  return { ok: true, draft };
}

/** A vote, from its body: a listing and like, dislike or nothing - or why not. */
export function judgeVote(body: string): { ok: true; id: string; vote: Vote | null } | { ok: false; reason: string } {
  try {
    const { id, vote } = JSON.parse(body) as { id?: unknown; vote?: unknown };
    if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return { ok: false, reason: 'no such listing' };
    if (vote !== null && vote !== 'like' && vote !== 'dislike') return { ok: false, reason: 'a vote is like, dislike, or nothing' };
    return { ok: true, id, vote };
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
}

/** Which listing a body names, or why not. */
export function judgeListingId(body: string): { ok: true; id: string } | { ok: false; reason: string } {
  try {
    const { id } = JSON.parse(body) as { id?: unknown };
    return typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) ? { ok: true, id } : { ok: false, reason: 'no such listing' };
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
}

/** Put a vote on a listing - or take one off (`null`); never the creator's own, and only on work shown. */
export function castVote(listing: Listing, voter: string, vote: Vote | null): string | null {
  if (voter === listing.creator) return 'your own listing is not yours to vote on';
  if (vote !== null && !supported(listing)) return 'there is nothing to judge until its creator shows their work';
  if (vote === null) delete listing.votes[voter];
  else listing.votes[voter] = vote;
  return null;
}

/** Whether an account may take a listing down: its creator, or admin - and never one of the engine's, which goes with its file. */
export function mayRemove(listing: Listing, account: Account): boolean {
  return listing.engine !== true && (account.admin || account.id === listing.creator);
}

/** Whether an account may get a listing's file: anybody for a free one; for one for sale, only its creator until payments open. */
export function mayGet(listing: Listing, account: Account | null): boolean {
  return !listing.forSale || (account !== null && account.id === listing.creator);
}

export function readListings(root: string): Listing[] {
  const file = resolve(root, LISTINGS_FILE);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    // A listing from before claims and several proofs: one proof becomes a list, and the rest their defaults.
    return (parsed as (Listing & { proof?: string | null })[]).map(({ proof, ...listing }) => ({
      ...listing,
      claim: listing.claim ?? 'ai-generated',
      forSale: listing.forSale ?? false,
      proofs: listing.proofs ?? (proof === undefined || proof === null ? [] : [proof]),
    }));
  } catch {
    return [];
  }
}

export function writeListings(root: string, listings: readonly Listing[]): void {
  const file = resolve(root, LISTINGS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.partial`, `${JSON.stringify(listings, null, 2)}\n`, 'utf8');
  renameSync(`${file}.partial`, file);
}

/**
 * The Store's routes are the Rust server's now (`server/serve/src/store.rs`, passed through by
 * `rust-server.ts`); what is left here is the answer when there is no server - the tests', or a build -
 * which is no store at all.
 */
export function store(): Plugin {
  let on = keepsAccounts('serve');
  return {
    name: 'tactical-store',
    configResolved(config) {
      on = keepsAccounts(config.command);
    },
    configureServer(server) {
      if (on) return;
      server.middlewares.use(STORE_URL, (_request: IncomingMessage, response: ServerResponse) => {
        response.statusCode = 404;
        response.setHeader('content-type', 'application/json');
        response.setHeader('cache-control', 'no-store');
        response.end(JSON.stringify({ reason: 'this server keeps no store' }));
      });
    },
  };
}
