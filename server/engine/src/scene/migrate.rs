//! Reading documents older than the code reading them (`src/engine/scene/migrate.ts`): the door every
//! stored document - a project, a pack, a save - comes through before any schema sees it. Each step is
//! named for the version it produces and does one rename or one reshaping; a document several versions
//! behind walks through every step in order. A document newer than this build is left exactly as it is,
//! for the schema to refuse by name.
//!
//! It works on raw JSON, as the TypeScript does, and follows JavaScript's own ways with an object's keys: a
//! key renamed moves to the end, one assigned keeps its place, and what the TypeScript builds a key or an
//! id from it reads as `String()` reads it.

use crate::content::to_content_id;
use crate::js;
use crate::scene::document::CURRENT_FORMAT_VERSION;
use serde_json::{json, Map, Value};

type Raw = Map<String, Value>;

pub use super::prop_functions::OBJECT_BODIES;

/// `String(value)`, for the JSON values a document holds; `undefined` for one it does not.
fn text_of(value: Option<&Value>) -> String {
    match value {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => js::number_to_string(n.as_f64().unwrap_or(f64::NAN)),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items.iter().map(|v| if v.is_null() { String::new() } else { text_of(Some(v)) }).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// A string field, or what stands in for one that is not a string.
fn string_or(raw: &Raw, key: &str, otherwise: &str) -> String {
    raw.get(key).and_then(Value::as_str).unwrap_or(otherwise).to_string()
}

/// The version a raw document claims, or 1 when it claims none.
fn version_of(raw: &Raw) -> f64 {
    raw.get("formatVersion").and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(1.0)
}

/// Rename a key in place, keeping its value; the new name goes where JavaScript puts a new key, last.
fn rename_key(target: &mut Raw, from: &str, to: &str) {
    let Some(value) = target.get(from).cloned() else { return };
    target.insert(to.to_string(), value);
    target.shift_remove(from);
}

/// Set a key where one is set in JavaScript: in its place if it is there, last if it is not. A value
/// JavaScript would write as `undefined` is not written at all, as JSON leaves it out.
fn put(target: &mut Raw, key: &str, value: Option<Value>) {
    match value {
        Some(value) => {
            target.insert(key.to_string(), value);
        }
        None => {
            target.shift_remove(key);
        }
    }
}

/// An object literal's entries, the ones JavaScript would hold as `undefined` left out.
fn literal(entries: Vec<(&str, Option<Value>)>) -> Value {
    Value::Object(entries.into_iter().filter_map(|(k, v)| v.map(|v| (k.to_string(), v))).collect())
}

/// Version 1 to 2: `hope` and `fear` become `good` and `bad`, as keys and as the words a field holds.
fn to_version_2(raw: &mut Raw) {
    rename_key(raw, "hope", "good");
    rename_key(raw, "fear", "bad");
    rename_key(raw, "onSuccessWithHope", "onSuccessWithGood");
    rename_key(raw, "onSuccessWithFear", "onSuccessWithBad");
    rename_key(raw, "onFailureWithHope", "onFailureWithGood");
    rename_key(raw, "onFailureWithFear", "onFailureWithBad");
    const VALUES: [(&str, &str); 14] = [
        ("hope", "good"),
        ("fear", "bad"),
        ("successWithHope", "successWithGood"),
        ("successWithFear", "successWithBad"),
        ("failureWithHope", "failureWithGood"),
        ("failureWithFear", "failureWithBad"),
        ("gainHope", "gainGood"),
        ("loseHope", "loseGood"),
        ("spendHope", "spendGood"),
        ("gainFear", "gainBad"),
        ("loseFear", "loseBad"),
        ("withHope", "withGood"),
        ("withFear", "withBad"),
        ("classHope", "classGood"),
    ];
    rename_key(raw, "hopeDie", "goodDie");
    for (_, value) in raw.iter_mut() {
        if let Value::String(word) = value {
            if let Some((_, renamed)) = VALUES.iter().find(|(from, _)| from == word) {
                *value = json!(renamed);
            }
        }
    }
}

/// Depth first: apply to every object, then walk into what it holds as it now stands.
fn walk(value: &mut Value, apply: fn(&mut Raw)) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(|v| walk(v, apply)),
        Value::Object(raw) => {
            apply(raw);
            for (_, v) in raw.iter_mut() {
                walk(v, apply);
            }
        }
        _ => {}
    }
}

