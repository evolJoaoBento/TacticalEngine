/**
 * A starting value for each kind of effect the effect list can add (`EffectList.tsx`): what a designer picking
 * "Deal damage" or "Give a card" is shown first, filled from what the project has. Beside the list, which is longer
 * than a reader can follow.
 */

import type { Effect } from '../../engine/script/schema';
import type { Addable, EffectListProps } from './EffectList';

/** A starting value for each kind this can add. */
export function blank(kind: Addable, props: EffectListProps): Effect {
  switch (kind) {
    case 'log':
      return { kind: 'log', text: '', tone: 'narration' };
    case 'setFlag':
    case 'clearFlag':
      return { kind, flag: 'a-flag' };
    case 'giveKey':
      return { kind: 'giveKey', key: 'a-key' };
    case 'open':
    case 'remove':
    case 'markUsed':
      return { kind };
    case 'loot':
      return { kind: 'loot' };
    case 'damage':
      return { kind: 'damage', amount: 2 };
    case 'heal':
      return { kind: 'heal', amount: 2 };
    case 'startEncounter':
      return { kind: 'startEncounter', encounter: props.encounterIds[0] ?? 'encounter-1' };
    case 'goto':
      return { kind: 'goto', scene: props.sceneIds[0] ?? '' };
    case 'startDialogue':
      return { kind: 'startDialogue', dialogue: props.dialogueIds[0] ?? '' };
    case 'startQuest':
    case 'completeQuest':
    case 'failQuest':
      return { kind, quest: props.quests[0]?.id ?? '' };
    case 'learnPlan': return { kind: 'learnPlan', plan: props.planIds?.[0] ?? '' };
    case 'grantCard':
      return { kind: 'grantCard', card: props.cardIds?.[0] ?? '' };
    case 'joinParty':
      return { kind: 'joinParty', companion: props.companionIds?.[0] ?? '' };
    case 'completeObjective':
    case 'revealObjective':
      return {
        kind,
        quest: props.quests[0]?.id ?? '',
        objective: props.quests[0]?.objectives[0]?.id ?? '',
      };
    case 'levelUp':
      return { kind };
    case 'branch':
      return { kind, when: { kind: 'flag', flag: 'a-flag' }, then: [] };
    case 'check':
      return { kind, check: { trait: 'finesse', difficulty: 12 } };
    case 'choice':
      return { kind, title: 'What do you do?', options: [{ label: 'Go on', effects: [] }] };
    case 'story':
      return { kind, title: 'A title', paragraphs: ['What the party sees.'] };
    case 'setVar':
      return { kind, name: 'a-variable', value: 1 };
    case 'addVar':
      return { kind, name: 'a-variable', by: 1 };
    case 'addItem':
    case 'removeItem':
      return { kind, item: 'an-item', quantity: 1 };
    case 'endEncounter':
      return { kind, encounter: props.encounterIds[0] ?? 'encounter-1' };
    case 'attack':
      return { kind };
    case 'markStress':
    case 'clearStress':
    case 'markArmor':
    case 'clearArmor':
    case 'gainGood':
    case 'spendGood':
    case 'loseGood':
    case 'gainBad':
    case 'loseBad':
      return { kind, amount: 1 };
    case 'applyCondition':
      return { kind, condition: 'vulnerable', duration: 'temporary' };
    case 'clearCondition':
      return { kind, condition: 'vulnerable' };
    case 'addToken':
    case 'spendToken':
      return { kind, ability: props.abilityIds?.[0] ?? '', amount: 1 };
    case 'push':
      return { kind, to: 'far' };
    case 'move':
      return { kind, how: 'toward', range: 'melee' };
    case 'summon':
      return { kind, adversary: props.adversaryIds?.[0] ?? '', range: 'close' };
    case 'replace':
      return { kind, adversary: props.adversaryIds?.[0] ?? '' };
    case 'spotlight':
      return { kind, targets: { kind: 'adversaries', range: 'far' } };
    case 'endSpotlight':
    case 'spotlightAgain':
    case 'vaultCard':
    case 'maxOneDie':
      return { kind };
    case 'setAttitude':
      return { kind, attitude: 'hostile' };
    case 'openShop':
      return { kind };
    case 'boostDamage':
      return { kind, dice: '1d6' };
    case 'forceHitPoints':
      return { kind, amount: { pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked' } };
    case 'forceSeverity':
      return { kind, severity: 'severe' };
    case 'softenBlow':
      return { kind, dice: '1d6' };
    case 'diceCheck':
      return { kind, dice: '1d6', atLeast: 6, then: [] };
    case 'stepSeverity':
      return { kind, steps: 1 };
    case 'dodgeBy':
      return { kind, dice: '1d4' };
    case 'avoidBlow':
      return { kind };
    case 'howMany':
      return { kind, most: { pool: 'good', measure: 'available' }, each: [] };
    case 'countdown':
      return { kind, countdown: 'countdown', name: 'Countdown', start: '4', effects: [] };
    case 'reactionRoll':
      return { kind, difficulty: 12, trait: 'agility' };
    case 'run':
      return { kind, hook: props.hookIds?.[0] ?? '' };
  }
}
