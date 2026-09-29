//! Play state for one scene (`src/engine/scene/state.ts`): the creatures standing in it - their tile and
//! spot, their pools, their conditions, who they fight for - the things in the room and what has happened
//! to them, the GM's Shadow pool, and each encounter's progress; who blocks whom, and the snapshot a save
//! holds. Entities are kept in the order they came, as the TypeScript's `Map` keeps them, since every
//! roll-call of a side walks them in it.
//!
//! What is left - stood up from a scene document, and a snapshot from a room since grown reshaped - comes
//! with the scene document's port.

use crate::grid::tile_grid::{Spot, TileGrid, NO_TILE};
use crate::grid::walk::BODY_RADIUS;
use crate::js;
use crate::rules::resources::{create_bad, create_good, create_mark_pool, Currency, MarkPool, MAX_BAD};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

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

/// A thing in the room play changes: used, opened, taken away, and the values its scripts keep.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Interactable {
    pub used: bool,
    pub open: bool,
    pub removed: bool,
    /// Per-interactable script values: the legacy `lit`, `found`, `inserted` flags.
    #[serde(default)]
    pub data: Map<String, Value>,
}

/// Where a thing stands when the room is built, and what it is: a door (walked through once open), a
/// thing that stands in the way, the tiles it is drawn across.
#[derive(Clone, Debug, PartialEq)]
pub struct ThingPlacement {
    pub id: String,
    pub tile: i32,
    pub door: bool,
    pub blocks: bool,
    pub footprint: Vec<i32>,
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
    interactables: Vec<(String, Interactable)>,
    encounters: Vec<(String, EncounterState)>,
    /// Tiles held by an interactable that blocks movement and has not been removed.
    blocking_interactables: HashSet<i32>,
    /// Where each interactable stands, so removing one can free its tile.
    interactable_tiles: HashMap<String, i32>,
    /// Every tile a thing covers, when that is more than the one it stands on.
    interactable_footprints: HashMap<String, Vec<i32>>,
    /// Interactables walked through once open: doors, and nothing else.
    passable_when_open: HashSet<String>,
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
            interactables: Vec::new(),
            encounters: Vec::new(),
            blocking_interactables: HashSet::new(),
            interactable_tiles: HashMap::new(),
            interactable_footprints: HashMap::new(),
            passable_when_open: HashSet::new(),
            bad: bad.unwrap_or_else(|| create_bad(0.0, MAX_BAD)),
        }
    }

    // ---- entities ------------------------------------------------------------------------------------

    /// Stand a creature in the scene. Its spot follows its tile unless it already agrees with it.
    pub fn add_entity(&mut self, mut entity: EntityState) -> Result<&mut EntityState, String> {
        if self.at.contains_key(&entity.id) {
            return Err(format!("entity \"{}\" is already in this scene", entity.id));
        }
        if self.grid.tile_at_spot(entity.at.x, entity.at.y) != entity.tile {
            entity.at = self.grid.spot_of(entity.tile);
        }
        self.occupy(entity.tile, &entity.id);
        self.at.insert(entity.id.clone(), self.entities.len());
        self.entities.push(entity);
        Ok(self.entities.last_mut().expect("just pushed"))
    }

    pub fn remove_entity(&mut self, id: &str) -> bool {
        let Some(index) = self.at.remove(id) else { return false };
        let entity = self.entities.remove(index);
        self.vacate(entity.tile, id);
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

    /// A creature onto nobody's side (`friendly`) or back among the adversaries (`hostile`). A party member
    /// is never turned. False when nothing changed.
    pub fn set_attitude(&mut self, id: &str, attitude: &str) -> bool {
        let faction = if attitude == "friendly" { Faction::Neutral } else { Faction::Adversary };
        match self.entity_mut(id) {
            Some(entity) if entity.faction != Faction::Party && entity.faction != faction => {
                entity.faction = faction;
                true
            }
            _ => false,
        }
    }

    /// Put an entity down at a tile's centre, keeping the occupancy index in step.
    pub fn move_entity(&mut self, id: &str, tile: i32) -> Result<(), String> {
        let spot = self.grid.spot_of(tile);
        let entity = self.entity_mut(id).ok_or_else(|| format!("no entity \"{id}\" in this scene"))?;
        entity.at = spot;
        let was = entity.tile;
        if was == tile {
            return Ok(());
        }
        entity.tile = tile;
        self.vacate(was, id);
        self.occupy(tile, id);
        Ok(())
    }

    /// Stand an entity at a spot - where a walk ended, not the centre of the square it ended in. The tile it
    /// counts as standing on follows.
    pub fn place_entity(&mut self, id: &str, x: f64, y: f64) -> Result<(), String> {
        let tile = self.grid.tile_at_spot(x, y);
        let spot = if tile == NO_TILE { self.grid.spot_of(NO_TILE) } else { Spot { x, y } };
        let entity = self.entity_mut(id).ok_or_else(|| format!("no entity \"{id}\" in this scene"))?;
        entity.at = spot;
        let was = entity.tile;
        if was == tile {
            return Ok(());
        }
        entity.tile = tile;
        self.vacate(was, id);
        self.occupy(tile, id);
        Ok(())
    }

    /// The ids standing on a tile, in the order they arrived.
    pub fn occupants(&self, tile: i32) -> &[String] {
        self.occupants.get(&tile).map_or(&[], Vec::as_slice)
    }

    /// Whether any living entity stands on a tile.
    pub fn is_occupied(&self, tile: i32) -> bool {
        self.occupants(tile).iter().any(|id| self.entity(id).is_some_and(|e| e.alive))
    }

    /// A pathfinder's `isBlocked` for one mover: tiles a living body it cannot pass overlaps, and things
    /// that stand in the way and are still there. `pass_through` names the sides it may walk past.
    pub fn blocked_for(&self, mover: &str, pass_through: &[Faction]) -> impl Fn(i32) -> bool + 'static {
        let held = self.bodies_except(mover, pass_through);
        let things = self.blocking_interactables.clone();
        move |tile| held.contains(&tile) || things.contains(&tile)
    }

    /// Whether a body could be put down at a tile's centre: floor, no living body over it, nothing blocking
    /// there. `except` is a body not to count - the one being placed.
    pub fn body_free(&self, tile: i32, except: &str) -> bool {
        // `blocked_for(except)(tile)`, asked of one tile without building the set: a summons asks it of
        // every tile on the map.
        self.grid.is_passable(tile)
            && !self.blocking_interactables.contains(&tile)
            && !self.entities.iter().any(|other| other.id != except && other.alive && other.tile != NO_TILE && self.holds(other, tile))
    }

    /// The tiles some living body overlaps: its own, and any neighbour whose centre lies within two bodies
    /// of where it actually stands.
    fn bodies_except(&self, mover: &str, transparent: &[Faction]) -> HashSet<i32> {
        let mut held = HashSet::new();
        for other in &self.entities {
            if other.id == mover || !other.alive || other.tile == NO_TILE || transparent.contains(&other.faction) {
                continue;
            }
            held.insert(other.tile);
            let (x, y) = (self.grid.x_of(other.tile), self.grid.y_of(other.tile));
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let tile = self.grid.index_of(x + dx, y + dy);
                    if (dx != 0 || dy != 0) && tile != NO_TILE && self.holds(other, tile) {
                        held.insert(tile);
                    }
                }
            }
        }
        held
    }

    /// Whether a living body overlaps a tile: its own, or a neighbour whose centre lies within two bodies of
    /// where it stands.
    fn holds(&self, other: &EntityState, tile: i32) -> bool {
        if tile == other.tile {
            return true;
        }
        let (x, y) = (self.grid.x_of(other.tile), self.grid.y_of(other.tile));
        let (tx, ty) = (self.grid.x_of(tile), self.grid.y_of(tile));
        if tile < 0 || (tx - x).abs() > 1 || (ty - y).abs() > 1 || self.grid.index_of(tx, ty) != tile {
            return false;
        }
        js::hypot(f64::from(tx) - other.at.x, f64::from(ty) - other.at.y) < 2.0 * BODY_RADIUS
    }

    // ---- interactables -------------------------------------------------------------------------------

    /// Register an interactable's tile as blocking. Called when the scene is built.
    pub fn set_interactable_blocking(&mut self, tile: i32, blocking: bool) {
        if tile == NO_TILE {
            return;
        }
        if blocking {
            self.blocking_interactables.insert(tile);
        } else {
            self.blocking_interactables.remove(&tile);
        }
    }

    /// Record where an interactable stands, whether it is a door, and the tiles it is drawn across.
    pub fn place_interactable(&mut self, id: &str, tile: i32, passable_when_open: bool, footprint: &[i32]) {
        if tile != NO_TILE {
            self.interactable_tiles.insert(id.into(), tile);
        }
        let covered: Vec<i32> = footprint.iter().copied().filter(|&at| at != NO_TILE).collect();
        if covered.len() > 1 {
            self.interactable_footprints.insert(id.into(), covered);
        } else {
            self.interactable_footprints.remove(id);
        }
        if passable_when_open {
            self.passable_when_open.insert(id.into());
        } else {
            self.passable_when_open.remove(id);
        }
    }

    /// Every tile it covers: its footprint when it has one, the tile it stands on otherwise.
    pub fn interactable_covers(&self, id: &str) -> Vec<i32> {
        if let Some(footprint) = self.interactable_footprints.get(id) {
            return footprint.clone();
        }
        let tile = self.interactable_tile(id);
        if tile == NO_TILE {
            Vec::new()
        } else {
            vec![tile]
        }
    }

    /// Open something, and get out of the way if it is the kind of thing that does.
    pub fn open_interactable(&mut self, id: &str) {
        self.interactable(id).open = true;
        if self.passable_when_open.contains(id) {
            for tile in self.interactable_covers(id) {
                self.set_interactable_blocking(tile, false);
            }
        }
    }

    /// Shut something that was open, and stand in the way again if it is a door - not on somebody, when it
    /// stays open and this says so.
    pub fn close_interactable(&mut self, id: &str) -> bool {
        let state = self.interactable(id);
        if state.removed || !state.open {
            return !state.open;
        }
        let covers = self.interactable_covers(id);
        let door = self.passable_when_open.contains(id);
        if door && covers.iter().any(|&tile| !self.occupants(tile).is_empty()) {
            return false;
        }
        self.interactable(id).open = false;
        if door {
            for tile in covers {
                self.set_interactable_blocking(tile, true);
            }
        }
        true
    }

    /// Take something out of the room: it is gone, and nothing it stood on is blocked by it any more.
    pub fn remove_interactable(&mut self, id: &str) {
        self.interactable(id).removed = true;
        for tile in self.interactable_covers(id) {
            self.set_interactable_blocking(tile, false);
        }
    }

    /// Stand the room's things up from what the document says, keeping what has happened to each: a door
    /// already opened stays open, a thing already taken away stays gone.
    pub fn replace_interactables(&mut self, things: &[ThingPlacement]) {
        self.blocking_interactables.clear();
        self.interactable_tiles.clear();
        self.interactable_footprints.clear();
        self.passable_when_open.clear();
        for thing in things {
            self.place_interactable(&thing.id, thing.tile, thing.door, &thing.footprint);
            let was = self.interactables.iter().find(|(id, _)| *id == thing.id).map(|(_, s)| s.clone());
            let out_of_the_way = was.as_ref().is_some_and(|w| w.removed || (thing.door && w.open));
            if thing.blocks && !out_of_the_way {
                for tile in self.interactable_covers(&thing.id) {
                    self.set_interactable_blocking(tile, true);
                }
            }
        }
    }

    /// Whether it is open, read without making a record for it.
    pub fn is_open(&self, id: &str) -> bool {
        self.interactables.iter().any(|(known, s)| known == id && s.open)
    }

    /// The tile an interactable stands on, or `NO_TILE`.
    pub fn interactable_tile(&self, id: &str) -> i32 {
        self.interactable_tiles.get(id).copied().unwrap_or(NO_TILE)
    }

    /// An interactable's state, begun afresh the first time it is asked for.
    pub fn interactable(&mut self, id: &str) -> &mut Interactable {
        let at = match self.interactables.iter().position(|(known, _)| known == id) {
            Some(at) => at,
            None => {
                self.interactables.push((id.to_string(), Interactable::default()));
                self.interactables.len() - 1
            }
        };
        &mut self.interactables[at].1
    }

    // ---- encounters ----------------------------------------------------------------------------------

    /// An encounter's progress, begun afresh the first time it is asked for.
    pub fn encounter(&mut self, id: &str) -> &mut EncounterState {
        let at = match self.encounters.iter().position(|(known, _)| known == id) {
            Some(at) => at,
            None => {
                self.encounters.push((id.to_string(), EncounterState::default()));
                self.encounters.len() - 1
            }
        };
        &mut self.encounters[at].1
    }

    /// Whether any encounter has started and not ended: the fight is on.
    pub fn encounter_running(&self) -> bool {
        self.encounters.iter().any(|(_, e)| e.started && !e.ended)
    }

    // ---- conditions ----------------------------------------------------------------------------------

    /// End the conditions a moment ends: a fight's end clears `temporary` and `scene`, a rest those and
    /// `rest`. What was cleared, by creature, in the order it came off.
    pub fn clear_conditions(&mut self, scope: &str) -> Vec<(String, String)> {
        let ending: &[ConditionDuration] = if scope == "rest" {
            &[ConditionDuration::Temporary, ConditionDuration::Scene, ConditionDuration::Rest]
        } else {
            &[ConditionDuration::Temporary, ConditionDuration::Scene]
        };
        let mut cleared = Vec::new();
        for entity in &mut self.entities {
            for condition in entity.conditions.clone() {
                let duration = entity.condition_durations.iter().find(|(c, _)| *c == condition).map_or(ConditionDuration::Permanent, |(_, d)| *d);
                if !ending.contains(&duration) {
                    continue;
                }
                entity.conditions.retain(|c| *c != condition);
                entity.condition_durations.retain(|(c, _)| *c != condition);
                cleared.push((entity.id.clone(), condition));
            }
        }
        cleared
    }

    // ---- serialisation -------------------------------------------------------------------------------

    /// A plain, JSON-safe snapshot, as `SceneState.snapshot` writes it.
    pub fn snapshot(&self) -> Value {
        let entities: Map<String, Value> = self.entities.iter().map(|e| (e.id.clone(), serde_json::to_value(e).expect("an entity serializes"))).collect();
        let interactables: Map<String, Value> = self.interactables.iter().map(|(id, s)| (id.clone(), serde_json::to_value(s).expect("serializes"))).collect();
        let encounters: Map<String, Value> = self.encounters.iter().map(|(id, s)| (id.clone(), serde_json::to_value(s).expect("serializes"))).collect();
        serde_json::json!({
            "sceneId": self.scene_id,
            "room": { "width": self.grid.width, "x": self.grid.origin.x, "y": self.grid.origin.y },
            "entities": entities,
            "interactables": interactables,
            "encounters": encounters,
            "bad": self.bad,
        })
    }

    /// Rebuild the play state from a snapshot taken in this room as it stands, the occupancy index with it.
    /// A room that has grown since is the scene document's to reshape, and waits for its port: refused.
    pub fn restore(&mut self, snapshot: &Value) -> Result<(), String> {
        if let Some(room) = snapshot.get("room") {
            let same = room["width"].as_f64() == Some(f64::from(self.grid.width))
                && room["x"].as_f64() == Some(f64::from(self.grid.origin.x))
                && room["y"].as_f64() == Some(f64::from(self.grid.origin.y));
            if !same {
                return Err("the snapshot was taken in a room shaped otherwise".into());
            }
        }
        let parse = |what: &str| snapshot.get(what).and_then(Value::as_object).ok_or_else(|| format!("a snapshot has {what}"));
        let entities = parse("entities")?.clone();
        let interactables = parse("interactables")?.clone();
        let encounters = parse("encounters")?.clone();
        self.entities.clear();
        self.at.clear();
        self.occupants.clear();
        self.interactables.clear();
        self.encounters.clear();
        for (id, value) in entities {
            let mut value = value;
            value["id"] = Value::String(id);
            if value.get("at").is_none_or(Value::is_null) {
                let spot = self.grid.spot_of(value["tile"].as_f64().unwrap_or(-1.0) as i32);
                value["at"] = serde_json::json!({ "x": spot.x, "y": spot.y });
            }
            if value.get("conditionDurations").is_none() {
                value["conditionDurations"] = serde_json::json!({});
            }
            let entity: EntityState = serde_json::from_value(value).map_err(|e| e.to_string())?;
            self.add_entity(entity)?;
        }
        for (id, value) in interactables {
            let state: Interactable = serde_json::from_value(value).map_err(|e| e.to_string())?;
            let out_of_the_way = state.removed || (state.open && self.passable_when_open.contains(&id));
            self.interactables.push((id.clone(), state));
            if out_of_the_way {
                for tile in self.interactable_covers(&id) {
                    self.set_interactable_blocking(tile, false);
                }
            }
        }
        for (id, value) in encounters {
            self.encounters.push((id, serde_json::from_value(value).map_err(|e| e.to_string())?));
        }
        self.bad = serde_json::from_value(snapshot["bad"].clone()).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn occupy(&mut self, tile: i32, id: &str) {
        if tile == NO_TILE {
            return;
        }
        let here = self.occupants.entry(tile).or_default();
        if !here.iter().any(|known| known == id) {
            here.push(id.to_string());
        }
    }

    fn vacate(&mut self, tile: i32, id: &str) {
        if let Some(here) = self.occupants.get_mut(&tile) {
            here.retain(|other| other != id);
            if here.is_empty() {
                self.occupants.remove(&tile);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::terrain::TerrainPalette;

    fn room() -> SceneState {
        let mut state = SceneState::new("room", TileGrid::new(6, 4, TerrainPalette::default_palette()), None);
        state.add_entity(create_party_entity("kara", "sentinel", 7, 6.0, 6.0, 2.0)).unwrap();
        state
    }

    #[test]
    fn a_door_drawn_across_tiles_opens_and_shuts_across_them_all() {
        let mut state = room();
        let things = [ThingPlacement { id: "gate".into(), tile: 2, door: true, blocks: true, footprint: vec![2, 3] }];
        state.replace_interactables(&things);
        assert!(!state.body_free(2, "") && !state.body_free(3, ""));
        state.open_interactable("gate");
        assert!(state.body_free(2, "") && state.body_free(3, ""));
        // Stood up again from the document, an open door stays open.
        state.replace_interactables(&things);
        assert!(state.body_free(3, ""));
        // And it will not shut on whoever is in it.
        state.move_entity("kara", 3).unwrap();
        assert!(!state.close_interactable("gate"));
        state.move_entity("kara", 7).unwrap();
        assert!(state.close_interactable("gate"));
        assert!(!state.body_free(2, "") && !state.body_free(3, ""));
        state.remove_interactable("gate");
        assert!(state.body_free(2, ""));
    }

    #[test]
    fn a_body_off_the_centre_holds_the_tile_it_leans_into() {
        let mut state = room();
        assert!(state.body_free(8, "") && !state.body_free(7, "") && state.body_free(7, "kara"));
        state.place_entity("kara", 1.4, 1.0).unwrap();
        assert!(!state.body_free(8, ""));
        assert!((state.blocked_for("nobody", &[]))(8));
        assert!(!(state.blocked_for("nobody", &[Faction::Party]))(8));
    }

    #[test]
    fn a_snapshot_restores_where_it_was_taken_and_nowhere_else() {
        let mut state = room();
        state.interactable("chest").open = true;
        state.encounter("fight").started = true;
        let mut snapshot = state.snapshot();
        // A save from before creatures stood off the centre, and before durations: the tile's centre, and none.
        snapshot["entities"]["kara"].as_object_mut().unwrap().remove("at");
        snapshot["entities"]["kara"].as_object_mut().unwrap().remove("conditionDurations");
        let mut again = SceneState::new("room", TileGrid::new(6, 4, TerrainPalette::default_palette()), None);
        again.restore(&snapshot).unwrap();
        assert_eq!(again.entity("kara").map(|e| e.at), Some(again.grid.spot_of(7)));
        assert!(again.is_open("chest") && again.encounter_running());
        let mut grown = SceneState::new("room", TileGrid::new(7, 4, TerrainPalette::default_palette()), None);
        assert!(grown.restore(&snapshot).is_err());
    }

    #[test]
    fn a_fight_ending_clears_what_lasts_a_scene_and_a_rest_what_lasts_until_one() {
        let mut state = room();
        let kara = state.entity_mut("kara").unwrap();
        for (condition, duration) in [("a", ConditionDuration::Temporary), ("b", ConditionDuration::Scene), ("c", ConditionDuration::Rest), ("d", ConditionDuration::Permanent)] {
            kara.conditions.push(condition.into());
            kara.condition_durations.push((condition.into(), duration));
        }
        kara.conditions.push("e".into());
        let scene: Vec<String> = state.clear_conditions("scene").into_iter().map(|(_, c)| c).collect();
        assert_eq!(scene, ["a", "b"]);
        let rest: Vec<String> = state.clear_conditions("rest").into_iter().map(|(_, c)| c).collect();
        assert_eq!(rest, ["c"]);
        assert_eq!(state.entity("kara").unwrap().conditions, ["d", "e"]);
    }

    #[test]
    fn only_the_party_keeps_its_coat() {
        let mut state = room();
        state.add_entity(create_adversary_entity("rat", "rat", 0, 1.0, 1.0, Faction::Adversary)).unwrap();
        assert!(!state.set_attitude("kara", "friendly"));
        assert!(state.set_attitude("rat", "friendly") && state.entity("rat").unwrap().faction == Faction::Neutral);
        assert!(!state.set_attitude("rat", "friendly"));
        assert!(state.set_attitude("rat", "hostile"));
    }
}
