//! `server/fixtures/character.json` replayed: the game's own content - the demo pack with the shipped SRD
//! characters laid over it, and their abilities - and sheets of every kind, derived, queried and levelled
//! as `src/engine/character` does, with every issue in the same words and the same order. Each answer
//! is built in the shape the TypeScript answered and compared as JSON, numbers by value.

use engine::character::progression::*;
use engine::character::schema::parse_sheet;
use engine::character::sheet::*;
use engine::content::abilities::AbilityDef;
use engine::content::features::gear_effects;
use engine::content::pack::{ContentPack, PackFeature, WeaponTrait};
use engine::rules::jump::{Trait, Traits};
use serde_json::{json, Value};

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/character.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/character/character.golden.test.ts")).expect("JSON")
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

struct World {
    content: ContentPack,
    abilities: Vec<AbilityDef>,
}

fn world(fixture: &Value) -> World {
    World { content: from(&fixture["content"]), abilities: from(&fixture["abilities"]) }
}

fn allowed_json(result: Result<(), String>) -> Value {
    match result {
        Ok(()) => json!({ "ok": true }),
        Err(reason) => json!({ "ok": false, "reason": reason }),
    }
}

fn derived_json(sheet: &CharacterSheet, world: &World) -> Value {
    let (character, issues) = derive_character(sheet, &world.content, &world.abilities);
    let ids = |cards: &[engine::content::pack::CardDef]| cards.iter().map(|c| c.id.clone()).collect::<Vec<_>>();
    let mut view = json!({
        "cards": ids(&character.cards),
        "granted": ids(&character.granted),
        "modifiers": to(&character.modifiers),
        "proficiency": character.proficiency,
        "traits": to(&character.traits),
        "experiences": to(&character.experiences),
        "evasion": character.evasion,
        "thresholds": to(&character.thresholds),
        "armorScore": character.armor_score,
        "hitPoints": character.hit_points,
        "stress": character.stress,
        "good": to(&character.good),
    });
    let fields = view.as_object_mut().expect("an object");
    if let Some(subclass) = &character.subclass {
        fields.insert("subclass".into(), json!(subclass.id));
    }
    if let Some(t) = character.spellcast_trait {
        fields.insert("spellcastTrait".into(), json!(t.name()));
    }
    if let Some(weapon) = &character.primary_weapon {
        fields.insert("primaryWeapon".into(), json!(weapon.id));
    }
    if let Some(weapon) = &character.secondary_weapon {
        fields.insert("secondaryWeapon".into(), json!(weapon.id));
    }
    let condition_sets: Vec<Vec<String>> = {
        let mut all: Vec<String> = Vec::new();
        for card in world.content.cards.iter() {
            if let engine::content::pack::CardGrant::Condition { conditions } = &card.grant {
                for c in conditions {
                    if !all.contains(c) {
                        all.push(c.clone());
                    }
                }
            }
        }
        vec![vec![], vec!["hidden".into()], vec!["restrained".into(), "vulnerable".into()], all]
    };
    json!({
        "issues": to(&issues),
        "character": view,
        "attack": { "primary": to(&attack_profile(&character, Hand::Primary)), "secondary": to(&attack_profile(&character, Hand::Secondary)) },
        "defender": to(&defender_profile(&character)),
        "pools": to(&starting_pools(&character)),
        "grantedCards": granted_cards(sheet, world.content.cards.iter()).iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
        "lent": condition_sets.iter().map(|conditions| json!([conditions, lent_cards(conditions, world.content.cards.iter()).iter().map(|c| c.id.clone()).collect::<Vec<_>>()])).collect::<Vec<_>>(),
    })
}

