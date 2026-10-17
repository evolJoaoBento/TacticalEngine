//! Taking a hit (`src/engine/combat/defense.ts`): the defender's automatic reactions tried in order - dice
//! off the damage, an Armor Slot and then more, the band stepped down - each only where it changes what
//! is marked and only if it can be paid for; or a plan the defender chose; or a preview of one. The dice
//! come off the stream in the TypeScript's order.

use crate::content::abilities::{is_automatic, AbilityDef, AbilityKind, DamageReaction};
use crate::js;
use crate::rng::{RangeError, Rng};
use crate::rules::damage::{hp_for_severity, reduce_severity, reduction_rolls, resolve_damage, roll_reduction, DamageDefenses, DamageThresholds, IncomingDamage, ResolveDamageOptions, ResolvedDamage};
use crate::rules::dice::{parse_dice, roll_dice};
use crate::rules::resources::{can_afford, can_mark_stress, unmarked, Currency, MarkPool};
use serde::{Deserialize, Serialize};

pub struct Defender<'a> {
    pub thresholds: DamageThresholds,
    pub defenses: Option<DamageDefenses>,
    pub armor_slots: MarkPool,
    pub stress: MarkPool,
    pub good: Option<Currency>,
    /// Reactions to incoming damage the defender holds, in the order to try them.
    pub reactions: Vec<&'a AbilityDef>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArmorPolicy {
    Auto,
    Never,
    Ask,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DefensePolicy {
    /// Mark an Armor Slot when it helps, never, or ask.
    pub armor: ArmorPolicy,
    /// Use reactions marked `auto`.
    pub reactions: bool,
}

pub const DEFAULT_DEFENSE: DefensePolicy = DefensePolicy { armor: ArmorPolicy::Auto, reactions: true };

/// A defence the defender chose, rather than one the policy decided.
pub struct DefensePlan<'a> {
    /// Armor Slots to mark, before any a reaction adds.
    pub armor_slots: f64,
    /// Reactions to use, in the order they are written.
    pub reactions: Vec<&'a AbilityDef>,
}

/// One reaction that fired, and what it cost.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactionUsed<'a> {
    pub ability: &'a AbilityDef,
    pub good_spent: f64,
    pub stress_marked: f64,
    /// The dice a `reduceDamage` reaction rolled, if any.
    pub rolled: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Defense<'a> {
    pub resolved: ResolvedDamage,
    /// Armor Slots to mark, the one plus any a reaction added.
    pub armor_slots_marked: f64,
    pub reactions: Vec<ReactionUsed<'a>>,
    pub good_spent: f64,
    pub stress_marked: f64,
}

fn used<'a>(ability: &'a AbilityDef, rolled: Option<f64>) -> ReactionUsed<'a> {
    ReactionUsed { ability, good_spent: ability.cost.good.unwrap_or(0.0), stress_marked: ability.cost.stress.unwrap_or(0.0), rolled }
}

fn options(defender: &Defender, armor: f64, available: f64, rolled_reduction: f64) -> ResolveDamageOptions {
    ResolveDamageOptions {
        massive_damage: false,
        armor_slots_marked: Some(armor),
        armor_slots_available: Some(available),
        defenses: defender.defenses.clone().unwrap_or_default(),
        rolled_reduction: (rolled_reduction != 0.0).then_some(rolled_reduction),
    }
}

fn stepped(resolved: ResolvedDamage, steps: f64) -> ResolvedDamage {
    let final_severity = reduce_severity(resolved.final_severity, steps);
    ResolvedDamage { final_severity, hp_marked: hp_for_severity(final_severity), ..resolved }
}

