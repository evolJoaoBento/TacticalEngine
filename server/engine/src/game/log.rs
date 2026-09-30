//! The narrative log (`src/game/log.ts`): a line of text in a tone, with the creatures it names found in
//! it, and the names the game calls creatures by. Turning a script's journal into lines comes with the
//! actions that write journals.

use super::session::Session;
use crate::scene::state::Faction;

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
    pub tone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<Mention>>,
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
