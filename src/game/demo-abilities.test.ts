import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { deriveCharacter } from '../engine/character/sheet';
import { abilitySchema } from '../engine/content/abilities';
import { conditionDefSchema } from '../engine/content/conditions';
import { cardDefSchema } from '../engine/content/pack/schema';
import { FIXTURE_AURA_CARD, FIXTURE_CARDS, FIXTURE_GRIMOIRE, FIXTURE_HAND } from '../../tests/fixtures/adversaries';
import { A_BOOK_OF_TWO_SPELLS } from '../../tests/fixtures/cards';
import { handedTo } from '../../tests/fixtures/cards';
import { FIXTURE_CONDITIONS } from '../../tests/fixtures/conditions';
import { abilityList, abilityText, abilitiesOf, loadoutView, shapeAt, statBlockCards } from './demo-abilities';
import { NO_TILE } from '../engine/grid/grid';
import { buildDemoScene, refreshWorld, type DemoScene } from './demo-scene';
import { characterContentFor } from './room';

/**
 * Playing cards. The engine's half — one roll, many targets, damage through
 * thresholds — is `abilities.test.ts`; this is the game's: who has what, what
 * it costs, who it can be aimed at, what a turn it spends, and how a rest and
 * the vault change all of that.
 */

/** The demo, knowing the catalogue conditions these tests play: the engine ships only the rules' three. */
const scene = (seed = 'cards'): DemoScene => {
  const demo = buildDemoScene(hollowVaultMap(), seed);
  demo.project.conditionDefs.push(...FIXTURE_CONDITIONS);
  refreshWorld(demo);
  return demo;
};

const names = (demo: DemoScene, id: string): string[] => abilitiesOf(demo, id).map((a) => a.id);

describe('who has what', () => {
  it('lists class, Light, subclass and loadout abilities per character', () => {
    const demo = scene();
    // The class's, then the subclass's, then the cards in loadout order, which
    // is the order a sheet lists them. The sentinel has two class features: the
    // passive it is drilled in, and the signature stance the class prints.
    expect(names(demo, 'kara')).toEqual([
      'sentinel-drilled',
      'sentinel-hold-the-line',
      'sentinel-hold-fast',
      'shieldbearer-set-feet',
      'power-slash',
      'iron-stance',
      'rally-the-line',
    ]);
    expect(names(demo, 'finn')).toEqual(['lampsnuffer-softstep', 'quick-hands', 'backstab']);
    expect(names(demo, 'mira')).toEqual(['flamecaller-emberflow', 'arcane-ward', 'healing-word']);
  });

  it('shows the card\'s words and says why it is greyed out', () => {
    const demo = scene();
    const list = abilityList(demo, 'kara');
    const good = list.find((v) => v.ability.id === 'sentinel-hold-fast')!;
    expect(good.text).toContain('Spend 3 Light to clear 2 Armor Slots');
    expect(good.usable).toBe(false);
    expect(good.reason).toBe('needs 3 Light');
    // And a passive, which is never usable for a different reason.
    const passive = list.find((v) => v.ability.id === 'sentinel-drilled')!;
    expect(passive.reason).toBe('always on');
    expect(passive.text).toContain('Armor Score');
  });

  it("draws every card's art on the action bar, a granted one's in the granted colour", () => {
    const demo = scene();
    const list = abilityList(demo, 'kara');
    const on = (id: string) => list.find((v) => v.ability.id === id)!;
    // Chosen: its domain's colour, as it always was.
    expect(on('power-slash').card).toEqual({ id: 'power-slash', domain: 'bulwark' });
    // Granted by the class, and handed to her by the project: the colour a card nobody chose wears.
    for (const id of ['sentinel-drilled', 'rally-the-line']) {
      expect(on(id).card).toEqual({ id: on(id).ability.source.card, domain: 'granted' });
    }
    expect(list.every((v) => v.card !== null)).toBe(true);
  });
});

