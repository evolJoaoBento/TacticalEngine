/**
 * The fight, as the Rust server must play it (`docs/SERVER.md`, phase 2).
 *
 * Sessions of a fight played with nobody at the table asked anything (`askDefender` off, as every test that
 * predates the prompts plays it): a fight begun, the selected member swinging at whoever is there
 * (`attackWithSelected`) - closing first, rolling, landing, and everything a blow sets off - the party's
 * turn ended and the GM's played (`endTurn`): adversaries spotlighted while the Shadow lasts, walking up and
 * swinging, a stat block's feature used, reactions to wounds, falls and rolls, countdowns, death moves.
 * Walks, the selection and the things in the room in between, and a prompt answered when a card or a
 * thing asks one. After each step its answer, the GM's turn as it stands, the fight, everybody's pools and
 * conditions, the Shadow, the scars, the log's new lines and what a view is handed.
 * `UPDATE_GOLDEN=1 npx vitest run src/game/fight.golden.test.ts` writes `server/fixtures/fight.json`;
 * `server/hooks/tests/golden_fight.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../engine/core/rng';
import type { Spot } from '../engine/grid/grid';
import { EQUIPMENT } from '../engine/content/equipment/catalogue';
import type { ContentPack } from '../engine/content/pack/import';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { migrateDocument } from '../engine/scene/migrate';
import { interactablesOf } from '../engine/scene/prop-functions';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import type { Response } from '../engine/script/runner';
import { scenarioSnapshot } from '../engine/script/world';
import type { RangeBand } from '../engine/rules/range';
import { answerPending, attackWithSelected, buildDemoScene, buildProjectScene, endTurn, moveSelectedTo, type DemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { DEMO_ADVERSARIES, DEMO_CHARACTERS } from './demo-rules';
import { approachThenUse } from './arrival';
import { startEncounter } from './movement';
import { inCombat } from './moment';
import { syncTalks } from './talks';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../server/fixtures/fight.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

/** The content as the Rust reads it, as `session.golden.test.ts` writes it. */
function contentJson(pack: ContentPack) {
  return {
    weapons: [...pack.weapons.values()].map(({ id, name, tier, slot, trait, range, damage, burden, features }) => ({ id, name, tier, slot, trait, range, damage, burden, features })),
    armors: [...pack.armors.values()].map(({ id, name, tier, baseThresholds, baseScore, features }) => ({ id, name, tier, baseThresholds, baseScore, features })),
    classes: [...pack.classes.values()].map(({ id, name, domains, startingEvasion, startingHitPoints }) => ({ id, name, domains, startingEvasion, startingHitPoints })),
    ancestries: [...pack.ancestries.values()].map(({ id, name }) => ({ id, name })),
    communities: [...pack.communities.values()].map(({ id, name }) => ({ id, name })),
    subclasses: [...pack.subclasses.values()].map(({ id, name, classId, domains, spellcastTrait }) => ({ id, name, classId, domains, ...(spellcastTrait === undefined ? {} : { spellcastTrait }) })),
    cards: [...pack.cards.values()].map(({ id, name, grant, domain, type, level, recallCost }) => ({ id, name, grant, ...(domain === undefined ? {} : { domain }), ...(type === undefined ? {} : { type }), ...(level === undefined ? {} : { level }), ...(recallCost === undefined ? {} : { recallCost }) })),
  };
}

// --- What a step is seen as --------------------------------------------------------------------------------

function fightView(demo: DemoScene) {
  const e = demo.encounter;
  if (e === null) return null;
  const circles = (e as unknown as { circles: Map<string, { anchor: Spot; band: RangeBand }> }).circles;
  return {
    id: e.encounterId,
    view: e.view(),
    log: e.log,
    circles: [...circles].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, c]) => [id, c.anchor, c.band]),
  };
}

function turnView(demo: DemoScene) {
  const t = demo.gmTurn;
  if (t === null) return null;
  return {
    remaining: t.remaining,
    acted: t.acted,
    spotlights: Object.entries(t.spotlights),
    features: Object.keys(t.features).filter((id) => t.features[id] === true),
    granted: [...t.granted],
    halved: [...t.halved],
  };
}

