//! `server/fixtures/combat.json` replayed: targeting and areas over the same grids, stat blocks' features,
//! 700 attacks rolled from the same seeds to the same outcomes - leaving the dice stream where the
//! TypeScript left it - and landed on the same pools, 500 defences by policy and by plan, and eight
//! encounters' turns taken step by step to the same views, events and ends. Compared as JSON, numbers by
//! value.

use engine::combat::adversary_features::{adversary_traits, attack_damage_of, is_feature_implemented, AdversaryFeature};
use engine::combat::area::{is_in_area, is_legal_origin, move_under_pressure, tiles_in_area, AreaOptions, MoveUnderPressureOptions, Mover};
use engine::combat::attack::{apply_attack, apply_roll, resolve_attack, AttackOptions, AttackProfile, AttackRequest, DefenderProfile};
use engine::combat::defense::{can_pay_for, preview_plan, resolve_defense, resolve_defense_plan, Defender, Defense, DefensePlan, DefensePolicy};
use engine::combat::encounter::{EncounterOutcome, EncounterRunner, TurnPolicy};
use engine::combat::targeting::{evaluate_target, refusal_message, TargetingOptions, TargetingRefusal};
use engine::content::abilities::AbilityDef;
use engine::grid::terrain::{TerrainPalette, TerrainType};
use engine::grid::tile_grid::{Spot, TileGrid};
use engine::rng::{Rng, Seed};
use engine::rules::damage::IncomingDamage;
use engine::rules::dice::ParsedDamage;
use engine::rules::range::RangeBand;
use engine::rules::resources::{Currency, MarkPool};
use engine::scene::state::{EntityState, SceneState};
use serde_json::{json, Value};
use std::collections::HashMap;

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/combat.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/combat/combat.golden.test.ts")).expect("JSON")
}

/// Two JSON answers the same: numbers by value, objects by their keys whatever the order.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        _ => a == b,
    }
}

macro_rules! check {
    ($got:expr, $wanted:expr, $($what:tt)*) => {{
        let (got, wanted): (Value, &Value) = ($got, $wanted);
        assert!(same(&got, wanted), "{}:\n  rust       {}\n  typescript {}", format!($($what)*), got, wanted);
    }};
}

fn to<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("serializes")
}

fn from<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("{e}: {value}"))
}

/// A number as the fixture keeps it: null is Infinity.
fn num(value: &Value) -> f64 {
    value.as_f64().unwrap_or(f64::INFINITY)
}

fn grid_of(spec: &Value) -> TileGrid {
    let types = spec["palette"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| TerrainType {
            passable: t["passable"].as_bool().unwrap(),
            cost: num(&t["cost"]),
            provides_cover: t["providesCover"].as_bool().unwrap(),
            blocks_sight: t["blocksSight"].as_bool().unwrap(),
            ..TerrainType::new(t["id"].as_str().unwrap())
        })
        .collect();
    let mut grid = TileGrid::new(num(&spec["width"]) as i32, num(&spec["height"]) as i32, TerrainPalette::new(types).expect("a palette"));
    let each = |key: &str| spec[key].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect::<Vec<_>>();
    grid.heights = each("heights").iter().map(|&h| h as i16).collect();
    grid.terrain = each("terrain").iter().map(|&t| t as u8).collect();
    grid.overlay = each("overlay").iter().map(|&o| o as i16).collect();
    grid.lift = each("lift").iter().map(|&l| l as f32).collect();
    grid.barred = each("barred").iter().map(|&b| b as u8).collect();
    grid
}

fn grids(fixture: &Value) -> HashMap<String, TileGrid> {
    fixture["grids"].as_object().unwrap().iter().map(|(name, spec)| (name.clone(), grid_of(spec))).collect()
}

fn band(value: &Value) -> RangeBand {
    RangeBand::from_name(value.as_str().unwrap()).unwrap()
}

fn tile(value: &Value) -> i32 {
    value.as_f64().unwrap() as i32
}

