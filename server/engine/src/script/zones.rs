//! Zones (`src/engine/script/zones.ts`): ground a spell holds - everybody inside bears a condition while
//! they are inside - anchored to a tile and reaching a band from it. This is the zone as a scenario carries
//! it and a save holds it; what walking in and out of one does is the world's.

use crate::rules::range::RangeBand;
use crate::zod::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZoneSide {
    Allies,
    Adversaries,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZoneOnDeath {
    End,
    Keep,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ZoneGrowth {
    pub by: f64,
    pub until: f64,
}

/// A zone that is standing.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningZone {
    /// The id the spell gave it: casting it again under this id moves it.
    pub id: String,
    pub name: String,
    /// Who cast it, or nothing for one the scene placed.
    pub owner: Option<String>,
    /// What everybody inside bears while they are inside.
    pub condition: String,
    /// The tile it is anchored to.
    pub anchor: i32,
    pub band: RangeBand,
    /// Whom it holds, when not everybody.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<ZoneSide>,
    pub on_death: ZoneOnDeath,
    /// A number the zone carries - a toll, a strength.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    /// How its reach grows each round, and up to where.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grows: Option<ZoneGrowth>,
}

/// `runningZoneSchema`: a standing zone as a save holds it.
pub fn running_zone_schema() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        object(vec![
            req("id", content_id()),
            req("name", string().min(1.0)),
            req("owner", nullable(string().min(1.0))),
            req("condition", string().min(1.0)),
            req("anchor", int()),
            req("band", one_of(&["melee", "veryClose", "close", "far", "veryFar", "outOfRange"])),
            opt("side", one_of(&["allies", "adversaries"])),
            def("onDeath", one_of(&["end", "keep"]), || json!("keep")),
            opt("value", int().min(0.0)),
            opt("grows", object(vec![req("by", int().positive()), req("until", int().positive())])),
        ])
    })
}
