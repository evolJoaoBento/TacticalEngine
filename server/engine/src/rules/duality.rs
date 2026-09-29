//! The Duality Dice (`src/engine/rules/duality.ts`): action and reaction rolls, advantage, Help an Ally,
//! Group Action Rolls. Pure: a roll reports the Light and Shadow it produces and never applies them. The
//! dice come off the stream in a fixed order - Light, Shadow, the advantage die, the Help dice - and only
//! the dice the rules call for, so a seed replays the roll exactly.

use crate::js;
use crate::rng::{RangeError, Rng};
use crate::rules::dice::roll_many;

pub const GOOD_DIE_SIDES: u32 = 12;
pub const BAD_DIE_SIDES: u32 = 12;
pub const ADVANTAGE_DIE_SIDES: u32 = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RollOutcome {
    CriticalSuccess,
    SuccessWithGood,
    SuccessWithBad,
    FailureWithGood,
    FailureWithBad,
}

impl RollOutcome {
    pub fn name(self) -> &'static str {
        match self {
            RollOutcome::CriticalSuccess => "criticalSuccess",
            RollOutcome::SuccessWithGood => "successWithGood",
            RollOutcome::SuccessWithBad => "successWithBad",
            RollOutcome::FailureWithGood => "failureWithGood",
            RollOutcome::FailureWithBad => "failureWithBad",
        }
    }

    pub fn parse(text: &str) -> Option<RollOutcome> {
        [RollOutcome::CriticalSuccess, RollOutcome::SuccessWithGood, RollOutcome::SuccessWithBad, RollOutcome::FailureWithGood, RollOutcome::FailureWithBad]
            .into_iter()
            .find(|outcome| outcome.name() == text)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DualityRollOptions {
    /// The Difficulty to beat: `total >= difficulty` succeeds.
    pub difficulty: f64,
    pub modifier: Option<f64>,
    /// The Light Die's faces, when a card changes them; twelve otherwise.
    pub good_die_sides: Option<u32>,
    pub advantage: Option<f64>,
    pub disadvantage: Option<f64>,
    /// Allies' Help an Ally d6s; the highest is added. None on a reaction roll.
    pub help_dice: Option<f64>,
    pub reaction: Option<bool>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DualityRoll {
    pub good: u32,
    pub bad: u32,
    /// The Light Die's faces, only when they were not twelve.
    pub good_sides: Option<u32>,
    /// +d6, -d6, or 0 when advantage and disadvantage cancel.
    pub advantage_die: f64,
    pub help_dice: Vec<u32>,
    pub help_bonus: f64,
    pub modifier: f64,
    pub total: f64,
    pub difficulty: f64,
    pub outcome: RollOutcome,
    pub success: bool,
    pub critical: bool,
    pub with_good: bool,
    pub with_bad: bool,
    pub reaction: bool,
    pub good_gained: u32,
    pub bad_gained: u32,
    pub stress_cleared: u32,
    pub spotlight_to_gm: bool,
}

/// Advantage and disadvantage cancel one for one, and what is left is a single d6 either way.
pub fn net_advantage(advantage: f64, disadvantage: f64) -> i32 {
    let net = advantage - disadvantage;
    if net > 0.0 {
        1
    } else if net < 0.0 {
        -1
    } else {
        0
    }
}

/// A Group Action Roll: +1 for each helper's reaction that succeeded, -1 for each that failed.
pub fn group_action_modifier(successes: &[bool]) -> i32 {
    successes.iter().map(|&success| if success { 1 } else { -1 }).sum()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Classified {
    pub outcome: RollOutcome,
    pub success: bool,
    pub critical: bool,
    pub with_good: bool,
}

/// Read a resolved pair: a match is a critical, which succeeds and counts as a roll with Light.
pub fn classify_roll(good: f64, bad: f64, total: f64, difficulty: f64) -> Classified {
    let critical = good == bad;
    let success = critical || total >= difficulty;
    let with_good = critical || good > bad;
    let outcome = match (critical, success, with_good) {
        (true, _, _) => RollOutcome::CriticalSuccess,
        (false, true, true) => RollOutcome::SuccessWithGood,
        (false, true, false) => RollOutcome::SuccessWithBad,
        (false, false, true) => RollOutcome::FailureWithGood,
        (false, false, false) => RollOutcome::FailureWithBad,
    };
    Classified { outcome, success, critical, with_good }
}

fn finish(roll: &mut DualityRoll) {
    let read = classify_roll(f64::from(roll.good), f64::from(roll.bad), roll.total, roll.difficulty);
    let reaction = roll.reaction;
    roll.outcome = read.outcome;
    roll.success = read.success;
    roll.critical = read.critical;
    roll.with_good = read.with_good;
    roll.with_bad = !read.with_good;
    roll.good_gained = u32::from(!reaction && read.with_good);
    roll.bad_gained = u32::from(!reaction && !read.with_good);
    roll.stress_cleared = u32::from(!reaction && read.critical);
    roll.spotlight_to_gm = !reaction && !(read.success && read.with_good);
}

/// The same roll with one or both Duality Dice showing something else - a card's reroll - read again
/// from the top; the advantage die, the Help dice, the modifier and the Difficulty stand.
pub fn with_faces(roll: &DualityRoll, good: Option<u32>, bad: Option<u32>) -> DualityRoll {
    let mut next = roll.clone();
    next.good = good.unwrap_or(roll.good);
    next.bad = bad.unwrap_or(roll.bad);
    next.total = f64::from(next.good) + f64::from(next.bad) + roll.advantage_die + roll.help_bonus + roll.modifier;
    finish(&mut next);
    next
}

/// Roll the Duality Dice.
pub fn roll_duality(rng: &mut Rng, options: &DualityRollOptions) -> Result<DualityRoll, RangeError> {
    let modifier = options.modifier.unwrap_or(0.0);
    let reaction = options.reaction.unwrap_or(false);
    let good_sides = options.good_die_sides.unwrap_or(GOOD_DIE_SIDES);
    let good = rng.die(good_sides)?;
    let bad = rng.die(BAD_DIE_SIDES)?;
    let direction = net_advantage(options.advantage.unwrap_or(0.0), options.disadvantage.unwrap_or(0.0));
    let advantage_die = if direction == 0 { 0.0 } else { f64::from(direction) * f64::from(rng.die(ADVANTAGE_DIE_SIDES)?) };
    let help_count = if reaction { 0.0 } else { js::max(0.0, js::trunc(options.help_dice.unwrap_or(0.0))) };
    let help_dice = roll_many(rng, help_count, f64::from(ADVANTAGE_DIE_SIDES))?;
    let help_bonus = help_dice.iter().max().map_or(0.0, |&best| f64::from(best));
    let mut roll = DualityRoll {
        good,
        bad,
        good_sides: (good_sides != GOOD_DIE_SIDES).then_some(good_sides),
        advantage_die,
        help_dice,
        help_bonus,
        modifier,
        total: f64::from(good) + f64::from(bad) + advantage_die + help_bonus + modifier,
        difficulty: options.difficulty,
        outcome: RollOutcome::FailureWithBad,
        success: false,
        critical: false,
        with_good: false,
        with_bad: true,
        reaction,
        good_gained: 0,
        bad_gained: 0,
        stress_cleared: 0,
        spotlight_to_gm: false,
    };
    finish(&mut roll);
    Ok(roll)
}
