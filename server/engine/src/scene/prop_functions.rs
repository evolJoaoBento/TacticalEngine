//! What a prop's function does in play (`src/engine/scene/prop-functions.ts`): each function an author
//! chose, turned into the object it plays as - the same interactable, used by the same `use_interactable`,
//! its state kept by the same id - so a prop with a function is opened, shut, used up and saved exactly as
//! an object always was.
//!
//! Every function is some arrangement of the parts below (`parts`); what the editor offers of them - the
//! labels, the summaries, a function's settings at their defaults - is the editor's, and stays on the
//! client. Documents here are JSON as the schema reads them, so a function is a `Value`.

use super::deco_span::deco_footprint;
use crate::js;
use serde_json::{json, Map, Value};

/// What each kind of object is drawn with when it names no model of its own.
pub const OBJECT_BODIES: [(&str, &str); 4] = [("door", "door-prop"), ("chest", "chest-prop"), ("pillar", "pillar-prop"), ("portal", "portal-prop")];

/// The body an object of this kind is drawn with, when it has one.
pub fn body_of(kind: &str) -> Option<&'static str> {
    OBJECT_BODIES.iter().find(|(k, _)| *k == kind).map(|(_, model)| *model)
}

/// The parts. Every function is built out of these.
pub mod parts {
    use serde_json::{json, Value};

    pub fn toggle(this: &str) -> Value {
        json!({ "kind": "toggleOpen", "interactable": this })
    }
    pub fn show_contents(this: &str) -> Value {
        json!({ "kind": "openContainer", "interactable": this })
    }
    pub fn teleport(pair: &Value) -> Value {
        json!({ "kind": "teleport", "pair": pair })
    }
    pub fn open_shop(this: &str) -> Value {
        json!({ "kind": "openShop", "of": this })
    }
    /// A conversation to open, or nothing while none is picked.
    pub fn talk(dialogue: &Value) -> Vec<Value> {
        if dialogue.as_str() == Some("") {
            Vec::new()
        } else {
            vec![json!({ "kind": "startDialogue", "dialogue": dialogue })]
        }
    }
    /// Roll a trait against a difficulty: one list on a success, one on a failure. A critical is a
    /// success, and either die's win settles it the same way.
    pub fn check_request(trait_: &Value, difficulty: &Value, success: &[Value], failure: &[Value]) -> Value {
        json!({
            "trait": trait_, "difficulty": difficulty,
            "onCriticalSuccess": success, "onSuccessWithGood": success, "onSuccessWithBad": success,
            "onFailureWithGood": failure, "onFailureWithBad": failure,
        })
    }
    pub fn check(trait_: &Value, difficulty: &Value, success: &[Value], failure: &[Value]) -> Value {
        json!({ "kind": "check", "check": check_request(trait_, difficulty, success, failure) })
    }
}

fn kind_of(function: &Value) -> &str {
    function["kind"].as_str().unwrap_or_default()
}

fn optional<'v>(function: &'v Value, key: &str) -> Option<&'v Value> {
    function.get(key).filter(|v| !v.is_null())
}

/// What a function does as a step of another: a Trapped prop's success, say. Nothing for no function.
pub fn steps_of(function: Option<&Value>, this: &str) -> Vec<Value> {
    let Some(f) = function else { return Vec::new() };
    match kind_of(f) {
        "container" => vec![parts::show_contents(this)],
        "door" => vec![parts::toggle(this)],
        "trapped" => vec![parts::check(&f["trait"], &f["difficulty"], &steps_of(optional(f, "success"), this), &steps_of(optional(f, "failure"), this))],
        "portal" => vec![parts::teleport(&f["pair"])],
        "interaction" => parts::talk(&f["dialogue"]),
        "shop" => vec![parts::open_shop(this)],
        "script" => {
            let mut steps = f["effects"].as_array().cloned().unwrap_or_default();
            if let Some(check) = optional(f, "check") {
                steps.push(json!({ "kind": "check", "check": check }));
            }
            steps
        }
        _ => Vec::new(),
    }
}

/// Whether a function stands in the way until something opens it.
pub fn opens(function: Option<&Value>) -> bool {
    let Some(f) = function else { return false };
    match kind_of(f) {
        "door" => true,
        "trapped" => opens(optional(f, "success")) || opens(optional(f, "failure")),
        "script" => f["object"] == "door",
        _ => false,
    }
}

