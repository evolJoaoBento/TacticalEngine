import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const PORT = 8435;

/**
 * A peer game from a static build (`docs/PEER.md`): `npm run build`, served by `vite preview` - no dev server, no
 * Rust server - and the peer specs played on it: the codes, the lobby, each playing their own, a guest coming back,
 * a save hosted again. Not the menu's, nor the fight's, which puts a character beside the door by the test driver's
 * hand (`placeAt`) - a build's table refuses that as the server's does. `npm run test:e2e:peer-static`.
 */
export default defineConfig({
  ...base,
  testMatch: /peer(-rejoin|-saves)?\.spec\.ts/,
  grep: /each playing their own|comes back in the same tab|opened again|hosted again another evening/,
  use: { ...base.use, baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
