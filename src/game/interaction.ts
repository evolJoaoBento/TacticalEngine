/**
 * Creatures that can be talked to: into a fight, out of one, or round.
 *
 * A placed creature's `interaction` (`scene/schema.ts`) names a conversation and when it is had.
 * `friendly` stands it up on nobody's side, and a click on it talks rather than swings (`talkTo`).
 * `threshold` stands it up hostile, and the first blow that leaves it at or under its share of Hit
 * Points stops it (`playTurnings`): it turns friendly, the fight holds while the conversation is
 * open, and whatever the conversation leaves it as it stays. It never stops a second time.
 *
 * The conversation is a script that stops on `startDialogue`, as the pillar's does. What makes it
 * about a creature is that the creature is bound as its `target` all the way through, so a reply
 * or a consequence node that turns "them" hostile (`setAttitude`) means this one - and turned
 * hostile with no fight running, it starts the fight its encounter holds (`reactToAttitudes`).
 */

import { ScriptRunner, type JournalEntry } from '../engine/script/runner';
import type { AdversaryInteraction, AdversaryPlacement, SceneDoc } from '../engine/scene/schema';
import { closeFight, record, runGmTurn, settle, settleFight, type DemoScene, type UseOutcome } from './demo-scene';
import { inCombat } from './moment';
import { closeToStrike, startEncounter } from './movement';

/** The placement a creature was stood up from, and the encounter that placed it. */
function placementOf(scene: SceneDoc, id: string): { placement: AdversaryPlacement; encounter: string } | null {
  for (const encounter of scene.encounters) {
    const placement = encounter.adversaries.find((placed) => placed.id === id);
    if (placement !== undefined) return { placement, encounter: encounter.id };
  }
  return null;
}

/** What a creature says besides fighting, if anything. */
export function interactionOf(scene: SceneDoc, id: string): AdversaryInteraction | null {
  return placementOf(scene, id)?.placement.interaction ?? null;
}

/** Whether a click on this creature talks rather than swings: it is on nobody's side, and has something to say. */
export function talksTo(demo: Pick<DemoScene, 'scene' | 'state'>, id: string): boolean {
  const entity = demo.state.entity(id);
  return entity !== undefined && entity.alive && entity.faction === 'neutral' && interactionOf(demo.scene, id) !== null;
}

/**
 * Walk up to a creature on nobody's side and talk to it. In a fight the talk is the action, as
 * opening a chest is; a walk that falls short is the action instead, and nothing is said.
 */
export function talkTo(demo: DemoScene, actor: string, id: string): UseOutcome {
  const interaction = interactionOf(demo.scene, id);
  const target = demo.state.entity(id);
  if (interaction === null || target === undefined) return { status: 'missing', lines: [] };
  if (closeToStrike(demo, actor, target, 'melee') === 'short') return { status: 'unreachable', lines: [] };
  if (inCombat(demo)) demo.encounter!.act(actor);
  return converse(demo, actor, id, interaction.dialogue);
}

/**
 * Open a creature's conversation, with the creature bound as the `target` of everything in it.
 * When it ends, the fight is counted again: the one who was talked round may have been the last
 * who wanted it, and one turned back may be the first of a new one. And a GM's turn it stopped in
 * the middle of - a reaction's blow, a creature walking into the party's fire - plays on from
 * where it stopped, as it does after a defender answers.
 */
function converse(demo: DemoScene, actor: string, id: string, dialogue: string): UseOutcome {
  demo.scenario.actorId = actor;
  const runner = new ScriptRunner(demo.world, demo.rng, { targets: [id] });
  const result = runner.run([{ kind: 'startDialogue', dialogue }]);
  const lines = record(demo, result.journal);
  if (result.status !== 'waiting') return { status: 'done', lines };
  const onDone = (): void => {
    if (demo.encounter !== null) settleFight(demo);
    if (demo.pending === null && demo.gmTurn !== null) runGmTurn(demo);
  };
  demo.pending = { kind: 'script', runner, prompt: result.prompt, interactable: null, recorded: result.journal.length, dialogue: null, with: id, onDone };
  return settle(demo, lines);
}