describe('the loadout and the vault', () => {
  const grow = (demo: DemoScene): void => {
    demo.project.cards.push(...FIXTURE_CARDS);
    const sheet = demo.sheets.get('kara')!;
    const cards = [...FIXTURE_HAND];
    const grown = { ...sheet, domainCards: cards };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('holds five, vaults the rest, and only active cards are abilities', () => {
    const demo = scene();
    grow(demo);
    const view = loadoutView(demo, 'kara');
    expect(view.loadout.map((c) => c.id)).toEqual(FIXTURE_HAND.slice(0, 5));
    expect(view.vault.map((c) => c.id)).toEqual([FIXTURE_HAND[5]]);
    expect(names(demo, 'kara')).not.toContain(FIXTURE_HAND[5]);
  });

  it("shows a chosen card's own text in the hand, the way a granted card's is shown", () => {
    const demo = scene();
    // A card the Cards panel writes: text, and no features.
    demo.project.cards.push(
      cardDefSchema.parse({ id: 'oath', name: 'Oath', grant: { kind: 'chosen' }, domain: 'bulwark', type: 'ability', level: 1, recallCost: 0, text: 'Swear it, and hold.' }),
    );
    const grown = { ...demo.sheets.get('kara')!, domainCards: ['oath'] };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    expect(loadoutView(demo, 'kara').loadout).toEqual([
      { id: 'oath', name: 'Oath', recallCost: 0, domain: 'bulwark', level: 1, type: 'ability', text: 'Swear it, and hold.' },
    ]);
  });

  it('lays out what she has without choosing it: face up, in sheet order, read as the cards stand', () => {
    const demo = scene();
    const view = loadoutView(demo, 'kara');
    // Her class's four (the pack's three and the demo's own), her subclass's foundation, her
    // ancestry's, her community's, and the one the demo hands her.
    expect(view.granted.map((c) => c.id)).toEqual([
      'sentinel-shield-trained',
      'sentinel-drilled',
      'sentinel-hold-the-line',
      'sentinel-hold-fast',
      'shieldbearer-bulwark-stance',
      'shieldbearer-set-feet',
      'stoneborn-deep-footing',
      'wayfarer-road-sense',
      'rally-the-line',
    ]);
    // Said the way the table says it, never by id.
    expect([...new Set(view.granted.map((c) => c.from))]).toEqual([
      'Sentinel',
      'Shieldbearer · foundation',
      'Stoneborn',
      'Wayfarer',
      'Given',
    ]);
    // None of it is in the hand the loadout limit counts.
    expect(view.loadout.map((c) => c.id)).toEqual(['power-slash', 'iron-stance']);
    // A card handed over now is in play now.
    demo.project.cards.push(handedTo({ id: 'lantern-oath', name: 'Lantern Oath' }, 'kara'));
    expect(loadoutView(demo, 'kara').granted.at(-1)?.id).toBe('lantern-oath');
  });
});

describe("a grimoire spell's words", () => {
  it('are the spell\'s own feature text, not the whole book', () => {
    const demo = scene();
    // The book has to be in her hand: this reads the abilities she actually holds.
    demo.project.cards.push(...FIXTURE_CARDS);
    for (const ability of A_BOOK_OF_TWO_SPELLS) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get('mira')!, domainCards: [FIXTURE_GRIMOIRE], loadout: [FIXTURE_GRIMOIRE] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);

    const push = abilitiesOf(demo, 'mira').find((a) => a.id === 'fixture-grimoire-shove')!;
    const text = abilityText(demo, push);
    expect(text.startsWith('Shove something away from you, hard')).toBe(true);
    // The other spell in the same book stays out of the answer.
    expect(text).not.toContain('Splinter');
  });
});

