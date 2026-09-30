//! A game played from a project (`src/game/demo-scene.ts`'s `buildProjectScene`, and `src/game/room.ts`):
//! the party's sheets and what is derived from them, the dice, the story so far, the rooms already visited
//! and what each was last stood up from, the log - and the room being played in, with its party and the
//! ground that wakes its encounters, and the world a script reads and writes.
//!
//! The TypeScript keeps the room's state, the scenario and the world side by side, the world holding the
//! other two by reference. Here the world owns them (`session.world.state`, `session.world.scenario`) and
//! the session owns the world; a world rebuilt - a sheet changed, a room entered - is built over the same
//! state and scenario, moved into it. What the world reads of the project is fixed when it is built, as the
//! TypeScript's traits are; the sheets, which the TypeScript's world reads live, are handed to it again
//! whenever they change (`share_characters`).
//!
//! Hooks come from the caller (`HooksFor`): the engine runs no JavaScript, and compiling a project's code
//! once and keeping it - as `hooksFor` keeps the last compile - is the caller's to do.
//!
//! What waits on the player, a fight, the GM's turn, and turning a script's journal into log lines come with
//! the parts that play them.

use super::content::{abilities_of, character_content_for, stat_block_for, world_content_for, Shipped};
use super::log::{name_of, note, LogLine};
use super::rules::{movement_for, DEMO_BAND_TILES};
use crate::character::sheet::{derive_character, starting_pools, CharacterSheet, DerivedCharacter};
use crate::grid::terrain::TerrainPalette;
use crate::grid::tile_grid::{TileGrid, NO_TILE};
use crate::rng::{Rng, Seed};
use crate::rules::resources::{Currency, MarkPool, MAX_SLOTS};
use crate::scene::grid_from_scene::{grid_from_scene, palette_for_project};
use crate::scene::party::{Party, PartyOptions};
use crate::scene::prop_functions::objects_to_props;
use crate::scene::state::{create_party_entity, create_placed_adversary, placement_options, placements_of, scene_state_from_scene, AdversaryStats, Faction, SceneState};
use crate::scene::triggers::TriggerIndex;
use crate::content::abilities::Stat;
use crate::js;
use crate::script::hooks::{CodeSource, Hooks};
use crate::script::world::{Ordered, ScenarioState, SceneScriptWorld, WorldContent};
use serde_json::Value;
use std::collections::HashMap;
use std::rc::Rc;

/// What compiles a project's code into the hooks its world runs.
pub type HooksFor = Rc<dyn Fn(&[CodeSource]) -> Rc<dyn Hooks>>;

/// The pools a character carries between rooms.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PartyPools {
    pub hit_points: MarkPool,
    pub stress: MarkPool,
    pub armor_slots: MarkPool,
    pub good: Option<Currency>,
}

/// Everything that belongs to one room rather than to the campaign.
pub struct Runtime {
    pub scene: Value,
    pub party: Party,
    pub triggers: TriggerIndex,
    pub world: SceneScriptWorld<'static>,
}

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

fn index_at(grid: &TileGrid, point: &Value) -> i32 {
    grid.index_at(point["x"].as_f64().unwrap_or(f64::NAN), point["y"].as_f64().unwrap_or(f64::NAN))
}

