//! The scene and project documents (`src/engine/scene/schema.ts`, with the pieces it is built from:
//! `primitives.ts`, `prop-function-schema.ts`, `building.ts`'s schemas, `render/assets.ts`'s model asset,
//! `rules/jump.ts`'s rules), on the zod-alike: what a project file may say, read as zod reads it - the same
//! output, defaults put in and unknown keys dropped, and the same issues, path for path and word for word.
//! A document is migrated first (`scene::migrate`); these read what that leaves.

use crate::content::schema::Kind;
use crate::dialogue::schema::dialogue_schema;
use crate::js;
use crate::script::schema::{check_request, check_trait, effect, TRAITS};
use crate::zod::*;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

/// The version this build writes.
pub const CURRENT_FORMAT_VERSION: u32 = 6;

/// How far a piece may stand from the origin, either way.
pub use super::building::BUILD_LIMIT;

/// The most tiles a prop may be drawn across.
pub use super::deco_span::DECO_SPAN_MAX;

/// The structures the engine ships, before any a project declares.
pub use super::building::DEFAULT_STRUCTURES;

fn empty_list() -> Value {
    json!([])
}
fn empty_text() -> Value {
    json!("")
}
fn empty_object() -> Value {
    json!({})
}
fn yes() -> Value {
    json!(true)
}
fn no() -> Value {
    json!(false)
}
fn nothing() -> Value {
    Value::Null
}
fn zero() -> Value {
    json!(0)
}
fn one() -> Value {
    json!(1)
}

fn traits() -> Schema {
    one_of(TRAITS)
}

/// `pointSchema`: a cell on the grid.
pub fn point() -> Schema {
    object(vec![req("x", int().min(0.0)), req("y", int().min(0.0))])
}

fn placement_point() -> Schema {
    object(vec![
        req("x", int().min(-BUILD_LIMIT).max(BUILD_LIMIT)),
        req("y", int().min(-BUILD_LIMIT).max(BUILD_LIMIT)),
        opt("z", number().min(-BUILD_LIMIT).max(BUILD_LIMIT).multiple_of(0.25)),
    ])
}

fn script_data() -> Schema {
    record(string(), union(vec![string(), number(), boolean()]))
}

// --- Prop functions -----------------------------------------------------------------------------------

const OBJECT_KINDS: &[&str] = &["chest", "door", "pillar", "portal", "scripted"];

/// What a shop sells and buys: `shopSchema`.
pub fn shop() -> Schema {
    object(vec![
        def("currency", content_id(), || json!("gold")),
        opt("buysAt", int().min(0.0).max(100.0)),
        def("stock", array(object(vec![req("item", content_id()), req("price", int().min(0.0)), opt("count", int().min(1.0))])), empty_list),
    ])
}

/// `propFunctionSchema`: what a prop does when it is used.
pub fn prop_function() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let kind = |k: &'static str| req("kind", literal(json!(k)));
        tagged(
            "kind",
            vec![
                ("container", object(vec![kind("container"), def("items", array(object(vec![req("item", content_id()), def("count", int().min(1.0), one)])), empty_list)])),
                ("door", object(vec![kind("door")])),
                ("portal", object(vec![kind("portal"), def("pair", string().trim(), empty_text)])),
                ("interaction", object(vec![kind("interaction"), def("dialogue", string().trim(), empty_text)])),
                ("shop", object(vec![kind("shop"), def("shop", shop(), || json!({ "currency": "gold", "stock": [] }))])),
                (
                    "trapped",
                    object(vec![
                        kind("trapped"),
                        req("trait", check_trait()),
                        def("difficulty", int().min(1.0).max(40.0), || json!(12)),
                        def("repeatable", boolean(), no),
                        opt("success", lazy(prop_function)),
                        opt("failure", lazy(prop_function)),
                    ]),
                ),
                (
                    "script",
                    object(vec![
                        kind("script"),
                        def("object", one_of(OBJECT_KINDS), || json!("scripted")),
                        def("name", string(), empty_text),
                        def("flavor", string(), empty_text),
                        def("blocksMovement", boolean(), yes),
                        def("effects", array(lazy(effect)), empty_list),
                        opt("check", lazy(check_request)),
                        def("repeatable", boolean(), no),
                        opt("requiresKey", string()),
                        def("lockedText", string(), empty_text),
                        opt("goto", content_id()),
                        def("tags", array(string()), empty_list),
                        def("data", script_data(), empty_object),
                    ]),
                ),
            ],
        )
    })
}

