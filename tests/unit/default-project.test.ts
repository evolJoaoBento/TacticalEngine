/**
 * The default project on disk: the guard on writing it, and the file that ships.
 *
 * The save route writes to disk from a port any page in the browser can send to, so what it
 * refuses matters as much as what it accepts - a cross-site page must not be able to overwrite
 * somebody's project. And the committed file has to go on opening, whatever has been saved into
 * it since: this is the check that a hand edit or a bad merge has not left the default unloadable.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_FILE, SAVE_HEADER, SAVE_LIMIT, judgeSave, writeProject } from '../../tools/default-project';
import { migrateDocument } from '../../src/engine/scene/migrate';
import { projectSchema } from '../../src/engine/scene/schema';
import { buildProjectScene } from '../../src/game/demo-scene';

const project = JSON.stringify({ id: 'room', scenes: [{ id: 'a' }] });
const sent = (headers: Record<string, string>, method = 'POST') => ({ method, headers: { host: '127.0.0.1:8420', [SAVE_HEADER]: '1', ...headers } });

describe('what the save route will write', () => {
  it('writes a project the page itself sent, from its own origin', () => {
    const verdict = judgeSave(sent({ origin: 'http://127.0.0.1:8420' }), project);
    expect(verdict).toEqual({ ok: true, text: `${project}\n` });
  });

  it('refuses a request without the header, which a cross-site page cannot add unasked', () => {
    // A plain cross-site POST needs no permission to be sent. A custom header does, and this
    // server never gives it, so the header is what tells the page's own save from a forgery.
    const verdict = judgeSave({ method: 'POST', headers: { host: '127.0.0.1:8420' } }, project);
    expect(verdict).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a save from any other origin, and from a sandboxed page that names none', () => {
    expect(judgeSave(sent({ origin: 'https://elsewhere.example' }), project)).toMatchObject({ ok: false, status: 403 });
    expect(judgeSave(sent({ origin: 'http://127.0.0.1:9999' }), project)).toMatchObject({ ok: false, status: 403 });
    // `null` is what a sandboxed frame sends, and it is not a URL: refused, not thrown on.
    expect(judgeSave(sent({ origin: 'null' }), project)).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses anything that is not a save, or not a project', () => {
    expect(judgeSave(sent({}, 'GET'), project)).toMatchObject({ ok: false, status: 405 });
    expect(judgeSave(sent({}), 'not json')).toMatchObject({ ok: false, status: 400 });
    expect(judgeSave(sent({}), '{"id":"room"}')).toMatchObject({ ok: false, status: 422 });
    expect(judgeSave(sent({}), '{"id":"room","scenes":[]}')).toMatchObject({ ok: false, status: 422 });
    expect(judgeSave(sent({}), 'null')).toMatchObject({ ok: false, status: 422 });
    expect(judgeSave(sent({}), 'x'.repeat(SAVE_LIMIT + 1))).toMatchObject({ ok: false, status: 413 });
  });

  it('writes the file whole, and leaves nothing half-written beside it', () => {
    const root = mkdtempSync(join(tmpdir(), 'tactical-project-'));
    try {
      writeProject(root, 'first\n');
      writeProject(root, 'second\n');
      expect(readFileSync(join(root, PROJECT_FILE), 'utf8')).toBe('second\n');
      expect(readdirSync(join(root, 'projects'))).toEqual(['default.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the default project as committed', () => {
  it('opens: it parses, migrates and builds into a room with a party in it', () => {
    const text = readFileSync(PROJECT_FILE, 'utf8');
    const parsed = projectSchema.safeParse(migrateDocument(JSON.parse(text)));
    expect(parsed.success, parsed.success ? '' : parsed.error.issues[0]?.message).toBe(true);
    const scene = buildProjectScene(parsed.data!, parsed.data!.id);
    expect(scene.party.members().length).toBeGreaterThan(0);
    // Not held to any particular formatting: the file is the author's, and a hand edit with other
    // spacing is not a broken project. What it must do is open.
  });
});
