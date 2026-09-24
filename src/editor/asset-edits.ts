/**
 * Editing an imported model's declaration: adding one, removing one, and tuning
 * how it sits on a tile.
 *
 * Out of `session.ts` because that file is pinned at a size and these are a
 * domain of their own, the way the creature and card edits are. `session.ts`
 * still hands them out, so nothing that runs them has to know they moved.
 */

import type { ModelAsset } from '../engine/render/assets';
import { modelNamesIn } from '../engine/scene/model-references';
import type { ProjectDoc } from '../engine/scene/schema';
import type { Edit } from './session';

/**
 * The project as a save writes it: without the embedded models - imported into the Models panel,
 * carried as data URLs - that nothing in it names. The browser remembers every model it imported
 * (`model-memory.ts`) and lays them back under a project as it opens, so a save used to write every
 * one of them into the file, placed or not, and a project that used none of four Meshy models
 * carried 80 MB of them. One that is placed is kept, so the file still draws everything in it; one
 * left out is still remembered, and still offered in the editor.
 *
 * `alsoNamed` is what the game draws by that the project does not say: its own table of models.
 * The project being edited is not touched - the answer is a copy, or the same object when there is
 * nothing to leave out.
 */
export function withoutUnusedEmbedded(project: ProjectDoc, alsoNamed: Iterable<string> = []): ProjectDoc {
  const named = modelNamesIn(project);
  for (const id of alsoNamed) named.add(id);
  const kept = project.assets.filter((asset) => !asset.url.startsWith('data:') || named.has(asset.id));
  return kept.length === project.assets.length ? project : { ...project, assets: kept };
}

export function addAsset(asset: ModelAsset): Edit {
  return {
    label: `Add model ${asset.id}`,
    apply(project) {
      project.assets.push(asset);
    },
    undo(project) {
      const at = project.assets.lastIndexOf(asset);
      if (at >= 0) project.assets.splice(at, 1);
    },
  };
}

export function removeAsset(assetId: string): Edit {
  let removed: { index: number; asset: ModelAsset } | null = null;
  return {
    label: 'Delete model',
    apply(project) {
      removed = null;
      const index = project.assets.findIndex((a) => a.id === assetId);
      if (index < 0) return;
      removed = { index, asset: project.assets[index]! };
      project.assets.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.assets.splice(removed.index, 0, removed.asset);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/**
 * Change an imported model's settings: how big it is, how it sits on a tile,
 * which way it faces, and which of the file's clips play for each state.
 *
 * The id and the file itself are deliberately not editable here. Swapping the
 * file under a name that content already refers to is a different act with
 * different consequences, and goes through remove and add.
 *
 * `clips: null` drops the mapping rather than leaving empty names behind, so a
 * model put back to "just loop the first clip" is the same document as one that
 * never named a clip at all.
 */
export function updateAsset(
  assetId: string,
  changes: {
    scale?: number;
    groundOffset?: number;
    rotationY?: number;
    offsetX?: number;
    offsetY?: number;
    clips?: ModelAsset['clips'] | null;
    /** `file` to hold it by the file's own origin; anything else, named, puts it back on its base. */
    pivot?: ModelAsset['pivot'] | null;
  },
): Edit {
  let before: ModelAsset | null = null;
  return {
    label: `Edit model ${assetId}`,
    apply(project) {
      before = null;
      const asset = project.assets.find((a) => a.id === assetId);
      if (asset === undefined) return;
      // A shallow copy is enough: `clips` is replaced or deleted, never edited
      // in place, so the copy never shares a mutated object with the document.
      before = { ...asset };
      if (changes.scale !== undefined) asset.scale = changes.scale;
      if (changes.groundOffset !== undefined) asset.groundOffset = changes.groundOffset;
      if (changes.rotationY !== undefined) asset.rotationY = changes.rotationY;
      if (changes.offsetX !== undefined) asset.offsetX = changes.offsetX;
      if (changes.offsetY !== undefined) asset.offsetY = changes.offsetY;
      if ('clips' in changes) {
        if (changes.clips === null || changes.clips === undefined) delete asset.clips;
        else asset.clips = changes.clips;
      }
      // Seated is the default and says nothing: only a model held by its own pivot says so.
      if ('pivot' in changes) {
        if (changes.pivot === 'file') asset.pivot = 'file';
        else delete asset.pivot;
      }
    },
    undo(project) {
      if (before === null) return;
      const index = project.assets.findIndex((a) => a.id === assetId);
      if (index < 0) return;
      project.assets[index] = before;
    },
    isNoop() {
      return before === null;
    },
  };
}
