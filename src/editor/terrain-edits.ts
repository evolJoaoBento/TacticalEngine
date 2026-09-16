/**
 * Editing the terrain palette: what a kind of ground is drawn with.
 *
 * Out of `session.ts` because that file is pinned at a size and this is a domain of its
 * own, the way the model edits are. Unlike those, it is imported where it is used rather
 * than re-exported from `session.ts` — two more lines there would put that file over its
 * pin, and a re-export is a convenience, not a contract.
 *
 * A project may declare no palette at all, which means "the engine's four". Naming a
 * model for one of them has to write the whole four down first: there is nowhere to hang
 * `floor`'s model until `floor` is a type the document knows about. Undo puts the
 * document back to having no palette, rather than leaving four types nobody asked for.
 */

import { DEFAULT_TERRAIN_TYPES } from '../engine/grid/terrain';
import type { ProjectDoc } from '../engine/scene/schema';
import type { Edit } from './session';

type DeclaredPalette = NonNullable<ProjectDoc['terrainPalette']>;

/** The four the engine ships, as a document would write them. */
function defaultPalette(): DeclaredPalette {
  return DEFAULT_TERRAIN_TYPES.map((type) => ({
    id: type.id,
    name: type.name,
    passable: type.passable,
    cost: type.cost,
    providesCover: type.providesCover,
    blocksSight: type.blocksSight,
  }));
}

/**
 * Draw every tile of one kind of ground with a model, or stop.
 *
 * `null` removes the naming rather than writing an empty id, so ground put back to being
 * coloured is the same document as ground that was never given a model — the same rule
 * `setAdversaryModel` follows for creatures.
 */
export function setTerrainModel(terrainId: string, modelId: string | null): Edit {
  let hadNoPalette = false;
  let before: string | undefined;
  let found = false;
  return {
    label: modelId === null ? `Clear ${terrainId} model` : `Draw ${terrainId} as ${modelId}`,
    apply(project) {
      hadNoPalette = project.terrainPalette === undefined;
      if (project.terrainPalette === undefined) project.terrainPalette = defaultPalette();
      const type = project.terrainPalette.find((t) => t.id === terrainId);
      found = type !== undefined;
      if (type === undefined) return;
      before = type.model;
      if (modelId === null) delete type.model;
      else type.model = modelId;
    },
    undo(project) {
      if (hadNoPalette) {
        delete project.terrainPalette;
        return;
      }
      const type = project.terrainPalette?.find((t) => t.id === terrainId);
      if (type === undefined) return;
      if (before === undefined) delete type.model;
      else type.model = before;
    },
    isNoop() {
      // Writing the four down is a change even when the model itself did not take.
      return !found && !hadNoPalette;
    },
  };
}
