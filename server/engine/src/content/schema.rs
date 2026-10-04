//! The content schemas (`src/engine/content/pack/schema.ts`, `abilities.ts`, `conditions.ts`, `items.ts`,
//! `quests.ts`, and the scene's `codeSchema`), written against `crate::zod` field for field and check for
//! check, in the TypeScript's order, so a reading reports what zod reports. Conditions and effects are
//! `script/`'s schemas (`crate::script::schema`), read in full.

use crate::script::schema as script;
use crate::zod::*;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

const TRAITS: &[&str] = &["agility", "strength", "finesse", "instinct", "presence", "knowledge"];
const RANGE_BANDS: &[&str] = &["melee", "veryClose", "close", "far", "veryFar", "outOfRange"];
const DAMAGE_TYPES: &[&str] = &["physical", "magic"];

fn empty_list() -> Value {
    json!([])
}
fn empty_text() -> Value {
    json!("")
}

fn feature() -> Schema {
    object(vec![req("name", string()), req("text", string())])
}

fn features() -> Field {
    def("features", array(feature()), empty_list)
}

fn dice_fields() -> Vec<Field> {
    vec![req("count", int().min(0.0)), req("sides", int().min(0.0)), req("modifier", int())]
}

fn dice_expression() -> Schema {
    object(dice_fields())
}

fn parsed_damage() -> Schema {
    let mut fields = dice_fields();
    fields.push(opt("types", array(one_of(DAMAGE_TYPES))));
    object(fields)
}

fn thresholds() -> Schema {
    object(vec![req("major", int().min(0.0)), req("severe", int().min(0.0))])
}

fn name() -> Field {
    req("name", string().min(1.0))
}

fn weapon() -> Schema {
    object(vec![
        req("id", content_id()),
        name(),
        req("tier", int().min(1.0)),
        req("slot", one_of(&["primaryPhysical", "primaryMagic", "secondary"])),
        req("trait", union(vec![one_of(TRAITS), literal(json!("spellcast"))])),
        req("range", one_of(RANGE_BANDS)),
        req("damage", parsed_damage()),
        req("burden", one_of(&["oneHanded", "twoHanded"])),
        features(),
    ])
}

fn armor() -> Schema {
    object(vec![req("id", content_id()), name(), req("tier", int().min(1.0)), req("baseThresholds", thresholds()), req("baseScore", int().min(0.0)), features()])
}

fn class() -> Schema {
    object(vec![
        req("id", content_id()),
        name(),
        def("domains", array(string().min(1.0)), empty_list),
        req("startingEvasion", int().min(0.0)),
        req("startingHitPoints", int().min(1.0)),
    ])
}

fn ancestry() -> Schema {
    object(vec![req("id", content_id()), name()])
}

fn subclass() -> Schema {
    object(vec![
        req("id", content_id()),
        name(),
        req("classId", content_id()),
        def("domains", array(string().min(1.0)), empty_list),
        opt("spellcastTrait", one_of(TRAITS)),
    ])
}

fn card_grant() -> Schema {
    let kind = |k: &'static str| req("kind", literal(json!(k)));
    tagged(
        "kind",
        vec![
            ("chosen", object(vec![kind("chosen")])),
            ("class", object(vec![kind("class"), req("classId", content_id())])),
            ("subclass", object(vec![kind("subclass"), req("subclassId", content_id()), req("stage", one_of(&["foundation", "specialization", "mastery"]))])),
            ("ancestry", object(vec![kind("ancestry"), req("ancestryId", content_id())])),
            ("community", object(vec![kind("community"), req("communityId", content_id())])),
            ("given", object(vec![kind("given"), req("characters", array(content_id()))])),
            ("adversary", object(vec![kind("adversary"), req("adversaries", array(content_id()))])),
            ("condition", object(vec![kind("condition"), req("conditions", array(content_id()))])),
        ],
    )
}

/// A chosen card needs everything a domain card has.
fn chosen_card_is_whole(card: &Map<String, Value>, found: &mut Refinements) {
    if card.get("grant").and_then(|g| g.get("kind")) != Some(&json!("chosen")) {
        return;
    }
    for field in ["domain", "type", "level", "recallCost"] {
        if !card.contains_key(field) {
            found.add(vec![Key::Name(field.into())], format!("a chosen card needs a {field}"));
        }
    }
}

