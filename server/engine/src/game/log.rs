//! What the player reads of the game (`src/game/log.ts`): the narrative log - a line of text in a tone,
//! with the creatures it names found in it - the names the game calls creatures by, and a script's journal
//! written down: its sentences, the dice it rolled, the numbers over heads and the tokens' motions. Nothing
//! here decides anything; what the game makes of a journal is `play`'s.

use super::content::{items_for, ItemName};
use super::session::Session;
use crate::grid::tile_grid::NO_TILE;
use crate::js;
use crate::scene::state::Faction;
use serde_json::{json, Value};

/// Somebody a line names.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Mention {
    pub id: String,
    pub name: String,
}

/// A line in the narrative pane.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct LogLine {
    pub text: String,
    /// Empty for a script's own line that named none, which the TypeScript writes with no tone at all.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub tone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<Mention>>,
}

impl LogLine {
    /// A line as a save holds it: its text, its tone, and whom it names when the save kept that.
    pub fn read(value: &Value) -> LogLine {
        let mentions = value["mentions"].as_array().map(|list| {
            list.iter().map(|m| Mention { id: m["id"].as_str().unwrap_or_default().to_string(), name: m["name"].as_str().unwrap_or_default().to_string() }).collect()
        });
        LogLine { text: value["text"].as_str().unwrap_or_default().to_string(), tone: value["tone"].as_str().unwrap_or_default().to_string(), mentions }
    }
}

/// One number over one head, in the tone the matching line has.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Floater {
    pub id: String,
    pub text: String,
    pub tone: String,
}

/// A Duality roll waiting to be shown: who rolled it, what for, and the dice.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RollShow {
    pub who: String,
    pub what: String,
    pub roll: Value,
}

/// A creature's name for the log (`nameOf`): the sheet's, its own, its stat block's, or its id.
pub fn name_of(session: &Session, id: &str) -> String {
    if let Some(sheet) = session.sheets.get(id) {
        return sheet.name.clone();
    }
    let Some(entity) = session.world.state.entity(id) else { return id.to_string() };
    entity.name.clone().or_else(|| session.world.adversary_def(&entity.definition).map(|def| def.name.clone())).unwrap_or_else(|| id.to_string())
}

/// A creature at the head of a sentence (`theNameOf`): "The Hollow Knight" for one known by its stat block,
/// a name of its own as it was given; `lower` mid-sentence.
pub fn the_name_of(session: &Session, id: &str, lower: bool) -> String {
    let own = session.sheets.has(id) || session.world.state.entity(id).is_some_and(|e| e.name.is_some());
    if own {
        name_of(session, id)
    } else {
        format!("{} {}", if lower { "the" } else { "The" }, name_of(session, id))
    }
}

fn is_word(unit: u16) -> bool {
    char::from_u32(u32::from(unit)).is_some_and(|c| c.is_ascii_alphanumeric())
}

/// The creatures a line names, longest name first, each found once where it stands as a word
/// (`withMentions`). Positions are counted as JavaScript counts them, in UTF-16 units.
fn with_mentions(session: &Session, text: &str, tone: &str) -> LogLine {
    let state = &session.world.state;
    let everybody: Vec<String> = state.entities_of(Faction::Party).chain(state.entities_of(Faction::Adversary)).map(|e| e.id.clone()).collect();
    let mut named: Vec<Mention> = everybody.iter().map(|id| Mention { id: id.clone(), name: name_of(session, id) }).collect();
    named.sort_by_key(|m| std::cmp::Reverse(m.name.encode_utf16().count()));
    let mut left: Vec<u16> = text.encode_utf16().collect();
    let mut found: Vec<Mention> = Vec::new();
    for one in named {
        if one.name.is_empty() || found.iter().any(|f| f.id == one.id) {
            continue;
        }
        let name: Vec<u16> = one.name.encode_utf16().collect();
        let Some(at) = left.windows(name.len()).position(|w| w == name.as_slice()) else { continue };
        let before = if at == 0 { u16::from(b' ') } else { left[at - 1] };
        let after = left.get(at + name.len()).copied().unwrap_or(u16::from(b' '));
        if is_word(before) || is_word(after) {
            continue;
        }
        // Blank it out so a shorter name inside it is not found again.
        for unit in &mut left[at..at + name.len()] {
            *unit = u16::from(b' ');
        }
        found.push(one);
    }
    LogLine { text: text.to_string(), tone: tone.to_string(), mentions: (!found.is_empty()).then_some(found) }
}

