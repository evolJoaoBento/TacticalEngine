//! The GM's turn (`playGmTurn`, `runGmTurn`, `endTurn`): adversaries spotlighted while the Shadow lasts, in
//! the order the encounter keeps them, each doing what `adversaryTurn` says - shaking off what holds it, a
//! feature worth using, or a walk to the nearest of the party and a swing. What a stat block's script does
//! to the queue - a swarm that swung with it, arrivals, allies and itself handed the spotlight, a creature
//! replaced - is `afterAdversaryScript`, here too.

use super::log::{name_of, note, the_name_of};
use super::rules::{movement_for, walk_for, DEMO_BAND_TILES};
use super::session::Session;
use crate::combat::adversary_features::adversary_traits;
use crate::combat::area::{move_under_pressure, MoveCost, MoveUnderPressureOptions, Mover};
use crate::combat::encounter::{EncounterOutcome, Side};
use crate::content::adversaries::AdversaryDef;
use crate::content::conditions::ConditionBlock;
use crate::grid::pathfinding::{trace_path, MovementContext, Pathfinder};
use crate::grid::tile_grid::{Spot, NO_TILE};
use crate::grid::walk::smooth_path;
use crate::rules::range::{band_for_span, max_tiles_for_band, reaches, RangeBand};
use crate::scene::state::{ConditionDuration, Faction};
use serde::Serialize;
use serde_json::{json, Value};

/// What is left of the GM's turn. How many times each adversary has been spotlighted in it is the
/// session's `spotlit`, which the world reads for a swarm.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmTurn {
    /// Adversaries still to be spotlighted, in order.
    pub remaining: Vec<String>,
    /// How many have acted so far.
    pub acted: u32,
    /// Who has already played a stat-block feature this turn.
    pub features: Vec<String>,
    /// Adversaries whose next spotlight a feature has already paid for.
    pub granted: Vec<String>,
    /// Those whose attack deals half damage on the turn they were handed.
    pub halved: Vec<String>,
}

fn remove(list: &mut Vec<String>, id: &str) -> bool {
    let before = list.len();
    list.retain(|x| x != id);
    list.len() != before
}

fn add(list: &mut Vec<String>, id: &str) {
    if !list.iter().any(|x| x == id) {
        list.push(id.to_string());
    }
}

impl Session {
    /// The stat block a creature answers to (`statBlock`): the world's, or the demo's knight for one that
    /// has none.
    pub(super) fn stat_block(&self, id: &str) -> AdversaryDef {
        let definition = self.world.state.entity(id).map(|e| e.definition.clone()).unwrap_or_default();
        let content = self.world.shared_content();
        content.adversaries.get(&definition).cloned().or_else(|| self.shipped().adversary(super::rules::DEMO_ADVERSARY_ID).cloned()).expect("the demo's knight ships")
    }

    /// How many times a creature has been spotlighted this GM turn.
    pub(super) fn spotlights_of(&self, id: &str) -> f64 {
        self.spotlit.borrow().iter().find(|(k, _)| k == id).map_or(0.0, |(_, n)| *n)
    }

    pub(super) fn spotlight_once_more(&mut self, id: &str) {
        let mut spotlit = self.spotlit.borrow_mut();
        match spotlit.iter_mut().find(|(k, _)| k == id) {
            Some((_, n)) => *n += 1.0,
            None => spotlit.push((id.to_string(), 1.0)),
        }
    }

    /// The GM's turn over, or put away: nobody has been spotlighted in one that is not running.
    pub(super) fn end_the_turn(&mut self) {
        self.gm_turn = None;
        self.spotlit.borrow_mut().clear();
    }

    /// Hand the spotlight to the GM and play the GM's turn (`endTurn`): the party choosing to stop.
    pub fn end_turn(&mut self) -> Result<u32, String> {
        let Some(encounter) = self.encounter.as_mut() else { return Ok(0) };
        if encounter.outcome() != EncounterOutcome::Ongoing {
            return Ok(0);
        }
        if encounter.view(&self.world.state).side == Side::Party {
            encounter.pass_to_gm(&self.world.state);
        }
        self.play_gm_turn()
    }

