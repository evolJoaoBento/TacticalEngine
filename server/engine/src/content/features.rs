//! What a weapon's or armour's feature does, where its text says it plainly
//! (`src/engine/content/equipment/features.ts`): Reliable "+1 to attack rolls", Heavy "−1 to Evasion",
//! Cumbersome "−1 to Finesse". Each clause of exactly that shape becomes a modifier or a trait change;
//! anything else in a feature stays the words it is.
//!
//! The TypeScript splits on `/;|\.\s/`, trims, drops one trailing full stop and matches
//! `/^([+−-])(\d+) to (.+)$/`. The same is done here by hand, with JavaScript's whitespace and `.`
//! taking everything but a line terminator.

use crate::content::abilities::{AbilityModifier, Stat};
use crate::content::pack::PackFeature;
use crate::js;
use crate::rules::jump::{PartialTraits, Trait};
use serde::Serialize;

/// What a clause's object names, and which modifier stat that is.
const STATS: [(&str, Stat); 8] = [
    ("attack rolls", Stat::AttackRoll),
    ("armor score", Stat::ArmorScore),
    ("evasion", Stat::Evasion),
    ("severe damage threshold", Stat::SevereThreshold),
    ("major damage threshold", Stat::MajorThreshold),
    ("damage thresholds", Stat::Thresholds),
    ("spellcast rolls", Stat::SpellcastRoll),
    ("proficiency", Stat::Proficiency),
];

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct GearEffects {
    pub modifiers: Vec<AbilityModifier>,
    pub traits: PartialTraits,
}

/// `text.split(/;|\.\s/)`: a semicolon, or a full stop and the whitespace after it, both dropped.
fn clauses(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut pieces = vec![String::new()];
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ';' {
            pieces.push(String::new());
            i += 1;
        } else if chars[i] == '.' && chars.get(i + 1).is_some_and(|&c| js::is_space(c)) {
            pieces.push(String::new());
            i += 2;
        } else {
            pieces.last_mut().expect("never empty").push(chars[i]);
            i += 1;
        }
    }
    pieces
}

fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `/^([+−-])(\d+) to (.+)$/`: the signed number and what it is to.
fn clause(text: &str) -> Option<(f64, &str)> {
    let mut chars = text.char_indices();
    let (_, sign) = chars.next()?;
    let sign = match sign {
        '+' => 1.0,
        '\u{2212}' | '-' => -1.0,
        _ => return None,
    };
    let start = sign_len(text);
    let digits_end = text[start..].find(|c: char| !c.is_ascii_digit()).map_or(text.len(), |at| start + at);
    if digits_end == start {
        return None;
    }
    let rest = text[digits_end..].strip_prefix(" to ")?;
    if rest.is_empty() || rest.chars().any(is_line_terminator) {
        return None;
    }
    let n: f64 = text[start..digits_end].parse().ok()?;
    Some((sign * n, rest))
}

fn sign_len(text: &str) -> usize {
    text.chars().next().map_or(0, char::len_utf8)
}

/// What these features do that can be counted. Empty when none says anything plain.
pub fn gear_effects<'a>(features: impl IntoIterator<Item = &'a PackFeature>) -> GearEffects {
    let mut effects = GearEffects::default();
    for feature in features {
        for raw in clauses(&feature.text) {
            let trimmed = js::trim(&raw);
            let text = trimmed.strip_suffix('.').unwrap_or(trimmed);
            let Some((n, what)) = clause(text) else { continue };
            let what = what.to_lowercase();
            if let Some(t) = Trait::ALL.into_iter().find(|t| t.name() == what) {
                effects.traits.add(t, n);
            } else if what == "all character traits and evasion" {
                for t in Trait::ALL {
                    effects.traits.add(t, n);
                }
                effects.modifiers.push(AbilityModifier::flat(Stat::Evasion, n));
            } else if let Some(&(_, stat)) = STATS.iter().find(|(name, _)| *name == what) {
                effects.modifiers.push(AbilityModifier::flat(stat, n));
            }
        }
    }
    effects
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(text: &str) -> GearEffects {
        gear_effects(&[PackFeature { name: "f".into(), text: text.into() }])
    }

    #[test]
    fn a_line_break_inside_the_object_is_not_a_clause() {
        // At the end it is whitespace, and trimmed away first.
        assert_eq!(one("+1 to evasion\u{2028}").modifiers, vec![AbilityModifier::flat(Stat::Evasion, 1.0)]);
        assert!(one("+1 to eva\u{2028}sion").modifiers.is_empty());
        assert!(one("+1 to evasion\nmore").modifiers.is_empty());
        assert_eq!(one("+1 to evasion.\nmore").modifiers, vec![AbilityModifier::flat(Stat::Evasion, 1.0)]);
    }

    #[test]
    fn the_sign_and_the_digits_are_what_javascript_reads() {
        assert_eq!(one("\u{2212}2 to Armor Score").modifiers, vec![AbilityModifier::flat(Stat::ArmorScore, -2.0)]);
        assert_eq!(one("+007 to proficiency").modifiers, vec![AbilityModifier::flat(Stat::Proficiency, 7.0)]);
        assert!(one("+\u{0661} to evasion").modifiers.is_empty());
        assert!(one("+1  to evasion").modifiers.is_empty());
        assert!(one("+ 1 to evasion").modifiers.is_empty());
    }
}
