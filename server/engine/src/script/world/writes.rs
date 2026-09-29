//! What a script changes outside a fight's dice: flags, items, variables, quests, the level granted, the
//! room's things and encounters, and a creature's pools - Hit Points marked outright or healed, a death
//! written or undone, Stress, Armor Slots, Light, the GM's Shadow, conditions - with every blow that landed
//! noted for the features that answer it.

use super::{Blow, DamageNote, QuestProgress, SceneScriptWorld};
use crate::content::items::roll_loot;
use crate::js;
use crate::rng::Rng;
use crate::rules::damage::{hp_for_severity, DamageSeverity};
use crate::rules::resources::{clear, gain, mark_hit_points, mark_stress, spend, unmarked};
use crate::scene::state::ConditionDuration;
use crate::script::conditions::TargetBindings;
use crate::script::runner::{LootDrop, StressMarked};
use serde_json::Value;

impl<'w> SceneScriptWorld<'w> {
    pub fn set_flag(&mut self, flag: &str) {
        if !self.has_flag(flag) {
            self.scenario.flags.push(flag.to_string());
        }
    }

    pub fn clear_flag(&mut self, flag: &str) {
        self.scenario.flags.retain(|f| f != flag);
    }

    /// Draw from one of the project's tables. An unknown table finds nothing.
    pub fn roll_loot(&self, table: Option<&str>, rng: &mut Rng) -> Vec<LootDrop> {
        match table.and_then(|t| self.content.loot_tables.get(t)) {
            Some(found) => roll_loot(found, rng).expect("a loot table's quantities are ranges of whole numbers"),
            None => Vec::new(),
        }
    }

    pub fn add_item(&mut self, item: &str, quantity: f64) -> f64 {
        if quantity <= 0.0 {
            return self.item_count(item);
        }
        let next = self.item_count(item) + quantity;
        self.scenario.items.set(item, next);
        next
    }

    /// Take some away, and report how many actually went: never more than the party has.
    pub fn remove_item(&mut self, item: &str, quantity: f64) -> f64 {
        let held = self.item_count(item);
        let taken = js::max(0.0, js::min(held, quantity));
        if taken == 0.0 {
            return 0.0;
        }
        if held - taken == 0.0 {
            self.scenario.items.delete(item);
        } else {
            self.scenario.items.set(item, held - taken);
        }
        taken
    }

    pub fn gain_good(&mut self) -> bool {
        match self.scenario.actor_id.clone() {
            Some(id) => self.gain_good_for(&id, 1.0) > 0.0,
            None => false,
        }
    }

    /// "Steal a number of Shadow from the GM": an empty pool is nothing stolen rather than a refusal.
    pub fn lose_bad(&mut self) -> bool {
        if self.state.bad.value <= 0.0 {
            return false;
        }
        self.state.bad.value -= 1.0;
        true
    }

    pub fn gain_bad(&mut self) -> bool {
        let result = gain(&self.state.bad, 1.0);
        self.state.bad = result.currency;
        result.applied > 0.0
    }

    pub fn grant_level(&mut self, level: Option<f64>) -> Option<f64> {
        let target = js::min(10.0, level.unwrap_or(self.scenario.party_level + 1.0));
        if target <= self.scenario.party_level {
            return None;
        }
        self.scenario.party_level = target;
        Some(target)
    }

    // Completed and failed are terminal; finishing is explicit - ticking the last objective does not
    // complete a quest.

    pub fn start_quest(&mut self, quest: &str) -> bool {
        if self.scenario.quests.has(quest) {
            return false;
        }
        self.scenario.quests.set(quest, QuestProgress { status: "active".into(), done: Vec::new(), revealed: Vec::new() });
        true
    }

    fn active(&mut self, quest: &str) -> Option<&mut QuestProgress> {
        self.scenario.quests.get_mut(quest).filter(|p| p.status == "active")
    }

    pub fn reveal_objective(&mut self, quest: &str, objective: &str) -> bool {
        let Some(progress) = self.active(quest) else { return false };
        if progress.revealed.iter().any(|o| o == objective) || progress.done.iter().any(|o| o == objective) {
            return false;
        }
        progress.revealed.push(objective.to_string());
        true
    }

    pub fn complete_objective(&mut self, quest: &str, objective: &str) -> bool {
        let Some(progress) = self.active(quest) else { return false };
        if progress.done.iter().any(|o| o == objective) {
            return false;
        }
        progress.done.push(objective.to_string());
        true
    }

    pub fn complete_quest(&mut self, quest: &str) -> bool {
        self.finish_quest(quest, "completed")
    }

