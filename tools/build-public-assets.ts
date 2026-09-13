import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Keep private card art out of distributable builds, even when it exists locally. */
export function publicAssets(): Plugin {
  let directory: string | false = false;
  return {
    name: 'tactical-public-assets',
    apply: 'build',
    config: () => ({ build: { copyPublicDir: false } }),
    configResolved(config) { directory = config.publicDir || false; },
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
      if (directory) {
        try { await visit(directory); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      // Production starts with generated emblems; browser imports still take precedence.
      this.emitFile({ type: 'asset', fileName: 'cards/index.json', source: '{}\n' });
    },
  };
}