#[test]
fn targets_are_measured_alike() {
    let fixture = fixture();
    let grids = grids(&fixture);
    let cases = fixture["targeting"].as_array().unwrap();
    assert!(cases.len() >= 800);
    for case in cases {
        let grid = &grids[case["grid"].as_str().unwrap()];
        let options: TargetingOptions = from(&case["options"]);
        let report = evaluate_target(grid, tile(&case["from"]), tile(&case["to"]), band(&case["range"]), &options);
        check!(to(&report), &case["report"], "target {} -> {} on {} at {} {}", case["from"], case["to"], case["grid"], case["range"], case["options"]);
    }
    for case in fixture["refusals"].as_array().unwrap() {
        let refusal: TargetingRefusal = from(&case[0]);
        assert_eq!(json!(refusal_message(refusal)), case[1]);
    }
}

#[test]
fn areas_and_moves_are_alike() {
    let fixture = fixture();
    let grids = grids(&fixture);
    for case in fixture["areas"].as_array().unwrap() {
        let grid = &grids[case["grid"].as_str().unwrap()];
        let (a, b) = (tile(&case["a"]), tile(&case["b"]));
        let options: AreaOptions = from(&case["options"]);
        let mover: Mover = from(&case["mover"]);
        let moving: MoveUnderPressureOptions = from(&case["moveOptions"]);
        let what = format!("area {a} {b} on {} {}", case["grid"], case["options"]);
        assert_eq!(json!(is_legal_origin(grid, a, b, band(&case["effectRange"]), &options)), case["legalOrigin"], "{what}: origin");
        assert_eq!(json!(is_in_area(grid, a, b, &options)), case["inArea"], "{what}: in area");
        check!(json!(tiles_in_area(grid, a, &options)), &case["tiles"], "{what}: tiles");
        check!(to(&move_under_pressure(grid, mover, a, b, &moving)), &case["move"], "{what}: move {}", case["moveOptions"]);
    }
}

#[test]
fn stat_blocks_add_up_alike() {
    let fixture = fixture();
    for case in fixture["features"]["traits"].as_array().unwrap() {
        let features: Vec<AdversaryFeature> = from(&case["features"]);
        check!(to(&adversary_traits(&features)), &case["traits"], "traits of {}", case["features"]);
        check!(json!(features.iter().map(is_feature_implemented).collect::<Vec<_>>()), &case["implemented"], "implemented {}", case["features"]);
    }
    for case in fixture["features"]["damage"].as_array().unwrap() {
        let features: Vec<AdversaryFeature> = from(&case["features"]);
        let attack: ParsedDamage = from(&case["attackDamage"]);
        let damage = attack_damage_of(&features, &attack, num(&case["hitPoints"]["marked"]), num(&case["hitPoints"]["max"]));
        check!(to(&damage), &case["damage"], "damage of {} at {}", case["features"], case["hitPoints"]);
    }
}

#[test]
fn attacks_roll_and_land_alike() {
    let fixture = fixture();
    let grids = grids(&fixture);
    let cases = fixture["attacks"].as_array().unwrap();
    assert_eq!(cases.len(), 700);
    for (i, case) in cases.iter().enumerate() {
        let grid = &grids[case["grid"].as_str().unwrap()];
        let attacker: EntityState = from(&case["attacker"]);
        let target: EntityState = from(&case["target"]);
        let profile: AttackProfile = from(&case["profile"]);
        let defender: DefenderProfile = from(&case["defender"]);
        let options: AttackOptions = from(&case["options"]);
        let seed = format!("attack:{i}");
        let mut rng = Rng::new(Seed::Text(&seed));
        let request = AttackRequest { grid, attacker: &attacker, target: &target, profile: &profile, defender: &defender, options: &options };
        let outcome = resolve_attack(&mut rng, &request).expect("rolled");
        check!(to(&outcome), &case["outcome"], "attack {i}");
        assert_eq!(json!(rng.save()), case["after"], "attack {i}: the dice stream");

        let before = &case["before"];
        let mut state = SceneState::new("fight", grid.clone(), Some(from::<Currency>(&before["bad"])));
        state.add_entity(from(&before["attacker"])).expect("added");
        state.add_entity(from(&before["target"])).expect("added");
        let roll_first = case["rollFirst"] == true;
        if roll_first {
            check!(to(&apply_roll(&mut state, &outcome)), &case["rolled"], "attack {i}: the roll paid");
        }
        let applied = apply_attack(&mut state, &outcome, !roll_first);
        check!(to(&applied), &case["applied"], "attack {i}: applied");
        check!(to(state.entity("a").unwrap()), &case["stateAttacker"], "attack {i}: the attacker after");
        check!(to(state.entity("t").unwrap()), &case["stateTarget"], "attack {i}: the target after");
        check!(to(&state.bad), &case["bad"], "attack {i}: Shadow after");
    }
}

