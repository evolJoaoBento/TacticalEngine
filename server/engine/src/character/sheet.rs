//! Character sheets (`src/engine/character/sheet.ts`): where a class, an ancestry and a pile of equipment
//! become the numbers the rules consume - Evasion, thresholds, Armor Slots, Hit Points, Stress, Light,
//! and the attack a weapon makes. A sheet names its content by id; an id the content lacks is reported
//! and the character is derived without it, as the TypeScript does.

use crate::combat::attack::{AttackProfile, AttackerKind, DefenderProfile};
use crate::character::progression::{held_cards, progression_bonuses, subclass_stage, tier_of, LevelRecord, Tier};
use crate::content::abilities::{abilities_for, AbilityDef, AbilityModifier, Requires, Stat};
use crate::content::features::gear_effects;
use crate::content::pack::{CardDef, CardGrant, ContentPack, SubclassDef, WeaponDef, WeaponTrait};
use crate::js;
use crate::rules::damage::{armor_score, pc_thresholds, DamageThresholds};
use crate::rules::dice::{DamageType, DiceExpression, ParsedDamage};
use crate::rules::jump::{Trait, Traits};
use crate::rules::range::RangeBand;
use crate::rules::resources::{create_good, create_mark_pool, Currency, MarkPool, MAX_GOOD, MAX_SLOTS, STARTING_GOOD, STARTING_STRESS_SLOTS};
use serde::{Deserialize, Serialize};

/// An Experience, spendable for a Light: "Tremor Sense +2".
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Experience {
    pub name: String,
    pub modifier: f64,
}

/// Flat adjustments from advancements, features or items.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bonuses {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evasion: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hit_points: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stress: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub armor_score: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub major_threshold: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severe_threshold: Option<f64>,
}

/// Authored: what a character *is*. Runtime marks live in the scene.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSheet {
    pub id: String,
    pub name: String,
    pub level: f64,
    pub class_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ancestry_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub community_id: Option<String>,
    pub traits: Traits,
    pub proficiency: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_weapon_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondary_weapon_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub armor_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experiences: Option<Vec<Experience>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subclass_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_cards: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loadout: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub levels: Option<Vec<LevelRecord>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scars: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bonuses: Option<Bonuses>,
}

/// A sheet with the SRD's level-1 defaults, for a quick character or a test.
pub fn blank_sheet(id: &str, class_id: &str) -> CharacterSheet {
    CharacterSheet {
        id: id.into(),
        name: id.into(),
        level: 1.0,
        class_id: class_id.into(),
        ancestry_id: None,
        community_id: None,
        traits: Traits::default(),
        proficiency: 1.0,
        primary_weapon_id: None,
        secondary_weapon_id: None,
        armor_id: None,
        experiences: None,
        subclass_id: None,
        domain_cards: None,
        loadout: None,
        levels: None,
        scars: None,
        model: None,
        bonuses: None,
    }
}