fn card() -> Schema {
    object(vec![
        req("id", content_id()),
        name(),
        def("grant", card_grant(), || json!({ "kind": "chosen" })),
        opt("domain", string().min(1.0)),
        opt("type", one_of(&["ability", "spell", "grimoire"])),
        opt("level", int().min(1.0)),
        opt("recallCost", int().min(0.0)),
        def("text", string(), empty_text),
        features(),
    ])
    .refine(chosen_card_is_whole)
}

fn experience() -> Schema {
    object(vec![req("name", string().min(1.0)), req("modifier", int())])
}

fn adversary_feature() -> Schema {
    object(vec![
        req("name", string().min(1.0)),
        req("kind", one_of(&["passive", "action", "reaction"])),
        opt("parameter", string()),
        opt("countdown", string()),
        opt("longTermCountdown", boolean()),
        def("text", string(), empty_text),
        def("costsGmResource", boolean(), || json!(false)),
    ])
}

fn adversary() -> Schema {
    object(vec![
        req("id", content_id()),
        name(),
        req("tier", union(vec![literal(json!(1)), literal(json!(2)), literal(json!(3)), literal(json!(4))])),
        req("role", one_of(&["bruiser", "horde", "leader", "minion", "ranged", "skulk", "social", "solo", "standard", "support"])),
        opt("hordeUnitsPerHp", int().min(1.0)),
        def("description", string(), empty_text),
        def("motivesAndTactics", string(), empty_text),
        req("difficulty", int().min(1.0)),
        req("thresholds", thresholds()),
        req("hitPoints", int().min(1.0)),
        req("stress", int().min(0.0)),
        req("attackName", string().min(1.0)),
        req("attackModifier", dice_expression()),
        req("attackRange", one_of(RANGE_BANDS)),
        req("attackDamage", parsed_damage()),
        def("experiences", array(experience()), empty_list),
        def("features", array(adversary_feature()), empty_list),
    ])
}

/// `against` and `anyRoll` read only on advantage.
fn advantage_only(modifier: &Map<String, Value>, found: &mut Refinements) {
    let advantage = modifier.get("stat") == Some(&json!("advantage"));
    if modifier.get("against") == Some(&json!(true)) && !advantage {
        found.add(vec![], "against reads only on advantage".into());
    }
    if modifier.get("anyRoll") == Some(&json!(true)) && !advantage {
        found.add(vec![], "anyRoll reads only on advantage".into());
    }
}

fn ability_modifier() -> Schema {
    object(vec![
        req(
            "stat",
            one_of(&[
                "evasion",
                "armorScore",
                "majorThreshold",
                "severeThreshold",
                "thresholds",
                "attackRoll",
                "damageRoll",
                "spellcastRoll",
                "actionRoll",
                "proficiency",
                "hitPoints",
                "stress",
                "bareBones",
                "advantage",
            ]),
        ),
        def("bonus", int(), || json!(0)),
        opt("plusTrait", one_of(TRAITS)),
        opt("halveTrait", boolean()),
        opt("plusProficiency", boolean()),
        opt("perToken", content_id()),
        opt("requires", one_of(&["unarmored", "armored", "meleeWeapon"])),
        opt("when", lazy(script::condition)),
        opt("against", boolean()),
        opt("anyRoll", boolean()),
    ])
    .refine(advantage_only)
}

fn damage_reaction() -> Schema {
    let kind = |k: &'static str| req("kind", literal(json!(k)));
    tagged(
        "kind",
        vec![
            ("reduceSeverity", object(vec![kind("reduceSeverity"), def("steps", int().positive(), || json!(1)), opt("only", one_of(&["severe", "major", "minor"]))])),
            ("reduceDamage", object(vec![kind("reduceDamage"), req("dice", string().min(1.0))])),
            ("extraArmor", object(vec![kind("extraArmor"), def("slots", int().positive(), || json!(1)), opt("only", one_of(DAMAGE_TYPES))])),
            ("redirect", object(vec![kind("redirect")])),
            ("reroll", object(vec![kind("reroll"), def("what", one_of(&["attack", "damage", "either"]), || json!("either"))])),
        ],
    )
}

fn damage_defenses() -> Schema {
    object(vec![
        opt("resistances", array(one_of(DAMAGE_TYPES))),
        opt("immunities", array(one_of(DAMAGE_TYPES))),
        opt("reduce", array(object(vec![req("dice", string().min(1.0)), opt("only", one_of(DAMAGE_TYPES))]))),
    ])
}

fn effects() -> Schema {
    array(lazy(script::effect))
}

