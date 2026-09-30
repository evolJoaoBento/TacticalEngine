//! Party control (`src/engine/scene/party.ts`): who the player is moving, and where everybody else goes.
//! Selection, the party's order, who walks with whom - the whole party, until a member is unlinked - and
//! who is held; the ground a member's movement covers, the walk to a tile or a spot in it, cut short where
//! the allowance runs out; and the followers, walking down the leader's trail a pace apart.
//!
//! The TypeScript's `Party` holds the scene it moves people in. Here the party holds only what is its own -
//! the selection, the groups, the order, the trails - and is handed the scene each time, so the state stays
//! the one owner of who stands where. Everything is floating point as JavaScript computes it.

use super::state::{EntityState, Faction, SceneState};
use crate::grid::pathfinding::{trace_path, MovementContext, MovementRules, Pathfinder, ReachableField, DEFAULT_MOVEMENT};
use crate::grid::tile_grid::{Spot, NO_TILE};
use crate::grid::walk::{can_stand_at, distance_inside, distance_within, inside_circle, line_cost, line_length, point_along, segment_clear, settle_end, smooth_path, split_line, Circle, WalkRules, DEFAULT_WALK};
use crate::js;
use crate::rules::range::DEFAULT_BAND_TILES;
use std::collections::{HashMap, HashSet};

/// Factions a party member walks through rather than around, out of a fight.
pub const PARTY_PASSES_THROUGH: [Faction; 1] = [Faction::Party];

/// How much further than its allowance a search looks for ground the straighter line might still cover.
const WIDER: f64 = 1.1;
const ROUND_THE_ENDS: f64 = 1.5;
/// How finely a walk cut short is backed up to somewhere a body can stand, in tiles.
const BACK_OFF: f64 = 0.1;
/// The least a walk can be, in tiles: a click nearer their feet than this is a click on them.
pub const LEAST_STEP: f64 = 0.05;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PartyOptions {
    /// How far a member moves in a fight as part of an action, along the walk: Close range.
    pub combat_reach: f64,
    /// Movement a member may spend on one walk out of a fight: nobody counts, unless a project does.
    pub move_budget: f64,
    /// How far a follower searches for a spot near the leader.
    pub follower_budget: f64,
    /// How far behind the leader a follower tries to stay.
    pub follow_distance: f64,
    /// How far back a leader's trail is remembered, in tiles.
    pub trail_length: f64,
    pub rules: MovementRules,
    pub walk: WalkRules,
}

impl Default for PartyOptions {
    fn default() -> Self {
        PartyOptions { combat_reach: DEFAULT_BAND_TILES.close, move_budget: f64::INFINITY, follower_budget: 60.0, follow_distance: 1.0, trail_length: 24.0, rules: DEFAULT_MOVEMENT, walk: DEFAULT_WALK }
    }
}

/// A walk: the tiles the pathfinder took, and the line the creature crosses - and, cut short, the rest of it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Walk {
    pub path: Vec<i32>,
    pub route: Vec<Spot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beyond: Option<Vec<Spot>>,
}

/// What a walk may be asked for (`WalkOptions`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WalkOptions {
    pub in_combat: bool,
    pub budget: Option<f64>,
    /// The spot aimed at within the destination.
    pub at: Option<Spot>,
    /// Where the walk begins, when that is not where the document has them: part-way through another.
    pub from: Option<Spot>,
    /// A circle the whole walk must stay inside.
    pub within: Option<Circle>,
    /// As far as the allowance goes, rather than not at all.
    pub short: bool,
}

/// The ground a member's movement covers (`covered`): what the count of squares reaches, and what the
/// straighter line reaches beyond it; or, inside a circle, only what stays in it.
#[derive(Clone, Debug)]
pub enum Coverage {
    Counted(ReachableField),
    Wider { counted: ReachableField, wide: ReachableField, more: Vec<i32>, allowance: f64 },
    Inside { all: ReachableField, inside: Vec<i32> },
}

