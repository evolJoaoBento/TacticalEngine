//! Marked spots (`src/engine/script/marks.ts`): a creature's mark of a name - "the spot you marked" - kept
//! as a scenario variable under `mark:<name>:<creature>`, so saving and replaying it is saving variables.

pub const MARK_PREFIX: &str = "mark:";

/// The variable a creature's mark of that name lives under.
pub fn mark_key(mark: &str, actor: &str) -> String {
    format!("{MARK_PREFIX}{mark}:{actor}")
}

/// The mark and the creature a variable name is about, or nothing for any other variable: the name runs
/// to the first colon after the prefix, and neither half may be empty.
pub fn parse_mark_key(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix(MARK_PREFIX)?;
    let at = rest.find(':')?;
    if at == 0 || at == rest.len() - 1 {
        return None;
    }
    Some((&rest[..at], &rest[at + 1..]))
}
