//! Damage (`src/engine/rules/damage.ts`): thresholds and severity, Armor Slots, resistance and immunity,
//! reduction, damage rolls. SRD "HIT POINTS & DAMAGE THRESHOLDS", "ATTACKING", "REDUCING INCOMING
//! DAMAGE", "ROUNDING UP".

use crate::js;
use crate::rng::{RangeError, Rng};
use crate::rules::dice::{max_dice, parse_dice, roll_dice, with_proficiency, DamageType, DiceExpression, DiceRoll};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum DamageSeverity {
    None,
    Minor,
    Major,
    Severe,
    Massive,
}

pub const SEVERITY_ORDER: [DamageSeverity; 5] = [DamageSeverity::None, DamageSeverity::Minor, DamageSeverity::Major, DamageSeverity::Severe, DamageSeverity::Massive];

impl DamageSeverity {
    pub fn name(self) -> &'static str {
        match self {
            DamageSeverity::None => "none",
            DamageSeverity::Minor => "minor",
            DamageSeverity::Major => "major",
            DamageSeverity::Severe => "severe",
            DamageSeverity::Massive => "massive",
        }
    }

    pub fn from_name(text: &str) -> Option<Self> {
        SEVERITY_ORDER.into_iter().find(|s| s.name() == text)
    }
}

/// Severe or worse: "when it takes Severe damage" is a floor, not a bracket.
pub fn is_severe(severity: DamageSeverity) -> bool {
    severity >= DamageSeverity::Severe
}

/// Hit Points marked for a band.
pub fn hp_for_severity(severity: DamageSeverity) -> f64 {
    f64::from(severity as u8)
}

/// Step a band down, an Armor Slot at a time.
pub fn reduce_severity(severity: DamageSeverity, steps: f64) -> DamageSeverity {
    let index = js::max(0.0, severity as u8 as f64 - js::max(0.0, js::trunc(steps)));
    SEVERITY_ORDER[index as usize]
}

/// A creature's Major and Severe thresholds; `INFINITY` for none.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DamageThresholds {
    pub major: f64,
    pub severe: f64,
}

pub const NO_THRESHOLDS: DamageThresholds = DamageThresholds { major: f64::INFINITY, severe: f64::INFINITY };

/// A stat block's thresholds: `"8/15"`, `"4/None"`, `"None"`; nothing for any other shape.
pub fn parse_thresholds(input: &str) -> Option<DamageThresholds> {
    let text = js::trim(input).to_lowercase();
    if text.is_empty() {
        return None;
    }
    if text == "none" {
        return Some(NO_THRESHOLDS);
    }
    let chars: Vec<char> = text.chars().collect();
    // `^(\d+|none)\s*\/\s*(\d+|none)$`
    let token = |at: usize| -> Option<(f64, usize)> {
        let mut end = at;
        while end < chars.len() && chars[end].is_ascii_digit() {
            end += 1;
        }
        if end > at {
            return Some((chars[at..end].iter().collect::<String>().parse().expect("digits"), end));
        }
        (chars.get(at..at + 4).map(|part| part.iter().collect::<String>()) == Some("none".into())).then_some((f64::INFINITY, at + 4))
    };
    let skip = |mut at: usize| {
        while at < chars.len() && js::is_space(chars[at]) {
            at += 1;
        }
        at
    };
    let (major, at) = token(0)?;
    let at = skip(at);
    if chars.get(at) != Some(&'/') {
        return None;
    }
    let (severe, at) = token(skip(at + 1))?;
    if at != chars.len() || severe < major {
        return None;
    }
    Some(DamageThresholds { major, severe })
}

/// Which band incoming damage lands in; Massive only under the optional rule.
pub fn severity_for(amount: f64, thresholds: &DamageThresholds, massive_damage: bool) -> DamageSeverity {
    if amount <= 0.0 {
        DamageSeverity::None
    } else if massive_damage && amount >= thresholds.severe * 2.0 {
        DamageSeverity::Massive
    } else if amount >= thresholds.severe {
        DamageSeverity::Severe
    } else if amount >= thresholds.major {
        DamageSeverity::Major
    } else {
        DamageSeverity::Minor
    }
}

/// A PC's thresholds: the armor's plus the level; unarmored, the level and twice it.
pub fn pc_thresholds(level: f64, armor: Option<&DamageThresholds>) -> DamageThresholds {
    match armor {
        None => DamageThresholds { major: level, severe: level * 2.0 },
        Some(armor) => DamageThresholds { major: armor.major + level, severe: armor.severe + level },
    }
}

pub const MAX_ARMOR_SCORE: f64 = 12.0;

/// Armor Slots available: base plus bonuses, in [0, 12].
pub fn armor_score(base: f64, bonus: f64) -> f64 {
    js::min(MAX_ARMOR_SCORE, js::max(0.0, base + bonus))
}