/// Everything derived from a sheet, computed once per change rather than per read.
#[derive(Clone, Debug, PartialEq)]
pub struct DerivedCharacter {
    pub sheet: CharacterSheet,
    /// The subclass, when the sheet names one the content has.
    pub subclass: Option<SubclassDef>,
    /// The trait a Spellcast Roll uses, from the subclass.
    pub spellcast_trait: Option<Trait>,
    /// Every card chosen and held: the two from level 1 and one per level since.
    pub cards: Vec<CardDef>,
    /// The cards in play without being chosen, in the content's order.
    pub granted: Vec<CardDef>,
    /// The modifiers the character's abilities and gear grant, those whose `requires` the sheet meets.
    pub modifiers: Vec<AbilityModifier>,
    pub proficiency: f64,
    pub traits: Traits,
    pub experiences: Vec<Experience>,
    pub evasion: f64,
    pub thresholds: DamageThresholds,
    pub armor_score: f64,
    pub hit_points: f64,
    pub stress: f64,
    pub good: Currency,
    pub primary_weapon: Option<WeaponDef>,
    pub secondary_weapon: Option<WeaponDef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SheetIssue {
    pub sheet: String,
    pub field: &'static str,
    pub message: String,
}

/// Bare Bones' base thresholds by tier: "Tier 1: 9/19, Tier 2: 11/24, Tier 3: 13/31, Tier 4: 15/38".
fn bare_bones_thresholds(tier: Tier) -> DamageThresholds {
    let (major, severe) = match tier {
        1 => (9.0, 19.0),
        2 => (11.0, 24.0),
        3 => (13.0, 31.0),
        _ => (15.0, 38.0),
    };
    DamageThresholds { major, severe }
}

/// Work out a character's numbers. Unknown content ids are reported rather than refused: a party with
/// one bad weapon reference is still playable, the character simply fights unarmed.
pub fn derive_character(sheet: &CharacterSheet, content: &ContentPack, abilities: &[AbilityDef]) -> (DerivedCharacter, Vec<SheetIssue>) {
    let mut issues: Vec<SheetIssue> = Vec::new();
    let mut issue = |field: &'static str, message: String| issues.push(SheetIssue { sheet: sheet.id.clone(), field, message });

    let klass = content.classes.get(&sheet.class_id);
    if klass.is_none() {
        issue("class", format!("unknown class \"{}\"", sheet.class_id));
    }
    if let Some(id) = sheet.ancestry_id.as_deref().filter(|id| !content.ancestries.has(id)) {
        issue("ancestry", format!("unknown ancestry \"{id}\""));
    }
    if let Some(id) = sheet.community_id.as_deref().filter(|id| !content.communities.has(id)) {
        issue("community", format!("unknown community \"{id}\""));
    }
    let armor = sheet.armor_id.as_deref().and_then(|id| content.armors.get(id));
    if let Some(id) = sheet.armor_id.as_deref().filter(|_| armor.is_none()) {
        issue("armor", format!("unknown armor \"{id}\""));
    }
    let mut weapon = |id: Option<&str>, field: &'static str| -> Option<WeaponDef> {
        let id = id?;
        let found = content.weapons.get(id).cloned();
        if found.is_none() {
            issue(field, format!("unknown {field} \"{id}\""));
        }
        found
    };
    let primary_weapon = weapon(sheet.primary_weapon_id.as_deref(), "primaryWeapon");
    let secondary_weapon = weapon(sheet.secondary_weapon_id.as_deref(), "secondaryWeapon");

    let bonuses = sheet.bonuses.clone().unwrap_or_default();
    let mut subclass: Option<SubclassDef> = None;
    if let Some(id) = sheet.subclass_id.as_deref() {
        subclass = content.subclasses.get(id).cloned();
        match &subclass {
            None => issue("subclass", format!("unknown subclass \"{id}\"")),
            Some(found) if found.class_id != sheet.class_id => {
                issue("subclass", format!("subclass \"{id}\" belongs to {}, not {}", found.class_id, sheet.class_id));
            }
            Some(_) => {}
        }
    }
    let mut cards: Vec<CardDef> = Vec::new();
    for id in held_cards(sheet) {
        match content.cards.get(&id) {
            None => issue("domainCard", format!("unknown domainCard \"{id}\"")),
            // A granted card is in play because of what the character is; holding it as well would put
            // it in the loadout a second time.
            Some(card) if !card.is_domain_card() => issue("domainCard", format!("\"{id}\" is not a card a character chooses")),
            Some(card) => cards.push(card.clone()),
        }
    }
    let granted: Vec<CardDef> = granted_cards(sheet, content.cards.iter()).into_iter().cloned().collect();
    let grown = progression_bonuses(sheet);

    // What the gear's features plainly say, counted while it is worn or wielded.
    let gear_features = primary_weapon.iter().flat_map(|w| &w.features).chain(secondary_weapon.iter().flat_map(|w| &w.features)).chain(armor.iter().flat_map(|a| &a.features));
    let gear = gear_effects(gear_features);
    let mut traits = sheet.traits;
    for (t, n) in grown.traits.iter() {
        *traits.of_mut(t) += n;
    }
    for (t, n) in gear.traits.iter() {
        *traits.of_mut(t) += n;
    }
    let experiences: Vec<Experience> = sheet
        .experiences
        .iter()
        .flatten()
        .map(|e| Experience { name: e.name.clone(), modifier: e.modifier + grown.experience(&e.name).unwrap_or(0.0) })
        .collect();

    // What the held abilities add. `requires` is the sheet's to answer here; `when` is the scene's.
    let held = abilities_for(sheet.loadout.as_deref(), &cards, &granted, abilities);
    let armored = armor.is_some();
    let mut modifiers: Vec<AbilityModifier> = held
        .iter()
        .flat_map(|ability| &ability.modifiers)
        .filter(|m| match m.requires {
            None | Some(Requires::MeleeWeapon) => true,
            Some(requires) => (requires == Requires::Armored) == armored,
        })
        .cloned()
        .collect();
    modifiers.extend(gear.modifiers);