fn objects(value: Option<&Value>) -> Vec<usize> {
    match value {
        Some(Value::Array(items)) => items.iter().enumerate().filter(|(_, v)| v.is_object()).map(|(i, _)| i).collect(),
        _ => Vec::new(),
    }
}

/// An id no card has yet: the one asked for, or it with `-2`, `-3` and on.
fn fresh(id: &str, taken: &mut Vec<String>) -> String {
    let mut at = id.to_string();
    let mut n = 2;
    while taken.contains(&at) {
        at = format!("{id}-{n}");
        n += 1;
    }
    taken.push(at.clone());
    at
}

/// Version 2 to 3: an ability's `source` becomes a card it sits on, and the features classes, subclasses,
/// ancestries and communities printed become cards granted to them.
fn to_version_3(doc: &mut Raw) {
    if doc.get("domainCards").is_some_and(Value::is_array) {
        rename_key(doc, "domainCards", "cards");
    }
    let had = doc.get("cards").is_some_and(Value::is_array);
    let mut cards: Vec<Value> = if had { doc["cards"].as_array().cloned().unwrap_or_default() } else { Vec::new() };
    let mut taken: Vec<String> = cards.iter().filter(|c| c.is_object()).map(|c| text_of(c.get("id"))).collect();
    let mut place = |cards: &mut Vec<Value>, id: &str, name: &str, text: &str, grant: Value| -> usize {
        let at = fresh(id, &mut taken);
        cards.push(json!({ "id": at, "name": name, "text": text, "grant": grant }));
        cards.len() - 1
    };
    // The cards made for an ability, by what a class's or subclass's feature would be called.
    let mut built: Vec<(String, usize)> = Vec::new();
    let set = |built: &mut Vec<(String, usize)>, key: String, card: usize| match built.iter_mut().find(|(k, _)| *k == key) {
        Some(entry) => entry.1 = card,
        None => built.push((key, card)),
    };
    if let Some(Value::Array(abilities)) = doc.get_mut("abilities") {
        for ability in abilities.iter_mut() {
            let Some(ability) = ability.as_object_mut() else { continue };
            let Some(source) = ability.get("source").and_then(Value::as_object).cloned() else { continue };
            let id = text_of(ability.get("id"));
            let name = string_or(ability, "name", &id);
            let text = string_or(ability, "text", "");
            let field = |key: &str| source.get(key).cloned();
            let (grant, keys) = match source.get("kind").and_then(Value::as_str) {
                Some("domainCard") => {
                    put(ability, "source", Some(literal(vec![("card", field("card"))])));
                    continue;
                }
                Some("classGood") => (literal(vec![("kind", Some(json!("class"))), ("classId", field("classId"))]), vec![format!("class:{}:signature", text_of(source.get("classId")))]),
                Some("classFeature") => (literal(vec![("kind", Some(json!("class"))), ("classId", field("classId"))]), vec![format!("class:{}:{name}", text_of(source.get("classId")))]),
                Some("subclass") => (
                    literal(vec![("kind", Some(json!("subclass"))), ("subclassId", field("subclassId")), ("stage", field("stage"))]),
                    vec![format!("subclass:{}:{}:{name}", text_of(source.get("subclassId")), text_of(source.get("stage")))],
                ),
                Some("granted") => (literal(vec![("kind", Some(json!("given"))), ("characters", field("characters"))]), Vec::new()),
                Some("adversary") => (literal(vec![("kind", Some(json!("adversary"))), ("adversaries", field("adversaries"))]), Vec::new()),
                _ => continue,
            };
            let card = place(&mut cards, &id, &name, &text, grant);
            for key in keys {
                set(&mut built, key, card);
            }
            let card_id = cards[card]["id"].clone();
            put(ability, "source", Some(json!({ "card": card_id })));
        }
    }
    let mut print = |cards: &mut Vec<Value>, feature: &Raw, owner: &str, grant: Value, keys: &[String]| {
        let name = string_or(feature, "name", "");
        let text = string_or(feature, "text", "");
        if let Some(&card) = keys.iter().find_map(|key| built.iter().find(|(k, _)| k == key).map(|(_, c)| c)) {
            if cards[card]["text"] == "" {
                cards[card]["text"] = json!(text);
            }
            return;
        }
        let slug = to_content_id(&name);
        let id = format!("{owner}-{}", if slug.is_empty() { "feature" } else { slug.as_str() });
        place(cards, &id, if name.is_empty() { owner } else { &name }, &text, grant);
    };
    let features = |owner: &Raw, key: &str| -> Vec<Raw> { objects(owner.get(key)).into_iter().map(|i| owner[key][i].as_object().cloned().expect("an object")).collect() };
    if let Some(Value::Array(classes)) = doc.get_mut("classes") {
        for klass in classes.iter_mut().filter_map(Value::as_object_mut) {
            let class_id = text_of(klass.get("id"));
            let grant = || json!({ "kind": "class", "classId": class_id });
            for feature in features(klass, "features") {
                let key = format!("class:{class_id}:{}", text_of(feature.get("name")));
                print(&mut cards, &feature, &class_id, grant(), &[key]);
            }
            if let Some(signature) = klass.get("signatureFeature").and_then(Value::as_object).cloned() {
                let keys = [format!("class:{class_id}:signature"), format!("class:{class_id}:{}", text_of(signature.get("name")))];
                print(&mut cards, &signature, &class_id, grant(), &keys);
            }
            klass.shift_remove("features");
            klass.shift_remove("signatureFeature");
        }
    }
    if let Some(Value::Array(subclasses)) = doc.get_mut("subclasses") {
        for subclass in subclasses.iter_mut().filter_map(Value::as_object_mut) {
            let subclass_id = text_of(subclass.get("id"));
            for stage in ["foundation", "specialization", "mastery"] {
                for feature in features(subclass, stage) {
                    let key = format!("subclass:{subclass_id}:{stage}:{}", text_of(feature.get("name")));
                    print(&mut cards, &feature, &subclass_id, json!({ "kind": "subclass", "subclassId": subclass_id, "stage": stage }), &[key]);
                }
                subclass.shift_remove(stage);
            }
        }
    }
    for (list, kind, key) in [("ancestries", "ancestry", "ancestryId"), ("communities", "community", "communityId")] {
        if let Some(Value::Array(owners)) = doc.get_mut(list) {
            for owner in owners.iter_mut().filter_map(Value::as_object_mut) {
                let owner_id = text_of(owner.get("id"));
                for feature in features(owner, "features") {
                    let mut grant = Map::new();
                    grant.insert("kind".into(), json!(kind));
                    grant.insert(key.into(), json!(owner_id));
                    print(&mut cards, &feature, &owner_id, Value::Object(grant), &[]);
                }
                owner.shift_remove("features");
            }
        }
    }
    if had || !cards.is_empty() {
        put(doc, "cards", Some(Value::Array(cards)));
    }
}

