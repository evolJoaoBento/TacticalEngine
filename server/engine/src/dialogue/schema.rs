//! Dialogue as authored data (`src/engine/dialogue/schema.ts`): nodes of lines and replies, a reply's
//! check and where it leads, and where a node sits on the editor's canvas.
//!
//! Conditions, effects and a check's own fields are `script/`'s (`crate::script::schema`): `parse_dialogue`
//! reads them in full, as zod does, with the dialogue's own shape and its two refinements - no node id
//! twice, and a start that is one of the nodes. They are kept as the JSON they read to, and handed to a
//! `DialogueHost` to answer.

use crate::script::schema as script;
use crate::zod::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DialogueLine {
    /// Who is talking. Omitted for narration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    pub text: String,
}

/// A check inside a conversation: the ordinary check (kept whole in `request`), plus somewhere to go
/// depending on how it went.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueCheck {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goto_on_success: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goto_on_failure: Option<String>,
    /// The rest of the check request: `trait`, `difficulty`, and whatever else it carries.
    #[serde(flatten)]
    pub request: Map<String, Value>,
}

impl DialogueCheck {
    pub fn trait_(&self) -> Option<&Value> {
        self.request.get("trait")
    }

    pub fn difficulty(&self) -> Option<&Value> {
        self.request.get("difficulty")
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DialogueChoice {
    /// What the player's reply says.
    pub text: String,
    /// A hint at the cost or consequence, shown under the reply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Hidden entirely when this fails, which is how knowledge gates a reply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available: Option<Value>,
    /// Shown but not selectable when this fails - a visible locked option.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<DialogueCheck>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effects: Option<Vec<Value>>,
    /// Where to go next. Omitted ends the conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goto: Option<String>,
}

/// Where a node sits on the editor's canvas: canvas coordinates, any number.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct CanvasPoint {
    pub x: f64,
    pub y: f64,
}

/// A `consequence` says nothing: it runs its `onEnter` and goes on to its `goto`, or ends the talk.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Consequence,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<NodeKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<CanvasPoint>,
    #[serde(default)]
    pub lines: Vec<DialogueLine>,
    /// Run when the node is entered, before its lines are shown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_enter: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<DialogueChoice>>,
    /// Where to go with no choices at all - a straight line of narration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goto: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Dialogue {
    pub id: String,
    pub start: String,
    pub nodes: Vec<DialogueNode>,
}

/// `dialogueCheckSchema`: the ordinary check request, and where to go on success or failure.
fn dialogue_check() -> Schema {
    let mut fields = script::check_request_fields();
    fields.push(opt("gotoOnSuccess", string().min(1.0)));
    fields.push(opt("gotoOnFailure", string().min(1.0)));
    object(fields)
}

fn effects() -> Schema {
    array(lazy(script::effect))
}

fn choice() -> Schema {
    object(vec![
        req("text", string().min(1.0)),
        opt("detail", string()),
        opt("available", lazy(script::condition)),
        opt("enabled", lazy(script::condition)),
        opt("check", dialogue_check()),
        opt("effects", effects()),
        opt("goto", string().min(1.0)),
    ])
}

fn node() -> Schema {
    object(vec![
        req("id", string().min(1.0)),
        opt("kind", literal(json!("consequence"))),
        opt("position", object(vec![req("x", number()), req("y", number())])),
        def("lines", array(object(vec![opt("speaker", string()), req("text", string())])), || json!([])),
        opt("onEnter", effects()),
        opt("choices", array(choice())),
        opt("goto", string().min(1.0)),
    ])
}

/// No node id twice, and a start that is one of the nodes: a bad file is refused on load rather than
/// mid-conversation.
fn nodes_hold_together(dialogue: &Map<String, Value>, found: &mut Refinements) {
    let nodes = dialogue.get("nodes").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
    let mut seen: Vec<&Value> = Vec::new();
    for (i, node) in nodes.iter().enumerate() {
        let id = &node["id"];
        if seen.contains(&id) {
            found.add(vec![Key::Name("nodes".into()), Key::Index(i), Key::Name("id".into())], format!("duplicate node id \"{}\"", id.as_str().unwrap_or_default()));
        }
        seen.push(id);
    }
    let start = dialogue.get("start").unwrap_or(&Value::Null);
    if !seen.contains(&start) {
        found.add(vec![Key::Name("start".into())], format!("start \"{}\" is not one of the dialogue's nodes", start.as_str().unwrap_or_default()));
    }
}

/// `dialogueSchema`.
pub fn dialogue_schema() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| object(vec![req("id", content_id()), req("start", string().min(1.0)), req("nodes", array(node()).min(1.0))]).refine(nodes_hold_together))
}

/// Parse an untrusted dialogue as zod does: every issue, or the dialogue with its defaults put in.
pub fn parse_dialogue(value: &Value) -> Result<Dialogue, Vec<Issue>> {
    let read = dialogue_schema().parse(value)?;
    Ok(serde_json::from_value(read).expect("what the schema reads is a dialogue"))
}