/// Put one line in the log (`note`), and hand it back.
pub fn note(session: &mut Session, text: &str, tone: &str) -> LogLine {
    let line = with_mentions(session, text, tone);
    session.log.push(line.clone());
    line
}

// ---- a journal, written down -------------------------------------------------------------------------------

/// A number as JavaScript writes it into a sentence.
fn n(value: &Value) -> String {
    js::number_to_string(value.as_f64().unwrap_or(f64::NAN))
}

fn s(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

fn absent(entry: &Value, key: &str) -> bool {
    entry.get(key).is_none_or(Value::is_null)
}

fn plural(count: &Value, word: &str) -> String {
    format!("{} {word}{}", n(count), if count.as_f64() == Some(1.0) { "" } else { "s" })
}

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn on_board(session: &Session, id: &str) -> bool {
    session.world.state.entity(id).is_some_and(|e| e.tile != NO_TILE)
}

/// Float a number over somebody who is on the board (`float`). Nobody there, nothing floats.
pub fn float(session: &mut Session, id: &str, text: String, tone: &str) {
    if on_board(session, id) {
        session.floaters.push(Floater { id: id.to_string(), text, tone: tone.to_string() });
    }
}

/// Somebody on the board swung at somebody else on it, for a token that lunges (`swungAt`).
pub(super) fn swung_at(session: &mut Session, attacker: &str, target: &str) {
    let at = session.world.state.entity(target).map_or(NO_TILE, |e| e.tile);
    if on_board(session, attacker) && at != NO_TILE {
        session.motions.push(json!({ "id": attacker, "lunge": { "at": at } }));
    }
}

/// A blow landed on somebody on the board, for a token that flinches (`struck`).
pub(super) fn struck(session: &mut Session, id: &str) {
    if on_board(session, id) {
        session.motions.push(json!({ "id": id, "struck": true }));
    }
}

/// The number a journal entry puts over a head, if it puts one (`floatEntry`): what changed a pool or put a
/// condition on someone floats; what happened to the room or the story stays in the log.
fn float_entry(session: &mut Session, entry: &Value) {
    match s(&entry["kind"]) {
        "attack" => {
            swung_at(session, s(&entry["attacker"]), s(&entry["target"]));
            if entry["hit"] == true {
                float(session, s(&entry["target"]), format!("-{} HP", n(&entry["hitPointsMarked"])), "combat");
                struck(session, s(&entry["target"]));
            } else {
                float(session, s(&entry["target"]), "miss".into(), "system");
            }
        }
        "damage" => {
            let Some(targets) = entry["targets"].as_array() else { return };
            for id in targets {
                let text = if targets.len() == 1 { format!("-{} HP", n(&entry["marked"])) } else { format!("{} damage", n(&entry["amount"])) };
                float(session, s(id), text, "combat");
                struck(session, s(id));
            }
        }
        "heal" => {
            if entry["spread"] == true {
                return;
            }
            for id in list(entry, "ids") {
                float(session, s(id), format!("+{}", n(&entry["amount"])), "good");
            }
        }
        "stress" => {
            if entry["cleared"].as_f64().unwrap_or(0.0) > 0.0 {
                float(session, s(&entry["id"]), format!("-{} Stress", n(&entry["cleared"])), "good");
            } else {
                float(session, s(&entry["id"]), format!("+{} Stress", n(&entry["marked"])), "bad");
            }
        }
        "armor" => float(session, s(&entry["id"]), format!("+{} Armor", n(&entry["cleared"])), "good"),
        "condition" => {
            if entry["applied"] == true {
                let name = session.world.condition_name(s(&entry["condition"]));
                float(session, s(&entry["id"]), name, "combat");
            }
        }
        "good" => {
            if let Some(id) = entry["id"].as_str() {
                float(session, id, format!("+{} Light", n(&entry["gained"])), "good");
            }
        }
        _ => {}
    }
}

/// The faces a journal entry rolled, who rolled them - empty for whoever the script acts as - and what for
/// (`rolledIn`).
fn rolled_in(entry: &Value) -> Option<(Value, String, String)> {
    match s(&entry["kind"]) {
        "check" => Some((entry["roll"].clone(), String::new(), "the check".into())),
        "attack" if !absent(entry, "roll") => Some((entry["roll"].clone(), s(&entry["attacker"]).into(), s(&entry["weapon"]).into())),
        "reaction" if !absent(entry, "roll") => Some((entry["roll"].clone(), s(&entry["id"]).into(), "the reaction".into())),
        _ => None,
    }
}

/// "12 gold and a brass key" - an item nobody named reads as its id (`listItems`). More than one of a thing
/// takes an s, unless it already ends in one or is its own plural.
fn list_items(found: &[Value], names: &[ItemName]) -> String {
    let parts: Vec<String> = found
        .iter()
        .map(|drop| {
            let item = s(&drop["item"]);
            let name = names.iter().find(|i| i.id == item).map_or_else(|| item.to_string(), |i| i.name.clone());
            if drop["quantity"].as_f64().unwrap_or(f64::NAN) <= 1.0 {
                return name;
            }
            let lower = name.to_lowercase();
            let uncountable = ["gold", "silver", "ammunition", "armor", "armour"].contains(&lower.as_str());
            let plural = if uncountable || lower.ends_with('s') { name.clone() } else { format!("{name}s") };
            format!("{} {plural}", n(&drop["quantity"]))
        })
        .collect();
    match parts.len() {
        0 => "nothing".into(),
        1 => parts[0].clone(),
        count => format!("{} and {}", parts[..count - 1].join(", "), parts[count - 1]),
    }
}

/// The dice, in words (`describeRoll`): "Light 9 + Shadow 4 + 2 = 15 vs 13." Only the parts that applied.
pub fn describe_roll(roll: &Value) -> String {
    let mut parts = vec![format!("Light {} + Shadow {}", n(&roll["good"]), n(&roll["bad"]))];
    let advantage = roll["advantageDie"].as_f64().unwrap_or(0.0);
    if advantage > 0.0 {
        parts.push(format!("+ d6 {}", n(&roll["advantageDie"])));
    }
    if advantage < 0.0 {
        parts.push(format!("\u{2212} d6 {}", js::number_to_string(-advantage)));
    }
    if roll["helpBonus"].as_f64().unwrap_or(0.0) > 0.0 {
        parts.push(format!("+ help {}", n(&roll["helpBonus"])));
    }
    let modifier = roll["modifier"].as_f64().unwrap_or(0.0);
    if modifier != 0.0 {
        parts.push(if modifier > 0.0 { format!("+ {}", n(&roll["modifier"])) } else { format!("\u{2212} {}", js::number_to_string(-modifier)) });
    }
    format!("{} = {} vs {}.", parts.join(" "), n(&roll["total"]), n(&roll["difficulty"]))
}

fn describe_outcome(outcome: &str) -> &'static str {
    match outcome {
        "criticalSuccess" => "A critical success.",
        "successWithGood" => "Success, with Light.",
        "successWithBad" => "Success, with Shadow.",
        "failureWithGood" => "Failure, with Light.",
        _ => "Failure, with Shadow.",
    }
}

