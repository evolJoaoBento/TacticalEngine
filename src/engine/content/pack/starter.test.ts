import { describe, expect, it } from 'vitest';
import { blankSheet, deriveCharacter } from '../../character/sheet';
import { abilitiesFor, abilitySchema, cardOf } from '../abilities';
import { contentPackSchema } from './schema';
import { STARTER_ABILITIES, STARTER_CHARACTERS, STARTER_PACK } from './starter';

/**
 * The pack the engine ships with.
 *
 * These are not tests of taste — they are the things that would quietly break a
 * project: an id named twice, a subclass pointing at a class nobody wrote, a
 * card whose ability names a different card, an adversary the demo cannot find.
 */

const ids = (list: readonly { id: string }[]): string[] => list.map((entry) => entry.id);
const duplicates = (values: readonly string[]): string[] =>
  values.filter((value, at) => values.indexOf(value) !== at);

describe('the pack as a document', () => {
  it('parses against the schema it claims to be', () => {
    expect(() => contentPackSchema.parse(STARTER_PACK)).not.toThrow();
  });

  it('names nothing twice', () => {
    for (const [kind, list] of Object.entries(STARTER_PACK)) {
      expect(duplicates(ids(list as { id: string }[])), kind).toEqual([]);
    }
  });

  it('ships something of every kind the engine reads', () => {
    expect(STARTER_PACK.classes.length).toBeGreaterThan(0);
    expect(STARTER_PACK.ancestries.length).toBeGreaterThan(0);
    expect(STARTER_PACK.communities.length).toBeGreaterThan(0);
    expect(STARTER_PACK.subclasses.length).toBeGreaterThan(0);
    expect(STARTER_PACK.cards.length).toBeGreaterThan(0);
    expect(STARTER_PACK.weapons.length).toBeGreaterThan(0);
    expect(STARTER_PACK.armors.length).toBeGreaterThan(0);
    expect(STARTER_PACK.adversaries.length).toBeGreaterThan(0);
  });
});

describe('the pack refers only to itself', () => {
  it('gives every subclass a class that exists', () => {
    const classIds = new Set(ids(STARTER_PACK.classes));
    for (const subclass of STARTER_PACK.subclasses) {
      expect(classIds.has(subclass.classId), subclass.id).toBe(true);
    }
  });

  it('draws every card from a domain some class offers', () => {
    const domains = new Set(STARTER_PACK.classes.flatMap((klass) => klass.domains));
    for (const card of STARTER_PACK.cards) {
      if (card.grant.kind !== 'chosen') continue;
      expect(domains.has(card.domain!), card.id).toBe(true);
    }
  });

  it('grants every printed card from something the pack has, and prints something for each', () => {
    const has = {
      class: new Set(ids(STARTER_PACK.classes)),
      subclass: new Set(ids(STARTER_PACK.subclasses)),
      ancestry: new Set(ids(STARTER_PACK.ancestries)),
      community: new Set(ids(STARTER_PACK.communities)),
    };
    const granting: string[] = [];
    for (const card of STARTER_PACK.cards) {
      const grant = card.grant;
      if (grant.kind === 'class') expect(has.class.has(grant.classId), card.id).toBe(true), granting.push(grant.classId);
      if (grant.kind === 'subclass') expect(has.subclass.has(grant.subclassId), card.id).toBe(true), granting.push(grant.subclassId);
      if (grant.kind === 'ancestry') expect(has.ancestry.has(grant.ancestryId), card.id).toBe(true), granting.push(grant.ancestryId);
      if (grant.kind === 'community') expect(has.community.has(grant.communityId), card.id).toBe(true), granting.push(grant.communityId);
    }
    for (const owner of [...has.class, ...has.subclass, ...has.ancestry, ...has.community]) {
      expect(granting, owner).toContain(owner);
    }
  });

  it('indexes the same content it lists', () => {
    expect(STARTER_CHARACTERS.classes.size).toBe(STARTER_PACK.classes.length);
    expect(STARTER_CHARACTERS.cards.size).toBe(STARTER_PACK.cards.length);
    expect(STARTER_CHARACTERS.weapons.size).toBe(STARTER_PACK.weapons.length);
  });
});

describe('the abilities behind the cards', () => {
  it('are all well formed', () => {
    for (const ability of STARTER_ABILITIES) {
      expect(() => abilitySchema.parse(ability), ability.id).not.toThrow();
    }
  });

  it('each sit on a card the pack actually has', () => {
    const cardIds = new Set(ids(STARTER_PACK.cards));
    for (const ability of STARTER_ABILITIES) {
      expect(cardIds.has(cardOf(ability)), ability.id).toBe(true);
    }
  });

  /**
   * The engine's two paired resources are being renamed, and `cost` carries
   * their old names as document fields. Nothing shipped here spends them, so
   * this pack needs no migration when that rename lands. A card that wants a
   * price uses Stress, which is not changing.
   */
  it('spend no resource whose name is about to change', () => {
    for (const ability of STARTER_ABILITIES) {
      const parsed = abilitySchema.parse(ability);
      expect(parsed.cost.good, ability.id).toBeUndefined();
      expect(parsed.cost.bad, ability.id).toBeUndefined();
    }
  });
});

