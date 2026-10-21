/**
 * The default project with a card in every hand for each way a card is aimed and limited - written for the
 * action bar's golden (`src/game/bar.golden.test.ts`) and read by the replica's too
 * (`src/game/replica.golden.test.ts`), which asks the same cards where they may be aimed.
 */

import { projectSchema, type ProjectDoc } from '../../src/engine/scene/schema';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

/**
 * The default project with a card in every hand for each way a card is aimed and limited: at a foe, twice
 * a fight; at anybody, for Light; at a group; at a fallen ally; with a roll against everyone close; at the
 * ground, catching those around the point; on themselves, only out of a fight; with shots that a rest
 * reloads; one with nothing the engine can run, and one only the GM could pay for; a reaction; one aimed only
 * at the Vulnerable - and words on the card, a card a condition lends, and a knot of foes by the door.
 */
export function barWorkshop(base: ProjectDoc): ProjectDoc {
  const project = clone(base);
  const loose = project as unknown as Record<'cards' | 'abilities' | 'conditionDefs', unknown[]>;
  loose.cards.push(
    { id: 'bar-kit', name: 'Kit', text: 'A kit of tricks.', features: [{ name: 'kit jab', text: 'Jab them where it hurts.' }], grant: { kind: 'given', characters: project.party.map((s) => s.id) } },
    { id: 'bar-lent', name: 'Lent', text: 'Borrowed for a while.', grant: { kind: 'condition', conditions: ['kit-lent'] } },
  );
  loose.conditionDefs.push({ id: 'kit-lent', name: 'Lent a Hand', text: '', modifiers: [], blocks: [] });
  const on = (id: string, rest: Record<string, unknown>) => ({ id, name: id.replace(/-/g, ' '), source: { card: 'bar-kit' }, text: '', kind: 'action', ...rest });
  const target = { kind: 'target' };
  loose.abilities.push(
    on('kit-jab', { target: { kind: 'adversary', range: 'veryFar' }, uses: { count: 2, per: 'scene' }, effects: [{ kind: 'attack', target }] }),
    on('kit-mark', { target: { kind: 'creature', range: 'far' }, cost: { good: 1 }, effects: [{ kind: 'applyCondition', condition: 'vulnerable', target }] }),
    on('kit-sweep', { target: { kind: 'group', range: 'veryFar' }, inCombatOnly: true, cost: { stress: 1 }, effects: [{ kind: 'damage', dice: '1d4', type: 'physical', target }] }),
    on('kit-raise', { target: { kind: 'ally', range: 'close', fallen: true }, uses: { count: 1, per: 'longRest' }, effects: [{ kind: 'revive', target }] }),
    on('kit-shout', { cost: { stress: 1, good: 1 }, uses: { count: 3, per: 'rest' }, effects: [{ kind: 'check', check: { trait: 'presence', difficulty: 11, targets: { kind: 'adversaries', range: 'veryFar' }, onFailureWithBad: [{ kind: 'markStress', amount: 1, target: { kind: 'actor' } }], always: [{ kind: 'log', text: 'The shout carries.', tone: 'system' }] } }] }),
    on('kit-burst', { target: { kind: 'point', range: 'far' }, cost: { stress: 1 }, effects: [{ kind: 'damage', dice: '1d6', type: 'magic', target: { kind: 'adversaries', range: 'veryClose', around: 'point' } }, { kind: 'log', text: 'Sparks.', tone: 'system' }, { kind: 'clearStress', amount: 1, target: { kind: 'actor' } }] }),
    on('kit-calm', { text: 'Breathe, and take a hand.', target: { kind: 'self', range: 'melee' }, available: { kind: 'not', of: { kind: 'inCombat' } }, effects: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }, { kind: 'applyCondition', condition: 'kit-lent', duration: 'scene', target: { kind: 'actor' } }] }),
    on('kit-finish', { target: { kind: 'adversary', range: 'far', when: { kind: 'hasCondition', condition: 'vulnerable', of: target } }, effects: [{ kind: 'attack', target }] }),
    on('kit-hush', { effects: [{ kind: 'check', check: { trait: 'presence', difficulty: 10, targets: { kind: 'adversaries', range: 'close' }, always: [{ kind: 'log', text: 'Hush.', tone: 'system' }] } }] }),
    on('kit-wince', { kind: 'reaction', trigger: 'tookDamage', effects: [{ kind: 'log', text: 'Ow.', tone: 'system' }] }),
    { id: 'kit-borrowed', name: 'kit borrowed', source: { card: 'bar-lent' }, text: '', kind: 'action', target: { kind: 'self', range: 'melee' }, effects: [{ kind: 'log', text: 'A borrowed trick.', tone: 'good' }] },
    on('kit-throw', { target: { kind: 'adversary', range: 'veryFar' }, tokens: { amount: 2, refill: 'rest' }, available: { kind: 'tokens', ability: 'kit-throw', op: '>=', value: 1 }, effects: [{ kind: 'spendToken', ability: 'kit-throw', amount: 1 }, { kind: 'damage', dice: '1d4', type: 'physical', target }] }),
    on('kit-story', { effects: [] }),
    on('kit-curse', { cost: { bad: 1 }, effects: [{ kind: 'log', text: 'A curse.', tone: 'bad' }] }),
  );
  // A knot of them by the door, for a group to be more than the one picked.
  const vault = project.scenes[0]!;
  const door = vault.spawns[0]!;
  const near = (dx: number, dy: number) => ({ x: door.x + dx, y: door.y + dy });
  vault.encounters.unshift({
    id: 'the-yard',
    name: 'The Yard',
    adversaries: [
      { id: 'yard-1', adversary: 'hollow-knight', position: near(4, 0) },
      { id: 'yard-2', adversary: 'hollow-knight', position: near(4, 1) },
      { id: 'yard-3', adversary: 'hollow-knight', position: near(5, 0) },
    ],
    triggerCells: [],
    startsOnTrigger: false,
  } as never);
  return projectSchema.parse(project);
}
