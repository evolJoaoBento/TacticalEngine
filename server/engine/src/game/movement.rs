//! Walking (`src/game/movement.ts`, `game/circle.ts`, `game/arrival.ts`, and `moveSelectedTo`): where a click
//! takes the selected member and the walk it makes - the followers out of a fight, a trigger stopping the
//! walk where it fires and beginning its fight - the circle a fighter moves freely in and the wider one a
//! push would open, closing on a thing to use it or a creature to talk to or strike, and the lines a view
//! draws before the click.
//!
//! Headless there is nobody drawing the walk, so what it wakes begins at once: the TypeScript's `ambush` and
//! `approaching`, which hold a fight or a use until the tokens stop, are the client's. So is steering, which
//! turns a held button into a stream of clicks at the pace a token is drawn walking. A push past the circle
//! and a jump are the rolled moves (`leap`).

use super::log::{name_of, note};
use super::play::{UseOutcome, DEMO_REACH};
use super::rules::DEMO_BAND_TILES;
use super::session::{Approach, Session};
use crate::character::sheet::{attack_profile, Hand};
use crate::combat::targeting::{evaluate_target, Standings, TargetingOptions};
use crate::grid::pathfinding::{Pathfinder, ReachableField};
use crate::grid::tile_grid::{Spot, TileGrid, NO_TILE};
use crate::grid::walk::{inside_circle, Circle};
use crate::js;
use crate::rules::range::{max_span_for_band, RangeBand};
use crate::scene::party::{Coverage, WalkOptions};
use crate::script::runner::ScriptWorld;
use serde_json::json;

/// What a move came to: whether anybody moved, the tiles walked, the encounter it woke.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct MoveResult {
    pub moved: bool,
    pub path: Vec<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub triggered: Option<String>,
    /// A roll stands between the click and the walk: it is asked, and the walk waits on it.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pending: bool,
}

/// The circle a fighter moves freely in: where it is drawn from, its band, and how far that is in tiles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MovementCircle {
    pub anchor: Spot,
    pub band: RangeBand,
    pub radius: f64,
}

impl MovementCircle {
    pub fn circle(&self) -> Circle {
        Circle { anchor: self.anchor, radius: self.radius }
    }
}

/// Where a click takes the selected one (`MoveAim`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MoveAim {
    pub goal: i32,
    pub aim: Option<Spot>,
    /// Nowhere to go from here: the click does nothing.
    pub stays: bool,
    pub short: bool,
    /// Past one move and within a run: Movement Under Pressure.
    pub run: bool,
}

const NOWHERE: MoveAim = MoveAim { goal: NO_TILE, aim: None, stays: true, short: false, run: false };

/// The line a click would walk: what is walked this move, and what lies beyond it (`WalkPreview`).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct WalkPreview {
    pub route: Vec<Spot>,
    pub beyond: Vec<Spot>,
    /// Whether `beyond` is a run a roll would get there on.
    pub run: bool,
}

/// The spot within a tile nearest to one aimed at outside it (`clampInto`).
pub fn clamp_into(grid: &TileGrid, aimed: Spot, tile: i32) -> Spot {
    let (x, y) = (f64::from(grid.x_of(tile)), f64::from(grid.y_of(tile)));
    Spot { x: js::min(x + 0.49, js::max(x - 0.49, aimed.x)), y: js::min(y + 0.49, js::max(y - 0.49, aimed.y)) }
}

/// Tiles apart, counting a diagonal as one step.
fn chebyshev(grid: &TileGrid, a: i32, b: i32) -> i32 {
    (grid.x_of(a) - grid.x_of(b)).abs().max((grid.y_of(a) - grid.y_of(b)).abs())
}

/// The reachable tile nearest a spot, as the crow flies, the lower tile on a tie (`nearestReachable`, the
/// way both its callers ask it: with no tile to walk towards).
fn nearest_reachable(grid: &TileGrid, field: &ReachableField, aimed: Spot) -> i32 {
    let (mut best, mut best_distance) = (NO_TILE, f64::INFINITY);
    for tile in field.tiles() {
        let distance = js::hypot(f64::from(grid.x_of(tile)) - aimed.x, f64::from(grid.y_of(tile)) - aimed.y);
        if distance < best_distance || (distance == best_distance && tile < best) {
            (best, best_distance) = (tile, distance);
        }
    }
    best
}