describe('a card a condition lends', () => {
  /** A mark that lends a card with two abilities on it: a passive, and one to play. */
  const lending = (seed: string): DemoScene => {
    const demo = scene(seed);
    demo.project.conditionDefs.push(conditionDefSchema.parse({ id: 'steadied', name: 'Steadied', text: 'Somebody has your back.' }));
    demo.project.cards.push(
      cardDefSchema.parse({ id: 'steady-hand', name: 'Steady Hand', text: 'Held while you are steadied.', grant: { kind: 'condition', conditions: ['steadied'] } }),
    );
    demo.project.abilities.push(
      abilitySchema.parse({ id: 'steady-footing', name: 'Steady Footing', source: { card: 'steady-hand' }, kind: 'passive', modifiers: [{ stat: 'evasion', bonus: 1 }] }),
      abilitySchema.parse({ id: 'steady-strike', name: 'Steady Strike', source: { card: 'steady-hand' }, effects: [{ kind: 'log', text: 'Steady.', tone: 'good' }] }),
    );
    refreshWorld(demo);
    return demo;
  };
  const zone = (demo: DemoScene): string[] => loadoutView(demo, 'kara').granted.map((card) => card.id);

  it('is in the hands of whoever bears the condition, for as long as it lasts', () => {
    const demo = lending('lent');
    const evasion = demo.world.poolBonus('kara', 'evasion');
    expect(names(demo, 'kara')).not.toContain('steady-strike');
    expect(zone(demo)).not.toContain('steady-hand');

    demo.world.applyCondition('kara', 'steadied', 'scene');
    // Last, after everything she has for good: on the bar, in the world's hands, and face up.
    expect(names(demo, 'kara').slice(-2)).toEqual(['steady-footing', 'steady-strike']);
    expect(demo.world.heldBy('kara').map((a) => a.id).slice(-2)).toEqual(['steady-footing', 'steady-strike']);
    expect(loadoutView(demo, 'kara').granted.at(-1)).toEqual({
      id: 'steady-hand',
      name: 'Steady Hand',
      text: 'Held while you are steadied.',
      from: 'Lent by Steadied',
    });
    expect(names(demo, 'mira')).not.toContain('steady-strike');
    // Never derived into the numbers her sheet keeps, so read as the world reads a condition's own.
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(evasion + 1);

    demo.world.clearCondition('kara', 'steadied');
    expect(names(demo, 'kara')).not.toContain('steady-strike');
    expect(zone(demo)).not.toContain('steady-hand');
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(evasion);
  });

  it('lends a creature the same card, beside what its block prints', () => {
    const demo = lending('lent-foe');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const printed = demo.world.heldBy(husk.id).map((a) => a.id);
    demo.world.applyCondition(husk.id, 'steadied', 'scene');
    expect(demo.world.heldBy(husk.id).map((a) => a.id)).toEqual([...printed, 'steady-footing', 'steady-strike']);
  });
});

