//! A companion taken along (`joinParty`): a designer's effect that brings one of the project's companions
//! (`project.companions`, sheets written as the party's are) into the party - the company at a New Game's camp fire,
//! asked to come. The runner journals it (`partyJoined`) and the session, which holds the party, acts on it here: the
//! companion's sheet joins the party's in the project, and they arrive beside the party as one added in the editor
//! does (`sync_roster`), the log saying so; and the figure that stood for them, if the effect names one, is taken
//! away. One already in the party, or one the project has not got, changes nothing; with the party at its most, they
//! stay where they are and the log says why.

use super::log::note;
use super::session::Session;
use serde_json::Value;

/// The most a party is: four, as the SRD's adventures are written for.
pub const PARTY_MOST: usize = 4;

impl Session {
    /// The companions a journal takes along (`partyJoined`), brought into the party.
    pub(super) fn react_to_joining(&mut self, journal: &[Value]) -> Result<(), String> {
        for entry in journal.iter().filter(|entry| entry["kind"] == "partyJoined") {
            let Some(companion) = entry["companion"].as_str() else { continue };
            self.join_party(companion, entry["figure"].as_str())?;
        }
        Ok(())
    }

    /// A companion into the party, and the figure that stood for them away: whether they joined.
    pub fn join_party(&mut self, companion: &str, figure: Option<&str>) -> Result<bool, String> {
        let party = self.project["party"].as_array().cloned().unwrap_or_default();
        if party.iter().any(|sheet| sheet["id"] == companion) {
            return Ok(false);
        }
        let Some(sheet) = self.project["companions"].as_array().and_then(|all| all.iter().find(|sheet| sheet["id"] == companion)).cloned() else {
            return Ok(false);
        };
        if party.len() >= PARTY_MOST {
            let name = sheet["name"].as_str().filter(|name| !name.is_empty()).unwrap_or(companion);
            note(self, &format!("{name} would come, but the party is {PARTY_MOST} already."), "system");
            return Ok(false);
        }
        match self.project["party"].as_array_mut() {
            Some(listed) => listed.push(sheet),
            None => self.project["party"] = Value::Array(vec![sheet]),
        }
        self.sync_roster()?;
        if let Some(figure) = figure {
            self.world.state.remove_interactable(figure);
        }
        Ok(true)
    }
}