impl Session {
    fn can_act(&self, id: &str) -> bool {
        self.encounter.as_ref().is_some_and(|e| e.can_act(&self.world.state, id))
    }

    // ---- the circle ------------------------------------------------------------------------------------

    /// The circle a fighter moves freely in right now (`movementCircle`): nothing out of a fight. Standing
    /// outside it - shoved, or put somewhere by a script - the circle is drawn where they are now.
    pub fn movement_circle(&mut self, id: &str) -> Option<MovementCircle> {
        if !self.in_combat() {
            return None;
        }
        let state = &self.world.state;
        let encounter = self.encounter.as_mut()?;
        let mut circle = encounter.circle_of(state, id)?;
        let radius = max_span_for_band(circle.band, &DEMO_BAND_TILES);
        if state.entity(id).is_some_and(|e| js::hypot(e.at.x - circle.anchor.x, e.at.y - circle.anchor.y) > radius + 1e-6) {
            encounter.reanchor(state, id);
            circle = encounter.circle_of(state, id)?;
        }
        Some(MovementCircle { anchor: circle.anchor, band: circle.band, radius })
    }

    /// How a fighter's walk is asked for (`fightWalk`): inside their circle, and no count of squares.
    pub fn fight_walk(&mut self, id: &str) -> WalkOptions {
        let within = self.movement_circle(id).map(|c| c.circle());
        WalkOptions { in_combat: true, budget: Some(f64::INFINITY), within, ..WalkOptions::default() }
    }

    /// The walk options for a member: a fighter's, or anybody's out of a fight.
    fn walk_options(&mut self, id: &str, fighting: bool) -> WalkOptions {
        if fighting {
            self.fight_walk(id)
        } else {
            WalkOptions::default()
        }
    }

    /// The circle a push would open for a fighter (`pushCircle`): one step out from their own, or nothing.
    pub fn push_circle(&mut self, id: &str) -> Option<MovementCircle> {
        let circle = self.movement_circle(id);
        let state = &self.world.state;
        let band = self.encounter.as_mut().and_then(|e| e.push_opens(state, id));
        let (circle, band) = (circle?, band?);
        Some(MovementCircle { anchor: circle.anchor, band, radius: max_span_for_band(band, &DEMO_BAND_TILES) })
    }

    // ---- where they can go -----------------------------------------------------------------------------

    /// Tiles the selected member can reach right now (`reachableTiles`): in a fight the ground inside their
    /// circle, out of one what their movement covers.
    pub fn reachable_tiles(&mut self, budget: Option<f64>) -> Coverage {
        let Some(id) = self.party.selected().map(str::to_string) else {
            let state = &self.world.state;
            return Coverage::Counted(Pathfinder::new(&state.grid).reachable(NO_TILE, 0.0, &self.party.options().rules, &Default::default()));
        };
        let fighting = self.in_combat();
        let mut options = self.walk_options(&id, fighting);
        if budget.is_some() {
            options.budget = budget;
        }
        self.party.covered(&self.world.state, &id, options.in_combat, options.budget, options.within)
    }

    /// The ground a fighter's movement covers, or anybody's reach out of a fight: what the closing walks read.
    fn move_field(&mut self, id: &str, fighting: bool) -> Coverage {
        if fighting {
            let options = self.fight_walk(id);
            self.party.covered(&self.world.state, id, true, options.budget, options.within)
        } else {
            Coverage::Counted(self.party.reachable(&self.world.state, id, false, None, None))
        }
    }

    /// Whether a click past the circle is one a push could reach (`underPressure`): a next step to open, and a
    /// way there at all. Inside the circle, a walk that cannot be made cannot be made.
    pub fn under_pressure(&mut self, id: &str, destination: i32, aimed: Option<Spot>) -> bool {
        let Some(circle) = self.movement_circle(id) else { return false };
        if self.push_circle(id).is_none() {
            return false;
        }
        if inside_circle(aimed.unwrap_or_else(|| self.world.state.grid.spot_of(destination)), circle.circle()) {
            return false;
        }
        self.party.reachable(&self.world.state, id, true, Some(f64::INFINITY), None).can_reach(destination)
    }