    /// Play the GM's turn (`playGmTurn`): what the party carried for a moment comes off, and the adversaries
    /// the encounter has waiting are spotlighted in turn.
    pub fn play_gm_turn(&mut self) -> Result<u32, String> {
        let Some(encounter) = self.encounter.as_ref() else { return Ok(0) };
        if encounter.outcome() != EncounterOutcome::Ongoing || encounter.view(&self.world.state).side != Side::Gm {
            return Ok(0);
        }
        if self.gm_turn.is_some() || self.waiting() {
            return Ok(0);
        }
        self.clear_party_temporary();
        let waiting = self.encounter.as_ref().expect("a fight").view(&self.world.state).waiting;
        self.spotlit.borrow_mut().clear();
        self.gm_turn = Some(GmTurn { remaining: waiting, ..GmTurn::default() });
        self.run_gm_turn()
    }

    /// Play what is left of the GM's turn (`runGmTurn`). A question put to the table stops it, and the answer
    /// picks it up again.
    pub fn run_gm_turn(&mut self) -> Result<u32, String> {
        if self.encounter.is_none() || self.gm_turn.is_none() {
            return Ok(0);
        }
        let mut acted = self.gm_turn.as_ref().map_or(0, |t| t.acted);
        loop {
            // A script that stopped the fight put the turn away: the TypeScript's loop is left holding it, and
            // leaves on the fight being over.
            let Some(turn) = self.gm_turn.as_ref() else { break };
            let ongoing = self.encounter.as_ref().is_some_and(|e| e.outcome() == EncounterOutcome::Ongoing);
            if turn.remaining.is_empty() || self.waiting() || !ongoing {
                break;
            }
            let id = turn.remaining[0].clone();
            if self.world.state.entity(&id).map(|e| e.faction) != Some(Faction::Adversary) {
                self.gm_turn.as_mut().expect("a turn").remaining.remove(0);
                continue;
            }
            let again = self.spotlights_of(&id) > 0.0;
            let granted = remove(&mut self.gm_turn.as_mut().expect("a turn").granted, &id);
            let encounter = self.encounter.as_mut().expect("a fight");
            if !granted && again && !encounter.can_spotlight_again(&self.world.state, &id) {
                self.gm_turn.as_mut().expect("a turn").remaining.remove(0);
                continue;
            }
            if !granted && !again && !encounter.can_spotlight(&self.world.state, &id) {
                break;
            }
            if granted {
                encounter.grant_spotlight(&mut self.world.state, &id);
            } else if again {
                encounter.spotlight_again(&mut self.world.state, &id);
            } else {
                encounter.spotlight(&mut self.world.state, &id);
            }
            self.spotlight_once_more(&id);
            let turn = self.gm_turn.as_mut().expect("a turn");
            turn.acted += 1;
            acted = turn.acted;
            let allowed = adversary_traits(&self.stat_block(&id).features).spotlights;
            if self.spotlights_of(&id) >= allowed {
                self.gm_turn.as_mut().expect("a turn").remaining.remove(0);
            }
            self.adversary_turn(&id)?;
            if let Some(turn) = self.gm_turn.as_mut() {
                remove(&mut turn.halved, &id);
            }
        }
        if self.waiting() {
            return Ok(acted);
        }
        self.end_the_turn();
        if let Some(encounter) = self.encounter.as_mut() {
            encounter.end_gm_turn(&self.world.state);
        }
        self.settle_fight()?;
        Ok(acted)
    }