/** What happened, and then the view's queues drained, as a view drains them every frame. */
function view(demo: DemoScene, since: number) {
  const seen = clone({
    scene: demo.scene.id,
    fight: fightView(demo),
    turn: turnView(demo),
    pending: demo.pending === null ? null : demo.pending.kind === 'script' ? { prompt: demo.pending.prompt, dialogue: demo.pending.dialogue?.id ?? null } : { kind: demo.pending.kind },
    selected: demo.party.selected,
    bad: demo.state.bad,
    entities: demo.state.allEntities().map((e) => [e.id, e.faction, e.tile, e.at.x, e.at.y, e.alive, e.dead ?? null, e.hitPoints, e.stress, e.armorSlots, e.good ?? null, [...e.conditions], e.truce ?? null, e.interacted ?? null]),
    scars: [...demo.sheets.values()].map((s) => [s.id, s.scars ?? 0, s.loadout ?? null]),
    log: demo.log.slice(since),
    floaters: demo.floaters,
    motions: demo.motions,
    rolls: demo.rolls.map(({ who, what, roll }) => ({ who, what, roll })),
    things: demo.state.snapshot().interactables,
    scenario: scenarioSnapshot(demo.scenario),
  });
  demo.floaters.length = 0;
  demo.motions.length = 0;
  demo.rolls.length = 0;
  return seen;
}

// --- Answers, as a player might give them ------------------------------------------------------------------

function answerFor(demo: DemoScene, g: Rng): Response {
  const p = demo.pending;
  if (p === null || p.kind !== 'script') return { kind: 'continue' };
  const d = p.dialogue;
  if (d !== null && d.view !== null && d.prompt === null) {
    const enabled = d.view.options.filter((o) => o.enabled);
    return enabled.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: g.pick(enabled).index };
  }
  const prompt = d === null ? p.prompt : d.prompt;
  if (prompt === null) return { kind: 'continue' };
  switch (prompt.kind) {
    case 'check':
      return { kind: 'roll' };
    case 'choice':
      return { kind: 'choose', index: g.pick(prompt.options).index };
    case 'rolled':
      return { kind: 'answered' };
    default:
      return { kind: 'continue' };
  }
}

// --- A session ---------------------------------------------------------------------------------------------

/** The encounters in the room with somebody placed in them, for a fight to begin. */
const fights = (demo: DemoScene): string[] => demo.scene.encounters.filter((e) => e.adversaries.length > 0).map((e) => e.id);