    /// Where a click would ask the selected fighter for a roll (`underPressureTiles`): inside the circle a push
    /// would open, outside their own.
    pub fn under_pressure_tiles(&mut self) -> Vec<i32> {
        let Some(id) = self.party.selected().map(str::to_string) else { return Vec::new() };
        let Some(push) = self.push_circle(&id) else { return Vec::new() };
        if !self.can_act(&id) {
            return Vec::new();
        }
        let own = self.fight_walk(&id);
        let inside: Vec<i32> = self.party.covered(&self.world.state, &id, true, own.budget, own.within).tiles();
        self.party.covered(&self.world.state, &id, true, Some(f64::INFINITY), Some(push.circle())).tiles().into_iter().filter(|t| !inside.contains(t)).collect()
    }

    // ---- the walk --------------------------------------------------------------------------------------

    /// The walk a move makes once where it goes is settled (`walkTheMove`): the line crossed, a trigger
    /// stopping it where it fires and beginning its fight, and the followers out of a fight.
    pub fn walk_the_move(&mut self, id: &str, goal: i32, aim: Option<Spot>, fighting: bool, short: bool, budget: Option<f64>) -> MoveResult {
        let Some(stood) = self.world.state.entity(id).map(|e| e.at) else { return MoveResult::default() };
        let mut options = self.walk_options(id, fighting);
        options.short = fighting;
        if budget.is_some() {
            options.budget = budget;
        }
        options.at = aim;
        let walk = self.party.walk_to(&mut self.world.state, id, goal, &options);
        if walk.as_ref().is_some_and(|w| short || w.beyond.is_some()) {
            let name = name_of(self, id);
            note(self, &format!("{name} can go no further without a push."), "combat");
        }
        let Some(walk) = walk else { return MoveResult::default() };
        // Whoever was down is up: getting to their feet is the first of the move.
        if ScriptWorld::clear_condition(&mut self.world, id, "prone") {
            let name = name_of(self, id);
            note(self, &format!("{name} gets up."), if fighting { "combat" } else { "system" });
        }
        // A trigger stops the move where it fired, and the line is cut there too.
        let hit = self.triggers.first_along(&walk.path, &mut self.world.state);
        let path: Vec<i32> = match &hit {
            None => walk.path.clone(),
            Some(hit) => walk.path[..=walk.path.iter().position(|&t| t == hit.tile).expect("on the path")].to_vec(),
        };
        let route = match &hit {
            None => walk.route.clone(),
            Some(hit) => {
                self.world.state.move_entity(id, hit.tile).expect("a member");
                let end = self.world.state.grid.spot_of(hit.tile);
                self.party.line_along(&self.world.state, id, &path, stood, end, fighting)
            }
        };
        self.motions.push(json!({ "id": id, "path": path, "route": route }));
        if !fighting && path.len() > 1 {
            for (follower, along) in self.party.follow_along(&mut self.world.state, id, &path, Some(&route)) {
                self.motions.push(json!({ "id": follower, "path": along.path, "route": along.route }));
            }
        }
        match hit {
            Some(hit) => {
                // What it woke waits for the walkers to be drawn arriving - or, with nobody drawing them, begins now.
                self.ambush = Some(hit.encounter.clone());
                if !self.animated {
                    self.arrive();
                }
                MoveResult { moved: true, path, triggered: Some(hit.encounter), pending: false }
            }
            None => MoveResult { moved: true, path, triggered: None, pending: false },
        }
    }