    /// Temporary conditions end on the party members carrying them (`clearPartyTemporary`).
    fn clear_party_temporary(&mut self) {
        let members: Vec<String> = self.world.state.entities_of(Faction::Party).filter(|e| e.alive).map(|e| e.id.clone()).collect();
        for id in members {
            let cleared = self.clear_temporary_on(&id);
            if !cleared.is_empty() {
                let who = name_of(self, &id);
                note(self, &format!("{who} shakes off {}.", cleared.join(" and ")), "good");
            }
        }
        self.sync_pools();
    }

    /// Take a creature's temporary conditions off it, and say which.
    fn clear_temporary_on(&mut self, id: &str) -> Vec<String> {
        let Some(entity) = self.world.state.entity_mut(id) else { return Vec::new() };
        let mut cleared = Vec::new();
        for condition in entity.conditions.clone() {
            let duration = entity.condition_durations.iter().find(|(c, _)| *c == condition).map_or(ConditionDuration::Permanent, |(_, d)| *d);
            if duration != ConditionDuration::Temporary {
                continue;
            }
            entity.conditions.retain(|c| *c != condition);
            entity.condition_durations.retain(|(c, _)| *c != condition);
            cleared.push(condition);
        }
        cleared
    }

    /// One adversary's spotlight (`adversaryTurn`): what answers the spotlight itself, then the turn, then
    /// what was put on it for a moment comes off.
    fn adversary_turn(&mut self, id: &str) -> Result<(), String> {
        if !self.world.state.entity(id).is_some_and(|e| e.alive) {
            return Ok(());
        }
        if self.play_spotlight_reactions(id)? {
            return Ok(());
        }
        self.take_spotlight(id)?;
        self.clear_temporary_conditions(id);
        Ok(())
    }

    /// What the creature does with the spotlight (`takeSpotlight`).
    fn take_spotlight(&mut self, id: &str) -> Result<(), String> {
        if self.world.blocks(id, ConditionBlock::Act) {
            self.clear_temporary_conditions(id);
            if self.world.blocks(id, ConditionBlock::Act) {
                self.clear_with_bad(id);
            }
            return Ok(());
        }
        if self.world.blocks(id, ConditionBlock::Move) {
            self.clear_temporary_conditions(id);
            return Ok(());
        }
        let mut targets: Vec<(String, i32)> = self.world.state.entities_of(Faction::Party).filter(|e| e.alive).map(|e| (e.id.clone(), e.tile)).collect();
        if targets.is_empty() {
            return Ok(());
        }
        if let Some((ability, aimed)) = self.adversary_feature(id) {
            return self.use_adversary_feature(id, &ability, &aimed);
        }
        let here = self.world.state.entity(id).expect("standing").tile;
        let grid = &self.world.state.grid;
        targets.sort_by(|a, b| grid.manhattan_distance(here, a.1).cmp(&grid.manhattan_distance(here, b.1)).then_with(|| crate::js::locale_cmp(&a.0, &b.0)));
        let (target, tile) = targets[0].clone();
        let def = self.stat_block(id);
        if !self.approach(id, tile, def.attack_range) {
            return Ok(());
        }
        self.attack_party_member(id, &target)?;
        Ok(())
    }

    /// Where whoever is on a tile stands - the first living body there - or its centre (`standingOn`).
    pub(super) fn standing_on(&self, tile: i32) -> Spot {
        for id in self.world.state.occupants(tile) {
            if let Some(entity) = self.world.state.entity(id).filter(|e| e.alive) {
                return entity.at;
            }
        }
        self.world.state.grid.spot_of(tile)
    }

    /// The band from a spot to whoever stands on a tile (`bandFromSpot`).
    pub(super) fn band_from_spot(&self, from: Spot, tile: i32) -> RangeBand {
        let to = self.standing_on(tile);
        band_for_span(crate::js::hypot(from.x - to.x, from.y - to.y), &DEMO_BAND_TILES)
    }

