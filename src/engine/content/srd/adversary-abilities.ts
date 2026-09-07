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
  // ---- one creature off the map and another in its place ------------------
  // "When the Realm-Breaker marks their last HP, replace them with the
  // Undefeated Champion and immediately spotlight them." A phase change is the
  // last feature a stat block plays, and it has to play before anybody counts
  // who is left standing, or the party wins a fight that was not over.
  //
  // A Split is the same move on a different trigger: the Ooze is gone and two
  // smaller ones stand where it did, off their own block with nothing marked.
  //
  // Simplified: "immediately spotlight them" lands only when the fall happens
  // inside a GM turn - a countdown, another creature's feature. A creature put
  // down on the party's turn is replaced at once, but what stands up waits for
  // the GM's turn to act: the SRD's move interrupts the party, and the turn
  // model here does not have an interrupt.
  {
    id: 'green-ooze-split',
    name: 'Split',
    source: from('green-ooze'),
    text: 'When the Ooze has 3 or more HP marked, you can spend a Fear to split them into two Tiny Green Oozes (with no marked HP or Stress). Immediately spotlight both of them.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    cost: { fear: 1 },
    available: { kind: 'pool', pool: 'hitPoints', measure: 'marked', op: '>=', value: 3 },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'replace', adversary: 'tiny-green-ooze', count: '2', spotlight: true }],
  },
  {
    id: 'red-ooze-split',
    name: 'Split',
    source: from('red-ooze'),
    text: 'When the Ooze has 3 or more HP marked, you can spend a Fear to split them into two Tiny Red Oozes (with no marked HP or Stress). Immediately spotlight both of them.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    cost: { fear: 1 },
    available: { kind: 'pool', pool: 'hitPoints', measure: 'marked', op: '>=', value: 3 },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'replace', adversary: 'tiny-red-ooze', count: '2', spotlight: true }],
  },
  {
    id: 'huge-green-ooze-split',
    name: 'Split',
    source: from('huge-green-ooze'),
    text: 'When the Ooze has 4 or more HP marked, you can spend a Fear to split them into two Green Oozes (with no marked HP or Stress). Immediately spotlight both of them.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    cost: { fear: 1 },
    available: { kind: 'pool', pool: 'hitPoints', measure: 'marked', op: '>=', value: 4 },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'replace', adversary: 'green-ooze', count: '2', spotlight: true }],
  },
  {
    id: 'fallen-warlord-realm-breaker-i-have-never-known-defeat',
    name: 'I Have Never Known Defeat',
    source: from('fallen-warlord-realm-breaker'),
    text: 'When the Realm-Breaker marks their last HP, replace them with the Undefeated Champion and immediately spotlight them.',
    kind: 'reaction',
    trigger: 'defeated',
    action: false,
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'replace', adversary: 'fallen-warlord-undefeated-champion', spotlight: true }],
  },
  {
    id: 'volcanic-dragon-obsidian-predator-erupting-rage',
    name: 'Erupting Rage',
    source: from('volcanic-dragon-obsidian-predator'),
    text: 'When the Obsidian Predator marks their last HP, replace them with the Molten Scourge and immediately spotlight them.',
    kind: 'reaction',
    trigger: 'defeated',
    action: false,
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'replace', adversary: 'volcanic-dragon-molten-scourge', spotlight: true }],
  },
  {
    id: 'volcanic-dragon-molten-scourge-ashen-vengeance',
    name: 'Ashen Vengeance',
    source: from('volcanic-dragon-molten-scourge'),
    text: 'When the Molten Scourge marks their last HP, replace them with the Ashen Tyrant and immediately spotlight them.',
    kind: 'reaction',
    trigger: 'defeated',
    action: false,
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [{ kind: 'replace', adversary: 'volcanic-dragon-ashen-tyrant', spotlight: true }],
  },
  // ---- numbers the blow leaves behind -------------------------------------
  // A feature that answers a wound can now be told how big it was. `amount`
  // takes a count instead of a written number - the Hit Points the blow marked
  // on the one answering, the Hit Points that answer has marked back, how many
  // creatures the last roll beat - and `available` compares one, which is what
  // "when the Brawler marks 2 or more HP" was waiting for.
  //
  // Damage is not one of them. "Half the damage they dealt" is `dice: 'same'`
  // with `half`, carrying the blow's own dice and type through the thresholds
  // the way the original went; a count marks Hit Points outright and would
  // walk past armor and severity both.
  //
  // What still waits: a number the block keeps rather than the blow (the
  // Demon's handfuls of gold, the Assassin's unmarked Stress), a count spent
  // per target rather than in total (the Champion's "lose a number of Hope
  // equal to the HP they marked"), dice rolled one per Hit Point, and a Fear
  // cost that is a number rather than a price - the vocabulary gains Fear and
  // never spends it, which is why the Demon of Jealousy's My Turn is text.
  {
    id: 'minor-chaos-elemental-magical-reflection',
    name: 'Magical reflection',
    source: from('minor-chaos-elemental'),
    text: 'When the Elemental takes damage from an attack within Close range, deal an amount of damage to the attacker equal to half the damage they dealt.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: { kind: 'withinRange', range: 'close' },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'The blow bends back on itself.', tone: 'fear' },
      // `same` is the blow that just landed, half of it, in the kind it came
      // in: it goes through the attacker's thresholds the way it went through
      // the Elemental's.
      { kind: 'damage', dice: 'same', half: true, target: { kind: 'target' } },
    ],
  },
  {
    id: 'giant-brawler-bloody-reprisal',
    name: 'Bloody Reprisal',
    source: from('giant-brawler'),
    text: 'When the Brawler marks 2 or more HP from an attack within Very Close range, you can make a standard attack against the attacker. On a success, the Brawler deals 2d6+15 physical damage instead of their standard damage.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'withinRange', range: 'veryClose' },
        { kind: 'count', of: 'hitPointsTaken', op: '>=', value: 2 },
      ],
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'The Brawler answers the wound with the hammer.', tone: 'fear' },
      { kind: 'attack', damage: '2d6+15', target: { kind: 'target' } },
    ],
  },
  {
    id: 'electric-eels-paralyzing-shock',
    name: 'Paralyzing Shock',
    source: from('electric-eels'),
    text: 'Mark a Stress to make a standard attack against all targets within Very Close range. You gain a Fear for each target that marks HP.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The water goes white with current.', tone: 'combat' },
      { kind: 'attack', range: 'veryClose', target: { kind: 'allies', range: 'veryClose' } },
      // Simplified: a Fear for each target the shock beat rather than for each
      // one that marked HP. The two part only when armor or a threshold eats a
      // hit that landed, and `hit` is the count the swing already keeps.
      { kind: 'gainFear', amount: 'targetsHit' },
    ],
  },
  {
    id: 'juvenile-flickerfly-mind-dance',
    name: 'Mind Dance',
    source: from('juvenile-flickerfly'),
    text: "Mark a Stress to create a magically dazzling display that grapples the minds of nearby foes. All targets within Close range must make an Instinct Reaction Roll. For each target who failed, you gain a Fear and the Flickerfly learns one of the target's fears.",
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    // Simplified: what the Flickerfly learns is the table's to remember. The
    // clock it feeds - Hallucinatory Breath's disadvantage for a target whose
    // fears are known - was already left out there for the same reason.
    effects: [
      { kind: 'log', text: 'Wings strobe in a pattern the eye cannot leave.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 14,
        trait: 'instinct',
        targets: { kind: 'allies', range: 'close' },
        onFail: [
          { kind: 'log', text: 'Their thoughts come loose.', tone: 'fear' },
          { kind: 'gainFear', amount: 'targetsHit' },
        ],
      },
    ],
  },
  {
    id: 'adult-flickerfly-mind-dance',
    name: 'Mind Dance',
    source: from('adult-flickerfly'),
    text: "Mark a Stress to create a magically dazzling display that grapples the minds of nearby foes. All targets within Close range must make an Instinct Reaction Roll. For each target who failed, you gain a Fear and the Flickerfly learns one of the target's fears.",
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Wings strobe in a pattern the eye cannot leave.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        difficulty: 17,
        trait: 'instinct',
        targets: { kind: 'allies', range: 'close' },
        onFail: [
          { kind: 'log', text: 'Their thoughts come loose.', tone: 'fear' },
          { kind: 'gainFear', amount: 'targetsHit' },
        ],
      },
    ],
  },
  {
    id: 'arch-necromancer-your-life-is-mine',
    name: 'Your Life Is Mine',
    source: from('arch-necromancer'),
    text: 'When the Necromancer has marked 6 or more of their HP, activate the countdown. When it triggers, deal 2d10+6 direct magic damage to a target within Close range. The Necromancer then clears a number of Stress or HP equal to the number of HP marked by the target from this attack.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    uses: { count: 1, per: 'scene' },
    available: { kind: 'pool', pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked', op: '>=', value: 6 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'arch-necromancer-your-life-is-mine',
        name: 'Your Life Is Mine',
        start: '2d6',
        loop: 'reset',
        // Simplified: Stress or HP is the GM's choice at the table; the
        // Necromancer takes the Hit Points back, which is what the wound it
        // just answered cost it.
        effects: [
          { kind: 'log', text: 'The Necromancer drinks the wound back.', tone: 'fear' },
          { kind: 'damage', dice: '2d10+6', type: 'magic', direct: true, target: { kind: 'allies', range: 'close', nearest: 1 } },
          { kind: 'heal', amount: 'hitPointsDealt', target: { kind: 'actor' } },
        ],
      },
    ],
  },
  // The other half of a counted wound: a gate that fires when the blow was
  // *small*. "When the Captain marks 2 or fewer HP from an attack within Melee
  // range, the attacker must mark a Stress" - which includes a hit that marked
  // none at all, and is why the trigger is `tookDamage` rather than
  // `tookHitPoints`.
  {
    id: 'pirate-captain-swashbuckler',
    name: 'Swashbuckler',
    source: from('pirate-captain'),
    text: 'When the Captain marks 2 or fewer HP from an attack within Melee range, the attacker must mark a Stress.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'withinRange', range: 'melee' },
        { kind: 'count', of: 'hitPointsTaken', op: '<=', value: 2 },
      ],
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Turned aside with a laugh.', tone: 'fear' },
      { kind: 'markStress', target: { kind: 'target' } },
    ],
  },
  {
    id: 'pirate-raiders-swashbuckler',
    name: 'Swashbuckler',
    source: from('pirate-raiders'),
    text: 'When the Raiders marks 2 or fewer HP from an attack within Melee range, the attacker must mark a Stress.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'withinRange', range: 'melee' },
        { kind: 'count', of: 'hitPointsTaken', op: '<=', value: 2 },
      ],
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Turned aside with a laugh.', tone: 'fear' },
      { kind: 'markStress', target: { kind: 'target' } },
    ],
  },
  {
    id: 'pirate-tough-swashbuckler',
    name: 'Swashbuckler',
    source: from('pirate-tough'),
    text: 'When the Tough marks 2 or fewer HP from an attack within Melee range, the attacker must mark a Stress.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'withinRange', range: 'melee' },
        { kind: 'count', of: 'hitPointsTaken', op: '<=', value: 2 },
      ],
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Turned aside with a laugh.', tone: 'fear' },
      { kind: 'markStress', target: { kind: 'target' } },
    ],
  },
  // ---- creatures that walk before they swing ------------------------------
  // `move` is the one acting crossing the ground: `toward` closes until the
  // band it names is close enough, `away` puts as much between them as the
  // walk allows. It is a walk, not a step through walls - the pathfinder
  // decides what it can reach - and the ground it covers is a band, Close
  // unless the feature says further.
  //
  // What stays text is a path rather than a destination: "move to a point
  // within Close range and deal damage to all targets in their path" is a line
  // drawn across the map, and selectors read bands around a creature. Dive-
  // Bomb is not one of those - the SRD says move there and attack everyone
  // within Very Close of where it lands, which is a destination and a band.
  {
    id: 'pirate-tough-clear-the-decks',
    name: 'Clear the Decks',
    source: from('pirate-tough'),
    text: 'Make an attack against a target within Very Close range. On a success, mark a Stress to move into Melee range of the target, dealing 3d4 physical damage and knocking the target back to Close range.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The Tough wades in swinging.', tone: 'combat' },
      {
        kind: 'attack',
        range: 'veryClose',
        target: { kind: 'target' },
        onHit: [
          { kind: 'move', how: 'toward', of: { kind: 'hit' }, range: 'melee' },
          { kind: 'damage', dice: '3d4', type: 'physical', target: { kind: 'hit' } },
          { kind: 'push', to: 'close', target: { kind: 'hit' } },
        ],
      },
    ],
  },
  {
    id: 'elite-soldier-reinforce',
    name: 'Reinforce',
    source: from('elite-soldier'),
    text: 'Mark a Stress to move into Melee range of an ally and make a standard attack against a target within Very Close range. On a success, deal 2d10+2 physical damage and the ally can clear a Stress.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The Soldier falls in beside one of their own.', tone: 'combat' },
      // The nearest of its own side, which is the one a soldier reinforces.
      { kind: 'move', how: 'toward', of: { kind: 'adversaries', range: 'far', nearest: 1 }, range: 'melee' },
      {
        kind: 'attack',
        range: 'veryClose',
        damage: '2d10+2',
        target: { kind: 'target' },
        onHit: [{ kind: 'clearStress', target: { kind: 'adversaries', range: 'melee', nearest: 1 } }],
      },
    ],
  },
  {
    id: 'knight-of-the-realm-cavalry-charge',
    name: 'Cavalry Charge',
    source: from('knight-of-the-realm'),
    text: 'If the Knight is mounted, move up to Far range and make a standard attack against a target. On a success, deal 2d8+4 physical damage and the target must mark a Stress.',
    target: { kind: 'creature', range: 'far' },
    inCombatOnly: true,
    // Simplified: the Knight is mounted, as the Chevalier passive already has
    // it - whether they have been unhorsed is the table's to say.
    effects: [
      { kind: 'log', text: 'Hooves, and then the sword.', tone: 'combat' },
      { kind: 'move', how: 'toward', of: { kind: 'target' }, range: 'melee', budget: 'far' },
      {
        kind: 'attack',
        damage: '2d8+4',
        target: { kind: 'target' },
        onHit: [{ kind: 'markStress', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'volcanic-dragon-obsidian-predator-dive-bomb',
    name: 'Dive-Bomb',
    source: from('volcanic-dragon-obsidian-predator'),
    text: 'If the Obsidian Predator is flying, mark a Stress to choose a point within Far range. Move to that point and make an attack against all targets within Very Close range. Targets the Obsidian Predator succeeds against take 2d10+6 physical damage and must mark a Stress.',
    cost: { stress: 1 },
    target: { kind: 'creature', range: 'far' },
    inCombatOnly: true,
    // Simplified: the point it dives at is whoever it aimed the feature at,
    // which is the only point on the map anything here can name.
    effects: [
      { kind: 'log', text: 'It folds its wings and falls.', tone: 'fear' },
      { kind: 'move', how: 'toward', of: { kind: 'target' }, range: 'melee', budget: 'far' },
      {
        kind: 'attack',
        range: 'veryClose',
        damage: '2d10+6',
        target: { kind: 'allies', range: 'veryClose' },
        onHit: [{ kind: 'markStress', target: { kind: 'hit' } }],
      },
    ],
  },
  {
    id: 'harrier-maintain-distance',
    name: 'Maintain Distance',
    source: from('harrier'),
    text: 'After making a standard attack, the Harrier can move anywhere within Far range.',
    kind: 'reaction',
    // Simplified: after a swing that landed. Nothing raises "I swung and
    // missed" for the one swinging, so a Harrier whose javelin goes wide
    // stands its ground.
    trigger: 'dealtHit',
    action: false,
    target: { kind: 'none' },
    effects: [{ kind: 'move', how: 'away', of: { kind: 'target' }, budget: 'far' }],
  },
  {
    id: 'war-wizard-battle-teleport',
    name: 'Battle Teleport',
    source: from('war-wizard'),
    text: 'Before or after making a standard attack, you can mark a Stress to teleport to a location within Far range.',
    kind: 'reaction',
    trigger: 'dealtHit',
    cost: { stress: 1 },
    action: false,
    target: { kind: 'none' },
    // Simplified: after the staff, never before it, and a walk rather than a
    // step - the Wizard goes as far from what it just hit as the ground allows.
    effects: [{ kind: 'move', how: 'away', of: { kind: 'target' }, budget: 'far' }],
  },
  {
    id: 'fallen-sorcerer-slippery',
    name: 'Slippery',
    source: from('fallen-sorcerer'),
    text: 'When the Sorcerer takes damage from an attack, they can teleport up to Far range.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    target: { kind: 'none' },
    // A blow with nobody behind it has nothing to get away from, and the
    // Sorcerer stands where they are.
    effects: [{ kind: 'move', how: 'away', of: { kind: 'target' }, budget: 'far' }],
  },
  // ---- what the two of them make of each other ---------------------------
  // A passive that moves a roll rather than a pool. `advantage` is a signed
  // count of dice, and `against: true` puts it on the rolls made at the one
  // holding it: "creatures within Melee range of the Gaoler have disadvantage
  // on attack rolls against them".
  //
  // It is a two-party rule and only that. The Swarm of Rats giving
  // disadvantage on attacks aimed at *anybody else*, and a Shambling Zombie
  // lending advantage against the creature it is standing next to, are about a
  // third creature, and stay text.
  //
  // The flight passives are older than any of this: "+3 to their Difficulty"
  // is a plain Evasion bonus, and the only reason they were text is that
  // nobody had written them down.
  //
  // Simplified, for all five: the creature is aloft. Whether it has landed is
  // the table's to say, and nothing here can ask.
  {
    id: 'giant-mosquitoes-flying',
    name: 'Flying',
    source: from('giant-mosquitoes'),
    text: 'While flying, the Mosquitoes have a +2 bonus to their Difficulty.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    modifiers: [{ stat: 'evasion', bonus: 2 }],
  },
  {
    id: 'giant-eagle-flight',
    name: 'Flight',
    source: from('giant-eagle'),
    text: 'While flying, the Eagle gains a +3 bonus to their Difficulty.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    modifiers: [{ stat: 'evasion', bonus: 3 }],
  },
  {
    id: 'dire-bat-flying',
    name: 'Flying',
    source: from('dire-bat'),
    text: 'While flying, the Bat gains a +3 bonus to their Difficulty.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    modifiers: [{ stat: 'evasion', bonus: 3 }],
  },
  {
    id: 'volcanic-dragon-obsidian-predator-flying',
    name: 'Flying',
    source: from('volcanic-dragon-obsidian-predator'),
    text: 'While flying, the Obsidian Predator gains a +3 bonus to their Difficulty.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    modifiers: [{ stat: 'evasion', bonus: 3 }],
  },
  {
    id: 'volcanic-dragon-ashen-tyrant-injured-wings',
    name: 'Injured Wings',
    source: from('volcanic-dragon-ashen-tyrant'),
    text: 'While flying, the Ashen Tyrant gains a +1 bonus to their Difficulty.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    modifiers: [{ stat: 'evasion', bonus: 1 }],
  },
  {
    id: 'knight-of-the-realm-chevalier',
    name: 'Chevalier',
    source: from('knight-of-the-realm'),
    text: 'While the Knight is on a mount, they gain a +2 bonus to their Difficulty. When they take Severe damage, they are knocked from their mount and lose this benefit until they are next spotlighted.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    // Simplified: the Knight stays mounted. Being knocked from the saddle on a
    // Severe wound and climbing back on next spotlight is a state the block
    // keeps, and the table keeps it here.
    modifiers: [{ stat: 'evasion', bonus: 2 }],
  },
  {
    id: 'vault-guardian-gaoler-blocking-shield',
    name: 'Blocking Shield',
    source: from('vault-guardian-gaoler'),
    text: 'Creatures within Melee range of the Gaoler have disadvantage on attack rolls against them. Creatures trapped inside the Gaoler are immune to this feature.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    // Simplified: nothing is trapped inside a Gaoler here, so nothing is
    // exempt from the shield.
    modifiers: [{ stat: 'advantage', bonus: -1, against: true, when: { kind: 'withinRange', range: 'melee' } }],
  },
  {
    id: 'demon-of-avarice-money-talks',
    name: 'Money Talks',
    source: from('demon-of-avarice'),
    text: 'Attacks against the Demon are made with disadvantage unless the attacker spends a handful of gold. This Demon starts with a number of handfuls equal to the number of PCs. When a target marks HP from the Demon standard attack, they can spend a handful of gold instead of marking HP (1 handful per HP). Add a handful of gold to the Demon for each handful of gold spent by PCs on this feature.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    // Simplified: the gold is the table. The disadvantage stands, and buying
    // it off - or buying off a Hit Point with a handful - is not a purse the
    // engine keeps.
    modifiers: [{ stat: 'advantage', bonus: -1, against: true }],
  },
  {
    id: 'assassin-poisoner-out-of-nowhere',
    name: 'Out of Nowhere',
    source: from('assassin-poisoner'),
    text: 'The Assassin has advantage on attacks if they are Hidden.',
    kind: 'passive',
    action: false,
    target: { kind: 'none' },
    modifiers: [{ stat: 'advantage', bonus: 1, when: { kind: 'hasCondition', condition: 'hidden', of: { kind: 'actor' } } }],
  },
  {
    id: 'young-ice-dragon-frozen-scales',
    name: 'Frozen Scales',
    source: from('young-ice-dragon'),
    text: 'When a creature makes a successful attack against the Dragon from within Very Close range, they must mark a Stress and become Chilled until their next rest or they clear a Stress. While they are Chilled, they have disadvantage on attack rolls.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: { kind: 'withinRange', range: 'veryClose' },
    target: { kind: 'none' },
    effects: [
      { kind: 'markStress', target: { kind: 'target' } },
      { kind: 'applyCondition', condition: 'chilled', duration: 'scene', target: { kind: 'target' } },
    ],
  },
  // ---- what a wound answers with -----------------------------------------
  // "When the Knight takes damage from an attack within Melee range, mark a
  // Stress to deal 1d10+5 physical damage to the attacker." Whoever dealt the
  // blow is bound as the target, so the reach the text names is a plain
  // `withinRange` on the ability and hitting back is the ordinary vocabulary.
  //
  // `tookDamage` is anything that got through, `tookHitPoints` the ones
  // written "when they mark HP", and `tookSevere` a Severe wound. A feature
  // that names a number of Hit Points - "2 or more", "2 or fewer" - stays
  // text: how much of it landed is not something a script can read.
  {
    id: 'war-wizard-warding-sphere',
    name: 'Warding Sphere',
    source: from('war-wizard'),
    text: 'When the Wizard takes damage from an attack within Close range, deal 2d6 magic damage to the attacker. This reaction can not be used again until the Wizard refreshes it with their "Refresh Warding Sphere" action.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    // Simplified: the Refresh Warding Sphere action that brings it back is a
    // second feature spending the GM turn on nothing visible, so the sphere
    // holds for one blow a scene.
    uses: { count: 1, per: 'scene' },
    available: { kind: 'withinRange', range: 'close' },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'The warding sphere answers.', tone: 'fear' },
      { kind: 'damage', dice: '2d6', type: 'magic', target: { kind: 'target' } },
    ],
  },
  {
    id: 'stag-knight-thorny-armor',
    name: 'Thorny Armor',
    source: from('stag-knight'),
    text: 'When the Knight takes damage from an attack within Melee range, you can mark a Stress to deal 1d10+5 physical damage to the attacker.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    cost: { stress: 1 },
    available: { kind: 'withinRange', range: 'melee' },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Thorns drive back into the blow.', tone: 'fear' },
      { kind: 'damage', dice: '1d10+5', type: 'physical', target: { kind: 'target' } },
    ],
  },
  {
    id: 'demon-of-wrath-retaliation',
    name: 'Retaliation',
    source: from('demon-of-wrath'),
    text: 'When the Demon takes damage from an attack within Close range, you can mark a Stress to make a standard attack against the attacker.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    cost: { stress: 1 },
    available: { kind: 'withinRange', range: 'close' },
    target: { kind: 'none' },
    effects: [{ kind: 'attack', target: { kind: 'target' }, range: 'close' }],
  },
  {
    id: 'zombie-pack-overwhelm',
    name: 'Overwhelm',
    source: from('zombie-pack'),
    text: 'When the Zombies mark HP from an attack within Melee range, you can mark a Stress to make a standard attack against the attacker.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    cost: { stress: 1 },
    available: { kind: 'withinRange', range: 'melee' },
    target: { kind: 'none' },
    effects: [{ kind: 'attack', target: { kind: 'target' } }],
  },
  {
    id: 'oracle-of-doom-vengeful-fate',
    name: 'Vengeful Fate',
    source: from('oracle-of-doom'),
    text: 'When the Oracle marks HP from an attack within Very Close range, you can mark a Stress to knock the attacker back to Far range and deal 2d10+4 physical damage.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    cost: { stress: 1 },
    available: { kind: 'withinRange', range: 'veryClose' },
    target: { kind: 'none' },
    effects: [
      { kind: 'push', to: 'far', target: { kind: 'target' } },
      { kind: 'damage', dice: '2d10+4', type: 'physical', target: { kind: 'target' } },
    ],
  },
  {
    id: 'volcanic-dragon-molten-scourge-lava-splash',
    name: 'Lava Splash',
    source: from('volcanic-dragon-molten-scourge'),
    text: 'When the Molten Scourge takes Severe damage from an attack within Very Close range, molten blood gushes from the wound and deals 2d10+4 direct physical damage to the attacker.',
    kind: 'reaction',
    trigger: 'tookSevere',
    action: false,
    available: { kind: 'withinRange', range: 'veryClose' },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Molten blood gushes from the wound.', tone: 'fear' },
      { kind: 'damage', dice: '2d10+4', type: 'physical', direct: true, target: { kind: 'target' } },
    ],
  },
  // The two clocks that were waiting on a trigger rather than on a payoff:
  // "when the Flickerfly takes damage for the first time" is `tookDamage`
  // with a `uses` of one.
  {
    id: 'juvenile-flickerfly-hallucinatory-breath',
    name: 'Hallucinatory Breath',
    source: from('juvenile-flickerfly'),
    text: 'When the Flickerfly takes damage for the first time, activate the countdown. When it triggers, the Flickerfly breathes hallucinatory gas on all targets in front of them up to Far range. Targets must succeed on an Instinct Reaction Roll or be tormented by fearful hallucinations. Targets whose fears are known to the Flickerfly have disadvantage on this roll. Targets who fail must mark a Stress and lose a Hope.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'juvenile-flickerfly-hallucinatory-breath',
        name: 'Hallucinatory Breath',
        start: '1d6',
        loop: 'reset',
        // Simplified: "all targets in front of them" is a facing nothing here
        // keeps, so the gas fills the band; the disadvantage for a target
        // whose fears are known is a fact about the fiction, not the map.
        effects: [
          { kind: 'log', text: 'Hallucinatory gas rolls out.', tone: 'fear' },
          {
            kind: 'reactionRoll',
            difficulty: 14,
            trait: 'instinct',
            targets: { kind: 'allies', range: 'far' },
            onFail: [
              { kind: 'markStress', target: { kind: 'hit' } },
              { kind: 'loseHope', target: { kind: 'hit' } },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'adult-flickerfly-hallucinatory-breath',
    name: 'Hallucinatory Breath',
    source: from('adult-flickerfly'),
    text: 'When the Flickerfly takes damage for the first time, activate the countdown. When it triggers, the Flickerfly breathes hallucinatory gas on all targets in front of them up to Far range. Targets must make an Instinct Reaction Roll or be tormented by fearful hallucinations. Targets whose fears are known to the Flickerfly have disadvantage on this roll. Targets who fail lose 2 Hope and take 3d8+3 direct magic damage.',
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'adult-flickerfly-hallucinatory-breath',
        name: 'Hallucinatory Breath',
        start: '1d6',
        loop: 'reset',
        effects: [
          { kind: 'log', text: 'Hallucinatory gas rolls out.', tone: 'fear' },
          {
            kind: 'reactionRoll',
            difficulty: 17,
            trait: 'instinct',
            targets: { kind: 'allies', range: 'far' },
            onFail: [
              { kind: 'loseHope', amount: 2, target: { kind: 'hit' } },
              { kind: 'damage', dice: '3d8+3', type: 'magic', direct: true, target: { kind: 'hit' } },
            ],
          },
        ],
      },
    ],
  },
  // ---- the turn handed to the other side ---------------------------------
  // "Spend 2 Fear to spotlight up to five allies within Far range." A Leader
  // buying its own side a turn is the GM's half of the action economy, and the
  // Fear it costs pays for every spotlight it hands out: the ones called act
  // now, at the head of the queue, and the GM is not billed twice.
  //
  // Two simplifications run through the lot. "Attacks they make while
  // spotlighted in this way deal half damage" reads on the standard attack
  // they swing, not on a feature they play - a feature's attack is rolled by
  // the script runner, which knows nothing about whose turn it is. And a
  // feature that spotlights "the Guard and up to 2d4 allies" leaves the one
  // acting out: it is already in the spotlight, which is how it came to be
  // using this at all.
  {
    id: 'head-guard-rally-guards',
    name: 'Rally Guards',
    source: from('head-guard'),
    text: 'Spend 2 Fear to spotlight the Head Guard and up to 2d4 allies within Far range.',
    cost: { fear: 2 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '2d4' }],
  },
  {
    id: 'jagged-knife-lieutenant-tactician',
    name: 'Tactician',
    source: from('jagged-knife-lieutenant'),
    text: 'When you spotlight the Lieutenant, mark a Stress to also spotlight two allies within Close range.',
    kind: 'reaction',
    trigger: 'spotlighted',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'close' }, count: '2' }],
  },
  {
    id: 'spellblade-move-as-a-unit',
    name: 'Move as a Unit',
    source: from('spellblade'),
    text: 'Spend 2 Fear to spotlight up to five allies within Far range.',
    cost: { fear: 2 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '5' }],
  },
  {
    id: 'young-dryad-voice-of-the-forest',
    name: 'Voice of the Forest',
    source: from('young-dryad'),
    text: 'Mark a Stress to spotlight 1d4 allies within range of a target they can attack without moving. On a success, their attacks deal half damage.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: "within range of a target they can attack without moving" is
    // a reach the selector cannot ask about; the nearest allies within Far are
    // called instead, and the ones that cannot reach anybody simply swing at
    // nothing.
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1d4', halfDamage: true }],
  },
  {
    id: 'knight-of-the-realm-for-the-realm',
    name: 'For the Realm!',
    source: from('knight-of-the-realm'),
    text: 'Mark a Stress to spotlight 1d4+1 allies. Attacks they make while spotlighted in this way deal half damage.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1d4+1', halfDamage: true }],
  },
  {
    id: 'mortal-hunter-inevitable-death',
    name: 'Inevitable Death',
    source: from('mortal-hunter'),
    text: 'Mark a Stress to spotlight 1d4 allies. Attacks they make while spotlighted in this way deal half damage.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1d4', halfDamage: true }],
  },
  {
    id: 'secret-keeper-seize-your-moment',
    name: 'Seize Your Moment',
    source: from('secret-keeper'),
    text: 'Spend 2 Fear to spotlight 1d4 allies. Attacks they make while spotlighted in this way deal half damage.',
    cost: { fear: 2 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1d4', halfDamage: true }],
  },
  {
    id: 'demon-of-hubris-the-root-of-villainy',
    name: 'The Root of Villainy',
    source: from('demon-of-hubris'),
    text: 'Spend a Fear to spotlight two other Demons within Far range.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: "other Demons" - nothing selects a family of stat blocks, so
    // the two nearest allies answer. `sameKind` would be too narrow: a Demon of
    // Hubris rallies Demons of Avarice, not copies of itself.
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '2' }],
  },
  {
    id: 'demon-of-avarice-money-is-time',
    name: 'Money Is Time',
    source: from('demon-of-avarice'),
    text: 'Spend 3 handfuls of gold (or a Fear) to spotlight 1d4+1 allies.',
    cost: { fear: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: the GM's purse is not a pool the engine keeps, so it pays the
    // Fear the text offers as the alternative.
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1d4+1' }],
  },
  {
    id: 'arch-necromancer-dance-of-death',
    name: 'Dance of Death',
    source: from('arch-necromancer'),
    text: 'Mark a Stress to spotlight 1d4 allies. Attacks they make while spotlighted in this way deal half damage, or full damage if you spend a Fear.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: the Fear that would buy full damage is a choice made after
    // the allies are named, which nothing here asks; it takes the half.
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1d4', halfDamage: true }],
  },
  {
    id: 'high-seraph-we-are-one',
    name: 'We Are One',
    source: from('high-seraph'),
    text: 'Once per scene, spend a Fear to spotlight all other adversaries within Far range. Attacks they make while spotlighted in this way deal half damage.',
    cost: { fear: 1 },
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // No count: all of them, which is what the text says.
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, halfDamage: true }],
  },
  {
    id: 'giant-beastmaster-two-as-one',
    name: 'Two as One',
    source: from('giant-beastmaster'),
    text: 'When the Beastmaster is spotlighted, you can also spotlight a Tier 1 animal adversary currently under their control.',
    kind: 'reaction',
    trigger: 'spotlighted',
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    // Simplified: nothing records which creature a Beastmaster brought, so the
    // nearest ally within Close answers - which, on the turn after Deadly
    // Companion, is the animal it summoned.
    effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'close' }, count: '1' }],
  },
  // ---- clocks a fight carries -------------------------------------------
  // "Activate the countdown. It ticks down when a PC makes an attack roll.
  // When it triggers, ..." Five of the fourteen printed countdowns: the ones
  // whose trigger and whose payoff the vocabulary can both say. The rest stay
  // text - a countdown that moves a creature in a straight line through
  // everyone, one that lays a circle on the ground, one that runs on the
  // number of Hit Points somebody else marked.
  //
  // "In the spotlight for the first time" is a `spotlighted` reaction with one
  // use: the turn arriving is the trigger, and the card running out is the
  // "first time". Arming a clock is a reaction, so the creature still swings.
  {
    id: 'secret-keeper-summoning-ritual',
    name: 'Summoning Ritual',
    source: from('secret-keeper'),
    text: 'When the Secret-Keeper is in the spotlight for the first time, activate the countdown. When they mark HP, tick down this countdown by the number of HP marked. When it triggers, summon a Minor Demon who appears at Close range.',
    kind: 'reaction',
    trigger: 'spotlighted',
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'secret-keeper-summoning-ritual',
        name: 'Summoning Ritual',
        start: '6',
        advance: 'hpMarked',
        effects: [{ kind: 'summon', adversary: 'minor-demon', range: 'close' }],
      },
    ],
  },
  {
    id: 'fallen-sorcerer-shackles-of-guilt',
    name: 'Shackles of Guilt',
    source: from('fallen-sorcerer'),
    text: 'When the Sorcerer is in the spotlight for the first time, activate the countdown. When it triggers, all targets within Far range become Vulnerable and must mark a Stress as they relive their greatest regrets. A target can break free from their regret with a successful Presence or Strength Roll. When a PC fails to break free, they lose a Hope.',
    kind: 'reaction',
    trigger: 'spotlighted',
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'fallen-sorcerer-shackles-of-guilt',
        name: 'Shackles of Guilt',
        start: '2d6',
        loop: 'reset',
        effects: [
          { kind: 'log', text: 'Old regrets close around them.', tone: 'fear' },
          // Simplified: the roll to break free is a move the party makes on
          // their own turn, which nothing here can ask for, so the Vulnerable
          // runs to the end of the scene and the Hope for failing to shake it
          // is not taken.
          { kind: 'applyCondition', condition: 'vulnerable', duration: 'scene', target: { kind: 'allies', range: 'far' } },
          { kind: 'markStress', target: { kind: 'allies', range: 'far' } },
        ],
      },
    ],
  },
  {
    id: 'demon-of-wrath-blood-and-souls',
    name: 'Blood and Souls',
    source: from('demon-of-wrath'),
    text: 'Activate the first time an attack is made within sight of the Demon. It ticks down when a PC takes a violent action. When it triggers, summon 1d4 Minor Demons, who appear at Close range.',
    kind: 'reaction',
    trigger: 'spotlighted',
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'demon-of-wrath-blood-and-souls',
        name: 'Blood and Souls',
        start: '6',
        // "When a PC takes a violent action": an attack roll, which is the
        // only violence the engine can recognise.
        advance: 'attackRoll',
        loop: 'reset',
        // Simplified: it arms on the Demon's first spotlight rather than on
        // the first attack made in its sight, which is not a trigger anything
        // here raises. In a fight the Demon is in, the two are a turn apart.
        effects: [{ kind: 'summon', adversary: 'minor-demon', count: '1d4', range: 'close' }],
      },
    ],
  },
  {
    id: 'fallen-warlord-realm-breaker-all-consuming-rage',
    name: 'All-Consuming Rage',
    source: from('fallen-warlord-realm-breaker'),
    text: 'When the Realm-Breaker is in the spotlight for the first time, activate the countdown. When it triggers, create a torrent of incarnate rage that rends flesh from bone. All targets within Far range must make a Presence Reaction Roll. Targets who fail take 2d6+10 direct magic damage. Targets who succeed take half damage. For each HP marked from this damage, summon a Fallen Shock Troop within Very Close range of the target who marked that HP. If the countdown ever decreases its maximum value to 0, the Realm-Breaker marks their remaining HP and all targets within Far range must mark all remaining HP and make a death move.',
    kind: 'reaction',
    trigger: 'spotlighted',
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'fallen-warlord-realm-breaker-all-consuming-rage',
        name: 'All-Consuming Rage',
        start: '8',
        loop: 'decreasing',
        effects: [
          { kind: 'log', text: 'Rage takes shape and tears at everything standing.', tone: 'fear' },
          {
            kind: 'reactionRoll',
            difficulty: 20,
            trait: 'presence',
            targets: { kind: 'allies', range: 'far' },
            damage: { dice: '2d6+10', type: 'magic' },
            onFail: [{ kind: 'damage', dice: 'same', direct: true }],
            onSuccess: [{ kind: 'damage', dice: 'same', direct: true, half: true }],
          },
          // Simplified: "for each HP marked from this damage, summon a Fallen
          // Shock Troop within Very Close range of the target who marked that
          // HP" is a count nothing here holds, and the last sentence - what
          // running the maximum down to 0 does - is a second feature the clock
          // does not fire. Both are left to the table.
        ],
      },
    ],
  },
  {
    id: 'volcanic-dragon-ashen-tyrant-apocalyptic-thrashing',
    name: 'Apocalyptic Thrashing',
    source: from('volcanic-dragon-ashen-tyrant'),
    text: 'Spend a Fear to activate. It ticks down when a PC rolls with Fear. When it triggers, the Ashen Tyrant thrashes about, causing environmental damage (such as an earthquake, avalanche, or collapsing walls). All targets within Far range must make a Strength Reaction Roll. Targets who fail take 2d10+10 physical damage and are Restrained by the rubble until they break free with a successful Strength Roll. Targets who succeed take half damage. If the Ashen Tyrant is defeated while this countdown is active, trigger the countdown immediately as the destruction caused by their death throes.',
    cost: { fear: 1 },
    uses: { count: 1, per: 'scene' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'countdown',
        countdown: 'volcanic-dragon-ashen-tyrant-apocalyptic-thrashing',
        name: 'Apocalyptic Thrashing',
        start: '1d12',
        advance: 'withFear',
        // "If the Ashen Tyrant is defeated while this countdown is active,
        // trigger the countdown immediately": the one countdown printed that
        // outlives the creature counting it.
        onDeath: 'trigger',
        effects: [
          { kind: 'log', text: 'The mountain comes down around them.', tone: 'fear' },
          {
            kind: 'reactionRoll',
            difficulty: 18,
            trait: 'strength',
            targets: { kind: 'allies', range: 'far' },
            damage: { dice: '2d10+10', type: 'physical' },
            // Simplified: Restrained runs to the end of the scene - the roll
            // to break free is the party's own move, which nothing here asks
            // for.
            onFail: [
              { kind: 'damage', dice: 'same' },
              { kind: 'applyCondition', condition: 'restrained', duration: 'scene', target: { kind: 'hit' } },
            ],
            onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
          },
        ],
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
