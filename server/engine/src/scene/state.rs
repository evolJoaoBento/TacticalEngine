//! Play state for one scene (`src/engine/scene/state.ts`), as far as combat reads and writes it: the
//! creatures standing in it - their tile and spot, their pools, their conditions, who they fight for - the
//! GM's Shadow pool, and each encounter's progress. Entities are kept in the order they came, as the
//! TypeScript's `Map` keeps them, since every roll-call of a side walks them in it.
//!
//! The rest of the scene state - interactables, moving, turning a creature's coat, snapshots and saves -
//! comes with the scene's own port.

use crate::grid::tile_grid::{Spot, TileGrid};
use crate::rules::resources::{create_bad, create_good, create_mark_pool, Currency, MarkPool, MAX_BAD};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Faction {
    Party,
    Adversary,
    Neutral,
}

/// How long a condition lasts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConditionDuration {
    Temporary,
    Scene,
    Rest,
    Permanent,
}

/// Where a creature stands, a spot never placed being `NaN` - written as `null`, as JSON must.
mod spot_or_nan {
    use super::*;

    pub fn serialize<S: Serializer>(spot: &Spot, serializer: S) -> Result<S::Ok, S::Error> {
        let part = |v: f64| if v.is_finite() { serde_json::json!(v) } else { Value::Null };
        serde_json::json!({ "x": part(spot.x), "y": part(spot.y) }).serialize(serializer)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Spot, D::Error> {
        let value = Value::deserialize(deserializer)?;
        let part = |key: &str| value.get(key).and_then(Value::as_f64).unwrap_or(f64::NAN);
        Ok(Spot { x: part("x"), y: part("y") })
    }
}

/// A condition's duration by condition, in the order they came - a `Map`, written as an object.
mod durations {
    use super::*;

    pub fn serialize<S: Serializer>(entries: &[(String, ConditionDuration)], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(entries.iter().map(|(k, v)| (k, v)))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<(String, ConditionDuration)>, D::Error> {
        let map = Map::<String, Value>::deserialize(deserializer)?;
        map.into_iter()
            .map(|(k, v)| serde_json::from_value(v).map(|d| (k, d)).map_err(serde::de::Error::custom))
            .collect()
    }
}

/// A creature in the scene.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityState {
    pub id: String,
    pub faction: Faction,
    /// What it was stood up from: a class, a stat block.
    pub definition: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub tile: i32,
    #[serde(with = "spot_or_nan")]
    pub at: Spot,
    pub hit_points: MarkPool,
    pub stress: MarkPool,
    pub armor_slots: MarkPool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub good: Option<Currency>,
    /// The conditions it bears, in the order they came - a `Set`.
    pub conditions: Vec<String>,
    #[serde(with = "durations")]
    pub condition_durations: Vec<(String, ConditionDuration)>,
    /// False once it has fallen.
    pub alive: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dead: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interacted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truce: Option<bool>,
}

impl EntityState {
    pub fn has_condition(&self, id: &str) -> bool {
        self.conditions.iter().any(|c| c == id)
    }

