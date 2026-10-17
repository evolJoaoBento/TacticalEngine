/**
 * How the engine's art was made, where it has been changed from each kind's rule: `projects/art-provenance.json`,
 * handed over by `tools/art-provenance.ts`. Keys are `model:<id>`, `card:<id>` or `equipment:<file>`.
 */
declare module 'virtual:art-provenance' {
  export const PROVENANCE: Readonly<Record<string, 'ai-generated' | 'ai-assisted' | 'human-made'>>;
  /** Where the editor sends a change, and whether this server keeps it. */
  export const PROVENANCE_URL: string;
  export const PROVENANCE_SAVES: boolean;
}
