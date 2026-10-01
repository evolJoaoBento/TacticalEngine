//! Abilities (`src/engine/content/abilities.ts`): which card each sits on, the bonuses it grants while
//! held, which of a character's abilities are in play, in the order the action bar lists them, and what
//! the world reads off one - a reaction's trigger and gate, a passive's defences and swing, a card's
//! tokens and the lift they give a roll - and, for the fight, its text, its target and its uses.

use crate::content::pack::{CardDef, CardGrant};
use crate::rules::damage::{DamageDefenses, DamageSeverity};
use crate::rules::dice::DamageType;
use crate::rules::jump::Trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// How many domain cards can be active at once. The rest wait in the vault.
pub const LOADOUT_LIMIT: usize = 5;

/// What a modifier adds to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Stat {
    Evasion,
    ArmorScore,
    MajorThreshold,
    SevereThreshold,
    Thresholds,
    AttackRoll,
    DamageRoll,
    SpellcastRoll,
    ActionRoll,
    Proficiency,
    HitPoints,
    Stress,
    BareBones,
    Advantage,
}

/// What the sheet must be for a modifier to count: armour on or off, or a Melee weapon in hand.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Requires {
    Unarmored,
    Armored,
    MeleeWeapon,
}

/// A bonus an ability grants while held (`abilityModifierSchema`, after parsing: `bonus` defaults to 0).
/// `when` reads the scene, and is kept as the JSON it was written in until the conditions are ported.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityModifier {
    pub stat: Stat,
    #[serde(default)]
    pub bonus: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plus_trait: Option<Trait>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub halve_trait: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plus_proficiency: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires: Option<Requires>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub any_roll: Option<bool>,
}

impl AbilityModifier {
    /// `{ stat, bonus }` and nothing else, as `abilityModifierSchema.parse` makes it.
    pub fn flat(stat: Stat, bonus: f64) -> Self {
        AbilityModifier { stat, bonus, plus_trait: None, halve_trait: None, plus_proficiency: None, per_token: None, requires: None, when: None, against: None, any_roll: None }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AbilitySource {
    pub card: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AbilityKind {
    #[default]
    Action,
    Reaction,
    Passive,
}

/// What using it costs: Light, Stress, the GM's Shadow.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct AbilityCost {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub good: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stress: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bad: Option<f64>,
}

fn one() -> f64 {
    1.0
}

fn either() -> String {
    "either".into()
}

/// What a reaction to incoming damage does, once its cost is paid (`damageReactionSchema`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DamageReaction {
    /// Step the severity down, `only` narrowing it to one band.
    ReduceSeverity {
        #[serde(default = "one")]
        steps: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        only: Option<DamageSeverity>,
    },
    /// Roll dice off the damage before thresholds.
    ReduceDamage { dice: String },
    /// Mark more Armor Slots than the one.
    ExtraArmor {
        #[serde(default = "one")]
        slots: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        only: Option<DamageType>,
    },
    /// Stand in the way: the attack lands on the holder instead. Always asked.
    Redirect,
    /// Reroll the attack or the damage. Always asked.
    Reroll {
        #[serde(default = "either")]
        what: String,
    },
}

fn yes() -> bool {
    true
}

/// An ability, cut to what the engine's ported parts read: the card it sits on, its bonuses, and - for a
/// reaction - its kind, trigger, gate, cost and what it does; a passive's defences and swing; its tokens;
/// its text, target and uses, which a stat block's feature is chosen by. Conditions and effects are kept as
/// the JSON the script's schema read.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityDef {
    pub id: String,
    /// Required by the schema; left out only by fixtures that never show it.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    pub source: AbilitySource,
    /// The rules text, as printed.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    /// How often it can be used before something refreshes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uses: Option<AbilityUses>,
    /// What the user picks: nobody, themselves, a creature, a point - and how far away.
    #[serde(default, skip_serializing_if = "AbilityTarget::is_default")]
    pub target: AbilityTarget,
    #[serde(default)]
    pub modifiers: Vec<AbilityModifier>,
    #[serde(default)]
    pub kind: AbilityKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    #[serde(default)]
    pub cost: AbilityCost,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reaction: Option<DamageReaction>,
    /// Whether a reaction the policy allows fires without being asked.
    #[serde(default = "yes")]
    pub auto: bool,
    /// When a reaction may be offered, read with its holder acting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<Value>,
    /// The damage types a passive halves or ignores, and what it takes off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defenses: Option<DamageDefenses>,
    /// What a passive says about the swing a stat block prints.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub standard_attack: Option<StandardAttack>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<AbilityTokens>,
    /// Tokens spent to carry a roll over its Difficulty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lift: Option<Lift>,
}

/// "Once per scene": how many times, and what gives them back.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AbilityUses {
    #[serde(default = "one")]
    pub count: f64,
    /// `rest`, `longRest` or `scene`.
    pub per: String,
}

