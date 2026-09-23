import { defineConfig } from '@playwright/test';

const PORT = 8421;

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
    env: { TACTICAL_BOOT: 'builtin' },
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 90_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
