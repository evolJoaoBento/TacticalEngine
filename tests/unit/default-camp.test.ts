/**
 * The camp in the default project, played from the file: Wren the Wandering Bard gives the party a
 * quest in conversation and pays for it through a consequence node; Tobin the Pedlar, a step away,
 * sells, and buys back at his own stingy rate. Conversation, consequence and trade in one scene.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { projectSchema } from '../../src/engine/scene/schema';
import { buildProjectScene, type DemoScene } from '../../src/game/demo-scene';
import { offerFor, shopOf } from '../../src/game/shop';

const camp = (): DemoScene => {
  const demo = buildProjectScene(projectSchema.parse(JSON.parse(readFileSync('projects/default.json', 'utf8'))), 'camp');
  demo.askDefender = false;
  return demo;
};

describe('the camp by the fire', () => {

  it('has Tobin buy back at four in ten of what a thing is worth, and nothing for the songbook', () => {
    const demo = camp();
    const shop = shopOf(demo, 'tobin')!;
    expect(shop.buysAt).toBe(40);
    // His own potion at 6 fetches 2; a broadsword card, worth 10, fetches 4; the songbook has no worth.
    expect(offerFor(demo, shop, 'consumable-minor-health-potion')).toBe(2);
    expect(offerFor(demo, shop, 'primary-broadsword')).toBe(4);
    expect(offerFor(demo, shop, 'wrens-songbook')).toBe(0);
  });
});
