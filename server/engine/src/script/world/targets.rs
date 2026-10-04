//! Who a target selector names: living, in a stable order - the actor, the party, a creature by id, the
//! chosen target, whoever the last roll hit, allies or adversaries within a band of the actor, the target
//! or a tile, and whoever stands along a charge's line. `entities_for` is the same reach for the writes
//! that touch the fallen too.

use super::SceneScriptWorld;
use crate::grid::tile_grid::NO_TILE;
use crate::rules::range::{reaches, RangeBand};
use crate::scene::state::Faction;
use crate::script::conditions::TargetBindings;
use serde_json::Value;

fn text<'a>(selector: &'a Value, key: &str) -> Option<&'a str> {
    selector.get(key).and_then(Value::as_str)
}

fn band(selector: &Value, key: &str) -> Option<RangeBand> {
    text(selector, key).and_then(RangeBand::from_name)
}

fn count(selector: &Value) -> Option<usize> {
    selector.get("nearest").and_then(Value::as_f64).map(|n| n as usize)
}

impl<'w> SceneScriptWorld<'w> {
    fn living(&self, ids: &[String]) -> Vec<String> {
        ids.iter().filter(|id| self.state.entity(id).is_some_and(|e| e.alive)).cloned().collect()
    }

    /// Who a selector names, living and in a stable order.
    pub fn resolve_targets(&self, selector: &Value, bindings: &TargetBindings) -> Vec<String> {
        let actor = self.scenario.actor_id.clone();
        match text(selector, "kind").unwrap_or_default() {
            "actor" => actor.filter(|id| self.state.entity(id).is_some()).into_iter().collect(),
            "party" => self.state.entities_of(Faction::Party).filter(|e| e.alive).map(|e| e.id.clone()).collect(),
            "entity" => text(selector, "id").filter(|id| self.state.entity(id).is_some()).map(str::to_string).into_iter().collect(),
            "entities" => {
                let ids: Vec<String> = selector.get("ids").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default();
                self.living(&ids)
            }
            "target" => self.living(&bindings.targets),
            "hit" => {
                let having = text(selector, "having");
                let beaten: Vec<String> = self.living(&bindings.hit).into_iter().filter(|id| having.is_none_or(|c| self.has_condition(id, c))).collect();
                match (count(selector), actor) {
                    (Some(n), Some(actor)) => self.nearest_first(&actor, &beaten).into_iter().take(n).collect(),
                    _ => beaten,
                }
            }
            "allies" => self.allies(selector, bindings, actor),
            "inPath" => {
                let from = actor.as_deref().map_or(NO_TILE, |a| self.tile_of(a));
                let range = band(selector, "range");
                let reach = match (text(selector, "reach"), &actor) {
                    (Some("weapon"), Some(actor)) => self.weapon_range(actor).or(range).unwrap_or(RangeBand::Melee),
                    _ => range.unwrap_or(RangeBand::Melee),
                };
                let except: Vec<String> = actor.iter().cloned().collect();
                let caught = self.along_path(from, bindings.point.unwrap_or(NO_TILE), reach, &except);
                match text(selector, "side") {
                    None => caught,
                    Some(side) => {
                        let want = if side == "allies" { Faction::Party } else { Faction::Adversary };
                        caught.into_iter().filter(|id| self.state.entity(id).is_some_and(|e| e.faction == want)).collect()
                    }
                }
            }
            "adversaries" => self.adversaries(selector, bindings, actor),
            _ => Vec::new(),
        }
    }

