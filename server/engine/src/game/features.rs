//! A stat block's features in the fight: the one an adversary would rather use than swing
//! (`adversaryFeature`), what it costs the GM (`spendFeatureCost`), the reactions it plays on its own
//! (`playSpotlightReactions`, `affordableReaction`), the script it runs (`runAdversaryScript`), and the
//! countdowns - a clock ticked by what the party does, and one going off (`tickCountdowns`,
//! `runCountdown`).

use super::log::{note, the_name_of};
use super::session::Session;
use crate::content::abilities::AbilityDef;
use crate::grid::tile_grid::NO_TILE;
use crate::js;
use crate::rules::countdown::CountdownCue;
use crate::rules::resources::unmarked;
use crate::scene::state::Faction;
use crate::script::conditions::{evaluate, evaluate_optional, BoundRoll, TargetBindings};
use crate::script::countdowns::{CountdownMoved, RunningCountdown};
use crate::script::runner::{LastDamageOption, RunnerOptions, ScriptRunner};
use crate::script::schema::walk_effects;
use crate::script::world::scenario::use_key;
use serde_json::{json, Map, Value};

/// What a blow that called for a feature left behind (`runAdversaryScript`'s `from`).
#[derive(Clone, Debug, Default)]
pub(super) struct Left {
    pub counts: Option<Map<String, Value>>,
    pub last_damage: Option<LastDamageOption>,
    pub roll: Option<BoundRoll>,
}

fn bindings(targets: &[String], hit: &[String]) -> TargetBindings {
    TargetBindings { targets: targets.to_vec(), hit: hit.to_vec(), ..TargetBindings::default() }
}

/// What the GM pays to use a feature (`featureBad`): what the block says, and a Shadow for an action that
/// names no cost at all. A reaction is not chosen, so nothing is invented for it.
pub(super) fn feature_bad(ability: &AbilityDef, as_reaction: bool) -> f64 {
    let stated = ability.cost.bad.unwrap_or(0.0);
    if stated > 0.0 {
        return stated;
    }
    if as_reaction {
        return 0.0;
    }
    if ability.cost.stress.unwrap_or(0.0) == 0.0 && ability.cost.good.unwrap_or(0.0) == 0.0 {
        1.0
    } else {
        0.0
    }
}

fn spotlights_allies(ability: &AbilityDef) -> bool {
    ability.effects.iter().any(|e| e["kind"] == "spotlight")
}

fn summons_something(ability: &AbilityDef) -> bool {
    ability.effects.iter().any(|e| e["kind"] == "summon")
}

fn arms_countdown(ability: &AbilityDef) -> bool {
    ability.effects.iter().any(|e| e["kind"] == "countdown")
}

fn swarm_selector(ability: &AbilityDef) -> Option<Value> {
    ability.effects.iter().find(|e| e["kind"] == "attack" && e.get("joinedBy").is_some_and(|j| !j.is_null())).map(|e| e["joinedBy"].clone())
}

/// Whether a feature is aimed at its own side and nobody else (`worksOnItsOwnSide`).
fn works_on_its_own_side(ability: &AbilityDef) -> bool {
    let (mut own_side, mut outward) = (false, false);
    const AIMED_BY_DEFAULT: [&str; 6] = ["attack", "applyCondition", "clearCondition", "push", "markArmor", "damage"];
    walk_effects(&ability.effects, &mut |effect| {
        let Some(selector) = effect.get("target").filter(|t| !t.is_null()) else {
            if AIMED_BY_DEFAULT.contains(&effect["kind"].as_str().unwrap_or_default()) {
                outward = true;
            }
            return;
        };
        let kind = selector["kind"].as_str().unwrap_or_default();
        if kind == "adversaries" {
            own_side = true;
        }
        if ["allies", "party", "target", "hit"].contains(&kind) {
            outward = true;
        }
    });
    own_side && !outward
}

