//! Jumping and running (`src/game/leap.ts`, `game/rolled-move.ts`): the two moves a roll stands in front of.
//!
//! A jump is asked for by name and aimed: from where the jumper stands, along an arc, to anywhere in range -
//! over a low wall or somebody's head, up onto a block or down off one - and past that range, from the first
//! spot along a walk towards the landing that it comes into range from. What a step is, which trait carries
//! what and what it costs are the project's jump rules. A push is Movement Under Pressure: the roll between
//! a fighter and a spot past their circle, which opens the circle a step on a success.
//!
//! Both are a script's roll, so the dice, the Light and Shadow, the spotlight and the prompt are every other
//! roll's; both do their walking when the answer comes back, which is why what they do then waits in the
//! prompt (`OnDone`). A landing whose fall hurts is the fight's to answer, and waits for it.

use super::log::{name_of, note};
use super::movement::MoveResult;
use super::play::{OnDone, PendingScript};
use super::rules::{jump_rules_for, walk_for, DEMO_MOVE_DIFFICULTY};
use super::session::Session;
use crate::grid::terrain::VOID_TERRAIN_ID;
use crate::grid::tile_grid::{Spot, NO_TILE};
use crate::grid::walk::{can_stand_at, line_length, point_along, settle_end, split_line};
use crate::js;
use crate::rules::jump::{arc_height, arc_lift, jump_range, leap_terms, JumpRules};
use crate::rules::range::{band_label, RangeBand};
use crate::scene::party::WalkOptions;
use crate::scene::state::Faction;
use crate::script::runner::{RunStatus, RunnerOptions, ScriptRunner, ScriptWorld, SuspendedRunner};
use serde_json::{json, Value};

/// What the Jump button arms the bar with: an id no card can have.
pub const JUMP_ID: &str = "jump:button";

/// How finely an arc is checked against what stands under it, in tiles.
const ARC_STRIDE: f64 = 0.2;
/// How finely a run-up is searched for the point the jump comes into range, in tiles.
const RUN_UP_STRIDE: f64 = 0.1;

/// A jump worked out (`Leap`): where it is made from and lands, what it asks, and the run-up before it.
#[derive(Clone, Debug, PartialEq)]
pub struct Leap {
    /// What the roll's Difficulty is, when there is a roll; nothing for a drop the legs simply take.
    pub difficulty: Option<f64>,
    /// The dice of falling damage at the bottom.
    pub fall_dice: f64,
    pub from: i32,
    pub to: i32,
    pub from_at: Spot,
    pub at: Spot,
    /// The line walked to `from_at` first, when the landing was past their range from where they stood.
    pub walk: Option<Vec<Spot>>,
    pub across: f64,
    pub rise: f64,
    pub lift: f64,
}

/// What the aim draws towards a tile (`JumpArc`).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct JumpArc {
    pub walk: Vec<Spot>,
    pub from: Spot,
    pub to: Spot,
    pub lift: f64,
    pub ok: bool,
}

fn blocks(n: f64) -> String {
    format!("{} block{}", js::number_to_string(n), if n == 1.0 { "" } else { "s" })
}

impl Session {
    fn jump_rules(&self) -> JumpRules {
        jump_rules_for(&self.project)
    }

    /// Where everybody else stands, whom a landing must come down clear of.
    fn others_than(&self, id: &str) -> Vec<Spot> {
        self.world.state.all_entities().iter().filter(|e| e.id != id && e.alive && e.tile != NO_TILE).map(|e| e.at).collect()
    }

    /// Whether a jump's arc gets from one spot to another without meeting anything (`arcClear`): ground
    /// higher than the arc, or anything nobody could stand on - a gap excepted, which is what jumps are for.
    fn arc_clear(&self, a: Spot, b: Spot, lift: f64) -> bool {
        let grid = &self.world.state.grid;
        let from = grid.tile_at_spot(a.x, a.y);
        let to = grid.tile_at_spot(b.x, b.y);
        let steps = js::max(1.0, (js::hypot(b.x - a.x, b.y - a.y) / ARC_STRIDE).ceil()) as i64;
        // Every side passes: what is left of "blocked" is the things.
        let shut = self.world.state.blocked_for("", &[Faction::Party, Faction::Adversary, Faction::Neutral]);
        for i in 1..steps {
            let t = i as f64 / steps as f64;
            let under = grid.tile_at_spot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            if under == from || under == to {
                continue;
            }
            if under == NO_TILE || shut(under) || (!grid.is_passable(under) && grid.top_at(under).id != VOID_TERRAIN_ID) {
                return false;
            }
            if grid.stand_at(under) > arc_height(grid.stand_at(from), grid.stand_at(to), lift, t) + 1e-6 {
                return false;
            }
        }
        true
    }