    pub fn fail_quest(&mut self, quest: &str) -> bool {
        self.finish_quest(quest, "failed")
    }

    fn finish_quest(&mut self, quest: &str, status: &str) -> bool {
        let Some(progress) = self.active(quest) else { return false };
        progress.status = status.to_string();
        true
    }

    pub fn set_var(&mut self, name: &str, value: Value) {
        self.scenario.variables.set(name, value);
    }

    pub fn mark_interactable_used(&mut self, id: &str) {
        self.state.interactable(id).used = true;
    }

    pub fn start_encounter(&mut self, id: &str) {
        let encounter = self.state.encounter(id);
        encounter.started = true;
        encounter.triggered = true;
    }

    pub fn end_encounter(&mut self, id: &str) {
        self.state.encounter(id).ended = true;
    }

    /// Hit Points marked outright - past the thresholds and any armour - and heard as a wound, with nobody
    /// named.
    pub fn damage(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64 {
        let mut total = 0.0;
        for id in self.entities_for(target, bindings) {
            let entity = self.state.entity_mut(&id).expect("named");
            let result = mark_hit_points(&entity.hit_points, amount);
            entity.hit_points = result.hit_points;
            if result.fell {
                entity.alive = false;
            }
            if result.hp_marked > 0.0 {
                self.note_damage(&id, Blow { hit_points: Some(result.hp_marked), damage: Some(amount), severe: Some(result.hp_marked >= hp_for_severity(DamageSeverity::Severe)), ..Blow::default() });
            }
            total += result.hp_marked;
        }
        total
    }

    /// Hit Points shared out a point at a time, round by round, to whoever still has one marked, in the
    /// selector's order; what nobody can use is not spent.
    pub fn heal_shared(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64 {
        let among = self.entities_for(target, bindings);
        let mut left = js::max(0.0, js::trunc(amount));
        let mut total = 0.0;
        let mut healing = true;
        while left > 0.0 && healing {
            healing = false;
            for id in &among {
                if left <= 0.0 {
                    break;
                }
                let entity = self.state.entity_mut(id).expect("named");
                if entity.hit_points.marked <= 0.0 {
                    continue;
                }
                let result = clear(&entity.hit_points, 1.0);
                if result.applied <= 0.0 {
                    continue;
                }
                entity.hit_points = result.pool;
                if entity.hit_points.marked < entity.hit_points.max && entity.dead != Some(true) {
                    entity.alive = true;
                }
                left -= result.applied;
                total += result.applied;
                healing = true;
            }
        }
        total
    }

    /// Clear Hit Points: one marked cleared stands the unconscious up; one past the veil stays down.
    pub fn heal(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64 {
        let mut total = 0.0;
        for id in self.entities_for(target, bindings) {
            let entity = self.state.entity_mut(&id).expect("named");
            let result = clear(&entity.hit_points, amount);
            entity.hit_points = result.pool;
            if result.applied > 0.0 && entity.hit_points.marked < entity.hit_points.max && entity.dead != Some(true) {
                entity.alive = true;
            }
            total += result.applied;
        }
        total
    }

    /// On their feet at full strength, whatever put them down. The chosen target is taken as named, down
    /// or not; every other selector reads the board.
    pub fn revive(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String> {
        let named: Vec<String> = if target.get("kind").and_then(Value::as_str) == Some("target") {
            bindings.targets.iter().filter(|id| self.state.entity(id).is_some()).cloned().collect()
        } else {
            self.entities_for(target, bindings)
        };
        let mut raised = Vec::new();
        for id in named {
            let entity = self.state.entity_mut(&id).expect("named");
            if entity.alive && entity.hit_points.marked == 0.0 {
                continue;
            }
            entity.hit_points.marked = 0.0;
            entity.dead = None;
            entity.alive = true;
            raised.push(id);
        }
        raised
    }

    /// Killed outright, past where a heal reaches - no thresholds crossed and no Armor Slot marked.
    pub fn slay(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String> {
        let mut killed = Vec::new();
        for id in self.entities_for(target, bindings) {
            let entity = self.state.entity_mut(&id).expect("named");
            if !entity.alive {
                continue;
            }
            entity.hit_points.marked = entity.hit_points.max;
            entity.alive = false;
            entity.dead = Some(true);
            killed.push(id);
        }
        killed
    }

    pub fn mark_stress(&mut self, id: &str, amount: f64) -> StressMarked {
        let Some(entity) = self.state.entity_mut(id) else { return StressMarked { stress_marked: 0.0, hp_marked: 0.0, fell: false } };
        let result = mark_stress(&entity.stress, &entity.hit_points, amount);
        entity.stress = result.stress;
        entity.hit_points = result.hit_points;
        if result.fell {
            entity.alive = false;
        }
        StressMarked { stress_marked: result.stress_marked, hp_marked: result.hp_marked, fell: result.fell }
    }

    pub fn clear_stress(&mut self, id: &str, amount: f64) -> f64 {
        let Some(entity) = self.state.entity_mut(id) else { return 0.0 };
        let result = clear(&entity.stress, amount);
        entity.stress = result.pool;
        result.applied
    }

    pub fn clear_armor(&mut self, id: &str, amount: f64) -> f64 {
        let Some(entity) = self.state.entity_mut(id) else { return 0.0 };
        let result = clear(&entity.armor_slots, amount);
        entity.armor_slots = result.pool;
        result.applied
    }

    pub fn mark_armor(&mut self, id: &str, amount: f64) -> f64 {
        let Some(entity) = self.state.entity_mut(id) else { return 0.0 };
        let marked = js::min(amount, unmarked(&entity.armor_slots));
        entity.armor_slots.marked += marked;
        marked
    }

    pub fn gain_good_for(&mut self, id: &str, amount: f64) -> f64 {
        let Some(good) = self.state.entity_mut(id).and_then(|e| e.good.as_mut()) else { return 0.0 };
        let result = gain(good, amount);
        *good = result.currency;
        result.applied
    }

    pub fn spend_good(&mut self, id: &str, amount: f64) -> bool {
        let Some(good) = self.state.entity_mut(id).and_then(|e| e.good.as_mut()) else { return false };
        let result = spend(good, amount);
        if !result.ok {
            return false;
        }
        *good = result.currency;
        true
    }

    /// Light taken rather than spent: never refused, and none lost from one who has none.
    pub fn lose_good(&mut self, id: &str, amount: f64) -> f64 {
        let Some(good) = self.state.entity_mut(id).and_then(|e| e.good.as_mut()) else { return 0.0 };
        let lost = js::min(good.value, amount);
        if lost <= 0.0 {
            return 0.0;
        }
        good.value -= lost;
        lost
    }

    /// "The same condition can't be stacked": false for one already borne, or on the fallen.
    pub fn apply_condition(&mut self, id: &str, condition: &str, duration: ConditionDuration) -> bool {
        let Some(entity) = self.state.entity_mut(id) else { return false };
        if !entity.alive || entity.has_condition(condition) {
            return false;
        }
        entity.conditions.push(condition.to_string());
        match entity.condition_durations.iter_mut().find(|(c, _)| c == condition) {
            Some(entry) => entry.1 = duration,
            None => entity.condition_durations.push((condition.to_string(), duration)),
        }
        true
    }

    pub fn clear_condition(&mut self, id: &str, condition: &str) -> bool {
        let Some(entity) = self.state.entity_mut(id) else { return false };
        if !entity.has_condition(condition) {
            return false;
        }
        entity.conditions.retain(|c| c != condition);
        entity.condition_durations.retain(|(c, _)| c != condition);
        true
    }

    /// Note that a blow landed, for whoever runs the fight to play what answers it; a second blow from the
    /// same hand adds to the first. The ground that answered it is spent here, where every blow passes.
    pub fn note_damage(&mut self, id: &str, blow: Blow) {
        let attacker = blow.attacker.clone();
        let at = match self.damaged.iter().position(|d| d.id == id && d.attacker == attacker) {
            Some(at) => at,
            None => {
                self.damaged.push(DamageNote { id: id.to_string(), attacker, hit_points: 0.0, damage: 0.0, types: Vec::new(), severe: false });
                self.damaged.len() - 1
            }
        };
        let entry = &mut self.damaged[at];
        entry.hit_points += blow.hit_points.unwrap_or(0.0);
        entry.damage += blow.damage.unwrap_or(0.0);
        if let Some(types) = blow.types.filter(|t| !t.is_empty()) {
            entry.types = types;
        }
        entry.severe = entry.severe || blow.severe == Some(true);
        self.grow_zones(id);
    }

    /// Severe damage with nobody named.
    pub fn note_severe(&mut self, id: &str) {
        self.note_damage(id, Blow { severe: Some(true), ..Blow::default() });
    }

    /// What has landed since the last call. Clears as it reports.
    pub fn drain_damage(&mut self) -> Vec<DamageNote> {
        std::mem::take(&mut self.damaged)
    }
}
