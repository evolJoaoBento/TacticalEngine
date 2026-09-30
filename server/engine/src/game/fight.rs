//! The fight, begun and put away (`startEncounter`, `settleFight`, `closeFight`, and a script's or a
//! creature's say in them): a trigger, a script's Start a fight or a creature turned hostile begins one,
//! a script's End a fight stands every enemy down, and a fight that is over is put away once.
//!
//! What a fight *plays* - the swings, the GM's turn, the answers to a blow, the death moves - is the next
//! part's. `settle_fight` is ported step for step, and each step either runs or, when it would have
//! something to answer that is not here yet - a blow, a crossing into ground that bites, somebody down, a
//! countdown moved - refuses with an error naming it. Nothing is answered quietly.

use super::log::note;
use super::session::Session;
use crate::combat::encounter::{EncounterOutcome, EncounterRunner};
use crate::scene::state::Faction;
use serde_json::Value;

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// What is not played yet, and waits for the fight.
pub(super) fn not_yet(what: &str) -> String {
    format!("{what} comes with the fight, which the server does not play yet")
}

impl Session {
    /// Begin a fight (`startEncounter`). The same fight still going is kept; one that has ended is begun
    /// afresh; and whoever a script stood down is hostile again the moment any fight in the room begins.
    pub fn start_encounter(&mut self, encounter_id: &str) {
        if self.encounter.as_ref().is_some_and(|e| e.encounter_id == encounter_id && e.outcome() == EncounterOutcome::Ongoing) {
            return;
        }
        let truced: Vec<String> = self.world.state.all_entities().iter().filter(|c| c.truce == Some(true)).map(|c| c.id.clone()).collect();
        for id in truced {
            self.world.state.entity_mut(&id).expect("standing").truce = None;
            self.world.state.set_attitude(&id, "hostile");
        }
        let mut runner = EncounterRunner::new(encounter_id, None, None);
        runner.start(&mut self.world.state);
        self.encounter = Some(runner);
        self.announced = false;
    }

    /// A journal's fights (`reactToAttitudes`, `beginScriptedFights`, `stopScriptedFights`): a creature
    /// turned hostile with no fight running starts its encounter's; a script's Start a fight begins one where
    /// there is somebody to fight; a script's End a fight stands every enemy still standing down.
    pub(super) fn react_to_fights(&mut self, journal: &[Value]) {
        for entry in journal {
            if entry["kind"] != "attitude" || entry["attitude"] != "hostile" || self.in_combat() {
                continue;
            }
            let Some((_, encounter)) = self.placement_of(entry["id"].as_str().unwrap_or_default()) else { continue };
            if self.encounter.as_ref().is_some_and(|e| e.encounter_id == encounter) {
                self.encounter = None;
            }
            self.start_encounter(&encounter);
        }
        for entry in journal {
            if entry["kind"] != "encounter" || entry["change"] != "started" || self.in_combat() {
                continue;
            }
            let id = entry["id"].as_str().unwrap_or_default();
            if !list(&self.scene, "encounters").iter().any(|e| e["id"] == id) {
                continue;
            }
            let somebody = self.world.state.all_entities().iter().any(|c| c.alive && (c.faction == Faction::Adversary || c.truce == Some(true)));
            if !somebody {
                continue;
            }
            if self.encounter.as_ref().is_some_and(|e| e.encounter_id == id) {
                self.encounter = None;
            }
            self.start_encounter(id);
        }
        for entry in journal {
            if entry["kind"] != "encounter" || entry["change"] != "ended" || !self.in_combat() {
                continue;
            }
            let id = entry["id"].as_str().unwrap_or_default();
            let placed: Vec<String> = list(&self.scene, "encounters")
                .iter()
                .find(|e| e["id"] == id)
                .map(|e| list(e, "adversaries").iter().map(|p| p["id"].as_str().unwrap_or_default().to_string()).collect())
                .unwrap_or_default();
            let in_it = self.encounter.as_ref().is_some_and(|e| e.encounter_id == id) || placed.iter().any(|p| self.world.state.entity(p).is_some_and(|e| e.faction == Faction::Adversary));
            if !in_it {
                continue;
            }
            let standing: Vec<String> = self.world.state.entities_of(Faction::Adversary).filter(|e| e.alive).map(|e| e.id.clone()).collect();
            for creature in standing {
                self.world.state.set_attitude(&creature, "friendly");
                self.world.state.entity_mut(&creature).expect("standing").truce = Some(true);
            }
            self.encounter.as_mut().expect("a fight").end(&mut self.world.state, EncounterOutcome::Stopped);
            self.close_fight();
        }
    }