    /// `conditions.add`: a condition already borne keeps its place.
    pub fn add_condition(&mut self, id: &str) {
        if !self.has_condition(id) {
            self.conditions.push(id.to_string());
        }
    }
}

/// Where a creature is before anything has placed it.
pub const UNPLACED: Spot = Spot { x: f64::NAN, y: f64::NAN };

/// A party member's starting state.
pub fn create_party_entity(id: &str, definition: &str, tile: i32, hit_points: f64, stress: f64, armor_slots: f64) -> EntityState {
    EntityState {
        id: id.into(),
        faction: Faction::Party,
        definition: definition.into(),
        model: None,
        name: None,
        tile,
        at: UNPLACED,
        hit_points: create_mark_pool(hit_points, 0.0),
        stress: create_mark_pool(stress, 0.0),
        armor_slots: create_mark_pool(armor_slots, 0.0),
        good: Some(create_good(crate::rules::resources::STARTING_GOOD, crate::rules::resources::MAX_GOOD)),
        conditions: Vec::new(),
        condition_durations: Vec::new(),
        alive: true,
        dead: None,
        interacted: None,
        truce: None,
    }
}

/// An adversary's starting state, from its stat block: no Light, no Armor Slots.
pub fn create_adversary_entity(id: &str, definition: &str, tile: i32, hit_points: f64, stress: f64, faction: Faction) -> EntityState {
    EntityState {
        faction,
        good: None,
        armor_slots: create_mark_pool(0.0, 0.0),
        ..create_party_entity(id, definition, tile, hit_points, stress, 0.0)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EncounterState {
    pub started: bool,
    pub ended: bool,
    /// Trigger cells already stepped on.
    pub triggered: bool,
}

/// Mutable play state for one scene. Every change to who stands where goes through a method, so the
/// occupancy index cannot drift from the entities.
#[derive(Clone, Debug)]
pub struct SceneState {
    pub scene_id: String,
    pub grid: TileGrid,
    entities: Vec<EntityState>,
    at: HashMap<String, usize>,
    /// Tile -> the ids standing on it, in the order they arrived.
    occupants: HashMap<i32, Vec<String>>,
    encounters: HashMap<String, EncounterState>,
    /// The GM's Shadow pool. It carries between scenes; the caller passes it along.
    pub bad: Currency,
}

impl SceneState {
    pub fn new(scene_id: &str, grid: TileGrid, bad: Option<Currency>) -> Self {
        SceneState {
            scene_id: scene_id.into(),
            grid,
            entities: Vec::new(),
            at: HashMap::new(),
            occupants: HashMap::new(),
            encounters: HashMap::new(),
            bad: bad.unwrap_or_else(|| create_bad(0.0, MAX_BAD)),
        }
    }

    /// Stand a creature in the scene. Its spot follows its tile unless it already agrees with it.
    pub fn add_entity(&mut self, mut entity: EntityState) -> Result<&mut EntityState, String> {
        if self.at.contains_key(&entity.id) {
            return Err(format!("entity \"{}\" is already in this scene", entity.id));
        }
        if self.grid.tile_at_spot(entity.at.x, entity.at.y) != entity.tile {
            entity.at = self.grid.spot_of(entity.tile);
        }
        self.occupants.entry(entity.tile).or_default().push(entity.id.clone());
        self.at.insert(entity.id.clone(), self.entities.len());
        self.entities.push(entity);
        Ok(self.entities.last_mut().expect("just pushed"))
    }

    pub fn remove_entity(&mut self, id: &str) -> bool {
        let Some(index) = self.at.remove(id) else { return false };
        let entity = self.entities.remove(index);
        if let Some(here) = self.occupants.get_mut(&entity.tile) {
            here.retain(|other| other != id);
            if here.is_empty() {
                self.occupants.remove(&entity.tile);
            }
        }
        for (i, e) in self.entities.iter().enumerate().skip(index) {
            self.at.insert(e.id.clone(), i);
        }
        true
    }

    pub fn entity(&self, id: &str) -> Option<&EntityState> {
        self.at.get(id).map(|&i| &self.entities[i])
    }

    pub fn entity_mut(&mut self, id: &str) -> Option<&mut EntityState> {
        self.at.get(id).map(|&i| &mut self.entities[i])
    }

    pub fn all_entities(&self) -> &[EntityState] {
        &self.entities
    }

    /// One side's creatures, in the order they came.
    pub fn entities_of(&self, faction: Faction) -> impl Iterator<Item = &EntityState> {
        self.entities.iter().filter(move |e| e.faction == faction)
    }

    /// The ids standing on a tile, in the order they arrived.
    pub fn occupants(&self, tile: i32) -> &[String] {
        self.occupants.get(&tile).map_or(&[], Vec::as_slice)
    }

    /// An encounter's progress, begun afresh the first time it is asked for.
    pub fn encounter(&mut self, id: &str) -> &mut EncounterState {
        self.encounters.entry(id.to_string()).or_default()
    }

    /// Whether any encounter has started and not ended: the fight is on.
    pub fn encounter_running(&self) -> bool {
        self.encounters.values().any(|e| e.started && !e.ended)
    }
}