/**
 * The first blow that leaves a threshold creature at or under its share of Hit Points stops it:
 * it turns friendly, and its conversation opens while the fight holds. Called where a wound is
 * answered (`settleFight`), and only with nothing else waiting - one conversation at a time. A
 * creature the blow killed is defeated, not talked round: the dead do not stop to talk.
 */
export function playTurnings(demo: DemoScene): void {
  if (demo.pending !== null) return;
  for (const entity of demo.state.entitiesOf('adversary')) {
    const interaction = interactionOf(demo.scene, entity.id);
    if (interaction?.kind !== 'threshold' || !entity.alive || entity.interacted === true) continue;
    const left = entity.hitPoints.max - entity.hitPoints.marked;
    if (left * 100 > interaction.percent * entity.hitPoints.max) continue;
    entity.interacted = true;
    if (demo.world.setAttitude(entity.id, 'friendly')) record(demo, [{ kind: 'attitude', id: entity.id, attitude: 'friendly' }]);
    const actor = demo.party.selected ?? demo.state.entitiesOf('party').find((member) => member.alive)?.id;
    if (actor !== undefined) converse(demo, actor, entity.id, interaction.dialogue);
    return;
  }
}

/**
 * A creature turned hostile with no fight running starts the fight its encounter holds - a fresh
 * one, when the last one ended because nobody was left who wanted it.
 */
export function reactToAttitudes(demo: DemoScene, journal: readonly JournalEntry[]): void {
  for (const entry of journal) {
    if (entry.kind !== 'attitude' || entry.attitude !== 'hostile' || inCombat(demo)) continue;
    const encounter = placementOf(demo.scene, entry.id)?.encounter;
    if (encounter === undefined) continue;
    if (demo.encounter?.encounterId === encounter) demo.encounter = null;
    startEncounter(demo, encounter);
  }
}

/** How a fight that is over ended: with every creature in it talked round, or with the last one down. */
export function fightOverLine(demo: Pick<DemoScene, 'state'>): string {
  return demo.state.entitiesOf('adversary').length === 0
    ? 'Nobody is left who wants a fight. It is over.'
    : 'The last of them falls. The fight is over.';
}

/**
 * A script's End a fight stops the fight it names - the running one, or one its creatures are in -
 * and every enemy still standing stands down: on nobody's side, marked `truce`, until the next
 * fight in the room begins (`startEncounter` turns them back) or somebody strikes one of them.
 */
export function stopScriptedFights(demo: DemoScene, journal: readonly JournalEntry[]): void {
  for (const entry of journal) {
    if (entry.kind !== 'encounter' || entry.change !== 'ended' || !inCombat(demo)) continue;
    const placed = demo.scene.encounters.find((encounter) => encounter.id === entry.id)?.adversaries ?? [];
    const inIt = demo.encounter!.encounterId === entry.id || placed.some((p) => demo.state.entity(p.id)?.faction === 'adversary');
    if (!inIt) continue;
    for (const creature of demo.state.entitiesOf('adversary')) {
      if (!creature.alive) continue;
      demo.state.setAttitude(creature.id, 'friendly');
      creature.truce = true;
    }
    // Stopped mid-turn, the GM's turn goes with it.
    demo.gmTurn = null;
    demo.encounter!.end('stopped');
    closeFight(demo);
  }
}

/** A blow at a creature an End a fight stood down begins its encounter's fight again, and it is hostile once more. */
export function resumeOnBlow(demo: DemoScene, targetId: string): void {
  if (demo.state.entity(targetId)?.truce !== true || inCombat(demo)) return;
  const encounter = placementOf(demo.scene, targetId)?.encounter;
  if (encounter === undefined) return;
  if (demo.encounter?.encounterId === encounter) demo.encounter = null;
  startEncounter(demo, encounter);
}