    fn allies(&self, selector: &Value, bindings: &TargetBindings, actor: Option<String>) -> Vec<String> {
        let include_self = selector.get("includeSelf") == Some(&Value::Bool(true));
        let range = band(selector, "range");
        let around = text(selector, "around");
        if around == Some("point") {
            let at = bindings.point.unwrap_or(NO_TILE);
            if at == NO_TILE {
                return Vec::new();
            }
            return self
                .state
                .entities_of(Faction::Party)
                .filter(|e| e.alive && e.tile != NO_TILE && (include_self || Some(&e.id) != actor.as_ref()))
                .filter(|e| self.band_between(at, e.tile).is_some_and(|b| range.is_none_or(|r| reaches(b, r))))
                .map(|e| e.id.clone())
                .collect();
        }
        let left: Option<&[String]> = (text(selector, "except") == Some("target")).then_some(&bindings.targets);
        // Measured from the one the script is aimed at, or from the one casting it.
        let from = if around == Some("target") { bindings.targets.first().cloned() } else { actor.clone() };
        if around == Some("target") && from.is_none() {
            return Vec::new();
        }
        let standing: Vec<String> = self
            .state
            .entities_of(Faction::Party)
            .filter(|e| e.alive && (include_self || Some(&e.id) != actor.as_ref()))
            .filter(|e| !left.is_some_and(|l| l.contains(&e.id)))
            .filter(|e| match (range, &from) {
                (Some(r), Some(from)) => self.within(from, &e.id, r),
                _ => true,
            })
            .map(|e| e.id.clone())
            .collect();
        match (count(selector), from) {
            (Some(n), Some(from)) => self.nearest_first(&from, &standing).into_iter().take(n).collect(),
            _ => standing,
        }
    }

    fn adversaries(&self, selector: &Value, bindings: &TargetBindings, actor: Option<String>) -> Vec<String> {
        let range = band(selector, "range").unwrap_or(RangeBand::OutOfRange);
        if text(selector, "around") == Some("point") {
            let at = bindings.point.unwrap_or(NO_TILE);
            if at == NO_TILE {
                return Vec::new();
            }
            let ids: Vec<String> = self
                .state
                .entities_of(Faction::Adversary)
                .filter(|e| e.alive && e.tile != NO_TILE && self.band_between(at, e.tile).is_some_and(|b| reaches(b, range)))
                .map(|e| e.id.clone())
                .collect();
            return match count(selector) {
                None => ids,
                Some(n) => self.nearest_to_tile(at, &ids).into_iter().take(n).collect(),
            };
        }
        let origin = if text(selector, "around") == Some("target") { bindings.targets.first().cloned() } else { actor.clone() };
        let Some(origin) = origin else { return Vec::new() };
        let left: Vec<String> = match text(selector, "except") {
            Some("target") => bindings.targets.clone(),
            Some("actor") => actor.iter().cloned().collect(),
            _ => Vec::new(),
        };
        // "All Giant Rats": the stat block of the one acting; a creature with no block names nobody.
        let kind: Option<String> = (selector.get("sameKind") == Some(&Value::Bool(true))).then(|| actor.as_deref().and_then(|a| self.state.entity(a)).map(|e| e.definition.clone()).unwrap_or_default());
        let reach = if text(selector, "reach") == Some("weapon") { actor.as_deref().and_then(|a| self.weapon_range(a)).unwrap_or(range) } else { range };
        let standing: Vec<String> = self
            .state
            .entities_of(Faction::Adversary)
            .filter(|e| e.alive && !left.contains(&e.id) && kind.as_ref().is_none_or(|k| e.definition == *k))
            .filter(|e| self.within(&origin, &e.id, reach))
            .map(|e| e.id.clone())
            .collect();
        match count(selector) {
            None => standing,
            Some(n) => self.nearest_first(&origin, &standing).into_iter().take(n).collect(),
        }
    }

    /// The creatures a write reaches: as `resolve_targets` names them, save that a creature named outright
    /// - by id, or the actor - is taken fallen or not, since a heal is how one gets up.
    pub(super) fn entities_for(&self, target: &Value, bindings: &TargetBindings) -> Vec<String> {
        match text(target, "kind").unwrap_or_default() {
            "entity" => text(target, "id").filter(|id| self.state.entity(id).is_some()).map(str::to_string).into_iter().collect(),
            "actor" => self.scenario.actor_id.clone().filter(|id| self.state.entity(id).is_some()).into_iter().collect(),
            _ => self.resolve_targets(target, bindings).into_iter().filter(|id| self.state.entity(id).is_some()).collect(),
        }
    }
}
