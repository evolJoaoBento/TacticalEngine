//! `server/fixtures/room.json` replayed: every room the TypeScript stood up from its document - the grid
//! tile for tile, the play state, what a snapshot does not hold, the things that can be used, the ground
//! that wakes an encounter and the props' blocks - stood up again here and held to it; the structures a
//! project knows and what each is to somebody standing on it; rooms grown and snapshots restored across
//! the growth, and back; prop functions turned into the objects they play as; portals paired; objects
//! made props; and every use refused, or what it would run, with the key asked about as the TypeScript
//! asked.

#[macro_use]
#[path = "support/world.rs"]
mod support;

use engine::content::document::ContentIssue;
use engine::grid::tile_grid::{TileGrid, NO_TILE};
use engine::rules::resources::Currency;
use engine::scene::building::Structures;
use engine::scene::deco_span::{deco_centre, deco_covers, deco_footprint};
use engine::scene::grid_from_scene::{grid_from_scene, palette_for_project};
use engine::scene::interact::{decide, opening_effects};
use engine::scene::prop_functions::{container_items, find_function, interactables_of, object_of_prop, objects_to_props, opens, pair_taken, pairs_of, portal_partner, portals_with, steps_of, Portal};
use engine::scene::reshape::{grown_scene, growth_to_reach, shift_snapshot, Reach};
use engine::scene::state::{create_party_entity, placements_of, scene_state_from_scene, AdversaryStats, SceneState};
use engine::scene::triggers::TriggerIndex;
use engine::script::conditions::InteractableState;
use serde_json::{json, Value};
use std::collections::HashMap;
use support::{fixture, from, same, to};

const FUNCTION_KINDS: [&str; 7] = ["container", "door", "trapped", "portal", "interaction", "shop", "script"];

fn spec_of(grid: &TileGrid) -> Value {
    let palette: Vec<Value> = grid
        .palette
        .types
        .iter()
        .map(|t| json!({ "id": t.id, "name": t.name, "passable": t.passable, "cost": if t.cost.is_finite() { json!(t.cost) } else { Value::Null }, "providesCover": t.provides_cover, "blocksSight": t.blocks_sight, "structure": t.structure }))
        .collect();
    json!({
        "width": grid.width, "height": grid.height, "origin": { "x": grid.origin.x, "y": grid.origin.y }, "palette": palette,
        "heights": grid.heights, "terrain": grid.terrain, "overlay": grid.overlay,
        "lift": grid.lift.iter().map(|&l| f64::from(l)).collect::<Vec<_>>(), "barred": grid.barred,
    })
}

fn issues(found: &[ContentIssue]) -> Value {
    to(&found)
}