/// Defend by policy: every automatic reaction that helps and can be paid for, and an Armor Slot when it
/// lowers what is marked.
pub fn resolve_defense<'a>(rng: &mut Rng, damage: &IncomingDamage, defender: &Defender<'a>, policy: DefensePolicy) -> Result<Defense<'a>, RangeError> {
    let mut good = defender.good;
    let mut stress_room = unmarked(&defender.stress);
    let mut reactions_used: Vec<ReactionUsed<'a>> = Vec::new();
    let mut good_spent = 0.0;
    let mut stress_marked = 0.0;

    let affordable = |ability: &AbilityDef, good: Option<Currency>, stress_room: f64| -> bool {
        let cost = ability.cost;
        if cost.good.unwrap_or(0.0) > 0.0 && !good.is_some_and(|g| can_afford(&g, cost.good.unwrap_or(0.0))) {
            return false;
        }
        if cost.stress.unwrap_or(0.0) > 0.0 && !can_mark_stress(&MarkPool { max: stress_room, marked: 0.0 }, cost.stress.unwrap_or(0.0)) {
            return false;
        }
        true
    };
    let mut pay = |ability: &'a AbilityDef, rolled: Option<f64>, good: &mut Option<Currency>, stress_room: &mut f64| {
        let cost = ability.cost;
        if cost.good.unwrap_or(0.0) > 0.0 {
            if let Some(g) = good {
                g.value -= cost.good.unwrap_or(0.0);
                good_spent += cost.good.unwrap_or(0.0);
            }
        }
        if cost.stress.unwrap_or(0.0) > 0.0 {
            *stress_room -= cost.stress.unwrap_or(0.0);
            stress_marked += cost.stress.unwrap_or(0.0);
        }
        reactions_used.push(used(ability, rolled));
    };
    let reactions: Vec<&'a AbilityDef> = if policy.reactions {
        defender.reactions.iter().copied().filter(|a| a.kind == AbilityKind::Reaction && a.trigger.as_deref() == Some("incomingDamage") && is_automatic(a)).collect()
    } else {
        Vec::new()
    };
    // A passive reduction costs nothing and is no choice: rolled once, and every sum below made with it.
    let defenses = defender.defenses.clone().unwrap_or_default();
    let rolled_reduction = roll_reduction(rng, &damage.types, &defenses)?;
    let available = unmarked(&defender.armor_slots);
    let hp_for = |amount: f64, armor: f64| resolve_damage(&IncomingDamage { amount, ..damage.clone() }, &defender.thresholds, &options(defender, armor, available, rolled_reduction)).hp_marked;

    // ---- dice off the damage ----
    let mut amount = damage.amount;
    for &ability in &reactions {
        let Some(DamageReaction::ReduceDamage { dice }) = &ability.reaction else { continue };
        if !affordable(ability, good, stress_room) {
            continue;
        }
        let Some(expression) = parse_dice(dice) else { continue };
        // Worth it only if the ward could change the band at all.
        if hp_for(amount, 0.0) == 0.0 {
            break;
        }
        let roll = roll_dice(rng, &expression.expression)?;
        let after = js::max(0.0, amount - roll.total);
        if hp_for(after, 0.0) < hp_for(amount, 0.0) || after == 0.0 {
            amount = after;
            pay(ability, Some(roll.total), &mut good, &mut stress_room);
        }
        // Rolled and it did not help: the dice are spent, the resource is not.
    }

    // ---- Armor Slots ----
    let mut armor = 0.0;
    if policy.armor == ArmorPolicy::Auto && !damage.direct && available > 0.0 && hp_for(amount, 1.0) < hp_for(amount, 0.0) {
        armor = 1.0;
    }
    for &ability in &reactions {
        let Some(DamageReaction::ExtraArmor { slots, only }) = &ability.reaction else { continue };
        if armor == 0.0 || !affordable(ability, good, stress_room) {
            continue;
        }
        if only.is_some_and(|only| !damage.types.contains(&only)) {
            continue;
        }
        let more = js::min(*slots, available - armor);
        if more <= 0.0 || hp_for(amount, armor + more) >= hp_for(amount, armor) {
            continue;
        }
        armor += more;
        pay(ability, None, &mut good, &mut stress_room);
    }

    let mut resolved = resolve_damage(&IncomingDamage { amount, ..damage.clone() }, &defender.thresholds, &options(defender, armor, available, rolled_reduction));

    // ---- the band, stepped down ----
    for &ability in &reactions {
        let Some(DamageReaction::ReduceSeverity { steps, only }) = &ability.reaction else { continue };
        if resolved.hp_marked == 0.0 || !affordable(ability, good, stress_room) {
            continue;
        }
        // "When you take Severe damage" is about the damage taken, before the slot.
        if only.is_some_and(|only| resolved.severity != only) {
            continue;
        }
        resolved = stepped(resolved, *steps);
        pay(ability, None, &mut good, &mut stress_room);
    }

    Ok(Defense { resolved, armor_slots_marked: resolved.armor_slots_spent, reactions: reactions_used, good_spent, stress_marked })
}

