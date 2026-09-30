//! `server/fixtures/scene.json` replayed: documents older builds wrote, and ones written for each step,
//! migrated to what the TypeScript's `migrateDocument` makes of them; the projects read whole by
//! `projectSchema` and as packs by `readPack`; a sample project broken twelve ways at every place worth
//! breaking, and the corners the breaks cannot reach - every issue on the same path in the same words, and
//! what a project that reads comes out as, field for field; and names made into ids as `toContentId` does.

use engine::content::document::{describe_pack, read_pack};
use engine::content::to_content_id;
use engine::scene::document::project;
use engine::scene::migrate::migrate_document;
use serde_json::{json, Value};

fn repo(path: &str) -> Value {
    let path = format!("{}/../../{path}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))).expect("JSON")
}

fn fixture() -> Value {
    repo("server/fixtures/scene.json")
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

/// A document from the repository, prepared as the fixture says.
fn prepared(source: &Value) -> Value {
    let mut doc = repo(source["file"].as_str().unwrap());
    if source["prep"] == "unversioned" {
        doc.as_object_mut().unwrap().shift_remove("formatVersion");
    }
    doc
}

/// What reading a project said, as the fixture writes it: what it reads to (when asked for), or its issues.
fn verdict(value: &Value, keep: bool) -> Value {
    match project().parse(value) {
        Ok(read) => json!({ "ok": if keep { read } else { json!(true) } }),
        Err(issues) => json!({ "issues": issues }),
    }
}

#[test]
fn documents_migrate_as_the_typescript_migrates_them() {
    let fixture = fixture();
    for (i, case) in fixture["migrations"].as_array().unwrap().iter().enumerate() {
        let (input, at) = match case.get("source") {
            Some(source) => (prepared(source), format!("{source}")),
            None => (case["input"].clone(), format!("written {i}")),
        };
        let output = migrate_document(&input);
        if case.get("unchanged") == Some(&json!(true)) {
            check!(output, &input, "{at}: a current document comes back as it went");
        } else {
            check!(output, &case["output"], "{at}: migrated");
        }
    }
}

#[test]
fn projects_read_whole_and_as_packs_as_the_typescript_reads_them() {
    let fixture = fixture();
    for case in fixture["projects"].as_array().unwrap() {
        let doc = migrate_document(&prepared(&case["source"]));
        let mut wanted = case.clone();
        wanted.as_object_mut().unwrap().shift_remove("source");
        check!(verdict(&doc, true), &wanted, "{}", case["source"]);
    }
    for case in fixture["packs"].as_array().unwrap() {
        let file = case["file"].as_str().unwrap();
        let reading = read_pack(&repo(file), file);
        check!(serde_json::to_value(&reading).unwrap(), &case["reading"], "{file}: read as a pack");
        check!(json!(describe_pack(&reading.pack)), &case["described"], "{file}: described");
    }
}

#[test]
fn a_broken_project_is_refused_in_zods_words() {
    let fixture = fixture();
    let sample = &fixture["sample"];
    let breaks = fixture["breaks"].as_array().unwrap();
    assert!(breaks.len() > 2000);
    for case in breaks {
        let mut value = sample.clone();
        let path = case["path"].as_array().unwrap();
        let (last, parents) = path.split_last().unwrap();
        let mut parent = &mut value;
        for key in parents {
            parent = match key {
                Value::Number(n) => &mut parent[n.as_u64().unwrap() as usize],
                Value::String(s) => &mut parent[s.as_str()],
                _ => unreachable!(),
            };
        }
        match (&case["change"], last) {
            (change, Value::Number(n)) if change == "delete" => {
                parent.as_array_mut().unwrap().remove(n.as_u64().unwrap() as usize);
            }
            (change, Value::String(s)) if change == "delete" => {
                parent.as_object_mut().unwrap().shift_remove(s.as_str());
            }
            (change, Value::Number(n)) => parent[n.as_u64().unwrap() as usize] = change.clone(),
            (change, Value::String(s)) => parent[s.as_str()] = change.clone(),
            _ => unreachable!(),
        }
        let mut wanted = case.clone();
        let wanted = wanted.as_object_mut().unwrap();
        wanted.shift_remove("path");
        wanted.shift_remove("change");
        check!(verdict(&value, false), &Value::Object(wanted.clone()), "{} changed to {}", case["path"], case["change"]);
    }
    for corner in fixture["corners"].as_array().unwrap() {
        let mut wanted = corner.clone();
        let wanted = wanted.as_object_mut().unwrap();
        wanted.shift_remove("name");
        wanted.shift_remove("value");
        check!(verdict(&corner["value"], true), &Value::Object(wanted.clone()), "{}", corner["name"]);
    }
}

#[test]
fn names_become_ids_as_the_typescript_makes_them() {
    for case in fixture()["ids"].as_array().unwrap() {
        assert_eq!(json!(to_content_id(case["name"].as_str().unwrap())), case["id"], "{}", case["name"]);
    }
}
