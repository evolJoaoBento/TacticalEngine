/**
 * The models found in `public/models`, handed over by `tools/model-manifest.ts`.
 *
 * A virtual module rather than a file on disk: the list is read from the served
 * folder at startup, so a `.glb` dropped in is in the game without anything being
 * written down. The shape is the asset declaration a project carries.
 */
declare module 'virtual:shipped-models' {
  export const SHIPPED_MODELS: readonly { id: string; url: string; scale: number }[];
}
