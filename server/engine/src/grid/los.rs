//! Line of sight, and the cover it produces (`src/engine/grid/los.ts`), SRD 2.0 "LINE OF SIGHT & COVER".
//!
//! Sight travels between tile centres over the tiles the segment passes through. Running squarely into a
//! blocking tile is a total obstruction - no sight; clipping a corner where only one of the two tiles
//! blocks is a partial one - the shot gets through and the target has cover. A tile blocks if its kind
//! says so, or if it stands higher than both ends by the margin. The ends never block.

use super::tile_grid::{TileGrid, SLAB_BLOCKS};
use crate::rules::cover::{combine_cover, Cover};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineOfSightRules {
    /// How much higher than both ends a tile must stand before it blocks sight, in levels of ground.
    pub blocking_height_margin: f64,
}

pub const DEFAULT_LINE_OF_SIGHT: LineOfSightRules = LineOfSightRules { blocking_height_margin: 1.0 };

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineOfSightResult {
    /// Whether the target can be seen, and so targeted, at all.
    pub clear: bool,
    /// Something stood in the way but the shot got through: the partial obstruction that is cover.
    pub partial: bool,
    /// The first tile that blocked the line, or -1.
    pub first_blocker: i32,
}

/// Walk the tiles a segment between two tile centres passes through, ends included; `visit` answers
/// false to stop. At an exact corner both tiles are visited, as a pair (`at_corner`). All integer, so the
/// walk is exact and symmetric.
pub fn trace_line(grid: &TileGrid, from: i32, to: i32, mut visit: impl FnMut(i32, bool) -> bool) {
    if !grid.is_tile(from) || !grid.is_tile(to) {
        return;
    }
    let (mut x, mut y) = (grid.x_of(from), grid.y_of(from));
    let (x1, y1) = (grid.x_of(to), grid.y_of(to));
    if x == x1 && y == y1 {
        visit(from, false);
        return;
    }
    let (span_x, span_y) = (i64::from((x1 - x).abs()), i64::from((y1 - y).abs()));
    let step_x = if x < x1 { 1 } else { -1 };
    let step_y = if y < y1 { 1 } else { -1 };
    let (mut taken_x, mut taken_y) = (0i64, 0i64);
    if !visit(grid.index_of(x, y), false) {
        return;
    }
    while taken_x < span_x || taken_y < span_y {
        let next_x = (2 * taken_x + 1) * span_y;
        let next_y = (2 * taken_y + 1) * span_x;
        if taken_y >= span_y || (taken_x < span_x && next_x < next_y) {
            x += step_x;
            taken_x += 1;
        } else if taken_x >= span_x || next_y < next_x {
            y += step_y;
            taken_y += 1;
        } else {
            if !visit(grid.index_of(x + step_x, y), true) {
                return;
            }
            if !visit(grid.index_of(x, y + step_y), true) {
                return;
            }
            x += step_x;
            y += step_y;
            taken_x += 1;
            taken_y += 1;
        }
        if !visit(grid.index_of(x, y), false) {
            return;
        }
    }
}

/// Whether a tile blocks sight between two ends of these heights.
fn blocks_between(grid: &TileGrid, tile: i32, from_height: f64, to_height: f64, rules: LineOfSightRules) -> bool {
    if grid.blocks_sight(tile) {
        return true;
    }
    let highest_end = crate::js::max(from_height, to_height);
    (grid.stand_at(tile) - highest_end) / SLAB_BLOCKS >= rules.blocking_height_margin - 1e-6
}

/// Sight between two tiles, and whether an obstruction - if any - was partial or total.
pub fn line_of_sight(grid: &TileGrid, from: i32, to: i32, rules: LineOfSightRules) -> LineOfSightResult {
    if !grid.is_tile(from) || !grid.is_tile(to) {
        return LineOfSightResult { clear: false, partial: false, first_blocker: -1 };
    }
    if from == to {
        return LineOfSightResult { clear: true, partial: false, first_blocker: -1 };
    }
    let (from_height, to_height) = (grid.stand_at(from), grid.stand_at(to));
    let (mut blocked, mut partial, mut first_blocker) = (false, false, -1);
    // A corner pair only stops the line when both of its tiles block; one is squeezing past a corner.
    let (mut corner_blocked, mut corner_seen, mut corner_first) = (0, 0, -1);
    trace_line(grid, from, to, |tile, at_corner| {
        if tile == from || tile == to {
            return true;
        }
        let blocks = blocks_between(grid, tile, from_height, to_height, rules);
        if !at_corner {
            if !blocks {
                return true;
            }
            blocked = true;
            if first_blocker < 0 {
                first_blocker = tile;
            }
            return false;
        }
        if blocks && corner_first < 0 {
            corner_first = tile;
        }
        if blocks {
            corner_blocked += 1;
        }
        corner_seen += 1;
        if corner_seen == 2 {
            if corner_blocked == 2 {
                blocked = true;
                if first_blocker < 0 {
                    first_blocker = corner_first;
                }
                return false;
            }
            if corner_blocked == 1 {
                partial = true;
            }
            corner_blocked = 0;
            corner_seen = 0;
            corner_first = -1;
        }
        true
    });
    LineOfSightResult { clear: !blocked, partial: !blocked && partial, first_blocker }
}

pub fn has_line_of_sight(grid: &TileGrid, from: i32, to: i32, rules: LineOfSightRules) -> bool {
    line_of_sight(grid, from, to, rules).clear
}

/// The cover a target at `to` has against an attacker at `from`: from a partial obstruction on the line,
/// or from standing on something that gives it.
pub fn cover_between(grid: &TileGrid, from: i32, to: i32, rules: LineOfSightRules) -> Cover {
    let standing = if grid.provides_cover(to) { Cover::Cover } else { Cover::None };
    let sight = line_of_sight(grid, from, to, rules);
    combine_cover(standing, if sight.partial { Cover::Cover } else { Cover::None })
}
