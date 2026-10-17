import { defineConfig } from '@playwright/test';
import { ON_SERVER, SERVER_PORT, SERVER_ROOT } from './tests/e2e/server-mode';

const PORT = 8421;

/**
 * `TACTICAL_E2E_SERVER=1` (`npm run test:e2e:server`): the same suite with its games played on a Rust server of
 * its own - started by the tests' server over a scratch folder, each test signed in to an account of its own
 * (`tests/e2e/fixtures.ts`) - the page
 * playing the engine built to WebAssembly, its own game beside it as the shadow (`tests/e2e/server-mode.ts`).
 */
const ON_SERVER_ENV: Record<string, string> = ON_SERVER
  ? { TACTICAL_E2E_SERVER: '1', TACTICAL_E2E_ROOT: SERVER_ROOT, TACTICAL_SERVER_PORT: String(SERVER_PORT), VITE_E2E_SERVER: '1', VITE_ENGINE: 'wasm' }
  : {};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      // The machine's own GPU through ANGLE, not SwiftShader: software rendering drew the demo at
      // two or three frames a second, which is what made screenshots time out and slow assertions
      // flake. The same browser on d3d11 runs it at forty.
      args: [
        '--use-gl=angle',
        '--use-angle=d3d11',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-swiftshader',
        '--enable-webgl',
      ],
    },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    // The suite runs on the demo built from code, never on the project somebody has been editing:
    // a test that assumes the vault's walls cannot pass on a room where they were moved, and this
    // server also refuses to save, so no test can overwrite that project by pressing Ctrl+S.
    env: { TACTICAL_BOOT: 'builtin', ...ON_SERVER_ENV },
    url: `http://127.0.0.1:${PORT}`,
    // Never somebody else's server: one already on this port is not the tests' - a dev server that slid
    // over from 8420 once ran a whole suite on the file-booted project, which saves, and a test's Ctrl+S
    // overwrote projects/default.json (29 September 2026). A taken port is an error, not a server to use.
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: ON_SERVER
    ? [
        { name: 'sign-in', testMatch: /sign-in\.setup\.ts/, use: { browserName: 'chromium' } },
        { name: 'chromium', dependencies: ['sign-in'], use: { browserName: 'chromium' } },
      ]
    : [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
