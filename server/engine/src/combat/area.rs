//! Areas and moving under pressure (`src/engine/combat/area.ts`): what an effect aimed at a point catches
//! - everything within its radius, Very Close unless it says otherwise, with sight if it asks - and what a
//! move in a fight costs: free with an action, an Agility Roll, the action itself, or out of reach.

use crate::grid::los::{has_line_of_sight, LineOfSightRules, DEFAULT_LINE_OF_SIGHT};
use crate::grid::tile_grid::TileGrid;
use crate::js;
use crate::rules::range::{band_for_span, reaches, BandTiles, RangeBand, DEFAULT_BAND_TILES};
use serde::{Deserialize, Serialize};

/// The band a group effect spreads over from its origin, unless it says otherwise.
pub const AREA_OF_EFFECT_BAND: RangeBand = RangeBand::VeryClose;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_tiles: Option<BandTiles>,
    /// How far the effect spreads from its origin. Defaults to Very Close.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<RangeBand>,
    /// Whether a tile must be seen from the origin to be caught.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_line_of_sight: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub los_rules: Option<LineOfSightRules>,
}

impl AreaOptions {
    fn table(&self) -> &BandTiles {
        self.band_tiles.as_ref().unwrap_or(&DEFAULT_BAND_TILES)
    }
}

/// Whether the caster can put the effect's origin there.
pub fn is_legal_origin(grid: &TileGrid, caster: i32, origin: i32, effect_range: RangeBand, options: &AreaOptions) -> bool {
    if !grid.is_tile(caster) || !grid.is_tile(origin) {
        return false;
    }
    if caster == origin {
        return true;
    }
    reaches(band_for_span(grid.euclidean_distance(caster, origin), options.table()), effect_range)
}

/// Whether a tile falls inside the area an effect covers from its origin.
pub fn is_in_area(grid: &TileGrid, origin: i32, tile: i32, options: &AreaOptions) -> bool {
    if !grid.is_tile(origin) || !grid.is_tile(tile) {
        return false;
    }
    if origin == tile {
        return true;
    }
    let radius = options.radius.unwrap_or(AREA_OF_EFFECT_BAND);
    if !reaches(band_for_span(grid.euclidean_distance(origin, tile), options.table()), radius) {
        return false;
    }
    if options.require_line_of_sight != Some(true) {
        return true;
    }
    has_line_of_sight(grid, origin, tile, options.los_rules.unwrap_or(DEFAULT_LINE_OF_SIGHT))
}

/// Every tile the area covers, row by row.
pub fn tiles_in_area(grid: &TileGrid, origin: i32, options: &AreaOptions) -> Vec<i32> {
    let mut out = Vec::new();
    if !grid.is_tile(origin) {
        return out;
    }
    let radius = options.radius.unwrap_or(AREA_OF_EFFECT_BAND);
    // Bound the scan by the radius in whole tiles rather than sweeping the whole grid.
    let reach = max_tiles(radius, options.band_tiles.as_ref()).ceil();
    let (ox, oy) = (f64::from(grid.x_of(origin)), f64::from(grid.y_of(origin)));
    let mut y = js::max(0.0, oy - reach);
    while y <= js::min(f64::from(grid.height - 1), oy + reach) {
        let mut x = js::max(0.0, ox - reach);
        while x <= js::min(f64::from(grid.width - 1), ox + reach) {
            let tile = grid.index_of(x as i32, y as i32);
            if is_in_area(grid, origin, tile, options) {
                out.push(tile);
            }
            x += 1.0;
        }
        y += 1.0;
    }
    out
}

/// A band's reach in tiles: the table's, or the engine's own.
fn max_tiles(band: RangeBand, table: Option<&BandTiles>) -> f64 {
    let table = table.unwrap_or(&DEFAULT_BAND_TILES);
    match band {
        RangeBand::Melee => table.melee,
        RangeBand::VeryClose => table.very_close,
        RangeBand::Close => table.close,
        RangeBand::Far => table.far,
        RangeBand::VeryFar | RangeBand::OutOfRange => table.very_far,
    }
}

/// Who is moving: the rules differ for a PC and an adversary.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mover {
    Pc,
    Adversary,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MoveCost {
    /// Comes free with the action being taken.
    Free,
    /// Needs a successful Agility Roll to reposition safely.
    AgilityRoll,
    /// Takes the whole action, with no roll.
    Action,
    /// Beyond what a single move can cover.
    OutOfReach,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveUnderPressureOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_tiles: Option<BandTiles>,
    /// Whether the move is part of an action being taken.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub with_action: Option<bool>,
}

/// What a move in a fight costs.
pub fn move_under_pressure(grid: &TileGrid, mover: Mover, from: i32, to: i32, options: &MoveUnderPressureOptions) -> MoveCost {
    if !grid.is_tile(from) || !grid.is_tile(to) {
        return MoveCost::OutOfReach;
    }
    if from == to {
        return MoveCost::Free;
    }
    let band = band_for_span(grid.euclidean_distance(from, to), options.band_tiles.as_ref().unwrap_or(&DEFAULT_BAND_TILES));
    if mover == Mover::Adversary {
        // "within Close range for free as part of an action, or within Very Far range as a separate action."
        return if reaches(band, RangeBand::Close) {
            MoveCost::Free
        } else if reaches(band, RangeBand::VeryFar) {
            MoveCost::Action
        } else {
            MoveCost::OutOfReach
        };
    }
    if reaches(band, RangeBand::Close) {
        return if options.with_action == Some(true) { MoveCost::Free } else { MoveCost::AgilityRoll };
    }
    // Farther than Close always needs the roll, however the move started.
    if reaches(band, RangeBand::VeryFar) {
        MoveCost::AgilityRoll
    } else {
        MoveCost::OutOfReach
    }
}