    /// Where a jump aimed at a spot comes down (`landing`): the spot, when a body fits there clear of
    /// everybody; else back towards the tile's centre.
    fn landing(&self, id: &str, to: i32, aim: Spot) -> Spot {
        let blocked = self.world.state.blocked_for(id, &[]);
        settle_end(&self.world.state.grid, to, aim, &blocked, &self.others_than(id), walk_for(&self.project))
    }

    /// The jump from a spot to a tile, for this jumper (`planJumpFrom`): nothing when it cannot be made.
    fn plan_jump_from(&self, id: &str, from_at: Spot, to: i32, aim: Option<Spot>) -> Option<Leap> {
        let character = self.characters.get(id)?;
        let rules = self.jump_rules();
        if !rules.enabled {
            return None;
        }
        let grid = &self.world.state.grid;
        let from = grid.tile_at_spot(from_at.x, from_at.y);
        if !grid.is_tile(to) || to == from || !self.world.state.body_free(to, id) {
            return None;
        }
        let at = match aim {
            None => grid.spot_of(to),
            Some(aim) => self.landing(id, to, aim),
        };
        let across = js::hypot(at.x - from_at.x, at.y - from_at.y);
        if across > jump_range(&rules, &character.traits) + 1e-6 {
            return None;
        }
        let rise = grid.stand_at(to) - grid.stand_at(from);
        let terms = leap_terms(&rules, rise, &character.traits);
        let lift = arc_lift(across, rise);
        let terms = terms?;
        if !self.arc_clear(from_at, at, lift) {
            return None;
        }
        Some(Leap { difficulty: terms.difficulty, fall_dice: terms.fall_dice, from, to, from_at, at, walk: None, across, rise, lift })
    }

    /// The jump from where they stand (`planJump`).
    pub fn plan_jump(&self, id: &str, to: i32, aim: Option<Spot>) -> Option<Leap> {
        let stood = self.world.state.entity(id)?.at;
        self.plan_jump_from(id, stood, to, aim)
    }

    /// The jump at the end of a walk (`planJumpAfterWalk`): made from the first point along it the jump can
    /// be made from, to a tenth of a tile.
    fn plan_jump_after_walk(&mut self, id: &str, via: i32, to: i32, aim: Option<Spot>, fighting: bool) -> Option<Leap> {
        let mut options = if fighting { self.fight_walk(id) } else { WalkOptions::default() };
        options.short = fighting;
        let walk = self.party.plan_walk(&self.world.state, id, via, &options)?;
        let route = walk.route;
        let blocked = self.world.state.blocked_for(id, &[]);
        let rules = walk_for(&self.project);
        let others = self.others_than(id);
        let length = line_length(&route);
        let mut gone = RUN_UP_STRIDE;
        while gone < length + RUN_UP_STRIDE {
            let here = if gone >= length { *route.last().expect("a route") } else { point_along(&route, gone) };
            let clear = can_stand_at(&self.world.state.grid, here, &blocked, rules) && !others.iter().any(|o| js::hypot(o.x - here.x, o.y - here.y) < 2.0 * rules.radius);
            if clear {
                if let Some(leap) = self.plan_jump_from(id, here, to, aim) {
                    let walked = if gone >= length { route.clone() } else { split_line(&route, gone).0 };
                    return Some(Leap { walk: Some(walked), ..leap });
                }
            }
            gone += RUN_UP_STRIDE;
        }
        None
    }

