import { defineConfig } from '@playwright/test';

/**
 * The game as a friend reaches it through a tunnel (`npm run test:e2e:tunnel`, `docs/HOSTING.md`): the build
 * made for the Rust server, served by it over a scratch folder, behind a proxy that rewrites `Host` the way
 * the strictest tunnels do (`tests/tunnel/`). The browser asks for `friends.example`, which it is told is this
 * machine - so to the server the page comes from beyond it.
 */
export const SERVER_PORT = 8441;
export const TUNNEL_PORT = 8442;

export default defineConfig({
  testDir: 'tests/tunnel',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://friends.example:${TUNNEL_PORT}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    browserName: 'chromium',
    launchOptions: {
      args: [`--host-resolver-rules=MAP friends.example 127.0.0.1`, '--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--enable-webgl'],
    },
  },
  webServer: {
    command: 'node tests/tunnel/serve.mjs',
    env: { TUNNEL_SERVER_PORT: String(SERVER_PORT), TUNNEL_PORT: String(TUNNEL_PORT) },
    url: `http://127.0.0.1:${SERVER_PORT}/__accounts/me`,
    // Up when the server answers at all: `me` is 401 for nobody, which is an answer.
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
