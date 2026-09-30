//! What outlives a scene: variables, story flags, what the party carries, who is acting, quests, the level
//! granted, limited uses and tokens, and the clocks and ground a fight is carrying - each kept in the order
//! the TypeScript's `Map`, `Set` and plain object keep it, since a snapshot and a roll-call walk them so.
//!
//! The save's schema for a snapshot is the save module's, and comes with its port.

use crate::js::JsObject;
use crate::script::countdowns::{CountdownBoard, RunningCountdown};
use crate::script::zones::RunningZone;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// A `Map`: keys in the order they were first set, a known key replaced where it stands.
#[derive(Clone, Debug, PartialEq)]
pub struct Ordered<V>(Vec<(String, V)>);

impl<V> Default for Ordered<V> {
    fn default() -> Self {
        Ordered(Vec::new())
    }
}

impl<V> Ordered<V> {
    pub fn get(&self, key: &str) -> Option<&V> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut V> {
        self.0.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn has(&self, key: &str) -> bool {
        self.0.iter().any(|(k, _)| k == key)
    }

    pub fn set(&mut self, key: &str, value: V) {
        match self.get_mut(key) {
            Some(slot) => *slot = value,
            None => self.0.push((key.to_string(), value)),
        }
    }

    pub fn delete(&mut self, key: &str) -> bool {
        let before = self.0.len();
        self.0.retain(|(k, _)| k != key);
        self.0.len() != before
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn entries(&self) -> &[(String, V)] {
        &self.0
    }

    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.0.iter().map(|(_, v)| v)
    }

    pub fn into_entries(self) -> Vec<(String, V)> {
        self.0
    }
}

/// A quest's progress. A quest with no entry has not been started.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QuestProgress {
    /// `active`, `completed` or `failed`.
    pub status: String,
    pub done: Vec<String>,
    pub revealed: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScenarioState {
    pub variables: JsObject,
    /// Story flags, set and cleared by scripts, in the order they were set - a `Set`.
    pub flags: Vec<String>,
    /// What the party is carrying, by item id, with how many of each.
    pub items: Ordered<f64>,
    /// The creature a script's `actor` selector refers to.
    pub actor_id: Option<String>,
    pub quests: Ordered<QuestProgress>,
    /// The level the party has been granted.
    pub party_level: f64,
    /// How many times each character has used each limited ability since it last refreshed: `who/which`.
    pub ability_uses: Ordered<f64>,
    /// Tokens on a card, keyed the same way.
    pub ability_tokens: Ordered<f64>,
    pub countdowns: CountdownBoard,
    /// Patches of ground that mean something, by zone id.
    pub zones: Ordered<RunningZone>,
}

/// The key `abilityUses` and `abilityTokens` file a card under.
pub fn use_key(character: &str, ability: &str) -> String {
    format!("{character}/{ability}")
}

impl Default for ScenarioState {
    fn default() -> Self {
        ScenarioState {
            variables: JsObject::default(),
            flags: Vec::new(),
            items: Ordered::default(),
            actor_id: None,
            quests: Ordered::default(),
            party_level: 1.0,
            ability_uses: Ordered::default(),
            ability_tokens: Ordered::default(),
            countdowns: CountdownBoard::default(),
            zones: Ordered::default(),
        }
    }
}

impl ScenarioState {
    /// `createScenarioState`: variables, who acts, flags and items to start from.
    pub fn new(variables: &serde_json::Map<String, Value>, actor_id: Option<&str>, flags: &[String], items: &[(String, f64)]) -> Self {
        let mut scenario = ScenarioState { actor_id: actor_id.map(str::to_string), ..ScenarioState::default() };
        for (name, value) in variables {
            scenario.variables.set(name, value.clone());
        }
        for flag in flags {
            if !scenario.flags.contains(flag) {
                scenario.flags.push(flag.clone());
            }
        }
        for (id, quantity) in items {
            scenario.items.set(id, *quantity);
        }
        scenario
    }

