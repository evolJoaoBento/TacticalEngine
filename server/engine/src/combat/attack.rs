//! Resolving an attack (`src/engine/combat/attack.ts`): targeting, the roll - Duality Dice for a PC, the
//! GM's Die for an adversary - damage scaled by Proficiency and doubled after the dice settle, the
//! defender's reduction, and the Hit Points it marks; then paying it all onto the scene. The dice come off
//! the stream in the TypeScript's order, so a seed replays the attack exactly.

use crate::combat::targeting::{evaluate_target, Standings, TargetingOptions, TargetingRefusal, TargetingReport};
use crate::rng::{RangeError, Rng};
use crate::js;
use crate::rules::damage::{resolve_damage, roll_damage, roll_reduction, CriticalRule, DamageDefenses, DamageRollOptions, DamageRollResult, DamageThresholds, IncomingDamage, ResolveDamageOptions, ResolvedDamage};
use crate::rules::dice::{roll_dice, DiceExpression, ParsedDamage};
use crate::rules::duality::{roll_duality, DualityRoll, DualityRollOptions};
use crate::rules::gm_die::{roll_gm_die, GmRoll, GmRollOptions};
use crate::rules::jump::Trait;
use crate::rules::range::RangeBand;
use crate::rules::resources::{mark, mark_hit_points, unmarked};
use crate::scene::state::{EntityState, SceneState};
use serde::{Deserialize, Serialize};

/// How the attacker rolls: a PC uses Duality Dice, an adversary the GM's Die.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttackerKind {
    Pc,
    Adversary,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackProfile {
    pub kind: AttackerKind,
    pub name: String,
    /// The attack modifier: a trait's value for a PC, a stat block's bonus - dice allowed.
    pub modifier: DiceExpression,
    /// Maximum range. Anything closer can be attacked too.
    pub range: RangeBand,
    pub damage: ParsedDamage,
    /// Multiplies a PC's weapon dice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proficiency: Option<f64>,
    /// Damage that cannot be reduced by marking Armor Slots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direct: Option<bool>,
    /// The trait rolled, for what reads it.
    #[serde(default, rename = "trait", skip_serializing_if = "Option::is_none")]
    pub trait_: Option<Trait>,
    /// "Double damage": the total, twice, once the dice have settled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub double: Option<bool>,
}

/// How a creature is attacked: the Difficulty to beat, its thresholds, and what it shrugs off.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DefenderProfile {
    pub difficulty: f64,
    pub thresholds: DamageThresholds,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defenses: Option<DamageDefenses>,
}

/// An attack that cannot miss: "automatically succeeds with a critical".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Automatic {
    CriticalSuccess,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackOptions {
    #[serde(flatten)]
    pub targeting: TargetingOptions,
    /// Extra advantage sources on top of those the conditions imply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub advantage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disadvantage: Option<f64>,
    /// Help an Ally dice. PC attacks only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help_dice: Option<f64>,
    /// The attacker's Light Die, when a card has made it something other than a d12.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub good_die_sides: Option<u32>,
    /// Flat modifier on top of the profile's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bonus: Option<f64>,
    /// Armor Slots the defender marks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub armor_slots_marked: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage_bonus: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub critical_rule: Option<CriticalRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub massive_damage: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub automatic: Option<Automatic>,
    /// A roll already made - a reroll kept, a roll shared by several targets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roll: Option<DualityRoll>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackOutcome {
    pub attacker_id: String,
    pub target_id: String,
    pub profile: AttackProfile,
    pub targeting: TargetingReport,
    /// Set when the attack could not be attempted at all; nothing was rolled.
    pub refused: Option<TargetingRefusal>,
    /// The rolled attack modifier, after any dice in it.
    pub modifier: f64,
    pub advantage: f64,
    pub disadvantage: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duality_roll: Option<DualityRoll>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gm_roll: Option<GmRoll>,
    pub hit: bool,
    pub critical: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub damage_roll: Option<DamageRollResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub damage: Option<ResolvedDamage>,
    /// Hit Points the target marks.
    pub hit_points_marked: f64,
    /// Light the attacker gains and Shadow the GM gains, from a PC's roll.
    pub good_gained: f64,
    pub bad_gained: f64,
    pub stress_cleared: f64,
    /// Whether the spotlight should pass to the GM after this.
    pub spotlight_to_gm: bool,
}

