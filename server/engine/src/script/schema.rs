//! The one effect vocabulary (`src/engine/script/schema.ts`): who an effect is aimed at (target
//! selectors), what must hold (conditions), and what happens (effects) - written against `crate::zod`
//! field for field in the TypeScript's order, so a script reads as zod reads it, word for word. Effects,
//! conditions and checks hold one another, so each is reached through a `lazy` reference to itself.
//!
//! What a script *does* is the runner's, which comes next; this is the shape it is written in, and the
//! walks that visit every effect and condition inside one.

use crate::zod::*;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

const TRAITS: &[&str] = &["agility", "strength", "finesse", "instinct", "presence", "knowledge"];
const RANGE_BANDS: &[&str] = &["melee", "veryClose", "close", "far", "veryFar", "outOfRange"];
const POOLS: &[&str] = &["hitPoints", "stress", "armorSlots", "good"];
const MEASURES: &[&str] = &["available", "marked", "max"];
const COMPARE: &[&str] = &["==", "!=", "<", "<=", ">", ">="];
const DAMAGE_TYPES: &[&str] = &["physical", "magic"];
/// The counts a script keeps, and what the last spend spent.
pub const COUNT_NAMES: [&str; 3] = ["hitPointsTaken", "hitPointsDealt", "targetsHit"];
const COUNTS: &[&str] = &["hitPointsTaken", "hitPointsDealt", "targetsHit", "spent"];

fn kind(k: &'static str) -> Field {
    req("kind", literal(json!(k)))
}

fn words() -> Schema {
    string().min(1.0)
}

fn int_value() -> Field {
    req("value", int())
}

fn op() -> Field {
    req("op", one_of(COMPARE))
}

fn target() -> Schema {
    lazy(target_selector)
}

fn effects() -> Schema {
    array(lazy(effect))
}

fn traits_or(extra: &'static str) -> Schema {
    union(vec![one_of(TRAITS), literal(json!("spellcast")), literal(json!(extra))])
}

/// `hookArgsSchema`: named values content hands a hook.
fn hook_args() -> Schema {
    record(words(), union(vec![string(), number(), boolean()]))
}

/// `scriptValueSchema`: what a script variable holds.
fn script_value() -> Schema {
    union(vec![string(), number(), boolean(), null()])
}

/// A pool read off a creature.
fn pool_read() -> Schema {
    object(vec![req("pool", one_of(POOLS)), opt("of", target()), opt("measure", one_of(MEASURES))])
}

/// `amountReadSchema`: a number read off the scene - a pool, a count of creatures, dice, tokens, a trait.
fn amount_read() -> Schema {
    union(vec![
        pool_read(),
        object(vec![req("count", target())]),
        object(vec![req("dice", words()), opt("using", literal(json!("proficiency"))), opt("pick", literal(json!("highest")))]),
        object(vec![req("tokens", content_id()), opt("of", target())]),
        object(vec![req("trait", traits_or("proficiency")), opt("of", target()), opt("times", int().positive())]),
    ])
}

/// `amountSchema`: a positive whole number, a count by name, or a read.
fn amount() -> Schema {
    union(vec![int().positive(), one_of(COUNTS), amount_read()])
}

pub fn target_selector() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let around = || opt("around", one_of(&["actor", "target", "point"]));
        let nearest = || opt("nearest", int().positive());
        tagged(
            "kind",
            vec![
                ("actor", object(vec![kind("actor")])),
                ("party", object(vec![kind("party")])),
                ("entity", object(vec![kind("entity"), req("id", words())])),
                ("entities", object(vec![kind("entities"), req("ids", array(words()))])),
                ("target", object(vec![kind("target")])),
                ("hit", object(vec![kind("hit"), opt("having", words()), nearest()])),
                (
                    "allies",
                    object(vec![kind("allies"), opt("range", one_of(RANGE_BANDS)), around(), opt("includeSelf", boolean()), opt("except", one_of(&["target"])), nearest()]),
                ),
                (
                    "inPath",
                    object(vec![kind("inPath"), opt("range", one_of(RANGE_BANDS)), opt("reach", literal(json!("weapon"))), opt("side", one_of(&["adversaries", "allies"]))]),
                ),
                (
                    "adversaries",
                    object(vec![
                        kind("adversaries"),
                        req("range", one_of(RANGE_BANDS)),
                        opt("reach", literal(json!("weapon"))),
                        around(),
                        opt("except", one_of(&["target", "actor"])),
                        nearest(),
                        opt("sameKind", boolean()),
                    ]),
                ),
            ],
        )
    })
}

