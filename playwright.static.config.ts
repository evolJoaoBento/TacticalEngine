import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const PORT = 8435;

/**
 * A peer game from a static build (`docs/PEER.md`): `npm run build`, served by `vite preview` - no dev server, no
 * Rust server - and the peer spec's first test played on it: the codes, the lobby, each playing their own. The
 * fight's test puts a character beside the door by the test driver's hand (`placeAt`), which a build's table refuses
 * as the server's does, so it is the development run's alone. `npm run test:e2e:peer-static`.
 */
export default defineConfig({
  ...base,
  testMatch: /peer\.spec\.ts/,
  grep: /each playing their own/,
  use: { ...base.use, baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
