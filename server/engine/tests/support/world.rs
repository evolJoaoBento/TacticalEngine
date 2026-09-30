//! What the world's replays share, in `golden_world.rs` here and beside the hooks in
//! `server/hooks/tests/golden_runs.rs`: reading the fixtures, comparing JSON as the TypeScript wrote it,
//! standing a world up from what the TypeScript's began as, and saying what a step changed.
#![allow(dead_code)]

use engine::character::sheet::{derive_character, CharacterSheet};
use engine::combat::defense::DefensePolicy;
use engine::content::abilities::AbilityDef;
use engine::content::adversaries::AdversaryDef;
use engine::content::conditions::ConditionDef;
use engine::content::items::LootTable;
use engine::content::pack::{CardDef, ContentPack};
use engine::grid::pathfinding::MovementRules;
use engine::grid::terrain::{TerrainPalette, TerrainType};
use engine::grid::tile_grid::{Origin, TileGrid};
use engine::rules::jump::Trait;
use engine::rules::range::BandTiles;
use engine::scene::state::SceneState;
use engine::script::runner::RunStatus;
use engine::script::world::{SceneScriptWorld, WorldContent};
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn fixture(name: &str) -> Value {
    let path = format!("{}/../../server/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/script/runner.golden.test.ts")).expect("JSON")
}

/// Two JSON answers the same: numbers by value, objects by their keys whatever the order.
pub fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        _ => a == b,
    }
}

#[macro_export]
macro_rules! check {
    ($got:expr, $wanted:expr, $($what:tt)*) => {{
        let (got, wanted): (Value, &Value) = ($got, $wanted);
        assert!(same(&got, wanted), "{}:\n  rust       {}\n  typescript {}", format!($($what)*), got, wanted);
    }};
}

pub fn from<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("{e}: {value}"))
}

pub fn to<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("serializes")
}

// --- The world's inputs ----------------------------------------------------------------------------------

pub fn grid_of(spec: &Value) -> TileGrid {
    let types = spec["palette"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| TerrainType {
            passable: t["passable"].as_bool().unwrap(),
            cost: t["cost"].as_f64().unwrap_or(f64::INFINITY),
            provides_cover: t["providesCover"].as_bool().unwrap(),
            blocks_sight: t["blocksSight"].as_bool().unwrap(),
            ..TerrainType::new(t["id"].as_str().unwrap())
        })
        .collect();
    let mut grid = TileGrid::new(spec["width"].as_i64().unwrap() as i32, spec["height"].as_i64().unwrap() as i32, TerrainPalette::new(types).expect("a palette"));
    let each = |key: &str| spec[key].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect::<Vec<_>>();
    grid.heights = each("heights").iter().map(|&h| h as i16).collect();
    grid.terrain = each("terrain").iter().map(|&t| t as u8).collect();
    grid.overlay = each("overlay").iter().map(|&o| o as i16).collect();
    grid.lift = each("lift").iter().map(|&l| l as f32).collect();
    grid.barred = each("barred").iter().map(|&b| b as u8).collect();
    grid.origin = Origin { x: spec["origin"]["x"].as_i64().unwrap() as i32, y: spec["origin"]["y"].as_i64().unwrap() as i32 };
    grid
}