function session(g: Rng, name: string, project: number, input: ProjectDoc, length: number, toured = false) {
  const demo = buildProjectScene(projectSchema.parse(clone(input)), `fight:${name}`);
  const start = view(demo, 0);
  const steps: unknown[] = [];
  if (demo.scene.encounters.some((e) => e.id === 'the-pit')) {
    const since = demo.log.length;
    const stand = g.pick(demo.party.members());
    demo.state.entity(stand)!.conditions.add('last-stand');
    const warded = g.pick(demo.party.members());
    demo.state.entity(warded)!.conditions.add('pit-aura');
    const lucky = g.pick(demo.party.members());
    demo.state.entity(lucky)!.conditions.add('pit-luck');
    const bait = g.pick(demo.party.members());
    demo.state.entity(bait)!.conditions.add('pit-bait');
    // The GM comes in with Shadow to spend, or only the first of them ever moves.
    const bad = 3 + g.nextInt(4);
    demo.state.bad = { ...demo.state.bad, value: bad };
    startEncounter(demo, 'the-pit');
    steps.push({ step: 'setup', stand, warded, lucky, bait, bad, after: view(demo, since) });
  }
  if (toured) {
    // On purpose, before the dice take over: the flag waved, a creature it stood down struck - which
    // begins the fight again - and the brute held fast when the GM's turn comes round to it.
    const step = (made: Record<string, unknown>): void => {
      made['after'] = view(demo, since);
      steps.push(made);
    };
    let since = demo.log.length;
    step({ step: 'approach', id: 'pit-flag', result: approachThenUse(demo, 'pit-flag') });
    since = demo.log.length;
    step({ step: 'attack', id: 'pit-brute-1', result: attackWithSelected(demo, 'pit-brute-1') });
    since = demo.log.length;
    const brute = demo.state.entity('pit-brute-1');
    if (brute !== undefined) {
      brute.conditions.add('restrained');
      brute.conditionDurations.set('restrained', 'temporary');
    }
    step({ step: 'hold', id: 'pit-brute-1' });
    since = demo.log.length;
    step({ step: 'endTurn', result: endTurn(demo) });
  }
  for (let n = 0; n < length; n++) {
    const since = demo.log.length;
    const fighting = inCombat(demo);
    const selected = demo.party.selected;
    const at = selected === null ? undefined : demo.state.entity(selected);
    const struck = demo.state.allEntities().filter((e) => e.alive && e.faction !== 'party').map((e) => e.id);
    const things = interactablesOf(demo.scene).map((t) => t.id);
    const kinds = demo.pending !== null
      ? (['answer', 'answer', 'answer', 'select'] as const)
      : fighting
        ? (['attack', 'attack', 'attack', 'attack', 'attack', 'endTurn', 'endTurn', 'endTurn', 'move', 'select', 'select', 'approach', 'lever'] as const)
        : (['fight', 'fight', 'fight', 'attack', 'move', 'select'] as const);
    const kind = g.pick(kinds);
    let step: Record<string, unknown>;
    switch (kind) {
      case 'fight': {
        const all = fights(demo);
        const id = all.length === 0 ? null : g.pick(all);
        if (id !== null) startEncounter(demo, id);
        step = { step: kind, id };
        break;
      }
      case 'attack': {
        const id = struck.length === 0 ? 'nobody' : g.pick(struck);
        step = { step: kind, id, result: attackWithSelected(demo, id) };
        break;
      }
      case 'endTurn':
        step = { step: kind, result: endTurn(demo) };
        break;
      case 'move': {
        const from = at?.tile ?? 0;
        const x = Math.min(demo.grid.width - 1, Math.max(0, demo.grid.xOf(from) + g.nextInt(9) - 4));
        const y = Math.min(demo.grid.height - 1, Math.max(0, demo.grid.yOf(from) + g.nextInt(9) - 4));
        const destination = demo.grid.indexOf(x, y);
        step = { step: kind, destination, result: moveSelectedTo(demo, destination) };
        break;
      }
      case 'lever':
      case 'approach': {
        // The pit's lever, where there is one, or anything in the room.
        const lever = kind === 'lever' && things.includes('pit-lever');
        const id = lever ? 'pit-lever' : things.length === 0 ? 'nothing' : g.pick(things);
        step = { step: kind, id, result: approachThenUse(demo, id) };
        break;
      }
      case 'answer': {
        const response = answerFor(demo, g);
        step = { step: kind, response, result: answerPending(demo, response) };
        break;
      }
      case 'select': {
        const next = demo.party.selectNext();
        step = { step: kind, selected: next, moved: syncTalks(demo) };
        break;
      }
    }
    step['after'] = view(demo, since);
    steps.push(step);
  }
  return { name, project, start, steps };
}

/**
 * The default project with a pit east of the door: stat blocks of its own that carry what the fight obeys
 * by name - Relentless, Momentum, Terrifying, Minion, Horde - and cards printed on them for every moment a
 * fight raises (a wound hit back, a blow grown, the spotlight, a fall, a party roll, a swing at them, a
 * rider, ground that bites, allies rallied at half strength, a swarm, a clock, a summons on the way out),
 * and cards given to the party that play themselves at every moment theirs (a choice mid-swing, a reroll,
 * a blow grown, a Stress cleared, a hold put on a creature), a debt a marked creature pays whoever swings
 * at it, a last stand that answers a fall in place of the death move, an aura that takes a blow down a
 * band, a creature that stops to talk at half its Hit Points, and a party seasoned enough to scar. By the
 * door, a white flag that stands the pit down and a lever that bites whoever pulls it wrong. Creatures
 * that wound themselves when the spotlight finds them, so a fall, a last word and a replacement come in
 * the middle of the GM's own turn.
 */
