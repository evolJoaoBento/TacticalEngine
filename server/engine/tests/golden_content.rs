//! `server/fixtures/content.json` replayed: every content entry the engine ships read as zod read it -
//! the same output with the same defaults put in - and every break of it refused with the same issues,
//! path for path and word for word; whole documents read by `read_pack` to the same pack, the same issues
//! and the same refusals - conditions and effects included, now that the script's schemas are ported
//! (`tests/golden_script.rs` holds those on their own).

use engine::content::document::{describe_pack, pack_of, read_pack, PackDocument, PACK_LISTS};
use engine::content::pack::{AncestryDef, ArmorDef, CardDef, ClassDef, SubclassDef, WeaponDef};
use engine::content::schema::Kind;
use engine::zod::Key;
use serde_json::{json, Value};

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/content.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/content/content.golden.test.ts")).expect("JSON")
}

fn repo_json(path: &str) -> Value {
    let path = format!("{}/../../{path}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))).expect("JSON")
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

fn path_of(value: &Value) -> Vec<Key> {
    value.as_array().expect("a path").iter().map(|k| k.as_u64().map_or_else(|| Key::Name(k.as_str().expect("a key").into()), |i| Key::Index(i as usize))).collect()
}

#[derive(Default)]
struct Tally {
    compared: usize,
    left_to_script: usize,
}

/// One reading: zod's verdict against ours.
fn compare(kind: Kind, value: &Value, wanted: &Value, tally: &mut Tally, what: &str) {
    let schema = kind.schema();
    let got = schema.parse(value);
    if let Some(ok) = wanted.get("ok") {
        let read = got.unwrap_or_else(|issues| panic!("{what}: zod read it, we refused it: {}", json!(issues)));
        check!(schema.mask(&read), &schema.mask(ok), "{what}");
    } else {
        let issues = wanted["issues"].as_array().expect("issues");
        if issues.iter().any(|i| schema.touches_opaque(Some(value), &path_of(&i["path"]))) {
            tally.left_to_script += 1;
            return;
        }
        match got {
            Ok(read) => panic!("{what}: zod refused it ({}), we read {read}", wanted["issues"]),
            Err(found) => check!(json!(found), &wanted["issues"], "{what}"),
        }
    }
    tally.compared += 1;
}

#[test]
fn every_shipped_entry_reads_as_zod_reads_it() {
    let fixture = fixture();
    let mut tally = Tally::default();
    for group in fixture["entries"].as_array().expect("entries") {
        let kind = Kind::from_name(group["kind"].as_str().unwrap()).expect("a kind");
        for (i, case) in group["cases"].as_array().unwrap().iter().enumerate() {
            compare(kind, &case["value"], case, &mut tally, &format!("{} {i}", kind.name()));
        }
    }
    assert!(tally.compared > 1800, "{} compared", tally.compared);
    assert_eq!(tally.left_to_script, 0);
}

/// A sample with one place changed, as the TypeScript broke it.
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
    let mut tally = Tally::default();
    for group in fixture["breaks"].as_array().expect("breaks") {
        let kind = Kind::from_name(group["kind"].as_str().unwrap()).expect("a kind");
        for sample in group["samples"].as_array().unwrap() {
            for case in sample["cases"].as_array().unwrap() {
                let path = case["path"].as_array().unwrap();
                let value = broken(&sample["sample"], path, &case["change"]);
                compare(kind, &value, case, &mut tally, &format!("{} {} set to {}", kind.name(), case["path"], case["change"]));
            }
        }
    }
    assert!(tally.compared > 5900, "{} compared", tally.compared);
    assert_eq!(tally.left_to_script, 0, "nothing opaque is left in the content schemas");
}

#[test]
fn the_corners_are_turned_as_zod_turns_them() {
    let fixture = fixture();
    let mut tally = Tally::default();
    for case in fixture["corners"].as_array().expect("corners") {
        let kind = Kind::from_name(case["kind"].as_str().unwrap()).expect("a kind");
        compare(kind, &case["value"], case, &mut tally, &format!("{} corner {}", kind.name(), case["value"]));
    }
    assert_eq!(tally.left_to_script, 0);
}

fn masked_pack(pack: &PackDocument) -> Value {
    let mut out = serde_json::to_value(pack).unwrap();
    for (at, (list, kind)) in PACK_LISTS.iter().enumerate() {
        out[*list] = Value::Array(pack.lists[at].iter().map(|entry| kind.schema().mask(entry)).collect());
    }
    out
}

fn masked_wanted(pack: &Value) -> Value {
    let mut out = pack.clone();
    for (list, kind) in PACK_LISTS {
        out[list] = Value::Array(pack[list].as_array().unwrap().iter().map(|entry| kind.schema().mask(entry)).collect());
    }
    out
}

#[test]
fn documents_read_as_read_pack_reads_them() {
    let fixture = fixture();
    for case in fixture["readings"].as_array().expect("readings") {
        let source = case["source"].as_str().unwrap();
        let value = match case["value"].as_str() {
            Some("srd-characters") => repo_json("src/engine/content/pack/shipped/srd-characters.json"),
            Some("default project") => repo_json("projects/default.json"),
            _ => case["value"].clone(),
        };
        let reading = read_pack(&value, source);
        let wanted = &case["reading"];
        check!(json!(reading.refused), &wanted["refused"], "{source}: refused");
        check!(json!(reading.issues), &wanted["issues"], "{source}: issues");
        check!(masked_pack(&reading.pack), &masked_wanted(&wanted["pack"]), "{source}: pack");
        check!(json!(describe_pack(&reading.pack)), &case["described"], "{source}: described");
    }
    let packed = &fixture["packed"];
    let srd = read_pack(&repo_json("src/engine/content/pack/shipped/srd-characters.json"), "srd-characters");
    let lists: [Vec<Value>; 11] = std::array::from_fn(|i| srd.pack.lists[i].iter().take(2).cloned().collect());
    let pack = pack_of(lists);
    check!(masked_pack(&pack), &masked_wanted(&packed["pack"]), "packOf");
    check!(json!(describe_pack(&pack)), &packed["described"], "packOf described");
}

#[test]
fn what_the_schemas_read_is_what_the_character_reads() {
    let fixture = fixture();
    for group in fixture["entries"].as_array().expect("entries") {
        let kind = Kind::from_name(group["kind"].as_str().unwrap()).expect("a kind");
        for case in group["cases"].as_array().unwrap() {
            let read = kind.schema().parse(&case["value"]).expect("read");
            let fits = match kind {
                Kind::Weapon => serde_json::from_value::<WeaponDef>(read.clone()).map(|_| ()),
                Kind::Armor => serde_json::from_value::<ArmorDef>(read.clone()).map(|_| ()),
                Kind::Class => serde_json::from_value::<ClassDef>(read.clone()).map(|_| ()),
                Kind::Ancestry | Kind::Community => serde_json::from_value::<AncestryDef>(read.clone()).map(|_| ()),
                Kind::Subclass => serde_json::from_value::<SubclassDef>(read.clone()).map(|_| ()),
                Kind::Card => serde_json::from_value::<CardDef>(read.clone()).map(|_| ()),
                _ => Ok(()),
            };
            fits.unwrap_or_else(|e| panic!("{} {}: {e}", kind.name(), read["id"]));
        }
    }
}
