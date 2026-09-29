//! Dialogue as authored data (`src/engine/dialogue/schema.ts`): nodes of lines and replies, a reply's
//! check and where it leads, and where a node sits on the editor's canvas.
//!
//! Conditions, effects and a check's own fields are `script/`'s, which is not ported yet: they are kept
//! as the JSON they were written in, handed to a `DialogueHost` to answer, and `parse_dialogue` checks
//! only that they are there in the right place. What it checks in full is the dialogue's own shape - the
//! id, the start, the nodes and their links, and the two refinements: no node id twice, and a start that
//! is one of the nodes.

use crate::schema::{array, content_id, fail, number, object, optional, required, string, Checked, SchemaError};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

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

/// A condition, an effect or a check request: `script/`'s to check in full; here, an object.
fn opaque(value: &Value, path: &str) -> Checked {
    object(value, path).map(|_| ())
}

fn effects(value: &Value, path: &str) -> Checked {
    array(value, path, opaque)
}

fn link(value: &Value, path: &str) -> Checked {
    string(value, path, true)
}

fn line(value: &Value, path: &str) -> Checked {
    let fields = object(value, path)?;
    optional(fields, "speaker", path, |v, p| string(v, p, false))?;
    required(fields, "text", path, |v, p| string(v, p, false))
}

fn check(value: &Value, path: &str) -> Checked {
    let fields = object(value, path)?;
    optional(fields, "gotoOnSuccess", path, link)?;
    optional(fields, "gotoOnFailure", path, link)
}

fn choice(value: &Value, path: &str) -> Checked {
    let fields = object(value, path)?;
    required(fields, "text", path, |v, p| string(v, p, true))?;
    optional(fields, "detail", path, |v, p| string(v, p, false))?;
    optional(fields, "available", path, opaque)?;
    optional(fields, "enabled", path, opaque)?;
    optional(fields, "check", path, check)?;
    optional(fields, "effects", path, effects)?;
    optional(fields, "goto", path, link)
}

fn node(value: &Value, path: &str) -> Checked {
    let fields = object(value, path)?;
    required(fields, "id", path, |v, p| string(v, p, true))?;
    optional(fields, "kind", path, |v, p| if v.as_str() == Some("consequence") { Ok(()) } else { fail(p, "expected consequence") })?;
    optional(fields, "position", path, |v, p| {
        let point = object(v, p)?;
        required(point, "x", p, number)?;
        required(point, "y", p, number)
    })?;
    optional(fields, "lines", path, |v, p| array(v, p, line))?;
    optional(fields, "onEnter", path, effects)?;
    optional(fields, "choices", path, |v, p| array(v, p, choice))?;
    optional(fields, "goto", path, link)
}

fn check_dialogue(value: &Value) -> Checked {
    let path = "dialogue";
    let fields = object(value, path)?;
    required(fields, "id", path, content_id)?;
    required(fields, "start", path, link)?;
    required(fields, "nodes", path, |v, p| match v.as_array() {
        Some(nodes) if nodes.is_empty() => fail(p, "a dialogue has at least one node"),
        _ => array(v, p, node),
    })
}

/// Parse an untrusted dialogue: checked, then read, every field it does not know dropped.
pub fn parse_dialogue(value: &Value) -> Result<Dialogue, SchemaError> {
    check_dialogue(value)?;
    let dialogue: Dialogue = serde_json::from_value(value.clone()).map_err(|_| SchemaError { path: "dialogue".into(), message: "not a dialogue" })?;
    // A repeated node id makes `DialogueRunner` refuse the dialogue; caught here, a bad file is refused
    // on load rather than mid-conversation.
    let mut seen: Vec<&str> = Vec::new();
    for (i, node) in dialogue.nodes.iter().enumerate() {
        if seen.contains(&node.id.as_str()) {
            return Err(SchemaError { path: format!("dialogue.nodes[{i}].id"), message: "duplicate node id" });
        }
        seen.push(&node.id);
    }
    if !seen.contains(&dialogue.start.as_str()) {
        return Err(SchemaError { path: "dialogue.start".into(), message: "start is not one of the dialogue's nodes" });
    }
    Ok(dialogue)
}