function arena(base: ProjectDoc): ProjectDoc {
  const project = clone(base);
  // What is pushed below is read by the schema at the end, as a file would be.
  const loose = project as unknown as Record<'adversaries' | 'cards' | 'abilities' | 'conditionDefs', unknown[]>;
  const vault = project.scenes[0]!;
  const door = vault.spawns[0]!;
  const at = (dx: number, dy: number) => ({ x: door.x + dx, y: door.y + dy });
  const stat = (id: string, name: string, rest: Record<string, unknown>) => ({
    id, name, tier: 1, role: 'standard', description: '', motivesAndTactics: '', difficulty: 11,
    thresholds: { major: 5, severe: 9 }, hitPoints: 6, stress: 3, attackName: 'Claws',
    attackModifier: { count: 0, sides: 0, modifier: 1 }, attackRange: 'melee',
    attackDamage: { count: 1, sides: 6, modifier: 1, types: ['physical'] }, experiences: [], features: [], ...rest,
  });
  loose.adversaries.push(
    stat('pit-brute', 'Pit Brute', { hitPoints: 8, attackDamage: { count: 2, sides: 6, modifier: 2, types: ['physical'] }, features: [{ name: 'Relentless (2)', kind: 'passive' }, { name: 'Momentum', kind: 'reaction' }] }),
    stat('pit-boss', 'Pit Boss', { role: 'leader', hitPoints: 4, attackRange: 'close', attackDamage: { count: 1, sides: 8, modifier: 2, types: ['physical'] }, features: [{ name: 'Terrifying', kind: 'passive' }] }),
    stat('pit-rat', 'Pit Rat', { role: 'minion', hitPoints: 1, stress: 1, attackDamage: { count: 0, sides: 0, modifier: 2, types: ['physical'] }, features: [{ name: 'Minion (3)', kind: 'passive' }] }),
    stat('pit-swarm', 'Pit Swarm', { role: 'horde', hitPoints: 4, features: [{ name: 'Horde (1d4)', kind: 'passive' }] }),
  );
  const card = (id: string, grant: unknown) => ({ id, name: id, grant });
  const party = project.party.map((s) => s.id);
  loose.cards.push(
    card('pit-brute-card', { kind: 'adversary', adversaries: ['pit-brute'] }),
    card('pit-boss-card', { kind: 'adversary', adversaries: ['pit-boss'] }),
    card('pit-rat-card', { kind: 'adversary', adversaries: ['pit-rat'] }),
    card('pit-swarm-card', { kind: 'adversary', adversaries: ['pit-swarm'] }),
    card('arena-grit', { kind: 'given', characters: party }),
  );
  const on = (source: string, id: string, rest: Record<string, unknown>) => ({ id, name: id.replace(/-/g, ' '), source: { card: source }, text: '', ...rest });
  const say = (text: string) => ({ kind: 'log', text, tone: 'system' });
  const target = { kind: 'target' };
  loose.abilities.push(
    on('pit-brute-card', 'brute-hits-back', { kind: 'reaction', trigger: 'tookDamage', cost: { stress: 1 }, effects: [{ kind: 'damage', dice: '1d4', type: 'physical', target }] }),
    on('pit-brute-card', 'brute-heavy', { kind: 'reaction', trigger: 'rollingDamage', cost: { stress: 1 }, effects: [{ kind: 'boostDamage', amount: 2 }] }),
    on('pit-brute-card', 'brute-roar', { kind: 'reaction', trigger: 'spotlighted', uses: { count: 1, per: 'scene' }, effects: [{ kind: 'countdown', countdown: 'roar', name: 'The Roar', start: '2', effects: [say('The roar comes back off the walls.'), { kind: 'damage', dice: '1d4', type: 'physical', target: { kind: 'allies', range: 'close' } }] }] }),
    on('pit-brute-card', 'brute-hide', { kind: 'passive', defenses: { reduce: [{ dice: '1d2', only: 'physical' }] } }),
    on('pit-brute-card', 'brute-bleeds', { kind: 'reaction', trigger: 'spotlighted', effects: [say('The brute tears at its own wounds.'), { kind: 'damage', amount: 1, target: { kind: 'actor' } }] }),
    on('pit-brute-card', 'brute-crush', { kind: 'reaction', trigger: 'rollingDamage', cost: { bad: 1 }, uses: { count: 1, per: 'scene' }, effects: [{ kind: 'forceSeverity', severity: 'major' }] }),
    on('pit-brute-card', 'brute-rises', { kind: 'reaction', trigger: 'defeated', effects: [say('Something else climbs out of the brute.'), { kind: 'replace', adversary: 'pit-swarm', spotlight: true }] }),
    on('pit-brute-card', 'brute-slam', { kind: 'action', target: { kind: 'creature', range: 'melee', when: { kind: 'hasCondition', condition: 'vulnerable', of: target } }, uses: { count: 1, per: 'scene' }, cost: { bad: 1 }, effects: [{ kind: 'forceSeverity', severity: 'major' }, { kind: 'attack', target }] }),
    on('pit-boss-card', 'boss-rally', { kind: 'action', cost: { bad: 2 }, uses: { count: 1, per: 'scene' }, effects: [{ kind: 'spotlight', count: '2', halfDamage: true }] }),
    on('pit-boss-card', 'boss-strike', { kind: 'action', target: { kind: 'creature', range: 'melee' }, uses: { count: 1, per: 'scene' }, effects: [{ kind: 'attack', target }] }),
    on('pit-boss-card', 'boss-swap', { kind: 'action', uses: { count: 1, per: 'scene' }, effects: [{ kind: 'heal', amount: 1, target: { kind: 'adversaries', range: 'close' } }, { kind: 'markStress', amount: 1, target: { kind: 'allies', range: 'close' } }] }),
    on('pit-boss-card', 'boss-horn', { kind: 'reaction', trigger: 'spotlighted', cost: { stress: 1 }, effects: [{ kind: 'spotlight', count: '1' }] }),
    on('pit-boss-card', 'boss-frail', { kind: 'reaction', trigger: 'spotlighted', effects: [{ kind: 'damage', amount: 1, target: { kind: 'actor' } }] }),
    on('pit-boss-card', 'boss-last-word', { kind: 'reaction', trigger: 'defeated', effects: [say('The boss goes down howling for help.'), { kind: 'summon', adversary: 'pit-rat', count: '2', spotlight: true }] }),
    on('pit-boss-card', 'boss-wary', { kind: 'reaction', trigger: 'attacked', effects: [say('The boss snarls at the swing.'), { kind: 'applyCondition', condition: 'vulnerable', target }] }),
    on('pit-boss-card', 'boss-reads-shadow', { kind: 'reaction', trigger: 'partyRolled', available: { kind: 'rolled', is: 'withBad' }, effects: [{ kind: 'markStress', amount: 1, target }] }),
    on('pit-boss-card', 'boss-doom', { kind: 'action', uses: { count: 1, per: 'scene' }, effects: [{ kind: 'countdown', countdown: 'doom', name: 'Doom', start: '3', advance: 'attackRoll', onDeath: 'trigger', effects: [say('Doom falls.'), { kind: 'gainBad', amount: 2 }] }] }),
    on('pit-boss-card', 'boss-mend', { kind: 'action', uses: { count: 1, per: 'scene' }, effects: [{ kind: 'heal', amount: 1, target: { kind: 'adversaries', range: 'close' } }] }),
    on('pit-boss-card', 'boss-call', { kind: 'action', uses: { count: 1, per: 'scene' }, effects: [{ kind: 'summon', adversary: 'pit-rat', count: '1', spotlight: true }] }),
    on('pit-rat-card', 'rat-swarm', { kind: 'action', target: { kind: 'creature', range: 'close', when: { kind: 'hasCondition', condition: 'vulnerable', of: target } }, effects: [{ kind: 'attack', target, joinedBy: { kind: 'adversaries', range: 'close' } }] }),
    on('pit-rat-card', 'rat-skitter', { kind: 'reaction', trigger: 'spotlighted', uses: { count: 1, per: 'scene' }, effects: [say('The rat skitters off instead.'), { kind: 'endSpotlight' }] }),
    on('pit-swarm-card', 'swarm-sting', { kind: 'reaction', trigger: 'dealtDamage', effects: [{ kind: 'applyCondition', condition: 'vulnerable', target }, { kind: 'applyCondition', condition: 'pit-dazed', target }] }),
    on('pit-swarm-card', 'swarm-smell', { kind: 'reaction', trigger: 'nearbyTookDamage', effects: [say('The swarm stirs at the smell of it.')] }),
    on('pit-swarm-card', 'swarm-joins-in', { kind: 'reaction', trigger: 'allyRollingDamage', cost: { bad: 1 }, effects: [{ kind: 'boostDamage', amount: 1 }] }),
    on('pit-swarm-card', 'swarm-howl', { kind: 'reaction', trigger: 'tookSevere', effects: [say('The swarm shrieks.')] }),
    on('pit-swarm-card', 'swarm-mob', { kind: 'action', target: { kind: 'creature', range: 'close' }, uses: { count: 1, per: 'scene' }, effects: [{ kind: 'attack', target, joinedBy: { kind: 'adversaries', range: 'close' } }] }),
    on('pit-swarm-card', 'swarm-cinders', { kind: 'action', target: { kind: 'none', range: 'close' }, uses: { count: 1, per: 'scene' }, effects: [{ kind: 'zone', zone: 'cinders', name: 'Cinders', condition: 'cinder-ground', at: 'point', band: 'veryClose' }, { kind: 'spotlightAgain' }] }),
    on('arena-grit', 'grit-rise', { kind: 'reaction', trigger: 'tookHitPoints', effects: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }] }),
    on('arena-grit', 'grit-press', { kind: 'reaction', trigger: 'dealtHit', effects: [{ kind: 'choice', title: 'Press the advantage?', options: [{ label: 'Mark them', effects: [{ kind: 'applyCondition', condition: 'marked-prey', duration: 'scene', target }] }, { label: 'Stagger them', effects: [{ kind: 'applyCondition', condition: 'pit-staggered', duration: 'temporary', target }] }, { label: 'Pin them', effects: [{ kind: 'applyCondition', condition: 'pit-pinned', duration: 'scene', target }] }, { label: 'Hold them', effects: [{ kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target }] }, { label: 'Let it be', effects: [] }] }] }),
    on('arena-grit', 'grit-gamble', { kind: 'reaction', trigger: 'rollingDamage', uses: { count: 1, per: 'scene' }, effects: [{ kind: 'choice', title: 'Put everything behind it?', options: [{ label: 'All in', effects: [{ kind: 'boostDamage', amount: 2 }] }, { label: 'Steady', effects: [] }] }] }),
    on('arena-grit', 'grit-shout', { kind: 'reaction', trigger: 'allyTookDamage', uses: { count: 1, per: 'scene' }, effects: [{ kind: 'choice', title: 'Shout to them?', options: [{ label: 'Hold on!', effects: [say('Hold on!')] }, { label: 'Keep quiet', effects: [] }] }] }),
    on('arena-grit', 'grit-mend', { kind: 'reaction', trigger: 'partyRolled', available: { kind: 'rolled', is: 'critical' }, uses: { count: 1, per: 'scene' }, effects: [{ kind: 'revive', target: { kind: 'party' } }] }),
    on('arena-grit', 'grit-brace', { kind: 'reaction', trigger: 'incomingDamage', reaction: { kind: 'reduceDamage', dice: '1d4' } }),
    on('arena-grit', 'grit-edge', { kind: 'reaction', trigger: 'rollingDamage', effects: [{ kind: 'boostDamage', dice: '1d4' }] }),
    on('arena-grit', 'grit-again', { kind: 'reaction', trigger: 'partyRolling', available: { kind: 'rolled', is: 'failure' }, effects: [{ kind: 'rerollDuality', which: 'good' }] }),
    on('arena-grit', 'grit-watch', { kind: 'reaction', trigger: 'allyTookDamage', effects: [say('An ally winces.')] }),
    on('arena-grit', 'grit-near', { kind: 'reaction', trigger: 'nearbyTookDamage', effects: [say('Somebody saw that land.')] }),
    on('arena-grit', 'grit-miss', { kind: 'reaction', trigger: 'dealtMiss', effects: [say('Wide.')] }),
    on('arena-grit', 'grit-braced', { kind: 'reaction', trigger: 'attacked', effects: [say('Braced for it.')] }),
    on('arena-grit', 'grit-rolled', { kind: 'reaction', trigger: 'partyRolled', available: { kind: 'rolled', is: 'critical' }, effects: [say('What a roll.')] }),
  );
  loose.conditionDefs.push(
    { id: 'cinder-ground', name: 'Cinders', text: '', modifiers: [], blocks: [], onEnter: { effects: [{ kind: 'damage', dice: '1d4', type: 'magic', target }] } },
    { id: 'marked-prey', name: 'Marked Prey', text: '', modifiers: [], blocks: [], payout: { on: 'attacked', auto: true, effects: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }] } },
    { id: 'last-stand', name: 'Last Stand', text: '', modifiers: [], blocks: [], insteadOfDeath: { clears: 2, says: 'refuses to fall.' } },
    { id: 'pit-luck', name: 'Lucky', text: '', modifiers: [], blocks: [], goodDie: { sides: 20 } },
    { id: 'pit-bait', name: 'Bait', text: '', modifiers: [], blocks: [], payout: { on: 'attacked', auto: true, keeps: true, effects: [{ kind: 'markStress', amount: 1, target: { kind: 'actor' } }] } },
    { id: 'pit-aura', name: 'Pit Aura', text: '', modifiers: [], blocks: [], armor: { steps: 1, endsWhenItSaves: true } },
    { id: 'pit-dazed', name: 'Dazed', text: '', modifiers: [], blocks: [], endsWhen: 'damaged' },
    { id: 'pit-staggered', name: 'Staggered', text: '', modifiers: [], blocks: ['act'] },
    { id: 'pit-pinned', name: 'Pinned', text: '', modifiers: [], blocks: ['act'] },
  );
  const place = (id: string, adversary: string, dx: number, dy: number) => ({ id, adversary, position: at(dx, dy) });
  const prop = (id: string, dx: number, dy: number, effects: unknown[]) => ({ id, model: 'crate', position: at(dx, dy), rotation: 0, function: { kind: 'script', effects, repeatable: true, blocksMovement: false } });
  vault.decos.push(
    prop('pit-flag', 1, 2, [{ kind: 'endEncounter', encounter: 'the-pit' }]) as never,
    prop('pit-lever', 1, -2, [{ kind: 'check', check: { trait: 'agility', difficulty: 13, always: [say('The lever clanks.'), { kind: 'countdown', countdown: 'lever-trap', name: 'The Trap', start: '1', effects: [say('Something in the wall gives.')] }], onFailureWithGood: [{ kind: 'damage', dice: '2d8+2', type: 'physical', target: { kind: 'actor' } }], onFailureWithBad: [say('The lever snaps back.'), { kind: 'damage', amount: 30, type: 'physical', target: { kind: 'actor' } }, { kind: 'damage', amount: 30, type: 'physical', target: { kind: 'actor' } }] } }]) as never,
  );
  // First, so its creatures stand first in the GM's queue.
  vault.encounters.unshift({
    id: 'the-pit',
    name: 'The Pit',
    adversaries: [
      // The boss first, so a rally reaches the brute before it has had its turn.
      place('pit-boss-1', 'pit-boss', 5, 2),
      place('pit-brute-1', 'pit-brute', 4, 0),
      place('pit-rat-1', 'pit-rat', 3, -2),
      place('pit-rat-2', 'pit-rat', 4, -2),
      place('pit-rat-3', 'pit-rat', 5, -2),
      { ...place('pit-swarm-1', 'pit-swarm', 6, 0), interaction: { kind: 'threshold', percent: 50, dialogue: 'the-bard' } },
    ],
    triggerCells: [],
    startsOnTrigger: false,
  } as never);
  // Seasoned: a fall scars on a Light Die at or under the level.
  for (const sheet of project.party) sheet.level = 4;
  return projectSchema.parse(project);
}