/// The placements a scene can stand up: those the play grid has a tile for, in the document's order.
pub fn playable_placements(scene: &Value, grid: &TileGrid) -> Vec<String> {
    let mut ids = Vec::new();
    for encounter in list(scene, "encounters") {
        for placement in list(encounter, "adversaries") {
            let id = text(placement, "id").to_string();
            if index_at(grid, &placement["position"]) != NO_TILE && !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    ids
}

fn code_of(project: &Value) -> Vec<CodeSource> {
    list(project, "code").iter().map(|c| serde_json::from_value(c.clone()).expect("code the schema read")).collect()
}

/// A played game.
pub struct Session {
    pub project: Value,
    shipped: Rc<Shipped>,
    hooks_for: HooksFor,
    /// The party's sheets as they stand - levels taken included.
    pub sheets: Ordered<CharacterSheet>,
    /// Derived sheets, by character id.
    pub characters: Ordered<DerivedCharacter>,
    pub rng: Rng,
    /// How each visited room was left, so returning finds it that way.
    pub snapshots: Ordered<Value>,
    /// The placements each room was last stood up from.
    pub synced_placements: Ordered<Vec<String>>,
    /// The narrative log, oldest first.
    pub log: Vec<LogLine>,
    pub scene: Value,
    pub party: Party,
    pub triggers: TriggerIndex,
    /// What scripts read and write; it owns the room's state and the scenario.
    pub world: SceneScriptWorld<'static>,
}

/// Stand a room up (`buildRuntime`): its grid from the project's ground, every placement's stat block - the
/// project's own before the shipped pack, and none substituted for one nobody has - the party on the
/// spawns with the pools they carry in, or fresh ones, the party's control, the triggers and the world.
#[allow(clippy::too_many_arguments)]
pub fn build_runtime(
    shipped: &Shipped,
    hooks_for: &HooksFor,
    project: &Value,
    scene: &Value,
    characters: &Ordered<DerivedCharacter>,
    scenario: ScenarioState,
    pools: Option<&Ordered<PartyPools>>,
    bad: Option<Currency>,
) -> Result<Runtime, String> {
    let (palette, structures) = palette_for_project(project).map_err(|e| e.0)?;
    let (grid, _) = grid_from_scene(scene, palette, &structures, None);
    let mut stats: HashMap<String, AdversaryStats> = HashMap::new();
    for encounter in list(scene, "encounters") {
        for placement in list(encounter, "adversaries") {
            let id = text(placement, "adversary");
            let def = stat_block_for(shipped, project, id).ok_or_else(|| format!("\"{}\" places adversary \"{id}\", which has no stat block", text(scene, "id")))?;
            stats.insert(id.to_string(), AdversaryStats { hit_points: def.hit_points, stress: def.stress });
        }
    }
    let party = characters
        .entries()
        .iter()
        .map(|(id, character)| {
            let carried = pools.and_then(|p| p.get(id)).copied();
            let pools = carried.unwrap_or_else(|| {
                let fresh = starting_pools(character);
                PartyPools { hit_points: fresh.hit_points, stress: fresh.stress, armor_slots: fresh.armor_slots, good: Some(fresh.good) }
            });
            let mut entity = create_party_entity(id, &character.sheet.class_id, NO_TILE, 6.0, 6.0, 0.0);
            entity.hit_points = pools.hit_points;
            entity.stress = pools.stress;
            entity.armor_slots = pools.armor_slots;
            if pools.good.is_some() {
                entity.good = pools.good;
            }
            entity
        })
        .collect();
    let (state, _) = scene_state_from_scene(scene, grid, &stats, party, bad)?;
    let party = Party::new(&state, PartyOptions { combat_reach: DEMO_BAND_TILES.close, rules: movement_for(project), ..PartyOptions::default() });
    let triggers = TriggerIndex::new(scene, &state.grid);
    let content = Rc::new(world_content_for(shipped, project, characters));
    let world = SceneScriptWorld::new(state, scenario, content, hooks_for(&code_of(project)));
    Ok(Runtime { scene: scene.clone(), party, triggers, world })
}

fn derive(shipped: &Shipped, project: &Value, sheet: &CharacterSheet) -> DerivedCharacter {
    // Issues a sheet raises are the editor's to show; the table plays what derives.
    derive_character(sheet, &character_content_for(shipped, project), &abilities_of(project)).0
}

impl Session {
    /// Stand a game up from a project (`buildProjectScene`): its objects made props, every sheet derived with
    /// the project's content, the room it opens on stood up.
    pub fn build(project: &Value, shipped: Rc<Shipped>, hooks_for: HooksFor, seed: &str) -> Result<Session, String> {
        let mut project = project.clone();
        for scene in project["scenes"].as_array_mut().into_iter().flatten() {
            objects_to_props(scene);
        }
        let mut sheets = Ordered::default();
        let mut characters = Ordered::default();
        for sheet in list(&project, "party") {
            let sheet: CharacterSheet = serde_json::from_value(sheet.clone()).map_err(|e| e.to_string())?;
            characters.set(&sheet.id, derive(&shipped, &project, &sheet));
            sheets.set(&sheet.id.clone(), sheet);
        }
        let start = text(&project, "startScene").to_string();
        let opening = list(&project, "scenes").iter().find(|s| text(s, "id") == start).cloned().ok_or_else(|| format!("the project opens on \"{start}\", which it does not have"))?;
        let runtime = build_runtime(&shipped, &hooks_for, &project, &opening, &characters, ScenarioState::default(), None, None)?;
        let mut synced_placements = Ordered::default();
        synced_placements.set(&start, playable_placements(&opening, &runtime.world.state.grid));
        Ok(Session {
            project,
            shipped,
            hooks_for,
            sheets,
            characters,
            rng: Rng::new(Seed::Text(seed)),
            snapshots: Ordered::default(),
            synced_placements,
            log: Vec::new(),
            scene: runtime.scene,
            party: runtime.party,
            triggers: runtime.triggers,
            world: runtime.world,
        })
    }

    pub fn shipped(&self) -> &Shipped {
        &self.shipped
    }

    pub fn state(&self) -> &SceneState {
        &self.world.state
    }

    /// Rebuild the script world after a sheet changed under it (`refreshWorld`): the same state and scenario,
    /// the project read again, and the ground read again for creatures standing in zones.
    pub fn refresh_world(&mut self) {
        let content = Rc::new(world_content_for(&self.shipped, &self.project, &self.characters));
        let hooks = (self.hooks_for)(&code_of(&self.project));
        let (state, scenario) = self.take_world();
        self.world = SceneScriptWorld::new(state, scenario, content, hooks);
        self.world.refresh_zones();
    }

    /// The state and scenario out of the world, which is about to be replaced. What the world was holding
    /// for somebody to hear - the blows landed, the crossings into ground that bites - goes with it, as it
    /// does when the TypeScript builds a new world: a world is only rebuilt between actions.
    fn take_world(&mut self) -> (SceneState, ScenarioState) {
        let nowhere = SceneState::new("", TileGrid::new(1, 1, TerrainPalette::default_palette()), None);
        (std::mem::replace(&mut self.world.state, nowhere), std::mem::take(&mut self.world.scenario))
    }

    /// Hand the world the party's sheets as they now stand: the TypeScript's world reads them live.
    fn share_characters(&mut self) {
        let mut content: WorldContent = (*self.world.shared_content()).clone();
        content.characters = self.characters.entries().iter().cloned().collect();
        self.world.set_content(Rc::new(content));
    }

    /// Write a sheet back (`setSheet`): the game's copy, the project's, and what derives from it.
    pub fn set_sheet(&mut self, sheet: CharacterSheet) -> Result<(), String> {
        let at = list(&self.project, "party").iter().position(|s| text(s, "id") == sheet.id);
        if let Some(at) = at {
            let parsed = crate::character::schema::sheet_schema().parse(&serde_json::to_value(&sheet).map_err(|e| e.to_string())?).map_err(|issues| format!("{issues:?}"))?;
            self.project["party"][at] = parsed;
        }
        self.characters.set(&sheet.id, derive(&self.shipped, &self.project, &sheet));
        self.sheets.set(&sheet.id.clone(), sheet);
        self.share_characters();
        Ok(())
    }

    /// Bring the party on the board into step with the party in the project (`syncRoster`): a sheet with
    /// nobody standing for it arrives beside the party with a fresh sheet's pools, and one the project no
    /// longer lists walks off. Out of a fight, which there is none of yet.
    pub fn sync_roster(&mut self) -> Result<(Vec<String>, Vec<String>), String> {
        let (mut joined, mut left) = (Vec::new(), Vec::new());
        for sheet in list(&self.project, "party").to_vec() {
            let sheet: CharacterSheet = serde_json::from_value(sheet).map_err(|e| e.to_string())?;
            if self.world.state.entity(&sheet.id).is_some() {
                continue;
            }
            let character = derive(&self.shipped, &self.project, &sheet);
            let pools = starting_pools(&character);
            let id = sheet.id.clone();
            self.sheets.set(&id, sheet);
            let tile = self.room_beside();
            let mut entity = create_party_entity(&id, &character.sheet.class_id, tile, 6.0, 6.0, 0.0);
            entity.hit_points = pools.hit_points;
            entity.stress = pools.stress;
            entity.armor_slots = pools.armor_slots;
            entity.good = Some(pools.good);
            self.characters.set(&id, character);
            self.world.state.add_entity(entity)?;
            self.share_characters();
            if self.party.selected().is_none() {
                self.party.select(&self.world.state, &id);
            }
            let name = name_of(self, &id);
            note(self, &format!("{name} joins the party."), "system");
            joined.push(id);
        }
        let listed: Vec<String> = list(&self.project, "party").iter().map(|s| text(s, "id").to_string()).collect();
        let members: Vec<String> = self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
        for id in members {
            if listed.contains(&id) {
                continue;
            }
            // The name before the body goes, or the log would read an id.
            let name = name_of(self, &id);
            self.world.state.remove_entity(&id);
            self.sheets.delete(&id);
            self.characters.delete(&id);
            self.share_characters();
            if self.party.selected() == Some(id.as_str()) {
                self.party.select_next(&self.world.state);
            }
            note(self, &format!("{name} leaves the party."), "system");
            left.push(id);
        }
        Ok((joined, left))
    }

    /// The nearest free tile to the party: beside whoever is selected, else anyone standing, else the
    /// room's first spawn.
    fn room_beside(&self) -> i32 {
        let state = &self.world.state;
        let standing: Vec<_> = state.entities_of(Faction::Party).filter(|e| e.tile != NO_TILE).collect();
        let selected = standing.iter().find(|e| Some(e.id.as_str()) == self.party.selected());
        let spawn = list(&self.scene, "spawns").first();
        let from = selected.map(|e| e.tile).or_else(|| standing.first().map(|e| e.tile)).unwrap_or_else(|| spawn.map_or(NO_TILE, |s| index_at(&state.grid, s)));
        self.free_tile_near(from)
    }

    /// Stand the party round a tile (`gatherParty`): whoever is selected on it or as near as the floor
    /// allows, the rest on the nearest free tiles after them. Nobody is walked: they are put down.
    pub fn gather_party(&mut self, tile: i32) {
        if !self.world.state.grid.is_tile(tile) {
            return;
        }
        let living: Vec<String> = self.world.state.entities_of(Faction::Party).filter(|e| e.alive).map(|e| e.id.clone()).collect();
        let selected = self.party.selected().map(str::to_string);
        let mut order: Vec<String> = living.iter().filter(|id| Some(*id) == selected.as_ref()).cloned().collect();
        order.extend(living.iter().filter(|id| Some(*id) != selected.as_ref()).cloned());
        for member in order {
            // Off the board while the search runs, so their own tile is free to them.
            self.world.state.move_entity(&member, NO_TILE).expect("a member");
            let spot = self.free_tile_near(tile);
            if spot != NO_TILE {
                self.world.state.move_entity(&member, spot).expect("a member");
            }
        }
        self.world.refresh_zones();
    }

    /// The nearest free passable tile to `from`, breadth first, four ways: `from` itself when it is free,
    /// `NO_TILE` for nowhere.
    pub fn free_tile_near(&self, from: i32) -> i32 {
        if from == NO_TILE {
            return NO_TILE;
        }
        let state = &self.world.state;
        let grid = &state.grid;
        let free = |tile: i32| state.body_free(tile, "");
        if free(from) {
            return from;
        }
        let mut seen = std::collections::HashSet::from([from]);
        let mut queue = vec![from];
        let mut i = 0;
        while i < queue.len() {
            let mut found = NO_TILE;
            let mut next_up = Vec::new();
            grid.for_each_neighbor(queue[i], false, |next| {
                if found != NO_TILE || seen.contains(&next) {
                    return;
                }
                seen.insert(next);
                if free(next) {
                    found = next;
                } else if grid.is_passable(next) {
                    next_up.push(next);
                }
            });
            queue.extend(next_up);
            if found != NO_TILE {
                return found;
            }
            i += 1;
        }
        NO_TILE
    }

    /// Fit each member's pools to their sheet as it now reads (`syncPools`), what is marked kept up to the new size.
    pub fn sync_pools(&mut self) {
        let members: Vec<String> = self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
        for id in members {
            let Some(character) = self.characters.get(&id).cloned() else { continue };
            let armor = js::min(MAX_SLOTS, js::max(0.0, character.armor_score + self.world.pool_bonus(&id, Stat::ArmorScore)));
            let hit_points = js::min(MAX_SLOTS, js::max(1.0, character.hit_points + self.world.pool_bonus(&id, Stat::HitPoints)));
            let stress = js::min(MAX_SLOTS, js::max(1.0, character.stress + self.world.pool_bonus(&id, Stat::Stress)));
            let fit = |pool: MarkPool, max: f64| if pool.max == max { pool } else { MarkPool { max, marked: js::min(pool.marked, max) } };
            let entity = self.world.state.entity_mut(&id).expect("a member");
            entity.armor_slots = fit(entity.armor_slots, armor);
            entity.hit_points = fit(entity.hit_points, hit_points);
            entity.stress = fit(entity.stress, stress);
        }
    }

    /// What each party member is carrying, pool-wise, right now.
    fn pools_of(&self) -> Ordered<PartyPools> {
        let mut pools = Ordered::default();
        for e in self.world.state.entities_of(Faction::Party) {
            pools.set(&e.id, PartyPools { hit_points: e.hit_points, stress: e.stress, armor_slots: e.armor_slots, good: e.good });
        }
        pools
    }

    // ---- rooms -----------------------------------------------------------------------------------------

    fn scene_doc(&self, id: &str) -> Option<Value> {
        list(&self.project, "scenes").iter().find(|s| text(s, "id") == id).cloned()
    }

    /// Move the party to another room (`travelTo`). Wounds, Stress, Light and Shadow travel; where everyone
    /// stood does not. A room already visited comes back as it was left, the party that walked in put on
    /// its spawns in place of the one it remembers.
    pub fn travel_to(&mut self, scene_id: &str) -> Result<bool, String> {
        let Some(target) = self.scene_doc(scene_id) else { return Ok(false) };
        if scene_id == text(&self.scene, "id") {
            return Ok(false);
        }
        let here = text(&self.scene, "id").to_string();
        self.snapshots.set(&here, self.world.state.snapshot());
        let selected = self.party.selected().map(str::to_string);
        let pools = self.pools_of();
        let bad = self.world.state.bad;
        // Cloned, not taken: a room that cannot be stood up leaves the game where it was.
        let scenario = self.world.scenario.clone();
        let mut runtime = match build_runtime(&self.shipped, &self.hooks_for, &self.project, &target, &self.characters, scenario, Some(&pools), Some(bad)) {
            Ok(runtime) => runtime,
            Err(e) => return Err(e),
        };
        if let Some(remembered) = self.snapshots.get(scene_id).cloned() {
            let state = &mut runtime.world.state;
            let arrivals: Vec<_> = state.entities_of(Faction::Party).cloned().collect();
            state.restore(&remembered)?;
            let stale: Vec<String> = state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
            for id in stale {
                state.remove_entity(&id);
            }
            let spawns = list(&target, "spawns");
            for (i, mut entity) in arrivals.into_iter().enumerate() {
                entity.tile = spawns.get(i % spawns.len().max(1)).map_or(NO_TILE, |s| index_at(&state.grid, s));
                state.add_entity(entity)?;
            }
        }
        // A marked spot is a tile, and a tile means nothing in another room.
        runtime.world.forget_spots();
        self.install(runtime, selected.as_deref())?;
        let intro = text(&target, "intro").to_string();
        if !intro.is_empty() {
            note(self, &intro, "narration");
        }
        Ok(true)
    }

    /// Make a freshly built room the one being played (`install`), its document and state made to agree.
    fn install(&mut self, runtime: Runtime, selected: Option<&str>) -> Result<(), String> {
        self.scene = runtime.scene;
        self.party = runtime.party;
        self.triggers = runtime.triggers;
        self.world = runtime.world;
        self.sync_authored_encounters()?;
        if let Some(selected) = selected.filter(|s| self.party.members(&self.world.state).iter().any(|m| m == s)) {
            self.party.select(&self.world.state, selected);
        }
        Ok(())
    }

    /// Make the room being played agree with the room the document describes (`syncAuthoredEncounters`),
    /// without rebuilding it: its things placed again, a placement new since the last sync brought in, one
    /// the document has dropped taken out, one the state has lost left lost, and the triggers read again.
    pub fn sync_authored_encounters(&mut self) -> Result<(), String> {
        let scene_id = text(&self.scene, "id").to_string();
        let things = placements_of(&self.scene, &self.world.state.grid);
        self.world.state.replace_interactables(&things);
        self.party.set_rules(movement_for(&self.project));
        let known = self.synced_placements.get(&scene_id).cloned();
        let placed = playable_placements(&self.scene, &self.world.state.grid);
        if let Some(known) = &known {
            for encounter in list(&self.scene, "encounters").to_vec() {
                for placement in list(&encounter, "adversaries") {
                    let id = text(placement, "id");
                    // One already standing takes a name given or changed in the editor since.
                    if let Some(standing) = self.world.state.entity_mut(id) {
                        standing.name = placement.get("name").and_then(Value::as_str).map(str::to_string);
                    }
                    if !placed.iter().any(|p| p == id) || known.iter().any(|k| k == id) || self.world.state.entity(id).is_some() {
                        continue;
                    }
                    let adversary = text(placement, "adversary");
                    let def = stat_block_for(&self.shipped, &self.project, adversary).ok_or_else(|| format!("\"{scene_id}\" places adversary \"{adversary}\", which has no stat block"))?;
                    let tile = index_at(&self.world.state.grid, &placement["position"]);
                    let options = placement_options(&encounter, placement, &AdversaryStats { hit_points: def.hit_points, stress: def.stress });
                    self.world.state.add_entity(create_placed_adversary(id, adversary, tile, options))?;
                }
            }
            for id in known {
                if !placed.contains(id) {
                    self.world.state.remove_entity(id);
                }
            }
        }
        self.synced_placements.set(&scene_id, placed);
        self.triggers = TriggerIndex::new(&self.scene, &self.world.state.grid);
        Ok(())
    }

    /// Re-enter a room exactly as a snapshot left it, party included (`enterSavedScene`).
    pub fn enter_saved_scene(&mut self, scene_id: &str, snapshot: &Value) -> Result<bool, String> {
        let Some(target) = self.scene_doc(scene_id) else { return Ok(false) };
        let scenario = self.world.scenario.clone();
        let mut runtime = build_runtime(&self.shipped, &self.hooks_for, &self.project, &target, &self.characters, scenario, None, None)?;
        runtime.world.state.restore(snapshot)?;
        self.install(runtime, None)?;
        Ok(true)
    }
}