pub fn condition() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let of = || opt("of", target());
        tagged(
            "kind",
            vec![
                ("always", object(vec![kind("always")])),
                ("never", object(vec![kind("never")])),
                ("not", object(vec![kind("not"), req("of", lazy(condition))])),
                ("all", object(vec![kind("all"), req("of", array(lazy(condition)))])),
                ("any", object(vec![kind("any"), req("of", array(lazy(condition)))])),
                ("count", object(vec![kind("count"), req("of", one_of(COUNTS)), op(), int_value()])),
                ("flag", object(vec![kind("flag"), req("flag", words())])),
                ("hasKey", object(vec![kind("hasKey"), req("key", words())])),
                ("hasItem", object(vec![kind("hasItem"), req("item", content_id()), opt("quantity", int().positive())])),
                ("var", object(vec![kind("var"), req("name", words()), op(), req("value", script_value())])),
                ("interactable", object(vec![kind("interactable"), req("id", words()), req("state", one_of(&["used", "open", "removed"]))])),
                ("encounter", object(vec![kind("encounter"), req("id", words()), req("state", one_of(&["started", "ended", "triggered"]))])),
                ("quest", object(vec![kind("quest"), req("quest", content_id()), req("status", one_of(&["inactive", "active", "completed", "failed"]))])),
                ("objectiveDone", object(vec![kind("objectiveDone"), req("quest", content_id()), req("objective", content_id())])),
                ("partyAlive", object(vec![kind("partyAlive"), op(), int_value()])),
                ("adversariesAlive", object(vec![kind("adversariesAlive"), op(), int_value()])),
                ("pool", object(vec![kind("pool"), req("pool", one_of(POOLS)), of(), opt("measure", one_of(MEASURES)), op(), int_value()])),
                ("rolled", object(vec![kind("rolled"), req("is", one_of(&["failure", "success", "withBad", "withGood", "critical"]))])),
                ("rollTagged", object(vec![kind("rollTagged"), req("tag", words())])),
                ("hasMark", object(vec![kind("hasMark"), req("mark", content_id())])),
                ("rolledWith", object(vec![kind("rolledWith"), req("trait", traits_or("weapon"))])),
                ("chance", object(vec![kind("chance"), req("dice", words()), req("atLeast", int().positive()), opt("times", amount())])),
                ("inCombat", object(vec![kind("inCombat")])),
                ("loadout", object(vec![kind("loadout"), req("domain", content_id()), of(), op(), int_value()])),
                ("nearby", object(vec![kind("nearby"), req("of", target()), op(), req("value", union(vec![int(), pool_read()]))])),
                ("tokens", object(vec![kind("tokens"), req("ability", content_id()), of(), op(), int_value()])),
                ("hasCondition", object(vec![kind("hasCondition"), req("condition", words()), of()])),
                ("self", object(vec![kind("self"), of()])),
                ("side", object(vec![kind("side"), of(), req("is", one_of(&["ally", "adversary"]))])),
                ("withinRange", object(vec![kind("withinRange"), req("range", one_of(RANGE_BANDS)), of()])),
                ("hook", object(vec![kind("hook"), req("hook", content_id()), opt("args", hook_args())])),
            ],
        )
    })
}

/// An option in a `choice`.
pub fn choice_option() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| object(vec![req("label", words()), opt("detail", string()), opt("available", lazy(condition)), def("effects", effects(), || json!([]))]))
}

/// The fields of a check request, for a dialogue's check to extend.
pub fn check_request_fields() -> Vec<Field> {
    vec![
        req("trait", traits_or("weapon")),
        req("difficulty", union(vec![int().positive(), literal(json!("target"))])),
        opt("roll", literal(json!("last"))),
        opt("targets", target()),
        opt("tags", array(words())),
        opt("prompt", string()),
        opt("onCriticalSuccess", effects()),
        opt("onSuccessWithGood", effects()),
        opt("onSuccessWithBad", effects()),
        opt("onFailureWithGood", effects()),
        opt("onFailureWithBad", effects()),
        opt("always", effects()),
    ]
}

pub fn check_request() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| object(check_request_fields()))
}

