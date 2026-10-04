//! `server/fixtures/model-manifest.json` replayed: file names made ids, ancestry files read, ancestries
//! given and taken away with the file written after each - to the byte - changes and uploads judged, and
//! a folder listed as the TypeScript lists it.

use serde_json::{json, Map, Value};
use serve::manifest::{assign_ancestry, judge_ancestry, judge_model_add, model_id_of, read_model_ancestries, shipped_models, write_model_ancestries, ANCESTRY_FILE};

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/model-manifest.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by tests/unit/model-manifest.golden.test.ts")).expect("JSON")
}

fn folder(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-manifest-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("projects")).unwrap();
    root
}

fn headers_of(case: &Value) -> impl Fn(&str) -> Option<String> + '_ {
    move |name: &str| case["headers"][name].as_str().map(str::to_string)
}

fn verdict_of<T>(judged: Result<T, (u16, String)>, ok: impl FnOnce(T) -> Value) -> Value {
    match judged {
        Ok(value) => ok(value),
        Err((status, reason)) => json!({ "ok": false, "status": status, "reason": reason }),
    }
}

#[test]
fn file_names_are_made_ids_alike() {
    for pair in fixture()["modelIdOf"].as_array().unwrap() {
        assert_eq!(model_id_of(pair[0].as_str().unwrap()), pair[1].as_str().unwrap(), "{pair}");
    }
}

#[test]
fn ancestry_files_are_read_alike() {
    let root = folder("read");
    for case in fixture()["files"].as_array().unwrap() {
        std::fs::write(root.join(ANCESTRY_FILE), case["text"].as_str().unwrap()).unwrap();
        assert_eq!(Value::Object(read_model_ancestries(&root)), case["read"], "{}", case["text"]);
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn ancestries_are_given_and_written_to_the_byte() {
    let root = folder("write");
    let mut map = read_model_ancestries(&root);
    assert!(map.is_empty());
    for change in fixture()["changes"].as_array().unwrap() {
        map = assign_ancestry(&map, change["model"].as_str().unwrap(), change["ancestry"].as_str());
        write_model_ancestries(&root, &map).unwrap();
        assert_eq!(std::fs::read_to_string(root.join(ANCESTRY_FILE)).unwrap(), change["file"].as_str().unwrap(), "{change}");
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn changes_are_judged_alike() {
    let golden = fixture();
    let cases = golden["ancestry"].as_array().unwrap();
    assert!(cases.len() > 50);
    for case in cases {
        let got = verdict_of(judge_ancestry(case["method"].as_str().unwrap(), &headers_of(case), case["body"].as_str().unwrap()), |(model, ancestry)| {
            json!({ "ok": true, "model": model, "ancestry": ancestry })
        });
        assert_eq!(got, case["verdict"], "{case}");
    }
}

#[test]
fn uploads_are_judged_alike() {
    let golden = fixture();
    let taken: Vec<String> = serde_json::from_value(golden["taken"].clone()).unwrap();
    for case in golden["add"].as_array().unwrap() {
        let bytes = hex::decode(case["hex"].as_str().unwrap()).unwrap();
        let judged = judge_model_add(case["method"].as_str().unwrap(), &headers_of(case), case["name"].as_str(), &bytes, &|id| taken.iter().any(|t| t == id));
        let got = verdict_of(judged, |id| json!({ "ok": true, "id": id, "file": format!("{id}.glb") }));
        assert_eq!(got, case["verdict"], "{case}");
    }
}

#[test]
fn a_folder_is_listed_alike() {
    let golden = fixture();
    let root = folder("list");
    let models = root.join("public/models");
    std::fs::create_dir_all(&models).unwrap();
    for name in golden["folder"].as_array().unwrap() {
        std::fs::write(models.join(name.as_str().unwrap()), b"").unwrap();
    }
    let mut ancestries = Map::new();
    for (model, ancestry) in [("quim", "dwarf"), ("female-tortle", "galapa"), ("ghost", "elf")] {
        ancestries.insert(model.into(), json!(ancestry));
    }
    assert_eq!(json!(shipped_models(&models, &ancestries)), golden["shipped"]);
    assert_eq!(json!(shipped_models(&root.join("nowhere"), &Map::new())), golden["noFolder"]);
    let _ = std::fs::remove_dir_all(&root);
}