fn ability() -> Schema {
    object(vec![
        req("id", content_id()),
        name(),
        req("source", object(vec![req("card", content_id())])),
        def("text", string(), empty_text),
        def("kind", one_of(&["action", "reaction", "passive"]), || json!("action")),
        opt(
            "trigger",
            one_of(&[
                "incomingDamage",
                "attackHit",
                "attackMissed",
                "tookDamage",
                "tookHitPoints",
                "tookSevere",
                "defeated",
                "dealtHit",
                "dealtDamage",
                "dealtMiss",
                "attacked",
                "partyRolled",
                "partyRolling",
                "rollingDamage",
                "allyRollingDamage",
                "allyTookDamage",
                "nearbyTookDamage",
                "spotlighted",
            ]),
        ),
        def("cost", object(vec![opt("good", int().min(0.0)), opt("stress", int().min(0.0)), opt("bad", int().min(0.0))]), || json!({})),
        opt("uses", object(vec![def("count", int().positive(), || json!(1)), req("per", one_of(&["rest", "longRest", "scene"]))])),
        def(
            "target",
            object(vec![
                def("kind", one_of(&["none", "self", "adversary", "ally", "creature", "group", "point"]), || json!("none")),
                def("range", one_of(RANGE_BANDS), || json!("melee")),
                opt("fallen", boolean()),
                opt("when", lazy(script::condition)),
            ]),
            || json!({ "kind": "none", "range": "melee" }),
        ),
        opt("available", lazy(script::condition)),
        def("inCombatOnly", boolean(), || json!(false)),
        def("action", boolean(), || json!(true)),
        def("effects", effects(), empty_list),
        def("modifiers", array(ability_modifier()), empty_list),
        opt("defenses", damage_defenses()),
        opt(
            "standardAttack",
            object(vec![
                opt("direct", boolean()),
                opt("damage", string().min(1.0)),
                opt("double", boolean()),
                opt("severity", one_of(&["minor", "major", "severe", "massive"])),
                opt("when", lazy(script::condition)),
            ]),
        ),
        opt("reaction", damage_reaction()),
        opt(
            "tokens",
            object(vec![
                req("amount", union(vec![int().min(0.0), one_of(TRAITS), literal(json!("spellcast")), literal(json!("domainCards"))])),
                opt("domain", content_id()),
                def("minimum", int().min(0.0), || json!(0)),
                def("refill", one_of(&["session", "longRest", "rest", "scene", "never"]), || json!("longRest")),
            ]),
        ),
        opt("lift", object(vec![def("each", int().positive(), || json!(1)), def("only", one_of(&["spellcast", "any"]), || json!("any"))])),
        def("auto", boolean(), || json!(true)),
    ])
}

