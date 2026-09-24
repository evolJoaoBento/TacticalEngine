/**
 * Editing what a placed creature says besides fighting: its interaction (`AdversaryInteraction`).
 *
 * Out of `session.ts` because that file is pinned at a size, the way the model edits are. One edit
 * sets the whole setting or clears it, so a kind, a conversation and a threshold changed together
 * are one undo step.
 */

import type { AdversaryInteraction } from '../engine/scene/schema';
import type { Edit } from './session';

/** Give a placed creature an interaction, or take it away with `null`. */
export function setCreatureInteraction(sceneId: string, encounterId: string, placementId: string, interaction: AdversaryInteraction | null): Edit {
  let before: AdversaryInteraction | undefined;
  let found = false;
  const placementIn = (project: Parameters<Edit['apply']>[0]) =>
    project.scenes.find((scene) => scene.id === sceneId)?.encounters.find((e) => e.id === encounterId)?.adversaries.find((a) => a.id === placementId);
  return {
    label: interaction === null ? 'Creature has nothing to say' : 'Creature interaction',
    apply(project) {
      const placement = placementIn(project);
      found = placement !== undefined;
      if (placement === undefined) return;
      before = placement.interaction;
      if (interaction === null) delete placement.interaction;
      else placement.interaction = structuredClone(interaction);
    },
    undo(project) {
      const placement = placementIn(project);
      if (!found || placement === undefined) return;
      if (before === undefined) delete placement.interaction;
      else placement.interaction = before;
    },
  };
}