    /// The jump to a tile, with a walk in front of it only if it needs one (`planRunningJump`): from where
    /// they stand when that reaches; else from the launch spot nearest the landing this move reaches.
    pub fn plan_running_jump(&mut self, id: &str, to: i32, aim: Option<Spot>) -> Option<Leap> {
        let direct = self.plan_jump(id, to, aim);
        let traits = self.characters.get(id).map(|c| c.traits);
        let (None, Some(traits)) = (&direct, traits) else { return direct };
        if !self.world.state.grid.is_tile(to) {
            return direct;
        }
        let fighting = self.in_combat();
        let field = self.party.reachable(&self.world.state, id, fighting, Some(f64::INFINITY), None);
        let circle = if fighting { self.movement_circle(id) } else { None };
        let grid = self.world.state.grid.clone();
        let near = |tile: i32| circle.is_none_or(|c| js::hypot(f64::from(grid.x_of(tile)) - c.anchor.x, f64::from(grid.y_of(tile)) - c.anchor.y) <= c.radius + 1.0);
        let reach = jump_range(&self.jump_rules(), &traits).ceil() as i32;
        let land = match aim {
            None => grid.spot_of(to),
            Some(aim) => self.landing(id, to, aim),
        };
        let (x0, y0) = (grid.x_of(to), grid.y_of(to));
        let mut launches = Vec::new();
        for y in y0 - reach..=y0 + reach {
            for x in x0 - reach..=x0 + reach {
                let from = grid.index_of(x, y);
                if from != NO_TILE && field.can_reach(from) && near(from) && self.plan_jump_from(id, grid.spot_of(from), to, aim).is_some() {
                    launches.push(from);
                }
            }
        }
        let away = |tile: i32| js::hypot(f64::from(grid.x_of(tile)) - land.x, f64::from(grid.y_of(tile)) - land.y);
        // As the TypeScript's comparator reads it: a difference of nothing, or not a number, falls through.
        let cmp = |d: f64| if d == 0.0 || d.is_nan() { None } else { Some(if d < 0.0 { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }) };
        launches.sort_by(|&a, &b| cmp(away(a) - away(b)).or_else(|| cmp(field.cost_to(a) - field.cost_to(b))).unwrap_or_else(|| a.cmp(&b)));
        for via in launches {
            if let Some(leap) = self.plan_jump_after_walk(id, via, to, aim, fighting) {
                return Some(leap);
            }
        }
        None
    }

    /// Everywhere the selected member could jump to from where they stand (`leapTargets`).
    pub fn leap_targets(&self, id: &str) -> Vec<i32> {
        let (Some(character), Some(stood)) = (self.characters.get(id), self.world.state.entity(id)) else { return Vec::new() };
        let reach = jump_range(&self.jump_rules(), &character.traits).ceil() as i32;
        let grid = &self.world.state.grid;
        let (x0, y0) = (grid.x_of(stood.tile), grid.y_of(stood.tile));
        let mut landings = Vec::new();
        for y in y0 - reach..=y0 + reach {
            for x in x0 - reach..=x0 + reach {
                let to = grid.index_of(x, y);
                if to != NO_TILE && self.plan_jump(id, to, None).is_some() {
                    landings.push(to);
                }
            }
        }
        landings
    }

    /// What the aim draws towards a tile (`jumpArc`): the way it would go, or red from where they stand.
    pub fn jump_arc(&mut self, id: &str, to: i32, aim: Option<Spot>) -> Option<JumpArc> {
        let stood = self.world.state.entity(id)?.clone();
        if !self.world.state.grid.is_tile(to) || to == stood.tile {
            return None;
        }
        match self.plan_running_jump(id, to, aim) {
            None => {
                let grid = &self.world.state.grid;
                let rise = grid.stand_at(to) - grid.stand_at(stood.tile);
                let end = aim.unwrap_or_else(|| grid.spot_of(to));
                Some(JumpArc { walk: Vec::new(), from: stood.at, to: end, lift: arc_lift(js::hypot(end.x - stood.at.x, end.y - stood.at.y), rise), ok: false })
            }
            Some(leap) => Some(JumpArc { walk: leap.walk.unwrap_or_default(), from: leap.from_at, to: leap.at, lift: leap.lift, ok: true }),
        }
    }

