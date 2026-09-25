/**
 * The camp in the default project, played from the file: Wren the Wandering Bard gives the party a
 * quest in conversation and pays for it through a consequence node; Tobin the Pedlar, a step away,
 * sells, and buys back at his own stingy rate. Conversation, consequence and trade in one scene.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { projectSchema } from '../../src/engine/scene/schema';
import { answerPending, attackWithSelected, buildProjectScene, type DemoScene } from '../../src/game/demo-scene';
import { scriptPending } from '../../src/game/moment';
import { offerFor, shopOf } from '../../src/game/shop';

const camp = (): DemoScene => {
  const demo = buildProjectScene(projectSchema.parse(JSON.parse(readFileSync('projects/default.json', 'utf8'))), 'camp');
  demo.askDefender = false;
  return demo;
};

const replies = (demo: DemoScene): string[] => scriptPending(demo)?.dialogue?.view?.options.map((o) => o.text) ?? [];
/** Pick a reply by what it says, then walk on through whatever is said until there is a choice again. */
function say(demo: DemoScene, text: string): void {
  const view = scriptPending(demo)!.dialogue!.view!;
  answerPending(demo, { kind: 'choose', index: view.options.find((o) => o.text === text)!.index });
  for (let i = 0; i < 5 && demo.pending !== null && replies(demo).length === 0; i++) answerPending(demo, { kind: 'continue' });
}
const gold = (demo: DemoScene): number => {
  let held = 0;
  while (demo.world.hasItem('gold', held + 1)) held++;
  return held;
};

describe('the camp by the fire', () => {
  it("gives Wren's quest in conversation, and asks for the songbook only once the party has it", () => {
    const demo = camp();
    attackWithSelected(demo, 'wren');
    expect(replies(demo)).toContain('Is something wrong?');
    expect(replies(demo)).not.toContain('We found your songbook.');
    say(demo, 'Is something wrong?');
    say(demo, 'We will find it.');
    expect(demo.world.questStatus('the-lost-verse')).toBe('active');
    // Asked once: the question is gone, and still nothing to hand over.
    expect(replies(demo)).not.toContain('Is something wrong?');
    expect(replies(demo)).not.toContain('We found your songbook.');
    say(demo, 'Farewell.');
    for (let i = 0; i < 5 && demo.pending !== null; i++) answerPending(demo, { kind: 'continue' });

    // The crate in the vault is where it waits.
    const crate = demo.scene.decos.find((deco) => deco.id === 'crate-prop-15-14')!;
    expect(crate.function).toEqual({ kind: 'container', items: [{ item: 'wrens-songbook', count: 1 }] });
  });

  it('pays for the songbook through a consequence: the book goes, the quest is done, and 15 gold comes', () => {
    const demo = camp();
    attackWithSelected(demo, 'wren');
    say(demo, 'Is something wrong?');
    say(demo, 'We will find it.');
    say(demo, 'Farewell.');
    for (let i = 0; i < 5 && demo.pending !== null; i++) answerPending(demo, { kind: 'continue' });
    demo.world.addItem('wrens-songbook', 1);

    attackWithSelected(demo, 'wren');
    expect(replies(demo)).toContain('We found your songbook.');
    say(demo, 'We found your songbook.');
    expect(demo.world.hasItem('wrens-songbook', 1)).toBe(false);
    expect(demo.world.questStatus('the-lost-verse')).toBe('completed');
    expect(gold(demo)).toBe(15);
    expect(replies(demo)).not.toContain('We found your songbook.');
  });

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