/// `/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i`.
fn is_hex_colour(text: &str) -> bool {
    text.strip_prefix('#').is_some_and(|hex| (hex.len() == 3 || hex.len() == 6) && hex.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn condition_def() -> Schema {
    object(vec![
        req("id", content_id()),
        name(),
        def("text", string(), empty_text),
        opt("color", string().regex(is_hex_colour, "a hex colour")),
        def("modifiers", array(ability_modifier()), empty_list),
        opt("defenses", damage_defenses()),
        opt("goodDie", object(vec![req("sides", int().min(2.0))])),
        def("blocks", array(one_of(&["act", "move", "reactions", "armor"])), empty_list),
        opt("endsWhen", one_of(&["hit", "attacks", "damaged", "rolls"])),
        opt(
            "payout",
            object(vec![req("on", literal(json!("attacked"))), opt("when", lazy(script::condition)), opt("auto", boolean()), opt("keeps", boolean()), def("effects", effects(), empty_list)]),
        ),
        opt("onEnter", object(vec![def("effects", effects(), empty_list)])),
        opt("insteadOfDeath", object(vec![req("clears", int().positive()), req("says", string().min(1.0))])),
        opt("armor", object(vec![req("steps", int().positive()), opt("endsWhenItSaves", boolean())])),
    ])
}

fn code() -> Schema {
    object(vec![req("id", content_id()), def("name", string(), empty_text), def("notes", string(), empty_text), def("source", string(), empty_text)])
}

fn item() -> Schema {
    object(vec![
        req("id", content_id()),
        name(),
        def("kind", one_of(&["key", "consumable", "weapon", "armor", "trinket"]), || json!("trinket")),
        def("description", string(), empty_text),
        opt("contentId", string()),
        def("stackable", boolean(), || json!(true)),
        opt("value", int().min(0.0)),
        opt("tier", int().min(1.0)),
        opt("card", string()),
        def("use", effects(), empty_list),
    ])
}

/// A quantity's max is not below its min.
fn quantities_in_order(table: &Map<String, Value>, found: &mut Refinements) {
    for (i, entry) in table.get("entries").and_then(Value::as_array).into_iter().flatten().enumerate() {
        let (Some(min), Some(max)) = (entry["quantity"]["min"].as_f64(), entry["quantity"]["max"].as_f64()) else { continue };
        if max < min {
            let (max, min) = (crate::js::number_to_string(max), crate::js::number_to_string(min));
            found.add(vec![Key::Name("entries".into()), Key::Index(i), Key::Name("quantity".into())], format!("quantity max ({max}) is below min ({min})"));
        }
    }
}

fn loot_table() -> Schema {
    let positive = || int().positive();
    object(vec![
        req("id", content_id()),
        def("rolls", int().min(0.0), || json!(1)),
        req(
            "entries",
            array(object(vec![
                req("item", content_id()),
                def("quantity", union(vec![positive(), object(vec![req("min", positive()), req("max", positive())])]), || json!(1)),
                def("weight", number().positive(), || json!(1)),
            ]))
            .min(1.0),
        ),
    ])
    .refine(quantities_in_order)
}

/// No objective id twice.
fn objectives_distinct(quest: &Map<String, Value>, found: &mut Refinements) {
    let mut seen: Vec<&Value> = Vec::new();
    for (i, objective) in quest.get("objectives").and_then(Value::as_array).into_iter().flatten().enumerate() {
        let id = &objective["id"];
        if seen.contains(&id) {
            let text = id.as_str().unwrap_or_default();
            found.add(vec![Key::Name("objectives".into()), Key::Index(i), Key::Name("id".into())], format!("duplicate objective id \"{text}\""));
        }
        seen.push(id);
    }
}

fn quest() -> Schema {
    object(vec![
        req("id", content_id()),
        name(),
        def("summary", string(), empty_text),
        req("objectives", array(object(vec![req("id", content_id()), req("text", string().min(1.0)), def("hidden", boolean(), || json!(false)), def("summary", string(), empty_text)])).min(1.0)),
    ])
    .refine(objectives_distinct)
}

/// Every kind of content entry, by the name the fixture and `read_pack` use.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Weapon,
    Armor,
    Class,
    Ancestry,
    Community,
    Subclass,
    Card,
    Experience,
    Adversary,
    Ability,
    ConditionDef,
    Code,
    Item,
    LootTable,
    Quest,
}

impl Kind {
    pub const ALL: [Kind; 15] = [
        Kind::Weapon,
        Kind::Armor,
        Kind::Class,
        Kind::Ancestry,
        Kind::Community,
        Kind::Subclass,
        Kind::Card,
        Kind::Experience,
        Kind::Adversary,
        Kind::Ability,
        Kind::ConditionDef,
        Kind::Code,
        Kind::Item,
        Kind::LootTable,
        Kind::Quest,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Kind::Weapon => "weapon",
            Kind::Armor => "armor",
            Kind::Class => "class",
            Kind::Ancestry => "ancestry",
            Kind::Community => "community",
            Kind::Subclass => "subclass",
            Kind::Card => "card",
            Kind::Experience => "experience",
            Kind::Adversary => "adversary",
            Kind::Ability => "ability",
            Kind::ConditionDef => "conditionDef",
            Kind::Code => "code",
            Kind::Item => "item",
            Kind::LootTable => "lootTable",
            Kind::Quest => "quest",
        }
    }

    pub fn from_name(name: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.name() == name)
    }

    /// The schema, built once.
    pub fn schema(self) -> &'static Schema {
        static SCHEMAS: OnceLock<Vec<Schema>> = OnceLock::new();
        let all = SCHEMAS.get_or_init(|| {
            Kind::ALL
                .iter()
                .map(|kind| match kind {
                    Kind::Weapon => weapon(),
                    Kind::Armor => armor(),
                    Kind::Class => class(),
                    Kind::Ancestry | Kind::Community => ancestry(),
                    Kind::Subclass => subclass(),
                    Kind::Card => card(),
                    Kind::Experience => experience(),
                    Kind::Adversary => adversary(),
                    Kind::Ability => ability(),
                    Kind::ConditionDef => condition_def(),
                    Kind::Code => code(),
                    Kind::Item => item(),
                    Kind::LootTable => loot_table(),
                    Kind::Quest => quest(),
                })
                .collect()
        });
        &all[self as usize]
    }
}
