//! `server/fixtures/script.json` replayed: every target selector, condition and effect the engine ships,
//! and one of every kind, read as zod read it - the same output, defaults put in - and every break of them
//! refused with the same issues, path for path and word for word; and the walks visiting every effect and
//! condition inside a script in the same order.

use engine::script::schema::{check_request, choice_option, condition, effect, target_selector, walk_conditions_in, walk_conditions_in_check, walk_effects};
use engine::zod::Schema;
use serde_json::{json, Value};

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/script.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/script/script.golden.test.ts")).expect("JSON")
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

fn schema(name: &str) -> &'static Schema {
    match name {
        "target" => target_selector(),
        "condition" => condition(),
        "effect" => effect(),
        "check" => check_request(),
        "option" => choice_option(),
        other => panic!("no schema {other}"),
    }
}

fn compare(name: &str, value: &Value, wanted: &Value, what: &str) {
    match (schema(name).parse(value), wanted.get("ok")) {
        (Ok(read), Some(ok)) => check!(read, ok, "{what}"),
        (Err(issues), None) => check!(json!(issues), &wanted["issues"], "{what}"),
        (Ok(read), None) => panic!("{what}: zod refused it ({}), we read {read}", wanted["issues"]),
        (Err(issues), Some(_)) => panic!("{what}: zod read it, we refused it: {}", json!(issues)),
    }
}

#[test]
fn every_selector_condition_and_effect_reads_as_zod_reads_it() {
    let fixture = fixture();
    let mut compared = 0;
    for group in fixture["entries"].as_array().unwrap() {
        let name = group["schema"].as_str().unwrap();
        for (i, case) in group["cases"].as_array().unwrap().iter().enumerate() {
            compare(name, &case["value"], case, &format!("{name} {i}: {}", case["value"]));
            compared += 1;
        }
    }
    assert!(compared > 750, "{compared}");
}

fn broken(sample: &Value, path: &[Value], change: &Value) -> Value {
    let mut copy = sample.clone();
    let mut parent = &mut copy;
    for key in &path[..path.len() - 1] {
        parent = match key.as_u64() {
            Some(i) => &mut parent[i as usize],
            None => &mut parent[key.as_str().unwrap()],
        };
    }
    let last = &path[path.len() - 1];
    match (change.as_str() == Some("delete"), last.as_u64()) {
        (true, Some(i)) => {
            parent.as_array_mut().unwrap().remove(i as usize);
        }
        (true, None) => {
            parent.as_object_mut().unwrap().remove(last.as_str().unwrap());
        }
        (false, Some(i)) => parent[i as usize] = change.clone(),
        (false, None) => parent[last.as_str().unwrap()] = change.clone(),
    }
    copy
}

#[test]
fn every_break_is_refused_in_zods_words() {
    let fixture = fixture();
    let mut compared = 0;
    for group in fixture["breaks"].as_array().unwrap() {
        let name = group["schema"].as_str().unwrap();
        for sample in group["samples"].as_array().unwrap() {
            for case in sample["cases"].as_array().unwrap() {
                let value = broken(&sample["sample"], case["path"].as_array().unwrap(), &case["change"]);
                compare(name, &value, case, &format!("{name} {} at {} set to {}", sample["sample"]["kind"], case["path"], case["change"]));
                compared += 1;
            }
        }
    }
    assert!(compared > 8000, "{compared}");
}

#[test]
fn the_corners_are_turned_as_zod_turns_them() {
    let fixture = fixture();
    for case in fixture["corners"].as_array().unwrap() {
        let name = case["schema"].as_str().unwrap();
        compare(name, &case["value"], case, &format!("{name} corner {}", case["value"]));
    }
}

#[test]
fn the_walks_visit_in_the_same_order() {
    let fixture = fixture();
    for case in fixture["walks"].as_array().unwrap() {
        let effects = [case["effect"].clone()];
        let mut kinds = Vec::new();
        walk_effects(&effects, &mut |e| kinds.push(e["kind"].clone()));
        check!(json!(kinds), &case["kinds"], "walk {}", case["effect"]["kind"]);
        let mut conditions = Vec::new();
        walk_conditions_in(&effects, &mut |c| conditions.push(c["kind"].clone()));
        check!(json!(conditions), &case["conditions"], "conditions in {}", case["effect"]["kind"]);
        let mut in_check = Vec::new();
        if case["effect"]["kind"] == "check" {
            walk_conditions_in_check(&case["effect"]["check"], &mut |c| in_check.push(c["kind"].clone()));
        }
        check!(json!(in_check), &case["inCheck"], "conditions in the check of {}", case["effect"]["kind"]);
    }
}