/// `damage` and `heal` take exactly one of an amount or dice.
fn amount_or_dice(what: &'static str) -> Refine {
    match what {
        "damage" => |d: &Map<String, Value>, found: &mut Refinements| {
            if d.contains_key("amount") == d.contains_key("dice") {
                found.add(vec![], "damage needs exactly one of amount or dice".into());
            }
        },
        _ => |d: &Map<String, Value>, found: &mut Refinements| {
            if d.contains_key("amount") == d.contains_key("dice") {
                found.add(vec![], "heal needs exactly one of amount or dice".into());
            }
        },
    }
}

pub fn effect() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let at = || opt("target", target());
        let place = |k: &'static str| (k, object(vec![kind(k), opt("interactable", words())]));
        let quest = |k: &'static str| (k, object(vec![kind(k), req("quest", content_id())]));
        let objective = |k: &'static str| (k, object(vec![kind(k), req("quest", content_id()), req("objective", content_id())]));
        let by_amount = |k: &'static str| (k, object(vec![kind(k), opt("amount", amount())]));
        let aimed_amount = |k: &'static str| (k, object(vec![kind(k), opt("amount", amount()), at()]));
        let armor = |k: &'static str| (k, object(vec![kind(k), opt("amount", int().positive()), at()]));
        let bare = |k: &'static str| (k, object(vec![kind(k)]));
        let dice_or_amount = |k: &'static str| (k, object(vec![kind(k), opt("dice", words()), opt("amount", amount())]));
        tagged(
            "kind",
            vec![
                bare("none"),
                ("log", object(vec![kind("log"), req("text", string()), opt("tone", one_of(&["narration", "system", "good", "bad", "combat", "success"]))])),
                ("story", object(vec![kind("story"), req("title", string()), req("paragraphs", array(string())), opt("button", string())])),
                ("setFlag", object(vec![kind("setFlag"), req("flag", words())])),
                ("clearFlag", object(vec![kind("clearFlag"), req("flag", words())])),
                ("giveKey", object(vec![kind("giveKey"), req("key", words())])),
                ("addItem", object(vec![kind("addItem"), req("item", content_id()), opt("quantity", int().positive())])),
                ("removeItem", object(vec![kind("removeItem"), req("item", content_id()), opt("quantity", int().positive())])),
                ("setVar", object(vec![kind("setVar"), req("name", words()), req("value", script_value())])),
                ("addVar", object(vec![kind("addVar"), req("name", words()), req("by", number())])),
                place("open"),
                place("close"),
                place("toggleOpen"),
                place("openContainer"),
                ("teleport", object(vec![kind("teleport"), req("pair", words())])),
                place("remove"),
                place("markUsed"),
                ("loot", object(vec![kind("loot"), opt("table", content_id())])),
                (
                    "damage",
                    object(vec![
                        kind("damage"),
                        opt("amount", amount()),
                        opt("dice", words()),
                        opt("type", one_of(DAMAGE_TYPES)),
                        opt("using", one_of(&["proficiency", "halfProficiency", "spellcast"])),
                        opt("direct", boolean()),
                        opt("half", boolean()),
                        at(),
                        opt("source", string()),
                    ])
                    .refine(amount_or_dice("damage")),
                ),
                ("heal", object(vec![kind("heal"), opt("amount", amount()), opt("dice", words()), opt("spread", boolean()), at()]).refine(amount_or_dice("heal"))),
                ("startEncounter", object(vec![kind("startEncounter"), req("encounter", content_id()), opt("intro", string())])),
                ("endEncounter", object(vec![kind("endEncounter"), req("encounter", content_id())])),
                ("goto", object(vec![kind("goto"), req("scene", content_id())])),
                ("startDialogue", object(vec![kind("startDialogue"), req("dialogue", content_id())])),
                quest("startQuest"),
                objective("completeObjective"),
                quest("completeQuest"),
                objective("revealObjective"),
                quest("failQuest"),
                ("levelUp", object(vec![kind("levelUp"), opt("level", int().min(2.0).max(10.0))])),
                ("branch", object(vec![kind("branch"), req("when", lazy(condition)), req("then", effects()), opt("otherwise", effects())])),
                ("choice", object(vec![kind("choice"), opt("title", string()), opt("body", string()), req("options", array(lazy(choice_option)))])),
                ("check", object(vec![kind("check"), req("check", lazy(check_request))])),
                aimed_amount("markStress"),
                aimed_amount("clearStress"),
                armor("clearArmor"),
                armor("markArmor"),
                by_amount("gainBad"),
                by_amount("loseBad"),
                aimed_amount("gainGood"),
                by_amount("spendGood"),
                aimed_amount("loseGood"),
                (
                    "applyCondition",
                    object(vec![kind("applyCondition"), req("condition", words()), opt("duration", one_of(&["temporary", "scene", "rest", "permanent"])), at()]),
                ),
                ("clearCondition", object(vec![kind("clearCondition"), req("condition", words()), at()])),
                ("revive", object(vec![kind("revive"), at()])),
                ("slay", object(vec![kind("slay"), at()])),
                ("openShop", object(vec![kind("openShop"), opt("of", words())])),
                ("setAttitude", object(vec![kind("setAttitude"), req("attitude", one_of(&["friendly", "hostile"])), at()])),
                (
                    "attack",
                    object(vec![
                        kind("attack"),
                        opt("weapon", one_of(&["primary", "secondary"])),
                        opt("by", literal(json!("target"))),
                        at(),
                        opt("advantage", int()),
                        opt("damageBonus", int()),
                        opt("damageDice", words()),
                        opt("damage", words()),
                        opt("range", one_of(RANGE_BANDS)),
                        opt("direct", boolean()),
                        opt("joinedBy", target()),
                        opt("onHit", effects()),
                        opt("onMiss", effects()),
                    ]),
                ),
                ("addToken", object(vec![kind("addToken"), req("ability", content_id()), opt("amount", amount()), at()])),
                ("spendToken", object(vec![kind("spendToken"), req("ability", content_id()), opt("amount", amount()), opt("all", boolean()), at()])),
                ("push", object(vec![kind("push"), req("to", one_of(RANGE_BANDS)), at()])),
                (
                    "summon",
                    object(vec![kind("summon"), req("adversary", content_id()), opt("count", words()), opt("perPc", boolean()), opt("range", one_of(RANGE_BANDS)), opt("spotlight", boolean())]),
                ),
                ("replace", object(vec![kind("replace"), req("adversary", content_id()), opt("count", words()), opt("spotlight", boolean())])),
                (
                    "move",
                    object(vec![
                        kind("move"),
                        opt("who", target()),
                        opt("teleport", boolean()),
                        opt("how", one_of(&["toward", "away"])),
                        opt("of", target()),
                        opt("to", one_of(&["point", "mark"])),
                        opt("mark", content_id()),
                        opt("range", one_of(RANGE_BANDS)),
                        opt("budget", one_of(RANGE_BANDS)),
                    ]),
                ),
                ("spotlight", object(vec![kind("spotlight"), opt("targets", target()), opt("count", words()), opt("halfDamage", boolean())])),
                (
                    "boostDamage",
                    object(vec![kind("boostDamage"), opt("dice", words()), opt("amount", amount()), opt("times", amount()), opt("double", boolean()), opt("type", one_of(DAMAGE_TYPES))]),
                ),
                ("rerollDamage", object(vec![kind("rerollDamage"), req("below", int().positive())])),
                bare("nameRoll"),
                ("raiseRoll", object(vec![kind("raiseRoll"), req("amount", amount())])),
                ("markSpot", object(vec![kind("markSpot"), req("mark", content_id())])),
                ("forgetSpot", object(vec![kind("forgetSpot"), req("mark", content_id())])),
                ("rerollDuality", object(vec![kind("rerollDuality"), def("which", one_of(&["good", "bad", "both"]), || json!("both"))])),
                dice_or_amount("softenBlow"),
                bare("avoidBlow"),
                ("stepSeverity", object(vec![kind("stepSeverity"), opt("steps", int().positive())])),
                dice_or_amount("dodgeBy"),
                (
                    "diceCheck",
                    object(vec![
                        kind("diceCheck"),
                        req("dice", words()),
                        opt("times", amount()),
                        req("atLeast", int().positive()),
                        opt("needed", int().positive()),
                        req("then", effects()),
                        opt("otherwise", effects()),
                    ]),
                ),
                ("forceHitPoints", object(vec![kind("forceHitPoints"), req("amount", amount())])),
                ("forceSeverity", object(vec![kind("forceSeverity"), req("severity", one_of(&["minor", "major", "severe", "massive"])), opt("least", boolean())])),
                (
                    "howMany",
                    object(vec![kind("howMany"), req("most", amount()), opt("least", int().min(0.0)), opt("title", string()), opt("body", string()), req("each", effects())]),
                ),
                bare("endSpotlight"),
                bare("spotlightAgain"),
                bare("vaultCard"),
                bare("maxOneDie"),
                (
                    "zone",
                    object(vec![
                        kind("zone"),
                        req("zone", content_id()),
                        req("name", words()),
                        req("condition", words()),
                        opt("at", one_of(&["point", "actor"])),
                        req("band", one_of(RANGE_BANDS)),
                        opt("side", one_of(&["allies", "adversaries"])),
                        opt("onDeath", one_of(&["end", "keep"])),
                        opt("value", int().min(0.0)),
                        opt("grows", object(vec![req("by", int().positive()), req("until", int().positive())])),
                    ]),
                ),
                ("endZone", object(vec![kind("endZone"), req("zone", content_id())])),
                (
                    "countdown",
                    object(vec![
                        kind("countdown"),
                        req("countdown", content_id()),
                        req("name", words()),
                        req("start", words()),
                        opt("advance", one_of(&["standard", "attackRoll", "withBad", "hpMarked", "progress", "consequence"])),
                        opt("loop", one_of(&["reset", "increasing", "decreasing"])),
                        opt("onDeath", one_of(&["end", "trigger"])),
                        def("effects", effects(), || json!([])),
                    ]),
                ),
                ("run", object(vec![kind("run"), req("hook", content_id()), opt("args", hook_args())])),
                (
                    "reactionRoll",
                    object(vec![
                        kind("reactionRoll"),
                        req("difficulty", union(vec![int().positive(), literal(json!("roll"))])),
                        opt("trait", one_of(TRAITS)),
                        opt("targets", target()),
                        opt("damage", object(vec![req("dice", words()), opt("type", one_of(DAMAGE_TYPES))])),
                        opt("onFail", effects()),
                        opt("onSuccess", effects()),
                    ]),
                ),
            ],
        )
    })
}