    // Folded into the numbers: no `when`, no tokens, and not only while swinging a Melee weapon.
    let folds = |m: &&AbilityModifier, stat: Stat| m.stat == stat && m.when.is_none() && m.per_token.is_none() && m.requires != Some(Requires::MeleeWeapon);
    // Proficiency first, because a modifier may add it to something else.
    let proficiency = js::max(1.0, sheet.proficiency + grown.proficiency + modifiers.iter().filter(|m| folds(m, Stat::Proficiency)).fold(0.0, |sum, m| sum + m.bonus));
    let folded = |stat: Stat| -> f64 {
        modifiers
            .iter()
            .filter(|m| folds(m, stat))
            .fold(0.0, |sum, m| sum + m.bonus + trait_part(m.plus_trait, m.halve_trait, &traits) + if m.plus_proficiency == Some(true) { proficiency } else { 0.0 })
    };

    // "A PC's damage thresholds are calculated by adding their level to the listed damage thresholds of
    // their equipped armor." Unarmoured is level / twice level - unless Bare Bones rewrites the base.
    let bare_bones = armor.is_none() && modifiers.iter().any(|m| m.stat == Stat::BareBones && m.when.is_none());
    let base_thresholds = if bare_bones { Some(bare_bones_thresholds(tier_of(sheet.level))) } else { armor.map(|a| a.base_thresholds) };
    let base = pc_thresholds(sheet.level, base_thresholds.as_ref());
    let thresholds = DamageThresholds {
        major: base.major + bonuses.major_threshold.unwrap_or(0.0) + folded(Stat::MajorThreshold) + folded(Stat::Thresholds),
        severe: base.severe + bonuses.severe_threshold.unwrap_or(0.0) + folded(Stat::SevereThreshold) + folded(Stat::Thresholds),
    };

    let character = DerivedCharacter {
        spellcast_trait: subclass.as_ref().and_then(|s| s.spellcast_trait),
        evasion: klass.map_or(10.0, |k| k.starting_evasion) + bonuses.evasion.unwrap_or(0.0) + grown.evasion + folded(Stat::Evasion),
        // "While unarmored, your character's base Armor Score is 0." Bare Bones: 3 + Strength.
        armor_score: armor_score(if bare_bones { 3.0 + traits.strength } else { armor.map_or(0.0, |a| a.base_score) }, bonuses.armor_score.unwrap_or(0.0) + folded(Stat::ArmorScore)),
        hit_points: js::min(MAX_SLOTS, klass.map_or(5.0, |k| k.starting_hit_points) + bonuses.hit_points.unwrap_or(0.0) + grown.hit_points + folded(Stat::HitPoints)),
        stress: js::min(MAX_SLOTS, STARTING_STRESS_SLOTS + bonuses.stress.unwrap_or(0.0) + grown.stress + folded(Stat::Stress)),
        // A scar is permanent, so every scene the character walks into starts a Light short.
        good: create_good(STARTING_GOOD, js::max(0.0, MAX_GOOD - sheet.scars.unwrap_or(0.0))),
        sheet: sheet.clone(),
        subclass,
        cards,
        granted,
        proficiency,
        traits,
        experiences,
        thresholds,
        modifiers,
        primary_weapon,
        secondary_weapon,
    };
    (character, issues)
}

/// The cards in play for a sheet without being chosen: whatever grants a card to its class, to its
/// subclass up to the stage reached, to its ancestry, to its community, or to it by name. In the order
/// the cards come.
pub fn granted_cards<'a>(sheet: &CharacterSheet, cards: impl IntoIterator<Item = &'a CardDef>) -> Vec<&'a CardDef> {
    let reached = subclass_stage(sheet);
    cards.into_iter().filter(|card| granted_to(&card.grant, sheet, reached)).collect()
}

/// The cards the conditions on a creature lend it: every card lent by a condition it bears.
pub fn lent_cards<'a>(conditions: &[String], cards: impl IntoIterator<Item = &'a CardDef>) -> Vec<&'a CardDef> {
    if conditions.is_empty() {
        return Vec::new();
    }
    cards.into_iter().filter(|card| matches!(&card.grant, CardGrant::Condition { conditions: lends } if lends.iter().any(|id| conditions.contains(id)))).collect()
}