/// Version 3 to 4: a condition that lent an ability becomes a card the condition grants.
fn to_version_4(doc: &mut Raw) {
    let lending: Vec<usize> = objects(doc.get("conditionDefs")).into_iter().filter(|&i| doc["conditionDefs"][i].get("grants").is_some()).collect();
    if lending.is_empty() {
        return;
    }
    let mut abilities: Vec<Value> = doc.get("abilities").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut cards: Vec<Value> = doc.get("cards").and_then(Value::as_array).cloned().unwrap_or_default();
    let on_card = |ability: &Value| ability.get("source").filter(|s| s.is_object()).and_then(|s| s.get("card")).cloned();
    let mut ability_ids: Vec<String> = abilities.iter().filter(|a| a.is_object()).map(|a| text_of(a.get("id"))).collect();
    let mut card_ids: Vec<String> = cards.iter().filter(|c| c.is_object()).map(|c| text_of(c.get("id"))).collect();
    // The grant made for each ability lent, by the ability's id: where a later condition lending it is added.
    let mut lent: Vec<(String, usize)> = Vec::new();
    for def_at in lending {
        let def = doc["conditionDefs"][def_at].as_object_mut().expect("an object");
        let granted = def.shift_remove("grants");
        let condition_id = text_of(def.get("id"));
        let Some(ability_id) = granted.as_ref().and_then(|g| g.as_object()).and_then(|g| g.get("ability")).and_then(Value::as_str).map(str::to_string) else { continue };
        let Some(ability_at) = abilities.iter().position(|a| a.is_object() && a["id"].as_str() == Some(ability_id.as_str())) else { continue };
        if let Some((_, card)) = lent.iter().find(|(id, _)| *id == ability_id) {
            cards[*card]["grant"]["conditions"].as_array_mut().expect("a list").push(json!(condition_id));
            continue;
        }
        let card = on_card(&abilities[ability_at]);
        // `===` between what two abilities' sources name: equal for the same word, never for two objects.
        let same = |a: &Value, b: &Value| !a.is_object() && !a.is_array() && a == b;
        let shared = card.as_ref().is_some_and(|card| abilities.iter().enumerate().any(|(i, other)| i != ability_at && other.is_object() && on_card(other).is_some_and(|c| same(&c, card))));
        let holder_at = if shared {
            ability_at
        } else {
            let mut copy = abilities[ability_at].clone();
            copy["id"] = json!(fresh(&format!("{ability_id}-lent"), &mut ability_ids));
            abilities.push(copy);
            abilities.len() - 1
        };
        let grant = json!({ "kind": "condition", "conditions": [condition_id] });
        let id = fresh(&text_of(abilities[holder_at].get("id")), &mut card_ids);
        let ability = abilities[ability_at].as_object().expect("an object");
        cards.push(json!({ "id": id, "name": string_or(ability, "name", &ability_id), "text": string_or(ability, "text", ""), "grant": grant }));
        put(abilities[holder_at].as_object_mut().expect("an object"), "source", Some(json!({ "card": id })));
        lent.push((ability_id, cards.len() - 1));
    }
    if !lent.is_empty() {
        put(doc, "abilities", Some(Value::Array(abilities)));
        put(doc, "cards", Some(Value::Array(cards)));
    }
}