// --- Building -----------------------------------------------------------------------------------------

/// `buildingKey`: where a piece lives in the record, `x,y,level` as JavaScript writes the numbers.
pub fn building_key(tile: &Map<String, Value>) -> String {
    let n = |key: &str| tile.get(key).and_then(Value::as_f64).map_or_else(|| "undefined".to_string(), js::number_to_string);
    format!("{},{},{}", n("x"), n("y"), n("level"))
}

/// `/^[1-9][0-9]*$/`.
fn is_instance(text: &str) -> bool {
    let mut digits = text.bytes();
    matches!(digits.next(), Some(b'1'..=b'9')) && digits.all(|b| b.is_ascii_digit())
}

fn keys_match_places(tiles: &Map<String, Value>, found: &mut Refinements) {
    for (key, tile) in tiles {
        let mut parts = key.split('#');
        let cell = parts.next().unwrap_or_default();
        let instance = parts.next();
        let extra = parts.next().is_some();
        let numbered = instance.is_none_or(is_instance);
        if tile.as_object().is_some_and(|t| cell == building_key(t)) && !extra && numbered {
            continue;
        }
        found.add(vec![Key::Name(key.clone())], "Tile key must match its coordinates and optional instance number".into());
    }
}

/// `buildingTilesSchema`: every piece in a scene, keyed by where it stands. Whether its structure exists
/// is the project's to say, knowing what it declares.
pub fn building_tiles() -> Schema {
    let coordinate = || int().min(-BUILD_LIMIT).max(BUILD_LIMIT);
    let tile = object(vec![
        req("x", coordinate()),
        req("y", coordinate()),
        req("level", number().min(-BUILD_LIMIT).max(BUILD_LIMIT).multiple_of(0.25)),
        opt("height", number().min(0.25).max(16.0).multiple_of(0.25)),
        req("shape", string().min(1.0)),
        req("material", one_of(&["stone", "wood", "grass"])),
        req("rotation", int().min(0.0).max(3.0)),
        opt("tile", string().min(1.0)),
    ]);
    record(string(), tile).refine(keys_match_places)
}

fn structure_type() -> Schema {
    let atom = object(vec![req("shape", string().min(1.0)), opt("at", tuple(vec![number(), number(), number()]))]);
    object(vec![req("id", string().min(1.0)), def("name", string(), empty_text), req("atoms", array(atom).min(1.0))])
}

// --- A scene --------------------------------------------------------------------------------------------

fn interactable() -> Schema {
    object(vec![
        req("id", content_id()),
        req("kind", one_of(OBJECT_KINDS)),
        req("position", placement_point()),
        def("name", string(), empty_text),
        def("flavor", string(), empty_text),
        def("model", nullable(string()), nothing),
        def("rotation", number(), zero),
        def("blocksMovement", boolean(), yes),
        opt("toggles", boolean()),
        def("effects", array(lazy(effect)), empty_list),
        opt("check", lazy(check_request)),
        def("repeatable", boolean(), no),
        opt("requiresKey", string()),
        def("lockedText", string(), empty_text),
        opt("goto", content_id()),
        def("tags", array(string()), empty_list),
        def("data", script_data(), empty_object),
    ])
}

fn adversary_interaction() -> Schema {
    tagged(
        "kind",
        vec![
            ("friendly", object(vec![req("kind", literal(json!("friendly"))), req("dialogue", content_id()), opt("shop", shop())])),
            (
                "threshold",
                object(vec![req("kind", literal(json!("threshold"))), req("dialogue", content_id()), opt("shop", shop()), def("percent", int().min(1.0).max(99.0), || json!(50))]),
            ),
        ],
    )
}

