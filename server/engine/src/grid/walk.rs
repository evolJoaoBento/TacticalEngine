//! The walk itself (`src/engine/grid/walk.ts`): from a path of tiles to the line a creature takes - its
//! corners pulled straight wherever its body fits, and where a walk aimed at a spot actually ends. All of
//! it floating point, computed as JavaScript computes it (`js::hypot`, `js::round`), step for step, so a
//! line drawn here is the line the page draws.

use super::pathfinding::WALKABLE_RISE;
use super::tile_grid::{Spot, TileGrid, NO_TILE};
use crate::js;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WalkRules {
    /// Half the width of a creature, in tiles.
    pub radius: f64,
    /// The largest change in standing height a step may cross, in blocks.
    pub max_step_height: f64,
}

/// Half the width of a creature, in tiles: what the tokens are.
pub const BODY_RADIUS: f64 = 0.35;
pub const DEFAULT_WALK: WalkRules = WalkRules { radius: BODY_RADIUS, max_step_height: WALKABLE_RISE };

/// How finely a segment is checked, in tiles.
const STRIDE: f64 = 0.25;

/// A body's rim round its centre, as fractions of its radius.
const RIM: [(f64, f64); 8] = [
    (1.0, 0.0),
    (-1.0, 0.0),
    (0.0, 1.0),
    (0.0, -1.0),
    (std::f64::consts::FRAC_1_SQRT_2, std::f64::consts::FRAC_1_SQRT_2),
    (-std::f64::consts::FRAC_1_SQRT_2, std::f64::consts::FRAC_1_SQRT_2),
    (std::f64::consts::FRAC_1_SQRT_2, -std::f64::consts::FRAC_1_SQRT_2),
    (-std::f64::consts::FRAC_1_SQRT_2, -std::f64::consts::FRAC_1_SQRT_2),
];

fn distance(a: Spot, b: Spot) -> f64 {
    js::hypot(b.x - a.x, b.y - a.y)
}

/// Whether a creature can stand with its centre at a spot: the tile under it and every tile its rim
/// reaches is floor, not held, and within a step of the tile under its centre.
pub fn can_stand_at(grid: &TileGrid, spot: Spot, blocked: &dyn Fn(i32) -> bool, rules: WalkRules) -> bool {
    let centre = grid.tile_at_spot(spot.x, spot.y);
    if centre == NO_TILE || !grid.is_passable(centre) || blocked(centre) {
        return false;
    }
    let level = grid.stand_at(centre);
    for (dx, dy) in RIM {
        let tile = grid.tile_at_spot(spot.x + dx * rules.radius, spot.y + dy * rules.radius);
        if tile == centre {
            continue;
        }
        if tile == NO_TILE || !grid.is_passable(tile) || blocked(tile) {
            return false;
        }
        if (grid.stand_at(tile) - level).abs() > rules.max_step_height {
            return false;
        }
    }
    true
}

/// Whether a creature can walk straight from one spot to another: it can stand all along the way, and
/// no step along it climbs more than a step.
pub fn segment_clear(grid: &TileGrid, from: Spot, to: Spot, blocked: &dyn Fn(i32) -> bool, rules: WalkRules) -> bool {
    let length = distance(from, to);
    let steps = js::max(1.0, (length / STRIDE).ceil());
    let mut level = grid.stand_at(grid.tile_at_spot(from.x, from.y));
    let mut i = 1.0;
    while i <= steps {
        let t = i / steps;
        let spot = Spot { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        if !can_stand_at(grid, spot, blocked, rules) {
            return false;
        }
        let here = grid.stand_at(grid.tile_at_spot(spot.x, spot.y));
        if (here - level).abs() > rules.max_step_height {
            return false;
        }
        level = here;
        i += 1.0;
    }
    true
}

/// Where a walk aimed at a spot ends: the spot when a creature can stand there clear of the others, else
/// the nearest point back towards the last tile's centre where it can; the centre at worst.
pub fn settle_end(grid: &TileGrid, last: i32, aimed: Spot, blocked: &dyn Fn(i32) -> bool, others: &[Spot], rules: WalkRules) -> Spot {
    let centre = grid.spot_of(last);
    if grid.tile_at_spot(aimed.x, aimed.y) != last {
        return centre;
    }
    let clear = |spot: Spot| can_stand_at(grid, spot, blocked, rules) && others.iter().all(|other| js::hypot(other.x - spot.x, other.y - spot.y) >= 2.0 * rules.radius);
    let mut t = 1.0;
    while t > 0.0 {
        let spot = Spot { x: centre.x + (aimed.x - centre.x) * t, y: centre.y + (aimed.y - centre.y) * t };
        if clear(spot) {
            return spot;
        }
        t -= 0.1;
    }
    centre
}

/// The line a creature walks along a path of tiles: its corners pulled straight wherever the way is
/// clear, from `start` (the first tile's centre when none) to `end` (the last's).
pub fn smooth_path(grid: &TileGrid, path: &[i32], blocked: &dyn Fn(i32) -> bool, rules: WalkRules, start: Option<Spot>, end: Option<Spot>) -> Vec<Spot> {
    if path.is_empty() {
        return Vec::new();
    }
    let mut points: Vec<Spot> = path.iter().map(|&tile| grid.spot_of(tile)).collect();
    if let Some(start) = start {
        points[0] = start;
    }
    if let Some(end) = end {
        let last = points.len() - 1;
        points[last] = end;
    }
    let mut line = vec![points[0]];
    let mut i = 0;
    while i < points.len() - 1 {
        let mut next = i + 1;
        let mut j = points.len() - 1;
        while j > i + 1 {
            if segment_clear(grid, points[i], points[j], blocked, rules) {
                next = j;
                break;
            }
            j -= 1;
        }
        line.push(points[next]);
        i = next;
    }
    line
}

/// The nearest point on a line to a spot.
pub fn nearest_on_line(line: &[Spot], spot: Spot) -> Spot {
    let Some(&first) = line.first() else { return spot };
    let (mut best, mut best_distance) = (first, f64::INFINITY);
    for pair in line.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let length2 = dx * dx + dy * dy;
        let t = if length2 == 0.0 { 0.0 } else { js::max(0.0, js::min(1.0, ((spot.x - a.x) * dx + (spot.y - a.y) * dy) / length2)) };
        let candidate = Spot { x: a.x + dx * t, y: a.y + dy * t };
        let d = js::hypot(candidate.x - spot.x, candidate.y - spot.y);
        if d < best_distance {
            best = candidate;
            best_distance = d;
        }
    }
    best
}

