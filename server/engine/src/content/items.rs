//! Loot (`src/engine/content/items.ts`): a table's weighted entries, drawn from the stream - one ticket per
//! roll, walked down the weights, a quantity range thrown after - and what was found, gathered by item in
//! the order each first came up. Item definitions are the inventory's, and wait for the game's port.

use crate::rng::{RangeError, Rng};
use crate::script::runner::LootDrop;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LootQuantity {
    Exactly(f64),
    Between { min: f64, max: f64 },
}

fn one_of() -> LootQuantity {
    LootQuantity::Exactly(1.0)
}

fn one() -> f64 {
    1.0
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LootEntry {
    pub item: String,
    #[serde(default = "one_of")]
    pub quantity: LootQuantity,
    #[serde(default = "one")]
    pub weight: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LootTable {
    pub id: String,
    #[serde(default = "one")]
    pub rolls: f64,
    pub entries: Vec<LootEntry>,
}

/// Draw from a table: `rolls` tickets, each landing on the entry its weight covers (the last one when the
/// sums fall short), with a ranged quantity thrown after the ticket.
pub fn roll_loot(table: &LootTable, rng: &mut Rng) -> Result<Vec<LootDrop>, RangeError> {
    let total: f64 = table.entries.iter().map(|entry| entry.weight).sum();
    if total <= 0.0 {
        return Ok(Vec::new());
    }
    let mut found: Vec<LootDrop> = Vec::new();
    let mut roll = 0.0;
    while roll < table.rolls {
        roll += 1.0;
        let mut ticket = rng.next() * total;
        let mut chosen = table.entries.last().expect("a table has entries");
        for entry in &table.entries {
            ticket -= entry.weight;
            if ticket <= 0.0 {
                chosen = entry;
                break;
            }
        }
        let quantity = match chosen.quantity {
            LootQuantity::Exactly(n) => n,
            LootQuantity::Between { min, max } => min + f64::from(rng.next_int((max - min + 1.0) as u32)?),
        };
        match found.iter_mut().find(|drop| drop.item == chosen.item) {
            Some(drop) => drop.quantity += quantity,
            None => found.push(LootDrop { item: chosen.item.clone(), quantity }),
        }
    }
    Ok(found)
}