fn encounter() -> Schema {
    let placement = object(vec![
        req("id", content_id()),
        req("adversary", content_id()),
        req("position", placement_point()),
        opt("name", string()),
        opt("hitPoints", int().positive()),
        opt("model", string().min(1.0)),
        opt("interaction", adversary_interaction()),
    ]);
    object(vec![
        req("id", content_id()),
        def("name", string(), empty_text),
        def("adversaries", array(placement), empty_list),
        def("triggerCells", array(point()), empty_list),
        def("startsOnTrigger", boolean(), yes),
        opt("bystanders", boolean()),
    ])
}

fn deco() -> Schema {
    object(vec![
        opt("id", content_id()),
        req("model", string().min(1.0)),
        req("position", placement_point()),
        def("rotation", number(), zero),
        opt("span", int().min(1.0).max(DECO_SPAN_MAX)),
        opt("solid", boolean()),
        opt("function", lazy(prop_function)),
    ])
}

fn list<'a>(scene: &'a Map<String, Value>, key: &str) -> &'a [Value] {
    scene.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn at(parts: &[&dyn std::fmt::Display]) -> Vec<Key> {
    parts
        .iter()
        .map(|p| {
            let text = p.to_string();
            match text.parse::<usize>() {
                Ok(i) if !text.is_empty() && text.chars().all(|c| c.is_ascii_digit()) => Key::Index(i),
                _ => Key::Name(text),
            }
        })
        .collect()
}

fn scene_holds_together(scene: &Map<String, Value>, found: &mut Refinements) {
    let width = scene.get("width").and_then(Value::as_f64).unwrap_or(f64::NAN);
    let height = scene.get("height").and_then(Value::as_f64).unwrap_or(f64::NAN);
    let expected = width * height;
    for field in ["terrain", "heights", "tints"] {
        let Some(array) = scene.get(field).and_then(Value::as_array) else { continue };
        if array.len() as f64 != expected {
            let (e, w, h) = (js::number_to_string(expected), js::number_to_string(width), js::number_to_string(height));
            found.add(vec![Key::Name(field.into())], format!("expected {e} entries for a {w}x{h} scene, got {}", array.len()));
        }
    }
    for (i, p) in list(scene, "spawns").iter().enumerate() {
        let inside = p["x"].as_f64().is_some_and(|x| x < width) && p["y"].as_f64().is_some_and(|y| y < height);
        if !inside {
            found.add(vec![Key::Name("spawns".into()), Key::Index(i)], "spawn is outside the scene".into());
        }
    }
    let mut seen: Vec<String> = Vec::new();
    let mut unique = |id: &Value, path: Vec<Key>, found: &mut Refinements| {
        let id = id.as_str().unwrap_or_default().to_string();
        if seen.contains(&id) {
            found.add(path, format!("duplicate id \"{id}\" in this scene"));
        }
        seen.push(id);
    };
    for (i, it) in list(scene, "interactables").iter().enumerate() {
        unique(&it["id"], at(&[&"interactables", &i, &"id"]), found);
    }
    for (i, deco) in list(scene, "decos").iter().enumerate() {
        if deco.get("function").is_none() {
            continue;
        }
        match deco.get("id") {
            None => found.add(at(&[&"decos", &i, &"id"]), "a prop with a function needs an id".into()),
            Some(id) => unique(id, at(&[&"decos", &i, &"id"]), found),
        }
    }
    for (i, e) in list(scene, "encounters").iter().enumerate() {
        unique(&e["id"], at(&[&"encounters", &i, &"id"]), found);
        for (j, a) in e.get("adversaries").and_then(Value::as_array).map_or(&[][..], Vec::as_slice).iter().enumerate() {
            unique(&a["id"], at(&[&"encounters", &i, &"adversaries", &j, &"id"]), found);
        }
    }
}

