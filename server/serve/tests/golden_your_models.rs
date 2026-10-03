//! `server/fixtures/your-models.json` replayed: served urls read, import bodies judged, a folder filled
//! in the same order to the same ids, and an index the TypeScript wrote written back to the byte.

use serde_json::{json, Value};
use serve::your_models::{file_of_url, import_model, judge_import, read_your_models, Import, YourModel};

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/your-models.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by tests/unit/your-models.golden.test.ts")).expect("JSON")
}

fn folder(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-your-models-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    root
}

/// A model as the fixture holds it: without `added`, which is the clock's.
fn shown(model: &YourModel) -> Value {
    let mut value = json!(model);
    value.as_object_mut().unwrap().shift_remove("added");
    value
}

#[test]
fn served_urls_are_read_alike() {
    for case in fixture()["fileOfUrl"].as_array().unwrap() {
        let named = file_of_url(case["url"].as_str().unwrap()).map(|(account, file)| json!({ "account": account, "file": file }));
        assert_eq!(named.unwrap_or(Value::Null), case["named"], "{}", case["url"]);
    }
}

#[test]
fn imports_are_judged_alike() {
    for case in fixture()["import"].as_array().unwrap() {
        let body = case["body"].as_str().unwrap();
        let verdict = match judge_import(body) {
            Ok(Import::File { name, bytes }) => json!({ "ok": true, "name": name, "hex": hex::encode(bytes) }),
            Ok(Import::Url { account, file }) => json!({ "ok": true, "url": { "account": account, "file": file } }),
            Err(reason) => json!({ "ok": false, "reason": reason }),
        };
        assert_eq!(verdict, case["verdict"], "{body}");
    }
}

#[test]
fn a_folder_fills_alike() {
    let golden = fixture();
    let root = folder("fill");
    for step in golden["folder"]["steps"].as_array().unwrap() {
        let bytes: Vec<u8> = step["bytes"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect();
        let made = import_model(&root, step["account"].as_str().unwrap(), step["name"].as_str().unwrap(), &bytes, step["listing"].as_str());
        match made {
            Ok((model, fresh)) => {
                assert_eq!(shown(&model), step["model"], "{step}");
                assert_eq!(json!(fresh), step["fresh"], "{step}");
            }
            Err(reason) => assert_eq!(json!(reason), step["refused"], "{step}"),
        }
    }
    for kept in golden["folder"]["files"].as_array().unwrap() {
        let models: Vec<Value> = read_your_models(&root, kept["account"].as_str().unwrap()).iter().map(shown).collect();
        assert_eq!(json!(models), kept["models"]);
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn an_index_the_typescript_wrote_is_written_back_to_the_byte() {
    let text = fixture()["folder"]["indexFile"].as_str().unwrap().to_string();
    let root = folder("bytes");
    let index = root.join("data/users/bramble/models/imported.json");
    std::fs::create_dir_all(index.parent().unwrap()).unwrap();
    std::fs::write(&index, &text).unwrap();
    // Read and written back as the server writes an index: the same file again.
    let models = read_your_models(&root, "bramble");
    assert_eq!(models.len(), 4);
    serve::files::write_json(&index, &models).unwrap();
    assert_eq!(std::fs::read_to_string(&index).unwrap(), text);
    let _ = std::fs::remove_dir_all(&root);
}