fn list(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// `walkEffects`: every effect in a list and inside each, depth first, in the order they are written.
pub fn walk_effects(effects: &[Value], visit: &mut impl FnMut(&Value)) {
    for effect in effects {
        visit(effect);
        match effect["kind"].as_str().unwrap_or_default() {
            "branch" | "diceCheck" => {
                walk_effects(list(effect.get("then")), visit);
                walk_effects(list(effect.get("otherwise")), visit);
            }
            "choice" => {
                for option in list(effect.get("options")) {
                    walk_effects(list(option.get("effects")), visit);
                }
            }
            "check" => walk_check(&effect["check"], visit),
            "attack" => {
                walk_effects(list(effect.get("onHit")), visit);
                walk_effects(list(effect.get("onMiss")), visit);
            }
            "reactionRoll" => {
                walk_effects(list(effect.get("onFail")), visit);
                walk_effects(list(effect.get("onSuccess")), visit);
            }
            "countdown" => walk_effects(list(effect.get("effects")), visit),
            "howMany" => walk_effects(list(effect.get("each")), visit),
            _ => {}
        }
    }
}

const OUTCOMES: [&str; 6] = ["onCriticalSuccess", "onSuccessWithGood", "onSuccessWithBad", "onFailureWithGood", "onFailureWithBad", "always"];

/// `walkCheck`: every effect a check's outcomes run.
pub fn walk_check(check: &Value, visit: &mut impl FnMut(&Value)) {
    for outcome in OUTCOMES {
        walk_effects(list(check.get(outcome)), visit);
    }
}

/// `walkCondition`: a condition and every one inside it.
pub fn walk_condition(condition: &Value, visit: &mut impl FnMut(&Value)) {
    visit(condition);
    match condition["kind"].as_str().unwrap_or_default() {
        "not" => walk_condition(&condition["of"], visit),
        "all" | "any" => {
            for inner in list(condition.get("of")) {
                walk_condition(inner, visit);
            }
        }
        _ => {}
    }
}

/// `walkConditionsIn`: the conditions a list's branches test and its choices' options are gated on.
pub fn walk_conditions_in(effects: &[Value], visit: &mut impl FnMut(&Value)) {
    walk_effects(effects, &mut |effect| {
        match effect["kind"].as_str().unwrap_or_default() {
            "branch" => walk_condition(&effect["when"], visit),
            "choice" => {
                for option in list(effect.get("options")) {
                    if let Some(available) = option.get("available") {
                        walk_condition(available, visit);
                    }
                }
            }
            _ => {}
        }
    });
}

/// `walkConditionsInCheck`: the conditions inside a check's outcomes.
pub fn walk_conditions_in_check(check: &Value, visit: &mut impl FnMut(&Value)) {
    for outcome in OUTCOMES {
        walk_conditions_in(list(check.get(outcome)), visit);
    }
}