fn queries_json(sheet: &CharacterSheet, world: &World) -> Value {
    let tiers: [Tier; 4] = [1, 2, 3, 4];
    let ids: Vec<&str> = world.content.cards.iter().map(|c| c.id.as_str()).collect();
    json!({
        "taken": tiers.iter().map(|&t| AdvancementKind::ALL.iter().map(|&k| taken_in_tier(sheet, t, k)).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "crossed": tiers.iter().map(|&t| AdvancementKind::ALL.iter().map(|&k| crossed_out(sheet, t, k)).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "marked": marked_traits(sheet).iter().map(|t| t.name()).collect::<Vec<_>>(),
        "stage": subclass_stage(sheet).name(),
        "domains": domains_of(sheet, &world.content),
        "held": held_cards(sheet),
        "available": if sheet.level < 10.0 { to(&available_advancements(sheet, sheet.level + 1.0)) } else { json!([]) },
        "bonuses": to(&progression_bonuses(sheet)),
        "allowed": ids.iter().step_by(7).flat_map(|id| [1.0, 4.0, 10.0].map(|at| json!([id, at, allowed_json(card_allowed(sheet, &world.content, id, at))]))).collect::<Vec<_>>(),
    })
}

#[test]
fn sheets_derive_and_answer_as_the_typescript_does() {
    let fixture = fixture();
    let world = world(&fixture);
    let cases = fixture["sheets"].as_array().expect("sheets");
    assert!(cases.len() > 60);
    for case in cases {
        let sheet: CharacterSheet = from(&case["sheet"]);
        check!(derived_json(&sheet, &world), &case["derived"], "derived {}", sheet.id);
        check!(queries_json(&sheet, &world), &case["queries"], "queries {} at {}", sheet.id, sheet.level);
    }
}

#[test]
fn every_legal_level_is_taken_the_same_way() {
    let fixture = fixture();
    let world = world(&fixture);
    let levelled = fixture["levelled"].as_array().expect("levelled");
    assert!(levelled.len() > 80);
    for case in levelled {
        let sheet: CharacterSheet = from(&case["sheet"]);
        let plan: LevelUpPlan = from(&case["plan"]);
        assert!(case["result"]["issues"].as_array().is_some_and(Vec::is_empty));
        let grown = level_up(&sheet, &world.content, &plan).unwrap_or_else(|issues| panic!("{} refused: {issues:?}", sheet.id));
        check!(to(&grown), &case["result"]["sheet"], "{} to level {}", sheet.id, sheet.level + 1.0);
    }
}

#[test]
fn every_plan_tried_is_refused_or_taken_the_same_way() {
    let fixture = fixture();
    let world = world(&fixture);
    let sheets: Vec<CharacterSheet> = from(&fixture["triedSheets"]);
    let tried = fixture["tried"].as_array().expect("tried");
    assert!(tried.len() > 1500);
    for case in tried {
        let sheet = &sheets[case["sheet"].as_u64().expect("an index") as usize];
        let plan: LevelUpPlan = from(&case["plan"]);
        match level_up(sheet, &world.content, &plan) {
            Ok(grown) => {
                check!(json!([]), &case["issues"], "{} took {}", sheet.id, case["plan"]);
                check!(to(&grown), &case["levelled"], "{} took {}", sheet.id, case["plan"]);
            }
            Err(issues) => check!(to(&issues), &case["issues"], "{} refused {}", sheet.id, case["plan"]),
        }
    }
}

#[test]
fn tiers_gear_and_the_small_readings_match() {
    let fixture = fixture();
    for case in fixture["tiers"].as_array().expect("tiers") {
        assert_eq!(f64::from(tier_of(case[0].as_f64().unwrap())), case[1].as_f64().unwrap(), "tier of {}", case[0]);
    }
    let feature = |text: &str| PackFeature { name: "f".into(), text: text.into() };
    let gear = fixture["gear"].as_array().expect("gear");
    assert!(gear.iter().filter(|g| !g[1]["modifiers"].as_array().unwrap().is_empty()).count() > 10);
    for case in gear {
        let text = case[0].as_str().expect("text");
        check!(to(&gear_effects(&[feature(text)])), &case[1], "gear {text:?}");
    }
    let together: Vec<PackFeature> = gear.iter().take(12).map(|g| feature(g[0].as_str().unwrap())).collect();
    check!(to(&gear_effects(&together)), &fixture["gearTogether"], "gear together");
    for case in fixture["traitParts"].as_array().expect("traitParts") {
        let plus: Option<Trait> = case[0].get("plusTrait").map(from);
        let halve = case[0].get("halveTrait").and_then(Value::as_bool);
        let traits: Traits = from(&case[1]);
        check!(json!(trait_part(plus, halve, &traits)), &case[2], "trait part {}", case[0]);
    }
    for case in fixture["wielded"].as_array().expect("wielded") {
        let spellcast: Option<Trait> = case[0].get("spellcastTrait").map(from);
        let weapon: WeaponTrait = from(&case[1]["trait"]);
        check!(json!(wielded_trait(spellcast, weapon).name()), &case[2], "wielded {}", case);
    }
}

#[test]
fn sheets_are_let_in_or_turned_away_as_zod_does() {
    let fixture = fixture();
    let cases = fixture["parse"].as_array().expect("parse");
    assert!(cases.iter().filter(|c| c.get("error").is_some()).count() > 15);
    for case in cases {
        match (parse_sheet(&case["value"]), case.get("parsed")) {
            (Ok(sheet), Some(parsed)) => check!(to(&sheet), parsed, "parsed {}", case["value"]),
            (Err(_), None) => {}
            (got, _) => panic!("{} parsed as {got:?}, the TypeScript {}", case["value"], if case.get("parsed").is_some() { "let it in" } else { "turned it away" }),
        }
    }
}

#[test]
fn a_blank_sheet_is_level_one_with_nothing_on_it() {
    let sheet = blank_sheet("pc", "warrior");
    assert_eq!(to(&sheet), json!({ "id": "pc", "name": "pc", "level": 1.0, "classId": "warrior", "traits": { "agility": 0.0, "strength": 0.0, "finesse": 0.0, "instinct": 0.0, "presence": 0.0, "knowledge": 0.0 }, "proficiency": 1.0 }));
}