/// A room stood up from what the case holds: its project's ground and structures, its stat blocks, its party.
fn stand_up(case: &Value, scene: &Value) -> (SceneState, Vec<ContentIssue>, Vec<ContentIssue>) {
    let (palette, structures) = palette_for_project(&case["project"]).expect("a palette");
    let (grid, grid_issues) = grid_from_scene(scene, palette, &structures, None);
    let stats: HashMap<String, AdversaryStats> = case["stats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pair| (pair[0].as_str().unwrap().to_string(), AdversaryStats { hit_points: pair[1]["hitPoints"].as_f64().unwrap(), stress: pair[1]["stress"].as_f64().unwrap() }))
        .collect();
    let party = case["party"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| create_party_entity(m["id"].as_str().unwrap(), m["definition"].as_str().unwrap(), NO_TILE, m["hitPoints"].as_f64().unwrap(), m["stress"].as_f64().unwrap(), m["armorSlots"].as_f64().unwrap()))
        .collect();
    let bad: Option<Currency> = (!case["bad"].is_null()).then(|| from(&case["bad"]));
    let (state, state_issues) = scene_state_from_scene(scene, grid, &stats, party, bad).expect("a room");
    (state, grid_issues, state_issues)
}

fn point(x: f64, y: f64) -> Value {
    json!({ "x": x, "y": y })
}

#[test]
fn rooms_stand_up_as_the_typescript_stands_them_up() {
    let fixture = fixture("room.json");
    let rooms = fixture["rooms"].as_array().unwrap();
    assert!(rooms.len() > 120);
    for case in rooms {
        let at = case["name"].as_str().unwrap();
        let scene = &case["scene"];
        let (mut state, grid_issues, state_issues) = stand_up(case, scene);
        check!(spec_of(&state.grid), &case["grid"], "{at}: the grid");
        check!(issues(&grid_issues), &case["gridIssues"], "{at}: the grid's issues");
        let placements: Vec<Value> = placements_of(scene, &state.grid).iter().map(|p| json!({ "id": p.id, "tile": p.tile, "door": p.door, "footprint": p.footprint, "blocks": p.blocks })).collect();
        check!(json!(placements), &case["placements"], "{at}: the placements");
        check!(state.snapshot(), &case["state"], "{at}: the state");
        check!(issues(&state_issues), &case["stateIssues"], "{at}: the state's issues");
        check!(json!(interactables_of(scene)), &case["interactables"], "{at}: the things to use");

        let index = TriggerIndex::new(scene, &state.grid);
        let tiles: Vec<i32> = (0..state.grid.size()).collect();
        let cells: Vec<Value> = tiles.iter().map(|&t| index.at(t).map_or(Value::Null, |e| json!(e))).collect();
        let mut hits = Vec::new();
        for _ in 0..12 {
            let Some(hit) = index.first_along(&tiles, &mut state) else { break };
            state.encounter(&hit.encounter).triggered = true;
            hits.push(hit);
        }
        check!(json!({ "size": index.size(), "at": cells, "hits": hits, "encounters": state.snapshot()["encounters"] }), &case["triggers"], "{at}: the triggers");
        check!(state.layout(), &case["layout"], "{at}: the layout");

        let decos: Vec<Value> = scene["decos"]
            .as_array()
            .unwrap()
            .iter()
            .map(|deco| {
                let (x, y) = (deco["position"]["x"].as_f64().unwrap(), deco["position"]["y"].as_f64().unwrap());
                let (cx, cy) = deco_centre(deco);
                let steps = [-1.0, 0.0, 1.0, 2.0, 3.0, 4.0];
                let covers: Vec<bool> = steps.iter().flat_map(|dy| steps.iter().map(move |dx| deco_covers(deco, x + dx, y + dy))).collect();
                let footprint: Vec<Value> = deco_footprint(deco).into_iter().map(|(x, y)| point(x, y)).collect();
                json!({ "footprint": footprint, "centre": point(cx, cy), "covers": covers })
            })
            .collect();
        check!(json!(decos), &case["decos"], "{at}: the props' blocks");
    }
}

#[test]
fn structures_stand_as_the_typescript_says() {
    let fixture = fixture("room.json");
    for case in fixture["profiles"].as_array().unwrap() {
        let (_, structures): (_, Structures) = palette_for_project(&case["project"]).unwrap();
        let ids: Vec<&str> = structures.ids().collect();
        check!(json!(ids), &case["ids"], "the structures");
        let profiles: Vec<Vec<Value>> = ids.iter().chain(["nothing"].iter()).map(|id| [0.25, 0.5, 1.0, 1.75, 4.0].iter().map(|&s| to(&structures.profile(id, s))).collect()).collect();
        check!(json!(profiles), &case["profiles"], "what each is to stand on");
    }
}

#[test]
fn rooms_grow_and_games_follow_them() {
    let fixture = fixture("room.json");
    let rooms = fixture["rooms"].as_array().unwrap();
    let mut grown = 0;
    for (i, case) in fixture["grown"].as_array().unwrap().iter().enumerate() {
        let room = &rooms[case["room"].as_u64().unwrap() as usize];
        let scene = &room["scene"];
        let reach: Reach = from(&case["reach"]);
        let growth = growth_to_reach(scene["width"].as_f64().unwrap(), scene["height"].as_f64().unwrap(), &reach, case["cap"].as_f64().unwrap());
        check!(to(&growth), &case["growth"], "grown {i}: how");
        let Some(growth) = growth else { continue };
        grown += 1;
        let shape = grown_scene(scene, &growth, case["fill"].as_str());
        check!(shape.clone(), &case["grown"], "grown {i}: the room");
        let mut larger = scene.clone();
        for (key, value) in shape.as_object().unwrap() {
            larger[key] = value.clone();
        }
        let played = stand_up(room, scene).0.snapshot();
        let (mut after, _, _) = stand_up(room, &larger);
        after.restore(&played).unwrap();
        check!(after.snapshot(), &case["restored"], "grown {i}: a game from before, restored after");
        let (mut back, _, _) = stand_up(room, scene);
        back.restore(&after.snapshot()).unwrap();
        check!(back.snapshot(), &case["undone"], "grown {i}: and the growth undone");
    }
    assert!(grown > 50, "{grown}");
}

#[test]
fn snapshots_shift_as_the_typescript_shifts_them() {
    let fixture = fixture("room.json");
    let rooms = fixture["rooms"].as_array().unwrap();
    for (i, case) in fixture["shifted"].as_array().unwrap().iter().enumerate() {
        let room = &rooms[case["room"].as_u64().unwrap() as usize];
        let snapshot = stand_up(room, &room["scene"]).0.snapshot();
        let n = |key: &str| case[key].as_i64().unwrap() as i32;
        let shifted = shift_snapshot(&snapshot, room["scene"]["width"].as_i64().unwrap() as i32, n("dx"), n("dy"), n("width"), n("height"), n("fallback"));
        check!(shifted, &case["shifted"], "shift {i}");
    }
}

#[test]
fn prop_functions_play_as_the_typescript_plays_them() {
    let fixture = fixture("room.json");
    for (i, case) in fixture["functions"].as_array().unwrap().iter().enumerate() {
        let function = &case["prop"]["function"];
        check!(object_of_prop(&case["prop"]), &case["object"], "function {i}: the object it plays as");
        check!(json!(steps_of(Some(function), "thing")), &case["steps"], "function {i}: as a step");
        check!(json!(opens(Some(function))), &case["opens"], "function {i}: in the way until opened");
        let found: Vec<Value> = FUNCTION_KINDS.iter().map(|kind| find_function(Some(function), kind).cloned().unwrap_or(Value::Null)).collect();
        check!(json!(found), &case["found"], "function {i}: found by kind");
        check!(json!(container_items(Some(function))), &case["items"], "function {i}: what it holds");
        check!(json!(pairs_of(Some(function))), &case["pairs"], "function {i}: the pairs it answers to");
    }

    let view = |found: &[Portal]| json!(found.iter().map(|p| json!({ "scene": p.scene, "prop": p.prop["id"] })).collect::<Vec<_>>());
    for case in fixture["portals"].as_array().unwrap() {
        let project = &case["project"];
        let mut ids: Vec<Option<String>> = project["scenes"].as_array().unwrap().iter().flat_map(|s| s["decos"].as_array().unwrap().iter().map(|d| d["id"].as_str().map(str::to_string))).collect();
        ids.push(Some("stranger".into()));
        ids.push(None);
        for asked in case["asked"].as_array().unwrap() {
            let pair = asked["pair"].as_str().unwrap();
            let at = format!("portals {}, pair {pair:?}", case["seed"]);
            check!(view(&portals_with(project, pair)), &asked["with"], "{at}: all of them");
            let partners: Vec<Value> = ids.iter().map(|from| portal_partner(project, pair, from.as_deref()).map_or(Value::Null, |p| json!({ "scene": p.scene, "prop": p.prop["id"] }))).collect();
            check!(json!(partners), &asked["partner"], "{at}: the other end");
            let taken: Vec<Vec<String>> = ids.iter().map(|this| pair_taken(project, pair, this.as_deref())).collect();
            check!(json!(taken), &asked["taken"], "{at}: already a pair");
        }
    }

    let rooms = fixture["rooms"].as_array().unwrap();
    for (i, case) in fixture["converted"].as_array().unwrap().iter().enumerate() {
        let mut scene = rooms[case["room"].as_u64().unwrap() as usize]["scene"].clone();
        let changed = objects_to_props(&mut scene);
        check!(json!({ "changed": changed, "interactables": scene["interactables"], "decos": scene["decos"] }), &json!({ "changed": case["changed"], "interactables": case["interactables"], "decos": case["decos"] }), "converted {i}");
    }
}

#[test]
fn a_use_is_refused_or_runs_as_the_typescript_decides() {
    let fixture = fixture("room.json");
    let things = fixture["things"].as_array().unwrap();
    for (thing, runs) in things.iter().zip(fixture["runs"].as_array().unwrap()) {
        check!(json!(opening_effects(thing)), runs, "what {} runs", thing["id"]);
    }
    let mut refused = 0;
    for case in fixture["uses"].as_array().unwrap() {
        let thing = &things[case["thing"].as_u64().unwrap() as usize];
        let flag = |key: &str| case["state"][key].as_bool().unwrap();
        let state = InteractableState { used: flag("used"), open: flag("open"), removed: flag("removed") };
        let has_key = case["hasKey"].as_bool().unwrap();
        let mut asked = Vec::new();
        let decided = decide(thing, state, &mut |key| {
            asked.push(key.to_string());
            has_key
        }, case["repeatable"].as_bool().unwrap());
        let at = format!("using {} {}", thing["id"], json!({ "state": case["state"], "hasKey": has_key, "repeatable": case["repeatable"] }));
        check!(json!(asked), &case["asked"], "{at}: the keys asked about");
        match decided {
            Ok(effects) => {
                assert!(case["refused"].is_null(), "{at}: we ran it, the TypeScript refused");
                check!(json!(effects), &fixture["runs"][case["thing"].as_u64().unwrap() as usize], "{at}: what it runs");
            }
            Err(refusal) => {
                refused += 1;
                check!(to(&refusal), &case["refused"], "{at}: refused");
            }
        }
    }
    assert!(refused > 1000, "{refused}");
}
