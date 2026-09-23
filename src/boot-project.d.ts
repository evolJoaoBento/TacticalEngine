/**
 * How the page opens and whether it may save back, handed over by `tools/default-project.ts`.
 *
 * A virtual module rather than an environment variable read in the page, the way `shipped-models`
 * is: the dev server decides once, when it starts, and the page only reads the answer.
 */
declare module 'virtual:boot-project' {
  /** `file` opens `projects/default.json`; `builtin` opens the demo built from code, as tests do. */
  export const BOOT: 'file' | 'builtin';
  /** Whether the server will write the default project back when it is saved. */
  export const SAVES: boolean;
  export const PROJECT_URL: string;
  export const SAVE_URL: string;
  export const SAVE_HEADER: string;
}