    /// Move towards a tile as an adversary moves (`approach`): within Close for free, when that brings the
    /// target into reach; else as far as Very Far, which is the whole of the action. Whether the swing follows.
    fn approach(&mut self, id: &str, target_tile: i32, reach: RangeBand) -> bool {
        let Some(tile) = self.world.state.entity(id).map(|e| e.tile).filter(|&t| t != NO_TILE) else { return false };
        let in_reach_from = |session: &Session, tile: i32| reaches(session.band_from_spot(session.standing_in(id, tile), target_tile), reach);
        if in_reach_from(self, tile) {
            return true;
        }
        if let Some(close) = self.step_toward(id, target_tile, RangeBand::Close) {
            if in_reach_from(self, close.0) {
                self.walk_adversary(id, close);
                return true;
            }
        }
        if let Some(far) = self.step_toward(id, target_tile, RangeBand::VeryFar) {
            let options = MoveUnderPressureOptions { band_tiles: Some(DEMO_BAND_TILES), ..MoveUnderPressureOptions::default() };
            if move_under_pressure(&self.world.state.grid, Mover::Adversary, tile, far.0, &options) != MoveCost::OutOfReach {
                self.walk_adversary(id, far);
            }
        }
        false
    }

    /// The tile a band's walk reaches that is nearest a target, and the way there (`stepToward`): nothing when
    /// that is where it stands.
    fn step_toward(&self, id: &str, target_tile: i32, band: RangeBand) -> Option<(i32, Option<Vec<i32>>)> {
        let here = self.world.state.entity(id)?.tile;
        let blocked = self.world.state.blocked_for(id, &[]);
        let grid = &self.world.state.grid;
        let field = Pathfinder::new(grid).reachable(here, max_tiles_for_band(band, &DEMO_BAND_TILES), &movement_for(&self.project), &MovementContext { is_blocked: Some(&blocked), ..MovementContext::default() });
        let (mut best, mut best_distance) = (here, grid.euclidean_distance(here, target_tile));
        for tile in field.tiles() {
            if tile == target_tile {
                continue;
            }
            let distance = grid.euclidean_distance(tile, target_tile);
            if distance < best_distance || (distance == best_distance && tile < best) {
                (best, best_distance) = (tile, distance);
            }
        }
        (best != here).then(|| (best, trace_path(&field, best)))
    }

    /// Walk an adversary to a tile, and tell the board the line it took (`walkAdversary`).
    fn walk_adversary(&mut self, id: &str, step: (i32, Option<Vec<i32>>)) {
        let stood = self.world.state.entity(id).expect("standing").at;
        let (tile, path) = step;
        let route = path.as_ref().map(|path| {
            let blocked = self.world.state.blocked_for(id, &[]);
            let grid = &self.world.state.grid;
            smooth_path(grid, path, &blocked, walk_for(&self.project), Some(stood), Some(grid.spot_of(tile)))
        });
        self.world.state.move_entity(id, tile).expect("on the board");
        self.motions.push(match (path, route) {
            (Some(path), Some(route)) => json!({ "id": id, "path": path, "route": route }),
            _ => json!({ "id": id }),
        });
    }

    /// An adversary spends its spotlight clearing what a scene put on it (`clearTemporaryConditions`).
    pub(super) fn clear_temporary_conditions(&mut self, id: &str) {
        let cleared = self.clear_temporary_on(id);
        if !cleared.is_empty() {
            let who = the_name_of(self, id, false);
            note(self, &format!("{who} shakes off {}.", cleared.join(" and ")), "combat");
        }
    }

    /// "Or the GM spends a Shadow on their turn to clear this condition" (`clearWithBad`).
    fn clear_with_bad(&mut self, id: &str) {
        if self.world.state.entity(id).is_none() || self.world.state.bad.value < 1.0 {
            return;
        }
        let held = self.world.blocking(id, ConditionBlock::Act);
        if held.is_empty() {
            return;
        }
        self.world.state.bad.value -= 1.0;
        let entity = self.world.state.entity_mut(id).expect("standing");
        for condition in &held {
            entity.conditions.retain(|c| c != condition);
            entity.condition_durations.retain(|(c, _)| c != condition);
        }
        let who = the_name_of(self, id, true);
        note(self, &format!("The GM spends a Shadow: {who} shakes off {}.", held.join(" and ")), "bad");
    }

