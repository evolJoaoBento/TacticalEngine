//! Zones: a condition applied by geography. Walk in and you bear it, walk out and you do not; a zone whose
//! caster falls goes with them unless it outlives them; ground that answers a blow is spent a step each
//! time, and ends past its limit. Crossings into ground that bites wait for whoever has a runner.

use super::{SceneScriptWorld, ZoneEntry};
use crate::grid::tile_grid::NO_TILE;
use crate::rules::range::reaches;
use crate::scene::state::{ConditionDuration, Faction};
use crate::script::zones::{RunningZone, ZoneOnDeath, ZoneSide};
use serde::Serialize;

/// A standing zone with its ground, for a board that draws them.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Footprint {
    pub id: String,
    pub name: String,
    pub condition: String,
    pub owner: Option<String>,
    pub tiles: Vec<i32>,
}

impl<'w> SceneScriptWorld<'w> {
    pub fn zones(&self) -> Vec<&RunningZone> {
        self.scenario.zones.values().collect()
    }

    /// The tiles a zone holds: every one within its band of its anchor, by the measure `refresh_zones` uses.
    pub fn zone_footprint(&self, zone: &RunningZone) -> Vec<i32> {
        (0..self.state.grid.size()).filter(|&tile| self.band_between(zone.anchor, tile).is_some_and(|band| reaches(band, zone.band))).collect()
    }

    pub fn zone_footprints(&self) -> Vec<Footprint> {
        self.zones()
            .into_iter()
            .map(|zone| Footprint { id: zone.id.clone(), name: zone.name.clone(), condition: zone.condition.clone(), owner: zone.owner.clone(), tiles: self.zone_footprint(zone) })
            .collect()
    }

    /// Put a zone on the map, or move the one standing under that id: the old ground goes.
    pub fn place_zone(&mut self, zone: RunningZone) {
        if let Some(standing) = self.scenario.zones.get(&zone.id) {
            if standing.condition != zone.condition {
                let condition = standing.condition.clone();
                self.strip_zone(&condition);
            }
        }
        self.scenario.zones.set(&zone.id.clone(), zone);
        self.refresh_zones();
    }

    /// Take a zone off the map, and its condition off everybody in it.
    pub fn end_zone(&mut self, id: &str) -> bool {
        let Some(zone) = self.scenario.zones.get(id).cloned() else { return false };
        self.scenario.zones.delete(id);
        self.strip_zone(&zone.condition);
        self.refresh_zones();
        true
    }

    fn standing_ids(&self) -> Vec<String> {
        self.state.entities_of(Faction::Party).chain(self.state.entities_of(Faction::Adversary)).map(|e| e.id.clone()).collect()
    }

    /// Make what everybody bears match where they stand, a fallen caster's zone taken off first. Safe to
    /// call twice, and cheap when nothing is standing.
    pub fn refresh_zones(&mut self) {
        if self.scenario.zones.is_empty() {
            return;
        }
        for zone in self.scenario.zones.values().cloned().collect::<Vec<_>>() {
            let Some(owner) = &zone.owner else { continue };
            if zone.on_death != ZoneOnDeath::End || self.state.entity(owner).is_some_and(|e| e.alive) {
                continue;
            }
            self.scenario.zones.delete(&zone.id);
            self.strip_zone(&zone.condition);
        }

        let standing = self.standing_ids();
        // By condition, in the order a zone first carried it: who should bear it, and whose spell it is.
        let mut inside: Vec<(String, Vec<String>)> = Vec::new();
        let mut owners: Vec<(String, Option<String>)> = Vec::new();
        for zone in self.scenario.zones.values().cloned().collect::<Vec<_>>() {
            if !owners.iter().any(|(c, _)| *c == zone.condition) {
                owners.push((zone.condition.clone(), zone.owner.clone()));
            }
            let mine = match &zone.owner {
                None => Some(Faction::Party),
                Some(owner) => self.faction_of(owner),
            };
            let mut held: Vec<String> = inside.iter().find(|(c, _)| *c == zone.condition).map(|(_, ids)| ids.clone()).unwrap_or_default();
            for id in &standing {
                let entity = self.state.entity(id).expect("standing");
                if !entity.alive || entity.tile == NO_TILE {
                    continue;
                }
                if let (Some(side), Some(mine)) = (zone.side, mine) {
                    let want = match side {
                        ZoneSide::Allies => mine,
                        ZoneSide::Adversaries if mine == Faction::Party => Faction::Adversary,
                        ZoneSide::Adversaries => Faction::Party,
                    };
                    if entity.faction != want {
                        continue;
                    }
                }
                if !self.band_between(zone.anchor, entity.tile).is_some_and(|band| reaches(band, zone.band)) {
                    continue;
                }
                if !held.contains(id) {
                    held.push(id.clone());
                }
            }
            match inside.iter_mut().find(|(c, _)| *c == zone.condition) {
                Some(entry) => entry.1 = held,
                None => inside.push((zone.condition.clone(), held)),
            }
        }

        for (condition, ids) in inside {
            let bites = self.content.condition_defs.get(&condition).and_then(|def| def.on_enter.as_ref()).is_some_and(|enter| !enter.effects.is_empty());
            for id in &standing {
                let should = ids.contains(id);
                let has = self.has_condition(id, &condition);
                if should && !has {
                    self.apply_condition(id, &condition, ConditionDuration::Scene);
                    if bites {
                        let owner = owners.iter().find(|(c, _)| *c == condition).and_then(|(_, o)| o.clone());
                        self.entered.push(ZoneEntry { id: id.clone(), condition: condition.clone(), owner });
                    }
                } else if !should && has {
                    self.clear_condition(id, &condition);
                }
            }
        }
    }

    /// Who has just walked into ground that means something. Clears as it reports.
    pub fn drain_entered(&mut self) -> Vec<ZoneEntry> {
        std::mem::take(&mut self.entered)
    }

    /// A blow was answered by the ground somebody stood on: that ground is a step more spent.
    pub(super) fn grow_zones(&mut self, id: &str) {
        for zone in self.zones_over(id) {
            let (Some(grows), Some(value)) = (zone.grows, zone.value) else { continue };
            let value = value + grows.by;
            if value > grows.until {
                self.end_zone(&zone.id);
            } else {
                self.scenario.zones.set(&zone.id.clone(), RunningZone { value: Some(value), ..zone });
            }
        }
    }

    /// Take one zone's condition off everybody, standing in one or not.
    fn strip_zone(&mut self, condition: &str) {
        for id in self.standing_ids() {
            self.clear_condition(&id, condition);
        }
    }
}
