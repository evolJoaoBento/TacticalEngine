//! A card given (`grantCard`): a designer's effect that puts a card in a character's hands - a project's reward, a
//! teacher's lesson, a relic's gift. The effect names the card and, if not the actor, who receives it; the runner
//! journals it (`cardGranted`) and the session, which holds the sheets, acts on it here: the card joins the
//! character's domain cards - in the vault if the loadout is full, swapped in on a rest like any other - and the
//! log says so. A card the character already holds, or one no content has, changes nothing and says nothing.

use super::content::character_content_for;
use super::log::{name_of, note};
use super::session::Session;
use crate::character::progression::held_cards;
use serde_json::Value;

impl Session {
    /// The cards a journal gives (`cardGranted`), put in their receivers' hands.
    pub(super) fn react_to_cards(&mut self, journal: &[Value]) -> Result<(), String> {
        for entry in journal.iter().filter(|entry| entry["kind"] == "cardGranted") {
            let (Some(id), Some(card)) = (entry["id"].as_str(), entry["card"].as_str()) else { continue };
            self.grant_card(id, card)?;
        }
        Ok(())
    }

    /// A card into a character's domain cards: whether it was given.
    pub fn grant_card(&mut self, id: &str, card: &str) -> Result<bool, String> {
        let Some(sheet) = self.sheets.get(id).cloned() else { return Ok(false) };
        let name = match character_content_for(self.shipped(), &self.project).cards.get(card) {
            Some(def) => def.name.clone(),
            None => return Ok(false),
        };
        if held_cards(&sheet).iter().any(|held| held == card) {
            return Ok(false);
        }
        let mut cards = sheet.domain_cards.clone().unwrap_or_default();
        cards.push(card.to_string());
        self.set_sheet(crate::character::sheet::CharacterSheet { domain_cards: Some(cards), ..sheet })?;
        self.refresh_world();
        self.sync_pools();
        note(self, &format!("{} learns {name}.", name_of(self, id)), "good");
        Ok(true)
    }
}