    /// What a click on the ground means (`aimOfMove`). Beyond reach is not a refusal: out of a fight the walk
    /// goes to the reachable spot nearest the one aimed at; in one, as far along the way as the circle allows -
    /// unless a run would get there.
    pub fn aim_of_move(&mut self, id: &str, destination: i32, aimed: Option<Spot>, fighting: bool) -> MoveAim {
        if fighting {
            let mut options = self.fight_walk(id);
            options.short = true;
            options.at = aimed;
            let walk = self.party.plan_walk(&self.world.state, id, destination, &options);
            let Some(walk) = walk else { return MoveAim { run: self.under_pressure(id, destination, aimed), ..NOWHERE } };
            if walk.beyond.is_none() {
                return MoveAim { goal: destination, aim: aimed, stays: false, short: false, run: false };
            }
            let run = self.under_pressure(id, destination, aimed);
            return MoveAim { goal: destination, aim: aimed, stays: false, short: true, run };
        }
        let state = &self.world.state;
        let field = self.party.reachable(state, id, false, None, None);
        if field.can_reach(destination) {
            return MoveAim { goal: destination, aim: aimed, stays: false, short: false, run: false };
        }
        let nearest = nearest_reachable(&state.grid, &field, aimed.unwrap_or_else(|| state.grid.spot_of(destination)));
        if nearest == NO_TILE || state.entity(id).is_some_and(|e| e.tile == nearest) {
            return NOWHERE;
        }
        MoveAim { goal: nearest, aim: aimed.map(|a| clamp_into(&state.grid, a, nearest)), stays: false, short: false, run: false }
    }

    /// Walk the selected member towards a tile, or a spot in it (`moveSelectedTo`). Out of a fight the rest
    /// follow; in one they move alone, inside their circle.
    pub fn move_selected_to(&mut self, destination: i32, aimed: Option<Spot>) -> Result<MoveResult, String> {
        if self.busy() {
            return Ok(MoveResult::default());
        }
        let Some(id) = self.party.selected().map(str::to_string) else { return Ok(MoveResult::default()) };
        if !self.party.can_command(&self.world.state, Some(&id)) {
            return Ok(MoveResult::default());
        }
        let fighting = self.in_combat();
        if fighting && !self.can_act(&id) {
            return Ok(MoveResult::default());
        }
        let to = self.aim_of_move(&id, destination, aimed, fighting);
        if to.run {
            return self.run_for_it(&id, destination, aimed);
        }
        if to.stays {
            return Ok(MoveResult::default());
        }
        Ok(self.walk_the_move(&id, to.goal, to.aim, fighting, to.short, None))
    }

    /// Walk a member to a tile, the rest of the party behind them out of a fight (`walkSelected`).
    fn walk_selected(&mut self, id: &str, tile: i32, fighting: bool) {
        let options = self.walk_options(id, fighting);
        let walk = self.party.walk_to(&mut self.world.state, id, tile, &options);
        if walk.is_some() && ScriptWorld::clear_condition(&mut self.world, id, "prone") {
            let name = name_of(self, id);
            note(self, &format!("{name} gets up."), if fighting { "combat" } else { "system" });
        }
        let Some(walk) = walk else { return };
        self.motions.push(json!({ "id": id, "path": walk.path, "route": walk.route }));
        if !fighting && walk.path.len() > 1 {
            for (follower, along) in self.party.follow_along(&mut self.world.state, id, &walk.path, Some(&walk.route)) {
                self.motions.push(json!({ "id": follower, "path": along.path, "route": along.route }));
            }
        }
    }

    // ---- closing in --------------------------------------------------------------------------------------

    /// Where a creature would measure from in a tile (`standingIn`): where it stands, in its own; the centre
    /// in any other.
    pub(super) fn standing_in(&self, id: &str, tile: i32) -> Spot {
        match self.world.state.entity(id) {
            Some(e) if e.tile == tile => e.at,
            _ => self.world.state.grid.spot_of(tile),
        }
    }

    /// The tile a member would strike a target from (`strikeTile`): their own when already in reach, else the
    /// cheapest this move reaches that the weapon reaches from; `NO_TILE` when none is.
    pub fn strike_tile(&mut self, id: &str, target: &str, range: RangeBand) -> i32 {
        let (Some(attacker), Some(target)) = (self.world.state.entity(id).cloned(), self.world.state.entity(target).cloned()) else { return NO_TILE };
        let in_reach = |session: &Session, tile: i32| {
            let options = TargetingOptions { band_tiles: Some(DEMO_BAND_TILES), at: Some(Standings { attacker: session.standing_in(id, tile), target: target.at }), ..TargetingOptions::default() };
            evaluate_target(&session.world.state.grid, tile, target.tile, range, &options).refusal.is_none()
        };
        if in_reach(self, attacker.tile) {
            return attacker.tile;
        }
        let fighting = self.in_combat();
        let field = self.move_field(id, fighting);
        let (mut best, mut best_cost) = (NO_TILE, f64::INFINITY);
        for tile in field.tiles() {
            if tile == attacker.tile || !in_reach(self, tile) {
                continue;
            }
            let cost = field.cost_to(tile);
            if cost < best_cost || (cost == best_cost && tile < best) {
                (best, best_cost) = (tile, cost);
            }
        }
        best
    }