    /// After anything that may have changed the fight (`settleFight`): the ground read again, every question
    /// the moment raises asked, and who is left standing counted. Every question is the next part's, so one
    /// that has anything to ask is refused.
    pub fn settle_fight(&mut self) -> Result<(), String> {
        self.world.refresh_zones();
        if !self.world.drain_entered().is_empty() {
            return Err(not_yet("Ground that bites somebody who walked onto it"));
        }
        if !self.world.drain_damage().is_empty() {
            return Err(not_yet("Answering a blow"));
        }
        if self.pending.is_none() {
            for entity in self.world.state.entities_of(Faction::Adversary) {
                let Some((placement, _)) = self.placement_of(&entity.id) else { continue };
                let interaction = &placement["interaction"];
                if interaction["kind"] != "threshold" || !entity.alive || entity.interacted == Some(true) {
                    continue;
                }
                let left = entity.hit_points.max - entity.hit_points.marked;
                if left * 100.0 <= interaction["percent"].as_f64().unwrap_or(50.0) * entity.hit_points.max {
                    return Err(not_yet("A creature stopping to talk at its threshold"));
                }
            }
        }
        if self.world.state.entities_of(Faction::Adversary).any(|e| !e.alive) {
            return Err(not_yet("A creature's fall"));
        }
        if self.pending.is_none() && self.world.state.entities_of(Faction::Party).any(|e| !e.alive && e.dead != Some(true)) {
            return Err(not_yet("A death move"));
        }
        if self.pending.is_none() {
            if let Some(encounter) = self.encounter.as_mut() {
                encounter.settle_if_decided(&mut self.world.state);
            }
        }
        if !self.world.reap_countdowns().is_empty() {
            return Err(not_yet("A countdown a death sets off"));
        }
        self.close_fight();
        Ok(())
    }

    /// Put a fight that is over away, once (`closeFight`): what lasts a scene ends, the creatures'
    /// countdowns stop, the pools are fitted, what is used or filled once a scene is given back, and the
    /// log says how it ended.
    pub fn close_fight(&mut self) {
        let Some(encounter) = self.encounter.as_ref() else { return };
        let outcome = encounter.outcome();
        if outcome == EncounterOutcome::Ongoing || self.announced {
            return;
        }
        self.announced = true;
        self.world.state.clear_conditions("scene");
        self.world.end_creature_countdowns();
        self.sync_pools();
        let abilities: Vec<Value> = list(&self.project, "abilities").to_vec();
        let per_scene = |key: &str, field: &str, value: &str| abilities.iter().find(|a| key.ends_with(&format!("/{}", a["id"].as_str().unwrap_or_default()))).is_some_and(|a| a[field][if field == "uses" { "per" } else { "refill" }] == value);
        let uses: Vec<String> = self.world.scenario.ability_uses.entries().iter().map(|(k, _)| k.clone()).collect();
        for key in uses {
            if per_scene(&key, "uses", "scene") {
                self.world.scenario.ability_uses.delete(&key);
            }
        }
        let tokens: Vec<String> = self.world.scenario.ability_tokens.entries().iter().map(|(k, _)| k.clone()).collect();
        for key in tokens {
            if per_scene(&key, "tokens", "scene") {
                self.world.scenario.ability_tokens.delete(&key);
            }
        }
        let (text, tone) = match outcome {
            EncounterOutcome::Victory if self.world.state.entities_of(Faction::Adversary).next().is_none() => ("Nobody is left who wants a fight. It is over.", "success"),
            EncounterOutcome::Victory => ("The last of them falls. The fight is over.", "success"),
            EncounterOutcome::Stopped => ("The fight stops. Nobody raises a weapon.", "system"),
            _ => ("The party falls.", "bad"),
        };
        note(self, text, tone);
    }
}
