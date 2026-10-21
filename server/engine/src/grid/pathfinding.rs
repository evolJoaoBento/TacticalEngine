//! Movement rules, reachability and pathfinding over a `TileGrid` (`src/engine/grid/pathfinding.ts`).
//!
//! Dijkstra for a reachable field, A* for a path, over the TypeScript's own binary heap - ported line for
//! line, because which of two equally cheap tiles is taken first decides which of two equally cheap
//! routes is walked, and the routes must be the same ones.

use super::tile_grid::{TileGrid, NO_TILE};
use crate::js;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MovementRules {
    /// The four diagonal steps as well as the four orthogonal ones.
    pub diagonals: bool,
    /// The largest change in standing height one step may cross, in blocks; `INFINITY` ignores height.
    pub max_step_height: f64,
    /// Whether a diagonal step may squeeze past a blocked corner.
    pub allow_corner_cutting: bool,
    /// What a diagonal step's cost is multiplied by.
    pub diagonal_cost_multiplier: f64,
}

/// The most a step climbs, in blocks: past it is a jump.
pub const WALKABLE_RISE: f64 = 0.72;

pub const DEFAULT_MOVEMENT: MovementRules = MovementRules { diagonals: false, max_step_height: WALKABLE_RISE, allow_corner_cutting: false, diagonal_cost_multiplier: 1.5 };

/// What a query is made in, beyond the rules: tiles this mover cannot enter, a surcharge per tile
/// (a negative one clamped to nothing), and how far from the start - rounded, as the crow flies - a
/// tile may lie.
#[derive(Default)]
pub struct MovementContext<'a> {
    pub is_blocked: Option<&'a dyn Fn(i32) -> bool>,
    pub extra_cost: Option<&'a dyn Fn(i32) -> f64>,
    pub max_span: Option<f64>,
}

/// A reachability query's answer: the cost to reach each tile within budget, and the step before it.
#[derive(Clone, Debug)]
pub struct ReachableField {
    pub start: i32,
    pub budget: f64,
    cost: Vec<f64>,
    prev: Vec<i32>,
    reached: Vec<bool>,
}

impl ReachableField {
    /// The cost to reach a tile, or `INFINITY` out of reach.
    pub fn cost_to(&self, tile: i32) -> f64 {
        match usize::try_from(tile).ok().filter(|&t| self.reached.get(t) == Some(&true)) {
            Some(t) => self.cost[t],
            None => f64::INFINITY,
        }
    }

    pub fn can_reach(&self, tile: i32) -> bool {
        let cost = self.cost_to(tile);
        cost.is_finite() && cost <= self.budget
    }

    /// The tile stepped from to reach this one, or `NO_TILE`.
    pub fn came_from(&self, tile: i32) -> i32 {
        match usize::try_from(tile).ok().filter(|&t| self.reached.get(t) == Some(&true)) {
            Some(t) => self.prev[t],
            None => NO_TILE,
        }
    }

    /// Every tile reached, cheapest first, then by index.
    pub fn tiles(&self) -> Vec<i32> {
        let mut out: Vec<i32> = (0..self.reached.len() as i32).filter(|&t| self.reached[t as usize]).collect();
        out.sort_by(|&a, &b| self.cost[a as usize].partial_cmp(&self.cost[b as usize]).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(&b)));
        out
    }
}

/// A minimum binary heap of tiles keyed by cost: the TypeScript's `TileHeap`, sift for sift.
#[derive(Default)]
struct TileHeap {
    tiles: Vec<i32>,
    costs: Vec<f64>,
}

impl TileHeap {
    fn push(&mut self, tile: i32, cost: f64) {
        self.tiles.push(tile);
        self.costs.push(cost);
        let mut i = self.tiles.len() - 1;
        while i > 0 {
            let parent = (i - 1) >> 1;
            if self.costs[parent] <= self.costs[i] {
                break;
            }
            self.swap(i, parent);
            i = parent;
        }
    }

    fn pop(&mut self) -> i32 {
        let count = self.tiles.len();
        if count == 0 {
            return NO_TILE;
        }
        let top = self.tiles[0];
        let last_tile = self.tiles.pop().expect("a tile");
        let last_cost = self.costs.pop().expect("a cost");
        let count = count - 1;
        if count > 0 {
            self.tiles[0] = last_tile;
            self.costs[0] = last_cost;
            let mut i = 0;
            loop {
                let left = i * 2 + 1;
                if left >= count {
                    break;
                }
                let right = left + 1;
                let mut child = left;
                if right < count && self.costs[right] < self.costs[left] {
                    child = right;
                }
                if self.costs[i] <= self.costs[child] {
                    break;
                }
                self.swap(i, child);
                i = child;
            }
        }
        top
    }

