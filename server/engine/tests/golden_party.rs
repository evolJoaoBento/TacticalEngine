//! `server/fixtures/party.json` replayed: every session of orders the TypeScript gave a party, given again
//! here to a party in the same room, stood up from the same document - each answer the same, and after
//! each, everybody where the TypeScript had them, with the party's selection, order, groups, held members
//! and trails.

#[macro_use]
#[path = "support/world.rs"]
mod support;

use engine::grid::pathfinding::MovementRules;
use engine::grid::tile_grid::{Spot, TileGrid, NO_TILE};
use engine::grid::walk::{Circle, WalkRules};
use engine::scene::grid_from_scene::{grid_from_scene, palette_for_project};
use engine::scene::party::{Party, PartyOptions, WalkOptions};
use engine::scene::state::{create_party_entity, scene_state_from_scene, AdversaryStats, SceneState};
use serde_json::{json, Value};
use std::collections::HashMap;
use support::{fixture, from, same, to};

fn stand_up(room: &Value) -> SceneState {
    let (palette, structures) = palette_for_project(&room["project"]).expect("a palette");
    let (grid, _) = grid_from_scene(&room["scene"], palette, &structures, None);
    let stats: HashMap<String, AdversaryStats> = room["stats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pair| (pair[0].as_str().unwrap().to_string(), AdversaryStats { hit_points: pair[1]["hitPoints"].as_f64().unwrap(), stress: pair[1]["stress"].as_f64().unwrap() }))
        .collect();
    let party = room["party"].as_array().unwrap().iter().map(|m| create_party_entity(m["id"].as_str().unwrap(), m["definition"].as_str().unwrap(), NO_TILE, 6.0, 6.0, 2.0)).collect();
    scene_state_from_scene(&room["scene"], grid, &stats, party, None).expect("a room").0
}

/// A number the TypeScript wrote as null because it was not finite.
fn infinite(value: &Value) -> f64 {
    value.as_f64().unwrap_or(f64::INFINITY)
}

fn rules_of(r: &Value) -> MovementRules {
    MovementRules { diagonals: r["diagonals"].as_bool().unwrap(), max_step_height: infinite(&r["maxStepHeight"]), allow_corner_cutting: r["allowCornerCutting"].as_bool().unwrap(), diagonal_cost_multiplier: r["diagonalCostMultiplier"].as_f64().unwrap() }
}

fn options_of(o: &Value) -> PartyOptions {
    PartyOptions {
        combat_reach: infinite(&o["combatReach"]),
        move_budget: infinite(&o["moveBudget"]),
        follower_budget: infinite(&o["followerBudget"]),
        follow_distance: o["followDistance"].as_f64().unwrap(),
        trail_length: o["trailLength"].as_f64().unwrap(),
        rules: rules_of(&o["rules"]),
        walk: WalkRules { radius: o["walk"]["radius"].as_f64().unwrap(), max_step_height: infinite(&o["walk"]["maxStepHeight"]) },
    }
}

fn spot(value: &Value) -> Option<Spot> {
    value.is_object().then(|| from(value))
}

fn walk_options(o: &Value) -> WalkOptions {
    WalkOptions {
        in_combat: o["inCombat"] == true,
        budget: o.get("budget").map(infinite),
        at: spot(&o["at"]),
        from: spot(&o["from"]),
        within: o["within"].is_object().then(|| Circle { anchor: from(&o["within"]["anchor"]), radius: o["within"]["radius"].as_f64().unwrap() }),
        short: o["short"] == true,
    }
}

fn number(value: f64) -> Value {
    if value.is_finite() {
        json!(value)
    } else {
        Value::Null
    }
}

/// A field as the TypeScript writes one: its tiles cheapest first, what each costs and was reached from,
/// and whether every tile of the room can be reached.
fn field_json(grid: &TileGrid, start: i32, budget: f64, tiles: Vec<i32>, cost_to: impl Fn(i32) -> f64, came_from: impl Fn(i32) -> i32, can_reach: impl Fn(i32) -> bool) -> Value {
    let reach: String = (0..grid.size()).map(|t| if can_reach(t) { '1' } else { '0' }).collect();
    let cost: Vec<Value> = tiles.iter().map(|&t| number(cost_to(t))).collect();
    let came: Vec<i32> = tiles.iter().map(|&t| came_from(t)).collect();
    json!({ "start": start, "budget": number(budget), "tiles": tiles, "cost": cost, "came": came, "reach": reach })
}

fn view(party: &Party, state: &SceneState) -> Value {
    let members = party.members(state);
    let entities: Vec<Value> = state.all_entities().iter().map(|e| json!([e.id, e.tile, e.at.x, e.at.y, e.alive])).collect();
    json!({
        "entities": entities,
        "selected": party.selected(),
        "groups": members.iter().map(|id| party.group_of(state, id)).collect::<Vec<_>>(),
        "held": members.iter().filter(|id| party.is_held(id)).collect::<Vec<_>>(),
        "trails": members.iter().map(|id| to(&party.trail(id))).collect::<Vec<_>>(),
        "members": members,
    })
}

#[test]
fn the_party_moves_as_the_typescript_moves_it() {
    let fixture = fixture("party.json");
    let sessions = fixture["sessions"].as_array().unwrap();
    assert!(sessions.len() > 60);
    let (mut walked, mut followed) = (0, 0);
    for session in sessions {
        let name = session["name"].as_str().unwrap();
        let mut state = stand_up(&session["room"]);
        let mut party = Party::new(&state, options_of(&session["options"]));
        check!(view(&party, &state), &session["start"], "{name}: the start");
        for (n, op) in session["ops"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, order {n}: {}", op["op"]);
            let id = op["id"].as_str().unwrap_or_default();
            let result = match op["op"].as_str().unwrap() {
                "select" => json!(party.select(&state, id)),
                "selectNext" => json!(party.select_next(&state)),
                "arrange" => json!(party.arrange(&state, id, op["before"].as_str())),
                "link" => json!(party.link(&state, id, op["with"].as_str().unwrap())),
                "unlink" => json!(party.unlink(&state, id)),
                "hold" => json!(party.hold(&state, id)),
                "release" => json!(party.release(id)),
                "canCommand" => json!(party.can_command(&state, op["id"].as_str())),
                "reachable" => {
                    let o = &op["options"];
                    let field = party.reachable(&state, id, o["inCombat"] == true, o.get("budget").map(infinite), spot(&o["from"]));
                    field_json(&state.grid, field.start, field.budget, field.tiles(), |t| field.cost_to(t), |t| field.came_from(t), |t| field.can_reach(t))
                }
                "covered" => {
                    let o = &op["options"];
                    let within = o["within"].is_object().then(|| Circle { anchor: from(&o["within"]["anchor"]), radius: o["within"]["radius"].as_f64().unwrap() });
                    let field = party.covered(&state, id, o["inCombat"] == true, o.get("budget").map(infinite), within);
                    field_json(&state.grid, field.start(), field.budget(), field.tiles(), |t| field.cost_to(t), |t| field.came_from(t), |t| field.can_reach(t))
                }
                "planWalk" => to(&party.plan_walk(&state, id, op["destination"].as_i64().unwrap() as i32, &walk_options(&op["options"]))),
                "walkTo" => {
                    let walk = party.walk_to(&mut state, id, op["destination"].as_i64().unwrap() as i32, &walk_options(&op["options"]));
                    if walk.is_some() {
                        walked += 1;
                    }
                    if let (Some(walk), Some(wanted)) = (&walk, op.get("followed")) {
                        let walks = party.follow_along(&mut state, id, &walk.path, Some(&walk.route));
                        followed += walks.len();
                        check!(to(&walks), wanted, "{at}: the followers");
                    }
                    to(&walk)
                }
                "follow" => {
                    let path: Vec<i32> = from(&op["path"]);
                    to(&party.follow(&mut state, id, &path, None))
                }
                "followPositions" => {
                    let path: Vec<i32> = from(&op["path"]);
                    to(&party.follow_positions(&state, id, &path, &[], None))
                }
                "landAt" => json!(party.land_at(&mut state, id, from(&op["at"]))),
                "fall" => {
                    if let Some(entity) = state.entity_mut(id) {
                        entity.alive = !entity.alive;
                    }
                    Value::Null
                }
                "setRules" => {
                    party.set_rules(rules_of(&op["rules"]));
                    Value::Null
                }
                other => panic!("{at}: an order nobody knows: {other}"),
            };
            check!(result, op.get("result").unwrap_or(&Value::Null), "{at}");
            check!(view(&party, &state), &op["after"], "{at}: after");
        }
    }
    assert!(walked > 150 && followed > 100, "{walked} {followed}");
}