impl Coverage {
    pub fn start(&self) -> i32 {
        match self {
            Coverage::Counted(f) | Coverage::Wider { counted: f, .. } | Coverage::Inside { all: f, .. } => f.start,
        }
    }
    pub fn budget(&self) -> f64 {
        match self {
            Coverage::Counted(f) | Coverage::Inside { all: f, .. } => f.budget,
            Coverage::Wider { allowance, .. } => *allowance,
        }
    }
    pub fn cost_to(&self, tile: i32) -> f64 {
        match self {
            Coverage::Counted(f) => f.cost_to(tile),
            Coverage::Wider { counted, more, allowance, .. } => {
                if more.contains(&tile) {
                    *allowance
                } else {
                    counted.cost_to(tile)
                }
            }
            Coverage::Inside { all, inside } => {
                if inside.contains(&tile) {
                    all.cost_to(tile)
                } else {
                    f64::INFINITY
                }
            }
        }
    }
    pub fn can_reach(&self, tile: i32) -> bool {
        match self {
            Coverage::Counted(f) => f.can_reach(tile),
            Coverage::Wider { counted, more, .. } => more.contains(&tile) || counted.can_reach(tile),
            Coverage::Inside { inside, .. } => inside.contains(&tile),
        }
    }
    pub fn came_from(&self, tile: i32) -> i32 {
        match self {
            Coverage::Counted(f) | Coverage::Inside { all: f, .. } | Coverage::Wider { wide: f, .. } => f.came_from(tile),
        }
    }
    /// Every tile covered: what the count reaches, cheapest first, then what the line adds.
    pub fn tiles(&self) -> Vec<i32> {
        match self {
            Coverage::Counted(f) => f.tiles(),
            Coverage::Wider { counted, more, .. } => counted.tiles().into_iter().chain(more.iter().copied()).collect(),
            Coverage::Inside { inside, .. } => inside.clone(),
        }
    }
}

fn distance(a: Spot, b: Spot) -> f64 {
    js::hypot(a.x - b.x, a.y - b.y)
}

/// The party in a scene: its selection, order, groups, the members held, and each leader's trail.
#[derive(Clone, Debug)]
pub struct Party {
    options: PartyOptions,
    selected: Option<String>,
    /// Each member's group; everybody not named is in group 0, the whole party.
    groups: HashMap<String, u32>,
    next_group: u32,
    held: HashSet<String>,
    /// The order the party is read in, once somebody has been moved in it; scene order until then.
    order: Vec<String>,
    /// The ground each leader has lately covered, newest point first.
    trails: HashMap<String, Vec<Spot>>,
}

impl Party {
    pub fn new(state: &SceneState, options: PartyOptions) -> Self {
        let mut party = Party { options, selected: None, groups: HashMap::new(), next_group: 1, held: HashSet::new(), order: Vec::new(), trails: HashMap::new() };
        party.selected = party.members(state).into_iter().next();
        party
    }

    /// Walk by other rules from here on.
    pub fn set_rules(&mut self, rules: MovementRules) {
        self.options.rules = rules;
    }

    pub fn options(&self) -> &PartyOptions {
        &self.options
    }

    // ---- who is in it --------------------------------------------------------------------------------

    /// Every member, in the party's order: as arranged, and in scene order for anyone not named.
    pub fn members(&self, state: &SceneState) -> Vec<String> {
        let mut ids: Vec<String> = state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
        let scene: HashMap<String, usize> = ids.iter().enumerate().map(|(i, id)| (id.clone(), i)).collect();
        let rank = |id: &String| self.order.iter().position(|o| o == id).unwrap_or(self.order.len() + scene[id]);
        ids.sort_by_key(rank);
        ids
    }

    /// Members still standing, in the party's order.
    pub fn living(&self, state: &SceneState) -> Vec<String> {
        self.members(state).into_iter().filter(|id| state.entity(id).is_some_and(|e| e.alive)).collect()
    }

    /// Put a member before another in the party's order, or last with nobody named. False when nothing moves.
    pub fn arrange(&mut self, state: &SceneState, id: &str, before: Option<&str>) -> bool {
        let members = self.members(state);
        if !members.iter().any(|m| m == id) || before.is_some_and(|b| !members.iter().any(|m| m == b)) || before == Some(id) {
            return false;
        }
        let mut order: Vec<String> = members.iter().filter(|m| *m != id).cloned().collect();
        let at = match before {
            None => order.len(),
            Some(b) => order.iter().position(|m| m == b).expect("a member"),
        };
        order.insert(at, id.to_string());
        if order == members {
            return false;
        }
        self.order = order;
        true
    }

