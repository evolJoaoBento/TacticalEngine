//! What the party carries and how it is kitted out: the shops (`game/shop.ts` - a seller's stock, buying,
//! what it pays, selling), wielding and wearing (`game/equip.ts`), the binder's cards (`game/gear.ts`),
//! using an item (`game/use-item.ts`), and the cards a character has chosen - the loadout and the vault, a
//! card recalled, a rest (`game/demo-abilities.ts`) - the cards a stat block prints, and a level taken
//! between fights (`game/level-up.ts`).

use super::content::{abilities_of, character_content_for, item_of, items_for, ItemName};
use super::log::{name_of, note};
use super::play::{OnDone, PendingScript, UseOutcome};
use super::session::Session;
use crate::character::progression::{level_up, tier_of, LevelUpIssue, LevelUpPlan};
use crate::character::sheet::{granted_cards, lent_cards, CharacterSheet, DerivedCharacter};
use crate::content::abilities::{grant_rank, loadout_of, LOADOUT_LIMIT};
use crate::content::pack::{ArmorDef, CardDef, CardGrant, ContentPack, WeaponDef};
use crate::js;
use crate::rules::resources::{can_mark_stress, gain};
use crate::scene::state::Faction;
use crate::script::runner::{RunStatus, RunnerOptions, ScriptRunner};
use serde_json::{json, Value};

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// A seller buys back for its share of a worth - half unless it says - rounded down, and never nothing.
pub fn buy_back_price(worth: f64, percent: f64) -> f64 {
    if worth <= 0.0 || percent <= 0.0 {
        0.0
    } else {
        js::max(1.0, ((worth * percent) / 100.0).floor())
    }
}

const SLOTS: [(&str, &str); 3] = [("primary", "Primary weapon"), ("secondary", "Secondary weapon"), ("armor", "Armor")];

fn worn_id<'a>(sheet: &'a CharacterSheet, slot: &str) -> Option<&'a String> {
    match slot {
        "primary" => sheet.primary_weapon_id.as_ref(),
        "secondary" => sheet.secondary_weapon_id.as_ref(),
        _ => sheet.armor_id.as_ref(),
    }
}

fn without(sheet: &CharacterSheet, slot: &str) -> CharacterSheet {
    let mut next = sheet.clone();
    match slot {
        "primary" => next.primary_weapon_id = None,
        "secondary" => next.secondary_weapon_id = None,
        _ => next.armor_id = None,
    }
    next
}

// ---- the binder's cards ------------------------------------------------------------------------------------

fn trait_name(name: &str) -> String {
    let mut chars = name.chars();
    chars.next().map_or(String::new(), |first| first.to_uppercase().collect::<String>() + chars.as_str())
}

fn range_name(range: &str) -> String {
    match range {
        "melee" => "Melee",
        "veryClose" => "Very Close",
        "close" => "Close",
        "far" => "Far",
        "veryFar" => "Very Far",
        other => other,
    }
    .to_string()
}

fn banner(kind: &str) -> &'static str {
    match kind {
        "weapon" => "Weapon",
        "armor" => "Armor",
        "consumable" => "Consumable",
        "key" => "Key",
        _ => "Item",
    }
}

/// "d10+3", "2d6", "+3": a weapon's damage as a card prints it.
fn damage_text(weapon: &WeaponDef) -> String {
    let d = &weapon.damage.expression;
    let dice = if d.count == 0.0 { String::new() } else { format!("{}d{}", if d.count == 1.0 { String::new() } else { js::number_to_string(d.count) }, js::number_to_string(d.sides)) };
    if d.modifier == 0.0 {
        dice
    } else {
        format!("{dice}{}{}", if d.modifier > 0.0 { "+" } else { "" }, js::number_to_string(d.modifier))
    }
}

