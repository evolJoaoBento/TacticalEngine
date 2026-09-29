//! Jumping (`src/engine/rules/jump.ts`): a rule a project writes down - how far a jump carries, what it
//! is rolled with and against, how far down is only a drop, what a fall costs. The defaults are the
//! demo's. Reading a project's rules out of its document belongs with the content, when that is ported.

use crate::grid::pathfinding::WALKABLE_RISE;
use crate::js;

/// The six traits.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Trait {
    Agility,
    Strength,
    Finesse,
    Instinct,
    Presence,
    Knowledge,
}

impl Trait {
    /// The six, in the order the sheet lists them.
    pub const ALL: [Trait; 6] = [Trait::Agility, Trait::Strength, Trait::Finesse, Trait::Instinct, Trait::Presence, Trait::Knowledge];

    pub fn name(self) -> &'static str {
        match self {
            Trait::Agility => "agility",
            Trait::Strength => "strength",
            Trait::Finesse => "finesse",
            Trait::Instinct => "instinct",
            Trait::Presence => "presence",
            Trait::Knowledge => "knowledge",
        }
    }

    pub fn from_name(text: &str) -> Option<Trait> {
        [Trait::Agility, Trait::Strength, Trait::Finesse, Trait::Instinct, Trait::Presence, Trait::Knowledge].into_iter().find(|t| t.name() == text)
    }
}

/// A character's six trait scores.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Traits {
    pub agility: f64,
    pub strength: f64,
    pub finesse: f64,
    pub instinct: f64,
    pub presence: f64,
    pub knowledge: f64,
}

impl Traits {
    pub fn of(&self, t: Trait) -> f64 {
        match t {
            Trait::Agility => self.agility,
            Trait::Strength => self.strength,
            Trait::Finesse => self.finesse,
            Trait::Instinct => self.instinct,
            Trait::Presence => self.presence,
            Trait::Knowledge => self.knowledge,
        }
    }

    pub fn of_mut(&mut self, t: Trait) -> &mut f64 {
        match t {
            Trait::Agility => &mut self.agility,
            Trait::Strength => &mut self.strength,
            Trait::Finesse => &mut self.finesse,
            Trait::Instinct => &mut self.instinct,
            Trait::Presence => &mut self.presence,
            Trait::Knowledge => &mut self.knowledge,
        }
    }
}

/// Some traits' changes, `Partial<Record<Trait, number>>`: a trait never touched is absent, not zero.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PartialTraits([Option<f64>; 6]);

impl PartialTraits {
    pub fn get(&self, t: Trait) -> Option<f64> {
        self.0[t as usize]
    }

    /// `changes[t] = (changes[t] ?? 0) + n`.
    pub fn add(&mut self, t: Trait, n: f64) {
        self.0[t as usize] = Some(self.0[t as usize].unwrap_or(0.0) + n);
    }

    pub fn iter(&self) -> impl Iterator<Item = (Trait, f64)> + '_ {
        Trait::ALL.into_iter().filter_map(|t| self.get(t).map(|n| (t, n)))
    }
}

impl serde::Serialize for PartialTraits {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.iter().map(|(t, n)| (t.name(), n)))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct JumpRules {
    pub enabled: bool,
    pub step_height: f64,
    pub reach_trait: Trait,
    pub reach_base: f64,
    pub reach_per_point: f64,
    pub range_base: f64,
    pub range_per_point: f64,
    pub flat_roll: bool,
    pub roll_trait: Trait,
    pub difficulty: f64,
    pub drop_trait: Trait,
    pub drop_base: f64,
    pub drop_per_point: f64,
    pub harder_every: f64,
    pub fall_die: f64,
    pub half_on_success: bool,
    pub fail_condition: String,
}

impl Default for JumpRules {
    /// The rules as a project that says nothing has them.
    fn default() -> Self {
        JumpRules {
            enabled: true,
            step_height: WALKABLE_RISE,
            reach_trait: Trait::Strength,
            reach_base: 1.0,
            reach_per_point: 1.0,
            range_base: 3.0,
            range_per_point: 1.0,
            flat_roll: false,
            roll_trait: Trait::Agility,
            difficulty: 12.0,
            drop_trait: Trait::Agility,
            drop_base: 1.0,
            drop_per_point: 1.0,
            harder_every: 2.0,
            fall_die: 6.0,
            half_on_success: true,
            fail_condition: "prone".into(),
        }
    }
}

/// What a jump asks: the roll's Difficulty (nothing for a drop the legs simply take), and the dice of
/// falling damage waiting at the bottom.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LeapTerms {
    pub difficulty: Option<f64>,
    pub fall_dice: f64,
}

/// How many blocks up a jump carries.
pub fn jump_reach(rules: &JumpRules, traits: &Traits) -> f64 {
    rules.reach_base + js::max(0.0, traits.of(rules.reach_trait)) * rules.reach_per_point
}

/// How many tiles across the ground a jump carries.
pub fn jump_range(rules: &JumpRules, traits: &Traits) -> f64 {
    rules.range_base + js::max(0.0, traits.of(rules.reach_trait)) * rules.range_per_point
}

/// How high a jump arcs over the straight line between its ends, in blocks.
pub fn arc_lift(tiles: f64, rise: f64) -> f64 {
    js::max(0.75, 0.35 * tiles) + 0.5 * rise.abs()
}

/// How high the arc stands `t` of the way along.
pub fn arc_height(from: f64, to: f64, lift: f64, t: f64) -> f64 {
    from + (to - from) * t + 4.0 * lift * t * (1.0 - t)
}

/// How many blocks down is only a drop.
pub fn safe_drop(rules: &JumpRules, traits: &Traits) -> f64 {
    rules.drop_base + js::max(0.0, traits.of(rules.drop_trait)) * rules.drop_per_point
}

/// What a jump of this many blocks asks - up positive, down negative - or nothing when it cannot be made.
pub fn leap_terms(rules: &JumpRules, rise: f64, traits: &Traits) -> Option<LeapTerms> {
    if !rules.enabled {
        return None;
    }
    if rise.abs() <= rules.step_height {
        return Some(LeapTerms { difficulty: rules.flat_roll.then_some(rules.difficulty), fall_dice: 0.0 });
    }
    if rise > 0.0 {
        return (rise <= jump_reach(rules, traits) + 1e-6).then_some(LeapTerms { difficulty: Some(rules.difficulty), fall_dice: 0.0 });
    }
    let past = -rise - safe_drop(rules, traits);
    if past <= 1e-6 {
        return Some(LeapTerms { difficulty: None, fall_dice: 0.0 });
    }
    let harder = if rules.harder_every <= 0.0 { 0.0 } else { (past / rules.harder_every + 1e-6).floor() };
    Some(LeapTerms { difficulty: Some(rules.difficulty + harder), fall_dice: if rules.fall_die == 0.0 { 0.0 } else { (past - 1e-6).ceil() } })
}