/// `sceneSchema`: one room of a project.
pub fn scene() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        object(vec![
            req("id", content_id()),
            def("name", string(), empty_text),
            def("intro", string(), empty_text),
            req("width", int().positive().max(512.0)),
            req("height", int().positive().max(512.0)),
            req("terrain", array(string().min(1.0))),
            req("heights", array(int())),
            opt("tints", array(string())),
            req("spawns", array(point()).min(1.0)),
            def("interactables", array(interactable()), empty_list),
            def("encounters", array(encounter()), empty_list),
            def("decos", array(deco()), empty_list),
            opt("buildingTiles", building_tiles()),
            opt("fogBand", int().positive()),
            opt("origin", object(vec![req("x", int()), req("y", int())])),
        ])
        .refine(scene_holds_together)
    })
}

// --- A project ------------------------------------------------------------------------------------------

fn terrain_type() -> Schema {
    object(vec![
        req("id", content_id()),
        def("name", string(), empty_text),
        def("passable", boolean(), yes),
        def("cost", number().positive(), one),
        def("providesCover", boolean(), no),
        def("blocksSight", boolean(), no),
        opt("color", string().min(1.0)),
        opt("model", string().min(1.0)),
        opt("scale", number().positive()),
        opt("structure", string().min(1.0)),
    ])
}

/// `modelAssetSchema` (`render/assets.ts`): a model a project brings, and how it is seated.
fn model_asset() -> Schema {
    let clip = |key: &'static str| opt(key, string().min(1.0));
    object(vec![
        req("id", content_id()),
        def("kind", literal(json!("gltf")), || json!("gltf")),
        req("url", string().min(1.0)),
        def("scale", number().positive(), one),
        def("groundOffset", number(), zero),
        def("rotationY", number(), zero),
        def("offsetX", number(), zero),
        def("offsetY", number(), zero),
        opt("pivot", one_of(&["base", "file"])),
        opt("clips", object(vec![clip("idle"), clip("walk"), clip("hit"), clip("fallen")])),
    ])
}

/// `jumpRulesSchema` (`rules/jump.ts`): how anybody jumps, every part defaulted.
pub fn jump_rules() -> Schema {
    let n = |most: f64| number().min(0.0).max(most);
    object(vec![
        def("enabled", boolean(), yes),
        def("stepHeight", n(16.0), || json!(0.72)),
        def("reachTrait", traits(), || json!("strength")),
        def("reachBase", n(64.0), one),
        def("reachPerPoint", n(16.0), one),
        def("rangeBase", n(64.0), || json!(3)),
        def("rangePerPoint", n(16.0), one),
        def("flatRoll", boolean(), no),
        def("rollTrait", traits(), || json!("agility")),
        def("difficulty", int().min(1.0).max(40.0), || json!(12)),
        def("dropTrait", traits(), || json!("agility")),
        def("dropBase", n(64.0), one),
        def("dropPerPoint", n(16.0), one),
        def("harderEvery", n(64.0), || json!(2)),
        def("fallDie", int().min(0.0).max(100.0), || json!(6)),
        def("halfOnSuccess", boolean(), yes),
        def("failCondition", string(), || json!("prone")),
    ])
}

fn prop_preset() -> Schema {
    object(vec![
        req("id", content_id()),
        req("label", string().min(1.0)),
        req("model", string().min(1.0)),
        opt("span", int().min(1.0).max(DECO_SPAN_MAX)),
        opt("rotation", number()),
        opt("solid", boolean()),
        opt("function", lazy(prop_function)),
    ])
}

fn duplicates(project: &Map<String, Value>, field: &str, what: &str, found: &mut Refinements) {
    let mut seen: Vec<&Value> = Vec::new();
    for (i, entry) in list(project, field).iter().enumerate() {
        let id = &entry["id"];
        if seen.contains(&id) {
            found.add(at(&[&field, &i, &"id"]), format!("duplicate {what} id \"{}\"", id.as_str().unwrap_or_default()));
        }
        seen.push(id);
    }
}