fn to_text(value: impl serde::Serialize) -> String {
    serde_json::to_value(value).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

fn feature_of(features: &[crate::content::pack::PackFeature]) -> Value {
    features.first().map_or(Value::Null, |f| json!({ "name": f.name, "text": f.text }))
}

fn weapon_card(weapon: &WeaponDef, item: Option<&ItemName>) -> Value {
    let secondary = to_text(weapon.slot) == "secondary";
    let types: Vec<String> = weapon.damage.types.clone().map_or(vec!["physical".into()], |t| t.iter().map(to_text).collect());
    let caption = types.iter().map(|t| if t == "magic" { "MAG" } else { "PHY" }).collect::<Vec<_>>().join("/");
    let mut card = json!({
        "id": item.map_or(weapon.id.clone(), |i| i.id.clone()),
        "name": item.map_or(weapon.name.clone(), |i| i.name.clone()),
        "banner": if secondary { "Secondary Weapon" } else { "Weapon" },
        "kind": "weapon",
        "stats": [
            { "text": trait_name(&to_text(weapon.trait_)) },
            { "text": range_name(&to_text(weapon.range)) },
            { "text": damage_text(weapon), "caption": caption },
            { "text": if to_text(weapon.burden) == "twoHanded" { "Two-Handed" } else { "One-Handed" } },
        ],
        "feature": feature_of(&weapon.features),
        "text": "",
        "tier": weapon.tier,
        "fits": if secondary { "secondary" } else { "primary" },
    });
    if let Some(picture) = item.and_then(|i| i.card.clone()) {
        card["card"] = json!(picture);
    }
    card
}

fn armor_card(armor: &ArmorDef, item: Option<&ItemName>) -> Value {
    let mut card = json!({
        "id": item.map_or(armor.id.clone(), |i| i.id.clone()),
        "name": item.map_or(armor.name.clone(), |i| i.name.clone()),
        "banner": "Armor",
        "kind": "armor",
        "stats": [
            { "text": format!("{} / {}", js::number_to_string(armor.base_thresholds.major), js::number_to_string(armor.base_thresholds.severe)), "caption": "Thresholds" },
            { "text": js::number_to_string(armor.base_score), "caption": "Armor Score" },
            { "text": js::number_to_string(armor.tier), "caption": "Tier" },
        ],
        "feature": feature_of(&armor.features),
        "text": "",
        "tier": armor.tier,
        "fits": "armor",
    });
    if let Some(picture) = item.and_then(|i| i.card.clone()) {
        card["card"] = json!(picture);
    }
    card
}

// ---- the loadout -------------------------------------------------------------------------------------------

/// What a card prints: its own text, or its named features (`printedText`).
fn printed_text(card: &CardDef) -> String {
    if !card.text.is_empty() {
        return card.text.clone();
    }
    card.features.iter().map(|f| if f.name.is_empty() { f.text.clone() } else { format!("{}\n{}", f.name, f.text) }).collect::<Vec<_>>().join("\n\n")
}

fn loadout_card_of(card: &CardDef) -> Value {
    json!({
        "id": card.id,
        "name": card.name,
        "recallCost": card.recall_cost.unwrap_or(0.0),
        "domain": card.domain.clone().unwrap_or_else(|| "Unknown".into()),
        "level": card.level.unwrap_or(1.0),
        "type": card.type_.map_or("ability".to_string(), to_text),
        "text": printed_text(card),
    })
}

/// What granted a card, in the words the table uses (`grantedBy`).
fn granted_by(grant: &CardGrant, content: &ContentPack) -> String {
    match grant {
        CardGrant::Class { class_id } => content.classes.get(class_id).map_or(class_id.clone(), |c| c.name.clone()),
        CardGrant::Subclass { subclass_id, stage } => format!("{} \u{b7} {}", content.subclasses.get(subclass_id).map_or(subclass_id.clone(), |s| s.name.clone()), to_text(stage)),
        CardGrant::Ancestry { ancestry_id } => content.ancestries.get(ancestry_id).map_or(ancestry_id.clone(), |a| a.name.clone()),
        CardGrant::Community { community_id } => content.communities.get(community_id).map_or(community_id.clone(), |c| c.name.clone()),
        CardGrant::Given { .. } => "Given".into(),
        CardGrant::Condition { .. } => "Lent".into(),
        CardGrant::Chosen | CardGrant::Adversary { .. } => String::new(),
    }
}

/// The cards in a character's vault (`vaultOf`): every card they hold that is not in the loadout.
fn vault_of(character: &DerivedCharacter) -> Vec<String> {
    let active = loadout_of(character.sheet.loadout.as_deref(), &character.cards);
    character.cards.iter().map(|c| c.id.clone()).filter(|id| !active.contains(id)).collect()
}

impl Session {
    // ---- the shops -----------------------------------------------------------------------------------------

    fn bought_of(&mut self, id: &str, item: &str) -> f64 {
        self.world.state.interactable(id).data.get(&format!("bought:{item}")).and_then(Value::as_f64).unwrap_or(0.0)
    }

    fn named(&self, item: &str) -> String {
        item_of(self.shipped(), &self.project, item).map_or(item.to_string(), |i| i.name)
    }

    /// What a seller still has, in the order it was stocked (`shopContents`).
    pub fn shop_contents(&mut self, id: &str) -> Vec<Value> {
        let Some(shop) = self.shop_of(id) else { return Vec::new() };
        // Read as the TypeScript reads it: the seller's state is made by looking.
        self.world.state.interactable(id);
        let mut lines = Vec::new();
        for line in list(&shop, "stock") {
            let item = line["item"].as_str().unwrap_or_default().to_string();
            let left = match line["count"].as_f64() {
                None => Value::Null,
                Some(count) => json!(count - self.bought_of(id, &item)),
            };
            if left.as_f64().is_some_and(|l| l <= 0.0) {
                continue;
            }
            lines.push(json!({ "item": item, "name": self.named(&item), "price": line["price"], "left": left }));
        }
        lines
    }

    /// How much of what a seller is paid in the party is carrying (`purse`).
    pub fn purse(&self, shop: &Value) -> f64 {
        let currency = shop["currency"].as_str().unwrap_or_default();
        let mut held = 0.0;
        while self.world.has_item(currency, held + 1.0) {
            held += 1.0;
        }
        held
    }

    fn buyer(&self) -> String {
        self.party.selected().map_or("The party".into(), |id| name_of(self, id))
    }

    /// Buy one of something (`buyFrom`).
    pub fn buy_from(&mut self, id: &str, item: &str) -> bool {
        let Some(shop) = self.shop_of(id) else { return false };
        let Some(line) = self.shop_contents(id).into_iter().find(|l| l["item"] == item) else { return false };
        let currency_id = shop["currency"].as_str().unwrap_or_default().to_string();
        let currency = self.named(&currency_id).to_lowercase();
        let price = line["price"].as_f64().unwrap_or(0.0);
        let name = line["name"].as_str().unwrap_or_default().to_string();
        if !self.world.has_item(&currency_id, price) {
            note(self, &format!("Not enough {currency} for {name}: it costs {}.", js::number_to_string(price)), "system");
            return false;
        }
        if price > 0.0 {
            self.world.remove_item(&currency_id, price);
        }
        self.world.add_item(item, 1.0);
        if !line["left"].is_null() {
            let bought = self.bought_of(id, item) + 1.0;
            self.world.state.interactable(id).data.insert(format!("bought:{item}"), json!(bought));
        }
        let who = self.buyer();
        note(self, &format!("{who} buys {name} for {} {currency}.", js::number_to_string(price)), "success");
        true
    }

    /// What a seller pays for one of something (`offerFor`).
    pub fn offer_for(&self, shop: &Value, item: &str) -> f64 {
        if shop["currency"] == item {
            return 0.0;
        }
        let stocked = list(shop, "stock").iter().find(|l| l["item"] == item);
        let worth = match stocked {
            Some(line) => line["price"].as_f64().unwrap_or(0.0),
            None => item_of(self.shipped(), &self.project, item).and_then(|i| i.value).unwrap_or(0.0),
        };
        buy_back_price(worth, shop["buysAt"].as_f64().unwrap_or(50.0))
    }

    /// What the party carries that the seller will buy, and for how much (`sellables`).
    pub fn sellables(&self, id: &str) -> Vec<Value> {
        let Some(shop) = self.shop_of(id) else { return Vec::new() };
        let mut order: Vec<String> = Vec::new();
        for item in list(&shop, "stock").iter().filter_map(|l| l["item"].as_str()).map(str::to_string).chain(items_for(self.shipped(), &self.project).into_iter().map(|i| i.id)) {
            if !order.contains(&item) {
                order.push(item);
            }
        }
        let mut lines = Vec::new();
        for item in order {
            let price = self.offer_for(&shop, &item);
            if price == 0.0 {
                continue;
            }
            let mut held = 0.0;
            while self.world.has_item(&item, held + 1.0) {
                held += 1.0;
            }
            if held == 0.0 {
                continue;
            }
            lines.push(json!({ "item": item, "name": self.named(&item), "held": held, "price": price }));
        }
        lines
    }

    /// Sell one of something to a seller (`sellTo`).
    pub fn sell_to(&mut self, id: &str, item: &str) -> bool {
        let Some(shop) = self.shop_of(id) else { return false };
        let Some(line) = self.sellables(id).into_iter().find(|l| l["item"] == item) else { return false };
        let currency_id = shop["currency"].as_str().unwrap_or_default().to_string();
        let price = line["price"].as_f64().unwrap_or(0.0);
        self.world.remove_item(item, 1.0);
        self.world.add_item(&currency_id, price);
        if list(&shop, "stock").iter().find(|l| l["item"] == item).is_some_and(|l| l.get("count").is_some_and(|c| !c.is_null())) {
            let bought = self.bought_of(id, item) - 1.0;
            self.world.state.interactable(id).data.insert(format!("bought:{item}"), json!(bought));
        }
        let currency = self.named(&currency_id).to_lowercase();
        let who = self.buyer();
        note(self, &format!("{who} sells {} for {} {currency}.", line["name"].as_str().unwrap_or_default(), js::number_to_string(price)), "success");
        true
    }

    // ---- wielding and wearing ------------------------------------------------------------------------------

    /// The item whose `contentId` is this piece of gear (`itemForGear`).
    pub fn item_for_gear(&self, content_id: Option<&str>) -> Option<ItemName> {
        let content_id = content_id?;
        items_for(self.shipped(), &self.project).into_iter().find(|i| i.content_id.as_deref() == Some(content_id))
    }

    /// Put a carried weapon or armour on a character (`equipItem`): the slot, or why not.
    pub fn equip_item(&mut self, id: &str, item_id: &str) -> Result<String, String> {
        let Some(sheet) = self.sheets.get(id).cloned() else { return Err(format!("no character \"{id}\"")) };
        let Some(item) = item_of(self.shipped(), &self.project, item_id) else { return Err(format!("no item \"{item_id}\"")) };
        if self.world.scenario.items.get(item_id).copied().unwrap_or(0.0) < 1.0 {
            return Err(format!("the party is not carrying {}", item.name));
        }
        if self.waiting() {
            return Err("not in the middle of a conversation".into());
        }
        let Some(content_id) = item.content_id.clone() else { return Err(format!("{} is not something that can be worn", item.name)) };
        let content = character_content_for(self.shipped(), &self.project);
        let (next, slot, replaced, freed) = match item.kind.as_str() {
            "weapon" => {
                let Some(weapon) = content.weapons.get(&content_id) else { return Err(format!("{} points at no known weapon", item.name)) };
                let slot = if to_text(weapon.slot) == "secondary" { "secondary" } else { "primary" };
                let replaced = worn_id(&sheet, slot).cloned();
                if replaced.as_deref() == Some(weapon.id.as_str()) {
                    return Err(format!("{} already wields the {}", sheet.name, item.name));
                }
                let primary = sheet.primary_weapon_id.as_ref().and_then(|p| content.weapons.get(p));
                if slot == "secondary" {
                    if let Some(primary) = primary.filter(|p| to_text(p.burden) == "twoHanded") {
                        return Err(format!("the {} takes both of {}'s hands", primary.name, sheet.name));
                    }
                }
                if slot == "primary" {
                    let mut next = CharacterSheet { primary_weapon_id: Some(weapon.id.clone()), ..sheet.clone() };
                    let mut freed = None;
                    if to_text(weapon.burden) == "twoHanded" && sheet.secondary_weapon_id.is_some() {
                        freed = sheet.secondary_weapon_id.clone();
                        next = without(&next, "secondary");
                    }
                    (next, slot, replaced, freed)
                } else {
                    (CharacterSheet { secondary_weapon_id: Some(weapon.id.clone()), ..sheet.clone() }, slot, replaced, None)
                }
            }
            "armor" => {
                if self.in_combat() {
                    return Err("armor cannot be changed in a fight".into());
                }
                let Some(armor) = content.armors.get(&content_id) else { return Err(format!("{} points at no known armor", item.name)) };
                let replaced = sheet.armor_id.clone();
                if replaced.as_deref() == Some(armor.id.as_str()) {
                    return Err(format!("{} already wears the {}", sheet.name, item.name));
                }
                (CharacterSheet { armor_id: Some(armor.id.clone()), ..sheet.clone() }, "armor", replaced, None)
            }
            _ => return Err(format!("{} is not something that can be worn", item.name)),
        };
        self.world.remove_item(item_id, 1.0);
        for back in [replaced, freed] {
            if let Some(returned) = self.item_for_gear(back.as_deref()).filter(|r| r.id != item_id) {
                self.world.add_item(&returned.id, 1.0);
            }
        }
        self.wear(id, next)?;
        note(self, &format!("{} {} the {}.", sheet.name, if slot == "armor" { "puts on" } else { "takes up" }, item.name), "system");
        Ok(slot.to_string())
    }

    /// Take a piece off and put it back in the pack (`unequipItem`).
    pub fn unequip_item(&mut self, id: &str, slot: &str) -> Result<String, String> {
        let Some(sheet) = self.sheets.get(id).cloned() else { return Err(format!("no character \"{id}\"")) };
        if self.waiting() {
            return Err("not in the middle of a conversation".into());
        }
        let Some(worn) = worn_id(&sheet, slot).cloned() else { return Err(format!("{} has nothing there", sheet.name)) };
        if slot == "armor" && self.in_combat() {
            return Err("armor cannot be changed in a fight".into());
        }
        let Some(item) = self.item_for_gear(Some(&worn)) else { return Err("there is nothing to put that back in the pack as".into()) };
        self.world.add_item(&item.id, 1.0);
        self.wear(id, without(&sheet, slot))?;
        note(self, &format!("{} {} the {}.", sheet.name, if slot == "armor" { "takes off" } else { "puts away" }, item.name), "system");
        Ok(slot.to_string())
    }

    /// Write the sheet, and the live pools after it (`wear`): Armor Slots follow the armour.
    fn wear(&mut self, id: &str, next: CharacterSheet) -> Result<(), String> {
        self.set_sheet(next)?;
        let score = self.characters.get(id).expect("derived").armor_score;
        if let Some(entity) = self.world.state.entity_mut(id) {
            entity.armor_slots = crate::rules::resources::MarkPool { max: score, marked: js::min(entity.armor_slots.marked, score) };
        }
        self.refresh_world();
        Ok(())
    }

    /// What a character is wielding and wearing, by name (`gearOf`).
    pub fn gear_of(&self, id: &str) -> Value {
        let character = self.characters.get(id);
        let content = character_content_for(self.shipped(), &self.project);
        let weapon = character.and_then(|c| c.primary_weapon.as_ref()).map_or("Unarmed".to_string(), |w| w.name.clone());
        let armor = character.and_then(|c| c.sheet.armor_id.as_ref()).and_then(|a| content.armors.get(a)).map_or("Unarmored".to_string(), |a| a.name.clone());
        json!({ "weapon": weapon, "armor": armor })
    }

    /// Any item as a card (`gearCard`): nothing for an id no item has.
    pub fn gear_card(&self, item_id: &str) -> Option<Value> {
        let item = item_of(self.shipped(), &self.project, item_id)?;
        let content = character_content_for(self.shipped(), &self.project);
        if let Some(content_id) = &item.content_id {
            if item.kind == "weapon" {
                if let Some(weapon) = content.weapons.get(content_id) {
                    return Some(weapon_card(weapon, Some(&item)));
                }
            }
            if item.kind == "armor" {
                if let Some(armor) = content.armors.get(content_id) {
                    return Some(armor_card(armor, Some(&item)));
                }
            }
        }
        let mut card = json!({ "id": item.id, "name": item.name, "banner": banner(&item.kind), "kind": item.kind, "stats": [], "feature": null, "text": item.description, "fits": null });
        if let Some(tier) = item.tier {
            card["tier"] = json!(tier);
        }
        if let Some(picture) = &item.card {
            card["card"] = json!(picture);
        }
        Some(card)
    }

    /// A character's three places and the party's pack, as cards (`gearView`).
    pub fn gear_view(&self, id: &str) -> Value {
        let sheet = self.sheets.get(id);
        let content = character_content_for(self.shipped(), &self.project);
        let worn = |slot: &str| -> Value {
            let Some(piece) = sheet.and_then(|s| worn_id(s, slot)) else { return Value::Null };
            if slot == "armor" {
                return content.armors.get(piece).map_or(Value::Null, |a| armor_card(a, self.item_for_gear(Some(piece)).as_ref()));
            }
            content.weapons.get(piece).map_or(Value::Null, |w| weapon_card(w, self.item_for_gear(Some(piece)).as_ref()))
        };
        let slots: Vec<Value> = SLOTS.iter().map(|(slot, label)| json!({ "slot": slot, "label": label, "card": worn(slot) })).collect();
        let mut carried = Vec::new();
        for (item_id, count) in self.world.scenario.items.entries().iter().map(|(i, c)| (i.clone(), *c)) {
            if count <= 0.0 {
                continue;
            }
            let item = item_of(self.shipped(), &self.project, &item_id);
            let mut card = self.gear_card(&item_id).unwrap_or_else(|| json!({ "id": item_id, "name": item_id, "banner": "Item", "kind": "trinket", "stats": [], "feature": null, "text": "", "fits": null }));
            card["count"] = json!(count);
            if let Some(worth) = item.as_ref().and_then(|i| i.value) {
                card["worth"] = json!(worth);
            }
            card["usable"] = json!(item.is_some_and(|i| !i.use_.is_empty()));
            carried.push(card);
        }
        json!({ "slots": slots, "carried": carried })
    }

    // ---- using what is carried -----------------------------------------------------------------------------

    /// Use a carried item, with whoever is selected as the actor (`useItem`).
    pub fn use_item(&mut self, item_id: &str) -> Result<UseOutcome, String> {
        if self.waiting() {
            return Ok(UseOutcome { status: "busy", lines: Vec::new() });
        }
        let Some(item) = item_of(self.shipped(), &self.project, item_id) else { return Ok(UseOutcome { status: "missing", lines: Vec::new() }) };
        let Some(actor) = self.party.selected().map(str::to_string) else { return Ok(UseOutcome { status: "unreachable", lines: Vec::new() }) };
        if self.world.scenario.items.get(item_id).copied().unwrap_or(0.0) < 1.0 {
            let line = note(self, &format!("The party is not carrying {}.", item.name), "system");
            return Ok(UseOutcome { status: "refused", lines: vec![line] });
        }
        if item.use_.is_empty() {
            let line = note(self, &format!("There is nothing to do with {}.", item.name), "system");
            return Ok(UseOutcome { status: "refused", lines: vec![line] });
        }
        let fighting = self.in_combat();
        if fighting && !self.encounter.as_ref().expect("a fight").can_act(&self.world.state, &actor) {
            let line = note(self, "There is no time \u{2014} you have acted.", "system");
            return Ok(UseOutcome { status: "refused", lines: vec![line] });
        }
        self.world.scenario.actor_id = Some(actor.clone());
        if item.kind == "consumable" {
            self.world.remove_item(item_id, 1.0);
        }
        if fighting {
            self.encounter.as_mut().expect("a fight").act(&mut self.world.state, &actor, false);
        }
        let who = self.sheets.get(&actor).map_or(actor.clone(), |s| s.name.clone());
        let mut lines = vec![note(self, &format!("{who} uses the {}.", item.name), "system")];
        let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &RunnerOptions::default());
        let status = runner.run(&item.use_);
        let journal = runner.entries().to_vec();
        let runner = runner.suspend();
        lines.extend(self.record(&journal)?);
        if let RunStatus::Waiting(prompt) = status {
            self.pending = Some(PendingScript::new(runner, prompt, journal.len(), OnDone::Nothing));
            return self.settle(lines);
        }
        self.settle_travel(lines)
    }

    // ---- the loadout ---------------------------------------------------------------------------------------

    /// What a character has chosen and what they have without choosing (`loadoutView`).
    pub fn loadout_view(&mut self, id: &str) -> Value {
        let content = character_content_for(self.shipped(), &self.project);
        let Some(character) = self.characters.get(id).cloned() else { return json!({ "loadout": [], "vault": [], "granted": [], "limit": LOADOUT_LIMIT }) };
        let describe = |card: &str| content.cards.get(card).map_or_else(|| json!({ "id": card, "name": card, "recallCost": 0, "domain": "Unknown", "level": 1, "type": "ability", "text": "" }), loadout_card_of);
        let bearing = self.world.state.entity(id).map(|e| e.conditions.clone()).unwrap_or_default();
        let mut granted: Vec<CardDef> = granted_cards(&character.sheet, content.cards.iter()).into_iter().cloned().collect();
        granted.extend(lent_cards(&bearing, content.cards.iter()).into_iter().cloned());
        granted.sort_by_key(|c| grant_rank(&c.grant));
        let granted: Vec<Value> = granted
            .iter()
            .map(|card| {
                let from = match &card.grant {
                    CardGrant::Condition { conditions } => conditions.iter().find(|c| bearing.contains(c)).map_or("Lent".to_string(), |by| format!("Lent by {}", self.world.condition_name(by))),
                    grant => granted_by(grant, &content),
                };
                json!({ "id": card.id, "name": card.name, "text": printed_text(card), "from": from })
            })
            .collect();
        let loadout: Vec<Value> = loadout_of(character.sheet.loadout.as_deref(), &character.cards).iter().map(|c| describe(c)).collect();
        let vault: Vec<Value> = vault_of(&character).iter().map(|c| describe(c)).collect();
        let stats = self.sheet_stats(&character);
        json!({ "loadout": loadout, "vault": vault, "granted": granted, "limit": LOADOUT_LIMIT, "stats": stats })
    }

    /// What a player looks up on their sheet (`sheetStats`): Evasion and thresholds as an attack meets them.
    fn sheet_stats(&mut self, character: &DerivedCharacter) -> Value {
        let (evasion, thresholds) = match self.world.state.entity(&character.sheet.id).cloned() {
            None => (character.evasion, character.thresholds),
            Some(entity) => {
                let defence = self.world.defender_of(&entity);
                (defence.difficulty, defence.thresholds)
            }
        };
        let number = |n: f64| if n.is_finite() { json!(n) } else { Value::Null };
        let traits: Vec<Value> = crate::rules::jump::Trait::ALL
            .iter()
            .map(|&t| json!({ "id": t.name(), "value": character.traits.of(t), "spellcast": character.spellcast_trait == Some(t) }))
            .collect();
        json!({
            "level": character.sheet.level,
            "proficiency": character.proficiency,
            "evasion": evasion,
            "thresholds": { "major": number(thresholds.major), "severe": number(thresholds.severe) },
            "traits": traits,
            "experiences": character.experiences.iter().map(|e| json!({ "name": e.name, "modifier": e.modifier })).collect::<Vec<_>>(),
        })
    }

    /// Bring a card from the vault into the loadout (`swapCard`): the Stress it cost, or why not.
    pub fn swap_card(&mut self, id: &str, card_in: &str, card_out: Option<&str>, resting: bool) -> Result<f64, String> {
        let (Some(sheet), Some(character)) = (self.sheets.get(id).cloned(), self.characters.get(id).cloned()) else { return Err(format!("no character \"{id}\"")) };
        let Some(entity) = self.world.state.entity(id).cloned() else { return Err(format!("no character \"{id}\"")) };
        if self.waiting() {
            return Err("something is waiting for an answer".into());
        }
        let loadout = loadout_of(character.sheet.loadout.as_deref(), &character.cards);
        let vault = vault_of(&character);
        if !vault.iter().any(|c| c == card_in) {
            return Err("that card is not in the vault".into());
        }
        if card_out.is_some_and(|out| !loadout.iter().any(|c| c == out)) {
            return Err("that card is not in the loadout".into());
        }
        if card_out.is_none() && loadout.len() >= LOADOUT_LIMIT {
            return Err(format!("the loadout holds {LOADOUT_LIMIT}; choose one to vault"));
        }
        let content = character_content_for(self.shipped(), &self.project);
        let card = content.cards.get(card_in);
        let cost = if resting { 0.0 } else { card.and_then(|c| c.recall_cost).unwrap_or(0.0) };
        if cost > 0.0 && !can_mark_stress(&entity.stress, cost) {
            return Err(format!("recalling it costs {} Stress, and there is no room to mark it", js::number_to_string(cost)));
        }
        if cost > 0.0 {
            self.world.mark_stress(id, cost);
        }
        let mut next: Vec<String> = loadout.into_iter().filter(|c| Some(c.as_str()) != card_out).collect();
        next.push(card_in.to_string());
        self.set_sheet(CharacterSheet { loadout: Some(next), ..sheet.clone() })?;
        self.refresh_world();
        self.sync_pools();
        let recalled = card.map_or(card_in.to_string(), |c| c.name.clone());
        let vaulted = card_out.map(|out| format!(" and vaults {}", content.cards.get(out).map_or(out.to_string(), |c| c.name.clone()))).unwrap_or_default();
        let marking = if cost > 0.0 { format!(", marking {} Stress", js::number_to_string(cost)) } else { String::new() };
        note(self, &format!("{} recalls {recalled}{vaulted}{marking}.", sheet.name), if cost > 0.0 { "bad" } else { "system" });
        Ok(cost)
    }

    // ---- a rest ------------------------------------------------------------------------------------------

    /// Take a short or a long rest (`rest`): each character's two moves, the abilities and tokens it gives
    /// back, the conditions it ends, and the GM's Shadow. The Shadow gained, or why not.
    pub fn rest(&mut self, long: bool, plan: &Value) -> Result<f64, String> {
        if self.in_combat() {
            return Err("not in the middle of a fight".into());
        }
        if self.waiting() || !self.talking_aside().is_empty() {
            return Err("not in the middle of a conversation".into());
        }
        let party: Vec<String> = self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
        if party.is_empty() {
            return Err("nobody to rest".into());
        }
        note(self, if long { "The party makes camp." } else { "The party stops to catch its breath." }, "narration");
        if let Some(loadouts) = plan["loadouts"].as_object() {
            for (id, wanted) in loadouts {
                let (Some(character), Some(sheet)) = (self.characters.get(id).cloned(), self.sheets.get(id).cloned()) else { continue };
                let held: Vec<String> = character.cards.iter().map(|c| c.id.clone()).collect();
                let next: Vec<String> = wanted.as_array().map_or(Vec::new(), |w| w.iter().filter_map(Value::as_str).filter(|c| held.iter().any(|h| h == c)).map(str::to_string).take(LOADOUT_LIMIT).collect());
                self.set_sheet(CharacterSheet { loadout: Some(next), ..sheet })?;
            }
        }
        self.refresh_world();
        self.sync_pools();
        let moves = plan["moves"].as_object().cloned().unwrap_or_default();
        let preparing = moves.values().filter(|m| m.as_array().is_some_and(|m| m.iter().any(|x| x["kind"] == "prepare"))).count();
        let good_each = if preparing >= 2 { 2.0 } else { 1.0 };
        for (id, chosen) in &moves {
            if self.world.state.entity(id).is_none() {
                continue;
            }
            let Some(sheet) = self.sheets.get(id).cloned() else { continue };
            let who = sheet.name.clone();
            for one in chosen.as_array().map_or(&[][..], Vec::as_slice).iter().take(2) {
                let amount = |session: &mut Session| -> Result<f64, String> {
                    if long {
                        Ok(f64::INFINITY)
                    } else {
                        Ok(f64::from(session.rng.die(4).map_err(|e| e.0)?) + f64::from(tier_of(sheet.level)))
                    }
                };
                match one["kind"].as_str().unwrap_or_default() {
                    "tendWounds" => {
                        let target = one["target"].as_str().filter(|t| self.world.state.entity(t).is_some()).unwrap_or(id).to_string();
                        let rolled = amount(self)?;
                        let body = self.world.state.entity_mut(&target).expect("standing");
                        let cleared = js::min(body.hit_points.marked, rolled);
                        body.hit_points.marked -= cleared;
                        if cleared > 0.0 && body.hit_points.marked < body.hit_points.max {
                            body.alive = true;
                        }
                        let whose = if target == *id { "their".to_string() } else { format!("{}'s", name_of(self, &target)) };
                        note(self, &format!("{who} tends {whose} wounds: {} Hit Point{} cleared.", js::number_to_string(cleared), if cleared == 1.0 { "" } else { "s" }), "good");
                    }
                    "clearStress" => {
                        let rolled = amount(self)?;
                        let body = self.world.state.entity_mut(id).expect("standing");
                        let cleared = js::min(body.stress.marked, rolled);
                        body.stress.marked -= cleared;
                        note(self, &format!("{who} clears {} Stress.", js::number_to_string(cleared)), "good");
                    }
                    "repairArmor" => {
                        let target = one["target"].as_str().filter(|t| self.world.state.entity(t).is_some()).unwrap_or(id).to_string();
                        let rolled = amount(self)?;
                        let body = self.world.state.entity_mut(&target).expect("standing");
                        let cleared = js::min(body.armor_slots.marked, rolled);
                        body.armor_slots.marked -= cleared;
                        let whose = if target == *id { "their".to_string() } else { format!("{}'s", name_of(self, &target)) };
                        note(self, &format!("{who} repairs {whose} armor: {} Armor Slot{} cleared.", js::number_to_string(cleared), if cleared == 1.0 { "" } else { "s" }), "good");
                    }
                    "prepare" => {
                        let body = self.world.state.entity_mut(id).expect("standing");
                        if let Some(good) = body.good {
                            body.good = Some(gain(&good, good_each).currency);
                        }
                        note(self, &format!("{who} prepares: {} Light.", js::number_to_string(good_each)), "good");
                    }
                    _ => {}
                }
            }
        }
        let abilities = abilities_of(&self.project);
        let used: Vec<String> = self.world.scenario.ability_uses.entries().iter().map(|(k, _)| k.clone()).collect();
        for key in used {
            let per = abilities.iter().find(|a| key.ends_with(&format!("/{}", a.id))).and_then(|a| a.uses.as_ref()).map(|u| u.per.clone());
            if matches!(per.as_deref(), Some("rest") | Some("scene")) || (per.as_deref() == Some("longRest") && long) {
                self.world.scenario.ability_uses.delete(&key);
            }
        }
        self.refill_tokens(if long { &["rest", "longRest", "scene", "session"] } else { &["rest", "scene"] });
        self.world.forget_spots();
        for (id, condition) in self.world.state.clear_conditions("rest") {
            let (who, condition) = (name_of(self, &id), self.world.condition_name(&condition));
            note(self, &format!("{who} is no longer {condition}."), "system");
        }
        self.sync_pools();
        let bad = f64::from(self.rng.die(4).map_err(|e| e.0)?) + if long { party.len() as f64 } else { 0.0 };
        let gained = gain(&self.world.state.bad, bad);
        self.world.state.bad = gained.currency;
        note(self, &format!("The GM gains {} Shadow.", js::number_to_string(gained.applied)), "bad");
        Ok(gained.applied)
    }

    // ---- a level -----------------------------------------------------------------------------------------

    /// Party members whose sheet is below the level the party has been granted (`awaitingLevel`).
    pub fn awaiting_level(&self) -> Vec<String> {
        self.sheets.entries().iter().filter(|(_, s)| s.level < self.world.scenario.party_level).map(|(id, _)| id.clone()).collect()
    }

    /// Take a level for one character (`applyLevelUp`): the plan checked whole, the sheet replaced, the pools
    /// grown to match - new slots unmarked, nothing marked cleared. The level reached, or what is wrong.
    pub fn apply_level_up(&mut self, id: &str, plan: &LevelUpPlan) -> Result<f64, Vec<LevelUpIssue>> {
        let Some(sheet) = self.sheets.get(id).cloned() else { return Err(vec![LevelUpIssue { field: "character", message: format!("no character \"{id}\"") }]) };
        if sheet.level >= self.world.scenario.party_level {
            return Err(vec![LevelUpIssue { field: "level", message: "no level-up waiting".into() }]);
        }
        if self.in_combat() || self.waiting() {
            return Err(vec![LevelUpIssue { field: "level", message: "not in the middle of a fight or a conversation".into() }]);
        }
        let next = level_up(&sheet, &character_content_for(self.shipped(), &self.project), plan)?;
        self.set_sheet(next.clone()).map_err(|message| vec![LevelUpIssue { field: "sheet", message }])?;
        let derived = self.characters.get(id).expect("derived").clone();
        if let Some(entity) = self.world.state.entity_mut(id) {
            entity.hit_points = crate::rules::resources::MarkPool { max: derived.hit_points, marked: js::min(entity.hit_points.marked, derived.hit_points) };
            entity.stress = crate::rules::resources::MarkPool { max: derived.stress, marked: js::min(entity.stress.marked, derived.stress) };
            entity.armor_slots = crate::rules::resources::MarkPool { max: derived.armor_score, marked: js::min(entity.armor_slots.marked, derived.armor_score) };
        }
        self.refresh_world();
        note(self, &format!("{} reaches level {}.", next.name, js::number_to_string(next.level)), "good");
        Ok(next.level)
    }

    /// The cards a stat block prints, as somebody looking at the creature reads them (`statBlockCards`).
    pub fn stat_block_cards(&self, definition: &str) -> Vec<Value> {
        let content = character_content_for(self.shipped(), &self.project);
        let abilities = abilities_of(&self.project);
        content
            .cards
            .iter()
            .filter(|card| matches!(&card.grant, CardGrant::Adversary { adversaries } if adversaries.iter().any(|a| a == definition)))
            .map(|card| {
                let text = if card.text.is_empty() { abilities.iter().find(|a| a.source.card == card.id).map_or(String::new(), |a| a.text.clone()) } else { card.text.clone() };
                json!({ "id": card.id, "name": card.name, "text": text })
            })
            .collect()
    }
}
