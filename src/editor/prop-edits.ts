/**
 * Editing a prop that is already down, and the remixes a project keeps.
 *
 * Kept apart from `session.ts`, which is pinned at its size, the way `move-edits.ts` and
 * `card-edits.ts` are. Like those, every edit here finds its subject afresh whenever it runs, so
 * an undo or a redo lands on the same prop however the list round it has moved since.
 *
 * A **remix** is a prop with its settings remembered: a model, how many tiles across it is drawn,
 * the way it faces, and whether it stops a walk. It is not a new model and it is not a copy of
 * one - it is the settings you would otherwise dial in by hand every time you wanted another
 * six-tile boulder facing north that people cannot stroll through. They belong to the project
 * rather than to the editor's session, because a room built out of them is only reproducible by
 * whoever opens the file if they arrive with it.
 */

import type { Deco, ProjectDoc } from '../engine/scene/schema';
import type { PropFunction } from '../engine/scene/prop-function-schema';
import type { Edit } from './session';

/** A prop's settings, saved under a name. */
export interface PropPreset {
  id: string;
  label: string;
  model: string;
  /** How many tiles across, when that is not one. */
  span?: number;
  /** Which way it faces, in radians, when that is not straight on. */
  rotation?: number;
  /** Whether props placed from it are obstacles rather than scenery. */
  solid?: boolean;
  /** What props placed from it do when used: a Door remix, a Container of three potions. */
  function?: PropFunction;
}

const decoAt = (project: ProjectDoc, sceneId: string, index: number): Deco | undefined =>
  project.scenes.find((scene) => scene.id === sceneId)?.decos[index];

/**
 * Draw a prop that is already down across a different block.
 *
 * The anchor does not move - the tile it was placed on stays the block's north-west corner - so a
 * prop grows south and east from where it is rather than creeping away from the spot it was put.
 */
export function resizeDeco(sceneId: string, index: number, span: number): Edit {
  let before: number | undefined;
  let had = false;
  return {
    label: 'Resize prop',
    apply(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco === undefined) return;
      had = Object.hasOwn(deco, 'span');
      before = deco.span;
      // One is what a prop with nothing written about it already is, so nothing is written.
      if (span <= 1) delete deco.span;
      else deco.span = span;
    },
    undo(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco === undefined) return;
      if (had) deco.span = before;
      else delete deco.span;
    },
  };
}

/**
 * Say whether a prop that is already down stops a walk.
 *
 * Off is what a prop has always been and is therefore what is written when it is off: nothing.
 */
export function solidifyDeco(sceneId: string, index: number, solid: boolean): Edit {
  let before: boolean | undefined;
  let had = false;
  return {
    label: solid ? 'Make prop solid' : 'Make prop scenery',
    apply(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco === undefined) return;
      had = Object.hasOwn(deco, 'solid');
      before = deco.solid;
      if (solid) deco.solid = true;
      else delete deco.solid;
    },
    undo(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco === undefined) return;
      if (had) deco.solid = before;
      else delete deco.solid;
    },
  };
}

/**
 * Give a prop that is already down a function, or take its function away.
 *
 * A prop that can be used is found by its id, so one is given it here if it has none - once, and
 * kept after, since a script or a save may already be naming it by then. Taking the function away
 * leaves the id where it is for the same reason.
 */
export function functionDeco(sceneId: string, index: number, fn: PropFunction | undefined, id: string): Edit {
  let before: { function?: PropFunction; id?: string } = {};
  return {
    label: fn === undefined ? 'Clear prop function' : 'Set prop function',
    apply(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco === undefined) return;
      before = { ...(deco.function === undefined ? {} : { function: deco.function }), ...(deco.id === undefined ? {} : { id: deco.id }) };
      if (fn === undefined) delete deco.function;
      else {
        deco.function = structuredClone(fn);
        deco.id ??= id;
      }
    },
    undo(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco === undefined) return;
      if (before.function === undefined) delete deco.function;
      else deco.function = before.function;
      if (before.id === undefined) delete deco.id;
      else deco.id = before.id;
    },
  };
}

/** Draw a prop that is already down with another model. Its function, size and place stay as they are. */
export function remodelDeco(sceneId: string, index: number, model: string): Edit {
  let before: string | null = null;
  return {
    label: 'Change prop model',
    apply(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco === undefined) return;
      before = deco.model;
      deco.model = model;
    },
    undo(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco !== undefined && before !== null) deco.model = before;
    },
  };
}

/** Turn a prop that is already down to a facing, rather than by a step. */
export function faceDeco(sceneId: string, index: number, rotation: number): Edit {
  let before: number | null = null;
  return {
    label: 'Turn prop',
    apply(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco === undefined) return;
      before = deco.rotation;
      deco.rotation = rotation;
    },
    undo(project) {
      const deco = decoAt(project, sceneId, index);
      if (deco !== undefined && before !== null) deco.rotation = before;
    },
  };
}

/** Keep the settings in hand under a name, so the same prop can be placed again without setting up. */
export function addPropPreset(preset: PropPreset): Edit {
  return {
    label: `Save remix ${preset.label}`,
    apply(project) {
      project.propPresets = [...(project.propPresets ?? []), preset];
    },
    undo(project) {
      const left = (project.propPresets ?? []).filter((saved) => saved.id !== preset.id);
      // An empty list is the same as never having had one, and says less in the file.
      if (left.length === 0) delete project.propPresets;
      else project.propPresets = left;
    },
  };
}

/** Forget a remix. The props placed from it are untouched: they were only ever ordinary props. */
export function removePropPreset(id: string): Edit {
  let removed: { preset: PropPreset; index: number } | null = null;
  return {
    label: 'Remove remix',
    apply(project) {
      const presets = project.propPresets ?? [];
      const index = presets.findIndex((preset) => preset.id === id);
      if (index < 0) return void (removed = null);
      removed = { preset: presets[index]!, index };
      const left = presets.filter((_, at) => at !== index);
      if (left.length === 0) delete project.propPresets;
      else project.propPresets = left;
    },
    undo(project) {
      if (removed === null) return;
      const presets = [...(project.propPresets ?? [])];
      presets.splice(removed.index, 0, removed.preset);
      project.propPresets = presets;
    },
  };
}

/**
 * A name for a remix nobody has named: what it is, how big, and whether it is an obstacle.
 *
 * Solid is said out loud because it is the one setting that cannot be seen on the board. Two
 * remixes of the same model at the same size, one scenery and one an obstacle, would otherwise
 * be two cards with the same name and no way to tell them apart.
 */
export function presetLabel(model: string, span: number, solid = false, does?: string): string {
  const words = model.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const size = span > 1 ? `${words} ${span}×${span}` : words;
  const kind = does === undefined ? size : `${size} · ${does}`;
  return solid ? `${kind} · solid` : kind;
}
