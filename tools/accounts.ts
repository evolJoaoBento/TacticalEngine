import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { SAVE_HEADER } from './default-project.ts';

/**
 * Accounts on this machine: who is playing, so their games and saves are theirs, and so the store
 * (`store.ts`) knows who published a piece and who voted on it.
 *
 * The dev server keeps them in `data/accounts.json` - a directory git ignores, so a password file can
 * never reach the public repository - each password hashed with scrypt and a salt of its own, never
 * kept as sent. Signing in hands the browser a session: a random token in an HttpOnly cookie, kept in
 * `data/sessions.json` so a restarted server does not sign everybody out, good for thirty days. The
 * first start makes the account `admin` (password `admin`, the user's choice for their own machine).
 *
 * Routes, all under `/__accounts/`: `me` (GET - who the cookie says, or 401), and `register`, `login`,
 * `logout` (POST, guarded as the project save is: the page's own header, from the page's own origin).
 * **They are answered by the Rust server now** (`server/serve/src/accounts.rs`, `docs/SERVER.md`), which
 * keeps the same files the same way, held to `server/fixtures/accounts.json` - which this file's
 * functions write (`tests/unit/accounts.golden.test.ts`), so they stay the reference. The dev plugins
 * still on this side (`store.ts`, `your-models.ts`) read the accounts and sessions through them.
 * When the tests are serving (`TACTICAL_BOOT=builtin`) there are no accounts at all: `me` answers 404,
 * and the page plays with nobody signed in, as it always did.
 */

export const ACCOUNTS_FILE = 'data/accounts.json';
export const SESSIONS_FILE = 'data/sessions.json';
export const ACCOUNTS_URL = '/__accounts';
export const SESSION_COOKIE = 'tactical-session';
const SESSION_DAYS = 30;
const LIMIT = 4096;

/** A name: letters, digits, `_` and `-`, three to twenty-four of them. */
const NAME = /^[A-Za-z0-9_-]{3,24}$/;

export interface Account {
  /** The name, lower-cased: what is compared, and what games and saves are kept under. */
  id: string;
  /** As it was typed. */
  name: string;
  salt: string;
  hash: string;
  admin: boolean;
  created: number;
}

export interface Session {
  account: string;
  expires: number;
}

/** A password, hashed with a salt: what is kept, never the password. */
export function hashPassword(password: string, salt: string = randomBytes(16).toString('hex')): { salt: string; hash: string } {
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}

/** Whether a password is the one an account was made with, compared in constant time. */
export function checkPassword(account: Pick<Account, 'salt' | 'hash'>, password: string): boolean {
  const wanted = Buffer.from(account.hash, 'hex');
  const given = scryptSync(password, account.salt, wanted.length);
  return wanted.length === given.length && timingSafeEqual(wanted, given);
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(partial, file);
}

/** The accounts on this machine; the first read makes `admin` when there are none. */
export function readAccounts(root: string): Account[] {
  const file = resolve(root, ACCOUNTS_FILE);
  const accounts = readJson<Account[]>(file, []);
  if (Array.isArray(accounts) && accounts.length > 0) return accounts;
  const admin: Account = { id: 'admin', name: 'admin', ...hashPassword('admin'), admin: true, created: Date.now() };
  writeJson(file, [admin]);
  return [admin];
}

export function writeAccounts(root: string, accounts: readonly Account[]): void {
  writeJson(resolve(root, ACCOUNTS_FILE), accounts);
}

export function readSessions(root: string, now: number = Date.now()): Record<string, Session> {
  const sessions = readJson<Record<string, Session>>(resolve(root, SESSIONS_FILE), {});
  return Object.fromEntries(Object.entries(sessions).filter(([, session]) => session.expires > now));
}

export function writeSessions(root: string, sessions: Record<string, Session>): void {
  writeJson(resolve(root, SESSIONS_FILE), sessions);
}

/** Who a request's cookie says it is, if anybody, among these accounts and sessions. */
export function accountOf(cookie: string | undefined, sessions: Record<string, Session>, accounts: readonly Account[], now: number = Date.now()): Account | null {
  const token = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (token === undefined) return null;
  const session = sessions[token];
  if (session === undefined || session.expires <= now) return null;
  return accounts.find((account) => account.id === session.account) ?? null;
}

export interface AccountsRequest {
  method?: string | undefined;
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

const headerOf = (request: AccountsRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};

/** Why a POST is not the page's own, or nothing when it is: the project save's guard. */
export function fromThePage(request: AccountsRequest): string | null {
  if (request.method !== 'POST') return 'not a POST';
  if (headerOf(request, SAVE_HEADER) !== '1') return 'not sent by the page';
  const origin = headerOf(request, 'origin');
  const host = headerOf(request, 'host');
  if (origin !== undefined && host !== undefined && hostOf(origin) !== host) return 'sent from another origin';
  return null;
}

/** A name and a password, from a body, or why not. */
export function judgeCredentials(body: string): { ok: true; name: string; password: string } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  const { name, password } = (parsed ?? {}) as { name?: unknown; password?: unknown };
  if (typeof name !== 'string' || !NAME.test(name)) return { ok: false, reason: 'a name is 3 to 24 letters, digits, _ or -' };
  if (typeof password !== 'string' || password.length < 4 || password.length > 200) return { ok: false, reason: 'a password is 4 to 200 characters' };
  return { ok: true, name, password };
}

/** What the page is told about who is signed in: never the hash. */
export const publicAccount = (account: Account): { name: string; id: string; admin: boolean } => ({ name: account.name, id: account.id, admin: account.admin });

/** Read a request's body, up to a limit; null when it is larger. */
export function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on('end', () => done(size > limit ? null : Buffer.concat(chunks)));
  });
}

/** Whether this server keeps accounts: a dev server the tests are not using. */
export function keepsAccounts(command: 'serve' | 'build'): boolean {
  return command === 'serve' && process.env['TACTICAL_BOOT'] !== 'builtin';
}

/**
 * Whether this Vite passes routes to the Rust server (`rust-server.ts`): a dev server that keeps accounts,
 * and not Vitest's, which loads the same config as a dev server of its own.
 */
export function servesRust(command: 'serve' | 'build'): boolean {
  return keepsAccounts(command) && process.env['VITEST'] === undefined;
}

/**
 * The accounts' routes are the Rust server's now (`server/serve/src/accounts.rs`, passed through by
 * `rust-server.ts`); what is left here is the answer when there is no server - the tests', or a build -
 * which is no accounts at all.
 */
export function accounts(): Plugin {
  let on = keepsAccounts('serve');
  return {
    name: 'tactical-accounts',
    configResolved(config) {
      on = keepsAccounts(config.command);
    },
    configureServer(server) {
      if (on) return;
      server.middlewares.use(ACCOUNTS_URL, (_request: IncomingMessage, response: ServerResponse) => {
        response.statusCode = 404;
        response.setHeader('content-type', 'application/json');
        response.setHeader('cache-control', 'no-store');
        response.end(JSON.stringify({ reason: 'this server keeps no accounts' }));
      });
    },
  };
}
