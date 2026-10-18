import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { publicAssets } from './tools/build-public-assets.ts';
import { modelManifest } from './tools/model-manifest.ts';
import { defaultProject } from './tools/default-project.ts';
import { artProvenance } from './tools/art-provenance.ts';
import { accounts } from './tools/accounts.ts';
import { store } from './tools/store.ts';
import { yourModels } from './tools/your-models.ts';
import { rustServer } from './tools/rust-server.ts';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// An object, not a function: `vitest.config.ts` spreads it. `vite build --mode server` (`npm run build:server`),
// the client the Rust server serves, goes into `dist-server` by way of `publicAssets`.
export default defineConfig({
  plugins: [publicAssets(), modelManifest(), defaultProject(), artProvenance(), accounts(), store(), yourModels(), rustServer()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  resolve: {
    alias: {
      '@engine': dir('./src/engine'),
      '@editor': dir('./src/editor'),
      '@game': dir('./src/game'),
      '@content': dir('./src/engine/content'),
      // The Basis Universal encoder an imported material's maps are compressed with (`editor/surface-import.ts`):
      // its package exports no path to its WebAssembly, which is fetched by URL, so its folder is named here (a folder:
      // an alias matches a name or what is under it, never a name with `?url` after it).
      '@ktx2-encoder-basis': dir('./node_modules/ktx2-encoder/dist/basis'),
    },
  },
  // 8420 or nothing: a restart that finds the port still held must fail, not slide onto 8421, the tests' own.
  server: { port: 8420, strictPort: true, host: '127.0.0.1' },
  preview: { port: 8420, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