fn defense_json(defense: &Defense) -> Value {
    json!({
        "resolved": defense.resolved,
        "armorSlotsMarked": defense.armor_slots_marked,
        "reactions": defense.reactions.iter().map(|r| {
            let mut used = json!({ "ability": r.ability.id, "goodSpent": r.good_spent, "stressMarked": r.stress_marked });
            if let Some(rolled) = r.rolled {
                used["rolled"] = json!(rolled);
            }
            used
        }).collect::<Vec<_>>(),
        "goodSpent": defense.good_spent,
        "stressMarked": defense.stress_marked,
    })
}

#[test]
fn defences_are_chosen_and_paid_for_alike() {
    let fixture = fixture();
    let reactions: Vec<AbilityDef> = from(&fixture["reactions"]);
    let by_id = |ids: &Value| -> Vec<&AbilityDef> { ids.as_array().unwrap().iter().map(|id| reactions.iter().find(|a| json!(a.id) == *id).expect("a reaction")).collect() };
    let cases = fixture["defences"].as_array().unwrap();
    assert_eq!(cases.len(), 500);
    for (i, case) in cases.iter().enumerate() {
        let damage: IncomingDamage = from(&case["damage"]);
        let d = &case["defender"];
        let defender = Defender {
            thresholds: from(&d["thresholds"]),
            defenses: d.get("defenses").map(from),
            armor_slots: from::<MarkPool>(&d["armorSlots"]),
            stress: from::<MarkPool>(&d["stress"]),
            good: d.get("good").map(from::<Currency>),
            reactions: by_id(&d["reactions"]),
        };
        let policy: DefensePolicy = from(&case["policy"]);
        let plan = DefensePlan { armor_slots: num(&case["plan"]["armorSlots"]), reactions: by_id(&case["plan"]["reactions"]) };

        let seed = format!("defence:{i}");
        let mut rng = Rng::new(Seed::Text(&seed));
        let defense = resolve_defense(&mut rng, &damage, &defender, policy).expect("rolled");
        check!(defense_json(&defense), &case["defence"], "defence {i}");
        assert_eq!(json!(rng.save()), case["after"], "defence {i}: the dice stream");

        let seed = format!("plan:{i}");
        let mut rng = Rng::new(Seed::Text(&seed));
        let planned = resolve_defense_plan(&mut rng, &damage, &defender, &plan).expect("rolled");
        check!(defense_json(&planned), &case["planned"], "plan {i}");
        assert_eq!(json!(rng.save()), case["afterPlan"], "plan {i}: the dice stream");

        check!(json!(preview_plan(&damage, &defender, &plan)), &case["preview"], "preview {i}");
        let can_pay: Vec<bool> = reactions.iter().map(|a| can_pay_for(defender.good.as_ref(), &defender.stress, a)).collect();
        check!(json!(can_pay), &case["canPay"], "can pay {i}");
    }
}

