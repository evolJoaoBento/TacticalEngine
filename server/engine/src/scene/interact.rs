//! Using an interactable (`src/engine/scene/interact.ts`): what needs no roll is settled here - already
//! used, already open, taken away, locked without the key, nothing to do - and everything else is handed
//! to the script runner, which pauses for the roll as it does anywhere. Nothing here rolls or changes
//! the world itself, so a use replays from a seed as a fight does.

use crate::rng::Rng;
use crate::script::conditions::InteractableState;
use crate::script::runner::{RunStatus, RunnerOptions, ScriptRunner, ScriptWorld};
use serde_json::{json, Value};

/// Why a use did nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefusalReason {
    AlreadyUsed,
    AlreadyOpen,
    Removed,
    Locked,
    NothingToDo,
}

/// A use refused, and the line to show for it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Refusal {
    pub reason: RefusalReason,
    pub text: String,
}

pub enum UseResult<'a, W: ScriptWorld + ?Sized> {
    /// It did something, and finished.
    Done(ScriptRunner<'a, W>),
    /// It needs an answer - a roll, or a choice - before it can finish.
    Waiting(Value, ScriptRunner<'a, W>),
    /// It refused.
    Refused(Refusal),
}

fn text<'v>(thing: &'v Value, key: &str) -> &'v str {
    thing[key].as_str().unwrap_or_default()
}

/// Whether a use is refused, and what it runs when it is not. The legacy prototype's order: a thing taken
/// away is gone, an open one stays open unless it toggles, a used one stays used unless it may be used
/// again, a locked one says its locked text without spending the roll - and one with nothing to run says
/// what it is. The key is asked about only when it matters.
pub fn decide(interactable: &Value, state: InteractableState, has_key: &mut dyn FnMut(&str) -> bool, repeatable: bool) -> Result<Vec<Value>, Refusal> {
    let refused = |reason, text: &str| Err(Refusal { reason, text: text.to_string() });
    if state.removed {
        return refused(RefusalReason::Removed, "There is nothing there any more.");
    }
    if state.open && interactable.get("toggles") != Some(&Value::Bool(true)) {
        return refused(RefusalReason::AlreadyOpen, "It is already open.");
    }
    if state.used && !repeatable {
        return refused(RefusalReason::AlreadyUsed, "You have already dealt with this.");
    }
    if let Some(key) = interactable.get("requiresKey").and_then(Value::as_str) {
        if !has_key(key) {
            // "Locked." is the author's line to write, when there is one.
            let locked = text(interactable, "lockedText");
            return refused(RefusalReason::Locked, if locked.is_empty() { "It is locked." } else { locked });
        }
    }
    let effects = opening_effects(interactable);
    if effects.is_empty() {
        return Err(Refusal { reason: RefusalReason::NothingToDo, text: describe(interactable) });
    }
    Ok(effects)
}

/// What using a thing runs: its flavour, its effects, then its check or its travel - and, when it did
/// anything beyond flavour, `markUsed`, so a chest does not pay out twice. Reading an inscription does not
/// use it up.
pub fn opening_effects(interactable: &Value) -> Vec<Value> {
    let mut effects = Vec::new();
    if !text(interactable, "flavor").is_empty() {
        effects.push(json!({ "kind": "log", "text": interactable["flavor"], "tone": "narration" }));
    }
    let own = interactable["effects"].as_array().map_or(&[][..], Vec::as_slice);
    effects.extend_from_slice(own);
    if let Some(check) = interactable.get("check").filter(|c| !c.is_null()) {
        effects.push(json!({ "kind": "check", "check": check }));
    } else if let Some(scene) = interactable.get("goto").filter(|g| !g.is_null()) {
        effects.push(json!({ "kind": "goto", "scene": scene }));
    } else if own.is_empty() {
        return effects;
    }
    effects.push(json!({ "kind": "markUsed", "interactable": interactable["id"] }));
    effects
}

/// The line shown for a thing that does nothing at all.
pub fn describe(interactable: &Value) -> String {
    let (flavor, name) = (text(interactable, "flavor"), text(interactable, "name"));
    if !flavor.is_empty() {
        flavor.to_string()
    } else if !name.is_empty() {
        format!("{name}. Nothing happens.")
    } else {
        "Nothing happens.".into()
    }
}

/// Use an interactable (`useInteractable`). A bare `open` or `markUsed` in what it runs means this thing.
pub fn use_interactable<'a, W: ScriptWorld + ?Sized>(interactable: &Value, world: &'a mut W, rng: &'a mut Rng, repeatable: bool) -> UseResult<'a, W> {
    let id = text(interactable, "id");
    let state = world.interactable_state(id);
    let effects = match decide(interactable, state, &mut |key| world.has_key(key), repeatable) {
        Ok(effects) => effects,
        Err(refused) => return UseResult::Refused(refused),
    };
    let options = RunnerOptions { subject: Some(id.to_string()), ..RunnerOptions::default() };
    let mut runner = ScriptRunner::new(world, rng, &options);
    match runner.run(&effects) {
        RunStatus::Waiting(prompt) => UseResult::Waiting(prompt, runner),
        RunStatus::Done => UseResult::Done(runner),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flavour_alone_is_not_used_up() {
        let inscription = json!({ "id": "stone", "name": "A stone", "flavor": "Words, worn away.", "effects": [] });
        assert_eq!(opening_effects(&inscription), [json!({ "kind": "log", "text": "Words, worn away.", "tone": "narration" })]);
        let bare = json!({ "id": "stone", "name": "A stone", "flavor": "", "effects": [] });
        assert!(opening_effects(&bare).is_empty());
        assert_eq!(describe(&bare), "A stone. Nothing happens.");
        let stair = json!({ "id": "stair", "flavor": "", "effects": [], "goto": "pit" });
        assert_eq!(opening_effects(&stair), [json!({ "kind": "goto", "scene": "pit" }), json!({ "kind": "markUsed", "interactable": "stair" })]);
    }
}
