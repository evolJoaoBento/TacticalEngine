//! Evaluating a condition (`src/engine/script/conditions.ts`): a walk over the condition that asks its
//! context - the world - what it needs to know, in the TypeScript's order and with its short-circuits, so a
//! recorded context holds this walk to the TypeScript's question for question until the world is ported.
//! Total: an unknown variable reads as `null`, a creature that is not there as nothing, and a hook nobody
//! defined as false - never a crash.

use crate::rules::duality::RollOutcome;
use crate::rules::range::{reaches, RangeBand};
use crate::scene::state::{EncounterState, Faction};
use crate::script::marks::mark_key;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// A roll the script is reading: its total and outcome, what it was tagged, the trait it used.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct BoundRoll {
    pub total: f64,
    pub outcome: Option<RollOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, rename = "trait", skip_serializing_if = "Option::is_none")]
    pub trait_: Option<String>,
}

/// What an effect or condition is bound to: the creatures aimed at, the ones the last roll hit, the
/// counts kept, the roll being read, the tile aimed at.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TargetBindings {
    pub targets: Vec<String>,
    pub hit: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counts: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roll: Option<BoundRoll>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub point: Option<i32>,
}

/// A count by name: the one the bindings carry, or nothing at all.
pub fn count_of(bindings: &TargetBindings, name: &str) -> f64 {
    bindings.counts.as_ref().and_then(|c| c.get(name)).and_then(Value::as_f64).unwrap_or(0.0)
}

/// An interactable's state, as a condition reads it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InteractableState {
    pub used: bool,
    pub open: bool,
    pub removed: bool,
}

/// What a hook is handed when it is asked a question: its arguments, and the scene as the question saw it -
/// with the bindings whole, which `ctx.select` reads selectors against.
#[derive(Clone, Debug, PartialEq)]
pub struct HookReads {
    pub args: Value,
    pub actor: Option<String>,
    pub targets: Vec<String>,
    pub hit: Vec<String>,
    pub in_combat: bool,
    pub bindings: TargetBindings,
}

/// What a condition is evaluated against. Conditions never change it; the `&mut` is for a context that
/// keeps a record of what it was asked.
pub trait ConditionContext {
    fn has_flag(&mut self, flag: &str) -> bool;
    fn has_key(&mut self, key: &str) -> bool;
    fn has_item(&mut self, item: &str, quantity: f64) -> bool;
    /// A scenario variable: a string, number, boolean, or `null` when never set.
    fn get_var(&mut self, name: &str) -> Value;
    fn interactable_state(&mut self, id: &str) -> InteractableState;
    fn encounter_state(&mut self, id: &str) -> EncounterState;
    fn count_alive(&mut self, faction: Faction) -> f64;
    /// Where a quest stands; `inactive` when nothing has started it.
    fn quest_status(&mut self, quest: &str) -> String;
    fn objective_done(&mut self, quest: &str, objective: &str) -> bool;
    /// The acting creature, if there is one.
    fn actor_id(&mut self) -> Option<String>;
    /// The living creatures a selector names, in a stable order.
    fn resolve_targets(&mut self, selector: &Value, bindings: &TargetBindings) -> Vec<String>;
    fn in_combat(&mut self) -> bool;
    /// How many of a domain's cards sit in a character's loadout.
    fn loadout_domain(&mut self, id: &str, domain: &str) -> Option<f64>;
    fn has_condition(&mut self, id: &str, condition: &str) -> bool;
    /// A pool on a creature, or nothing for a creature that is not there.
    fn pool_value(&mut self, id: &str, pool: &str, measure: &str) -> Option<f64>;
    /// The range band between two creatures, or nothing when either is off the map.
    fn band_to(&mut self, from: &str, to: &str) -> Option<RangeBand>;
    /// Which side a creature is on, or nothing for one that is not in the scene.
    fn faction_of(&mut self, id: &str) -> Option<Faction>;
    /// Whether a hook of this id is defined.
    fn hook_defined(&mut self, id: &str) -> bool;
    /// Ask a hook: true only when it answered `true` and did not throw.
    fn run_hook(&mut self, id: &str, reads: &HookReads) -> bool;
    /// Tokens sitting on a card a creature holds.
    fn tokens_on(&mut self, id: &str, ability: &str) -> f64;
}

/// The dice a `chance` rolls, and the amount of times it rolls them.
pub trait DiceHand {
    /// The total of an expression thrown once.
    fn roll(&mut self, dice: &str) -> f64;
    /// An amount read the way the script reads one - tokens, a trait, a count.
    fn amount(&mut self, amount: &Value) -> f64;
}

