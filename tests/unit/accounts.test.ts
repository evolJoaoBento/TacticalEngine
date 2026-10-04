import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACCOUNTS_FILE,
  SESSION_COOKIE,
  accountOf,
  checkPassword,
  fromThePage,
  hashPassword,
  judgeCredentials,
  publicAccount,
  readAccounts,
  readSessions,
  writeSessions,
} from '../../tools/accounts';

/**
 * Accounts on this machine (`tools/accounts.ts`): passwords kept only as salted scrypt hashes, admin
 * made on the first start, a session cookie read back to its account until it expires, and only the
 * page itself allowed to sign in.
 */

describe('a password', () => {
  it('is kept as a salted hash, and only the password it was made from matches it', () => {
    const kept = hashPassword('open sesame');
    expect(kept.hash).not.toContain('open sesame');
    expect(kept.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(checkPassword(kept, 'open sesame')).toBe(true);
    expect(checkPassword(kept, 'open sesame!')).toBe(false);
    // The same password, another salt: another hash.
    expect(hashPassword('open sesame').hash).not.toBe(kept.hash);
  });
});

describe('the accounts on this machine', () => {
  it('start with admin, password admin, and are never told to the page with their hash', () => {
    const root = mkdtempSync(join(tmpdir(), 'accounts-'));
    const [admin] = readAccounts(root);
    expect(admin).toMatchObject({ id: 'admin', admin: true });
    expect(checkPassword(admin!, 'admin')).toBe(true);
    expect(readFileSync(join(root, ACCOUNTS_FILE), 'utf8')).not.toContain('"admin",\n    "password"');
    expect(publicAccount(admin!)).toEqual({ id: 'admin', name: 'admin', admin: true });
    // Read again: the same admin, not a second one.
    expect(readAccounts(root)).toHaveLength(1);
  });
});

describe('a session', () => {
  const root = mkdtempSync(join(tmpdir(), 'sessions-'));
  const accounts = readAccounts(root);

  it('is read back from its cookie to its account, until it expires', () => {
    const now = 1_000_000;
    writeSessions(root, { live: { account: 'admin', expires: now + 60_000 }, old: { account: 'admin', expires: now - 1 } });
    const sessions = readSessions(root, now);
    expect(Object.keys(sessions)).toEqual(['live']);
    expect(accountOf(`theme=dark; ${SESSION_COOKIE}=live`, sessions, accounts, now)?.id).toBe('admin');
    expect(accountOf(`${SESSION_COOKIE}=old`, sessions, accounts, now)).toBeNull();
    expect(accountOf(`${SESSION_COOKIE}=forged`, sessions, accounts, now)).toBeNull();
    expect(accountOf(undefined, sessions, accounts, now)).toBeNull();
    expect(accountOf(`${SESSION_COOKIE}=live`, sessions, accounts, now + 120_000)).toBeNull();
  });
});

describe('signing in or up', () => {
  const page = { method: 'POST', headers: { 'x-tactical-save': '1', origin: 'http://127.0.0.1:8420', host: '127.0.0.1:8420' } };

  it('is the page’s own POST, and nobody else’s', () => {
    expect(fromThePage(page)).toBeNull();
    expect(fromThePage({ ...page, method: 'GET' })).toBe('not a POST');
    expect(fromThePage({ ...page, headers: { ...page.headers, 'x-tactical-save': undefined } })).toBe('not sent by the page');
    expect(fromThePage({ ...page, headers: { ...page.headers, origin: 'https://elsewhere.example' } })).toBe('sent from another origin');
  });

  it('takes a name of letters, digits, _ and -, and a password of four or more', () => {
    expect(judgeCredentials(JSON.stringify({ name: 'Ash_Iron-vein', password: 'hunter2' }))).toEqual({ ok: true, name: 'Ash_Iron-vein', password: 'hunter2' });
    expect(judgeCredentials(JSON.stringify({ name: 'ab', password: 'hunter2' }))).toMatchObject({ ok: false });
    expect(judgeCredentials(JSON.stringify({ name: '../admin', password: 'hunter2' }))).toMatchObject({ ok: false });
    expect(judgeCredentials(JSON.stringify({ name: 'ash', password: 'abc' }))).toMatchObject({ ok: false });
    expect(judgeCredentials('not json')).toMatchObject({ ok: false });
  });
});
