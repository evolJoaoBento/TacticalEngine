//! What a named condition does to its bearer (`src/engine/content/conditions.ts`), as the world reads it:
//! the modifiers and defences it lends, the Light Die it swaps, what it forbids, when it ends, what it owes
//! whoever swings at its bearer, what the ground that carries it does to whoever walks in, a fall it
//! answers in place of a death move, and the Armor Slot it adds to. Conditions and effects are kept as the
//! JSON the script's schema read; `content::schema` reads a definition as zod does.

use crate::content::abilities::AbilityModifier;
use crate::rules::damage::DamageDefenses;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What a condition can stop its bearer doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConditionBlock {
    Act,
    Move,
    Reactions,
    Armor,
}

/// The moment a condition ends of itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EndsWhen {
    Hit,
    Attacks,
    Damaged,
    Rolls,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct GoodDie {
    pub sides: f64,
}

/// What a condition on the one swung at owes the one who swung.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Payout {
    /// Only `attacked`, so far.
    pub on: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keeps: Option<bool>,
    #[serde(default)]
    pub effects: Vec<Value>,
}

/// What the ground carrying a condition does to whoever walks into it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OnEnter {
    #[serde(default)]
    pub effects: Vec<Value>,
}

/// A fall answered in place of a death move: the Hit Points cleared, and what the log says.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InsteadOfDeath {
    pub clears: f64,
    pub says: String,
}

/// Steps an Armor Slot marked while it stands reduces by, and whether saving its bearer spends it.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorAid {
    pub steps: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_when_it_saves: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub modifiers: Vec<AbilityModifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defenses: Option<DamageDefenses>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub good_die: Option<GoodDie>,
    #[serde(default)]
    pub blocks: Vec<ConditionBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_when: Option<EndsWhen>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payout: Option<Payout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_enter: Option<OnEnter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instead_of_death: Option<InsteadOfDeath>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub armor: Option<ArmorAid>,
}
