import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { publicAssets } from './tools/build-public-assets.ts';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [publicAssets()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  resolve: {
    alias: {
      '@engine': dir('./src/engine'),
      '@editor': dir('./src/editor'),
      '@game': dir('./src/game'),
      '@content': dir('./src/engine/content'),
    },
  },
  server: { port: 8420, host: '127.0.0.1' },
  preview: { port: 8420, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
