import { readdir, readFile } from 'node:fs/promises';
import { forRustServer } from './serving.ts';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Keep private card art out of distributable builds, even when it exists locally. A build the Rust server
 * serves (`forRustServer`) copies nothing at all: the server serves `public/` live - the card art to this
 * machine alone - and only the empty card index is the build's, for when it serves beyond it.
 */
export function publicAssets(): Plugin {
  let directory: string | false = false;
  let served = false;
  return {
    name: 'tactical-public-assets',
    apply: 'build',
    // A build for the Rust server goes into its own folder, beside a static site's `dist`.
    config: (_config, env) => ({ build: { copyPublicDir: false, ...(forRustServer(env.mode) ? { outDir: 'dist-server' } : {}) } }),
    configResolved(config) {
      directory = config.publicDir || false;
      served = forRustServer(config.mode);
    },
    async generateBundle() {
      const visit = async (path: string, prefix = ''): Promise<void> => {
        const entries = await readdir(path, { withFileTypes: true });
        for (const entry of entries) {
          if (prefix === '' && entry.name.toLowerCase() === 'cards') continue;
          const name = prefix + entry.name;
          if (entry.isDirectory()) await visit(join(path, entry.name), name + '/');
          else if (entry.isFile()) this.emitFile({ type: 'asset', fileName: name, source: await readFile(join(path, entry.name)) });
        }
      };
      if (directory && !served) {
        try { await visit(directory); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      // Production starts with generated emblems; browser imports still take precedence.
      this.emitFile({ type: 'asset', fileName: 'cards/index.json', source: '{}\n' });
    },
  };
}