    fn swap(&mut self, a: usize, b: usize) {
        self.tiles.swap(a, b);
        self.costs.swap(a, b);
    }

    fn is_empty(&self) -> bool {
        self.tiles.is_empty()
    }
}

pub struct Pathfinder<'g> {
    pub grid: &'g TileGrid,
    /// The cheapest a step onto any passable kind can cost: keeps the A* heuristic admissible.
    min_step_cost: f64,
}

/// The state of one search: fresh per query, which is what the TypeScript's generation stamps amount to.
struct Search {
    cost: Vec<f64>,
    prev: Vec<i32>,
    stamped: Vec<bool>,
    closed: Vec<bool>,
    heap: TileHeap,
}

impl<'g> Pathfinder<'g> {
    pub fn new(grid: &'g TileGrid) -> Self {
        let mut min = f64::INFINITY;
        for kind in &grid.palette.types {
            if kind.passable {
                min = js::min(min, kind.cost);
            }
        }
        Pathfinder { grid, min_step_cost: if min.is_finite() { js::max(0.0, min) } else { 0.0 } }
    }

    fn search(&self) -> Search {
        let size = self.grid.size() as usize;
        Search { cost: vec![0.0; size], prev: vec![0; size], stamped: vec![false; size], closed: vec![false; size], heap: TileHeap::default() }
    }

    /// Relax one neighbour of `from` (the TypeScript's `relaxNeighbor`).
    #[allow(clippy::too_many_arguments)]
    fn relax(&self, search: &mut Search, from: i32, from_cost: f64, next: i32, start: i32, budget: f64, goal: i32, rules: &MovementRules, context: &MovementContext) {
        if !self.can_step(from, next, rules, context) {
            return;
        }
        if let Some(span) = context.max_span {
            if js::round(self.grid.euclidean_distance(start, next)) > span {
                return;
            }
        }
        let total = from_cost + self.step_cost(from, next, rules, context);
        if total > budget {
            return;
        }
        let n = next as usize;
        if search.stamped[n] && search.cost[n] <= total {
            return;
        }
        search.cost[n] = total;
        search.prev[n] = from;
        search.stamped[n] = true;
        let key = if goal == NO_TILE { total } else { total + self.heuristic(next, goal, rules) };
        search.heap.push(next, key);
    }

    /// Dijkstra from `start`, stopping once every frontier tile is over `budget` (`INFINITY` for none).
    pub fn reachable(&self, start: i32, budget: f64, rules: &MovementRules, context: &MovementContext) -> ReachableField {
        let mut search = self.search();
        if self.grid.is_tile(start) {
            let s = start as usize;
            search.cost[s] = 0.0;
            search.prev[s] = NO_TILE;
            search.stamped[s] = true;
            search.heap.push(start, 0.0);
        }
        while !search.heap.is_empty() {
            let current = search.heap.pop();
            let c = current as usize;
            if !search.stamped[c] || search.closed[c] {
                continue;
            }
            search.closed[c] = true;
            let current_cost = search.cost[c];
            if current_cost >= budget {
                continue;
            }
            let mut neighbours = Vec::with_capacity(8);
            self.grid.for_each_neighbor(current, rules.diagonals, |n| neighbours.push(n));
            for next in neighbours {
                self.relax(&mut search, current, current_cost, next, start, budget, NO_TILE, rules, context);
            }
        }
        ReachableField { start, budget, cost: search.cost, prev: search.prev, reached: search.stamped }
    }

    /// A* from `start` to `goal`: the tiles from one to the other inclusive, or nothing when no route exists.
    pub fn find_path(&self, start: i32, goal: i32, rules: &MovementRules, context: &MovementContext) -> Option<Vec<i32>> {
        let grid = self.grid;
        if !grid.is_tile(start) || !grid.is_tile(goal) {
            return None;
        }
        if start == goal {
            return Some(vec![start]);
        }
        if !grid.is_passable(goal) || context.is_blocked.is_some_and(|blocked| blocked(goal)) {
            return None;
        }
        let mut search = self.search();
        let s = start as usize;
        search.cost[s] = 0.0;
        search.prev[s] = NO_TILE;
        search.stamped[s] = true;
        search.heap.push(start, self.heuristic(start, goal, rules));
        while !search.heap.is_empty() {
            let current = search.heap.pop();
            let c = current as usize;
            if !search.stamped[c] || search.closed[c] {
                continue;
            }
            search.closed[c] = true;
            if current == goal {
                return Self::trace(&search, start, goal);
            }
            let current_cost = search.cost[c];
            let mut neighbours = Vec::with_capacity(8);
            grid.for_each_neighbor(current, rules.diagonals, |n| neighbours.push(n));
            for next in neighbours {
                self.relax(&mut search, current, current_cost, next, start, f64::INFINITY, goal, rules, context);
            }
        }
        None
    }