    pub fn selected(&self) -> Option<&str> {
        self.selected.as_deref()
    }

    /// Select a member; false for anyone who is not one.
    pub fn select(&mut self, state: &SceneState, id: &str) -> bool {
        if !state.entity(id).is_some_and(|e| e.faction == Faction::Party) {
            return false;
        }
        self.selected = Some(id.to_string());
        true
    }

    /// The next living member, wrapping: the Tab key. Nothing when nobody is standing.
    pub fn select_next(&mut self, state: &SceneState) -> Option<String> {
        let living = self.living(state);
        if living.is_empty() {
            return None;
        }
        let at = self.selected.as_ref().and_then(|s| living.iter().position(|l| l == s)).map_or(-1, |i| i as i64);
        self.selected = Some(living[((at + 1) as usize) % living.len()].clone());
        self.selected.clone()
    }

    // ---- who walks with whom -------------------------------------------------------------------------

    fn group_index(&self, state: &SceneState, id: &str) -> Option<u32> {
        state.entity(id).filter(|e| e.faction == Faction::Party)?;
        Some(self.groups.get(id).copied().unwrap_or(0))
    }

    /// The members who walk with this one, themselves included, in the party's order.
    pub fn group_of(&self, state: &SceneState, id: &str) -> Vec<String> {
        let Some(group) = self.group_index(state, id) else { return Vec::new() };
        self.members(state).into_iter().filter(|other| self.group_index(state, other) == Some(group)).collect()
    }

    /// Whether two members walk together.
    pub fn linked(&self, state: &SceneState, id: &str, with: &str) -> bool {
        let group = self.group_index(state, id);
        group.is_some() && group == self.group_index(state, with)
    }

    /// A member in a group of their own. False when they already walk alone, or are no member.
    pub fn unlink(&mut self, state: &SceneState, id: &str) -> bool {
        if self.group_index(state, id).is_none() || self.group_of(state, id).len() == 1 {
            return false;
        }
        let left = self.group_of(state, id);
        self.groups.insert(id.to_string(), self.next_group);
        self.next_group += 1;
        self.close_ranks(state, id, &left);
        true
    }

    /// A member walking with another's group. False when they already do, or either is no member.
    pub fn link(&mut self, state: &SceneState, id: &str, with: &str) -> bool {
        let Some(group) = self.group_index(state, with) else { return false };
        if self.group_index(state, id).is_none() || id == with || self.linked(state, id, with) {
            return false;
        }
        let left = self.group_of(state, id);
        self.groups.insert(id.to_string(), group);
        self.close_ranks(state, id, &left);
        true
    }

    /// Somebody leaving from the middle of a group goes above it, so the rest stay side by side.
    fn close_ranks(&mut self, state: &SceneState, id: &str, left: &[String]) {
        let rest: Vec<&String> = left.iter().filter(|other| *other != id).collect();
        if rest.len() < 2 {
            return;
        }
        let order = self.members(state);
        let place = |who: &str| order.iter().position(|o| o == who);
        let at = place(id);
        let above = rest.iter().any(|other| place(other) < at);
        let below = rest.iter().any(|other| place(other) > at);
        if above && below {
            let first = rest[0].clone();
            self.arrange(state, id, Some(&first));
        }
    }

    /// Whether a member can be given an order: a member, standing, and not held.
    pub fn can_command(&self, state: &SceneState, id: Option<&str>) -> bool {
        let Some(id) = id else { return false };
        state.entity(id).is_some_and(|e| e.faction == Faction::Party && e.alive) && !self.held.contains(id)
    }

    /// Hold a member where they are: no orders, and they do not follow. False for anyone who is no member.
    pub fn hold(&mut self, state: &SceneState, id: &str) -> bool {
        if self.group_index(state, id).is_none() {
            return false;
        }
        self.held.insert(id.to_string());
        true
    }

    /// Let a held member go. Whether they were held.
    pub fn release(&mut self, id: &str) -> bool {
        self.held.remove(id)
    }

    pub fn is_held(&self, id: &str) -> bool {
        self.held.contains(id)
    }

    // ---- where a member can go -----------------------------------------------------------------------