    /// A JSON-safe snapshot, as `scenarioSnapshot` writes it.
    pub fn snapshot(&self) -> Value {
        let pairs = |map: &Ordered<f64>| map.entries().iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>();
        json!({
            "variables": self.variables.to_json(),
            "flags": self.flags,
            "items": pairs(&self.items),
            "actorId": self.actor_id,
            "quests": self.quests.entries().iter().map(|(quest, p)| json!({ "quest": quest, "status": p.status, "done": p.done, "revealed": p.revealed })).collect::<Vec<_>>(),
            "partyLevel": self.party_level,
            "abilityUses": pairs(&self.ability_uses),
            "abilityTokens": pairs(&self.ability_tokens),
            "countdowns": self.countdowns.entries().iter().map(|(_, c)| c).collect::<Vec<_>>(),
            "zones": self.zones.values().collect::<Vec<_>>(),
        })
    }

    /// Refill from a snapshot, in place - `restoreScenario`. The snapshot is trusted, as a parsed save is;
    /// the lists a save older than them lacks read as empty.
    pub fn restore(&mut self, snapshot: &Value) -> Result<(), String> {
        let list = |key: &str| snapshot.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
        let pairs = |key: &str| -> Result<Ordered<f64>, String> {
            let mut out = Ordered::default();
            for pair in list(key) {
                let id = pair[0].as_str().ok_or_else(|| format!("{key}: an id"))?;
                out.set(id, pair[1].as_f64().ok_or_else(|| format!("{key}: a number"))?);
            }
            Ok(out)
        };
        self.variables.clear();
        for (name, value) in snapshot.get("variables").and_then(Value::as_object).cloned().unwrap_or_default() {
            self.variables.set(&name, value);
        }
        self.flags.clear();
        for flag in list("flags") {
            let flag = flag.as_str().ok_or("flags: a string")?.to_string();
            if !self.flags.contains(&flag) {
                self.flags.push(flag);
            }
        }
        self.items = pairs("items")?;
        self.actor_id = snapshot.get("actorId").and_then(Value::as_str).map(str::to_string);
        self.quests.clear();
        for entry in list("quests") {
            let quest = entry["quest"].as_str().ok_or("quests: an id")?;
            let strings = |key: &str| entry.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default();
            let status = entry["status"].as_str().ok_or("quests: a status")?.to_string();
            self.quests.set(quest, QuestProgress { status, done: strings("done"), revealed: strings("revealed") });
        }
        self.party_level = snapshot.get("partyLevel").and_then(Value::as_f64).unwrap_or(1.0);
        self.ability_uses = pairs("abilityUses")?;
        self.ability_tokens = pairs("abilityTokens")?;
        self.countdowns = CountdownBoard::default();
        for countdown in list("countdowns") {
            let countdown: RunningCountdown = serde_json::from_value(countdown).map_err(|e| e.to_string())?;
            self.countdowns.set(countdown);
        }
        self.zones.clear();
        for zone in list("zones") {
            let zone: RunningZone = serde_json::from_value(zone).map_err(|e| e.to_string())?;
            self.zones.set(&zone.id.clone(), zone);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scenario_starts_with_what_it_is_given_once() {
        let variables = serde_json::Map::from_iter([("mood".to_string(), json!("grim"))]);
        let scenario = ScenarioState::new(&variables, Some("kara"), &["a".into(), "a".into(), "b".into()], &[("rope".into(), 2.0)]);
        assert_eq!(scenario.flags, ["a", "b"]);
        assert_eq!(scenario.items.get("rope"), Some(&2.0));
        assert_eq!(scenario.actor_id.as_deref(), Some("kara"));
        assert_eq!(scenario.party_level, 1.0);
    }

    #[test]
    fn a_save_older_than_quests_and_countdowns_still_loads() {
        let mut scenario = ScenarioState::default();
        scenario.flags.push("stale".into());
        scenario.restore(&json!({ "variables": { "7": 1, "b": 2 }, "flags": ["f"], "items": [["key", 1]], "actorId": null })).unwrap();
        assert_eq!(scenario.flags, ["f"]);
        assert_eq!(scenario.party_level, 1.0);
        assert!(scenario.quests.is_empty() && scenario.countdowns.entries().is_empty() && scenario.zones.is_empty());
        let again = scenario.snapshot();
        let mut copy = ScenarioState::default();
        copy.restore(&again).unwrap();
        assert_eq!(copy, scenario);
    }
}