fn tone_for(outcome: &str) -> &'static str {
    if outcome == "criticalSuccess" {
        "success"
    } else if outcome.starts_with("success") {
        "good"
    } else {
        "bad"
    }
}

/// The sentence a journal entry reads as, and its tone - nothing for the ones that are not news
/// (`describeEntry`).
fn describe_entry(session: &Session, entry: &Value, names: &[ItemName]) -> Option<(String, String)> {
    let who = |id: &Value| name_of(session, s(id));
    let quest = |id: &Value| list(&session.project, "quests").iter().find(|q| q["id"] == *id).cloned();
    let step = |entry: &Value| {
        quest(&entry["quest"])
            .and_then(|q| list(&q, "objectives").iter().find(|o| o["id"] == entry["objective"]).map(|o| s(&o["text"]).to_string()))
            .unwrap_or_else(|| s(&entry["objective"]).to_string())
    };
    let reduced = |entry: &Value| if absent(entry, "reduced") { String::new() } else { format!(", {} turned aside", n(&entry["reduced"])) };
    let said = |text: String, tone: &str| Some((text, tone.to_string()));
    match s(&entry["kind"]) {
        "attack" => {
            if entry["hit"] == true {
                let joined = entry["joined"].as_array().map_or(String::new(), |j| format!(", {} of them at once", j.len() + 1));
                let how = if entry["critical"] == true { "lands a critical with" } else { "hits with" };
                said(format!("{} {how} the {}{joined}: {} on {}{}.", who(&entry["attacker"]), s(&entry["weapon"]), plural(&entry["hitPointsMarked"], "Hit Point"), who(&entry["target"]), reduced(entry)), "combat")
            } else {
                said(format!("{} swings the {} at {} and misses.", who(&entry["attacker"]), s(&entry["weapon"]), who(&entry["target"])), "combat")
            }
        }
        "stress" => {
            if entry["cleared"].as_f64().unwrap_or(0.0) > 0.0 {
                said(format!("{} clears {}.", who(&entry["id"]), plural(&entry["cleared"], "Stress")), "good")
            } else {
                let slot = if entry["hitPoints"].as_f64().unwrap_or(0.0) > 0.0 { " and, with no slot left, a Hit Point" } else { "" };
                said(format!("{} marks {}{slot}.", who(&entry["id"]), plural(&entry["marked"], "Stress")), "bad")
            }
        }
        "armor" => said(format!("{} clears {}.", who(&entry["id"]), plural(&entry["cleared"], "Armor Slot")), "good"),
        "condition" => {
            let name = session.world.condition_name(s(&entry["condition"]));
            if entry["applied"] == true {
                said(format!("{} is {name}.", who(&entry["id"])), "combat")
            } else {
                said(format!("{} is no longer {name}.", who(&entry["id"])), "system")
            }
        }
        "moved" => {
            if entry["walked"] == true {
                said(format!("{} crosses the ground.", who(&entry["id"])), "combat")
            } else {
                said(format!("{} is thrown back.", who(&entry["id"])), "combat")
            }
        }
        "marked" => said(format!("{} marks the ground where they stand.", who(&entry["id"])), "good"),
        "rollRaised" => said(format!("Another {} goes behind the roll.", n(&entry["by"])), "good"),
        "countdown" => said(format!("{} begins: {}.", s(&entry["name"]), n(&entry["value"])), "bad"),
        "replaced" => {
            let ids = list(entry, "ids");
            let first = ids.first()?;
            let named = if ids.len() == 1 { who(first) } else { format!("{} {}s", ids.len(), who(first)) };
            said(format!("{} is gone: {named} in their place.", s(&entry["was"])), "bad")
        }
        "spotlighted" => {
            let ids = list(entry, "ids");
            let called = ids.iter().map(who).collect::<Vec<_>>().join(", ");
            let half = if entry["halfDamage"] == true { ", striking for half" } else { "" };
            said(format!("{called} {} called into the fight{half}.", if ids.len() == 1 { "is" } else { "are" }), "bad")
        }
        "summoned" => {
            let ids = list(entry, "ids");
            let first = ids.first()?;
            let one = ids.len() == 1;
            said(format!("{} {}{} arrive{}.", ids.len(), who(first), if one { "" } else { "s" }, if one { "s" } else { "" }), "bad")
        }
        "reaction" => {
            let holds = entry["success"] == true;
            said(format!("{} reacts: {} against {} \u{2014} {}.", who(&entry["id"]), n(&entry["total"]), n(&entry["difficulty"]), if holds { "holds" } else { "fails" }), if holds { "system" } else { "success" })
        }
        "attitude" => {
            if entry["attitude"] == "friendly" {
                said(format!("{} lowers their guard.", who(&entry["id"])), "good")
            } else {
                said(format!("{} turns on the party!", who(&entry["id"])), "bad")
            }
        }
        "refused" => said(format!("That cannot happen: {}.", s(&entry["reason"])), "system"),
        "defended" => {
            let mut costs = Vec::new();
            if entry["goodSpent"].as_f64().unwrap_or(0.0) > 0.0 {
                costs.push(format!("{} Light", n(&entry["goodSpent"])));
            }
            if entry["stressMarked"].as_f64().unwrap_or(0.0) > 0.0 {
                costs.push(format!("{} Stress", n(&entry["stressMarked"])));
            }
            let cost = if costs.is_empty() { String::new() } else { format!(", {}", costs.join(" and ")) };
            let rolled = if absent(entry, "rolled") { String::new() } else { format!(" ({})", n(&entry["rolled"])) };
            said(format!("{}: {}{rolled}{cost}.", who(&entry["id"]), s(&entry["ability"])), "good")
        }
        "goodSpent" => said(format!("Spends {}.", plural(&entry["amount"], "Light")), "good"),
        "experience" => said(format!("Draws on \"{}\" (+{}).", s(&entry["name"]), n(&entry["modifier"])), "good"),
        "good" => {
            if absent(entry, "id") {
                return None;
            }
            said(format!("{} gains {}.", who(&entry["id"]), plural(&entry["gained"], "Light")), "good")
        }
        "goodLost" => said(format!("{} loses {}.", who(&entry["id"]), plural(&entry["lost"], "Light")), "bad"),
        "badLost" => said(format!("The GM loses {}.", plural(&entry["lost"], "Shadow")), "good"),
        "quest" => {
            let name = quest(&entry["quest"]).map_or_else(|| s(&entry["quest"]).to_string(), |q| s(&q["name"]).to_string());
            match s(&entry["change"]) {
                "started" => said(format!("New quest: {name}."), "system"),
                "completed" => said(format!("Quest complete: {name}."), "success"),
                _ => said(format!("Quest failed: {name}."), "bad"),
            }
        }
        "levelUp" => said(format!("The party reaches level {}.", n(&entry["level"])), "good"),
        "objective" => said(format!("Objective complete: {}", step(entry)), "success"),
        "revealed" => said(format!("New objective: {}", step(entry)), "system"),
        "log" => Some((s(&entry["text"]).to_string(), s(&entry["tone"]).to_string())),
        "story" => {
            let mut parts = vec![s(&entry["title"]).to_string()];
            parts.extend(list(entry, "paragraphs").iter().map(|p| s(p).to_string()));
            said(parts.join(" "), "narration")
        }
        "key" => {
            // An item may carry its own article; a sentence that adds one would read "the The Warden's word".
            let key = s(&entry["key"]);
            let named = names.iter().find(|i| i.id == key).map_or_else(|| key.to_string(), |i| i.name.clone());
            let lower = named.to_lowercase();
            let article = if ["the ", "a ", "an "].iter().any(|a| lower.starts_with(a)) { "" } else { "the " };
            said(format!("You take {article}{named}."), "success")
        }
        "loot" => {
            let found = list(entry, "found");
            if found.is_empty() {
                said("Nothing worth taking.".into(), "system")
            } else {
                said(format!("You find {}.", list_items(found, names)), "success")
            }
        }
        "damage" => {
            if let Some(targets) = entry["targets"].as_array() {
                let dice = entry["dice"].as_str().unwrap_or_default();
                let text = format!("{dice} \u{2192} {} damage to {}: {}{}.", n(&entry["amount"]), targets.iter().map(who).collect::<Vec<_>>().join(", "), plural(&entry["marked"], "Hit Point"), reduced(entry));
                let text = text.strip_prefix(" \u{2192} ").map_or_else(|| text.clone(), str::to_string);
                said(text, "combat")
            } else {
                said(format!("You take {} damage.", n(&entry["amount"])), "bad")
            }
        }
        "heal" => said(format!("You recover {}.", n(&entry["amount"])), "good"),
        "check" => {
            let outcome = s(&entry["outcome"]);
            if entry["reused"] == true {
                let hit = list(entry, "hit");
                let text = if hit.is_empty() {
                    format!("The same roll ({}) reaches nobody else.", n(&entry["roll"]["total"]))
                } else {
                    format!("The same roll ({}) carries to {}.", n(&entry["roll"]["total"]), hit.iter().map(who).collect::<Vec<_>>().join(", "))
                };
                said(text, tone_for(outcome))
            } else {
                said(format!("{} {}", describe_roll(&entry["roll"]), describe_outcome(outcome)), tone_for(outcome))
            }
        }
        "chose" => said(s(&entry["label"]).to_string(), "system"),
        "encounter" => {
            if entry["change"] != "started" {
                return None;
            }
            said(entry["intro"].as_str().unwrap_or("Something moves.").to_string(), "combat")
        }
        // Flags, variables and bookkeeping are real but not news.
        _ => None,
    }
}