fn project_holds_together(project: &Map<String, Value>, found: &mut Refinements) {
    duplicates(project, "scenes", "scene", found);
    // Every piece built of a structure there is: the engine's four, and the project's own.
    let declared: Vec<&str> = list(project, "structureTypes").iter().filter_map(|s| s["id"].as_str()).collect();
    for (i, scene) in list(project, "scenes").iter().enumerate() {
        let Some(tiles) = scene.get("buildingTiles").and_then(Value::as_object) else { continue };
        for (key, tile) in tiles {
            let shape = tile["shape"].as_str().unwrap_or_default();
            if !DEFAULT_STRUCTURES.contains(&shape) && !declared.contains(&shape) {
                found.add(vec![Key::Name("scenes".into()), Key::Index(i), Key::Name("buildingTiles".into()), Key::Name(key.clone())], format!("No structure called {}", json!(shape)));
            }
        }
    }
    duplicates(project, "dialogues", "dialogue", found);
    duplicates(project, "items", "item", found);
    duplicates(project, "assets", "asset", found);
    duplicates(project, "quests", "quest", found);
    duplicates(project, "party", "character", found);
    duplicates(project, "abilities", "ability", found);
    duplicates(project, "lootTables", "loot table", found);
    let start = project.get("startScene").and_then(Value::as_str).unwrap_or_default();
    if !list(project, "scenes").iter().any(|s| s["id"].as_str() == Some(start)) {
        found.add(vec![Key::Name("startScene".into())], format!("startScene \"{start}\" is not one of the project's scenes"));
    }
}

fn content(kind: Kind) -> Schema {
    // `lazy` holds a function; each kind's schema is built once, behind `Kind::schema`.
    match kind {
        Kind::Class => lazy(|| Kind::Class.schema()),
        Kind::Ancestry => lazy(|| Kind::Ancestry.schema()),
        Kind::Community => lazy(|| Kind::Community.schema()),
        Kind::Subclass => lazy(|| Kind::Subclass.schema()),
        Kind::Card => lazy(|| Kind::Card.schema()),
        Kind::Weapon => lazy(|| Kind::Weapon.schema()),
        Kind::Armor => lazy(|| Kind::Armor.schema()),
        Kind::Adversary => lazy(|| Kind::Adversary.schema()),
        Kind::Ability => lazy(|| Kind::Ability.schema()),
        Kind::Code => lazy(|| Kind::Code.schema()),
        Kind::ConditionDef => lazy(|| Kind::ConditionDef.schema()),
        Kind::Item => lazy(|| Kind::Item.schema()),
        Kind::LootTable => lazy(|| Kind::LootTable.schema()),
        Kind::Quest => lazy(|| Kind::Quest.schema()),
        Kind::Experience => lazy(|| Kind::Experience.schema()),
    }
}

/// `projectSchema`: a whole project, as a file holds it once it is migrated.
pub fn project() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let listed = |key: &'static str, kind: Kind| def(key, array(content(kind)), empty_list);
        object(vec![
            def("formatVersion", union((1..=6).map(|v| literal(json!(v))).collect()), || json!(CURRENT_FORMAT_VERSION)),
            req("id", content_id()),
            def("name", string(), empty_text),
            opt("terrainPalette", array(terrain_type()).min(1.0)),
            opt("structureTypes", array(structure_type())),
            opt("propPresets", array(prop_preset())),
            req("scenes", array(lazy(scene)).min(1.0)),
            def("dialogues", array(lazy(dialogue_schema)), empty_list),
            listed("items", Kind::Item),
            listed("lootTables", Kind::LootTable),
            listed("quests", Kind::Quest),
            def("assets", array(model_asset()), empty_list),
            def("adversaryModels", record(string(), string().min(1.0)), empty_object),
            listed("classes", Kind::Class),
            listed("ancestries", Kind::Ancestry),
            listed("communities", Kind::Community),
            listed("subclasses", Kind::Subclass),
            listed("cards", Kind::Card),
            listed("weapons", Kind::Weapon),
            listed("armors", Kind::Armor),
            listed("adversaries", Kind::Adversary),
            listed("abilities", Kind::Ability),
            listed("code", Kind::Code),
            listed("conditionDefs", Kind::ConditionDef),
            def("packs", array(string()), empty_list),
            def("party", array(lazy(crate::character::schema::sheet_schema)), empty_list),
            opt("jump", jump_rules()),
            req("startScene", content_id()),
        ])
        .refine(project_holds_together)
    })
}
