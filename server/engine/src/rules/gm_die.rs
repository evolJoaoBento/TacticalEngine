//! The GM's Die (`src/engine/rules/gm-die.ts`): "The GM has no Duality Dice; instead, they roll a single
//! d20." No Light, no Shadow, no matched pair: a natural 20 succeeds whatever the modifiers, and is a
//! critical unless it is a reaction roll. The d20 first, then any advantage die.

use crate::rng::{RangeError, Rng};
use crate::rules::duality::{net_advantage, ADVANTAGE_DIE_SIDES};

pub const GM_DIE_SIDES: u32 = 20;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GmRollOptions {
    pub difficulty: f64,
    pub modifier: Option<f64>,
    pub advantage: Option<f64>,
    pub disadvantage: Option<f64>,
    pub reaction: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GmRoll {
    pub die: u32,
    pub advantage_die: f64,
    pub modifier: f64,
    pub total: f64,
    pub difficulty: f64,
    pub success: bool,
    pub critical: bool,
    pub reaction: bool,
}

pub fn roll_gm_die(rng: &mut Rng, options: &GmRollOptions) -> Result<GmRoll, RangeError> {
    let modifier = options.modifier.unwrap_or(0.0);
    let reaction = options.reaction.unwrap_or(false);
    let die = rng.die(GM_DIE_SIDES)?;
    let direction = net_advantage(options.advantage.unwrap_or(0.0), options.disadvantage.unwrap_or(0.0));
    let advantage_die = if direction == 0 { 0.0 } else { f64::from(direction) * f64::from(rng.die(ADVANTAGE_DIE_SIDES)?) };
    let total = f64::from(die) + advantage_die + modifier;
    let natural_20 = die == GM_DIE_SIDES;
    Ok(GmRoll { die, advantage_die, modifier, total, difficulty: options.difficulty, success: natural_20 || total >= options.difficulty, critical: natural_20 && !reaction, reaction })
}