/// JavaScript's `===` between two script values: numbers by value, strings and booleans alike, `null` only
/// equal to `null`.
fn strictly_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::String(a), Value::String(b)) => a == b,
        (Value::Bool(a), Value::Bool(b)) => a == b,
        (Value::Null, Value::Null) => true,
        _ => false,
    }
}

/// Compare two script values. Ordering only makes sense between numbers; anything else is false rather
/// than a coercion surprise.
pub fn compare(left: &Value, op: &str, right: &Value) -> bool {
    match op {
        "==" => strictly_equal(left, right),
        "!=" => !strictly_equal(left, right),
        _ => {
            let (Some(l), Some(r)) = (left.as_f64().filter(|_| left.is_number()), right.as_f64().filter(|_| right.is_number())) else { return false };
            match op {
                "<" => l < r,
                "<=" => l <= r,
                ">" => l > r,
                ">=" => l >= r,
                _ => false,
            }
        }
    }
}

fn text<'a>(condition: &'a Value, key: &str) -> &'a str {
    condition[key].as_str().unwrap_or_default()
}

/// A selector, or the one a condition reads when it names none.
fn or_default(condition: &Value, key: &str, default: &str) -> Value {
    condition.get(key).cloned().unwrap_or_else(|| json!({ "kind": default }))
}