describe('a character can actually be built from it', () => {
  /**
   * The tests above prove the pack is well formed and refers only to itself.
   * This proves it is *usable*, which is a different claim and the one the demo
   * depends on: `deriveCharacter` reports every id it cannot resolve, so an
   * empty `issues` is the pack answering for all of them at once.
   */
  const sentinel = blankSheet('probe', 'sentinel', {
    name: 'Probe',
    traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
    ancestryId: 'stoneborn',
    communityId: 'wayfarer',
    armorId: 'ringmail',
    primaryWeaponId: 'longsword',
    subclassId: 'shieldbearer',
    domainCards: ['power-slash', 'iron-stance'],
  });

  it('resolves every id a full sheet names', () => {
    const { issues } = deriveCharacter(sentinel, STARTER_CHARACTERS, STARTER_ABILITIES);
    expect(issues).toEqual([]);
  });

  it('gives that character numbers the rules can use', () => {
    const { character } = deriveCharacter(sentinel, STARTER_CHARACTERS, STARTER_ABILITIES);
    // Evasion and Hit Points come from the class, thresholds from the armor.
    expect(character.evasion).toBeGreaterThan(0);
    expect(character.hitPoints).toBeGreaterThan(0);
    expect(character.armorScore).toBeGreaterThan(0);
    expect(character.thresholds.severe).toBeGreaterThan(character.thresholds.major);
    // The weapon it names is the weapon it fights with.
    expect(character.primaryWeapon?.id).toBe('longsword');
    expect(character.subclass?.id).toBe('shieldbearer');
    expect(ids([...character.cards])).toEqual(['power-slash', 'iron-stance']);
  });

  it("folds a card's passive bonus into the numbers", () => {
    const { character } = deriveCharacter(sentinel, STARTER_CHARACTERS, STARTER_ABILITIES);
    const plain = deriveCharacter(
      blankSheet('bare', 'sentinel', { armorId: 'ringmail' }),
      STARTER_CHARACTERS,
      STARTER_ABILITIES,
    ).character;
    // Iron Stance raises Armor Score, and the probe holds it.
    expect(character.armorScore).toBeGreaterThan(plain.armorScore);
  });

  /**
   * A character is more than the cards in their hands. These two come from the
   * class and the subclass rather than a card, which is the only shipped content
   * that reaches those paths at all — so this is the test that they are wired.
   */
  it("grants the class's and the subclass's own features", () => {
    const { character } = deriveCharacter(sentinel, STARTER_CHARACTERS, STARTER_ABILITIES);
    const names = abilitiesFor(character, STARTER_ABILITIES).map((ability) => ability.name);
    expect(names).toContain('Drilled');
    expect(names).toContain('Set Feet');
  });

  it('folds those features into the numbers, as the cards are folded in', () => {
    const withFeatures = deriveCharacter(sentinel, STARTER_CHARACTERS, STARTER_ABILITIES).character;
    // The same sheet with nothing behind it: no cards, no features, so the
    // difference is exactly what the pack's own abilities are worth.
    const bare = deriveCharacter(sentinel, STARTER_CHARACTERS, []).character;
    // Set Feet, and nothing else the probe holds, moves a threshold.
    expect(withFeatures.thresholds.major).toBe(bare.thresholds.major + 1);
    expect(withFeatures.thresholds.severe).toBe(bare.thresholds.severe + 1);
    // Drilled and Iron Stance both raise Armor Score, so it is worth two.
    expect(withFeatures.armorScore).toBe(bare.armorScore + 2);
  });

  it('builds one of each class without complaint', () => {
    for (const klass of STARTER_PACK.classes) {
      const { issues } = deriveCharacter(
        blankSheet(`probe-${klass.id}`, klass.id, {}),
        STARTER_CHARACTERS,
        STARTER_ABILITIES,
      );
      expect(issues, klass.id).toEqual([]);
    }
  });
});

describe('the adversaries', () => {
  it('cover the roles a fight needs', () => {
    const roles = new Set(STARTER_PACK.adversaries.map((adversary) => adversary.role));
    for (const role of ['standard', 'ranged', 'horde', 'minion', 'bruiser', 'leader', 'solo']) {
      expect(roles.has(role as never), role).toBe(true);
    }
  });

  it('are all tier 1 or 2, which is what a starter fight is', () => {
    for (const adversary of STARTER_PACK.adversaries) {
      expect([1, 2]).toContain(adversary.tier);
    }
  });

  it('each carry a readable stat line', () => {
    for (const adversary of STARTER_PACK.adversaries) {
      expect(adversary.description.length, adversary.id).toBeGreaterThan(0);
      expect(adversary.motivesAndTactics.length, adversary.id).toBeGreaterThan(0);
      expect(adversary.thresholds.severe).toBeGreaterThan(adversary.thresholds.major);
    }
  });
});