    /// Whether the selected member may be offered a jump (`jumpOffered`).
    pub fn jump_offered(&self) -> bool {
        let Some(id) = self.party.selected() else { return false };
        if !self.party.can_command(&self.world.state, Some(id)) || !self.jump_rules().enabled {
            return false;
        }
        !self.in_combat() || self.encounter.as_ref().is_some_and(|e| e.can_act(&self.world.state, id))
    }

    /// The landings to light when the Jump button is armed (`jumpAim`), or nothing - said in the log - when
    /// there is nowhere to jump to.
    pub fn jump_aim(&mut self) -> Option<Vec<i32>> {
        let id = self.party.selected()?.to_string();
        if self.pending.is_some() || !self.jump_offered() {
            return None;
        }
        let tiles = self.leap_targets(&id);
        if !tiles.is_empty() {
            return Some(tiles);
        }
        let name = name_of(self, &id);
        note(self, &format!("{name} has nowhere to jump to from here."), "system");
        None
    }

    /// Whether a jump aimed at a tile can be made, walk and all (`jumpReaches`).
    pub fn jump_reaches(&mut self, id: &str, destination: i32, aim: Option<Spot>) -> bool {
        self.plan_running_jump(id, destination, aim).is_some()
    }

    // ---- the rolls -------------------------------------------------------------------------------------

    /// Run a roll's script and do what it was for with the answer (`rollThen`): now when nothing was asked,
    /// else when it is given.
    fn roll_then(&mut self, id: &str, effects: &[Value], finish: OnDone) -> Result<MoveResult, String> {
        self.world.scenario.actor_id = Some(id.to_string());
        let options = RunnerOptions { roll_as: Some("actor".into()), ..RunnerOptions::default() };
        let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
        let status = runner.run(effects);
        let journal = runner.entries().to_vec();
        let runner = runner.suspend();
        self.record(&journal)?;
        if let RunStatus::Waiting(prompt) = status {
            self.pending = Some(PendingScript::new(runner, prompt, journal.len(), finish));
            return Ok(MoveResult { moved: false, path: Vec::new(), triggered: None, pending: true });
        }
        self.finish(finish, &runner)?;
        Ok(MoveResult { moved: true, ..MoveResult::default() })
    }

    /// What a rolled move does once its roll is answered.
    pub(super) fn finish(&mut self, finish: OnDone, runner: &SuspendedRunner) -> Result<(), String> {
        match finish {
            OnDone::Run { id, destination, aimed } => self.finish_run(&id, destination, aimed, runner),
            OnDone::Leap { id, leap, read } => {
                if runner.cancelled && !runner.rolled {
                    return Ok(());
                }
                let success = runner.last_action_roll().is_some_and(|r| r.success);
                self.land(&id, &leap, Some(success), Some(runner.spotlight_to_gm), read)
            }
            OnDone::Nothing | OnDone::Converse => Ok(()),
        }
    }

    /// Movement Under Pressure (`runForIt`): an Agility Roll between a fighter and a spot past their circle.
    /// The roll is the action; a success pushes the circle out a step and walks as far as it then allows, a
    /// failure moves nobody and hands the spotlight to the GM.
    pub fn run_for_it(&mut self, id: &str, destination: i32, aimed: Option<Spot>) -> Result<MoveResult, String> {
        let Some(opens) = self.push_circle(id) else { return Ok(MoveResult::default()) };
        let name = name_of(self, id);
        let from = match opens.band {
            RangeBand::Far => RangeBand::Close,
            RangeBand::VeryFar => RangeBand::Far,
            band => band,
        };
        let prompt = format!(
            "Push past {} range: an Agility Roll opens {} range to {name} for the rest of the turn. On a failure nobody moves, the spotlight passes to the GM, and the turn is over.",
            band_label(from),
            band_label(opens.band)
        );
        let effects = [json!({ "kind": "check", "check": { "trait": "agility", "difficulty": DEMO_MOVE_DIFFICULTY, "prompt": prompt } })];
        self.roll_then(id, &effects, OnDone::Run { id: id.to_string(), destination, aimed })
    }