/// Evaluate a condition, already read by the script's schema. The context answers for the world and, when
/// `dice` allows it, for the dice a `chance` throws - one object, since reading an amount of dice is itself
/// a read of the world. Without dice, a `chance` is false.
pub fn evaluate<C: ConditionContext + DiceHand + ?Sized>(condition: &Value, context: &mut C, bindings: &TargetBindings, dice: bool) -> bool {
    let op = text(condition, "op");
    let value = &condition["value"];
    match text(condition, "kind") {
        "always" => true,
        "never" => false,
        "not" => !evaluate(&condition["of"], context, bindings, dice),
        "all" => condition["of"].as_array().into_iter().flatten().all(|c| evaluate(c, context, bindings, dice)),
        "any" => condition["of"].as_array().into_iter().flatten().any(|c| evaluate(c, context, bindings, dice)),
        "chance" => {
            if !dice {
                return false;
            }
            let times = match condition.get("times") {
                None => 1.0,
                Some(amount) => context.amount(amount),
            };
            let at_least = condition["atLeast"].as_f64().unwrap_or(0.0);
            let mut i = 0.0;
            while i < times {
                if context.roll(text(condition, "dice")) >= at_least {
                    return true;
                }
                i += 1.0;
            }
            false
        }
        "flag" => context.has_flag(text(condition, "flag")),
        "hasItem" => context.has_item(text(condition, "item"), condition["quantity"].as_f64().unwrap_or(1.0)),
        "hasKey" => context.has_key(text(condition, "key")),
        "var" => compare(&context.get_var(text(condition, "name")), op, value),
        "interactable" => {
            let state = context.interactable_state(text(condition, "id"));
            match text(condition, "state") {
                "used" => state.used,
                "open" => state.open,
                _ => state.removed,
            }
        }
        "encounter" => {
            let state = context.encounter_state(text(condition, "id"));
            match text(condition, "state") {
                "started" => state.started,
                "ended" => state.ended,
                _ => state.triggered,
            }
        }
        "quest" => context.quest_status(text(condition, "quest")) == text(condition, "status"),
        "objectiveDone" => context.objective_done(text(condition, "quest"), text(condition, "objective")),
        "partyAlive" => compare(&json!(context.count_alive(Faction::Party)), op, value),
        "adversariesAlive" => compare(&json!(context.count_alive(Faction::Adversary)), op, value),
        "pool" => {
            // The first creature the selector names; "the actor" for a card's own cost.
            let Some(id) = context.resolve_targets(&or_default(condition, "of", "actor"), bindings).into_iter().next() else { return false };
            let measure = condition.get("measure").and_then(Value::as_str).unwrap_or("available");
            context.pool_value(&id, text(condition, "pool"), measure).is_some_and(|held| compare(&json!(held), op, value))
        }
        // `spent` is written into a copy of the effects before they run, so a gate asking for it asks about
        // nothing: a quiet zero.
        "count" => {
            let of = text(condition, "of");
            compare(&json!(if of == "spent" { 0.0 } else { count_of(bindings, of) }), op, value)
        }
        "rollTagged" => bindings.roll.as_ref().and_then(|r| r.tags.as_ref()).is_some_and(|tags| tags.iter().any(|t| t == text(condition, "tag"))),
        "rolledWith" => bindings.roll.as_ref().and_then(|r| r.trait_.as_deref()) == Some(text(condition, "trait")),
        "hasMark" => match context.actor_id() {
            None => false,
            Some(actor) => !context.get_var(&mark_key(text(condition, "mark"), &actor)).is_null(),
        },
        "rolled" => {
            use RollOutcome::*;
            let Some(outcome) = bindings.roll.as_ref().and_then(|r| r.outcome) else { return false };
            match text(condition, "is") {
                "failure" => matches!(outcome, FailureWithGood | FailureWithBad),
                "success" => !matches!(outcome, FailureWithGood | FailureWithBad),
                "withBad" => matches!(outcome, SuccessWithBad | FailureWithBad),
                "withGood" => matches!(outcome, SuccessWithGood | FailureWithGood | CriticalSuccess),
                _ => outcome == CriticalSuccess,
            }
        }
        "inCombat" => context.in_combat(),
        "loadout" => {
            let Some(who) = context.resolve_targets(&or_default(condition, "of", "actor"), bindings).into_iter().next() else { return false };
            context.loadout_domain(&who, text(condition, "domain")).is_some_and(|held| compare(&json!(held), op, value))
        }
        "hasCondition" => {
            let ids = context.resolve_targets(&or_default(condition, "of", "target"), bindings);
            ids.iter().any(|id| context.has_condition(id, text(condition, "condition")))
        }
        "nearby" => {
            let many = context.resolve_targets(&condition["of"], bindings).len() as f64;
            if value.is_number() {
                return compare(&json!(many), op, value);
            }
            // Against a pool of somebody's: the actor's unless the gate says whose.
            let Some(who) = context.resolve_targets(&or_default(value, "of", "actor"), bindings).into_iter().next() else { return false };
            let measure = value.get("measure").and_then(Value::as_str).unwrap_or("marked");
            context.pool_value(&who, text(value, "pool"), measure).is_some_and(|held| compare(&json!(many), op, &json!(held)))
        }
        "tokens" => {
            let ids = context.resolve_targets(&or_default(condition, "of", "actor"), bindings);
            ids.iter().any(|id| {
                let held = context.tokens_on(id, text(condition, "ability"));
                compare(&json!(held), op, value)
            })
        }
        "hook" => {
            // A hook nobody defined is false, not a crash: content outlives the code that backed it.
            let id = text(condition, "hook");
            if !context.hook_defined(id) {
                return false;
            }
            // What a hook reads is gathered first, as the TypeScript gathers it: the actor, then the fight.
            let actor = context.actor_id();
            let in_combat = context.in_combat();
            let reads = HookReads { args: condition.get("args").cloned().unwrap_or_else(|| json!({})), actor, targets: bindings.targets.clone(), hit: bindings.hit.clone(), in_combat, bindings: bindings.clone() };
            context.run_hook(id, &reads)
        }
        "self" => {
            let Some(actor) = context.actor_id() else { return false };
            let named = context.resolve_targets(&or_default(condition, "of", "target"), bindings);
            !named.is_empty() && named.iter().all(|id| *id == actor)
        }
        "side" => {
            let actor = context.actor_id();
            let Some(mine) = actor.and_then(|a| context.faction_of(&a)) else { return false };
            let want = match (text(condition, "is"), mine) {
                ("ally", mine) => mine,
                (_, Faction::Party) => Faction::Adversary,
                _ => Faction::Party,
            };
            let named = context.resolve_targets(&or_default(condition, "of", "target"), bindings);
            !named.is_empty() && named.iter().all(|id| context.faction_of(id) == Some(want))
        }
        "withinRange" => {
            let Some(actor) = context.actor_id() else { return false };
            let range = RangeBand::from_name(text(condition, "range")).unwrap_or(RangeBand::Melee);
            let named = context.resolve_targets(&or_default(condition, "of", "target"), bindings);
            named.iter().any(|id| context.band_to(&actor, id).is_some_and(|band| reaches(band, range)))
        }
        _ => false,
    }
}

/// An omitted condition means "yes".
pub fn evaluate_optional<C: ConditionContext + DiceHand + ?Sized>(condition: Option<&Value>, context: &mut C, bindings: &TargetBindings, dice: bool) -> bool {
    condition.is_none_or(|c| evaluate(c, context, bindings, dice))
}

/// Every variable name a condition reads, in the order a `Set` keeps them - for an editor to offer.
pub fn variables_used(condition: &Value, into: &mut Vec<String>) {
    match text(condition, "kind") {
        "var" => {
            let name = text(condition, "name").to_string();
            if !into.contains(&name) {
                into.push(name);
            }
        }
        "not" => variables_used(&condition["of"], into),
        "all" | "any" => {
            for inner in condition["of"].as_array().into_iter().flatten() {
                variables_used(inner, into);
            }
        }
        _ => {}
    }
}
