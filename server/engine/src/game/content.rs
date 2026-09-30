//! The content a project is played with (`src/game/room.ts`, `worldOptions` and its helpers): what the app
//! ships, with the project's own laid over it id for id, and the world's content built from the two.
//!
//! What the app ships - the starter pack's characters with the equipment catalogue, its stat blocks, its
//! abilities, and the conditions, the starter pack's and then the rules' - is handed in (`Shipped`), not
//! embedded: the engine carries no content of its own, and where the server reads it from is the server's.
//! The TypeScript keeps a merged pack per project until one of its lists changes; here it is merged when
//! asked, which is when a sheet is written, not per frame.

use crate::character::sheet::DerivedCharacter;
use crate::content::abilities::AbilityDef;
use crate::content::adversaries::AdversaryDef;
use crate::content::conditions::ConditionDef;
use crate::content::items::LootTable;
use crate::content::pack::{merge_pack, ContentPack, PackLists};
use crate::rules::jump::Trait;
use crate::script::world::{Ordered, WorldContent};
use serde_json::{json, Value};
use std::collections::HashMap;

/// What the app ships, which a project builds on.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Shipped {
    /// Classes, ancestries, communities, subclasses, cards, and the weapons and armour - the pack's and the
    /// equipment catalogue's (`DEMO_CHARACTERS`).
    pub characters: ContentPack,
    /// The stat blocks, in the pack's order (`DEMO_ADVERSARIES`).
    pub adversaries: Vec<AdversaryDef>,
    /// What the shipped cards and blocks do, for a project that says nothing (`STARTER_ABILITIES`).
    pub abilities: Vec<AbilityDef>,
    /// The starter pack's conditions, then the rules' (`STARTER_CONDITIONS`, `SRD_CONDITIONS`).
    pub conditions: Vec<ConditionDef>,
    /// The equipment catalogue's items, by what the log calls them (`EQUIPMENT.items`).
    #[serde(default)]
    pub items: Vec<ItemName>,
}

/// An item, as far as a line of the log reads it.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct ItemName {
    pub id: String,
    pub name: String,
}

/// Every item a project can name, and what it is called (`itemsFor`): its own, then the catalogue's it has
/// not replaced.
pub fn items_for(shipped: &Shipped, project: &Value) -> Vec<ItemName> {
    let own: Vec<ItemName> = list(project, "items").iter().map(|i| ItemName { id: i["id"].as_str().unwrap_or_default().into(), name: i["name"].as_str().unwrap_or_default().into() }).collect();
    if own.is_empty() {
        return shipped.items.clone();
    }
    let mut all = own.clone();
    all.extend(shipped.items.iter().filter(|i| !own.iter().any(|o| o.id == i.id)).cloned());
    all
}

/// What one item is called (`itemOf`): the project's own, else the catalogue's.
pub fn item_name(shipped: &Shipped, project: &Value, id: &str) -> Option<String> {
    list(project, "items")
        .iter()
        .find(|i| i["id"].as_str() == Some(id))
        .and_then(|i| i["name"].as_str().map(str::to_string))
        .or_else(|| shipped.items.iter().find(|i| i.id == id).map(|i| i.name.clone()))
}

impl Shipped {
    pub fn adversary(&self, id: &str) -> Option<&AdversaryDef> {
        self.adversaries.iter().find(|a| a.id == id)
    }
}

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// The seven lists a project may carry of its own.
const OWN_LISTS: [&str; 7] = ["classes", "ancestries", "communities", "subclasses", "cards", "weapons", "armors"];

/// The character content a project is played with (`characterContentFor`): the shipped pack, and what the
/// project carries laid over it id for id.
pub fn character_content_for(shipped: &Shipped, project: &Value) -> ContentPack {
    if OWN_LISTS.iter().all(|key| list(project, key).is_empty()) {
        return shipped.characters.clone();
    }
    let own: PackLists = serde_json::from_value(json!(OWN_LISTS.iter().map(|key| (key.to_string(), json!(list(project, key)))).collect::<serde_json::Map<_, _>>())).expect("a project's lists read as content");
    merge_pack(&shipped.characters, own)
}

/// The stat blocks a project's rooms answer to (`adversaryDefsFor`): the shipped ones, the project's own
/// taking the place of any under the same id.
pub fn adversary_defs_for(shipped: &Shipped, project: &Value) -> HashMap<String, AdversaryDef> {
    let mut merged: HashMap<String, AdversaryDef> = shipped.adversaries.iter().map(|a| (a.id.clone(), a.clone())).collect();
    for def in list(project, "adversaries") {
        let def: AdversaryDef = serde_json::from_value(def.clone()).expect("a stat block the schema read");
        merged.insert(def.id.clone(), def);
    }
    merged
}

/// The stat block a room's placement stands up from: the project's own, before the shipped pack.
pub fn stat_block_for(shipped: &Shipped, project: &Value, id: &str) -> Option<AdversaryDef> {
    list(project, "adversaries")
        .iter()
        .find(|def| def["id"].as_str() == Some(id))
        .map(|def| serde_json::from_value(def.clone()).expect("a stat block the schema read"))
        .or_else(|| shipped.adversary(id).cloned())
}

/// A project's conditions, then every shipped one it does not name (`withShippedConditions`).
pub fn with_shipped_conditions(shipped: &Shipped, project: &Value) -> Vec<ConditionDef> {
    let mut merged: Vec<ConditionDef> = list(project, "conditionDefs").iter().map(|def| serde_json::from_value(def.clone()).expect("a condition the schema read")).collect();
    for def in &shipped.conditions {
        if merged.iter().any(|seen| seen.id == def.id) {
            continue;
        }
        merged.push(def.clone());
    }
    merged
}

/// The party's best hand at each trait, for a check rolled as the party (`traitsFor`).
pub fn traits_for(characters: &Ordered<DerivedCharacter>) -> HashMap<Trait, f64> {
    let mut best: HashMap<Trait, f64> = HashMap::new();
    for character in characters.values() {
        for t in [Trait::Agility, Trait::Strength, Trait::Finesse, Trait::Instinct, Trait::Presence, Trait::Knowledge] {
            let value = character.traits.of(t);
            if best.get(&t).is_none_or(|&b| value > b) {
                best.insert(t, value);
            }
        }
    }
    best
}

/// The abilities a project plays with: its own list, which is every ability it has.
pub fn abilities_of(project: &Value) -> Vec<AbilityDef> {
    list(project, "abilities").iter().map(|a| serde_json::from_value(a.clone()).expect("an ability the schema read")).collect()
}

/// What the world reads (`worldOptions`), as the project stands now.
pub fn world_content_for(shipped: &Shipped, project: &Value, characters: &Ordered<DerivedCharacter>) -> WorldContent {
    let loot_tables: HashMap<String, LootTable> = list(project, "lootTables")
        .iter()
        .map(|t| {
            let table: LootTable = serde_json::from_value(t.clone()).expect("a loot table the schema read");
            (table.id.clone(), table)
        })
        .collect();
    WorldContent {
        traits: traits_for(characters),
        characters: characters.entries().iter().cloned().collect(),
        adversaries: adversary_defs_for(shipped, project),
        band_tiles: Some(super::rules::DEMO_BAND_TILES),
        movement: Some(super::rules::movement_for(project)),
        abilities: abilities_of(project),
        cards: Some(character_content_for(shipped, project).cards.iter().cloned().collect()),
        condition_defs: WorldContent::index_conditions(with_shipped_conditions(shipped, project)),
        loot_tables,
        ..WorldContent::default()
    }
}
