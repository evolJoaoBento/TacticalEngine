//! Region triggers (`src/engine/scene/triggers.ts`): stepping on an encounter's trigger cells wakes it.
//! An index built once from the scene, since every step of every move asks it.

use super::state::{Faction, SceneState};
use crate::grid::tile_grid::{TileGrid, NO_TILE};
use serde_json::Value;
use std::collections::HashMap;

/// The encounter a path woke, and the tile it woke on - where the mover is stopped.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct TriggerHit {
    pub encounter: String,
    pub tile: i32,
}

#[derive(Clone, Debug, Default)]
pub struct TriggerIndex {
    by_tile: HashMap<i32, String>,
    /// The creatures each encounter placed, to tell a fight from a room of friends.
    placed: HashMap<String, Vec<String>>,
}

impl TriggerIndex {
    pub fn new(scene: &Value, grid: &TileGrid) -> Self {
        let mut index = TriggerIndex::default();
        for encounter in scene["encounters"].as_array().map_or(&[][..], Vec::as_slice) {
            if encounter["startsOnTrigger"] != Value::Bool(true) {
                continue;
            }
            let id = encounter["id"].as_str().unwrap_or_default().to_string();
            let placed = encounter["adversaries"].as_array().map_or(&[][..], Vec::as_slice).iter().map(|p| p["id"].as_str().unwrap_or_default().to_string()).collect();
            index.placed.insert(id.clone(), placed);
            for cell in encounter["triggerCells"].as_array().map_or(&[][..], Vec::as_slice) {
                let tile = grid.index_at(cell["x"].as_f64().unwrap_or(f64::NAN), cell["y"].as_f64().unwrap_or(f64::NAN));
                // The first encounter to claim a cell keeps it: overlapping triggers are an authoring
                // mistake, and picking deterministically beats picking last.
                if tile != NO_TILE {
                    index.by_tile.entry(tile).or_insert_with(|| id.clone());
                }
            }
        }
        index
    }

    /// How many cells wake something.
    pub fn size(&self) -> usize {
        self.by_tile.len()
    }

    /// The encounter a tile would start, whether or not it already has.
    pub fn at(&self, tile: i32) -> Option<&str> {
        self.by_tile.get(&tile).map(String::as_str)
    }

    /// The first encounter a path would wake, and where: walking through a trigger fires it. One already
    /// woken, running or over wakes nothing, nor one whose every creature stands on nobody's side.
    pub fn first_along(&self, path: &[i32], state: &mut SceneState) -> Option<TriggerHit> {
        for &tile in path {
            let Some(encounter) = self.at(tile) else { continue };
            let status = *state.encounter(encounter);
            if status.triggered || status.started || status.ended {
                continue;
            }
            let placed = self.placed.get(encounter).map_or(&[][..], Vec::as_slice);
            if !placed.is_empty() && placed.iter().all(|id| state.entity(id).is_some_and(|e| e.faction == Faction::Neutral)) {
                continue;
            }
            return Some(TriggerHit { encounter: encounter.to_string(), tile });
        }
        None
    }
}
