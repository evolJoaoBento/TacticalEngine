/**
 * Using what the party carries.
 *
 * An item's `use` effects run through the same runner as an object's, so this
 * is a short front on `demo-scene.ts`'s script machinery: spend the item, run
 * it, and hand what it left to `settle`. Nothing in `demo-scene.ts` calls back
 * into here.
 */

import { ScriptRunner } from '../engine/script/runner';
import { record, settle, type DemoScene, type UseOutcome } from './demo-scene';
import { inCombat } from './moment';
import { settleTravel } from './room';
import { note } from './log';
import { itemOf } from '../engine/content/equipment/catalogue';

/**
 * Use a carried item, with whoever is selected as the actor.
 *
 * The item's `use` effects run through the same runner as an object's, so a
 * draught can heal, a scroll can start a conversation, and a script that stops
 * to ask something is answered through `answerPending` like any other. A
 * consumable is spent first — before its effects run, so a `loot` inside them
 * cannot hand it back. In a fight, using something is the character's action.
 */
export function useItem(demo: DemoScene, itemId: string): UseOutcome {
  if (demo.pending !== null) return { status: 'busy', lines: [] };
  const item = itemOf(demo.project, itemId);
  if (item === undefined) return { status: 'missing', lines: [] };
  const actor = demo.party.selected;
  if (actor === null) return { status: 'unreachable', lines: [] };
  if ((demo.scenario.items.get(itemId) ?? 0) < 1) {
    return { status: 'refused', lines: note(demo, `The party is not carrying ${item.name}.`, 'system') };
  }
  if (item.use.length === 0) {
    return { status: 'refused', lines: note(demo, `There is nothing to do with ${item.name}.`, 'system') };
  }
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(actor)) {
    return { status: 'refused', lines: note(demo, 'There is no time — you have acted.', 'system') };
  }

  demo.scenario.actorId = actor;
  if (item.kind === 'consumable') demo.world.removeItem(itemId, 1);
  if (fighting) demo.encounter!.act(actor);
  const who = demo.sheets.get(actor)?.name ?? actor;
  const lines = note(demo, `${who} uses the ${item.name}.`, 'system');

  const runner = new ScriptRunner(demo.world, demo.rng);
  const result = runner.run(item.use);
  lines.push(...record(demo, result.journal));
  if (result.status === 'waiting') {
    demo.pending = { kind: 'script', runner, prompt: result.prompt, interactable: null, recorded: result.journal.length, dialogue: null };
    return settle(demo, lines);
  }
  return settleTravel(demo, lines);
}