    /// What one member must keep clear of: in a fight everybody, out of one everybody but the party.
    pub fn blocked(&self, state: &SceneState, id: &str, in_combat: bool) -> impl Fn(i32) -> bool + 'static {
        state.blocked_for(id, if in_combat { &[] } else { &PARTY_PASSES_THROUGH })
    }

    /// How much movement a walk has: Close range in a fight, no count out of one, or what the caller says.
    fn allowance(&self, in_combat: bool, budget: Option<f64>) -> f64 {
        budget.unwrap_or(if in_combat { self.options.combat_reach } else { self.options.move_budget })
    }

    /// Tiles a member can reach: the Close-range disc in a fight, everywhere the floor goes out of one.
    pub fn reachable(&self, state: &SceneState, id: &str, in_combat: bool, budget: Option<f64>, from: Option<Spot>) -> ReachableField {
        let start = match from {
            None => state.entity(id).map_or(NO_TILE, |e| e.tile),
            Some(spot) => state.grid.tile_at_spot(spot.x, spot.y),
        };
        let blocked = self.blocked(state, id, in_combat);
        Pathfinder::new(&state.grid).reachable(start, self.allowance(in_combat, budget), &self.options.rules, &MovementContext { is_blocked: Some(&blocked), ..MovementContext::default() })
    }

    /// The ground a member's movement covers, for lighting it: every tile the count reaches, and every tile
    /// whose centre the straighter line reaches though the count says not. Inside a circle, only the
    /// tiles a walk reaches without leaving it.
    pub fn covered(&self, state: &SceneState, id: &str, in_combat: bool, budget: Option<f64>, within: Option<Circle>) -> Coverage {
        let entity = state.entity(id);
        if let Some(circle) = within {
            let budget = Some(budget.unwrap_or(f64::INFINITY));
            let all = self.reachable(state, id, in_combat, budget, None);
            let asked = WalkOptions { in_combat, budget, within, ..WalkOptions::default() };
            let inside = all
                .tiles()
                .into_iter()
                .filter(|&tile| inside_circle(state.grid.spot_of(tile), circle) && (entity.is_none_or(|e| tile == e.tile) || self.plan_walk(state, id, tile, &asked).is_some()))
                .collect();
            return Coverage::Inside { all, inside };
        }
        let counted = self.reachable(state, id, in_combat, budget, None);
        let allowance = counted.budget;
        let Some(entity) = entity.filter(|e| allowance.is_finite() && state.grid.is_tile(e.tile)) else { return Coverage::Counted(counted) };
        let blocked = self.blocked(state, id, in_combat);
        let wide = Pathfinder::new(&state.grid).reachable(entity.tile, allowance * WIDER + ROUND_THE_ENDS, &self.options.rules, &MovementContext { is_blocked: Some(&blocked), ..MovementContext::default() });
        let mut more = Vec::new();
        for tile in wide.tiles() {
            if counted.can_reach(tile) {
                continue;
            }
            let Some(path) = trace_path(&wide, tile) else { continue };
            let route = self.line_along(state, id, &path, entity.at, state.grid.spot_of(tile), in_combat);
            if line_cost(&state.grid, &route) <= allowance + 1e-9 {
                more.push(tile);
            }
        }
        if more.is_empty() {
            return Coverage::Counted(counted);
        }
        Coverage::Wider { counted, wide, more, allowance }
    }

    // ---- walking -------------------------------------------------------------------------------------

    /// Walk a member to a tile; the path taken, or nothing when it is out of reach.
    pub fn move_to(&mut self, state: &mut SceneState, id: &str, destination: i32, options: &WalkOptions) -> Option<Vec<i32>> {
        self.walk_to(state, id, destination, options).map(|walk| walk.path)
    }

    /// Walk a member to a tile, and to a spot in it when one is aimed at. The state moves at once.
    pub fn walk_to(&mut self, state: &mut SceneState, id: &str, destination: i32, options: &WalkOptions) -> Option<Walk> {
        let walk = self.plan_walk(state, id, destination, options)?;
        let end = *walk.route.last().expect("a route");
        state.place_entity(id, end.x, end.y).expect("a member");
        Some(walk)
    }

    /// The walk `walk_to` would make, without making it.
    pub fn plan_walk(&self, state: &SceneState, id: &str, destination: i32, options: &WalkOptions) -> Option<Walk> {
        if !self.can_command(state, Some(id)) {
            return None;
        }
        let entity = state.entity(id)?;
        let fighting = options.in_combat;
        let allowance = self.allowance(fighting, options.budget);
        let stood = options.from.unwrap_or(entity.at);
        let stood_on = match options.from {
            None => entity.tile,
            Some(spot) => state.grid.tile_at_spot(spot.x, spot.y),
        };
        if destination == stood_on {
            return self.shuffle(state, id, options.at, fighting, options.within, options.from);
        }
        let field = self.reachable(state, id, fighting, Some(f64::INFINITY), options.from);
        if !field.can_reach(destination) {
            return None;
        }
        let counted = field.cost_to(destination);
        let path = trace_path(&field, destination).filter(|p| p.len() >= 2)?;
        let end = self.settle(state, id, destination, options.at, fighting);
        let route = self.line_along(state, id, &path, stood, end, fighting);
        let covered = counted <= allowance || line_cost(&state.grid, &route) <= allowance + 1e-9;
        let inside = match options.within {
            None => true,
            Some(circle) => route.iter().all(|&spot| inside_circle(spot, circle)) && distance_inside(&route, circle) >= line_length(&route) - 1e-9,
        };
        if covered && inside {
            return Some(Walk { path, route, beyond: None });
        }
        if !options.short {
            return None;
        }
        // Cut at whichever runs out first: the allowance along the line, or the circle's edge.
        let by_allowance = if covered { f64::INFINITY } else { distance_within(&state.grid, &route, allowance) };
        let by_circle = if inside { f64::INFINITY } else { distance_inside(&route, options.within.expect("a circle")) };
        self.cut_short(state, id, &path, &route, js::min(by_allowance, by_circle), fighting)
    }

    /// A step within the tile they are in, straight there when a body can cross it and stand at the end.
    fn shuffle(&self, state: &SceneState, id: &str, aimed: Option<Spot>, fighting: bool, within: Option<Circle>, stood: Option<Spot>) -> Option<Walk> {
        let entity = state.entity(id)?;
        let start = stood.unwrap_or(entity.at);
        let on = match stood {
            None => entity.tile,
            Some(spot) => state.grid.tile_at_spot(spot.x, spot.y),
        };
        let aimed = aimed.filter(|a| state.grid.tile_at_spot(a.x, a.y) == on)?;
        let end = self.settle(state, id, on, Some(aimed), fighting);
        if within.is_some_and(|circle| !inside_circle(end, circle)) {
            return None;
        }
        if distance(end, start) < LEAST_STEP {
            return None;
        }
        let blocked = self.blocked(state, id, fighting);
        if !segment_clear(&state.grid, start, end, &blocked, self.walk_rules()) {
            return None;
        }
        Some(Walk { path: vec![on], route: vec![start, end], beyond: None })
    }

    /// Where everybody else stands, whom a walk must end clear of.
    fn others(state: &SceneState, id: &str) -> Vec<Spot> {
        state.all_entities().iter().filter(|e| e.id != id && e.alive && e.tile != NO_TILE).map(|e| e.at).collect()
    }

    /// A walk the allowance does not cover, as far as it goes: cut where the movement runs out, and backed
    /// up to the first place a body can stand clear of everybody. Nothing when that is where they are.
    fn cut_short(&self, state: &SceneState, id: &str, path: &[i32], route: &[Spot], reach: f64, fighting: bool) -> Option<Walk> {
        let blocked = self.blocked(state, id, fighting);
        let rules = self.walk_rules();
        let others = Self::others(state, id);
        let clear = |spot: Spot| can_stand_at(&state.grid, spot, &blocked, rules) && others.iter().all(|&o| distance(o, spot) >= 2.0 * rules.radius);
        let mut reach = reach;
        while reach > BACK_OFF && !clear(point_along(route, reach)) {
            reach -= BACK_OFF;
        }
        if reach <= BACK_OFF {
            return None;
        }
        let (within, beyond) = split_line(route, reach);
        let end = *within.last().expect("a line");
        let last = state.grid.tile_at_spot(end.x, end.y);
        // The tiles as far as the one the walk ends in: the path's own, up to whichever is nearest the end.
        let (mut nearest, mut best) = (0, f64::INFINITY);
        for (i, &tile) in path.iter().enumerate() {
            let away = js::hypot(f64::from(state.grid.x_of(tile)) - end.x, f64::from(state.grid.y_of(tile)) - end.y);
            if away < best {
                (nearest, best) = (i, away);
            }
        }
        let mut walked = path[..=nearest].to_vec();
        if walked.last() != Some(&last) {
            walked.push(last);
        }
        if walked.len() < 2 {
            return None;
        }
        Some(Walk { path: walked, route: within, beyond: Some(beyond) })
    }

    /// Where a walk to a tile ends, given the spot it was aimed at, if any.
    fn settle(&self, state: &SceneState, id: &str, tile: i32, aimed: Option<Spot>, fighting: bool) -> Spot {
        let Some(aimed) = aimed else { return state.grid.spot_of(tile) };
        let blocked = self.blocked(state, id, fighting);
        settle_end(&state.grid, tile, aimed, &blocked, &Self::others(state, id), self.walk_rules())
    }

    /// The line a member crosses along a path, from where it stood to where it ends.
    pub fn line_along(&self, state: &SceneState, id: &str, path: &[i32], start: Spot, end: Spot, fighting: bool) -> Vec<Spot> {
        let blocked = self.blocked(state, id, fighting);
        smooth_path(&state.grid, path, &blocked, self.walk_rules(), Some(start), Some(end))
    }

    fn walk_rules(&self) -> WalkRules {
        WalkRules { max_step_height: self.options.rules.max_step_height, ..self.options.walk }
    }

    // ---- following -----------------------------------------------------------------------------------

    /// Where the rest of the party should stand after the leader has moved, tile by tile: along the
    /// leader's path nearest-first, and failing that the free tile nearest the leader. In the order they
    /// were placed.
    pub fn follow_positions(&self, state: &SceneState, leader_id: &str, leader_path: &[i32], already: &[(String, i32)], only: Option<&[EntityState]>) -> Vec<(String, i32)> {
        let mut result = Vec::new();
        let Some(leader) = state.entity(leader_id) else { return result };
        let wanted = match only {
            Some(only) => only.to_vec(),
            None => self.followers_of(state, leader_id),
        };
        let followers: Vec<EntityState> = wanted.into_iter().filter(|e| !already.iter().any(|(id, _)| *id == e.id)).collect();
        if followers.is_empty() {
            return result;
        }
        let skip = js::trunc(self.options.follow_distance).max(0.0) as usize;
        let trail: Vec<i32> = leader_path.iter().rev().skip(skip).copied().collect();
        let mut taken: HashSet<i32> = HashSet::from([leader.tile]);
        taken.extend(already.iter().map(|(_, tile)| *tile));
        taken.extend(self.left_standing(state, leader_id).iter().map(|e| e.tile));
        for follower in followers {
            let spot = self.claim_from(state, &trail, &taken, &follower.id).or_else(|| self.claim_near(state, leader.tile, &taken, &follower.id));
            let Some(spot) = spot.filter(|&s| s != NO_TILE) else { continue };
            taken.insert(spot);
            result.push((follower.id.clone(), spot));
        }
        result
    }

    /// Every follower moved to where they should stand behind the leader: the tile each ends on.
    pub fn follow(&mut self, state: &mut SceneState, leader_id: &str, leader_path: &[i32], route: Option<&[Spot]>) -> Vec<(String, i32)> {
        self.follow_along(state, leader_id, leader_path, route).into_iter().map(|(id, walk)| (id, *walk.path.last().expect("a path"))).collect()
    }

    /// `follow`, handing back each follower's own walk. Each walks down the leader's trail a spacing
    /// further back than the one in front; whoever the trail cannot place keeps their ground, unless the
    /// leader has walked away from them or into them.
    pub fn follow_along(&mut self, state: &mut SceneState, leader_id: &str, leader_path: &[i32], route: Option<&[Spot]>) -> Vec<(String, Walk)> {
        let walked: Vec<Spot> = match route {
            Some(route) => route.to_vec(),
            None => leader_path.iter().map(|&tile| state.grid.spot_of(tile)).collect(),
        };
        let trail = self.remember(state, leader_id, &walked);
        let along = self.down_the_trail(state, leader_id, &trail);
        let Some(leader) = state.entity(leader_id).cloned() else { return Vec::new() };
        let underfoot = 2.0 * self.options.walk.radius + 0.05;
        let adrift: Vec<EntityState> = self
            .followers_of(state, leader_id)
            .into_iter()
            .filter(|e| !along.iter().any(|(id, _)| *id == e.id) && (distance(e.at, leader.at) < underfoot || state.grid.euclidean_distance(e.tile, leader.tile) > self.options.trail_length))
            .collect();
        let already: Vec<(String, i32)> = along.iter().map(|(id, (tile, _))| (id.clone(), *tile)).collect();
        let positions = self.follow_positions(state, leader_id, leader_path, &already, Some(&adrift));
        let goals: Vec<(String, i32, Spot)> = positions.into_iter().map(|(id, tile)| (id, tile, state.grid.spot_of(tile))).chain(along.into_iter().map(|(id, (tile, at))| (id, tile, at))).collect();

        let mut walks = Vec::new();
        for (id, tile, at) in goals {
            let Some(follower) = state.entity(&id).cloned() else { continue };
            let blocked = self.blocked(state, &id, false);
            let field = Pathfinder::new(&state.grid).reachable(follower.tile, f64::INFINITY, &self.options.rules, &MovementContext { is_blocked: Some(&blocked), ..MovementContext::default() });
            let path = trace_path(&field, tile).unwrap_or_else(|| vec![follower.tile, tile]);
            let line = smooth_path(&state.grid, &path, &blocked, self.walk_rules(), Some(follower.at), Some(at));
            state.move_entity(&id, tile).expect("a member");
            state.place_entity(&id, at.x, at.y).expect("a member");
            walks.push((id, Walk { path, route: line, beyond: None }));
        }
        walks
    }

    /// Stop a walk where the figure has got to: they stand here now, and the trail forgets the ground past it.
    pub fn land_at(&mut self, state: &mut SceneState, id: &str, at: Spot) -> bool {
        if state.entity(id).is_none() {
            return false;
        }
        let tile = state.grid.tile_at_spot(at.x, at.y);
        if !state.grid.is_tile(tile) || !state.grid.is_passable(tile) {
            return false;
        }
        state.place_entity(id, at.x, at.y).expect("an entity");
        if let Some(trail) = self.trails.get_mut(id).filter(|t| !t.is_empty()) {
            let (mut nearest, mut away) = (0, f64::INFINITY);
            for (i, &spot) in trail.iter().enumerate() {
                let gap = distance(spot, at);
                if gap < away {
                    (away, nearest) = (gap, i);
                }
            }
            trail.drain(..nearest);
            if trail.is_empty() || distance(trail[0], at) > 1e-6 {
                trail.insert(0, at);
            }
        }
        true
    }

    /// Take in the ground the leader has just covered, and hand back their trail, newest first. A leader
    /// who has jumped somewhere starts a fresh one.
    fn remember(&mut self, state: &SceneState, leader_id: &str, route: &[Spot]) -> Vec<Spot> {
        let Some(leader) = state.entity(leader_id) else { return Vec::new() };
        let mut trail = self.trails.remove(leader_id).unwrap_or_default();
        let walked: Vec<Spot> = if route.len() < 2 { vec![leader.at] } else { route.to_vec() };
        if trail.first().is_none_or(|&head| distance(head, walked[0]) > ROUND_THE_ENDS) {
            trail.clear();
        }
        // Newest first, and never two points in the same place.
        for &spot in &walked {
            if trail.first().is_some_and(|&first| distance(first, spot) < 1e-6) {
                continue;
            }
            trail.insert(0, spot);
        }
        let mut gone = 0.0;
        for i in 0..trail.len().saturating_sub(1) {
            gone += js::hypot(trail[i + 1].x - trail[i].x, trail[i + 1].y - trail[i].y);
            if gone > self.options.trail_length {
                trail.truncate(i + 2);
                break;
            }
        }
        self.trails.insert(leader_id.to_string(), trail.clone());
        trail
    }

    /// Where each follower stands on the trail: a spacing back for the first, two for the next, sliding
    /// past anywhere a body does not fit or that is somebody's. One the trail does not reach is left out.
    fn down_the_trail(&self, state: &SceneState, leader_id: &str, trail: &[Spot]) -> Vec<(String, (i32, Spot))> {
        let mut result = Vec::new();
        let Some(leader) = state.entity(leader_id) else { return result };
        if trail.len() < 2 {
            return result;
        }
        let radius = self.options.walk.radius;
        let spacing = js::max(self.options.follow_distance, 2.0 * radius + 0.05);
        let standing = self.left_standing(state, leader_id);
        let mut taken: HashSet<i32> = HashSet::from([leader.tile]);
        taken.extend(standing.iter().map(|e| e.tile));
        let mut back = spacing;
        for follower in self.followers_of(state, leader_id) {
            let blocked = self.blocked(state, &follower.id, false);
            let mut found = None;
            for slide in 0..9 {
                let Some(at) = back_along(trail, back + f64::from(slide) * 0.2) else { break };
                let tile = state.grid.tile_at_spot(at.x, at.y);
                if taken.contains(&tile) || !can_stand_at(&state.grid, at, &blocked, self.walk_rules()) {
                    continue;
                }
                if standing.iter().any(|e| distance(e.at, at) < 2.0 * radius) {
                    continue;
                }
                found = Some((tile, at));
                break;
            }
            back += spacing;
            let Some(found) = found else { continue };
            taken.insert(found.0);
            result.push((follower.id.clone(), found));
        }
        result
    }

    /// The living members of the leader's group other than the leader and those held, nearest the leader
    /// first, then by id.
    fn followers_of(&self, state: &SceneState, leader_id: &str) -> Vec<EntityState> {
        let Some(leader) = state.entity(leader_id) else { return Vec::new() };
        let mut followers: Vec<EntityState> = state
            .entities_of(Faction::Party)
            .filter(|e| e.alive && e.id != leader_id && !self.held.contains(&e.id) && self.linked(state, leader_id, &e.id))
            .cloned()
            .collect();
        followers.sort_by(|a, b| {
            let near = |e: &EntityState| state.grid.manhattan_distance(e.tile, leader.tile);
            near(a).cmp(&near(b)).then_with(|| js::locale_cmp(&a.id, &b.id))
        });
        followers
    }

    /// The living members not walking with this leader: standing where they are, not to be stood on.
    fn left_standing(&self, state: &SceneState, leader_id: &str) -> Vec<EntityState> {
        state.entities_of(Faction::Party).filter(|e| e.alive && e.tile != NO_TILE && !self.linked(state, leader_id, &e.id)).cloned().collect()
    }

    fn claim_from(&self, state: &SceneState, trail: &[i32], taken: &HashSet<i32>, mover: &str) -> Option<i32> {
        let blocked = state.blocked_for(mover, &PARTY_PASSES_THROUGH);
        trail.iter().copied().find(|&tile| !taken.contains(&tile) && state.grid.is_passable(tile) && !blocked(tile))
    }

    /// The nearest free tile to the leader, for a follower with no trail left.
    fn claim_near(&self, state: &SceneState, leader_tile: i32, taken: &HashSet<i32>, mover: &str) -> Option<i32> {
        let blocked = state.blocked_for(mover, &PARTY_PASSES_THROUGH);
        let field = Pathfinder::new(&state.grid).reachable(leader_tile, self.options.follower_budget, &self.options.rules, &MovementContext { is_blocked: Some(&blocked), ..MovementContext::default() });
        let mut best = None;
        let mut best_cost = f64::INFINITY;
        for tile in field.tiles() {
            if tile == leader_tile || taken.contains(&tile) {
                continue;
            }
            let cost = field.cost_to(tile);
            if cost < best_cost {
                best_cost = cost;
                best = Some(tile);
            }
        }
        best
    }

    /// Each leader's trail as it stands, newest point first: for a save, or a replay to hold to.
    pub fn trail(&self, leader_id: &str) -> &[Spot] {
        self.trails.get(leader_id).map_or(&[], Vec::as_slice)
    }
}

/// The point this far back down a trail, or nothing where the trail does not reach that far.
fn back_along(trail: &[Spot], back: f64) -> Option<Spot> {
    let mut gone = 0.0;
    for pair in trail.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let leg = js::hypot(b.x - a.x, b.y - a.y);
        if gone + leg >= back {
            let t = if leg <= 1e-9 { 0.0 } else { (back - gone) / leg };
            return Some(Spot { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
        gone += leg;
    }
    None
}
