/**
 * The models found in `public/models`, handed over by `tools/model-manifest.ts`.
 *
 * A virtual module rather than a file on disk: the list is read from the served
 * folder at startup, so a `.glb` dropped in is in the game without anything being
 * written down. The shape is the asset declaration a project carries.
 */
declare module 'virtual:shipped-models' {
  /** `ancestry`: the one it draws, as `projects/model-ancestries.json` keeps it (`tools/model-manifest.ts`). */
  export const SHIPPED_MODELS: readonly { id: string; url: string; scale: number; ancestry?: string }[];
  /** Where the editor sends a model's ancestry, and whether this server keeps it. */
  export const ANCESTRY_URL: string;
  export const ANCESTRY_SAVES: boolean;
  /** Where the editor sends a `.glb` to add to the engine's own models, in `public/models`. */
  export const MODEL_ADD_URL: string;
}