/// Damage taken off before thresholds: "3", "1d10", only against one type or every kind.
#[derive(Clone, Debug, PartialEq)]
pub struct DamageReduction {
    pub dice: String,
    pub only: Option<DamageType>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DamageDefenses {
    pub resistances: Vec<DamageType>,
    pub immunities: Vec<DamageType>,
    pub reduce: Vec<DamageReduction>,
}

fn reduces(entry: &DamageReduction, types: &[DamageType]) -> bool {
    entry.only.is_none_or(|only| types.contains(&only))
}

/// The half of a creature's reduction that needs no dice.
pub fn flat_reduction(types: &[DamageType], defenses: &DamageDefenses) -> f64 {
    defenses.reduce.iter().filter(|entry| reduces(entry, types)).map(|entry| parse_dice(&entry.dice).map_or(0.0, |parsed| parsed.expression.modifier)).sum()
}

/// Whether any reduction still has dice to roll.
pub fn reduction_rolls(defenses: &DamageDefenses) -> bool {
    defenses.reduce.iter().any(|entry| parse_dice(&entry.dice).is_some_and(|parsed| parsed.expression.count > 0.0))
}

/// Roll the dice half of a creature's reduction, once per damage event; nothing off the stream when
/// there is nothing to roll.
pub fn roll_reduction(rng: &mut Rng, types: &[DamageType], defenses: &DamageDefenses) -> Result<f64, RangeError> {
    let mut total = 0.0;
    for entry in defenses.reduce.iter().filter(|entry| reduces(entry, types)) {
        let Some(parsed) = parse_dice(&entry.dice) else { continue };
        if parsed.expression.count == 0.0 {
            continue;
        }
        total += roll_dice(rng, &DiceExpression { modifier: 0.0, ..parsed.expression })?.total;
    }
    Ok(total)
}

/// Resistance halves, rounding up; immunity ignores; damage of two types is only halved or ignored when
/// the target has it for both.
pub fn apply_defenses(amount: f64, types: &[DamageType], defenses: &DamageDefenses) -> f64 {
    if amount <= 0.0 {
        return 0.0;
    }
    if types.is_empty() {
        return amount;
    }
    if types.iter().all(|t| defenses.immunities.contains(t)) {
        return 0.0;
    }
    if types.iter().all(|t| defenses.resistances.contains(t) || defenses.immunities.contains(t)) {
        return (amount / 2.0).ceil();
    }
    amount
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CriticalRule {
    /// The official text: add the maximum the damage dice can show.
    MaxDicePlusRoll,
    /// A community reading: double the dice.
    DoubleDice,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DamageRollOptions {
    pub proficiency: f64,
    pub critical: bool,
    pub critical_rule: CriticalRule,
    pub bonus: f64,
}

impl Default for DamageRollOptions {
    fn default() -> Self {
        DamageRollOptions { proficiency: 1.0, critical: false, critical_rule: CriticalRule::MaxDicePlusRoll, bonus: 0.0 }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DamageRollResult {
    pub roll: DiceRoll,
    /// The expression actually rolled, after Proficiency.
    pub expression: DiceExpression,
    pub critical: bool,
    pub critical_bonus: f64,
    pub bonus: f64,
    pub total: f64,
}

/// Roll damage: Proficiency scales the dice, a critical adds its bonus, and a flat bonus goes on last.
pub fn roll_damage(rng: &mut Rng, expression: &DiceExpression, options: &DamageRollOptions) -> Result<DamageRollResult, RangeError> {
    let expression = with_proficiency(expression, options.proficiency);
    let roll = roll_dice(rng, &expression)?;
    let critical_bonus = if !options.critical {
        0.0
    } else if options.critical_rule == CriticalRule::DoubleDice {
        roll.dice_total
    } else {
        max_dice(&expression)
    };
    let total = roll.total + critical_bonus + options.bonus;
    Ok(DamageRollResult { roll, expression, critical: options.critical, critical_bonus, bonus: options.bonus, total })
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct IncomingDamage {
    pub amount: f64,
    pub types: Vec<DamageType>,
    /// Direct damage cannot be reduced by Armor Slots.
    pub direct: bool,
    /// The band named outright, with no number to compare.
    pub severity: Option<DamageSeverity>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResolveDamageOptions {
    pub massive_damage: bool,
    pub armor_slots_marked: Option<f64>,
    pub armor_slots_available: Option<f64>,
    pub defenses: DamageDefenses,
    pub rolled_reduction: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResolvedDamage {
    pub incoming: f64,
    pub reduced: f64,
    pub severity: DamageSeverity,
    pub final_severity: DamageSeverity,
    pub armor_slots_spent: f64,
    pub hp_marked: f64,
}

/// One damage event end to end: defenses, reduction, thresholds, Armor Slots, Hit Points.
pub fn resolve_damage(damage: &IncomingDamage, thresholds: &DamageThresholds, options: &ResolveDamageOptions) -> ResolvedDamage {
    let halved = apply_defenses(damage.amount, &damage.types, &options.defenses);
    let reduction = if halved <= 0.0 { 0.0 } else { flat_reduction(&damage.types, &options.defenses) + js::max(0.0, js::trunc(options.rolled_reduction.unwrap_or(0.0))) };
    let incoming = js::max(0.0, halved - reduction);
    let severity = damage.severity.unwrap_or_else(|| severity_for(incoming, thresholds, options.massive_damage));
    let wanted = if damage.direct { 0.0 } else { js::max(0.0, js::trunc(options.armor_slots_marked.unwrap_or(0.0))) };
    let available = js::max(0.0, js::trunc(options.armor_slots_available.unwrap_or(wanted)));
    let useful = f64::from(severity as u8);
    let armor_slots_spent = js::min(js::min(wanted, available), useful);
    let final_severity = reduce_severity(severity, armor_slots_spent);
    ResolvedDamage { incoming, reduced: halved - incoming, severity, final_severity, armor_slots_spent, hp_marked: hp_for_severity(final_severity) }
}
