//! Logic in code, for the things data cannot say (`src/engine/script/hooks.ts`): what a hook is handed and
//! how it is asked, as the engine sees it. A hook is JavaScript a project carries (`project.code[]`),
//! reached from the one vocabulary by `{ kind: 'run', hook }` and `{ kind: 'hook', hook }`; it reads the
//! world through its `ctx` - pools, conditions, bands, selectors, flags, variables, sides, tokens - rolls
//! only off the scenario's stream, and changes nothing itself: it queues effects the runner then runs.
//!
//! Running the JavaScript is not the engine's: the engine builds to WebAssembly and stays free of any
//! JavaScript engine. Whoever builds a world hands it a `Hooks` - `NoHooks` for a project with no code,
//! the QuickJS one in the `tactical-hooks` crate for the server - and the world lends each hook a
//! `HookReader` over itself while it runs.

use crate::rng::Rng;
use crate::rules::range::RangeBand;
use crate::scene::state::Faction;
use crate::script::conditions::HookReads;
use crate::script::runner::{HookRun, LastRoll};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One project-code entry, as `project.code[]` holds it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodeSource {
    pub id: String,
    pub name: String,
    pub source: String,
}

/// A piece of project code that would not compile.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookIssue {
    pub id: String,
    pub message: String,
}

/// Names a hook body must not reach: declared as its parameters and passed `undefined`, so `Date.now()`
/// inside a hook is a TypeError the author sees at once rather than a replay that quietly diverges.
pub const SHADOWED: [&str; 24] = [
    "globalThis",
    "window",
    "self",
    "document",
    "navigator",
    "location",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "Date",
    "console",
    "process",
    "require",
    "module",
    "exports",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "crypto",
    "performance",
    "Function",
];

/// What a hook may read of the world while it runs: `ctx.pool`, `ctx.hasCondition` and the rest, each the
/// world's own answer, with `select` reading selectors against the bindings the hook was run under.
pub trait HookReader {
    /// A pool on a creature, `available`, `marked` or `max`; nothing for a creature not there. A pool no
    /// creature has is the TypeError the TypeScript's world throws reading it, its words the engine's.
    fn pool(&mut self, id: &str, pool: &str, measure: &str) -> Result<Option<f64>, String>;
    fn has_condition(&mut self, id: &str, condition: &str) -> bool;
    fn band_to(&mut self, from: &str, to: &str) -> Option<RangeBand>;
    fn difficulty_of(&mut self, id: &str) -> Option<f64>;
    fn select(&mut self, selector: &Value) -> Vec<String>;
    fn flag(&mut self, name: &str) -> bool;
    fn variable(&mut self, name: &str) -> Value;
    /// The living on a side, by the side's name: `party`, `adversary`, or `neutral`.
    fn count_alive(&mut self, faction: &str) -> f64;
    fn faction_of(&mut self, id: &str) -> Option<Faction>;
    fn tokens(&mut self, id: &str, ability: &str) -> f64;
}

/// Hooks by id. Asked through `&self`, so a hook a hook's read reaches - a modifier gated on one, read
/// while a hook asks a Difficulty - is run like any other.
pub trait Hooks {
    fn defined(&self, id: &str) -> bool;
    /// Asked as a condition: whether it answered `true`. Only asked of a hook `defined` said was there.
    fn run(&self, id: &str, reads: &HookReads, world: &mut dyn HookReader) -> bool;
    /// Run as an effect: it may throw dice off the stream, and queues effects.
    fn run_effect(&self, id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: &mut Rng, world: &mut dyn HookReader) -> HookRun;
}

