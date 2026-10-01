//! A stat block as a fight reads it (`AdversaryDef` in `src/engine/content/types.ts`): its name, the
//! Difficulty and thresholds it is attacked against, the pools it stands up with, the swing it prints, and
//! the features the fight obeys by name. Tier, role and text are the bestiary's, and wait for its port.

use crate::rules::damage::DamageThresholds;
use crate::rules::dice::{DiceExpression, ParsedDamage};
use crate::rules::range::RangeBand;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdversaryDef {
    pub id: String,
    pub name: String,
    pub difficulty: f64,
    pub thresholds: DamageThresholds,
    pub hit_points: f64,
    pub stress: f64,
    pub attack_name: String,
    /// Almost always flat; one stat block rolls it ("+2d4").
    pub attack_modifier: DiceExpression,
    pub attack_range: RangeBand,
    pub attack_damage: ParsedDamage,
    /// Relentless, Momentum, Terrifying, Horde, Minion and the rest, as printed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub features: Vec<crate::combat::adversary_features::AdversaryFeature>,
}