/// What an ability is aimed at (`abilityTargetSchema`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AbilityTarget {
    /// `none`, `self`, `adversary`, `ally`, `creature`, `group` or `point`.
    #[serde(default = "none")]
    pub kind: String,
    #[serde(default = "melee")]
    pub range: crate::rules::range::RangeBand,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallen: Option<bool>,
    /// What makes a creature worth aiming at, read with it bound as the target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<Value>,
}

fn none() -> String {
    "none".into()
}

fn melee() -> crate::rules::range::RangeBand {
    crate::rules::range::RangeBand::Melee
}

impl Default for AbilityTarget {
    fn default() -> Self {
        AbilityTarget { kind: none(), range: melee(), fallen: None, when: None }
    }
}

impl AbilityTarget {
    fn is_default(&self) -> bool {
        *self == AbilityTarget::default()
    }
}

/// "The Ogre's attacks deal direct damage", "1d10+4 instead of their standard damage", "double damage to PCs
/// with 0 Light": a passive's word on the block's own swing, `when` read from the attacker's chair.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct StandardAttack {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direct: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub double: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<DamageSeverity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<Value>,
}

/// How many tokens a card places: a number, a trait, the Spellcast trait, or the loadout's cards of a domain.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TokenAmount {
    Count(f64),
    Read(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AbilityTokens {
    pub amount: TokenAmount,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default)]
    pub minimum: f64,
}

fn any() -> String {
    "any".into()
}

/// Each token spent adds `each` to the roll; `only` a Spellcast Roll, or any.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Lift {
    #[serde(default = "one")]
    pub each: f64,
    #[serde(default = "any")]
    pub only: String,
}

/// Whether a reaction fires without asking: one that is `auto`, and neither stands in the way nor rerolls
/// - those are always the player's to choose.
pub fn is_automatic(ability: &AbilityDef) -> bool {
    match &ability.reaction {
        None => false,
        Some(_) if !ability.auto => false,
        Some(reaction) => !matches!(reaction, DamageReaction::Redirect | DamageReaction::Reroll { .. }),
    }
}

/// The ids of the cards in the loadout: the sheet's own list, cut to cards held, or the first five held.
pub fn loadout_of(loadout: Option<&[String]>, cards: &[CardDef]) -> Vec<String> {
    let held: Vec<&str> = cards.iter().map(|card| card.id.as_str()).collect();
    match loadout {
        None => held.iter().take(LOADOUT_LIMIT).map(|id| id.to_string()).collect(),
        Some(chosen) => chosen.iter().filter(|id| held.contains(&id.as_str())).take(LOADOUT_LIMIT).cloned().collect(),
    }
}

/// Where a granted card's abilities sit on the bar: the class first, then the subclass by stage, the
/// loadout, the ancestry, the community, whatever a project handed over, and what a condition lends.
pub fn grant_rank(grant: &CardGrant) -> u32 {
    match grant {
        CardGrant::Class { .. } => 0,
        CardGrant::Subclass { stage, .. } => 2 + stage.rank(),
        CardGrant::Chosen => 10,
        CardGrant::Ancestry { .. } => 50,
        CardGrant::Community { .. } => 60,
        CardGrant::Given { .. } => 100,
        CardGrant::Condition { .. } => 150,
        CardGrant::Adversary { .. } => 1000,
    }
}

/// The abilities in play for a character, in bar order: those on the cards granted to it, ranked by
/// grant, and those on the loadout's cards, at ten plus their place in it; ties in the list's order.
pub fn abilities_for<'a>(loadout: Option<&[String]>, cards: &[CardDef], granted: &[CardDef], abilities: &'a [AbilityDef]) -> Vec<&'a AbilityDef> {
    // `Map.set`: a card ranked twice keeps its first place in the map and its last rank.
    let mut rank: Vec<(String, u32)> = Vec::new();
    let mut set = |id: &str, at: u32| match rank.iter_mut().find(|(known, _)| known == id) {
        Some(entry) => entry.1 = at,
        None => rank.push((id.to_string(), at)),
    };
    for card in granted {
        set(&card.id, grant_rank(&card.grant));
    }
    for (index, id) in loadout_of(loadout, cards).iter().enumerate() {
        set(id, 10 + index as u32);
    }
    let mut ranked: Vec<(u32, usize, &AbilityDef)> = abilities
        .iter()
        .enumerate()
        .filter_map(|(index, ability)| rank.iter().find(|(id, _)| *id == ability.source.card).map(|&(_, at)| (at, index, ability)))
        .collect();
    ranked.sort_by_key(|&(at, index, _)| (at, index));
    ranked.into_iter().map(|(_, _, ability)| ability).collect()
}

/// The stat blocks whose features an ability is: the adversaries its card is printed on, or none for a card
/// anybody else holds.
pub fn stat_blocks_of<'a>(ability: &AbilityDef, cards: &'a [CardDef]) -> Option<&'a [String]> {
    match &cards.iter().find(|card| card.id == ability.source.card)?.grant {
        CardGrant::Adversary { adversaries } => Some(adversaries),
        _ => None,
    }
}
