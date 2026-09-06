/**
 * The engine's own hooks: the few SRD cards whose mechanic is a computation
 * rather than a list of effects.
 *
 * These are the native door into `script/hooks.ts` — TypeScript, registered at
 * build time, reached from content by `{ kind: 'run', hook: '…' }`. They read
 * the world and queue effects, so everything they do still goes through the
 * one vocabulary and shows up in the log.
 *
 * A project can add its own in code it carries (`project.code[]`), or override
 * one of these by using the same id.
 */

import { defineHooks, type HookMap } from '../../script/hooks';
import type { ChoiceOption, Effect } from '../../script/schema';

export const SRD_HOOKS: HookMap = defineHooks({
  /**
   * Arcane Barrage: "spend any number of Hope and shoot magical projectiles…
   * Roll a number of d6s equal to the Hope spent." Any number is the part
   * data cannot write, so the options are built from the Hope actually held.
   */
  'arcane-barrage': (ctx) => {
    const actor = ctx.actor;
    const target = ctx.targets[0];
    if (actor === null || target === undefined) return;
    const hope = ctx.pool(actor, 'hope') ?? 0;
    if (hope < 1) {
      ctx.log('No Hope to spend: the projectiles never form.', 'system');
      return;
    }
    const options: ChoiceOption[] = [];
    for (let spent = 1; spent <= hope; spent++) {
      options.push({
        label: `${spent} Hope: ${spent}d6 magic`,
        effects: [
          { kind: 'spendHope', amount: spent },
          { kind: 'damage', dice: `${spent}d6`, type: 'magic', target: { kind: 'target' } },
        ],
      });
    }
    ctx.queue([{ kind: 'choice', title: 'Arcane Barrage', body: 'How much Hope goes into it?', options }]);
  },

  /**
   * Unleash Chaos: "spend any number of tokens … roll a number of d10s equal
   * to the tokens you spent". The tokens actually on the card decide how many
   * options there are, which is why this is code and not a list.
   */
  'unleash-chaos': (ctx) => {
    const actor = ctx.actor;
    const target = ctx.targets[0];
    if (actor === null || target === undefined) return;
    const held = ctx.tokens(actor, 'unleash-chaos');
    if (held < 1) {
      ctx.log('No chaos left to unleash.', 'system');
      return;
    }
    const options: ChoiceOption[] = [];
    for (let spent = 1; spent <= held; spent++) {
      options.push({
        label: `${spent} token${spent === 1 ? '' : 's'}: ${spent}d10 magic`,
        effects: [
          { kind: 'spendToken', ability: 'unleash-chaos', amount: spent },
          {
            kind: 'check',
            check: {
              trait: 'spellcast',
              difficulty: 'target',
              onSuccessWithHope: [{ kind: 'damage', dice: `${spent}d10`, type: 'magic' }],
            },
          },
        ],
      });
    }
    ctx.queue([{ kind: 'choice', title: 'Unleash Chaos', body: 'How much of it?', options }]);
  },

  /**
   * Spit Acid's aftermath: "must mark an Armor Slot without receiving its
   * benefits. If they can't, they must mark an additional HP and you gain a
   * Fear." Which of the two happens is decided per target, which is why it is
   * code: a branch decides for the whole list.
   */
  'spit-acid-armor': (ctx) => {
    for (const id of ctx.hit) {
      const room = ctx.pool(id, 'armorSlots') ?? 0;
      if (room > 0) {
        ctx.queue([{ kind: 'markArmor', amount: 1, target: { kind: 'entity', id } }]);
      } else {
        ctx.queue([
          { kind: 'damage', amount: 1, direct: true, target: { kind: 'entity', id } },
          { kind: 'gainFear' },
        ]);
      }
    }
  },

  /**
   * Wild Flame: "up to three adversaries within Melee range". Which three is
   * the player's call at the table; nearest-first is the engine's, and the
   * cap is the part the selector cannot express.
   */
  'wild-flame': (ctx) => {
    const reached = ctx.select({ kind: 'adversaries', range: 'melee' }).slice(0, 3);
    if (reached.length === 0) {
      ctx.log('Nothing stands close enough to burn.', 'system');
      return;
    }
    const effects: Effect[] = [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'entities', ids: reached },
          onSuccessWithHope: [
            { kind: 'damage', dice: '2d6', type: 'magic' },
            { kind: 'markStress', target: { kind: 'hit' } },
          ],
        },
      },
    ];
    ctx.queue(effects);
  },
});