    fn finish_run(&mut self, id: &str, destination: i32, aimed: Option<Spot>, runner: &SuspendedRunner) -> Result<(), String> {
        if runner.cancelled && !runner.rolled {
            return Ok(());
        }
        let name = name_of(self, id);
        let success = runner.last_action_roll().is_some_and(|r| r.success);
        if success {
            let state = &self.world.state;
            let band = self.encounter.as_mut().and_then(|e| e.push(state, id));
            if let Some(band) = band {
                note(self, &format!("{name} pushes out to {} range for the rest of the turn.", band_label(band)), "combat");
            }
            self.walk_the_move(id, destination, aimed, true, true, None);
        } else {
            note(self, &format!("{name} is held where they are: the spotlight passes to the GM."), "combat");
        }
        // The roll was the action, and a failure ends the turn whatever the dice said about Light.
        if self.in_combat() && self.encounter.as_ref().is_some_and(|e| e.can_act(&self.world.state, id)) {
            let to_gm = runner.spotlight_to_gm || !success;
            self.encounter.as_mut().expect("a fight").act(&mut self.world.state, id, to_gm);
        }
        self.settle_fight()
    }

    /// Make a jump (`leapTo`): the roll first, where there is one, then the run-up and the landing - which
    /// happens whatever the dice said. `read` is whether somebody reads the dice before the token flies.
    pub fn leap_to(&mut self, id: &str, leap: Leap, read: bool) -> Result<MoveResult, String> {
        let Some(difficulty) = leap.difficulty else {
            let path = vec![leap.from, leap.to];
            self.land(id, &leap, None, None, read)?;
            return Ok(MoveResult { moved: true, path, ..MoveResult::default() });
        };
        let rules = self.jump_rules();
        let name = name_of(self, id);
        let lands = if rules.fail_condition.is_empty() {
            String::new()
        } else {
            self.project["conditionDefs"].as_array().into_iter().flatten().find(|d| d["id"] == rules.fail_condition.as_str()).and_then(|d| d["name"].as_str()).unwrap_or(&rules.fail_condition).to_string()
        };
        let high = blocks(js::max(1.0, js::round(leap.rise.abs())));
        let level = leap.rise.abs() <= rules.step_height;
        let across = js::max(1.0, js::round(leap.across));
        let trait_name = rules.roll_trait.name();
        let roll = format!("{}{} Roll", trait_name[..1].to_uppercase(), &trait_name[1..]);
        let failing = if lands.is_empty() { String::new() } else { format!(", and lands {lands} on a failure") };
        let hurts = if leap.fall_dice == 0.0 {
            String::new()
        } else {
            format!(" {name} takes {}d{} from the fall{}.", js::number_to_string(leap.fall_dice), js::number_to_string(rules.fall_die), if rules.half_on_success { ", half on a success" } else { "" })
        };
        let asked = if level {
            format!("Jump {} tile{}", js::number_to_string(across), if across == 1.0 { "" } else { "s" })
        } else {
            format!("{} {high}", if leap.rise > 0.0 { "Jump up" } else { "Drop" })
        };
        let article = if roll.starts_with(['A', 'E', 'I', 'O', 'U']) { "n" } else { "" };
        let prompt = format!("{asked}: a{article} {roll}.{hurts} {name} lands either way{failing}.");
        let effects = [json!({ "kind": "check", "check": { "trait": trait_name, "difficulty": difficulty, "prompt": prompt } })];
        self.roll_then(id, &effects, OnDone::Leap { id: id.to_string(), leap, read })
    }

