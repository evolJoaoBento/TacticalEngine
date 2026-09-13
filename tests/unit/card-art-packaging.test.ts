import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

it('builds without private card files while preserving other public assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'polyheart-build-test-'));
  try {
    await mkdir(join(root, 'public/cards/nested'), { recursive: true });
    await mkdir(join(root, 'public/models'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<html><body>Fixture</body></html>');
    await writeFile(join(root, 'public/cards/private.jpg'), 'private image fixture');
    await writeFile(join(root, 'public/cards/nested/private.png'), 'private nested fixture');
    await writeFile(join(root, 'public/cards/index.json'), '{"bare-bones":"private.jpg"}');
    await writeFile(join(root, 'public/models/fixture.txt'), 'keep this asset');
    await build({ root, configFile: resolve('vite.config.ts'), logLevel: 'silent' });
    expect(await readdir(join(root, 'dist/cards'))).toEqual(['index.json']);
    expect(JSON.parse(await readFile(join(root, 'dist/cards/index.json'), 'utf8'))).toEqual({});
    expect(await readFile(join(root, 'dist/models/fixture.txt'), 'utf8')).toBe('keep this asset');
  } finally {
    // root is the absolute directory returned by mkdtemp for this test alone.
    await rm(root, { recursive: true, force: true });
  }
});

it('indexes uppercase and mixed-case image extensions under the actual card id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'polyheart-index-test-'));
  try {
    await mkdir(join(root, 'public/cards'), { recursive: true });
    // The indexer matches against an exported pack, which writes a flat `name`.
    await mkdir(join(root, 'packs'), { recursive: true });
    await writeFile(join(root, 'packs/srd.json'), JSON.stringify({
      domainCards: [{ name: 'Power Slash' }, { name: 'Iron Stance' }],
    }));
    await writeFile(join(root, 'public/cards/power-slash.JPG'), 'indexing does not decode images');
    await writeFile(join(root, 'public/cards/iron-stance.PnG'), 'fixture');
    execFileSync(process.execPath, [resolve('tools/index-card-art.mjs')], { cwd: root });
    expect(JSON.parse(await readFile(join(root, 'public/cards/index.json'), 'utf8'))).toEqual({
      'iron-stance': 'iron-stance.PnG', 'power-slash': 'power-slash.JPG',
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