/// Version 4 to 5: a save of the husk vault from before rooms grew says how wide the vault was.
fn to_version_5(doc: &mut Raw) {
    let Some(Value::Object(scenes)) = doc.get_mut("scenes") else { return };
    let Some(Value::Object(vault)) = scenes.get_mut("the-husk-vault") else { return };
    if vault.get("room").is_some_and(Value::is_object) {
        return;
    }
    put(vault, "room", Some(json!({ "width": 22, "x": 0, "y": 0 })));
}

/// Version 5 to 6: a room's objects become props, each with a Script function saying what the object said.
fn to_version_6(doc: &mut Raw) {
    let Some(Value::Array(scenes)) = doc.get_mut("scenes") else { return };
    for scene in scenes.iter_mut().filter_map(Value::as_object_mut) {
        let mut kept: Vec<Value> = Vec::new();
        let mut props: Vec<Value> = scene.get("decos").and_then(Value::as_array).cloned().unwrap_or_default();
        let objects: Vec<Raw> = scene.get("interactables").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_object().cloned()).collect()).unwrap_or_default();
        for object in objects {
            let kind = string_or(&object, "kind", "scripted");
            let model = object.get("model").and_then(Value::as_str).map(str::to_string).or_else(|| OBJECT_BODIES.iter().find(|(k, _)| *k == kind).map(|(_, m)| m.to_string()));
            let Some(model) = model else {
                kept.push(Value::Object(object));
                continue;
            };
            let mut function = Map::new();
            function.insert("kind".into(), json!("script"));
            function.insert("object".into(), json!(kind));
            for (key, value) in &object {
                if !["id", "position", "rotation", "model", "kind"].contains(&key.as_str()) {
                    function.insert(key.clone(), value.clone());
                }
            }
            let rotation = object.get("rotation").filter(|r| r.is_number()).cloned().unwrap_or(json!(0));
            props.push(literal(vec![
                ("id", object.get("id").cloned()),
                ("model", Some(json!(model))),
                ("position", object.get("position").cloned()),
                ("rotation", Some(rotation)),
                ("function", Some(Value::Object(function))),
            ]));
        }
        put(scene, "decos", Some(Value::Array(props)));
        put(scene, "interactables", Some(Value::Array(kept)));
    }
}

/// Bring a raw stored document up to the version this build writes. Anything but an object, and anything
/// claiming this version or a newer one, comes back as it was.
pub fn migrate_document(raw: &Value) -> Value {
    let Value::Object(original) = raw else { return raw.clone() };
    let mut copy = original.clone();
    let from = version_of(&copy);
    let current = f64::from(CURRENT_FORMAT_VERSION);
    if from >= current {
        return Value::Object(copy);
    }
    if from < 2.0 {
        let mut whole = Value::Object(copy);
        walk(&mut whole, to_version_2);
        copy = match whole {
            Value::Object(raw) => raw,
            _ => unreachable!("an object stays one"),
        };
    }
    let steps: [(f64, fn(&mut Raw)); 4] = [(3.0, to_version_3), (4.0, to_version_4), (5.0, to_version_5), (6.0, to_version_6)];
    for (to, step) in steps {
        if from < to {
            step(&mut copy);
        }
    }
    put(&mut copy, "formatVersion", Some(json!(CURRENT_FORMAT_VERSION)));
    Value::Object(copy)
}
