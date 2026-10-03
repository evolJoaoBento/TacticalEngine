/**
 * Accounts as the Rust server must keep them (`docs/SERVER.md`, phase 1): this runs `tools/accounts.ts`
 * over passwords, cookies, sign-in bodies and request headers, and holds the answers to
 * `server/fixtures/accounts.json`, which `server/serve/tests/golden_accounts.rs` replays. A password
 * hashed by either side must be checked by the other - the accounts file is the same file - so the
 * hashes are here to the byte. `UPDATE_GOLDEN=1 npx vitest run tests/unit/accounts.golden.test.ts`
 * writes the fixture afresh.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_COOKIE, accountOf, fromThePage, hashPassword, judgeCredentials, type Account, type Session } from '../../tools/accounts';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../server/fixtures/accounts.json');

const PASSWORDS = ['admin', 'hunter22', 'open sesame', 'pässwörd 🎲', 'x'.repeat(200)];
const SALTS = ['00000000000000000000000000000000', '52d1805f896c9102b507cf91cfbb3ef0', 'not-hex-at-all'];

const BODIES = [
  JSON.stringify({ name: 'Ash_Iron-vein', password: 'hunter2' }),
  JSON.stringify({ name: 'ab', password: 'hunter2' }),
  JSON.stringify({ name: 'x'.repeat(25), password: 'hunter2' }),
  JSON.stringify({ name: '../admin', password: 'hunter2' }),
  JSON.stringify({ name: 'Bramble', password: 'abc' }),
  JSON.stringify({ name: 'Bramble', password: 'abcd' }),
  JSON.stringify({ name: 'Bramble', password: 'p'.repeat(201) }),
  // Two hundred UTF-16 units, but fewer characters: the limit counts as JavaScript does.
  JSON.stringify({ name: 'Bramble', password: '🎲'.repeat(100) }),
  JSON.stringify({ name: 'Bramble', password: '🎲'.repeat(101) }),
  JSON.stringify({ name: 'Bramble', password: 1234 }),
  JSON.stringify({ name: 12, password: 'hunter22' }),
  JSON.stringify({ password: 'hunter22' }),
  JSON.stringify(null),
  JSON.stringify(['Bramble', 'hunter22']),
  JSON.stringify('Bramble'),
  'not json',
  '',
];

const ACCOUNTS: Account[] = [
  { id: 'admin', name: 'admin', salt: 's', hash: 'h', admin: true, created: 1 },
  { id: 'bramble', name: 'Bramble', salt: 's', hash: 'h', admin: false, created: 2 },
];
const NOW = 1_000_000;
const SESSIONS: Record<string, Session> = {
  live: { account: 'bramble', expires: NOW + 60_000 },
  admins: { account: 'admin', expires: NOW + 1 },
  old: { account: 'admin', expires: NOW - 1 },
  edge: { account: 'admin', expires: NOW },
  orphan: { account: 'gone', expires: NOW + 60_000 },
};
const COOKIES = [
  `${SESSION_COOKIE}=live`,
  `theme=dark; ${SESSION_COOKIE}=live`,
  `theme=dark;${SESSION_COOKIE}=admins ;other=1`,
  `${SESSION_COOKIE}=old`,
  `${SESSION_COOKIE}=edge`,
  `${SESSION_COOKIE}=orphan`,
  `${SESSION_COOKIE}=forged`,
  `${SESSION_COOKIE}=`,
  `x${SESSION_COOKIE}=live`,
  `${SESSION_COOKIE}=admins; ${SESSION_COOKIE}=live`,
  '',
  null,
];

const PAGE = { 'x-tactical-save': '1', origin: 'http://127.0.0.1:8420', host: '127.0.0.1:8420' };
const REQUESTS: { method: string; headers: Record<string, string> }[] = [
  { method: 'POST', headers: PAGE },
  { method: 'GET', headers: PAGE },
  { method: 'POST', headers: { origin: PAGE.origin, host: PAGE.host } },
  { method: 'POST', headers: { ...PAGE, 'x-tactical-save': 'yes' } },
  { method: 'POST', headers: { ...PAGE, origin: 'https://elsewhere.example' } },
  { method: 'POST', headers: { ...PAGE, origin: 'http://127.0.0.1:8421' } },
  { method: 'POST', headers: { ...PAGE, origin: 'null' } },
  { method: 'POST', headers: { 'x-tactical-save': '1', host: PAGE.host } },
  { method: 'POST', headers: { 'x-tactical-save': '1', origin: PAGE.origin } },
  { method: 'POST', headers: { 'x-tactical-save': '1', origin: 'http://localhost:80', host: 'localhost' } },
  { method: 'POST', headers: { 'x-tactical-save': '1', origin: 'http://LOCALHOST:8420', host: 'localhost:8420' } },
];

function golden() {
  return {
    about: 'tools/accounts.ts run for the Rust port; written by tests/unit/accounts.golden.test.ts',
    hashes: PASSWORDS.flatMap((password) => SALTS.map((salt) => ({ password, salt, hash: hashPassword(password, salt).hash }))),
    credentials: BODIES.map((body) => ({ body, verdict: judgeCredentials(body) })),
    accounts: ACCOUNTS,
    sessions: SESSIONS,
    now: NOW,
    cookies: COOKIES.map((cookie) => ({ cookie, account: accountOf(cookie ?? undefined, SESSIONS, ACCOUNTS, NOW)?.id ?? null })),
    requests: REQUESTS.map((request) => ({ ...request, refused: fromThePage(request) })),
  };
}

describe('accounts, as the Rust server must keep them', () => {
  it('are what server/fixtures/accounts.json holds', () => {
    const now = golden();
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