/// The point a distance along a line from its start; the start before it, the end past it.
pub fn point_along(line: &[Spot], distance_along: f64) -> Spot {
    let Some(&last) = line.last() else { return Spot { x: -1.0, y: -1.0 } };
    let mut left = js::max(0.0, distance_along);
    for pair in line.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let length = distance(a, b);
        if left <= length {
            let t = if length == 0.0 { 0.0 } else { left / length };
            return Spot { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        left -= length;
    }
    last
}

/// The length of a line, in tiles.
pub fn line_length(line: &[Spot]) -> f64 {
    let mut total = 0.0;
    for pair in line.windows(2) {
        total += distance(pair[0], pair[1]);
    }
    total
}

/// What one small piece of a line costs to cross: its length, times what the ground under its middle costs.
fn piece_cost(grid: &TileGrid, a: Spot, b: Spot) -> f64 {
    let cost = grid.cost_at(grid.tile_at_spot((a.x + b.x) / 2.0, (a.y + b.y) / 2.0));
    distance(a, b) * if cost.is_finite() { cost } else { 1.0 }
}

/// A line's segments as pieces no longer than a stride, in order; `visit` answers false to stop.
fn each_piece(line: &[Spot], mut visit: impl FnMut(Spot, Spot) -> bool) {
    for pair in line.windows(2) {
        let (from, to) = (pair[0], pair[1]);
        let steps = js::max(1.0, (distance(from, to) / STRIDE).ceil());
        let mut k = 0.0;
        while k < steps {
            let a = Spot { x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps };
            let b = Spot { x: from.x + ((to.x - from.x) * (k + 1.0)) / steps, y: from.y + ((to.y - from.y) * (k + 1.0)) / steps };
            if !visit(a, b) {
                return;
            }
            k += 1.0;
        }
    }
}

/// What a line costs to walk: its length, and more through whatever costs more to enter.
pub fn line_cost(grid: &TileGrid, line: &[Spot]) -> f64 {
    let mut total = 0.0;
    each_piece(line, |a, b| {
        total += piece_cost(grid, a, b);
        true
    });
    total
}

/// How far along a line an allowance of movement goes, in tiles of the line's own length.
pub fn distance_within(grid: &TileGrid, line: &[Spot], allowance: f64) -> f64 {
    let (mut spent, mut gone) = (0.0, 0.0);
    each_piece(line, |a, b| {
        let cost = piece_cost(grid, a, b);
        let length = distance(a, b);
        if spent + cost > allowance {
            gone += if cost <= 0.0 { 0.0 } else { (length * js::max(0.0, allowance - spent)) / cost };
            return false;
        }
        spent += cost;
        gone += length;
        true
    });
    gone
}

/// A circle on the ground, in tile units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Circle {
    pub anchor: Spot,
    pub radius: f64,
}

/// Whether a spot is inside a circle; on the edge counts.
pub fn inside_circle(spot: Spot, circle: Circle) -> bool {
    js::hypot(spot.x - circle.anchor.x, spot.y - circle.anchor.y) <= circle.radius + 1e-9
}

/// How far along a line stays inside a circle: all of it when it never leaves; else up to where it first
/// crosses the edge, to the nearest hundredth. A line that starts outside goes nowhere.
pub fn distance_inside(line: &[Spot], circle: Circle) -> f64 {
    match line.first() {
        Some(&first) if inside_circle(first, circle) => {}
        _ => return 0.0,
    }
    let total = line_length(line);
    if line.iter().all(|&spot| inside_circle(spot, circle)) {
        return total;
    }
    let (mut inside, mut outside) = (0.0, total);
    let mut gone = 0.01;
    while gone < total {
        if !inside_circle(point_along(line, gone), circle) {
            outside = gone;
            break;
        }
        inside = gone;
        gone += 0.01;
    }
    js::min(inside, outside)
}

/// A line in two at a distance along it: what is walked, and what is left, each with the point between.
pub fn split_line(line: &[Spot], distance_along: f64) -> (Vec<Spot>, Vec<Spot>) {
    let cut = point_along(line, distance_along);
    let mut within = Vec::new();
    let mut left = js::max(0.0, distance_along);
    let mut i = 0;
    while i + 1 < line.len() {
        within.push(line[i]);
        let length = distance(line[i], line[i + 1]);
        if left <= length {
            break;
        }
        left -= length;
        i += 1;
    }
    if i + 1 >= line.len() {
        return (line.to_vec(), Vec::new());
    }
    within.push(cut);
    let mut beyond = vec![cut];
    beyond.extend_from_slice(&line[i + 1..]);
    (within, beyond)
}