    /// The landing (`land`): the run-up walked, up off the ground if down, the jump flown, alone - the others
    /// stay - a trigger landed on woken, and the fall's damage and a bad landing's condition.
    fn land(&mut self, id: &str, leap: &Leap, success: Option<bool>, spotlight_to_gm: Option<bool>, read: bool) -> Result<(), String> {
        let rules = self.jump_rules();
        let name = name_of(self, id);
        let fighting = self.in_combat();
        if leap.walk.is_some() {
            let walked = self.walk_the_move(id, leap.from, Some(leap.from_at), fighting, false, None);
            // Walked into something on the way: the ambush has them, and the jump is not made.
            if walked.triggered.is_some() || self.world.state.entity(id).is_some_and(|e| e.tile != leap.from) {
                return Ok(());
            }
        }
        if ScriptWorld::clear_condition(&mut self.world, id, "prone") {
            note(self, &format!("{name} gets up."), if fighting { "combat" } else { "system" });
        }
        let stood = self.world.state.entity(id).expect("the jumper").at;
        self.world.state.place_entity(id, leap.at.x, leap.at.y).expect("the jumper");
        // One line for the board, the walk and the jump at the end of it.
        let walked = self.motions.iter().position(|m| m["id"] == id && m.get("route").is_some_and(|r| !r.is_null()));
        let (mut path, mut route): (Vec<Value>, Vec<Value>) = match walked {
            None => (vec![json!(leap.from)], vec![json!(stood)]),
            Some(at) => {
                let motion = self.motions.remove(at);
                (motion["path"].as_array().cloned().unwrap_or_else(|| vec![json!(leap.from)]), motion["route"].as_array().cloned().unwrap_or_else(|| vec![json!(stood)]))
            }
        };
        path.push(json!(leap.to));
        route.push(json!(leap.at));
        let mut motion = json!({ "id": id, "path": path, "route": route, "leap": leap.lift });
        if success.is_some() && read {
            motion["wait"] = json!(true);
        }
        self.motions.push(motion);
        let level = leap.rise.abs() <= rules.step_height;
        let high = blocks(js::max(1.0, js::round(leap.rise.abs())));
        let across = js::max(1.0, js::round(leap.across));
        let what = if level {
            format!("jumps {} tile{}", js::number_to_string(across), if across == 1.0 { "" } else { "s" })
        } else if leap.rise > 0.0 {
            format!("jumps up {high}")
        } else {
            format!("drops {high}")
        };
        note(self, &format!("{name} {what}."), if fighting { "combat" } else { "system" });
        // A jump is not followed: the jumper goes on alone.
        if self.party.unlink(&self.world.state, id) {
            note(self, &format!("{name} goes on alone: the others stay where they are."), if fighting { "combat" } else { "system" });
        }
        if let Some(woke) = self.triggers.first_along(&[leap.to], &mut self.world.state) {
            self.start_encounter(&woke.encounter);
        }
        let mut after = Vec::new();
        if leap.fall_dice > 0.0 {
            let mut fall = json!({ "kind": "damage", "dice": format!("{}d{}", js::number_to_string(leap.fall_dice), js::number_to_string(rules.fall_die)), "type": "physical", "direct": true, "target": { "kind": "actor" }, "source": "the fall" });
            if success == Some(true) && rules.half_on_success {
                fall["half"] = json!(true);
            }
            after.push(fall);
        }
        if success == Some(false) && !rules.fail_condition.is_empty() {
            after.push(json!({ "kind": "applyCondition", "condition": rules.fail_condition, "target": { "kind": "actor" } }));
        }
        if !after.is_empty() {
            self.world.scenario.actor_id = Some(id.to_string());
            let options = RunnerOptions { roll_as: Some("actor".into()), ..RunnerOptions::default() };
            let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
            runner.run(&after);
            let journal = runner.entries().to_vec();
            drop(runner);
            self.record(&journal)?;
        }
        if fighting && self.encounter.as_ref().is_some_and(|e| e.can_act(&self.world.state, id)) {
            self.encounter.as_mut().expect("a fight").act(&mut self.world.state, id, spotlight_to_gm.unwrap_or(false));
        }
        self.settle_fight()
    }

    /// Jump to where the aim pointed (`jumpTo`). With the dice thrown for the player (`auto_roll`), the roll is
    /// made at once, without the prompt between the click and the dice.
    pub fn jump_to(&mut self, id: &str, destination: i32, aim: Option<Spot>, auto_roll: bool) -> Result<MoveResult, String> {
        if self.pending.is_some() || self.party.selected() != Some(id) || !self.jump_offered() {
            return Ok(MoveResult::default());
        }
        let Some(leap) = self.plan_running_jump(id, destination, aim) else { return Ok(MoveResult::default()) };
        let path = vec![leap.from, leap.to];
        let made = self.leap_to(id, leap, !auto_roll)?;
        if !made.pending || !auto_roll {
            return Ok(made);
        }
        self.answer_pending(&json!({ "kind": "roll" }))?;
        Ok(MoveResult { moved: self.world.state.entity(id).is_some_and(|e| e.tile == destination), path, ..MoveResult::default() })
    }
}