    // ---- what a stat block's script does to the turn ----------------------------------------------------

    /// Who swung with a swarm, who arrived, and who was handed the spotlight (`afterAdversaryScript`).
    pub(super) fn after_adversary_script(&mut self, journal: &[Value]) {
        if self.gm_turn.is_none() {
            return;
        }
        // A swarm that swung with it has taken its turn (`spendSwarmSpotlights`).
        for entry in journal {
            if entry["kind"] != "attack" {
                continue;
            }
            let Some(joined) = entry["joined"].as_array() else { continue };
            for id in joined.iter().filter_map(Value::as_str) {
                remove(&mut self.gm_turn.as_mut().expect("a turn").remaining, id);
                self.spotlight_once_more(id);
                if let Some(encounter) = self.encounter.as_mut() {
                    encounter.grant_spotlight(&mut self.world.state, id);
                }
            }
        }
        // What a feature summoned "and immediately spotlighted" acts now (`spotlightArrivals`).
        for entry in journal {
            if entry["kind"] != "summoned" || entry["spotlight"] != true {
                continue;
            }
            let turn = self.gm_turn.as_mut().expect("a turn");
            let arriving: Vec<String> = ids(&entry["ids"]).into_iter().filter(|id| !turn.remaining.contains(id)).collect();
            unshift(&mut turn.remaining, &arriving);
            for id in &arriving {
                add(&mut turn.granted, id);
            }
        }
        // "Spend 2 Shadow to spotlight up to five allies" (`spotlightAllies`).
        for entry in journal {
            if entry["kind"] != "spotlighted" {
                continue;
            }
            let called: Vec<String> = ids(&entry["ids"]).into_iter().filter(|id| self.world.state.entity(id).is_some_and(|e| e.alive)).collect();
            let turn = self.gm_turn.as_mut().expect("a turn");
            turn.remaining.retain(|waiting| !called.contains(waiting));
            unshift(&mut turn.remaining, &called);
            for id in &called {
                add(&mut turn.granted, id);
                if entry["halfDamage"] == true {
                    add(&mut turn.halved, id);
                }
            }
        }
        // "The Construct can then take the spotlight again" (`spotlightSelf`).
        for entry in journal {
            if entry["kind"] != "spotlightedAgain" {
                continue;
            }
            let Some(id) = entry["id"].as_str() else { continue };
            if !self.world.state.entity(id).is_some_and(|e| e.alive) {
                continue;
            }
            let turn = self.gm_turn.as_mut().expect("a turn");
            remove(&mut turn.remaining, id);
            turn.remaining.insert(0, id.to_string());
            add(&mut turn.granted, id);
        }
        // What a phase change stands up acts at once (`spotlightReplacements`).
        for entry in journal {
            if entry["kind"] != "replaced" {
                continue;
            }
            let state = &self.world.state;
            let turn = self.gm_turn.as_mut().expect("a turn");
            turn.remaining.retain(|waiting| state.entity(waiting).is_some());
            if entry["spotlight"] != true {
                continue;
            }
            let arriving: Vec<String> = ids(&entry["ids"]).into_iter().filter(|id| !turn.remaining.contains(id)).collect();
            unshift(&mut turn.remaining, &arriving);
            for id in &arriving {
                add(&mut turn.granted, id);
            }
        }
    }
}

fn ids(value: &Value) -> Vec<String> {
    value.as_array().map_or(Vec::new(), |ids| ids.iter().filter_map(Value::as_str).map(str::to_string).collect())
}

/// `Array.prototype.unshift(...items)`: the items, in their order, ahead of the rest.
fn unshift(list: &mut Vec<String>, items: &[String]) {
    let rest = std::mem::take(list);
    list.extend(items.iter().cloned());
    list.extend(rest);
}
