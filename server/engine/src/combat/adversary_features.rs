//! What a stat block's features add up to (`src/engine/combat/adversary-features.ts`): the handful the
//! engine runs by name - Relentless, Momentum, Terrifying, Horde, Minion - read off the feature's name and
//! the bit in its brackets. Everything else is the GM's to play.

use crate::js;
use crate::rules::dice::{parse_dice, ParsedDamage};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeatureKind {
    Passive,
    Action,
    Reaction,
}

/// A stat block's feature, as the content schema reads it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdversaryFeature {
    pub name: String,
    pub kind: FeatureKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub countdown: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_term_countdown: Option<bool>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub costs_gm_resource: bool,
}

/// What a stat block's features add up to, for the code that has to obey them.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AdversaryTraits {
    /// How many times it can be spotlighted in one GM turn. One unless Relentless.
    pub spotlights: f64,
    pub momentum: bool,
    pub terrifying: bool,
    /// Horde (X): the damage its standard attack deals once half its Hit Points are marked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horde: Option<ParsedDamage>,
    /// Minion (X): defeated by any damage, and one more per X damage dealt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minion: Option<f64>,
}

/// `/\(([^)]+)\)/`: the first bracketed run of at least one character.
fn in_brackets(name: &str) -> Option<&str> {
    let mut from = 0;
    while let Some(open) = name[from..].find('(').map(|i| from + i) {
        let inner = open + 1;
        match name[inner..].find(')') {
            None => return None,
            Some(0) => from = inner,
            Some(len) => return Some(&name[inner..inner + len]),
        }
    }
    None
}

/// The bit in brackets, from the parameter the importer kept or the name itself.
fn parameter_of(feature: &AdversaryFeature) -> Option<&str> {
    match feature.parameter.as_deref() {
        Some(parameter) if !parameter.is_empty() => Some(parameter),
        _ => in_brackets(&feature.name),
    }
}

/// `name.split('(')[0].trim().toLowerCase()`.
fn base_name(feature: &AdversaryFeature) -> String {
    let before = feature.name.split('(').next().unwrap_or_default();
    js::trim(before).to_lowercase()
}

/// `text.replace(/\s*(phy|mag)\w*/i, '')`: the first damage type word, and the space before it, gone.
fn without_damage_type(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    for start in 0..chars.len() {
        let mut at = start;
        while at < chars.len() && js::is_space(chars[at]) {
            at += 1;
        }
        let word: String = chars[at..(at + 3).min(chars.len())].iter().collect::<String>().to_ascii_lowercase();
        if word != "phy" && word != "mag" {
            continue;
        }
        let mut end = at + 3;
        while end < chars.len() && (chars[end].is_ascii_alphanumeric() || chars[end] == '_') {
            end += 1;
        }
        return chars[..start].iter().chain(&chars[end..]).collect();
    }
    text.to_string()
}

/// The features this engine runs, by name. Everything else is the GM's to play.
pub const IMPLEMENTED_FEATURES: [&str; 5] = ["relentless", "momentum", "terrifying", "horde", "minion"];

pub fn adversary_traits(features: &[AdversaryFeature]) -> AdversaryTraits {
    let mut traits = AdversaryTraits { spotlights: 1.0, momentum: false, terrifying: false, horde: None, minion: None };
    for feature in features {
        let name = base_name(feature);
        let parameter = parameter_of(feature);
        let count = |fallback: f64| {
            let n = parameter.map_or(f64::NAN, js::number_of);
            if n.is_finite() && n > 0.0 {
                n.floor()
            } else {
                fallback
            }
        };
        match name.as_str() {
            "relentless" => traits.spotlights = count(2.0),
            "momentum" => traits.momentum = true,
            "terrifying" => traits.terrifying = true,
            "horde" => {
                if let Some(damage) = parameter.and_then(|p| parse_dice(js::trim(&without_damage_type(p)))) {
                    traits.horde = Some(damage);
                }
            }
            "minion" => traits.minion = Some(count(1.0)),
            _ => {}
        }
    }
    traits
}

/// Whether the engine runs this feature, for the doc that has to say so.
pub fn is_feature_implemented(feature: &AdversaryFeature) -> bool {
    IMPLEMENTED_FEATURES.contains(&base_name(feature).as_str())
}

/// The damage a stat block's standard attack deals now: a horde's reduced damage once half its Hit
/// Points are marked, its own otherwise.
pub fn attack_damage_of(features: &[AdversaryFeature], attack_damage: &ParsedDamage, marked: f64, max: f64) -> ParsedDamage {
    let traits = adversary_traits(features);
    match traits.horde {
        Some(horde) if max != 0.0 && marked * 2.0 >= max => horde,
        _ => attack_damage.clone(),
    }
}
