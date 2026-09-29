/**
 * What kind of server this Vite is, for the plugins that answer differently: kept apart, importing
 * nothing, so every plugin can ask without importing another (`accounts.ts` imports `default-project.ts`,
 * which asks this).
 */

/** Whether this server keeps accounts: a dev server the tests are not using. */
export function keepsAccounts(command: 'serve' | 'build'): boolean {
  return command === 'serve' && process.env['TACTICAL_BOOT'] !== 'builtin';
}

/**
 * Whether this Vite passes routes to the Rust server (`rust-server.ts`): a dev server that keeps accounts,
 * and not Vitest's, which loads the same config as a dev server of its own.
 */
export function servesRust(command: 'serve' | 'build'): boolean {
  return keepsAccounts(command) && process.env['VITEST'] === undefined;
}

/**
 * Whether a build is the Rust server's (`npm run build:server`, Vite's `server` mode): a client that is
 * served by the Rust server, which saves - so the project, the models' ancestries and the art marks may
 * be saved from it, as from the dev server - and whose assets the server serves live from `public/`, so
 * the build copies none of them. Any other build is a static site: read-only, its assets copied in.
 */
export function forRustServer(mode: string): boolean {
  return mode === 'server';
}

/** Whether the page may save back what it changes: a dev server the tests are not using, or a build the Rust server serves. */
export function savesChanges(command: 'serve' | 'build', mode: string): boolean {
  return (command === 'serve' && process.env['TACTICAL_BOOT'] !== 'builtin') || forRustServer(mode);
}
