//! Dice expressions (`src/engine/rules/dice.ts`): parsing, rolling, Proficiency.
//!
//! Damage is written `xdy+z`, and adversary content is stringly typed ("1d12+2 phy", "1d8+4 phy/mag",
//! "3 phy", "+2d4"). The TypeScript reads it with four regular expressions; here the same grammar is
//! matched by hand, character for character, because what JavaScript's `\s` takes is not what Rust's
//! whitespace is, and the replacement it makes (`'$11d$2'`: group one, then a one) is a JavaScript rule.

use crate::js;
use crate::rng::{RangeError, Rng};
use serde::{Deserialize, Serialize};

/// Physical or magic: the two damage types the SRD distinguishes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DamageType {
    Physical,
    Magic,
}

impl DamageType {
    pub fn name(self) -> &'static str {
        match self {
            DamageType::Physical => "physical",
            DamageType::Magic => "magic",
        }
    }

    pub fn parse(text: &str) -> Option<DamageType> {
        match text {
            "physical" => Some(DamageType::Physical),
            "magic" => Some(DamageType::Magic),
            _ => None,
        }
    }
}

/// `count` dice of `sides`, plus `modifier`. JavaScript numbers, so a count read from twenty digits is
/// what `Number` makes of them.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct DiceExpression {
    pub count: f64,
    pub sides: f64,
    pub modifier: f64,
}

/// As JSON, the expression's three numbers and `types` side by side, as `ParsedDamage` is written.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ParsedDamage {
    #[serde(flatten)]
    pub expression: DiceExpression,
    /// The damage types the text named, or nothing when it named none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub types: Option<Vec<DamageType>>,
}

fn damage_type_word(word: &str) -> Option<DamageType> {
    match word {
        "phy" | "phys" | "physical" => Some(DamageType::Physical),
        "mag" | "magic" | "magical" => Some(DamageType::Magic),
        _ => None,
    }
}

/// `\s+([a-z/]+)\s*$`: the trailing word and where its whitespace begins, if the text ends in one.
fn trailing_word(chars: &[char]) -> Option<(usize, String)> {
    let mut end = chars.len();
    while end > 0 && js::is_space(chars[end - 1]) {
        end -= 1;
    }
    let mut start = end;
    while start > 0 && (chars[start - 1].is_ascii_lowercase() || chars[start - 1] == '/') {
        start -= 1;
    }
    if start == end {
        return None;
    }
    let mut space = start;
    while space > 0 && js::is_space(chars[space - 1]) {
        space -= 1;
    }
    if space == start {
        return None;
    }
    Some((space, chars[start..end].iter().collect()))
}

/// `replace(/(^|[+-])d(\d)/g, '$11d$2')`: "d6" is one d6, at the start or after a sign.
fn one_die(text: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(text.len() + 2);
    let mut i = 0;
    while i < text.len() {
        if i == 0 && text[0] == 'd' && text.get(1).is_some_and(char::is_ascii_digit) {
            out.extend(['1', 'd', text[1]]);
            i += 2;
        } else if matches!(text[i], '+' | '-') && text.get(i + 1) == Some(&'d') && text.get(i + 2).is_some_and(char::is_ascii_digit) {
            out.extend([text[i], '1', 'd', text[i + 2]]);
            i += 3;
        } else {
            out.push(text[i]);
            i += 1;
        }
    }
    out
}

/// Read a run of ASCII digits at `at`, as `Number` reads it; where it ended.
fn digits(text: &[char], at: usize) -> Option<(f64, usize)> {
    let mut end = at;
    while end < text.len() && text[end].is_ascii_digit() {
        end += 1;
    }
    if end == at {
        return None;
    }
    let run: String = text[at..end].iter().collect();
    Some((run.parse().expect("digits"), end))
}

/// `^\+?(?:(\d+)d(\d+))?(?:([+-])?(\d+))?$`: the dice, if any, then the modifier, if any.
fn dice_pattern(text: &[char]) -> Option<(Option<(f64, f64)>, Option<(bool, f64)>)> {
    let mut at = usize::from(text.first() == Some(&'+'));
    let mut dice = None;
    if let Some((count, after)) = digits(text, at) {
        if text.get(after) == Some(&'d') {
            if let Some((sides, end)) = digits(text, after + 1) {
                dice = Some((count, sides));
                at = end;
            }
        }
    }
    let mut modifier = None;
    if at < text.len() {
        let negative = text[at] == '-';
        let signed = matches!(text[at], '+' | '-');
        let (value, end) = digits(text, at + usize::from(signed))?;
        modifier = Some((negative, value));
        at = end;
    }
    (at == text.len()).then_some((dice, modifier))
}

