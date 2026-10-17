//! `server/fixtures/store.json` replayed: every judgement `tools/store.ts` made - uploads read, publishes
//! and updates judged, votes cast, listings viewed, the engine's models listed, old listings brought
//! forward - made again here, with the same answers.

use indexmap::IndexMap;
use serde_json::{json, Map, Value};
use serve::store::{
    authenticity, cast_vote, decode, engine_listing_id, engine_listings, judge_listing_id, judge_publish, judge_sale, judge_update, judge_vote, mark_of,
    read_listings, sniff, supported, title_of, view_of, Listing, Upload, Vote, LISTINGS_FILE, MOST_PROOFS,
};
use serve::your_models::{free_model_id, tidy_id, YourModel};
use std::collections::HashSet;

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/store.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by tests/unit/store.golden.test.ts")).expect("JSON")
}

fn cases<'a>(golden: &'a Value, key: &str) -> &'a Vec<Value> {
    let list = golden[key].as_array().unwrap_or_else(|| panic!("the fixture has {key}"));
    assert!(!list.is_empty(), "{key} has cases");
    list
}

fn upload(proof: &Upload) -> Value {
    json!({ "bytes": { "hex": hex::encode(&proof.bytes) }, "ext": proof.ext })
}

fn refused(reason: impl Into<String>) -> Value {
    json!({ "ok": false, "reason": reason.into() })
}

#[test]
fn the_constants_agree() {
    assert_eq!(fixture()["mostProofs"], MOST_PROOFS);
}

