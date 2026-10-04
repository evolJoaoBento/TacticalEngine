//! Moving a creature from a script: a walk toward somebody or a place until it is within the band asked
//! (the GM's own walk - everywhere it could get to, the tile nearest its goal, the lower index on a tie),
//! a walk as far from somebody as the ground allows, a blink that reads only the band, and a push straight
//! back until the band is reached or something is in the way. A walk hands back the line it crossed.

use super::SceneScriptWorld;
use crate::content::conditions::ConditionBlock;
use crate::grid::pathfinding::{trace_path, MovementContext, Pathfinder, ReachableField, DEFAULT_MOVEMENT};
use crate::grid::tile_grid::{Spot, NO_TILE};
use crate::grid::walk::{smooth_path, WalkRules, DEFAULT_WALK};
use crate::rules::range::{band_for_span, band_index, max_tiles_for_band, reaches, RangeBand};
use crate::script::runner::Moved;

impl<'w> SceneScriptWorld<'w> {
    /// Walk a creature in, straight at another, until it is within the band or can get no nearer.
    pub fn draw_in(&mut self, mover: &str, toward: &str, band: RangeBand, budget: RangeBand) -> Option<Moved> {
        let goal = self.tile_of(toward);
        self.draw_to(mover, goal, band, budget)
    }

    /// The body a walk is measured with: the engine's, stepping as far as the movement rules step.
    fn walk_rules(&self) -> WalkRules {
        WalkRules { max_step_height: self.content.movement.unwrap_or(DEFAULT_MOVEMENT).max_step_height, ..DEFAULT_WALK }
    }

    /// Everywhere a creature could walk to on this budget, around the bodies in its way.
    fn field(&self, mover: &str, start: i32, budget: RangeBand) -> ReachableField {
        let blocked = self.state.blocked_for(mover, &[]);
        let rules = self.content.movement.unwrap_or(DEFAULT_MOVEMENT);
        let context = MovementContext { is_blocked: Some(&blocked), ..MovementContext::default() };
        Pathfinder::new(&self.state.grid).reachable(start, max_tiles_for_band(budget, self.content.table()), &rules, &context)
    }

    /// The line a creature crosses to a tile of a field it can reach, its corners pulled straight where its
    /// body fits. Read before the creature is moved.
    fn line_of(&self, mover: &str, field: &ReachableField, to: i32) -> Option<Vec<Spot>> {
        let walking = self.state.entity(mover)?;
        let path = trace_path(field, to)?;
        let blocked = self.state.blocked_for(mover, &[]);
        Some(smooth_path(&self.state.grid, &path, &blocked, self.walk_rules(), Some(walking.at), Some(self.state.grid.spot_of(to))))
    }

    fn moved(&mut self, mover: &str, start: i32, to: i32, route: Option<Vec<Spot>>) -> Option<Moved> {
        self.state.move_entity(mover, to).expect("the mover is here");
        Some(Moved { from: start, to, route })
    }

    /// The same walk toward a place rather than a creature: the path is walked, so a wall stops it.
    pub fn draw_to(&mut self, mover: &str, goal: i32, band: RangeBand, budget: RangeBand) -> Option<Moved> {
        let start = self.state.entity(mover)?.tile;
        if start == NO_TILE || goal == NO_TILE || self.blocks(mover, ConditionBlock::Move) {
            return None;
        }
        if self.band_between(start, goal).is_some_and(|already| reaches(already, band)) {
            return None;
        }
        let grid = &self.state.grid;
        let field = self.field(mover, start, budget);
        let mut best = start;
        let mut best_distance = grid.euclidean_distance(start, goal);
        for tile in field.tiles() {
            if tile == goal {
                continue;
            }
            let distance = grid.euclidean_distance(tile, goal);
            if distance < best_distance || (distance == best_distance && tile < best) {
                best = tile;
                best_distance = distance;
            }
        }
        if best == start {
            return None;
        }
        let route = self.line_of(mover, &field, best);
        self.moved(mover, start, best, route)
    }