describe('Proficiency, as a script reads it', () => {
  it('is the derived number: a Proficiency box recorded on the sheet counts', () => {
    const demo = scene();
    const sheet = demo.sheets.get('kara')!;
    expect(demo.world.traitValue('kara', 'proficiency')).toBe(sheet.proficiency);
    // A level-5 record with the box ticked; the sheet's own number is left as it was saved.
    const trained = { ...sheet, level: 5, levels: [{ level: 5, advancements: [{ kind: 'proficiency' as const }], domainCard: 'none' }] };
    demo.sheets.set('kara', trained);
    demo.characters.set('kara', deriveCharacter(trained, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    expect(demo.world.traitValue('kara', 'proficiency')).toBe(sheet.proficiency + 1);
    expect(demo.world.proficiencyOf('kara')).toBe(demo.characters.get('kara')!.proficiency);
  });
});

describe("a stat block's cards", () => {
  it('are every card printed on it, named and worded, and none printed elsewhere', () => {
    const demo = scene();
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const block = husk.definition;
    const before = statBlockCards(demo, block).length;
    const printedOn = (id: string, name: string, adversaries: string[], text = '') =>
      cardDefSchema.parse({ id, name, text, grant: { kind: 'adversary', adversaries } });
    // One that is only words, one whose words are on the ability the editor wrote on it, one elsewhere.
    demo.project.cards.push(printedOn('grasp', 'Grasping Roots', [block], 'Roots hold whoever it hits.'));
    demo.project.cards.push(printedOn('howl', 'Howl', ['someone-else', block]));
    demo.project.abilities.push(abilitySchema.parse({ id: 'howl', name: 'Howl', source: { card: 'howl' }, text: 'Everyone near marks a Stress.' }));
    demo.project.cards.push(printedOn('elsewhere', 'Elsewhere', ['someone-else']));
    const shown = statBlockCards(demo, block);
    expect(shown).toHaveLength(before + 2);
    expect(shown.slice(before)).toEqual([
      { id: 'grasp', name: 'Grasping Roots', text: 'Roots hold whoever it hits.' },
      { id: 'howl', name: 'Howl', text: 'Everyone near marks a Stress.' },
    ]);
  });
});

describe('a card aimed at the ground, previewed', () => {
  /** Quim three tiles west of a husk, on its row, holding a card that runs a path and one that shelters a spot. */
  const lined = (): { demo: DemoScene; husk: string } => {
    const demo = scene('preview');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    demo.state.moveEntity('kara', husk.tile - 3);
    demo.project.abilities.push(
      abilitySchema.parse({
        id: 'charge',
        name: 'Charge',
        source: { card: 'charge' },
        text: 'Run a straight path to a point within Far range and strike everything along it.',
        target: { kind: 'point', range: 'far' },
        effects: [{ kind: 'damage', amount: 2, target: { kind: 'inPath', side: 'adversaries' } }],
      }),
      abilitySchema.parse({
        id: 'drop-a-ward',
        name: 'Drop A Ward',
        source: { card: 'drop-a-ward' },
        text: 'Choose a point within Far range and shelter everyone near it.',
        target: { kind: 'point', range: 'far' },
        effects: [{ kind: 'applyCondition', condition: 'vulnerable', target: { kind: 'allies', range: 'close', around: 'point', includeSelf: true } }],
      }),
    );
    refreshWorld(demo);
    return { demo, husk: husk.id };
  };
  const card = (demo: DemoScene, id: string) => demo.project.abilities.find((a) => a.id === id)!;

  it('names whoever the shape would catch, before it is committed to, and changes nothing', () => {
    const { demo, husk } = lined();
    const beyond = demo.state.entity(husk)!.tile + 2;
    expect(shapeAt(demo, 'kara', card(demo, 'charge'), beyond)).toContain(husk);
    // Nothing at all is a legal answer: the preview is a question about a tile, not a promise.
    expect(shapeAt(demo, 'kara', card(demo, 'charge'), NO_TILE)).toEqual([]);
    // Reading it leaves the game as it was: the actor put back, nobody struck.
    expect(demo.scenario.actorId).not.toBe('kara');
    expect(demo.state.entity(husk)!.hitPoints.marked).toBe(0);
    // A shelter dropped at Quim's feet catches Quim.
    expect(shapeAt(demo, 'kara', card(demo, 'drop-a-ward'), demo.state.entity('kara')!.tile)).toContain('kara');
  });

  it('catches nothing for a card that is not aimed at the ground, whatever its effects would reach', () => {
    const { demo, husk } = lined();
    const beyond = demo.state.entity(husk)!.tile + 2;
    // The same strike down a line - but aimed at a creature, so there is no ground to preview a shape from.
    const aimedAtSomebody = abilitySchema.parse({
      id: 'jab',
      name: 'Jab',
      source: { card: 'jab' },
      target: { kind: 'adversary', range: 'far' },
      effects: [{ kind: 'damage', amount: 2, target: { kind: 'inPath', side: 'adversaries' } }],
    });
    expect(shapeAt(demo, 'kara', card(demo, 'charge'), beyond)).toContain(husk);
    expect(shapeAt(demo, 'kara', aimedAtSomebody, beyond)).toEqual([]);
  });
});