/// Defend as the defender chose: every reaction in the plan fires, in its order, with no check that it
/// helps or can be paid for - the plan was made knowing.
pub fn resolve_defense_plan<'a>(rng: &mut Rng, damage: &IncomingDamage, defender: &Defender, plan: &DefensePlan<'a>) -> Result<Defense<'a>, RangeError> {
    let mut reactions_used: Vec<ReactionUsed<'a>> = Vec::new();
    let defenses = defender.defenses.clone().unwrap_or_default();
    let rolled_reduction = roll_reduction(rng, &damage.types, &defenses)?;
    let mut amount = damage.amount;
    for &ability in &plan.reactions {
        let Some(DamageReaction::ReduceDamage { dice }) = &ability.reaction else { continue };
        let Some(expression) = parse_dice(dice) else { continue };
        let roll = roll_dice(rng, &expression.expression)?;
        amount = js::max(0.0, amount - roll.total);
        reactions_used.push(used(ability, Some(roll.total)));
    }
    let available = unmarked(&defender.armor_slots);
    let mut armor = if damage.direct { 0.0 } else { js::min(plan.armor_slots, available) };
    for &ability in &plan.reactions {
        let Some(DamageReaction::ExtraArmor { slots, .. }) = &ability.reaction else { continue };
        armor = js::min(available, armor + slots);
        reactions_used.push(used(ability, None));
    }
    let mut resolved = resolve_damage(&IncomingDamage { amount, ..damage.clone() }, &defender.thresholds, &options(defender, armor, available, rolled_reduction));
    for &ability in &plan.reactions {
        let Some(DamageReaction::ReduceSeverity { steps, .. }) = &ability.reaction else { continue };
        resolved = stepped(resolved, *steps);
        reactions_used.push(used(ability, None));
    }
    let good_spent = reactions_used.iter().fold(0.0, |sum, r| sum + r.good_spent);
    let stress_marked = reactions_used.iter().fold(0.0, |sum, r| sum + r.stress_marked);
    Ok(Defense { resolved, armor_slots_marked: resolved.armor_slots_spent, reactions: reactions_used, good_spent, stress_marked })
}

/// The Hit Points a plan would mark, before anything is rolled - or `None` when dice would decide it.
pub fn preview_plan(damage: &IncomingDamage, defender: &Defender, plan: &DefensePlan) -> Option<f64> {
    if plan.reactions.iter().any(|a| matches!(a.reaction, Some(DamageReaction::ReduceDamage { .. }))) {
        return None;
    }
    let defenses = defender.defenses.clone().unwrap_or_default();
    if reduction_rolls(&defenses) {
        return None;
    }
    let available = unmarked(&defender.armor_slots);
    let mut armor = if damage.direct { 0.0 } else { js::min(plan.armor_slots, available) };
    for ability in &plan.reactions {
        if let Some(DamageReaction::ExtraArmor { slots, .. }) = &ability.reaction {
            armor = js::min(available, armor + slots);
        }
    }
    let mut resolved = resolve_damage(damage, &defender.thresholds, &options(defender, armor, available, 0.0));
    for ability in &plan.reactions {
        if let Some(DamageReaction::ReduceSeverity { steps, .. }) = &ability.reaction {
            resolved = stepped(resolved, *steps);
        }
    }
    Some(resolved.hp_marked)
}

/// Whether the defender can pay for this reaction right now.
pub fn can_pay_for(good: Option<&Currency>, stress: &MarkPool, ability: &AbilityDef) -> bool {
    let cost = ability.cost;
    if cost.good.unwrap_or(0.0) > 0.0 && !good.is_some_and(|g| can_afford(g, cost.good.unwrap_or(0.0))) {
        return false;
    }
    if cost.stress.unwrap_or(0.0) > 0.0 && !can_mark_stress(stress, cost.stress.unwrap_or(0.0)) {
        return false;
    }
    true
}