/// Parse a damage or dice string, or nothing for anything the TypeScript would not read.
pub fn parse_dice(input: &str) -> Option<ParsedDamage> {
    let lowered = js::trim(input).to_lowercase();
    if lowered.is_empty() {
        return None;
    }
    let mut chars: Vec<char> = lowered.chars().collect();
    let mut types = None;
    if let Some((index, word)) = trailing_word(&chars) {
        let mut parsed = Vec::new();
        for part in word.split('/') {
            let kind = damage_type_word(part)?;
            if !parsed.contains(&kind) {
                parsed.push(kind);
            }
        }
        types = Some(parsed);
        chars.truncate(index);
    }
    let packed: Vec<char> = chars.into_iter().filter(|&c| !js::is_space(c)).collect();
    let (dice, modifier) = dice_pattern(&one_die(&packed))?;
    if dice.is_none() && modifier.is_none() {
        return None;
    }
    let (count, sides) = dice.unwrap_or((0.0, 0.0));
    if dice.is_some() && sides <= 0.0 {
        return None;
    }
    let modifier = modifier.map_or(0.0, |(negative, value)| if negative { -value } else { value });
    Some(ParsedDamage { expression: DiceExpression { count, sides, modifier }, types })
}

/// Canonical text for an expression: `"2d8+1"`, `"1d6"`, `"+3"`, `"0"`.
pub fn format_dice(expression: &DiceExpression) -> String {
    let dice = if expression.count > 0.0 { format!("{}d{}", js::number_to_string(expression.count), js::number_to_string(expression.sides)) } else { String::new() };
    let modifier = if expression.modifier == 0.0 {
        String::new()
    } else if expression.modifier > 0.0 {
        format!("+{}", js::number_to_string(expression.modifier))
    } else {
        js::number_to_string(expression.modifier)
    };
    match (dice.is_empty(), modifier.is_empty()) {
        (true, true) => "0".into(),
        (true, false) => modifier,
        _ => dice + &modifier,
    }
}

/// The highest the dice can show: the SRD's critical-damage bonus.
pub fn max_dice(expression: &DiceExpression) -> f64 {
    expression.count * expression.sides
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiceRoll {
    /// Every face, in roll order.
    pub rolls: Vec<u32>,
    pub dice_total: f64,
    pub modifier: f64,
    pub total: f64,
}

/// `rng.dice(count, sides)` for JavaScript numbers: refused, before any die is drawn, for a count that is
/// not a whole number of at least zero or sides that are not a whole number above it.
pub fn roll_many(rng: &mut Rng, count: f64, sides: f64) -> Result<Vec<u32>, RangeError> {
    if count.fract() != 0.0 || count < 0.0 || !count.is_finite() {
        return Err(RangeError(format!("dice(count) needs a non-negative integer, got {count}")));
    }
    // `new Array(count)` refuses more than 2^32 - 1, as an "Invalid array length".
    if count > 4_294_967_295.0 {
        return Err(RangeError("Invalid array length".into()));
    }
    if count == 0.0 {
        return Ok(Vec::new());
    }
    if sides.fract() != 0.0 || sides <= 0.0 || sides > f64::from(u32::MAX) {
        return Err(RangeError(format!("die(sides) needs a positive integer, got {sides}")));
    }
    rng.dice(count as usize, sides as u32)
}

/// Roll an expression, the dice off the stream in order.
pub fn roll_dice(rng: &mut Rng, expression: &DiceExpression) -> Result<DiceRoll, RangeError> {
    let rolls = if expression.count > 0.0 { roll_many(rng, expression.count, expression.sides)? } else { Vec::new() };
    let dice_total = rolls.iter().map(|&r| f64::from(r)).sum::<f64>();
    Ok(DiceRoll { rolls, dice_total, modifier: expression.modifier, total: dice_total + expression.modifier })
}

/// Proficiency multiplies the number of dice, never the modifier.
pub fn with_proficiency(expression: &DiceExpression, proficiency: f64) -> DiceExpression {
    let p = js::max(0.0, js::trunc(proficiency));
    DiceExpression { count: expression.count * p, sides: expression.sides, modifier: expression.modifier }
}