/// Turn what a script did into what the player reads (`writeDown`): the lines, the dice, the numbers over
/// heads and the tokens' motions. Nothing is acted on.
pub fn write_down(session: &mut Session, journal: &[Value]) -> Vec<LogLine> {
    let names = items_for(session.shipped(), &session.project);
    let mut lines = Vec::new();
    for entry in journal {
        if let Some((roll, who, what)) = rolled_in(entry) {
            // A check is rolled by whoever the script is acting as; an attack and a reaction name their own.
            let roller = if who.is_empty() { session.world.scenario.actor_id.clone() } else { Some(who) };
            let name = roller.map_or_else(String::new, |r| name_of(session, &r));
            session.rolls.push(RollShow { who: name, what, roll });
        }
        if let Some((text, tone)) = describe_entry(session, entry, &names) {
            lines.push(with_mentions(session, &text, &tone));
        }
        float_entry(session, entry);
        if entry["kind"] == "moved" {
            if entry["walked"] != true {
                session.motions.push(json!({ "id": entry["id"], "thrown": true }));
            } else if !absent(entry, "route") {
                session.motions.push(json!({ "id": entry["id"], "route": entry["route"] }));
            }
        }
    }
    session.log.extend(lines.iter().cloned());
    lines
}

/// A node's spoken lines, added to the transcript once (`speak`): `spoken` remembers the node already down.
pub fn speak(session: &mut Session, spoken: &mut Option<String>, node: &str, said: &[crate::dialogue::schema::DialogueLine]) -> Vec<LogLine> {
    if spoken.as_deref() == Some(node) {
        return Vec::new();
    }
    *spoken = Some(node.to_string());
    let lines: Vec<LogLine> = said
        .iter()
        .map(|l| LogLine { text: l.speaker.as_ref().map_or_else(|| l.text.clone(), |who| format!("{who}: {}", l.text)), tone: "narration".into(), mentions: None })
        .collect();
    session.log.extend(lines.iter().cloned());
    lines
}
