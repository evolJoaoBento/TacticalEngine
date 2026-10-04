import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROVENANCE_FILE, judgeProvenance, markProvenance, readProvenance, writeProvenance } from '../../tools/art-provenance';

/**
 * How the engine's art was made, kept for every project (`tools/art-provenance.ts`): the file that
 * holds what differs from each kind's rule, and the guarded route that changes it.
 */

describe('the marks kept for every project', () => {
  it('are written whole, read back, and missing is none', () => {
    const root = mkdtempSync(join(tmpdir(), 'provenance-'));
    expect(readProvenance(root)).toEqual({});
    const map = markProvenance(markProvenance({}, 'model:quim', 'ai-assisted'), 'card:bare-bones', 'ai-generated');
    writeProvenance(root, map);
    expect(readProvenance(root)).toEqual({ 'card:bare-bones': 'ai-generated', 'model:quim': 'ai-assisted' });
    expect(Object.keys(map)).toEqual(['card:bare-bones', 'model:quim']);
    // Back to its rule: out of the file.
    expect(markProvenance(map, 'model:quim', null)).toEqual({ 'card:bare-bones': 'ai-generated' });
  });

  it('leave out anything that is not a piece of art and one of the three', () => {
    const root = mkdtempSync(join(tmpdir(), 'provenance-'));
    writeProvenance(root, {});
    writeFileSync(join(root, PROVENANCE_FILE), JSON.stringify({ 'model:quim': 'human-made', 'model:../x': 'human-made', 'sound:boom': 'ai-generated', 'model:violet': 'made by a robot' }));
    expect(readProvenance(root)).toEqual({ 'model:quim': 'human-made' });
    writeFileSync(join(root, PROVENANCE_FILE), 'not json');
    expect(readProvenance(root)).toEqual({});
  });
});

describe('a mark changed from the editor', () => {
  const page = { method: 'POST', headers: { 'x-tactical-save': '1', origin: 'http://127.0.0.1:8420', host: '127.0.0.1:8420' } };

  it('is a piece of art and one of the three, or nothing to go back to its rule', () => {
    expect(judgeProvenance(page, JSON.stringify({ key: 'model:quim', provenance: 'ai-assisted' }))).toEqual({ ok: true, key: 'model:quim', provenance: 'ai-assisted' });
    expect(judgeProvenance(page, JSON.stringify({ key: 'equipment:broadsword.webp', provenance: 'human-made' }))).toMatchObject({ ok: true });
    expect(judgeProvenance(page, JSON.stringify({ key: 'card:bare-bones', provenance: null }))).toEqual({ ok: true, key: 'card:bare-bones', provenance: null });
    expect(judgeProvenance(page, JSON.stringify({ key: 'model:quim', provenance: 'robot' }))).toMatchObject({ ok: false, status: 422 });
    expect(judgeProvenance(page, JSON.stringify({ key: '../../etc/passwd', provenance: 'human-made' }))).toMatchObject({ ok: false, status: 422 });
  });

  it('is sent by the page itself', () => {
    expect(judgeProvenance({ ...page, method: 'GET' }, '{}')).toMatchObject({ ok: false, status: 405 });
    expect(judgeProvenance({ ...page, headers: { ...page.headers, 'x-tactical-save': undefined } }, '{}')).toMatchObject({ ok: false, status: 403 });
    expect(judgeProvenance({ ...page, headers: { ...page.headers, origin: 'https://elsewhere.example' } }, '{}')).toMatchObject({ ok: false, status: 403 });
    expect(judgeProvenance(page, 'not json')).toMatchObject({ ok: false, status: 400 });
  });
});