/// Whether a card's grant puts it in play for this sheet. A chosen card is the loadout's to say, and
/// what a condition lends is the world's to hand over while it lasts, never the sheet's.
fn granted_to(grant: &CardGrant, sheet: &CharacterSheet, reached: crate::content::pack::SubclassStage) -> bool {
    match grant {
        CardGrant::Chosen | CardGrant::Adversary { .. } | CardGrant::Condition { .. } => false,
        CardGrant::Class { class_id } => *class_id == sheet.class_id,
        CardGrant::Subclass { subclass_id, stage } => sheet.subclass_id.as_ref() == Some(subclass_id) && *stage <= reached,
        CardGrant::Ancestry { ancestry_id } => sheet.ancestry_id.as_ref() == Some(ancestry_id),
        CardGrant::Community { community_id } => sheet.community_id.as_ref() == Some(community_id),
        CardGrant::Given { characters } => characters.contains(&sheet.id),
    }
}

/// "Successful unarmed attacks inflict [Proficiency]d4 damage", at Melee, with Strength.
pub fn unarmed_damage() -> ParsedDamage {
    ParsedDamage { expression: DiceExpression { count: 1.0, sides: 4.0, modifier: 0.0 }, types: Some(vec![DamageType::Physical]) }
}
pub const UNARMED_RANGE: RangeBand = RangeBand::Melee;
pub const UNARMED_TRAIT: Trait = Trait::Strength;

/// The trait a weapon swings with in these hands: its own, or - for one that says Spellcast - the
/// wielder's spellcast trait. Somebody who casts with nothing swings it with Knowledge.
pub fn wielded_trait(spellcast_trait: Option<Trait>, weapon: WeaponTrait) -> Trait {
    match weapon {
        WeaponTrait::Trait(t) => t,
        WeaponTrait::Spellcast(_) => spellcast_trait.unwrap_or(Trait::Knowledge),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hand {
    Primary,
    Secondary,
}

/// The attack a character makes with a weapon: "the trait that applies to an attack roll is specified by
/// the weapon or spell being used", and a character with no weapon punches.
pub fn attack_profile(character: &DerivedCharacter, which: Hand) -> AttackProfile {
    let weapon = match which {
        Hand::Primary => character.primary_weapon.as_ref(),
        Hand::Secondary => character.secondary_weapon.as_ref(),
    };
    let traits = &character.traits;
    let (name, trait_, range, damage) = match weapon {
        None => ("Unarmed".to_string(), UNARMED_TRAIT, UNARMED_RANGE, unarmed_damage()),
        Some(weapon) => (weapon.name.clone(), wielded_trait(character.spellcast_trait, weapon.trait_), weapon.range, weapon.damage.clone()),
    };
    AttackProfile {
        kind: AttackerKind::Pc,
        name,
        modifier: DiceExpression { count: 0.0, sides: 0.0, modifier: traits.of(trait_) },
        trait_: Some(trait_),
        range,
        damage,
        proficiency: Some(character.proficiency),
        direct: None,
        double: None,
    }
}

/// What a modifier's trait half is worth: the trait, or half of it rounded up.
pub fn trait_part(plus_trait: Option<Trait>, halve_trait: Option<bool>, traits: &Traits) -> f64 {
    let Some(t) = plus_trait else { return 0.0 };
    let value = traits.of(t);
    if halve_trait == Some(true) {
        (value / 2.0).ceil()
    } else {
        value
    }
}

/// How this character is attacked: Evasion and thresholds.
pub fn defender_profile(character: &DerivedCharacter) -> DefenderProfile {
    DefenderProfile { difficulty: character.evasion, thresholds: character.thresholds, defenses: None }
}

/// The starting pools for a character entering a scene.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartingPools {
    pub hit_points: MarkPool,
    pub stress: MarkPool,
    pub armor_slots: MarkPool,
    pub good: Currency,
}

pub fn starting_pools(character: &DerivedCharacter) -> StartingPools {
    StartingPools {
        hit_points: create_mark_pool(character.hit_points, 0.0),
        stress: create_mark_pool(character.stress, 0.0),
        armor_slots: create_mark_pool(character.armor_score, 0.0),
        good: character.good,
    }
}
