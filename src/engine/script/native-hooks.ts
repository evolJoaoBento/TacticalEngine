/**
 * The engine's native hooks: the few card mechanics that are a computation rather than a list
 * of effects.
 *
 * These are engine code, not content. They live here rather than under `content/` because they
 * outlast any particular catalogue: a pack that ships a card saying "spend any number of Light"
 * needs this to run, and a card naming a hook the engine does not have is inert.
 *
 * These are the native door into `script/hooks.ts` — TypeScript, registered at
 * build time, reached from content by `{ kind: 'run', hook: '…' }`. They read
 * the world and queue effects, so everything they do still goes through the
 * one vocabulary and shows up in the log.
 *
 * A project can add its own in code it carries (`project.code[]`), or override
 * one of these by using the same id.
 */

import { defineHooks, type HookMap } from './hooks';
import type { ChoiceOption, Effect } from './schema';

export const SRD_HOOKS: HookMap = defineHooks({
  /**
   * Arcane Barrage: "spend any number of Light and shoot magical projectiles…
   * Roll a number of d6s equal to the Light spent." Any number is the part
   * data cannot write, so the options are built from the Light actually held.
   */
  'arcane-barrage': (ctx) => {
    const actor = ctx.actor;
    const target = ctx.targets[0];
    if (actor === null || target === undefined) return;
    const good = ctx.pool(actor, 'good') ?? 0;
    if (good < 1) {
      ctx.log('No Light to spend: the projectiles never form.', 'system');
      return;
    }
    const options: ChoiceOption[] = [];
    for (let spent = 1; spent <= good; spent++) {
      options.push({
        label: `${spent} Light: ${spent}d6 magic`,
        effects: [
          { kind: 'spendGood', amount: spent },
          { kind: 'damage', dice: `${spent}d6`, type: 'magic', target: { kind: 'target' } },
        ],
      });
    }
    ctx.queue([{ kind: 'choice', title: 'Arcane Barrage', body: 'How much Light goes into it?', options }]);
  },

  /**
   * "The target must mark an Armor Slot without receiving its benefits. If
   * they can't mark an Armor Slot, they must mark an additional HP" — Spit
   * Acid's aftermath, and the same sentence on four other blocks. Which of the
   * two happens is decided per target, which is why it is code: an effect list
   * branches for the whole list at once.
   *
   * `args.bad` adds the Shadow that Spit Acid alone hands the GM.
   */
  'mark-armor-or-hit-point': (ctx) => {
    for (const id of ctx.hit) {
      const room = ctx.pool(id, 'armorSlots') ?? 0;
      if (room > 0) {
        ctx.queue([{ kind: 'markArmor', amount: 1, target: { kind: 'entity', id } }]);
      } else {
        ctx.queue([
          { kind: 'damage', amount: 1, direct: true, target: { kind: 'entity', id } },
          ...(ctx.args.bad === true ? [{ kind: 'gainBad' as const }] : []),
        ]);
      }
    }
  },

  /**
   * Falling Sky: "mark any number of Stress … 1d20+2 magic damage for each
   * Stress marked". How many is the player's, and how many they *can* is the
   * sheet's, so the list of offers is built from the Stress actually free.
   */
  'falling-sky': (ctx) => {
    const actor = ctx.actor;
    if (actor === null) return;
    const free = ctx.pool(actor, 'stress', 'available') ?? 0;
    if (free < 1) {
      ctx.log('No Stress left to spend: the sky holds.', 'system');
      return;
    }
    const options: ChoiceOption[] = [];
    for (let spent = 1; spent <= free; spent++) {
      options.push({
        label: `${spent} Stress: ${spent}d20+${spent * 2} magic`,
        effects: [
          { kind: 'markStress', amount: spent, target: { kind: 'actor' } },
          {
            kind: 'check',
            check: {
              trait: 'spellcast',
              difficulty: 'target',
              targets: { kind: 'adversaries', range: 'far' },
              onSuccessWithGood: [{ kind: 'damage', dice: `${spent}d20+${spent * 2}`, type: 'magic' }],
            },
          },
        ],
      });
    }
    ctx.queue([{ kind: 'choice', title: 'Falling Sky', body: 'How much of yourself goes into it?', options }]);
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
          onSuccessWithGood: [
            { kind: 'damage', dice: '2d6', type: 'magic' },
            { kind: 'markStress', target: { kind: 'hit' } },
          ],
        },
      },
    ];
    ctx.queue(effects);
  },
});