/// How a used prop behaves: everything an object is, bar where it stands and what it looks like.
fn behaviour(f: &Value, this: &str, prop: &Value) -> Map<String, Value> {
    let solid = prop.get("solid") == Some(&Value::Bool(true));
    let out = match kind_of(f) {
        "container" => json!({ "kind": "chest", "blocksMovement": solid, "repeatable": true, "effects": [parts::show_contents(this)] }),
        "door" => json!({ "kind": "door", "blocksMovement": true, "repeatable": true, "toggles": true, "effects": [parts::toggle(this)] }),
        "trapped" => {
            // A trap guarding a door is a door: in the way until the roll opens it.
            let guards = opens(optional(f, "success")) || opens(optional(f, "failure"));
            json!({
                "kind": if guards { "door" } else { "scripted" },
                "blocksMovement": guards || solid,
                "repeatable": f["repeatable"],
                "check": parts::check_request(&f["trait"], &f["difficulty"], &steps_of(optional(f, "success"), this), &steps_of(optional(f, "failure"), this)),
            })
        }
        "portal" => json!({ "kind": "portal", "blocksMovement": solid, "repeatable": true, "effects": [parts::teleport(&f["pair"])] }),
        "interaction" => json!({ "kind": "scripted", "blocksMovement": solid, "repeatable": true, "effects": parts::talk(&f["dialogue"]) }),
        "shop" => json!({ "kind": "scripted", "blocksMovement": solid, "repeatable": true, "effects": [parts::open_shop(this)] }),
        "script" => {
            let mut out = json!({ "kind": f["object"], "name": f["name"], "flavor": f["flavor"], "blocksMovement": f["blocksMovement"], "effects": f["effects"] });
            // What the function leaves out, the object leaves out: a JavaScript `undefined` is no key at all.
            for key in ["check", "repeatable", "requiresKey", "lockedText", "goto", "tags", "data"] {
                if let Some(value) = f.get(key) {
                    out[key] = value.clone();
                }
            }
            out
        }
        _ => json!({}),
    };
    match out {
        Value::Object(map) => map,
        _ => unreachable!(),
    }
}

/// Whether a prop can be used: one with a function and the id its state is kept by.
pub fn is_usable(deco: &Value) -> bool {
    optional(deco, "function").is_some() && optional(deco, "id").is_some()
}

/// The object a usable prop plays as (`objectOfProp`). Drawn as the prop it is, never a second time.
pub fn object_of_prop(prop: &Value) -> Value {
    let id = prop["id"].as_str().unwrap_or_default();
    let mut object = json!({ "name": "", "flavor": "", "effects": [], "lockedText": "", "tags": [], "data": {} });
    let fields = object.as_object_mut().expect("an object");
    for (key, value) in behaviour(&prop["function"], id, prop) {
        fields.insert(key, value);
    }
    fields.insert("id".into(), json!(id));
    fields.insert("position".into(), prop["position"].clone());
    fields.insert("model".into(), Value::Null);
    fields.insert("rotation".into(), prop["rotation"].clone());
    object
}

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// Every usable thing in a room: the objects it still has, then the props with a function.
pub fn interactables_of(scene: &Value) -> Vec<Value> {
    let mut things = list(scene, "interactables").to_vec();
    things.extend(list(scene, "decos").iter().filter(|deco| is_usable(deco)).map(object_of_prop));
    things
}

/// Every tile a prop with a function covers; nothing for an object, which stands on one.
pub fn footprint_of(scene: &Value, id: &str) -> Vec<(f64, f64)> {
    list(scene, "decos")
        .iter()
        .find(|deco| deco["id"].as_str() == Some(id) && optional(deco, "function").is_some())
        .map(deco_footprint)
        .unwrap_or_default()
}

/// The first function of a kind anywhere in a function, a Trapped one's success before its failure.
pub fn find_function<'a>(function: Option<&'a Value>, kind: &str) -> Option<&'a Value> {
    let f = function?;
    if kind_of(f) == kind {
        return Some(f);
    }
    if kind_of(f) == "trapped" {
        return find_function(optional(f, "success"), kind).or_else(|| find_function(optional(f, "failure"), kind));
    }
    None
}

/// What a container holds, wherever in a prop's function the container is.
pub fn container_items(function: Option<&Value>) -> Vec<Value> {
    find_function(function, "container").map(|c| list(c, "items").to_vec()).unwrap_or_default()
}

/// Every pair id a function answers to, nested portals included.
pub fn pairs_of(function: Option<&Value>) -> Vec<String> {
    let Some(f) = function else { return Vec::new() };
    match kind_of(f) {
        "portal" => vec![f["pair"].as_str().unwrap_or_default().to_string()],
        "trapped" => {
            let mut pairs = pairs_of(optional(f, "success"));
            pairs.extend(pairs_of(optional(f, "failure")));
            pairs
        }
        _ => Vec::new(),
    }
}