    /// Put a creature on a tile without walking it there: only the band is read (`OutOfRange` is however
    /// far). The tile when it is free, else the free neighbour nearest it; nowhere to land fizzles.
    pub fn blink_to(&mut self, mover: &str, goal: i32, band: RangeBand) -> Option<Moved> {
        let start = self.state.entity(mover)?.tile;
        if start == NO_TILE || goal == NO_TILE || self.blocks(mover, ConditionBlock::Move) {
            return None;
        }
        if band != RangeBand::OutOfRange && !self.band_between(start, goal).is_some_and(|reach| reaches(reach, band)) {
            return None;
        }
        let grid = &self.state.grid;
        let blocked = self.state.blocked_for(mover, &[]);
        let free = |tile: i32| grid.is_tile(tile) && grid.is_passable(tile) && !blocked(tile);
        let mut best = if free(goal) { goal } else { NO_TILE };
        if best == NO_TILE {
            let mut best_distance = f64::INFINITY;
            grid.for_each_neighbor(goal, true, |tile| {
                if !free(tile) {
                    return;
                }
                let distance = grid.euclidean_distance(tile, goal);
                if distance < best_distance || (distance == best_distance && tile < best) {
                    best = tile;
                    best_distance = distance;
                }
            });
        }
        if best == NO_TILE || best == start {
            return None;
        }
        self.moved(mover, start, best, None)
    }

    /// As much ground between them as the walk allows: the same field and tie-break, the far side of a wall
    /// out of reach.
    pub fn break_away(&mut self, mover: &str, from: &str, budget: RangeBand) -> Option<Moved> {
        let start = self.state.entity(mover)?.tile;
        let away = self.state.entity(from)?.tile;
        if start == NO_TILE || away == NO_TILE || self.blocks(mover, ConditionBlock::Move) {
            return None;
        }
        let grid = &self.state.grid;
        let field = self.field(mover, start, budget);
        let here = grid.euclidean_distance(start, away);
        let mut best = start;
        let mut best_distance = here;
        for tile in field.tiles() {
            let distance = grid.euclidean_distance(tile, away);
            if distance > best_distance || (distance == best_distance && tile < best && distance > here) {
                best = tile;
                best_distance = distance;
            }
        }
        if best == start {
            return None;
        }
        let route = self.line_of(mover, &field, best);
        self.moved(mover, start, best, route)
    }

    /// Knock a creature back, step by step straight away from another, until the band reads far enough or
    /// something is in the way: "follow the fiction".
    pub fn push_back(&mut self, from: &str, target: &str, band: RangeBand) -> Option<Moved> {
        let source = self.state.entity(from)?.tile;
        let start = self.state.entity(target)?.tile;
        if start == NO_TILE || source == NO_TILE {
            return None;
        }
        let grid = &self.state.grid;
        let dx = (grid.x_of(start) - grid.x_of(source)).signum();
        let dy = (grid.y_of(start) - grid.y_of(source)).signum();
        if dx == 0 && dy == 0 {
            return None;
        }
        let blocked = self.state.blocked_for(target, &[]);
        let goal = band_index(band);
        let table = self.content.table();
        let band_of = |tile: i32| band_index(band_for_span(grid.euclidean_distance(source, tile), table));
        let (mut tile, mut x, mut y) = (start, grid.x_of(start), grid.y_of(start));
        while band_of(tile) < goal {
            let (nx, ny) = (x + dx, y + dy);
            if !grid.in_bounds(nx, ny) {
                break;
            }
            let next = grid.index_of(nx, ny);
            if !grid.is_passable(next) || blocked(next) {
                break;
            }
            tile = next;
            x = nx;
            y = ny;
        }
        if tile == start {
            return None;
        }
        self.moved(target, start, tile, None)
    }
}
