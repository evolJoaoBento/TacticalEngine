//! The fight, begun and put away (`startEncounter`, `settleFight`, `closeFight`, and a script's or a
//! creature's say in them): a trigger, a script's Start a fight or a creature turned hostile begins one,
//! a script's End a fight stands every enemy down, and a fight that is over is put away once.
//!
//! `settle_fight` is what every blow, script and turn ends on: the ground read again, what the moment
//! raises answered (ground that bites, the wounds, a creature at its threshold, a creature's last word, a
//! party member's death move), who is left standing counted, the countdowns a death sets off, and a fight
//! that is over put away. The death move is Avoid Death while nobody at the table is asked, and put to the
//! table (`ask`) when somebody is.

use super::features::Left;
use super::log::note;
use super::session::Session;
use crate::combat::encounter::{EncounterOutcome, EncounterRunner};
use crate::rules::duality::GOOD_DIE_SIDES;
use crate::scene::state::Faction;
use crate::script::conditions::TargetBindings;
use serde_json::{json, Value};

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
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
            // Stopped mid-turn, the GM's turn goes with it.
            self.end_the_turn();
            self.encounter.as_mut().expect("a fight").end(&mut self.world.state, EncounterOutcome::Stopped);
            self.close_fight();
        }
    }

    /// After anything that may have changed the fight (`settleFight`): the ground read again, every question
    /// the moment raises answered, who is left standing counted, and a fight that is over put away.
    pub fn settle_fight(&mut self) -> Result<(), String> {
        self.world.refresh_zones();
        self.play_zone_entries()?;
        self.play_damage_reactions()?;
        self.play_turnings()?;
        self.play_defeat_reactions()?;
        self.play_death_moves()?;
        if !self.waiting() {
            if let Some(encounter) = self.encounter.as_mut() {
                encounter.settle_if_decided(&mut self.world.state);
            }
        }
        for moved in self.world.reap_countdowns() {
            self.play_countdown(moved)?;
        }
        self.close_fight();
        Ok(())
    }

    /// A creature a wound left at its threshold stops to talk (`playTurnings`): friendly, and a conversation
    /// with whoever is selected.
    fn play_turnings(&mut self) -> Result<(), String> {
        if self.waiting() {
            return Ok(());
        }
        let creatures: Vec<String> = self.world.state.entities_of(Faction::Adversary).map(|e| e.id.clone()).collect();
        for id in creatures {
            let Some((placement, _)) = self.placement_of(&id) else { continue };
            let interaction = placement["interaction"].clone();
            let Some(entity) = self.world.state.entity(&id) else { continue };
            if interaction["kind"] != "threshold" || !entity.alive || entity.interacted == Some(true) {
                continue;
            }
            let left = entity.hit_points.max - entity.hit_points.marked;
            if left * 100.0 > interaction["percent"].as_f64().unwrap_or(50.0) * entity.hit_points.max {
                continue;
            }
            self.world.state.entity_mut(&id).expect("standing").interacted = Some(true);
            if self.world.state.set_attitude(&id, "friendly") {
                self.record(&[json!({ "kind": "attitude", "id": id, "attitude": "friendly" })])?;
            }
            let actor = self.party.selected().map(str::to_string).or_else(|| self.world.state.entities_of(Faction::Party).find(|m| m.alive).map(|m| m.id.clone()));
            if let Some(actor) = actor {
                let dialogue = interaction["dialogue"].as_str().unwrap_or_default().to_string();
                self.converse(&actor, &id, &dialogue)?;
            }
            return Ok(());
        }
        Ok(())
    }

    /// The last thing a stat block does (`playDefeatReactions`): once for each creature that falls.
    pub(super) fn play_defeat_reactions(&mut self) -> Result<(), String> {
        let fallen: Vec<(String, u64)> = self.world.state.entities_of(Faction::Adversary).filter(|e| !e.alive).map(|e| (e.id.clone(), e.serial.0)).collect();
        for (id, serial) in fallen {
            if self.mourned.contains(&serial) {
                continue;
            }
            self.mourned.push(serial);
            for ability in self.world.reactions_for(&id, "defeated", None) {
                if ability.effects.is_empty() || !self.affordable_reaction(&id, &ability) {
                    continue;
                }
                self.spend_feature_cost(&id, &ability, true);
                self.run_adversary_script(&id, &ability, &[], &[], Left::default())?;
            }
        }
        Ok(())
    }

    /// "When a PC marks their last Hit Point, they must make a death move" (`playDeathMoves`): one at a time,
    /// before anybody counts who is left standing. With nobody asked, it is Avoid Death.
    pub(super) fn play_death_moves(&mut self) -> Result<(), String> {
        if self.waiting() {
            return Ok(());
        }
        let members: Vec<String> = self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
        for id in members {
            let Some(entity) = self.world.state.entity(&id) else { continue };
            let serial = entity.serial.0;
            if entity.alive {
                self.fallen.retain(|&s| s != serial);
                continue;
            }
            if entity.dead == Some(true) || self.fallen.contains(&serial) {
                continue;
            }
            let Some(name) = self.characters.get(&id).map(|c| c.sheet.name.clone()) else { continue };
            self.fallen.push(serial);
            note(self, &format!("{name} marks their last Hit Point."), "bad");
            if let Some(sigil) = self.world.instead_of_death(&id) {
                self.world.clear_condition(&id, &sigil.condition);
                self.world.heal(&json!({ "kind": "entity", "id": id }), sigil.clears, &TargetBindings::default());
                self.fallen.retain(|&s| s != serial);
                note(self, &format!("{name}: {}", sigil.says), "good");
                continue;
            }
            if !self.ask_defender {
                self.avoid_death(&id)?;
                continue;
            }
            let offers = self.death_offers(&id)?;
            self.ask_death_move(&id, offers);
            return Ok(());
        }
        Ok(())
    }

    /// "They temporarily drop unconscious... roll your Light Die" (`avoidDeath`).
    pub(super) fn avoid_death(&mut self, id: &str) -> Result<(), String> {
        let Some((name, level)) = self.characters.get(id).map(|c| (c.sheet.name.clone(), c.sheet.level)) else { return Ok(()) };
        note(self, &format!("{name} drops unconscious."), "system");
        let good = self.rng.die(GOOD_DIE_SIDES).map_err(|e| e.0)?;
        if f64::from(good) > level {
            note(self, &format!("The Light Die reads {good}: no scar this time."), "system");
            return Ok(());
        }
        self.scar(id, good)
    }

    /// "Permanently cross out a Light slot" (`scar`).
    fn scar(&mut self, id: &str, rolled: u32) -> Result<(), String> {
        let Some(character) = self.characters.get(id).cloned() else { return Ok(()) };
        let Some(held) = self.world.state.entity(id).map(|e| e.good.unwrap_or(character.good)) else { return Ok(()) };
        let sheet = self.sheets.get(id).cloned().unwrap_or_else(|| character.sheet.clone());
        let scars = sheet.scars.unwrap_or(0.0) + 1.0;
        self.set_sheet(crate::character::sheet::CharacterSheet { scars: Some(scars), ..sheet })?;
        let max = crate::js::max(0.0, held.max - 1.0);
        self.world.state.entity_mut(id).expect("standing").good = Some(crate::rules::resources::Currency { max, value: crate::js::min(held.value, max) });
        let name = character.sheet.name.clone();
        note(self, &format!("The Light Die reads {rolled}. {name} takes a scar: a Light slot crossed out for good."), "bad");
        if max > 0.0 {
            return Ok(());
        }
        self.world.state.entity_mut(id).expect("standing").dead = Some(true);
        note(self, &format!("That was the last slot. {name}'s journey ends here."), "bad");
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