    /// The cheapest reached tile a single step from `target`: where a mover stops to reach something
    /// standing on a tile it cannot enter. `NO_TILE` when nothing beside it was reached.
    pub fn nearest_reachable_adjacent_to(&self, field: &ReachableField, target: i32, rules: &MovementRules) -> i32 {
        let (mut best, mut best_cost) = (NO_TILE, f64::INFINITY);
        self.grid.for_each_neighbor(target, rules.diagonals, |neighbour| {
            let cost = field.cost_to(neighbour);
            if cost < best_cost {
                best_cost = cost;
                best = neighbour;
            }
        });
        best
    }

    fn can_step(&self, from: i32, to: i32, rules: &MovementRules, context: &MovementContext) -> bool {
        let grid = self.grid;
        if !grid.is_passable(to) || context.is_blocked.is_some_and(|blocked| blocked(to)) {
            return false;
        }
        if (grid.stand_at(to) - grid.stand_at(from)).abs() > rules.max_step_height {
            return false;
        }
        if rules.diagonals && !rules.allow_corner_cutting && grid.is_diagonal_step(from, to) {
            let side_a = grid.index_of(grid.x_of(to), grid.y_of(from));
            let side_b = grid.index_of(grid.x_of(from), grid.y_of(to));
            if !self.is_corner_clear(side_a, from, rules, context) || !self.is_corner_clear(side_b, from, rules, context) {
                return false;
            }
        }
        true
    }

    fn is_corner_clear(&self, side: i32, from: i32, rules: &MovementRules, context: &MovementContext) -> bool {
        let grid = self.grid;
        if !grid.is_passable(side) || context.is_blocked.is_some_and(|blocked| blocked(side)) {
            return false;
        }
        (grid.stand_at(side) - grid.stand_at(from)).abs() <= rules.max_step_height
    }

    fn step_cost(&self, from: i32, to: i32, rules: &MovementRules, context: &MovementContext) -> f64 {
        let mut cost = self.grid.cost_at(to);
        if rules.diagonals && self.grid.is_diagonal_step(from, to) {
            cost *= rules.diagonal_cost_multiplier;
        }
        cost + js::max(0.0, context.extra_cost.map_or(0.0, |extra| extra(to)))
    }

    /// Never more than the rest of the way can cost, which keeps A* optimal: the fewest steps the rules
    /// could need, times the cheapest a step can be.
    fn heuristic(&self, from: i32, to: i32, rules: &MovementRules) -> f64 {
        let steps = if rules.diagonals { self.grid.chebyshev_distance(from, to) } else { self.grid.manhattan_distance(from, to) };
        let cheapest = if rules.diagonals { self.min_step_cost * js::min(1.0, rules.diagonal_cost_multiplier) } else { self.min_step_cost };
        f64::from(steps) * cheapest
    }

    fn trace(search: &Search, start: i32, goal: i32) -> Option<Vec<i32>> {
        let mut path = Vec::new();
        let mut tile = goal;
        while tile != NO_TILE {
            if !search.stamped[tile as usize] {
                return None;
            }
            path.push(tile);
            if tile == start {
                break;
            }
            tile = search.prev[tile as usize];
        }
        if path.last() != Some(&start) {
            return None;
        }
        path.reverse();
        Some(path)
    }
}

/// Walk a field back from a destination to its start: the tiles from one to the other, or nothing when
/// the destination was not reached.
pub fn trace_path(field: &ReachableField, destination: i32) -> Option<Vec<i32>> {
    if !field.can_reach(destination) {
        return None;
    }
    let mut path = Vec::new();
    let mut tile = destination;
    while tile != NO_TILE {
        path.push(tile);
        if tile == field.start {
            break;
        }
        tile = field.came_from(tile);
    }
    if path.last() != Some(&field.start) {
        return None;
    }
    path.reverse();
    Some(path)
}
