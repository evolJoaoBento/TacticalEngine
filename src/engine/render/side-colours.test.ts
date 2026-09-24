/**
 * Which colour a creature's line is: the party white, a hostile creature red, a friendly one green,
 * and one a script's End a fight stood down yellow - and a token drawn again in its new colour the
 * moment its creature changes over.
 */

import { describe, it, expect } from 'vitest';
import { Color, type Mesh, type MeshBasicMaterial, type Object3D } from 'three';
import { TileGrid } from '../grid/grid';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { DEFAULT_FACTION_COLORS, OUTLINE_NAME, dim, outlineSide } from './faction-outline';
import { SceneView } from './scene-view';

const rimColour = (token: Object3D): string =>
  `#${((token.children.find((child) => child.name === OUTLINE_NAME) as Mesh).material as MeshBasicMaterial).color.getHexString()}`;
const resting = (side: string): string => `#${new Color(dim(DEFAULT_FACTION_COLORS[side]!)).getHexString()}`;

describe("a creature's line", () => {
  it('is white for the party, red for a foe, green for a friend and yellow for one stood down', () => {
    expect(DEFAULT_FACTION_COLORS.party).toBe('#ffffff');
    expect(DEFAULT_FACTION_COLORS.neutral).toBe('#5fbf6a');
    expect(DEFAULT_FACTION_COLORS.truce).toBe('#e6c23a');
    expect(outlineSide({ faction: 'party' })).toBe('party');
    expect(outlineSide({ faction: 'neutral' })).toBe('neutral');
    // Stood down reads as its own colour, whatever the side underneath says.
    expect(outlineSide({ faction: 'neutral', truce: true })).toBe('truce');
  });

  it('is drawn again in its new colour when the creature turns friendly, stands down, or turns back', () => {
    const grid = new TileGrid({ width: 6, height: 4 });
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(0, 0)));
    state.addEntity(createAdversaryEntity('foe', 'husk', grid.indexOf(4, 2), { hitPoints: 4, stress: 2 }));
    const view = new SceneView(grid, { fallbackFor: () => 'husk' });
    view.syncTokens(state);
    expect(rimColour(view.tokenFor('kara')!.group)).toBe(resting('party'));
    expect(rimColour(view.tokenFor('foe')!.group)).toBe(resting('adversary'));

    state.setAttitude('foe', 'friendly');
    view.syncTokens(state);
    expect(rimColour(view.tokenFor('foe')!.group)).toBe(resting('neutral'));

    state.entity('foe')!.truce = true;
    view.syncTokens(state);
    expect(rimColour(view.tokenFor('foe')!.group)).toBe(resting('truce'));

    delete state.entity('foe')!.truce;
    state.setAttitude('foe', 'hostile');
    view.syncTokens(state);
    expect(rimColour(view.tokenFor('foe')!.group)).toBe(resting('adversary'));
    view.dispose();
  });
});
