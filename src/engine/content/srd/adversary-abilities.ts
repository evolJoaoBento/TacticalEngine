/**
 * Stat-block features, scripted.
 *
 * An adversary's action and reaction features are abilities like any other —
 * same schema, same effect vocabulary — sourced to the adversaries that print
 * them rather than to a character. The GM's side uses them from
 * `demo-scene.ts`, exactly as a player's side uses a domain card.
 *
 * The role features that every third stat block shares (Relentless, Horde,
 * Minion, Momentum, Terrifying) are not here: they are rules about how a fight
 * runs, read straight off the block in `combat/adversary-features.ts`. What is
 * here is the features that *do* something on a spotlight.
 *
 * `docs/ADVERSARIES.md` lists which features the engine runs and which are
 * still the GM's to narrate.
 */

import { z } from 'zod';
import { abilitySchema, type AbilityDef } from '../abilities';

type Input = z.input<typeof abilitySchema>;

const from = (...adversaries: string[]): Input['source'] => ({ kind: 'adversary', adversaries });

const RAW: Input[] = [
  {
    id: 'acid-burrower-earth-eruption',
    name: 'Earth Eruption',
    source: from('acid-burrower'),
    text: 'Mark a Stress to burst out of the ground. All creatures within Very Close range must succeed on an Agility Reaction Roll or be knocked over, making them Vulnerable until they next act.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The ground splits and heaves.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        // The Burrower's own Difficulty is what a reaction to it has to beat.
        difficulty: 14,
        trait: 'agility',
        // `allies` is the party and `adversaries` the adversaries, whoever is
        // acting: the selectors name factions, not sides. So from a stat
        // block, `allies` is who the feature is aimed at.
        targets: { kind: 'allies', range: 'veryClose' },
        onFail: [
          { kind: 'log', text: 'Knocked off their feet.', tone: 'fear' },
          { kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } },
        ],
      },
    ],
  },
  {
    id: 'acid-burrower-spit-acid',
    name: 'Spit Acid',
    source: from('acid-burrower'),
    text: 'Make an attack against all targets in front of the Burrower within Close range. Targets it succeeds against take 2d6 physical damage and must mark an Armor Slot without receiving its benefits. If they cannot, they mark an additional Hit Point and the GM gains a Fear.',
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Acid arcs out in a wide spray.', tone: 'combat' },
      {
        kind: 'attack',
        // Every party member in reach, each rolled for; "in front of" is the
        // table's line and the engine does not model facing. The feature says
        // Close, which is further than the Burrower's claws go.
        range: 'close',
        target: { kind: 'allies', range: 'close' },
        damage: '2d6',
        onHit: [{ kind: 'run', hook: 'mark-armor-or-hit-point', args: { fear: true } }],
      },
    ],
  },
  {
    id: 'acid-burrower-acid-bath',
    name: 'Acid Bath',
    source: from('acid-burrower'),
    text: 'When the Burrower takes Severe damage, all creatures within Close range are bathed in acidic blood, taking 1d10 physical damage.',
    kind: 'reaction',
    trigger: 'tookSevere',
    action: false,
    target: { kind: 'none', range: 'close' },
    effects: [
      { kind: 'log', text: 'Acid blood sprays from the wound.', tone: 'fear' },
      { kind: 'damage', dice: '1d10', type: 'physical', target: { kind: 'allies', range: 'close' } },
    ],
  },

  // ---- a pass over the stat blocks ----------------------------------------
  //
  // Every feature below is one of three shapes the book writes over and over:
  // an area everyone rolls to avoid, an attack that catches a whole band, or a
  // blow aimed at one creature. The rules text is the vendored block's own,
  // and the script under it says as much of that text as the vocabulary can.
  // Where it says less, the entry carries a line saying what was left out;
  // `docs/ADVERSARIES.md` says why for the ones with no script at all.
  //
  // What is *not* here, and why: a summon, a Countdown, spotlighting allies,
  // anything that turns on a point on the map rather than a band around the
  // adversary, a stat-block token, a transformation, a flight or teleport, and
  // the social features a table plays rather than a grid. Facing is not one of
  // those reasons — "in front of" is read as the whole band, as Spit Acid has
  // been from the start.
  {
    id: 'war-wizard-arcane-artillery',
    name: 'Arcane Artillery',
    source: from('war-wizard'),
    text: 'Spend a Fear to unleash a precise hail of magical blasts. All targets in the scene must make an Agility Reaction Roll. Targets who fail take 2d12 magic damage. Targets who succeed take half damage.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'veryFar' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'A hail of magical blasts falls across the room.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        // The block's own Difficulty, which is what a reaction to it beats.
        difficulty: 16,
        trait: 'agility',
        targets: { kind: 'allies', range: 'veryFar' },
        damage: { dice: '2d12', type: 'magic' },
        onFail: [{ kind: 'damage', dice: 'same' }],
        onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
      },
    ],
  },
  {
    id: 'minor-demon-hellfire',
    name: 'Hellfire',
    source: from('minor-demon'),
    text: 'Spend a Fear to rain down hellfire within Far range. All targets within the area must make an Agility Reaction Roll. Targets who fail take 1d20+3 magic damage. Targets who succeed take half damage.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Hellfire rains down.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 14,
        trait: 'agility',
        targets: { kind: 'allies', range: 'far' },
        damage: { dice: '1d20+3', type: 'magic' },
        onFail: [{ kind: 'damage', dice: 'same' }],
        onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
      },
    ],
  },
  {
    id: 'arch-necromancer-beam-of-decay',
    name: 'Beam of Decay',
    source: from('arch-necromancer'),
    text: 'Mark 2 Stress to cause all targets within Far range to make a Strength Reaction Roll. Targets who fail take 2d20+12 magic damage and you gain a Fear. Targets who succeed take half damage. A target who marks 2 or more HP must also mark 2 Stress and becomes Vulnerable until they roll with Hope.',
    cost: { stress: 2 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: the extra Stress and Vulnerable for a target who marks 2 or more Hit Points are the table's.
    effects: [
      { kind: 'log', text: 'A beam of grey rot sweeps the room.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 21,
        trait: 'strength',
        targets: { kind: 'allies', range: 'far' },
        damage: { dice: '2d20+12', type: 'magic' },
        onFail: [{ kind: 'damage', dice: 'same' }, { kind: 'gainFear' }],
        onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
      },
    ],
  },
  {
    id: 'greater-earth-elemental-rockslide',
    name: 'Rockslide',
    source: from('greater-earth-elemental'),
    text: 'Mark a Stress to create a rockslide that buries the land in front of Elemental within Close range with rockfall. All targets in this area must make an Agility Reaction Roll (19). Targets who fail take 2d12+5 physical damage and become Vulnerable until their next roll with Hope. Targets who succeed take half damage.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The slope comes down in a wall of rock.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 19,
        trait: 'agility',
        targets: { kind: 'allies', range: 'close' },
        damage: { dice: '2d12+5', type: 'physical' },
        onFail: [
          { kind: 'damage', dice: 'same' },
          { kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } },
        ],
        onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
      },
    ],
  },
  {
    id: 'minor-fire-elemental-scorched-earth',
    name: 'Scorched Earth',
    source: from('minor-fire-elemental'),
    text: 'Mark a Stress to choose a point within Far range. The ground within Very Close range of that point immediately bursts into flames. All creatures within this area must make an Agility Reaction Roll. Targets who fail take 2d8 magic damage from the flames. Targets who succeed take half damage.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The ground bursts into flame.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 13,
        trait: 'agility',
        targets: { kind: 'allies', range: 'far' },
        damage: { dice: '2d8', type: 'magic' },
        onFail: [{ kind: 'damage', dice: 'same' }],
        onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
      },
    ],
  },
  {
    id: 'vault-guardian-sentinel-mana-bolt',
    name: 'Mana Bolt',
    source: from('vault-guardian-sentinel'),
    text: 'Spend a Fear to lob explosive magic at a point within Far range. All targets within Very Close range of that point must make an Agility Reaction Roll. Targets who fail take 2d8+20 magic damage and are knocked back to Close range. Targets who succeed take half damage and aren\'t knocked back.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Explosive magic arcs across the vault.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 17,
        trait: 'agility',
        targets: { kind: 'allies', range: 'far' },
        damage: { dice: '2d8+20', type: 'magic' },
        onFail: [{ kind: 'damage', dice: 'same' }, { kind: 'push', to: 'close', target: { kind: 'hit' } }],
        onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
      },
    ],
  },
  {
    id: 'stonewraith-avalanche-roar',
    name: 'Avalanche Roar',
    source: from('stonewraith'),
    text: 'Spend a Fear to roar while within a cave and cause a cave-in. All targets within Close range must succeed on an Agility Reaction Roll (14) or take 2d10 physical damage. The rubble can be cleared with a Progress Countdown (8).',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The roar brings the cave down.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 14,
        trait: 'agility',
        targets: { kind: 'allies', range: 'close' },
        damage: { dice: '2d10', type: 'physical' },
        onFail: [{ kind: 'damage', dice: 'same' }],
      },
    ],
  },
  {
    id: 'high-seraph-god-rays',
    name: 'God Rays',
    source: from('high-seraph'),
    text: 'Mark a Stress to reflect a sliver of divinity as a searing beam of light that hits up to twenty targets within Very Far range. Targets must make a Presence Reaction Roll, with disadvantage if they are marked Guilty. Targets who fail take 4d6+12 magic damage. Targets who succeed take half damage.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'veryFar' },
    inCombatOnly: true,
    // Simplified: the disadvantage a Guilty target rolls with is the table's.
    effects: [
      { kind: 'log', text: 'Divinity comes through in searing beams.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 20,
        trait: 'presence',
        targets: { kind: 'allies', range: 'veryFar' },
        damage: { dice: '4d6+12', type: 'magic' },
        onFail: [{ kind: 'damage', dice: 'same' }],
        onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
      },
    ],
  },
  {
    id: 'spellblade-suppressing-blast',
    name: 'Suppressing Blast',
    source: from('spellblade'),
    text: 'Mark a Stress and target a group within Far range. All targets must succeed on an Agility Reaction Roll or take 1d8+2 magic damage. You gain a Fear for each target who marked HP from this attack.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: the Fear for each target who marked a Hit Point is the GM's to take.
    effects: [
      { kind: 'log', text: 'Magic hammers down over the whole group.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 14,
        trait: 'agility',
        targets: { kind: 'allies', range: 'far' },
        damage: { dice: '1d8+2', type: 'magic' },
        onFail: [{ kind: 'damage', dice: 'same' }],
      },
    ],
  },
  {
    id: 'patchwork-zombie-hulk-tormented-screams',
    name: 'Tormented Screams',
    source: from('patchwork-zombie-hulk'),
    text: 'Mark a Stress to cause all PCs within Far range to make a Presence Reaction Roll (13). Targets who fail lose a Hope and you gain a Fear for each. Targets who succeed must mark a Stress.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: one Fear, rather than one for each target who failed.
    effects: [
      { kind: 'log', text: 'The stitched-together thing screams with every mouth it has.', tone: 'fear' },
      {
        kind: 'reactionRoll',
        difficulty: 13,
        trait: 'presence',
        targets: { kind: 'allies', range: 'far' },
        onFail: [{ kind: 'loseHope' }, { kind: 'gainFear' }],
        onSuccess: [{ kind: 'markStress', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'outer-realms-corruptor-disgorge-reality-flotsam',
    name: 'Disgorge Reality Flotsam',
    source: from('outer-realms-corruptor'),
    text: 'Mark a Stress to spew partially digested portions of consumed realities at all targets within Close range. Targets must succeed on a Knowledge Reaction Roll or mark 2 Stress.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It spews up pieces of a reality it already ate.', tone: 'fear' },
      {
        kind: 'reactionRoll',
        difficulty: 19,
        trait: 'knowledge',
        targets: { kind: 'allies', range: 'close' },
        onFail: [{ kind: 'markStress', amount: 2, target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'young-ice-dragon-avalanche',
    name: 'Avalanche',
    source: from('young-ice-dragon'),
    text: 'Spend a Fear to have the Dragon unleash a huge downfall of snow and ice, covering all other creatures within Far range. All targets within this area must succeed on an Instinct Reaction Roll or be buried in snow and rocks, becoming Vulnerable until they dig themselves out from the debris. For each PC that fails the reaction roll, you gain a Fear.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: the Fear for each failure is the GM's, and they dig out on their next turn rather than on a roll.
    effects: [
      { kind: 'log', text: 'Snow and ice come down over everything.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 18,
        trait: 'instinct',
        targets: { kind: 'allies', range: 'far' },
        onFail: [{ kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'kraken-boiling-blast',
    name: 'Boiling Blast',
    source: from('kraken'),
    text: 'Spend a Fear to spew a line of boiling water at any number of targets in a line up to Far range. All targets must succeed on an Agility Reaction Roll or take 4d6+9 physical damage. If a target marks an Armor Slot to reduce the damage, they must also mark a Stress.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: the Stress for answering it with armor is the table's.
    effects: [
      { kind: 'log', text: 'A line of boiling water goes out across the deck.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 20,
        trait: 'agility',
        targets: { kind: 'allies', range: 'far' },
        damage: { dice: '4d6+9', type: 'physical' },
        onFail: [{ kind: 'damage', dice: 'same' }],
      },
    ],
  },
  {
    id: 'oracle-of-doom-pronounce-fate',
    name: 'Pronounce Fate',
    source: from('oracle-of-doom'),
    text: 'Spend a Fear to present a target within Far range with a vision of their personal nightmare. The target must make a Knowledge Reaction Roll. On a failure, they lose all Hope and take 2d20+4 direct magic damage. On a success, they take half damage and lose a Hope.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'far' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The Oracle names the nightmare aloud.', tone: 'fear' },
      {
        kind: 'reactionRoll',
        difficulty: 20,
        trait: 'knowledge',
        targets: { kind: 'target' },
        damage: { dice: '2d20+4', type: 'magic' },
        // "They lose all Hope": six is the most anyone holds.
        onFail: [{ kind: 'loseHope', amount: 6 }, { kind: 'damage', dice: 'same', direct: true }],
        onSuccess: [{ kind: 'loseHope' }, { kind: 'damage', dice: 'same', half: true, direct: true }],
      },
    ],
  },
  {
    id: 'courtier-mockery',
    name: 'Mockery',
    source: from('courtier'),
    text: 'Mark a Stress to say something mocking and force a target within Close range to make a Presence Reaction Roll (14) to see if they can save face. On a failure, the target must mark 2 Stress and is Vulnerable until the scene ends.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The Courtier says something the whole room hears.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 14,
        trait: 'presence',
        targets: { kind: 'target' },
        onFail: [
          { kind: 'markStress', amount: 2, target: { kind: 'hit' } },
          { kind: 'applyCondition', condition: 'vulnerable', duration: 'scene', target: { kind: 'hit' } },
        ],
      },
    ],
  },
  {
    id: 'fallen-sorcerer-conflagration',
    name: 'Conflagration',
    source: from('fallen-sorcerer'),
    text: 'Spend a Fear to unleash an all-consuming firestorm and make an attack against all targets within Close range. Targets the Sorcerer succeeds against take 2d10+6 direct magic damage.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The firestorm takes the whole room.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'close',
        target: { kind: 'allies', range: 'close' },
        damage: '2d10+6',
        direct: true,
      },
    ],
  },
  {
    id: 'volcanic-dragon-ashen-tyrant-desperate-rampage',
    name: 'Desperate Rampage',
    source: from('volcanic-dragon-ashen-tyrant'),
    text: 'Mark a Stress to make an attack against all targets within Close range. Targets the Ashen Tyrant succeeds against take 2d20+2 physical damage, are knocked back to Close range of where they were, and must mark a Stress.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The Tyrant throws itself at everything still standing.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'close',
        target: { kind: 'allies', range: 'close' },
        damage: '2d20+2',
        onHit: [
          { kind: 'push', to: 'close', target: { kind: 'hit' } },
          { kind: 'markStress', target: { kind: 'hit' } },
        ],
      },
    ],
  },
  {
    id: 'skeleton-knight-cut-to-the-bone',
    name: 'Cut to the Bone',
    source: from('skeleton-knight'),
    text: 'Mark a Stress to make an attack against all targets within Very Close range. Targets the Knight succeeds against take 1d8+2 physical damage and must mark a Stress.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The blade goes round in one long cut.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        target: { kind: 'allies', range: 'veryClose' },
        damage: '1d8+2',
        onHit: [{ kind: 'markStress', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'chaos-skull-magic-burst',
    name: 'Magic Burst',
    source: from('chaos-skull'),
    text: 'Mark a Stress to make an attack against all targets within Close range. Targets the Skull succeeds against take 2d6+4 magic damage.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The skull bursts with raw magic.', tone: 'combat' },
      { kind: 'attack', range: 'close', target: { kind: 'allies', range: 'close' }, damage: '2d6+4' },
    ],
  },
  {
    id: 'glass-snake-spinning-serpent',
    name: 'Spinning Serpent',
    source: from('glass-snake'),
    text: 'Mark a Stress to make an attack against all targets within Very Close range. Targets the Snake succeeds against take 1d6+1 physical damage.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The snake spins, glass edges out.', tone: 'combat' },
      { kind: 'attack', range: 'veryClose', target: { kind: 'allies', range: 'veryClose' }, damage: '1d6+1' },
    ],
  },
  {
    id: 'minor-fire-elemental-explosion',
    name: 'Explosion',
    source: from('minor-fire-elemental'),
    text: 'Spend a Fear to erupt in a fiery explosion. Make an attack against all targets within Close range. Targets the Elemental succeeds against take 1d8 magic damage and are knocked back to Far range.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It erupts.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'close',
        target: { kind: 'allies', range: 'close' },
        damage: '1d8',
        onHit: [{ kind: 'push', to: 'far', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'minotaur-wrecker-charging-bull',
    name: 'Charging Bull',
    source: from('minotaur-wrecker'),
    text: 'Mark a Stress to charge through a group within Close range and make an attack against all targets in the Minotaur\'s path. Targets the Minotaur succeeds against take 2d6+8 physical damage and are knocked back to Very Far range. If a target is knocked into a solid object or another creature, they take an extra 1d6 damage (combine the damage).',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    // Simplified: the extra die for being knocked into something solid is the table's.
    effects: [
      { kind: 'log', text: 'The Minotaur puts its head down and goes through them.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'close',
        target: { kind: 'allies', range: 'close' },
        damage: '2d6+8',
        onHit: [{ kind: 'push', to: 'veryFar', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'volcanic-dragon-obsidian-predator-avalanche-tail',
    name: 'Avalanche Tail',
    source: from('volcanic-dragon-obsidian-predator'),
    text: 'Mark a Stress to make an attack against all targets within Close range. Targets the Obsidian Predator succeeds against take 4d6+4 physical damage and are knocked back to Far range and Vulnerable until their next roll with Hope.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The tail comes round like a falling cliff.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'close',
        target: { kind: 'allies', range: 'close' },
        damage: '4d6+4',
        onHit: [
          { kind: 'push', to: 'far', target: { kind: 'hit' } },
          { kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } },
        ],
      },
    ],
  },
  {
    id: 'adult-flickerfly-whirlwind',
    name: 'Whirlwind',
    source: from('adult-flickerfly'),
    text: 'Spend a Fear to whirl, making an attack against all targets within Very Close range. Targets the Flickerfly succeeds against take 3d8 direct physical damage.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The Flickerfly whirls, wings like knives.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        target: { kind: 'allies', range: 'veryClose' },
        damage: '3d8',
        direct: true,
      },
    ],
  },
  {
    id: 'perfected-zombie-perfect-strike',
    name: 'Perfect Strike',
    source: from('perfected-zombie'),
    text: 'Mark a Stress to make a standard attack against all targets within Very Close range. Targets the Zombie succeeds against are Vulnerable until their next rest.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It strikes once, perfectly, at each of them.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        target: { kind: 'allies', range: 'veryClose' },
        onHit: [{ kind: 'applyCondition', condition: 'vulnerable', duration: 'rest', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'cave-ogre-hail-of-boulders',
    name: 'Hail of Boulders',
    source: from('cave-ogre'),
    text: 'Mark a Stress to pick up heavy objects and throw them at all targets in front of the Ogre within Far range. Make an attack against these targets. Targets the Ogre succeeds against take 1d10+2 physical damage. If they succeed against more than one target, you gain a Fear.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: the Fear for catching more than one is the GM's to take.
    effects: [
      { kind: 'log', text: 'The Ogre throws whatever it can lift.', tone: 'combat' },
      { kind: 'attack', range: 'far', target: { kind: 'allies', range: 'far' }, damage: '1d10+2' },
    ],
  },
  {
    id: 'greater-water-elemental-drowning-embrace',
    name: 'Drowning Embrace',
    source: from('greater-water-elemental'),
    text: 'Spend a Fear to make an attack against all targets within Very Close range. Targets the Elemental succeeds against become Restrained and Vulnerable as they begin drowning. A target can break free, ending both conditions, with a successful Strength or Instinct Roll.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    // Simplified: the roll to break free is the table's; the hold ends on their next turn.
    effects: [
      { kind: 'log', text: 'The water closes over them.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        target: { kind: 'allies', range: 'veryClose' },
        onHit: [
          { kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'hit' } },
          { kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } },
        ],
      },
    ],
  },
  {
    id: 'bear-bite',
    name: 'Bite',
    source: from('bear'),
    text: 'Mark a Stress to make an attack against a target within Melee range. On a success, deal 3d4+10 physical damage and the target is Restrained until they break free with a successful Strength Roll.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'melee' },
    inCombatOnly: true,
    // Simplified: the Strength Roll to break free is the table's; the hold ends on their next turn.
    effects: [
      { kind: 'log', text: 'The Bear closes its jaws.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'melee',
        damage: '3d4+10',
        onHit: [{ kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'dire-wolf-hobbling-strike',
    name: 'Hobbling Strike',
    source: from('dire-wolf'),
    text: 'Mark a Stress to make an attack against a target within Melee range. On a success, deal 3d4+10 direct physical damage and make them Vulnerable until they clear at least 1 HP.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'melee' },
    inCombatOnly: true,
    // Simplified: the SRD holds it until they clear a Hit Point; here it ends on their next turn.
    effects: [
      { kind: 'log', text: 'The Wolf goes for the legs.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'melee',
        damage: '3d4+10',
        direct: true,
        onHit: [{ kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'minotaur-wrecker-gore',
    name: 'Gore',
    source: from('minotaur-wrecker'),
    text: 'Make an attack against a target within Very Close range, moving the Minotaur into Melee range of them. On a success, deal 2d8 direct physical damage.',
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It lowers its horns and comes in.', tone: 'combat' },
      { kind: 'attack', range: 'veryClose', damage: '2d8', direct: true },
    ],
  },
  {
    id: 'gorgon-crown-of-serpents',
    name: 'Crown of Serpents',
    source: from('gorgon'),
    text: 'Make an attack roll against a target within Melee range using the Gorgon\'s protective snakes. On a success, mark a Stress to deal 2d10+4 physical damage and the target must mark a Stress.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'melee' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The snakes strike on their own.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'melee',
        damage: '2d10+4',
        onHit: [{ kind: 'markStress', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'spectral-guardian-grave-blade',
    name: 'Grave Blade',
    source: from('spectral-guardian'),
    text: 'Spend a Fear to make an attack against a target within Very Close range. On a success, deal 2d10+6 physical damage and the target must mark a Stress.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The grave blade comes up out of the dark.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        damage: '2d10+6',
        onHit: [{ kind: 'markStress', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'archer-guard-hobbling-shot',
    name: 'Hobbling Shot',
    source: from('archer-guard'),
    text: 'Make an attack against a target within Far range. On a success, mark a Stress to deal 1d12+3 physical damage. If the target marks HP from this attack, they have disadvantage on Agility Rolls until they clear at least 1 HP.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'far' },
    inCombatOnly: true,
    // Simplified: the disadvantage on Agility Rolls afterwards is the table's.
    effects: [
      { kind: 'log', text: 'The shot is aimed low.', tone: 'combat' },
      { kind: 'attack', range: 'far', damage: '1d12+3' },
    ],
  },
  {
    id: 'giant-eagle-deadly-dive',
    name: 'Deadly Dive',
    source: from('giant-eagle'),
    text: 'Mark a Stress to attack a target within Far range. On a success, deal 2d10+2 physical damage and knock the target over, making them Vulnerable until they next act.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'far' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The Eagle folds its wings and drops.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'far',
        damage: '2d10+2',
        onHit: [{ kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'vampire-draining-bite',
    name: 'Draining Bite',
    source: from('vampire'),
    text: 'Make an attack against a target within Melee range. On a success, deal 5d4 physical damage. A target who marks HP from this attack loses a Hope and must mark a Stress. The Vampire then clears a HP.',
    target: { kind: 'creature', range: 'melee' },
    inCombatOnly: true,
    // Simplified: the rider is written for a target who marks a Hit Point; here it follows any hit.
    effects: [
      { kind: 'log', text: 'The Vampire drinks.', tone: 'fear' },
      {
        kind: 'attack',
        range: 'melee',
        damage: '5d4',
        onHit: [
          { kind: 'loseHope', target: { kind: 'hit' } },
          { kind: 'markStress', target: { kind: 'hit' } },
          { kind: 'heal', amount: 1, target: { kind: 'actor' } },
        ],
      },
    ],
  },
  {
    id: 'bladed-guard-detain',
    name: 'Detain',
    source: from('bladed-guard'),
    text: 'Make an attack against a target within Very Close range. On a success, mark a Stress to Restrain the target until they break free with a successful attack, Finesse Roll, or Strength Roll.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    // Simplified: the roll to break free is the table's; the hold ends on their next turn.
    effects: [
      { kind: 'log', text: 'The Guard takes hold and does not let go.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        onHit: [{ kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'vault-guardian-gaoler-lock-up',
    name: 'Lock Up',
    source: from('vault-guardian-gaoler'),
    text: 'Mark a Stress to make an attack against a target within Very Close range. On a success, the target is Restrained within the Gaoler until freed with a successful Strength Roll (18). While Restrained, the target can only attack the Gaoler.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    // Simplified: the Strength Roll to break free is the table's; the hold ends on their next turn.
    effects: [
      { kind: 'log', text: 'The Gaoler folds them inside itself.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        onHit: [{ kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'giant-beastmaster-pinning-strike',
    name: 'Pinning Strike',
    source: from('giant-beastmaster'),
    text: 'Make a standard attack against a target. On a success, you can mark a Stress to pin them to a nearby surface. The pinned target is Restrained until they break free with a successful Finesse or Strength Roll.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    // Simplified: the roll to break free is the table's; the pin ends on their next turn.
    effects: [
      { kind: 'log', text: 'The strike pins them to the wall.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        onHit: [{ kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'volcanic-dragon-molten-scourge-shattering-might',
    name: 'Shattering Might',
    source: from('volcanic-dragon-molten-scourge'),
    text: 'Mark a Stress to make an attack against a target within Very Close range. On a success, the target takes 4d8+1 physical damage, loses a Hope, and is knocked back to Close range. The Molten Scourge clears a Stress.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The blow lands like a falling mountain.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        damage: '4d8+1',
        onHit: [
          { kind: 'loseHope', target: { kind: 'hit' } },
          { kind: 'push', to: 'close', target: { kind: 'hit' } },
        ],
      },
      { kind: 'clearStress', amount: 1, target: { kind: 'actor' } },
    ],
  },
  {
    id: 'demon-of-hubris-unparalleled-skill',
    name: 'Unparalleled Skill',
    source: from('demon-of-hubris'),
    text: 'Mark a Stress to deal the Demon\'s standard attack damage to a target within Close range.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It does not bother to swing.', tone: 'fear' },
      { kind: 'damage', dice: 'weapon', target: { kind: 'target' } },
    ],
  },
  {
    id: 'greater-water-elemental-water-jet',
    name: 'Water Jet',
    source: from('greater-water-elemental'),
    text: 'Mark a Stress to attack a target within Very Close range. On a success, deal 2d4+7 physical damage and the target\'s next action has disadvantage. On a failure, the target must mark a Stress.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    // Simplified: the disadvantage on their next action is the table's.
    effects: [
      { kind: 'log', text: 'A jet of water hits like a hammer.', tone: 'combat' },
      { kind: 'attack', range: 'veryClose', damage: '2d4+7', onMiss: [{ kind: 'markStress', target: { kind: 'target' } }] },
    ],
  },
  {
    id: 'hydra-terrifying-chorus',
    name: 'Terrifying Chorus',
    source: from('hydra'),
    text: 'All PCs within Far range lose 2 Hope.',
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Every head speaks at once.', tone: 'fear' },
      { kind: 'loseHope', amount: 2, target: { kind: 'allies', range: 'far' } },
    ],
  },
  {
    id: 'demonic-hound-pack-dreadhowl',
    name: 'Dreadhowl',
    source: from('demonic-hound-pack'),
    text: 'Mark a Stress to make all targets within Very Close range lose a Hope. If a target is not able to lose a Hope, they must instead mark 2 Stress.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    // Simplified: the 2 Stress for a target with no Hope to lose is the table's.
    effects: [
      { kind: 'log', text: 'The pack howls as one.', tone: 'fear' },
      { kind: 'loseHope', target: { kind: 'allies', range: 'veryClose' } },
    ],
  },
  {
    id: 'minor-chaos-elemental-remake-reality',
    name: 'Remake Reality',
    source: from('minor-chaos-elemental'),
    text: 'Spend a Fear to transform the area within Very Close range into a different biome. All targets within this area take 2d6+3 direct magic damage.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The room becomes somewhere else.', tone: 'fear' },
      { kind: 'damage', dice: '2d6+3', type: 'magic', direct: true, target: { kind: 'allies', range: 'veryClose' } },
    ],
  },
  {
    id: 'minor-chaos-elemental-sickening-flux',
    name: 'Sickening Flux',
    source: from('minor-chaos-elemental'),
    text: 'Mark a HP to force all targets within Close range to mark a Stress and become Vulnerable until their next rest or they clear a HP.',
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The air itself turns sick.', tone: 'fear' },
      // "Mark a HP" is the cost, and the schema prices Hope and Stress only.
      { kind: 'damage', amount: 1, target: { kind: 'actor' } },
      { kind: 'markStress', target: { kind: 'allies', range: 'close' } },
      { kind: 'applyCondition', condition: 'vulnerable', duration: 'rest', target: { kind: 'allies', range: 'close' } },
    ],
  },
  {
    id: 'deeproot-defender-ground-slam',
    name: 'Ground Slam',
    source: from('deeproot-defender'),
    text: 'Slam the ground, knocking all targets within Very Close range back to Far range. Each target knocked back this way must mark a Stress.',
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    // Simplified: everyone in reach is knocked back, and the Stress follows them out.
    effects: [
      { kind: 'log', text: 'The ground goes out from under all of them.', tone: 'combat' },
      { kind: 'push', to: 'far', target: { kind: 'allies', range: 'veryClose' } },
      { kind: 'markStress', target: { kind: 'allies', range: 'far' } },
    ],
  },
  {
    id: 'weaponmaster-adrenaline-burst',
    name: 'Adrenaline Burst',
    source: from('weaponmaster'),
    text: 'Once per scene, spend a Fear to clear 2 HP and 2 Stress.',
    cost: { fear: 1 },
    uses: { count: 1, per: 'scene' },
    available: { kind: 'pool', pool: 'hitPoints', measure: 'marked', op: '>=', value: 1 },
    target: { kind: 'self', range: 'melee' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'It shakes off the wound and comes back at them.', tone: 'fear' },
      { kind: 'heal', amount: 2, target: { kind: 'actor' } },
      { kind: 'clearStress', amount: 2, target: { kind: 'actor' } },
    ],
  },
  {
    id: 'patchwork-zombie-hulk-another-for-the-pile',
    name: 'Another for the Pile',
    source: from('patchwork-zombie-hulk'),
    text: 'When the Zombie is within Very Close range of a corpse, they can incorporate it into themselves, clearing a HP and a Stress.',
    available: { kind: 'pool', pool: 'hitPoints', measure: 'marked', op: '>=', value: 1 },
    target: { kind: 'self', range: 'veryClose' },
    inCombatOnly: true,
    // Simplified: the corpse it needs is the table's to place.
    effects: [
      { kind: 'log', text: 'It works another body into itself.', tone: 'fear' },
      { kind: 'heal', amount: 1, target: { kind: 'actor' } },
      { kind: 'clearStress', amount: 1, target: { kind: 'actor' } },
    ],
  },
  {
    id: 'hydra-regeneration',
    name: 'Regeneration',
    source: from('hydra'),
    text: 'If the Hydra has any marked HP, spend a Fear to clear a HP and grow two heads.',
    cost: { fear: 1 },
    available: { kind: 'pool', pool: 'hitPoints', measure: 'marked', op: '>=', value: 1 },
    target: { kind: 'self', range: 'melee' },
    inCombatOnly: true,
    // Simplified: the heads it grows are counted by the table.
    effects: [
      { kind: 'log', text: 'The wound closes, and two more heads come up.', tone: 'fear' },
      { kind: 'heal', amount: 1, target: { kind: 'actor' } },
    ],
  },

  // ---- what a block does to damage coming in -------------------------------
  //
  // A passive that says "resistant to physical damage" is a `defenses` line and
  // nothing else: the rule itself lives in `rules/damage.ts`, and halving
  // rounds up. Damage of two types is only halved by a creature that resists
  // both, which is what the Spellblade's Arcane Steel exists to defeat.
  {
    id: 'minor-chaos-elemental-arcane-form',
    name: 'Arcane Form',
    source: from('minor-chaos-elemental'),
    text: 'The Elemental is resistant to magic damage.',
    kind: 'passive',
    action: false,
    defenses: { resistances: ['magic'] },
  },
  {
    id: 'chaos-skull-wards',
    name: 'Wards',
    source: from('chaos-skull'),
    text: 'The Skull is resistant to magic damage.',
    kind: 'passive',
    action: false,
    defenses: { resistances: ['magic'] },
  },
  {
    id: 'skeleton-warrior-only-bones',
    name: 'Only Bones',
    source: from('skeleton-warrior'),
    text: 'The Warrior is resistant to physical damage.',
    kind: 'passive',
    action: false,
    defenses: { resistances: ['physical'] },
  },
  {
    id: 'zombie-legion-unyielding',
    name: 'Unyielding',
    source: from('zombie-legion'),
    text: 'The Legion has resistance to physical damage.',
    kind: 'passive',
    action: false,
    defenses: { resistances: ['physical'] },
  },
  {
    id: 'failed-experiment-warped-fortitude',
    name: 'Warped Fortitude',
    source: from('failed-experiment'),
    text: 'The Experiment is resistant to physical damage.',
    kind: 'passive',
    action: false,
    defenses: { resistances: ['physical'] },
  },
  {
    id: 'volcanic-dragon-obsidian-predator-obsidian-scales',
    name: 'Obsidian Scales',
    source: from('volcanic-dragon-obsidian-predator'),
    text: 'The Obsidian Predator is resistant to physical damage.',
    kind: 'passive',
    action: false,
    defenses: { resistances: ['physical'] },
  },
  {
    id: 'spectral-archer-ghost',
    name: 'Ghost',
    source: from('spectral-archer'),
    text: 'The Archer has resistance to physical damage. Mark a Stress to move up to Close range through solid objects.',
    kind: 'passive',
    action: false,
    // Simplified: walking through solid objects is the table's.
    defenses: { resistances: ['physical'] },
  },
  {
    id: 'spectral-captain-ghost',
    name: 'Ghost',
    source: from('spectral-captain'),
    text: 'The Captain has resistance to physical damage. Mark a Stress to move up to Close range through solid objects.',
    kind: 'passive',
    action: false,
    // Simplified: walking through solid objects is the table's.
    defenses: { resistances: ['physical'] },
  },
  {
    id: 'spectral-guardian-ghost',
    name: 'Ghost',
    source: from('spectral-guardian'),
    text: 'The Guardian has resistance to physical damage. Mark a Stress to move up to Close range through solid objects.',
    kind: 'passive',
    action: false,
    // Simplified: walking through solid objects is the table's.
    defenses: { resistances: ['physical'] },
  },
  {
    id: 'oak-treant-take-root',
    name: 'Take Root',
    source: from('oak-treant'),
    text: 'Mark a Stress to Root the Treant in place. The Treant is Restrained while Rooted, and can end this effect instead of moving while they are spotlighted. While Rooted, the Treant has resistance to physical damage.',
    cost: { stress: 1 },
    target: { kind: 'self', range: 'melee' },
    inCombatOnly: true,
    // Once: a Treant already rooted has nothing to gain by rooting again.
    available: { kind: 'not', of: { kind: 'hasCondition', condition: 'rooted', of: { kind: 'actor' } } },
    // Simplified: the Treant stays where it is by choice rather than by rule.
    // An adversary the engine holds still spends its spotlight tearing free,
    // so a creature that rooted itself would spend every other turn undoing
    // it; what the condition keeps is the half that answers a blade.
    effects: [
      { kind: 'log', text: 'Roots go down into the stone.', tone: 'combat' },
      { kind: 'applyCondition', condition: 'rooted', duration: 'scene', target: { kind: 'actor' } },
    ],
  },

  // ---- what a block hangs on the swing it already prints --------------------
  //
  // "Targets who mark HP from the Zombie's attacks must also mark a Stress" is
  // a reaction to the block's own standard attack: `dealtHit` when it lands at
  // all, `dealtDamage` only when a Hit Point was marked. Both are played by the
  // GM's turn with the one it hit bound as the target. A passive that changes
  // what the swing *is* rather than what follows it says so in one line.
  {
    id: 'shambling-zombie-horrifying',
    name: 'Horrifying',
    source: from('shambling-zombie'),
    text: 'Targets who mark HP from the Zombie\'s attacks must also mark a Stress.',
    kind: 'reaction',
    trigger: 'dealtDamage',
    action: false,
    effects: [{ kind: 'markStress', target: { kind: 'hit' } }],
  },
  {
    id: 'fallen-shock-troop-aura-of-doom',
    name: 'Aura of Doom',
    source: from('fallen-shock-troop'),
    text: 'When a PC marks HP from an attack by the Shock Troop, they lose a Hope.',
    kind: 'reaction',
    trigger: 'dealtDamage',
    action: false,
    effects: [{ kind: 'loseHope', target: { kind: 'hit' } }],
  },
  {
    id: 'outer-realms-corruptor-will-shattering-touch',
    name: 'Will-Shattering Touch',
    source: from('outer-realms-corruptor'),
    text: 'When a PC takes damage from the Corruptor, they lose a Hope.',
    kind: 'reaction',
    trigger: 'dealtDamage',
    action: false,
    effects: [{ kind: 'loseHope', target: { kind: 'hit' } }],
  },
  {
    id: 'assassin-poisoner-grindletooth-venom',
    name: 'Grindletooth Venom',
    source: from('assassin-poisoner'),
    text: 'Targets who mark HP from the Assassin\'s attacks are Vulnerable until they clear a HP.',
    kind: 'reaction',
    trigger: 'dealtDamage',
    action: false,
    // Simplified: it lasts until their next turn rather than until they clear a Hit Point.
    effects: [
      { kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } },
    ],
  },
  {
    id: 'bear-overwhelming-force',
    name: 'Overwhelming Force',
    source: from('bear'),
    text: 'Targets who mark HP from the Bear\'s standard attack are knocked back to Very Close range.',
    kind: 'reaction',
    trigger: 'dealtDamage',
    action: false,
    effects: [{ kind: 'push', to: 'veryClose', target: { kind: 'hit' } }],
  },
  {
    id: 'vault-guardian-sentinel-kinetic-slam',
    name: 'Kinetic Slam',
    source: from('vault-guardian-sentinel'),
    text: 'Targets who take damage from the Sentinel\'s standard attack are knocked back to Very Close range.',
    kind: 'reaction',
    trigger: 'dealtDamage',
    action: false,
    effects: [{ kind: 'push', to: 'veryClose', target: { kind: 'hit' } }],
  },
  {
    id: 'green-ooze-acidic-form',
    name: 'Acidic Form',
    source: from('green-ooze', 'tiny-green-ooze', 'huge-green-ooze'),
    text: 'When the Ooze makes a successful attack, the target must mark an Armor Slot without receiving its benefits (they can still use armor to reduce the damage). If they can\'t mark an Armor Slot, they must mark an additional HP.',
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    effects: [{ kind: 'run', hook: 'mark-armor-or-hit-point' }],
  },
  {
    id: 'greater-earth-elemental-crushing-blows',
    name: 'Crushing Blows',
    source: from('greater-earth-elemental'),
    text: 'When the Elemental makes a successful attack, the target must mark an Armor Slot without receiving its benefits (they can still use armor to reduce the damage). If they can\'t mark an Armor Slot, they must mark an additional HP.',
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    effects: [{ kind: 'run', hook: 'mark-armor-or-hit-point' }],
  },
  {
    id: 'shark-rending-bite',
    name: 'Rending Bite',
    source: from('shark'),
    text: 'When the Shark makes a successful attack, the target must mark an Armor Slot without receiving its benefits (they can still use armor to reduce the damage). If they can\'t mark an Armor Slot, they must mark an additional HP.',
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    effects: [{ kind: 'run', hook: 'mark-armor-or-hit-point' }],
  },
  {
    id: 'demon-of-wrath-anger-unrelenting',
    name: 'Anger Unrelenting',
    source: from('demon-of-wrath'),
    text: 'The Demon\'s attacks deal direct damage.',
    kind: 'passive',
    action: false,
    standardAttack: { direct: true },
  },
  {
    id: 'cave-ogre-bone-breaker',
    name: 'Bone Breaker',
    source: from('cave-ogre'),
    text: 'The Ogre\'s attacks deal direct damage.',
    kind: 'passive',
    action: false,
    standardAttack: { direct: true },
  },
  {
    id: 'demon-of-jealousy-unprotected-mind',
    name: 'Unprotected Mind',
    source: from('demon-of-jealousy'),
    text: 'The Demon\'s standard attack deals direct damage.',
    kind: 'passive',
    action: false,
    standardAttack: { direct: true },
  },
  // ---- what a block takes off the damage before it meets the thresholds ----
  // "Reduce it by 3", "reduce it by 1d10": one number, off the total, before
  // the bands are read. The rule is in `rules/damage.ts`; the flat kind is
  // arithmetic, and the dice kind is rolled once per hit.
  {
    id: 'knight-of-the-realm-heavily-armored',
    name: 'Heavily Armored',
    source: from('knight-of-the-realm'),
    text: 'When the Knight takes physical damage, reduce it by 3.',
    kind: 'passive',
    action: false,
    defenses: { reduce: [{ dice: '3', only: 'physical' }] },
  },
  {
    id: 'greater-earth-elemental-immovable-object',
    name: 'Immovable Object',
    source: from('greater-earth-elemental'),
    text: 'An attack that would move the Elemental moves them two fewer ranges (for example, Far becomes Very Close). When the Elemental takes physical damage, reduce it by 7.',
    kind: 'passive',
    action: false,
    // Simplified: the damage only; nothing yet shortens a push.
    defenses: { reduce: [{ dice: '7', only: 'physical' }] },
  },
  {
    id: 'fallen-warlord-undefeated-champion-faltering-armor',
    name: 'Faltering Armor',
    source: from('fallen-warlord-undefeated-champion'),
    text: 'When the Undefeated Champion takes damage, reduce it by 1d10.',
    kind: 'passive',
    action: false,
    defenses: { reduce: [{ dice: '1d10' }] },
  },
  {
    id: 'fallen-warlord-realm-breaker-firespite-plate-armor',
    name: 'Firespite Plate Armor',
    source: from('fallen-warlord-realm-breaker'),
    text: 'When the Realm-Breaker takes damage, reduce it by 2d10.',
    kind: 'passive',
    action: false,
    defenses: { reduce: [{ dice: '2d10' }] },
  },
  {
    id: 'outer-realms-abomination-unreal-form',
    name: 'Unreal Form',
    source: from('outer-realms-abomination'),
    text: 'When the Abomination takes damage, reduce it by 1d20. If the Abomination marks 1 or fewer Hit Points from a successful attack against them, you gain a Fear.',
    kind: 'passive',
    action: false,
    // Simplified: the reduction only. It is printed as a reaction, but it costs
    // nothing and is never declined, so it is held as a passive; the Fear for a
    // hit that marks 1 or fewer Hit Points is the GM's.
    defenses: { reduce: [{ dice: '1d20' }] },
  },
  // ---- the swarm that piles onto one target ----------------------------
  // "Spend a Fear to choose a target and spotlight all Giant Rats within Close
  // range of them." Sixteen Minion blocks print this with one number changed,
  // and the number is always the block's own attack damage — so none of them
  // states it: `joinedBy` walks the rest of the kind in and counts the swing
  // once for each of them.
  {
    id: 'giant-rat-group-attack',
    name: 'Group Attack',
    source: from('giant-rat'),
    text: 'Spend a Fear to choose a target and spotlight all Giant Rats within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 1 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'jagged-knife-lackey-group-attack',
    name: 'Group Attack',
    source: from('jagged-knife-lackey'),
    text: 'Spend a Fear to choose a target and spotlight all Jagged Knife Lackeys within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 2 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'minor-treant-group-attack',
    name: 'Group Attack',
    source: from('minor-treant'),
    text: 'Spend a Fear to choose a target and spotlight all Minor Treants within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 4 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'sellsword-group-attack',
    name: 'Group Attack',
    source: from('sellsword'),
    text: 'Spend a Fear to choose a target and spotlight all Sellswords within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 3 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'skeleton-dredge-group-attack',
    name: 'Group Attack',
    source: from('skeleton-dredge'),
    text: 'Spend a Fear to choose a target and spotlight all Dredges within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 1 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'tangle-bramble-group-attack',
    name: 'Group Attack',
    source: from('tangle-bramble'),
    text: 'Spend a Fear to choose a target and spotlight all Tangle Brambles within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 2 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'rotted-zombie-group-attack',
    name: 'Group Attack',
    source: from('rotted-zombie'),
    text: 'Spend a Fear to choose a target and spotlight all Rotted Zombies within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 2 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'apprentice-assassin-group-attack',
    name: 'Group Attack',
    source: from('apprentice-assassin'),
    text: 'Spend a Fear to choose a target and spotlight all Apprentice Assassins within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 4 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'conscript-group-attack',
    name: 'Group Attack',
    source: from('conscript'),
    text: 'Spend a Fear to choose a target and spotlight all Conscripts within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 6 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'cult-initiate-group-attack',
    name: 'Group Attack',
    source: from('cult-initiate'),
    text: 'Spend a Fear to choose a target and spotlight all Cult Initiates within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 5 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'giant-recruit-group-attack',
    name: 'Group Attack',
    source: from('giant-recruit'),
    text: 'Spend a Fear to choose a target and spotlight all Giant Recruits within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 5 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'elemental-spark-group-attack',
    name: 'Group Attack',
    source: from('elemental-spark'),
    text: 'Spend a Fear to choose a target and spotlight all Elemental Sparks within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 5 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    // Simplified: the Spark's own attack is magic damage, and that is what the swarm deals; the feature as printed says physical.
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'treant-sapling-group-attack',
    name: 'Group Attack',
    source: from('treant-sapling'),
    text: 'Spend a Fear to choose a target and spotlight all Treant Saplings within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 8 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'fallen-shock-troop-group-attack',
    name: 'Group Attack',
    source: from('fallen-shock-troop'),
    text: 'Spend a Fear to choose a target and spotlight all Fallen Shock Troops within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 12 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'hallowed-soldier-group-attack',
    name: 'Group Attack',
    source: from('hallowed-soldier'),
    text: 'Spend a Fear to choose a target and spotlight all Hallowed Soldiers within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 10 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  {
    id: 'outer-realms-thrall-group-attack',
    name: 'Group Attack',
    source: from('outer-realms-thrall'),
    text: 'Spend a Fear to choose a target and spotlight all Outer Realm Thralls within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 11 physical damage each. Combine this damage.',
    cost: { fear: 1 },
    target: { kind: 'creature', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        target: { kind: 'target' },
        joinedBy: { kind: 'adversaries', range: 'close', around: 'target', sameKind: true },
      },
    ],
  },
  // ---- what a block calls onto the map ----------------------------------
  // "Summon three Jagged Knife Lackeys, who appear at Far range." They stand
  // in the band the feature names and are in the fight from that moment: the
  // encounter reads the map rather than a roster, so nothing else is told.
  // Every one of these is gated — a Fear, a Stress, once or twice a scene —
  // because a summons nothing pays for would be all a creature ever did.
  {
    id: 'jagged-knife-lieutenant-more-where-that-came-from',
    name: 'More Where That Came From',
    source: from('jagged-knife-lieutenant'),
    text: 'Summon three Jagged Knife Lackeys, who appear at Far range.',
    cost: { fear: 1 },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'summon', adversary: 'jagged-knife-lackey', count: '3', range: 'far' }],
  },
  {
    id: 'petty-noble-guards-seize-them',
    name: 'Guards, Seize Them!',
    source: from('petty-noble'),
    text: 'Once per scene, mark a Stress to summon 1d4 Bladed Guards, who appear at Far range to enforce the Noble\'s will.',
    cost: { stress: 1 },
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'summon', adversary: 'bladed-guard', count: '1d4', range: 'far' }],
  },
  {
    id: 'pirate-captain-reinforcements',
    name: 'Reinforcements',
    source: from('pirate-captain'),
    text: 'Once per scene, mark a Stress to summon a Pirate Raiders Horde, which appears at Far range.',
    cost: { stress: 1 },
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'summon', adversary: 'pirate-raiders', range: 'far' }],
  },
  {
    id: 'giant-beastmaster-deadly-companion',
    name: 'Deadly Companion',
    source: from('giant-beastmaster'),
    text: 'Twice per scene, summon a Bear, Dire Wolf, or similar Tier 1 animal adversary under the Beastmaster\'s control. The adversary appears at Close range and is immediately spotlighted.',
    uses: { count: 2, per: 'scene' },
    target: { kind: 'none' },
    inCombatOnly: true,
    // Simplified: it brings a Bear; the text offers a Bear, a Dire Wolf \'or similar Tier 1 animal\', which is the GM\'s pick.
    effects: [{ kind: 'summon', adversary: 'bear', range: 'close', spotlight: true }],
  },
  {
    id: 'head-vampire-the-hunt-is-on',
    name: 'The Hunt Is On',
    source: from('head-vampire'),
    text: 'Spend 2 Fear to summon 1d4 Vampires, who appear at Far range and immediately take the spotlight.',
    cost: { fear: 2 },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'summon', adversary: 'vampire', count: '1d4', range: 'far', spotlight: true }],
  },
  {
    id: 'arch-necromancer-open-the-gates-of-death',
    name: 'Open the Gates of Death',
    source: from('arch-necromancer'),
    text: 'Spend a Fear to summon a Zombie Legion, which appears at Close range and immediately takes the spotlight.',
    cost: { fear: 1 },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'summon', adversary: 'zombie-legion', range: 'close', spotlight: true }],
  },
  {
    id: 'fallen-warlord-undefeated-champion-endless-legions',
    name: 'Endless Legions',
    source: from('fallen-warlord-undefeated-champion'),
    text: 'Spend a Fear to summon a number of Fallen Shock Troops equal to twice the number of PCs. The Shock Troops appear at Far range.',
    cost: { fear: 1 },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'summon', adversary: 'fallen-shock-troop', count: '2', perPc: true, range: 'far' }],
  },
  {
    id: 'secret-keeper-fallen-hounds',
    name: 'Fallen Hounds',
    source: from('secret-keeper'),
    text: 'Once per scene, when the Secret-Keeper marks 2 or more HP, you can mark a Stress to summon a Demonic Hound Pack, which appears at Close range and is immediately spotlighted.',
    cost: { stress: 1 },
    uses: { count: 1, per: 'scene' },
    available: { kind: 'pool', pool: 'hitPoints', measure: 'marked', op: '>=', value: 2 },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'summon', adversary: 'demonic-hound-pack', range: 'close', spotlight: true }],
  },
];

export const SRD_ADVERSARY_ABILITIES: readonly AbilityDef[] = RAW.map((raw) => abilitySchema.parse(raw));
