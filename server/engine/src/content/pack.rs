//! The content a character is made of (`src/engine/content/pack/import.ts`): weapons, armour, classes,
//! ancestries, communities, subclasses and cards, in the normalized shape the TypeScript engine holds
//! once a pack is read - the JSON of each is what a `ContentPack` map's values serialize to.
//!
//! A table keeps the order its entries came in, as a `Map` does, because that order is read: the cards
//! granted to a sheet come in it. Laying one pack over another replaces an entry where it stands.

use crate::rules::damage::DamageThresholds;
use crate::rules::dice::ParsedDamage;
use crate::rules::jump::Trait;
use crate::rules::range::RangeBand;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PackFeature {
    pub name: String,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WeaponSlot {
    PrimaryPhysical,
    PrimaryMagic,
    Secondary,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Burden {
    OneHanded,
    TwoHanded,
}

/// A weapon's trait: one of the six, or `spellcast` - whatever its wielder casts with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WeaponTrait {
    Trait(Trait),
    Spellcast(SpellcastWord),
}

/// The word `spellcast`, on its own so an untagged `WeaponTrait` reads it as a string.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpellcastWord {
    Spellcast,
}

impl WeaponTrait {
    pub const SPELLCAST: WeaponTrait = WeaponTrait::Spellcast(SpellcastWord::Spellcast);
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WeaponDef {
    pub id: String,
    pub name: String,
    pub tier: f64,
    pub slot: WeaponSlot,
    #[serde(rename = "trait")]
    pub trait_: WeaponTrait,
    pub range: RangeBand,
    pub damage: ParsedDamage,
    pub burden: Burden,
    pub features: Vec<PackFeature>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorDef {
    pub id: String,
    pub name: String,
    pub tier: f64,
    pub base_thresholds: DamageThresholds,
    pub base_score: f64,
    pub features: Vec<PackFeature>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassDef {
    pub id: String,
    pub name: String,
    pub domains: Vec<String>,
    pub starting_evasion: f64,
    pub starting_hit_points: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AncestryDef {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CommunityDef {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubclassDef {
    pub id: String,
    pub name: String,
    pub class_id: String,
    pub domains: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spellcast_trait: Option<Trait>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubclassStage {
    Foundation,
    Specialization,
    Mastery,
}

impl SubclassStage {
    pub fn name(self) -> &'static str {
        match self {
            SubclassStage::Foundation => "foundation",
            SubclassStage::Specialization => "specialization",
            SubclassStage::Mastery => "mastery",
        }
    }

    /// Its place in the order a subclass climbs: foundation 0, specialization 1, mastery 2.
    pub fn rank(self) -> u32 {
        self as u32
    }
}

/// What puts a card in play: chosen into a loadout, or granted by what a creature is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CardGrant {
    Chosen,
    Class { class_id: String },
    Subclass { subclass_id: String, stage: SubclassStage },
    Ancestry { ancestry_id: String },
    Community { community_id: String },
    Given { characters: Vec<String> },
    Adversary { adversaries: Vec<String> },
    Condition { conditions: Vec<String> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CardType {
    Ability,
    Spell,
    Grimoire,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDef {
    pub id: String,
    pub name: String,
    pub grant: CardGrant,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_: Option<CardType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recall_cost: Option<f64>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub features: Vec<PackFeature>,
}

impl CardDef {
    /// A card somebody chooses: granted by choice, with a domain, a type, a level and a Recall Cost.
    pub fn is_domain_card(&self) -> bool {
        self.grant == CardGrant::Chosen && self.domain.is_some() && self.type_.is_some() && self.level.is_some() && self.recall_cost.is_some()
    }
}

/// Anything a table can hold: it has an id.
pub trait Identified {
    fn id(&self) -> &str;
}

macro_rules! identified {
    ($($t:ty),*) => {$(
        impl Identified for $t {
            fn id(&self) -> &str {
                &self.id
            }
        }
    )*};
}
identified!(WeaponDef, ArmorDef, ClassDef, AncestryDef, CommunityDef, SubclassDef, CardDef);

/// Definitions by id, in the order they came - a `Map`'s order. Read from JSON as a list.
#[derive(Clone, Debug, PartialEq)]
pub struct Table<T> {
    entries: Vec<T>,
    at: HashMap<String, usize>,
}

impl<T> Default for Table<T> {
    fn default() -> Self {
        Table { entries: Vec::new(), at: HashMap::new() }
    }
}

impl<T: Identified> Table<T> {
    pub fn new(defs: impl IntoIterator<Item = T>) -> Self {
        let mut table = Table::default();
        for def in defs {
            table.set(def);
        }
        table
    }

    /// `Map.set`: a new id goes on the end, a known one is replaced where it stands.
    pub fn set(&mut self, def: T) {
        match self.at.get(def.id()) {
            Some(&index) => self.entries[index] = def,
            None => {
                self.at.insert(def.id().to_string(), self.entries.len());
                self.entries.push(def);
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<&T> {
        self.at.get(id).map(|&index| &self.entries[index])
    }

    pub fn has(&self, id: &str) -> bool {
        self.at.contains_key(id)
    }

    pub fn iter(&self) -> std::slice::Iter<'_, T> {
        self.entries.iter()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl<'de, T: Identified + Deserialize<'de>> Deserialize<'de> for Table<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Table::new(Vec::<T>::deserialize(deserializer)?))
    }
}

impl<T: Serialize> Serialize for Table<T> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.entries.serialize(serializer)
    }
}

/// Everything a character can name, by kind.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ContentPack {
    pub weapons: Table<WeaponDef>,
    pub armors: Table<ArmorDef>,
    pub classes: Table<ClassDef>,
    pub ancestries: Table<AncestryDef>,
    pub communities: Table<CommunityDef>,
    pub subclasses: Table<SubclassDef>,
    pub cards: Table<CardDef>,
}

/// A project's own definitions, any kind left out.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PackLists {
    pub weapons: Vec<WeaponDef>,
    pub armors: Vec<ArmorDef>,
    pub classes: Vec<ClassDef>,
    pub ancestries: Vec<AncestryDef>,
    pub communities: Vec<CommunityDef>,
    pub subclasses: Vec<SubclassDef>,
    pub cards: Vec<CardDef>,
}

/// `mergePack`: a project's definitions laid over the content it builds on, id for id.
pub fn merge_pack(base: &ContentPack, own: PackLists) -> ContentPack {
    fn lay<T: Identified + Clone>(into: &Table<T>, over: Vec<T>) -> Table<T> {
        let mut merged = into.clone();
        for def in over {
            merged.set(def);
        }
        merged
    }
    ContentPack {
        weapons: lay(&base.weapons, own.weapons),
        armors: lay(&base.armors, own.armors),
        classes: lay(&base.classes, own.classes),
        ancestries: lay(&base.ancestries, own.ancestries),
        communities: lay(&base.communities, own.communities),
        subclasses: lay(&base.subclasses, own.subclasses),
        cards: lay(&base.cards, own.cards),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ancestry(id: &str, name: &str) -> AncestryDef {
        AncestryDef { id: id.into(), name: name.into() }
    }

    #[test]
    fn laying_a_pack_over_keeps_the_order_and_replaces_in_place() {
        let base = ContentPack { ancestries: Table::new([ancestry("a", "A"), ancestry("b", "B")]), ..ContentPack::default() };
        let own = PackLists { ancestries: vec![ancestry("c", "C"), ancestry("a", "A2")], ..PackLists::default() };
        let merged = merge_pack(&base, own);
        let names: Vec<&str> = merged.ancestries.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, ["A2", "B", "C"]);
        assert_eq!(merged.ancestries.get("a").map(|a| a.name.as_str()), Some("A2"));
        assert_eq!(base.ancestries.get("a").map(|a| a.name.as_str()), Some("A"));
    }

    #[test]
    fn a_weapon_trait_reads_a_trait_or_spellcast() {
        let spellcast: WeaponTrait = serde_json::from_str("\"spellcast\"").unwrap();
        let finesse: WeaponTrait = serde_json::from_str("\"finesse\"").unwrap();
        assert_eq!(spellcast, WeaponTrait::SPELLCAST);
        assert_eq!(finesse, WeaponTrait::Trait(Trait::Finesse));
        assert_eq!(serde_json::to_string(&spellcast).unwrap(), "\"spellcast\"");
        assert!(serde_json::from_str::<WeaponTrait>("\"luck\"").is_err());
    }
}