/// The advantage a target's conditions give an attacker, and the disadvantage: Vulnerable (or Prone, which
/// is Vulnerable while down) one advantage, not two; Hidden one disadvantage.
pub fn condition_modifiers(target: &EntityState) -> (f64, f64) {
    let advantage = if target.has_condition("vulnerable") || target.has_condition("prone") { 1.0 } else { 0.0 };
    let disadvantage = if target.has_condition("hidden") { 1.0 } else { 0.0 };
    (advantage, disadvantage)
}

pub struct AttackRequest<'a> {
    pub grid: &'a crate::grid::tile_grid::TileGrid,
    pub attacker: &'a EntityState,
    pub target: &'a EntityState,
    pub profile: &'a AttackProfile,
    pub defender: &'a DefenderProfile,
    pub options: &'a AttackOptions,
}

/// Make an attack: refused with nothing rolled, missed, or a hit with its damage resolved.
pub fn resolve_attack(rng: &mut Rng, request: &AttackRequest) -> Result<AttackOutcome, RangeError> {
    let AttackRequest { grid, attacker, target, profile, defender, options } = *request;

    // Measured between where they stand, for bodies whose spot and tile agree; else between tiles.
    let stands = |e: &EntityState| grid.tile_at_spot(e.at.x, e.at.y) == e.tile;
    let stood = (stands(attacker) && stands(target)).then_some(Standings { attacker: attacker.at, target: target.at });
    let targeting_options = TargetingOptions { at: options.targeting.at.or(stood), ..options.targeting };
    let targeting = evaluate_target(grid, attacker.tile, target.tile, profile.range, &targeting_options);

    let base = AttackOutcome {
        attacker_id: attacker.id.clone(),
        target_id: target.id.clone(),
        profile: profile.clone(),
        targeting,
        refused: targeting.refusal,
        modifier: 0.0,
        advantage: 0.0,
        disadvantage: 0.0,
        duality_roll: None,
        gm_roll: None,
        hit: false,
        critical: false,
        damage_roll: None,
        damage: None,
        hit_points_marked: 0.0,
        good_gained: 0.0,
        bad_gained: 0.0,
        stress_cleared: 0.0,
        spotlight_to_gm: false,
    };
    if targeting.refusal.is_some() {
        return Ok(base);
    }

    let (from_conditions, against_conditions) = condition_modifiers(target);
    let advantage = from_conditions + options.advantage.unwrap_or(0.0);
    let disadvantage = against_conditions + f64::from(targeting.cover_disadvantage) + options.disadvantage.unwrap_or(0.0);
    let modifier = roll_dice(rng, &profile.modifier)?.total + options.bonus.unwrap_or(0.0);
    // Cover costs a disadvantage die; it never touches the Difficulty.
    let difficulty = defender.difficulty;

    let mut outcome = AttackOutcome { refused: None, modifier, advantage, disadvantage, ..base };
    if options.automatic == Some(Automatic::CriticalSuccess) {
        outcome.hit = true;
        outcome.critical = true;
    } else if profile.kind == AttackerKind::Pc {
        let roll = match &options.roll {
            Some(roll) => roll.clone(),
            None => roll_duality(
                rng,
                &DualityRollOptions {
                    difficulty,
                    modifier: Some(modifier),
                    good_die_sides: options.good_die_sides,
                    advantage: Some(advantage),
                    disadvantage: Some(disadvantage),
                    help_dice: Some(options.help_dice.unwrap_or(0.0)),
                    reaction: None,
                },
            )?,
        };
        outcome.hit = roll.success;
        outcome.critical = roll.critical;
        outcome.good_gained = f64::from(roll.good_gained);
        outcome.bad_gained = f64::from(roll.bad_gained);
        outcome.stress_cleared = f64::from(roll.stress_cleared);
        outcome.spotlight_to_gm = roll.spotlight_to_gm;
        outcome.duality_roll = Some(roll);
    } else {
        let roll = roll_gm_die(rng, &GmRollOptions { difficulty, modifier: Some(modifier), advantage: Some(advantage), disadvantage: Some(disadvantage), reaction: None })?;
        outcome.hit = roll.success;
        outcome.critical = roll.critical;
        outcome.gm_roll = Some(roll);
    }
    if !outcome.hit {
        return Ok(outcome);
    }

    let rolled = roll_damage(
        rng,
        &profile.damage.expression,
        &DamageRollOptions {
            // Only a PC's weapon damage scales with Proficiency.
            proficiency: if profile.kind == AttackerKind::Pc { profile.proficiency.unwrap_or(1.0) } else { 1.0 },
            critical: outcome.critical,
            critical_rule: options.critical_rule.unwrap_or(CriticalRule::MaxDicePlusRoll),
            bonus: options.damage_bonus.unwrap_or(0.0),
        },
    )?;
    let damage_roll = if profile.double == Some(true) { DamageRollResult { total: rolled.total * 2.0, ..rolled } } else { rolled };

    // A PC's swing at an adversary is resolved here and nowhere else, so the reduction is rolled here.
    let types = profile.damage.types.clone().unwrap_or_default();
    let defenses = defender.defenses.clone().unwrap_or_default();
    let rolled_reduction = roll_reduction(rng, &types, &defenses)?;
    let damage = resolve_damage(
        &IncomingDamage { amount: damage_roll.total, types, direct: profile.direct.unwrap_or(false), severity: None },
        &defender.thresholds,
        &ResolveDamageOptions {
            massive_damage: options.massive_damage.unwrap_or(false),
            armor_slots_marked: Some(options.armor_slots_marked.unwrap_or(0.0)),
            armor_slots_available: Some(unmarked(&target.armor_slots)),
            defenses,
            rolled_reduction: (rolled_reduction != 0.0).then_some(rolled_reduction),
        },
    );
    outcome.hit_points_marked = damage.hp_marked;
    outcome.damage_roll = Some(damage_roll);
    outcome.damage = Some(damage);
    Ok(outcome)
}