#[test]
fn encounters_take_their_turns_alike() {
    let fixture = fixture();
    let grids = grids(&fixture);
    let encounters = fixture["encounters"].as_array().unwrap();
    assert_eq!(encounters.len(), 8);
    for (s, run) in encounters.iter().enumerate() {
        let setup = &run["setup"];
        let mut state = SceneState::new("fight", grids["open"].clone(), Some(from::<Currency>(&run["bad"])));
        for entity in run["entities"].as_array().unwrap() {
            state.add_entity(from(entity)).expect("added");
        }
        let policy: TurnPolicy = from(&setup["policy"]);
        let mut runner = EncounterRunner::new("the-fight", Some(policy), setup.get("tokens").map(num));
        let mut seen = 0;
        for (n, step) in run["steps"].as_array().unwrap().iter().enumerate() {
            let id = step["id"].as_str().unwrap();
            let act = step["act"].as_str().unwrap();
            let what = format!("encounter {s} step {n}: {act} {id}");
            let result = match act {
                "start" => to(&runner.start(&mut state)),
                "act" => to(&runner.act(&mut state, id, false)),
                "actToGm" => to(&runner.act(&mut state, id, true)),
                "passToGm" => to(&runner.pass_to_gm(&state)),
                "spotlight" => to(&runner.spotlight(&mut state, id)),
                "grantSpotlight" => to(&runner.grant_spotlight(&mut state, id)),
                "spotlightAgain" => to(&runner.spotlight_again(&mut state, id)),
                "endGmTurn" => to(&runner.end_gm_turn(&state)),
                "canAct" => json!(runner.can_act(&state, id)),
                "canSpotlight" => json!(runner.can_spotlight(&state, id)),
                "canSpotlightAgain" => json!(runner.can_spotlight_again(&state, id)),
                "circleOf" => to(&runner.circle_of(&state, id)),
                "reanchor" => {
                    runner.reanchor(&state, id);
                    Value::Null
                }
                "pushOpens" => to(&runner.push_opens(&state, id)),
                "push" => to(&runner.push(&state, id)),
                "tokensFor" => {
                    let tokens = runner.tokens_for(id);
                    if tokens.is_finite() {
                        json!(tokens)
                    } else {
                        Value::Null
                    }
                }
                "settleIfDecided" => json!(runner.settle_if_decided(&mut state)),
                "kill" => {
                    if step["param"] == true {
                        state.entity_mut(id).unwrap().alive = false;
                    }
                    Value::Null
                }
                "revive" => {
                    if let Some(entity) = state.entity_mut(id) {
                        entity.alive = true;
                    }
                    Value::Null
                }
                "move" => {
                    if let Some(entity) = state.entity_mut(id) {
                        entity.at = from::<Spot>(&step["param"]);
                    }
                    Value::Null
                }
                "addBad" => {
                    state.bad.value = state.bad.max.min(state.bad.value + 2.0);
                    Value::Null
                }
                "end" => match step["param"].as_str() {
                    Some(outcome) => to(&runner.end(&mut state, from::<EncounterOutcome>(&json!(outcome)))),
                    None => Value::Null,
                },
                "view" => to(&runner.view(&state)),
                "round" => json!(runner.round()),
                other => panic!("{what}: no act {other}"),
            };
            check!(result, &step["result"], "{what}");
            check!(to(&state.bad), &step["bad"], "{what}: Shadow");
            check!(to(&*state.encounter("the-fight")), &step["encounter"], "{what}: the encounter");
            check!(to(&runner.outcome()), &step["outcome"], "{what}: outcome");
            check!(to(&runner.log()[seen..].to_vec()), &step["events"], "{what}: events");
            seen = runner.log().len();
        }
    }
}

#[test]
fn when_both_sides_fall_at_once_it_is_a_defeat() {
    let fixture = fixture();
    let grids = grids(&fixture);
    for case in fixture["bothFallen"].as_array().unwrap() {
        let mut state = SceneState::new("fight", grids["open"].clone(), None);
        state.add_entity(engine::scene::state::create_party_entity("p1", "hero", 0, 6.0, 6.0, 0.0)).unwrap();
        state.add_entity(engine::scene::state::create_adversary_entity("a1", "brute", 5, 3.0, 1.0, engine::scene::state::Faction::Adversary)).unwrap();
        let mut runner = EncounterRunner::new("both", Some(from(&case["policy"])), None);
        check!(to(&runner.start(&mut state)), &case["started"], "started");
        state.entity_mut("p1").unwrap().alive = false;
        state.entity_mut("a1").unwrap().alive = false;
        check!(json!(runner.settle_if_decided(&mut state)), &case["settled"], "settled");
        check!(to(&runner.view(&state)), &case["view"], "view");
        check!(to(&runner.log().to_vec()), &case["events"], "events");
        check!(to(&*state.encounter("both")), &case["encounter"], "encounter");
    }
}