/// The content a world was built with, the characters derived here from their sheets - and held to what
/// the TypeScript derived, since everything after reads them.
pub fn content_of(spec: &Value) -> (WorldContent, Vec<String>) {
    let pack: ContentPack = from(&spec["pack"]);
    let abilities: Vec<AbilityDef> = from(&spec["abilities"]);
    let mut characters = HashMap::new();
    for (sheet, derived) in spec["sheets"].as_array().unwrap().iter().zip(spec["derived"].as_array().unwrap()) {
        let sheet: CharacterSheet = from(sheet);
        let (character, _) = derive_character(&sheet, &pack, &abilities);
        let ids = |cards: &[CardDef]| cards.iter().map(|c| c.id.clone()).collect::<Vec<_>>();
        let view = json!({
            "id": sheet.id, "cards": ids(&character.cards), "granted": ids(&character.granted), "modifiers": to(&character.modifiers),
            "proficiency": character.proficiency, "evasion": character.evasion, "thresholds": to(&character.thresholds), "traits": to(&character.traits),
        });
        check!(view, derived, "{} derived", sheet.id);
        characters.insert(sheet.id.clone(), character);
    }
    let traits = spec["traits"].as_object().unwrap().iter().map(|(t, v)| (Trait::from_name(t).expect("a trait"), v.as_f64().unwrap())).collect();
    let movement = (!spec["movement"].is_null()).then(|| {
        let m = &spec["movement"];
        MovementRules {
            diagonals: m["diagonals"].as_bool().unwrap(),
            max_step_height: m["maxStepHeight"].as_f64().unwrap_or(f64::INFINITY),
            allow_corner_cutting: m["allowCornerCutting"].as_bool().unwrap(),
            diagonal_cost_multiplier: m["diagonalCostMultiplier"].as_f64().unwrap(),
        }
    });
    let content = WorldContent {
        traits,
        characters,
        adversaries: from::<Vec<AdversaryDef>>(&spec["adversaries"]).into_iter().map(|a| (a.id.clone(), a)).collect(),
        band_tiles: (!spec["bandTiles"].is_null()).then(|| from::<BandTiles>(&spec["bandTiles"])),
        movement,
        defense: from::<DefensePolicy>(&spec["defense"]),
        abilities,
        cards: (!spec["cards"].is_null()).then(|| from::<Vec<CardDef>>(&spec["cards"])),
        condition_defs: WorldContent::index_conditions(from::<Vec<ConditionDef>>(&spec["conditionDefs"])),
        loot_tables: from::<Vec<LootTable>>(&spec["lootTables"]).into_iter().map(|t| (t.id.clone(), t)).collect(),
    };
    (content, from(&spec["hooks"]))
}

/// The scene a run began in: restored from its snapshot, then the room's things put back where the
/// TypeScript had them, blocking what it had them block.
pub fn scene_of(grid: &Value, start: &Value) -> SceneState {
    let mut state = SceneState::new(start["scene"]["sceneId"].as_str().unwrap(), grid_of(grid), None);
    state.restore(&start["scene"]).expect("a snapshot of this room");
    let layout = &start["layout"];
    let doors: Vec<String> = from(&layout["doors"]);
    let footprints: HashMap<String, Vec<i32>> = layout["footprints"].as_array().unwrap().iter().map(|p| (p[0].as_str().unwrap().to_string(), from(&p[1]))).collect();
    for pair in layout["tiles"].as_array().unwrap() {
        let id = pair[0].as_str().unwrap();
        let footprint = footprints.get(id).cloned().unwrap_or_default();
        state.place_interactable(id, pair[1].as_i64().unwrap() as i32, doors.iter().any(|d| d == id), &footprint);
    }
    for tile in layout["blocking"].as_array().unwrap() {
        state.set_interactable_blocking(tile.as_i64().unwrap() as i32, true);
    }
    state
}

pub fn status_json(status: &RunStatus, journal: &[Value], since: usize) -> Value {
    let mut out = match status {
        RunStatus::Done => json!({ "status": "done" }),
        RunStatus::Waiting(prompt) => json!({ "status": "waiting", "prompt": prompt }),
    };
    out["journalLength"] = json!(journal.len());
    out["newEntries"] = Value::Array(journal[since.min(journal.len())..].to_vec());
    out
}

// --- What a step changed --------------------------------------------------------------------------------

/// The scene and scenario as they stand, in the parts a step reports.
pub fn standing(world: &SceneScriptWorld) -> Value {
    let scene = world.state.snapshot();
    json!({ "entities": scene["entities"], "interactables": scene["interactables"], "encounters": scene["encounters"], "bad": scene["bad"], "scenario": world.scenario.snapshot() })
}

/// Each creature that changed (null for one gone), and each other part that did, whole.
pub fn changes(was: &Value, now: &Value) -> Value {
    let mut out = serde_json::Map::new();
    let mut entities = serde_json::Map::new();
    let (before, after) = (was["entities"].as_object().unwrap(), now["entities"].as_object().unwrap());
    for id in before.keys().chain(after.keys()) {
        let (a, b) = (before.get(id), after.get(id));
        if !matches!((a, b), (Some(a), Some(b)) if same(a, b)) {
            entities.insert(id.clone(), b.cloned().unwrap_or(Value::Null));
        }
    }
    if !entities.is_empty() {
        out.insert("entities".into(), Value::Object(entities));
    }
    for part in ["interactables", "encounters", "bad", "scenario"] {
        if !same(&was[part], &now[part]) {
            out.insert(part.into(), now[part].clone());
        }
    }
    Value::Object(out)
}
