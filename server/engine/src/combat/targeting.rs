//! Whether an attack can be made, and how the shot is (`src/engine/combat/targeting.ts`): the distance as
//! the crow flies, the band it falls in, line of sight, and cover - which costs a ranged attacker a
//! disadvantage die and never touches the Difficulty. A total obstruction is no line at all.

use crate::grid::los::{cover_between, line_of_sight, LineOfSightRules, DEFAULT_LINE_OF_SIGHT};
use crate::grid::tile_grid::{Spot, TileGrid};
use crate::js;
use crate::rules::cover::{cover_disadvantage, Cover};
use crate::rules::range::{band_for_span, band_label, reaches, BandTiles, RangeBand, DEFAULT_BAND_TILES};
use serde::{Deserialize, Serialize, Serializer};

/// Why an attack cannot be made.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetingRefusal {
    NoAttacker,
    NoTarget,
    SelfTarget,
    OutOfRange,
    NoLineOfSight,
}

/// Where both stand, when that is known more finely than their tiles.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Standings {
    pub attacker: Spot,
    pub target: Spot,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetingOptions {
    /// Tile distances that define each band. Defaults to the engine's table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_tiles: Option<BandTiles>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub los_rules: Option<LineOfSightRules>,
    /// Whether the attack is ranged, when the band alone should not decide it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ranged: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<Standings>,
}

impl TargetingOptions {
    pub fn table(&self) -> &BandTiles {
        self.band_tiles.as_ref().unwrap_or(&DEFAULT_BAND_TILES)
    }

    pub fn sight(&self) -> LineOfSightRules {
        self.los_rules.unwrap_or(DEFAULT_LINE_OF_SIGHT)
    }
}

/// Infinity, as `JSON.stringify` writes it: `null`.
fn finite_or_null<S: Serializer>(x: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if x.is_finite() {
        serializer.serialize_f64(*x)
    } else {
        serializer.serialize_none()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetingReport {
    /// Straight-line distance in tiles.
    #[serde(serialize_with = "finite_or_null")]
    pub distance: f64,
    pub band: RangeBand,
    pub band_label: &'static str,
    pub has_line_of_sight: bool,
    /// Whether something got in the way without stopping the shot.
    pub partial_obstruction: bool,
    /// Cover the target benefits from. Always none against a melee attack.
    pub cover: Cover,
    pub cover_disadvantage: u32,
    pub ranged: bool,
    /// `None` when the attack is legal.
    pub refusal: Option<TargetingRefusal>,
}

/// Measure an attack from one tile to another.
pub fn evaluate_target(grid: &TileGrid, attacker_tile: i32, target_tile: i32, max_range: RangeBand, options: &TargetingOptions) -> TargetingReport {
    let empty = TargetingReport {
        distance: f64::INFINITY,
        band: RangeBand::OutOfRange,
        band_label: band_label(RangeBand::OutOfRange),
        has_line_of_sight: false,
        partial_obstruction: false,
        cover: Cover::None,
        cover_disadvantage: 0,
        ranged: true,
        refusal: Some(TargetingRefusal::NoTarget),
    };
    if !grid.is_tile(attacker_tile) {
        return TargetingReport { refusal: Some(TargetingRefusal::NoAttacker), ..empty };
    }
    if !grid.is_tile(target_tile) {
        return empty;
    }
    // Attacking your own tile is a caller mistake, not a zero-range attack.
    if attacker_tile == target_tile {
        return TargetingReport {
            distance: 0.0,
            band: RangeBand::Melee,
            band_label: band_label(RangeBand::Melee),
            has_line_of_sight: true,
            ranged: false,
            refusal: Some(TargetingRefusal::SelfTarget),
            ..empty
        };
    }

    // As the crow flies, from where one stands to where the other does.
    let distance = match options.at {
        None => grid.euclidean_distance(attacker_tile, target_tile),
        Some(at) => js::hypot(at.attacker.x - at.target.x, at.attacker.y - at.target.y),
    };
    let band = band_for_span(distance, options.table());
    let ranged = options.ranged.unwrap_or(band != RangeBand::Melee);
    let sight = line_of_sight(grid, attacker_tile, target_tile, options.sight());
    let cover = if ranged { cover_between(grid, attacker_tile, target_tile, options.sight()) } else { Cover::None };
    let refusal = if !reaches(band, max_range) {
        Some(TargetingRefusal::OutOfRange)
    } else if ranged && !sight.clear {
        Some(TargetingRefusal::NoLineOfSight)
    } else {
        None
    };
    TargetingReport {
        distance,
        band,
        band_label: band_label(band),
        has_line_of_sight: sight.clear,
        partial_obstruction: sight.partial,
        cover,
        cover_disadvantage: cover_disadvantage(cover, ranged),
        ranged,
        refusal,
    }
}

/// Whether an attack from one tile to another is legal at all.
pub fn can_target(grid: &TileGrid, attacker_tile: i32, target_tile: i32, max_range: RangeBand, options: &TargetingOptions) -> bool {
    evaluate_target(grid, attacker_tile, target_tile, max_range, options).refusal.is_none()
}

/// A short reason a UI can show when an attack is refused.
pub fn refusal_message(refusal: TargetingRefusal) -> &'static str {
    match refusal {
        TargetingRefusal::NoAttacker => "The attacker is not on the map.",
        TargetingRefusal::NoTarget => "The target is not on the map.",
        TargetingRefusal::SelfTarget => "A creature cannot attack its own tile.",
        TargetingRefusal::OutOfRange => "The target is out of range.",
        TargetingRefusal::NoLineOfSight => "Something blocks the line of sight.",
    }
}