/// Whether a script is aimed at somebody (`readsATarget`): a selector that names the target, or an effect
/// whose target falls to the pick when it says nothing.
pub(super) fn reads_a_target(effects: &[Value]) -> bool {
    let mut found = false;
    let reads = |selector: Option<&Value>, found: &mut bool| {
        let Some(selector) = selector.filter(|s| !s.is_null()) else { return };
        if selector["kind"] == "target" {
            *found = true;
        }
        if selector["kind"] == "adversaries" && (selector["around"] == "target" || selector["except"] == "target") {
            *found = true;
        }
    };
    const AIMED_BY_DEFAULT: [&str; 5] = ["attack", "applyCondition", "clearCondition", "push", "markArmor"];
    walk_effects(effects, &mut |effect| {
        reads(effect.get("target"), &mut found);
        reads(effect.get("targets"), &mut found);
        if effect.get("target").is_none_or(Value::is_null) && AIMED_BY_DEFAULT.contains(&effect["kind"].as_str().unwrap_or_default()) {
            found = true;
        }
        if effect["kind"] == "check" {
            let check = &effect["check"];
            reads(check.get("targets"), &mut found);
            if check["difficulty"] == "target" && check.get("targets").is_none_or(Value::is_null) {
                found = true;
            }
        }
    });
    found
}

impl Session {
    /// A list ordered by how far it is from a creature, by id on a tie (`byDistance`).
    pub(super) fn by_distance(&self, from: &str, ids: &[String]) -> Vec<String> {
        let here = self.world.state.entity(from).map_or(NO_TILE, |e| e.tile);
        let grid = &self.world.state.grid;
        let tile = |id: &str| self.world.state.entity(id).map_or(NO_TILE, |e| e.tile);
        let mut sorted = ids.to_vec();
        sorted.sort_by(|a, b| grid.manhattan_distance(here, tile(a)).cmp(&grid.manhattan_distance(here, tile(b))).then_with(|| js::locale_cmp(a, b)));
        sorted
    }

    /// The tile a stat block's charge runs at: the nearest standing party member's (`aimedAt`).
    pub(super) fn aimed_at(&self, id: &str) -> i32 {
        let standing: Vec<String> = self.world.state.entities_of(Faction::Party).filter(|e| e.alive && e.tile != NO_TILE).map(|e| e.id.clone()).collect();
        if standing.is_empty() || self.world.state.entity(id).is_some_and(|e| e.tile == NO_TILE) {
            return NO_TILE;
        }
        let nearest = &self.by_distance(id, &standing)[0];
        self.world.state.entity(nearest).map_or(NO_TILE, |e| e.tile)
    }

    /// "Once per scene", counted under the creature's own id (`featureUsesLeft`).
    fn feature_uses_left(&self, id: &str, ability: &AbilityDef) -> f64 {
        match &ability.uses {
            None => f64::INFINITY,
            Some(uses) => js::max(0.0, uses.count - self.world.scenario.ability_uses.get(&use_key(id, &ability.id)).copied().unwrap_or(0.0)),
        }
    }

    /// Whether the GM can pay for a stat block's reaction right now (`affordableReaction`).
    pub(super) fn affordable_reaction(&self, id: &str, ability: &AbilityDef) -> bool {
        let Some(entity) = self.world.state.entity(id) else { return false };
        if ability.cost.stress.unwrap_or(0.0) > unmarked(&entity.stress) {
            return false;
        }
        if feature_bad(ability, true) > self.world.state.bad.value {
            return false;
        }
        self.feature_uses_left(id, ability) > 0.0
    }

    /// Whether one creature is what an ability is looking for, read from the user's chair (`worthAiming`).
    pub fn worth_aiming(&mut self, user: &str, ability: &AbilityDef, candidate: &str) -> bool {
        let Some(when) = &ability.target.when else { return true };
        let was = self.world.scenario.actor_id.replace(user.to_string());
        let holds = evaluate(when, &mut self.world, &bindings(&[candidate.to_string()], &[candidate.to_string()]), false);
        self.world.scenario.actor_id = was;
        holds
    }

    /// Who a feature that spotlights allies could hand a turn to (`spotlightCandidates`).
    fn spotlight_candidates(&mut self, id: &str, ability: &AbilityDef) -> Vec<String> {
        let was = self.world.scenario.actor_id.replace(id.to_string());
        let mut called: Vec<String> = Vec::new();
        for effect in &ability.effects {
            if effect["kind"] != "spotlight" {
                continue;
            }
            let selector = effect.get("targets").filter(|t| !t.is_null()).cloned().unwrap_or_else(|| json!({ "kind": "adversaries", "range": "far" }));
            for other in self.world.resolve_targets(&selector, &TargetBindings::default()) {
                if other != id && !(self.world.spotlight_spent)(&other) && !called.contains(&other) {
                    called.push(other);
                }
            }
        }
        self.world.scenario.actor_id = was;
        called
    }