/// A hook's read, answered (`hookReads` in the prelude both hosts run): the arguments as the hook passed
/// them, as JSON, and the world's answer as JSON - or none, for the `undefined` a selector of no kind the
/// world knows comes back as. A read the world cannot make is `{ "__thrown": "TypeError", "message" }`,
/// which the prelude throws where the hook made it. QuickJS on the server and the page's own JavaScript in
/// front of the engine built to WebAssembly both answer through this.
pub fn answer_read(world: &mut dyn HookReader, name: &str, args: &str) -> Option<String> {
    let args: Vec<Value> = serde_json::from_str(args).unwrap_or_default();
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    // An id that is not a string names nobody, as a `Map` keyed by strings finds nothing for it.
    let id = |i: usize| arg(i).as_str().map(str::to_string);
    // What the TypeScript builds a key from, or indexes an object with, is read as text.
    let text = |i: usize| match arg(i) {
        Value::String(s) => s,
        Value::Number(n) => crate::js::number_to_string(n.as_f64().unwrap_or(f64::NAN)),
        Value::Null => "null".into(),
        other => other.to_string(),
    };
    let out = match name {
        "pool" => match id(0).map(|id| world.pool(&id, &text(1), &text(2))) {
            None => Value::Null,
            Some(Ok(value)) => serde_json::json!(value),
            Some(Err(message)) => serde_json::json!({ "__thrown": "TypeError", "message": message }),
        },
        "hasCondition" => serde_json::json!(id(0).is_some_and(|id| world.has_condition(&id, &text(1)))),
        "bandTo" => match (id(0), id(1)) {
            (Some(from), Some(to)) => serde_json::json!(world.band_to(&from, &to)),
            _ => Value::Null,
        },
        "difficultyOf" => serde_json::json!(id(0).and_then(|id| world.difficulty_of(&id))),
        "select" => {
            const KINDS: [&str; 9] = ["actor", "party", "entity", "entities", "target", "hit", "allies", "inPath", "adversaries"];
            let selector = arg(0);
            if !selector.get("kind").and_then(Value::as_str).is_some_and(|k| KINDS.contains(&k)) {
                return None;
            }
            serde_json::json!(world.select(&selector))
        }
        "flag" => serde_json::json!(id(0).is_some_and(|name| world.flag(&name))),
        "variable" => world.variable(&text(0)),
        "countAlive" => serde_json::json!(id(0).map_or(0.0, |side| world.count_alive(&side))),
        "factionOf" => serde_json::json!(id(0).and_then(|id| world.faction_of(&id))),
        "tokens" => serde_json::json!(world.tokens(&text(0), &text(1))),
        _ => return None,
    };
    Some(out.to_string())
}

/// A project with no code: nothing is defined.
pub struct NoHooks;

impl Hooks for NoHooks {
    fn defined(&self, _id: &str) -> bool {
        false
    }
    fn run(&self, _id: &str, _reads: &HookReads, _world: &mut dyn HookReader) -> bool {
        false
    }
    fn run_effect(&self, id: &str, _reads: &HookReads, _last_roll: Option<LastRoll>, _rng: &mut Rng, _world: &mut dyn HookReader) -> HookRun {
        HookRun { ok: false, message: format!("no hook \"{id}\""), queued: Vec::new() }
    }
}

/// The code in `incoming` that `known` does not already run, word for word: new ids, and old ids whose
/// text has changed - what Import pack and Load ask about.
pub fn unfamiliar_code<'a>(incoming: &'a [CodeSource], known: &[CodeSource]) -> Vec<&'a CodeSource> {
    incoming.iter().filter(|entry| !known.iter().any(|k| k.id == entry.id && k.source == entry.source)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(id: &str, source: &str) -> CodeSource {
        CodeSource { id: id.into(), name: id.into(), source: source.into() }
    }

    #[test]
    fn only_code_not_already_run_is_unfamiliar() {
        let known = [code("a", "return 1"), code("b", "return 2")];
        let incoming = [code("a", "return 1"), code("b", "return 3"), code("c", "return 1")];
        let ids: Vec<&str> = unfamiliar_code(&incoming, &known).into_iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["b", "c"]);
    }
}
