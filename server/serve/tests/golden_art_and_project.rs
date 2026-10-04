//! `server/fixtures/art-and-project.json` replayed: marks files read, marks given and taken back with the
//! file written after each - to the byte, in `localeCompare`'s order - changes and saves judged.

use serde_json::{json, Value};
use serve::art_and_project::{judge_provenance, judge_save, mark_provenance, read_provenance, write_provenance, PROVENANCE_FILE};

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/art-and-project.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by tests/unit/art-provenance.golden.test.ts")).expect("JSON")
}

fn folder(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-art-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("projects")).unwrap();
    root
}

fn refused((status, reason): (u16, String)) -> Value {
    json!({ "ok": false, "status": status, "reason": reason })
}

#[test]
fn marks_files_are_read_alike() {
    let root = folder("read");
    for case in fixture()["files"].as_array().unwrap() {
        std::fs::write(root.join(PROVENANCE_FILE), case["text"].as_str().unwrap()).unwrap();
        assert_eq!(Value::Object(read_provenance(&root)), case["read"], "{}", case["text"]);
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn marks_are_written_to_the_byte_in_locale_order() {
    let root = folder("write");
    let mut map = read_provenance(&root);
    for change in fixture()["changes"].as_array().unwrap() {
        map = mark_provenance(&map, change["key"].as_str().unwrap(), change["provenance"].as_str());
        write_provenance(&root, &map).unwrap();
        assert_eq!(std::fs::read_to_string(root.join(PROVENANCE_FILE)).unwrap(), change["file"].as_str().unwrap(), "after {}", change["key"]);
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn changes_and_saves_are_judged_alike() {
    let golden = fixture();
    for case in golden["marks"].as_array().unwrap() {
        let header = |name: &str| case["headers"][name].as_str().map(str::to_string);
        let got = match judge_provenance(case["method"].as_str().unwrap(), &header, case["body"].as_str().unwrap()) {
            Ok((key, provenance)) => json!({ "ok": true, "key": key, "provenance": provenance }),
            Err(refusal) => refused(refusal),
        };
        assert_eq!(got, case["verdict"], "{case}");
    }
    for case in golden["saves"].as_array().unwrap() {
        let header = |name: &str| case["headers"][name].as_str().map(str::to_string);
        let got = match judge_save(case["method"].as_str().unwrap(), &header, case["body"].as_str().unwrap()) {
            Ok(text) => json!({ "ok": true, "text": text }),
            Err(refusal) => refused(refusal),
        };
        assert_eq!(got, case["verdict"], "{case}");
    }
}