    /// A feature this adversary would rather use than swing, and who it is aimed at (`adversaryFeature`).
    pub(super) fn adversary_feature(&mut self, id: &str) -> Option<(AbilityDef, Vec<String>)> {
        if !self.in_combat() {
            return None;
        }
        if self.gm_turn.as_ref().is_some_and(|t| t.features.iter().any(|f| f == id)) {
            return None;
        }
        let entity = self.world.state.entity(id)?.clone();
        let def = self.stat_block(id);
        let was = self.world.scenario.actor_id.replace(id.to_string());
        let chosen = self.choose_feature(id, &entity.stress, &def.id);
        self.world.scenario.actor_id = was;
        chosen
    }

    fn choose_feature(&mut self, id: &str, stress: &crate::rules::resources::MarkPool, definition: &str) -> Option<(AbilityDef, Vec<String>)> {
        let mut aimed: Option<(AbilityDef, Vec<String>)> = None;
        let mut itself: Option<(AbilityDef, Vec<String>)> = None;
        let abilities: Vec<AbilityDef> = self.world.abilities_for_adversary(definition).into_iter().cloned().collect();
        for ability in abilities {
            if ability.kind != crate::content::abilities::AbilityKind::Action || ability.effects.is_empty() {
                continue;
            }
            if ability.cost.stress.unwrap_or(0.0) > unmarked(stress) {
                continue;
            }
            if feature_bad(&ability, false) > self.world.state.bad.value {
                continue;
            }
            if self.feature_uses_left(id, &ability) <= 0.0 {
                continue;
            }
            if !evaluate_optional(ability.available.as_ref(), &mut self.world, &TargetBindings::default(), false) {
                continue;
            }
            let selector = json!({ "kind": "allies", "range": ability.target.range });
            let candidates = self.world.resolve_targets(&selector, &TargetBindings::default());
            let caught: Vec<String> = candidates.into_iter().filter(|c| self.worth_aiming(id, &ability, c)).collect();
            if let Some(swarm) = swarm_selector(&ability) {
                if caught.is_empty() {
                    continue;
                }
                let at = self.by_distance(id, &caught)[0].clone();
                let joining: Vec<String> = self.world.resolve_targets(&swarm, &bindings(&[at.clone()], &[])).into_iter().filter(|j| j != id && !(self.world.spotlight_spent)(j)).collect();
                if !joining.is_empty() {
                    return Some((ability, vec![at]));
                }
                continue;
            }
            if reads_a_target(&ability.effects) {
                if aimed.is_none() && !caught.is_empty() {
                    let nearest = self.by_distance(id, &caught)[0].clone();
                    aimed = Some((ability, vec![nearest]));
                }
                continue;
            }
            if spotlights_allies(&ability) {
                let called = self.spotlight_candidates(id, &ability);
                if called.is_empty() || feature_bad(&ability, false) > called.len() as f64 {
                    continue;
                }
                if itself.is_none() {
                    itself = Some((ability, Vec::new()));
                }
                continue;
            }
            if ability.target.kind == "self" || summons_something(&ability) || arms_countdown(&ability) || works_on_its_own_side(&ability) {
                if itself.is_none() {
                    itself = Some((ability, Vec::new()));
                }
                continue;
            }
            if caught.len() >= 2 {
                return Some((ability, Vec::new()));
            }
        }
        aimed.or(itself)
    }

    /// Play one, paying for it, and count the fight again (`useAdversaryFeature`).
    pub(super) fn use_adversary_feature(&mut self, id: &str, ability: &AbilityDef, targets: &[String]) -> Result<(), String> {
        if let Some(turn) = self.gm_turn.as_mut() {
            if !turn.features.iter().any(|f| f == id) {
                turn.features.push(id.to_string());
            }
        }
        self.spend_feature_cost(id, ability, false);
        self.run_adversary_script(id, ability, targets, &[], Left::default())?;
        self.settle_fight()
    }

    /// What using a feature costs the GM: Shadow out of the pool, a use off the card (`spendFeatureCost`).
    pub(super) fn spend_feature_cost(&mut self, id: &str, ability: &AbilityDef, as_reaction: bool) {
        let bad = feature_bad(ability, as_reaction);
        if bad > 0.0 {
            self.world.state.bad.value = js::max(0.0, self.world.state.bad.value - bad);
            note(self, &format!("The GM spends {} Shadow.", js::number_to_string(bad)), "bad");
        }
        if ability.uses.is_some() {
            let key = use_key(id, &ability.id);
            let used = self.world.scenario.ability_uses.get(&key).copied().unwrap_or(0.0);
            self.world.scenario.ability_uses.set(&key, used + 1.0);
        }
    }

