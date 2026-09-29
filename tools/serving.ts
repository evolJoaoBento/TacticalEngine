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