/// A portal in a project, and the room it stands in.
#[derive(Clone, Debug, PartialEq)]
pub struct Portal<'a> {
    pub scene: &'a str,
    pub prop: &'a Value,
}

/// Every portal in a project with this pair id. An empty id pairs with nothing.
pub fn portals_with<'a>(project: &'a Value, pair: &str) -> Vec<Portal<'a>> {
    if js::trim(pair).is_empty() {
        return Vec::new();
    }
    let mut found = Vec::new();
    for scene in list(project, "scenes") {
        for deco in list(scene, "decos") {
            if is_usable(deco) && pairs_of(optional(deco, "function")).iter().any(|p| p == pair) {
                found.push(Portal { scene: scene["id"].as_str().unwrap_or_default(), prop: deco });
            }
        }
    }
    found
}

/// The other end of a pair from this prop, or nothing when it has none yet.
pub fn portal_partner<'a>(project: &'a Value, pair: &str, from: Option<&str>) -> Option<Portal<'a>> {
    portals_with(project, pair).into_iter().find(|portal| portal.prop["id"].as_str() != from)
}

/// The props already holding a pair id when two others do - a pair is two - and nothing when it is free.
pub fn pair_taken(project: &Value, pair: &str, this: Option<&str>) -> Vec<String> {
    let others: Vec<Portal> = portals_with(project, pair).into_iter().filter(|portal| portal.prop["id"].as_str() != this).collect();
    if others.len() >= 2 {
        others.iter().map(|portal| portal.prop["id"].as_str().unwrap_or_default().to_string()).collect()
    } else {
        Vec::new()
    }
}

/// Turn a room's objects into props, each with a Script function saying everything the object said, so
/// `object_of_prop` gives back the object it was. One with nothing to draw it with stays an object. Says
/// whether it changed anything.
pub fn objects_to_props(scene: &mut Value) -> bool {
    let objects = std::mem::take(scene["interactables"].as_array_mut().expect("a scene has interactables"));
    let mut kept = Vec::new();
    let mut made = Vec::new();
    for object in objects {
        let model = match object.get("model") {
            Some(Value::String(model)) => Some(model.clone()),
            _ => body_of(object["kind"].as_str().unwrap_or_default()).map(str::to_string),
        };
        let Some(model) = model else {
            kept.push(object);
            continue;
        };
        let mut function = json!({
            "kind": "script", "object": object["kind"], "name": object["name"], "flavor": object["flavor"],
            "blocksMovement": object["blocksMovement"], "effects": object["effects"],
        });
        for key in ["check", "repeatable", "requiresKey", "lockedText", "goto", "tags", "data"] {
            if let Some(value) = object.get(key) {
                function[key] = value.clone();
            }
        }
        made.push(json!({ "id": object["id"], "model": model, "position": object["position"], "rotation": object["rotation"], "function": function }));
    }
    let changed = !made.is_empty();
    scene["decos"].as_array_mut().expect("a scene has decos").extend(made);
    scene["interactables"] = Value::Array(kept);
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trap_guarding_a_door_is_a_door() {
        let prop = json!({
            "id": "gate", "model": "door-prop", "position": { "x": 1, "y": 2 }, "rotation": 1,
            "function": { "kind": "trapped", "trait": "finesse", "difficulty": 12, "repeatable": false, "success": { "kind": "door" } },
        });
        let object = object_of_prop(&prop);
        assert_eq!(object["kind"], "door");
        assert_eq!(object["blocksMovement"], true);
        assert_eq!(object["check"]["onSuccessWithBad"], json!([{ "kind": "toggleOpen", "interactable": "gate" }]));
        assert_eq!(object["check"]["onFailureWithGood"], json!([]));
        assert_eq!(object["model"], Value::Null);
    }

    #[test]
    fn a_pair_is_two() {
        let portal = |id: &str| json!({ "id": id, "model": "p", "position": { "x": 0, "y": 0 }, "rotation": 0, "function": { "kind": "portal", "pair": "a" } });
        let project = json!({ "scenes": [{ "id": "one", "decos": [portal("x"), portal("y")] }, { "id": "two", "decos": [portal("z")] }] });
        assert_eq!(portal_partner(&project, "a", Some("x")).map(|p| p.scene), Some("one"));
        assert_eq!(pair_taken(&project, "a", Some("x")), ["y", "z"]);
        assert!(pair_taken(&project, "a", Some("q")).len() == 3);
        assert!(portals_with(&project, " ").is_empty());
    }
}