/// What landing an attack did, after the pools' limits.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedAttack {
    pub hit_points_marked: f64,
    pub armor_slots_spent: f64,
    /// The target marked its last Hit Point and must make a death move.
    pub fell: bool,
    pub good_gained: f64,
    pub bad_gained: f64,
    pub stress_cleared: f64,
}

/// What the roll pays out on its own.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedRoll {
    pub good_gained: f64,
    pub bad_gained: f64,
    pub stress_cleared: f64,
}

/// Pay out what the roll itself earned: the attacker's Light and cleared Stress, the GM's Shadow.
pub fn apply_roll(state: &mut SceneState, outcome: &AttackOutcome) -> AppliedRoll {
    let mut applied = AppliedRoll::default();
    if let Some(attacker) = state.entity_mut(&outcome.attacker_id) {
        if outcome.good_gained > 0.0 {
            if let Some(good) = &mut attacker.good {
                let before = good.value;
                good.value = js::min(good.max, before + outcome.good_gained);
                applied.good_gained = good.value - before;
            }
        }
        if outcome.stress_cleared > 0.0 {
            let cleared = js::min(outcome.stress_cleared, attacker.stress.marked);
            attacker.stress.marked -= cleared;
            applied.stress_cleared = cleared;
        }
    }
    if outcome.bad_gained > 0.0 {
        let before = state.bad.value;
        state.bad.value = js::min(state.bad.max, before + outcome.bad_gained);
        applied.bad_gained = state.bad.value - before;
    }
    applied
}

/// Land an attack on the scene: the roll's pay-out (unless `roll` is false, it having been paid already),
/// then the Armor Slots and Hit Points the target marks.
pub fn apply_attack(state: &mut SceneState, outcome: &AttackOutcome, roll: bool) -> AppliedAttack {
    let paid = if roll { apply_roll(state, outcome) } else { AppliedRoll::default() };
    let mut applied = AppliedAttack { good_gained: paid.good_gained, bad_gained: paid.bad_gained, stress_cleared: paid.stress_cleared, ..AppliedAttack::default() };
    let (Some(target), Some(damage)) = (state.entity_mut(&outcome.target_id), outcome.damage) else { return applied };
    if damage.armor_slots_spent > 0.0 {
        let spent = mark(&target.armor_slots, damage.armor_slots_spent);
        target.armor_slots = spent.pool;
        applied.armor_slots_spent = spent.applied;
    }
    let marked = mark_hit_points(&target.hit_points, outcome.hit_points_marked);
    target.hit_points = marked.hit_points;
    applied.hit_points_marked = marked.hp_marked;
    applied.fell = marked.fell;
    if marked.fell {
        target.alive = false;
    }
    applied
}