    /// Bring a member into reach of a target (`closeToStrike`): `inReach` already, `closed` once walked to
    /// where the reach is, or `short` - as near as the circle allows, and no further.
    pub fn close_to_strike(&mut self, id: &str, target: &str, range: RangeBand) -> &'static str {
        let (Some(attacker), Some(standing)) = (self.world.state.entity(id).cloned(), self.world.state.entity(target).cloned()) else { return "short" };
        let fighting = self.in_combat();
        let strike_from = self.strike_tile(id, target, range);
        if strike_from == attacker.tile {
            return "inReach";
        }
        if strike_from != NO_TILE {
            self.walk_selected(id, strike_from, fighting);
            return "closed";
        }
        let field = self.move_field(id, fighting);
        let grid = &self.world.state.grid;
        let (mut best, mut best_distance) = (attacker.tile, grid.euclidean_distance(attacker.tile, standing.tile));
        for tile in field.tiles() {
            let distance = grid.euclidean_distance(tile, standing.tile);
            if distance < best_distance || (distance == best_distance && tile < best) {
                (best, best_distance) = (tile, distance);
            }
        }
        if best != attacker.tile {
            self.walk_selected(id, best, fighting);
            let (who, whom) = (name_of(self, id), name_of(self, target));
            note(self, &format!("{who} closes in, but cannot reach {whom} from inside the circle."), "combat");
        }
        "short"
    }

    /// Walk up to a thing out of reach (`closeToUse`): the cheapest tile this move reaches within `reach` of
    /// any tile it covers. `inReach`, `closed`, or `short` - nobody moved.
    pub fn close_to_use(&mut self, id: &str, thing: &str, reach: i32) -> &'static str {
        let covers = self.world.state.interactable_covers(thing);
        let Some(walker) = self.world.state.entity(id).map(|e| e.tile) else { return "short" };
        if covers.is_empty() {
            return "short";
        }
        let grid = self.world.state.grid.clone();
        let near = |tile: i32| covers.iter().any(|&at| chebyshev(&grid, at, tile) <= reach);
        if near(walker) {
            return "inReach";
        }
        let fighting = self.in_combat();
        if fighting && !self.can_act(id) {
            return "short";
        }
        let field = self.move_field(id, fighting);
        let (mut best, mut best_cost) = (NO_TILE, f64::INFINITY);
        for tile in field.tiles() {
            if !near(tile) {
                continue;
            }
            let cost = field.cost_to(tile);
            if cost < best_cost || (cost == best_cost && tile < best) {
                (best, best_cost) = (tile, cost);
            }
        }
        if best == NO_TILE {
            return "short";
        }
        self.walk_selected(id, best, fighting);
        if self.world.state.entity(id).is_some_and(|e| e.tile == best) {
            "closed"
        } else {
            "short"
        }
    }

    /// Use a thing, walking up to it first when it is out of reach (`approachThenUse`): at once when it is in
    /// reach, or - when somebody draws the walk - once the walk there is drawn ending (`arrived`). Its status.
    pub fn approach_then_use(&mut self, id: &str) -> Result<&'static str, String> {
        if let Some(who) = self.party.selected().map(str::to_string) {
            if !self.busy() && self.party.can_command(&self.world.state, Some(&who)) && self.close_to_use(&who, id, DEMO_REACH) == "closed" && self.animated {
                self.approaching = Some(Approach { kind: "use".into(), id: id.into(), who });
                return Ok("walking");
            }
        }
        Ok(self.use_selected_on(id)?.status)
    }

    /// The walkers are where the board put them (`arrive`): whatever the walk woke begins now. Whether it did.
    pub fn arrive(&mut self) -> bool {
        let Some(encounter) = self.ambush.take() else { return false };
        self.start_encounter(&encounter);
        true
    }

    /// The walkers have stopped (`arrived`): do what the walk was for, with whoever walked - nothing when the
    /// one who walked is no longer who is selected, given another order the interaction does not outlive.
    pub fn arrived(&mut self) -> Result<bool, String> {
        let Some(waiting) = self.approaching.take() else { return Ok(false) };
        if self.party.selected() != Some(waiting.who.as_str()) {
            return Ok(false);
        }
        if waiting.kind == "use" {
            self.use_selected_on(&waiting.id)?;
        } else {
            self.talk_now(&waiting.who, &waiting.id)?;
        }
        Ok(true)
    }

    /// Stop wanting to get there (`cancelApproach`): whether anything was waiting.
    pub fn cancel_approach(&mut self) -> bool {
        self.approaching.take().is_some()
    }

    /// Walk up to a creature on nobody's side and talk to it (`talkTo`); a walk that falls short is the move,
    /// and nothing is said.
    pub fn talk_to(&mut self, actor: &str, id: &str) -> Result<UseOutcome, String> {
        let has = self.placement_of(id).is_some_and(|(p, _)| !p["interaction"].is_null());
        if !has || self.world.state.entity(id).is_none() {
            return Ok(UseOutcome { status: "missing", lines: Vec::new() });
        }
        let walk = self.close_to_strike(actor, id, RangeBand::Melee);
        if walk == "short" {
            return Ok(UseOutcome { status: "unreachable", lines: Vec::new() });
        }
        if walk == "closed" && self.animated {
            self.approaching = Some(Approach { kind: "talk".into(), id: id.into(), who: actor.into() });
            return Ok(UseOutcome { status: "done", lines: Vec::new() });
        }
        self.talk_now(actor, id)
    }

    // ---- what a view draws -------------------------------------------------------------------------------

    /// The line a click would walk (`previewWalk`); `from`, the ground the figure stands on mid-walk. Nothing
    /// when nothing would move.
    pub fn preview_walk(&mut self, destination: i32, aimed: Spot, from: Option<Spot>) -> Option<WalkPreview> {
        if self.busy() {
            return None;
        }
        let id = self.party.selected()?.to_string();
        if !self.party.can_command(&self.world.state, Some(&id)) {
            return None;
        }
        let fighting = self.in_combat();
        if fighting && !self.can_act(&id) {
            return None;
        }
        if !self.world.state.grid.is_tile(destination) {
            return None;
        }
        if fighting {
            let mut options = self.fight_walk(&id);
            options.short = true;
            options.at = Some(aimed);
            options.from = from;
            let walk = self.party.plan_walk(&self.world.state, &id, destination, &options)?;
            let beyond = walk.beyond.unwrap_or_default();
            let run = beyond.len() >= 2 && self.under_pressure(&id, destination, Some(aimed));
            return Some(WalkPreview { route: walk.route, beyond, run });
        }
        let state = &self.world.state;
        let field = self.party.reachable(state, &id, false, None, from);
        let plan = |to: i32, at: Spot| self.party.plan_walk(state, &id, to, &WalkOptions { at: Some(at), from, ..WalkOptions::default() }).map(|w| WalkPreview { route: w.route, beyond: Vec::new(), run: false });
        if field.can_reach(destination) {
            return plan(destination, aimed);
        }
        let nearest = nearest_reachable(&state.grid, &field, aimed);
        if nearest == NO_TILE || state.entity(&id).is_some_and(|e| e.tile == nearest) {
            return None;
        }
        plan(nearest, clamp_into(&state.grid, aimed, nearest))
    }

    /// The line a click on a creature would walk before the swing (`previewStrike`): nothing when already in
    /// reach or nothing would move.
    pub fn preview_strike(&mut self, target: &str) -> Option<Vec<Spot>> {
        if self.busy() {
            return None;
        }
        let id = self.party.selected()?.to_string();
        let character = self.characters.get(&id)?.clone();
        if !self.world.state.entity(target).is_some_and(|e| e.alive) {
            return None;
        }
        let fighting = self.in_combat();
        if fighting && !self.can_act(&id) {
            return None;
        }
        let tile = self.world.state.entity(&id)?.tile;
        let from = self.strike_tile(&id, target, attack_profile(&character, Hand::Primary).range);
        if from == NO_TILE || from == tile {
            return None;
        }
        let options = self.walk_options(&id, fighting);
        self.party.plan_walk(&self.world.state, &id, from, &options).map(|w| w.route)
    }
}