#[test]
fn files_are_told_by_their_first_bytes() {
    for case in cases(&fixture(), "sniff") {
        let bytes: Vec<u8> = case["bytes"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect();
        let sniffed = sniff(&bytes).map(|(kind, ext, kind_type)| json!({ "kind": kind, "ext": ext, "type": kind_type }));
        assert_eq!(sniffed.unwrap_or(Value::Null), case["sniffed"], "{bytes:?}");
    }
}

#[test]
fn uploads_are_read_as_node_reads_base64() {
    for case in cases(&fixture(), "decode") {
        let bytes = decode(Some(&case["value"])).map(hex::encode);
        assert_eq!(json!(bytes), case["bytes"], "{}", case["value"]);
    }
}

#[test]
fn publishes_are_judged_alike() {
    for case in cases(&fixture(), "publish") {
        let body = case["body"].as_str().unwrap();
        let verdict = match judge_publish(body) {
            Ok(draft) => {
                let (bytes, kind, ext, name) = &draft.asset;
                json!({ "ok": true, "draft": {
                    "title": draft.title, "description": draft.description, "claim": draft.claim, "forSale": draft.for_sale, "how": draft.how,
                    "asset": { "bytes": { "hex": hex::encode(bytes) }, "kind": kind, "ext": ext, "name": name },
                    "proofs": draft.proofs.iter().map(upload).collect::<Vec<_>>(),
                } })
            }
            Err(reason) => refused(reason),
        };
        assert_eq!(verdict, case["verdict"], "{body}");
    }
}

#[test]
fn updates_are_judged_alike() {
    let golden = fixture();
    let has: Map<String, Value> = golden["has"].as_object().unwrap().clone();
    for case in cases(&golden, "update") {
        let body = case["body"].as_str().unwrap();
        let verdict = match judge_update(body, |id| has.get(id).map(|n| n.as_u64().unwrap() as usize)) {
            Ok(draft) => {
                let mut shown = json!({ "id": draft.id, "addProofs": draft.add_proofs.iter().map(upload).collect::<Vec<_>>() });
                if let Some(how) = draft.how {
                    shown["how"] = json!(how);
                }
                if let Some(claim) = draft.claim {
                    shown["claim"] = json!(claim);
                }
                if let Some(for_sale) = draft.for_sale {
                    shown["forSale"] = json!(for_sale);
                }
                json!({ "ok": true, "draft": shown })
            }
            Err(reason) => refused(reason),
        };
        assert_eq!(verdict, case["verdict"], "{body}");
    }
}

#[test]
fn votes_and_listing_ids_are_judged_alike() {
    let golden = fixture();
    for case in cases(&golden, "vote") {
        let body = case["body"].as_str().unwrap();
        let verdict = match judge_vote(body) {
            Ok((id, vote)) => json!({ "ok": true, "id": id, "vote": vote }),
            Err(reason) => refused(reason),
        };
        assert_eq!(verdict, case["verdict"], "{body}");
    }
    for case in cases(&golden, "listingId") {
        let body = case["body"].as_str().unwrap();
        let verdict = match judge_listing_id(body) {
            Ok(id) => json!({ "ok": true, "id": id }),
            Err(reason) => refused(reason),
        };
        assert_eq!(verdict, case["verdict"], "{body}");
    }
}

#[test]
fn authenticity_rounds_alike() {
    for case in cases(&fixture(), "authenticity") {
        let got = authenticity(case["likes"].as_u64().unwrap() as usize, case["dislikes"].as_u64().unwrap() as usize);
        assert_eq!(json!(got), case["authenticity"], "{case}");
    }
}

#[test]
fn marks_and_views_are_alike() {
    let golden = fixture();
    for case in cases(&golden, "marks") {
        let listing: Listing = serde_json::from_value(case["listing"].clone()).unwrap();
        assert_eq!(json!(supported(&listing.how, listing.proofs.len())), case["supported"]);
        assert_eq!(json!(mark_of(&listing)), case["mark"]);
        assert_eq!(json!(judge_sale(&listing.how, listing.proofs.len(), listing.claim, true)), case["sale"]);
    }
    for case in cases(&golden, "views") {
        let listing: Listing = serde_json::from_value(case["listing"].clone()).unwrap();
        let yours: HashSet<String> = serde_json::from_value(case["yours"].clone()).unwrap();
        assert_eq!(view_of(&listing, case["asker"].as_str(), &yours), case["view"], "{}", case["asker"]);
    }
}

#[test]
fn votes_are_cast_alike() {
    let golden = fixture();
    let base: Listing = serde_json::from_value(golden["views"][0]["listing"].clone()).unwrap();
    let mut target = Listing { votes: IndexMap::new(), ..base.clone() };
    let mut unshown = Listing { votes: IndexMap::new(), proofs: Vec::new(), ..base };
    // The fixture's listings are its own `listing()`: Sculpted in Blender, one proof, by ash.
    target.how = "Sculpted in Blender.".into();
    unshown.how = "Sculpted in Blender.".into();
    for case in cases(&golden, "castVotes") {
        let on = if case["on"] == "target" { &mut target } else { &mut unshown };
        let vote: Option<Vote> = serde_json::from_value(case["vote"].clone()).unwrap();
        let got = cast_vote(on, case["voter"].as_str().unwrap(), vote);
        assert_eq!(json!(got), case["refused"], "{case}");
        assert_eq!(json!(on.votes), case["votes"], "{case}");
    }
}

#[test]
fn the_engines_models_are_listed_alike() {
    let golden = fixture();
    let engine = &golden["engine"];
    let files: Vec<(String, f64)> = engine["files"].as_array().unwrap().iter().map(|f| (f["file"].as_str().unwrap().to_string(), f["created"].as_f64().unwrap())).collect();
    let provenance = engine["provenance"].as_object().unwrap().clone();

    let (listed, changed) = engine_listings(Vec::new(), &files, &provenance);
    assert_eq!(json!({ "listings": listed, "changed": changed }), engine["fromNothing"]);

    let before: Vec<Listing> = serde_json::from_value(engine["keptAndGone"]["before"].clone()).unwrap();
    let (after, changed) = engine_listings(before.clone(), &files[1..], &provenance);
    assert_eq!(json!({ "listings": after, "changed": changed }), engine["keptAndGone"]["after"]);
    assert_eq!(json!(engine_listings(before, &files, &provenance).1), engine["keptAndGone"]["same"]);

    for triple in engine["ids"].as_array().unwrap() {
        let file = triple[0].as_str().unwrap();
        assert_eq!(engine_listing_id(file), triple[1].as_str().unwrap());
        assert_eq!(title_of(file), triple[2].as_str().unwrap());
    }
}

#[test]
fn old_listings_come_forward_alike() {
    let root = std::env::temp_dir().join(format!("tactical-store-golden-{}", std::process::id()));
    std::fs::create_dir_all(root.join("data/store")).unwrap();
    for case in cases(&fixture(), "migrations") {
        std::fs::write(root.join(LISTINGS_FILE), case["file"].as_str().unwrap()).unwrap();
        assert_eq!(json!(read_listings(&root)), case["listings"], "{}", case["file"]);
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn model_ids_are_tidied_alike() {
    let golden = fixture();
    for pair in cases(&golden, "tidyId") {
        assert_eq!(tidy_id(pair[0].as_str().unwrap()), pair[1].as_str().unwrap(), "{pair}");
    }
    for case in cases(&golden, "freeModelId") {
        let taken: Vec<YourModel> = case["taken"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| YourModel::named(id.as_str().unwrap()))
            .collect();
        assert_eq!(free_model_id(case["wanted"].as_str().unwrap(), &taken), case["free"].as_str().unwrap());
    }
}

#[test]
fn a_listings_file_the_typescript_wrote_is_written_back_to_the_byte() {
    let text = fixture()["listingsFile"].as_str().unwrap().to_string();
    let root = std::env::temp_dir().join(format!("tactical-store-bytes-{}", std::process::id()));
    std::fs::create_dir_all(root.join("data/store")).unwrap();
    std::fs::write(root.join(LISTINGS_FILE), &text).unwrap();
    let listings = read_listings(&root);
    assert_eq!(listings.len(), 8);
    serve::store::write_listings(&root, &listings).unwrap();
    assert_eq!(std::fs::read_to_string(root.join(LISTINGS_FILE)).unwrap(), text);
    let _ = std::fs::remove_dir_all(&root);
}
