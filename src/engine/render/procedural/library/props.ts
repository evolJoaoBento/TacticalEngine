/**
 * Scenery props, ported from `legacy/js/models.js` - and all of them retired now.
 *
 * The pine, the dead tree, the barrel, the crate, the brazier, the cart, the training dummy, the
 * door, the chest, the portal, the banner, the rock, the campfire and the pillar were retired for
 * the models in `public/models` that took their places (`tree-prop`, `withering-tree-prop`,
 * `barrel-prop`, `crate-prop`, `standing-torch-prop`, `cart-prop`, `training-dummy-prop`,
 * `door-prop`, `chest-prop`, `portal-prop`, `banner-prop`, `rock-prop`, `camp-fire-prop`,
 * `pillar-prop`); a project that still names one is renamed as it opens (`RETIRED_MODELS`). The list
 * stays, empty, so the registry's shape does not change. The remaining legacy props (piano, throne,
 * hut, spotlight, barrier, gate, spectator, floorboard, trunk) belong to the one-shot and would
 * arrive as imported models, not here.
 */

import type { ProceduralModelSpec } from '../spec';

export const PROP_MODELS: readonly ProceduralModelSpec[] = [];