    /// The features that answer the spotlight itself (`playSpotlightReactions`): whether one ended the turn.
    pub(super) fn play_spotlight_reactions(&mut self, id: &str) -> Result<bool, String> {
        if self.world.state.entity(id).is_none() {
            return Ok(false);
        }
        let mut ended = false;
        for ability in self.world.reactions_for(id, "spotlighted", None) {
            if ability.effects.is_empty() || !self.affordable_reaction(id, &ability) {
                continue;
            }
            if spotlights_allies(&ability) && self.spotlight_candidates(id, &ability).is_empty() {
                continue;
            }
            self.spend_feature_cost(id, &ability, true);
            if self.run_adversary_script(id, &ability, &[], &[], Left::default())? {
                ended = true;
            }
        }
        Ok(ended)
    }

    /// A stat block's script, with the creature acting (`runAdversaryScript`): whether it ended the turn.
    pub(super) fn run_adversary_script(&mut self, id: &str, ability: &AbilityDef, targets: &[String], hit: &[String], from: Left) -> Result<bool, String> {
        let stress = ability.cost.stress.unwrap_or(0.0);
        if stress > 0.0 {
            self.world.mark_stress(id, stress);
        }
        let who = the_name_of(self, id, false);
        note(self, &format!("{who} uses {}.", ability.name), "combat");
        let was = self.world.scenario.actor_id.replace(id.to_string());
        let point = self.aimed_at(id);
        let options = RunnerOptions {
            targets: Some(targets.to_vec()),
            hit: Some(hit.to_vec()),
            roll_as: Some("actor".into()),
            point: (point != NO_TILE).then_some(point),
            counts: from.counts,
            last_damage: from.last_damage,
            roll: from.roll,
            ..RunnerOptions::default()
        };
        let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
        runner.run(&ability.effects);
        let journal = runner.entries().to_vec();
        drop(runner);
        self.record(&journal)?;
        self.world.scenario.actor_id = was;
        self.after_adversary_script(&journal);
        Ok(journal.iter().any(|entry| entry["kind"] == "spotlightEnded"))
    }

    // ---- countdowns -------------------------------------------------------------------------------------

    /// Advance every countdown this cue speaks to, and play the ones that reach 0 (`tickCountdowns`).
    pub(super) fn tick_countdowns(&mut self, cue: &CountdownCue) -> Result<(), String> {
        let moved = self.world.advance_countdowns(cue, &mut self.rng).map_err(|e| e.0)?;
        for one in moved {
            self.play_countdown(one)?;
        }
        Ok(())
    }

    /// Say what a countdown did, and run its effects if it went off (`playCountdown`).
    pub(super) fn play_countdown(&mut self, moved: CountdownMoved) -> Result<(), String> {
        if !moved.fired {
            note(self, &format!("{}: {} to go.", moved.countdown.name, js::number_to_string(moved.value)), "bad");
            return Ok(());
        }
        note(self, &format!("{} triggers.", moved.countdown.name), "bad");
        self.run_countdown(&moved.countdown)
    }

    /// A countdown going off, with the creature that armed it acting (`runCountdown`).
    fn run_countdown(&mut self, countdown: &RunningCountdown) -> Result<(), String> {
        let was = std::mem::replace(&mut self.world.scenario.actor_id, countdown.owner.clone());
        let aim = match &countdown.owner {
            Some(owner) if self.world.state.entity(owner).map(|e| e.faction) == Some(Faction::Adversary) => self.aimed_at(owner),
            _ => NO_TILE,
        };
        let options = RunnerOptions { targets: Some(Vec::new()), hit: Some(Vec::new()), roll_as: Some("actor".into()), point: (aim != NO_TILE).then_some(aim), ..RunnerOptions::default() };
        let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
        runner.run(&countdown.effects);
        let journal = runner.entries().to_vec();
        drop(runner);
        self.record(&journal)?;
        self.world.scenario.actor_id = was;
        self.after_adversary_script(&journal);
        self.settle_fight()
    }
}