/** The pit with nothing else in the vault: a fight that can be won, or lost. */
function pitAlone(base: ProjectDoc): ProjectDoc {
  const project = arena(base);
  const vault = project.scenes[0]!;
  vault.encounters = vault.encounters.filter((e) => e.id === 'the-pit');
  return projectSchema.parse(project);
}

function golden() {
  const g = createRng('fight');
  const demo = buildDemoScene(hollowVaultMap(), 'fight');
  const fallback = projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));
  const projects: [string, ProjectDoc][] = [['the demo', clone(demo.project)], ['default', fallback], ['the pit', arena(fallback)], ['the pit alone', pitAlone(fallback)]];
  const sessions: ReturnType<typeof session>[] = [];
  projects.forEach(([name, project], at) => {
    for (let s = 0; s < [4, 4, 12, 8][at]!; s++) sessions.push(session(g, `${name} ${s}`, at, project, at >= 2 ? 80 : 50));
  });
  for (let s = 0; s < 2; s++) sessions.push(session(g, `the pit alone, toured ${s}`, 3, projects[3]![1], 30, true));
  return {
    about: 'the fight, for the Rust port; written by src/game/fight.golden.test.ts',
    shipped: {
      characters: contentJson(DEMO_CHARACTERS),
      adversaries: [...DEMO_ADVERSARIES.values()],
      abilities: STARTER_ABILITIES,
      conditions: [...STARTER_CONDITIONS, ...SRD_CONDITIONS],
      items: EQUIPMENT.items.map(({ id, name }) => ({ id, name })),
    },
    projects: projects.map(([, project]) => clone(project)),
    sessions,
  };
}

describe('the fight, for the Rust port', () => {
  it('matches server/fixtures/fight.json', () => {
    const written = golden();
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(written)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(clone(written));
  }, 300_000);
});
