//! Levelling up (`src/engine/character/progression.ts`): the tier tables, the rule that a choice is
//! legal, and what a sheet's recorded levels add up to. Nothing is applied unless the whole plan is
//! legal, and a sheet is never changed in place - a level taken is a new sheet.
//!
//! A tier achievement's +1 Proficiency goes onto the sheet; a Proficiency box, like a Hit Point box, is
//! recorded and counted where the sheet is derived (`progression_bonuses`).

use crate::character::sheet::{CharacterSheet, Experience};
use crate::content::pack::{ContentPack, SubclassStage};
use crate::js;
use crate::rules::jump::{PartialTraits, Trait};
use serde::{Deserialize, Serialize};

/// Levels 2-4 are tier 2, 5-7 tier 3, 8-10 tier 4. Level 1 is tier 1 on its own.
pub type Tier = u8;

pub fn tier_of(level: f64) -> Tier {
    if level >= 8.0 {
        4
    } else if level >= 5.0 {
        3
    } else if level >= 2.0 {
        2
    } else {
        1
    }
}

pub const MAX_LEVEL: f64 = 10.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdvancementKind {
    Traits,
    HitPoint,
    Stress,
    Experiences,
    DomainCard,
    Evasion,
    Subclass,
    Proficiency,
    Multiclass,
}

impl AdvancementKind {
    pub const ALL: [AdvancementKind; 9] = [
        AdvancementKind::Traits,
        AdvancementKind::HitPoint,
        AdvancementKind::Stress,
        AdvancementKind::Experiences,
        AdvancementKind::DomainCard,
        AdvancementKind::Evasion,
        AdvancementKind::Subclass,
        AdvancementKind::Proficiency,
        AdvancementKind::Multiclass,
    ];

    pub fn name(self) -> &'static str {
        match self {
            AdvancementKind::Traits => "traits",
            AdvancementKind::HitPoint => "hitPoint",
            AdvancementKind::Stress => "stress",
            AdvancementKind::Experiences => "experiences",
            AdvancementKind::DomainCard => "domainCard",
            AdvancementKind::Evasion => "evasion",
            AdvancementKind::Subclass => "subclass",
            AdvancementKind::Proficiency => "proficiency",
            AdvancementKind::Multiclass => "multiclass",
        }
    }
}

/// One choice off the level-up sheet. `from_tier`, when set, is the tier whose sheet the box sits on.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Advancement {
    Traits {
        traits: [Trait; 2],
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_tier: Option<Tier>,
    },
    HitPoint {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_tier: Option<Tier>,
    },
    Stress {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_tier: Option<Tier>,
    },
    Experiences {
        names: [String; 2],
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_tier: Option<Tier>,
    },
    DomainCard {
        card: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_tier: Option<Tier>,
    },
    Evasion {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_tier: Option<Tier>,
    },
    Subclass {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_tier: Option<Tier>,
    },
    Proficiency {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_tier: Option<Tier>,
    },
    Multiclass {
        class_id: String,
        domain: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_tier: Option<Tier>,
    },
}

impl Advancement {
    pub fn kind(&self) -> AdvancementKind {
        match self {
            Advancement::Traits { .. } => AdvancementKind::Traits,
            Advancement::HitPoint { .. } => AdvancementKind::HitPoint,
            Advancement::Stress { .. } => AdvancementKind::Stress,
            Advancement::Experiences { .. } => AdvancementKind::Experiences,
            Advancement::DomainCard { .. } => AdvancementKind::DomainCard,
            Advancement::Evasion { .. } => AdvancementKind::Evasion,
            Advancement::Subclass { .. } => AdvancementKind::Subclass,
            Advancement::Proficiency { .. } => AdvancementKind::Proficiency,
            Advancement::Multiclass { .. } => AdvancementKind::Multiclass,
        }
    }

    pub fn from_tier(&self) -> Option<Tier> {
        match self {
            Advancement::Traits { from_tier, .. }
            | Advancement::HitPoint { from_tier }
            | Advancement::Stress { from_tier }
            | Advancement::Experiences { from_tier, .. }
            | Advancement::DomainCard { from_tier, .. }
            | Advancement::Evasion { from_tier }
            | Advancement::Subclass { from_tier }
            | Advancement::Proficiency { from_tier }
            | Advancement::Multiclass { from_tier, .. } => *from_tier,
        }
    }
}

/// What a tier's sheet offers: how many times each box can be ticked, and what it costs.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierOption {
    pub kind: AdvancementKind,
    /// Boxes on the sheet for this option in this tier.
    pub limit: u32,
    /// Advancement picks it consumes. Two for the big ones.
    pub cost: u32,
    /// For the extra-card box: the highest card level this tier's box allows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_cap: Option<f64>,
}

const fn option(kind: AdvancementKind, limit: u32, cost: u32, card_cap: Option<f64>) -> TierOption {
    TierOption { kind, limit, cost, card_cap }
}

const TIER_2: [TierOption; 6] = [
    option(AdvancementKind::Traits, 3, 1, None),
    option(AdvancementKind::HitPoint, 2, 1, None),
    option(AdvancementKind::Stress, 2, 1, None),
    option(AdvancementKind::Experiences, 1, 1, None),
    option(AdvancementKind::Evasion, 1, 1, None),
    option(AdvancementKind::DomainCard, 1, 1, Some(4.0)),
];

const TIER_3: [TierOption; 9] = [
    option(AdvancementKind::Traits, 3, 1, None),
    option(AdvancementKind::HitPoint, 2, 1, None),
    option(AdvancementKind::Stress, 2, 1, None),
    option(AdvancementKind::Experiences, 1, 1, None),
    option(AdvancementKind::Evasion, 1, 1, None),
    option(AdvancementKind::DomainCard, 1, 1, Some(7.0)),
    option(AdvancementKind::Subclass, 1, 1, None),
    option(AdvancementKind::Proficiency, 1, 2, None),
    option(AdvancementKind::Multiclass, 1, 2, None),
];

const TIER_4: [TierOption; 9] = [
    option(AdvancementKind::Traits, 3, 1, None),
    option(AdvancementKind::HitPoint, 2, 1, None),
    option(AdvancementKind::Stress, 2, 1, None),
    option(AdvancementKind::Experiences, 1, 1, None),
    option(AdvancementKind::Evasion, 1, 1, None),
    option(AdvancementKind::DomainCard, 1, 1, None),
    option(AdvancementKind::Subclass, 1, 1, None),
    option(AdvancementKind::Proficiency, 1, 2, None),
    option(AdvancementKind::Multiclass, 1, 2, None),
];

/// `TIER_OPTIONS`: tier 1 has no sheet; tier 2 no subclass, Proficiency or multiclass boxes.
pub fn tier_options(tier: Tier) -> &'static [TierOption] {
    match tier {
        2 => &TIER_2,
        3 => &TIER_3,
        4 => &TIER_4,
        _ => &[],
    }
}

/// The tier whose unmarked boxes a level in `tier` may also spend, if any.
pub fn previous_tier(tier: Tier) -> Option<Tier> {
    match tier {
        3 => Some(2),
        4 => Some(3),
        _ => None,
    }
}

/// An option as offered at a level: which tier's sheet the box sits on, and the boxes left.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct OfferedOption {
    #[serde(flatten)]
    pub option: TierOption,
    pub tier: Tier,
}

pub const PICKS_PER_LEVEL: u32 = 2;
/// Levels at which the tier achievements land: a new Experience and +1 Proficiency.
pub const ACHIEVEMENT_LEVELS: [f64; 3] = [2.0, 5.0, 8.0];
/// Levels at which every marked trait is cleared, so it can be raised again.
pub const TRAIT_CLEAR_LEVELS: [f64; 2] = [5.0, 8.0];

/// One recorded level-up, so a sheet can say how it got here.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelRecord {
    pub level: f64,
    pub advancements: Vec<Advancement>,
    /// The domain card gained at this level.
    pub domain_card: String,
    /// The Experience gained at a tier achievement level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experience: Option<Experience>,
}

/// What a character wants to do with a level.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelUpPlan {
    pub advancements: Vec<Advancement>,
    pub domain_card: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experience: Option<Experience>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LevelUpIssue {
    pub field: &'static str,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Reading a sheet's history
// ---------------------------------------------------------------------------

fn records(sheet: &CharacterSheet) -> &[LevelRecord] {
    sheet.levels.as_deref().unwrap_or(&[])
}

fn every_advancement(sheet: &CharacterSheet) -> impl Iterator<Item = (&LevelRecord, &Advancement)> {
    records(sheet).iter().flat_map(|record| record.advancements.iter().map(move |a| (record, a)))
}

/// How many boxes of an option are ticked on one tier's sheet.
pub fn taken_in_tier(sheet: &CharacterSheet, tier: Tier, kind: AdvancementKind) -> u32 {
    every_advancement(sheet).filter(|(record, a)| a.kind() == kind && a.from_tier().unwrap_or_else(|| tier_of(record.level)) == tier).count() as u32
}

fn has_multiclassed(sheet: &CharacterSheet) -> bool {
    every_advancement(sheet).any(|(_, a)| a.kind() == AdvancementKind::Multiclass)
}

/// Whether a box is crossed out rather than merely used up, and why.
pub fn crossed_out(sheet: &CharacterSheet, tier: Tier, kind: AdvancementKind) -> Option<String> {
    if kind == AdvancementKind::Multiclass {
        if has_multiclassed(sheet) {
            return Some("already multiclassed".into());
        }
        if taken_in_tier(sheet, tier, AdvancementKind::Subclass) > 0 {
            return Some(format!("crossed out by the tier {tier} subclass card"));
        }
    }
    if kind == AdvancementKind::Subclass && has_multiclassed(sheet) && subclass_stage(sheet) != SubclassStage::Foundation {
        return Some("multiclassing crossed out the mastery card".into());
    }
    None
}

/// Traits raised by an advancement since the last clear, in the order a `Set` keeps them.
pub fn marked_traits(sheet: &CharacterSheet) -> Vec<Trait> {
    let mut marked: Vec<Trait> = Vec::new();
    for record in records(sheet) {
        if TRAIT_CLEAR_LEVELS.contains(&record.level) {
            marked.clear();
        }
        for advancement in &record.advancements {
            if let Advancement::Traits { traits, .. } = advancement {
                for &t in traits {
                    if !marked.contains(&t) {
                        marked.push(t);
                    }
                }
            }
        }
    }
    marked
}

/// The subclass stage a sheet has reached: how many upgrade cards it has taken.
pub fn subclass_stage(sheet: &CharacterSheet) -> SubclassStage {
    match every_advancement(sheet).filter(|(_, a)| a.kind() == AdvancementKind::Subclass).count() {
        0 => SubclassStage::Foundation,
        1 => SubclassStage::Specialization,
        _ => SubclassStage::Mastery,
    }
}

/// Every domain a character may draw cards from: the class's, plus a multiclass's chosen one.
pub fn domains_of(sheet: &CharacterSheet, content: &ContentPack) -> Vec<String> {
    let mut domains = content.classes.get(&sheet.class_id).map(|c| c.domains.clone()).unwrap_or_default();
    for (_, advancement) in every_advancement(sheet) {
        if let Advancement::Multiclass { domain, .. } = advancement {
            if !domains.contains(domain) {
                domains.push(domain.clone());
            }
        }
    }
    domains
}

/// Every domain card the sheet holds, from level 1 and each level since.
pub fn held_cards(sheet: &CharacterSheet) -> Vec<String> {
    let mut cards = sheet.domain_cards.clone().unwrap_or_default();
    for record in records(sheet) {
        cards.push(record.domain_card.clone());
        for advancement in &record.advancements {
            if let Advancement::DomainCard { card, .. } = advancement {
                cards.push(card.clone());
            }
        }
    }
    cards
}

/// Whether a sheet may take a card: right domain, low enough level, not already held. `Err` says why not.
pub fn card_allowed(sheet: &CharacterSheet, content: &ContentPack, card_id: &str, at_level: f64) -> Result<(), String> {
    let Some(card) = content.cards.get(card_id) else {
        return Err(format!("unknown domain card \"{card_id}\""));
    };
    if !card.is_domain_card() {
        return Err(format!("\"{}\" is not a card anybody chooses", card.name));
    }
    let domain = card.domain.as_deref().expect("a domain card has a domain");
    let level = card.level.expect("a domain card has a level");
    if !domains_of(sheet, content).iter().any(|d| d == domain) {
        return Err(format!("\"{}\" is a {domain} card, outside this character's domains", card.name));
    }
    if level > at_level {
        return Err(format!("\"{}\" is level {}", card.name, js::number_to_string(level)));
    }
    if held_cards(sheet).iter().any(|id| id == card_id) {
        return Err(format!("\"{}\" is already held", card.name));
    }
    Ok(())
}

/// Options with a box still open at this level: this tier's sheet first, then whatever is left unmarked
/// on the previous tier's, each tagged with the sheet it sits on.
pub fn available_advancements(sheet: &CharacterSheet, at_level: f64) -> Vec<OfferedOption> {
    let tier = tier_of(at_level);
    let mut offered = Vec::new();
    for from in std::iter::once(tier).chain(previous_tier(tier)) {
        for option in tier_options(from) {
            if crossed_out(sheet, from, option.kind).is_some() {
                continue;
            }
            let taken = taken_in_tier(sheet, from, option.kind);
            if option.limit > taken {
                offered.push(OfferedOption { option: TierOption { limit: option.limit - taken, ..*option }, tier: from });
            }
        }
    }
    offered
}

// ---------------------------------------------------------------------------
// Taking a level
// ---------------------------------------------------------------------------

/// Level a sheet up by one, or say what is wrong with the plan: `Err` holds every issue, in the order
/// the TypeScript finds them, and the sheet is left as it was.
pub fn level_up(sheet: &CharacterSheet, content: &ContentPack, plan: &LevelUpPlan) -> Result<CharacterSheet, Vec<LevelUpIssue>> {
    let mut issues: Vec<LevelUpIssue> = Vec::new();
    let mut fail = |field: &'static str, message: String| issues.push(LevelUpIssue { field, message });
    let next = sheet.level + 1.0;
    let tier = tier_of(next);

    if sheet.level >= MAX_LEVEL {
        fail("level", format!("already at level {}", js::number_to_string(MAX_LEVEL)));
    }

    // ---- the picks ----
    let mut spent = 0;
    let mut taken_now: Vec<((Tier, AdvancementKind), u32)> = Vec::new();
    let mut card_caps: Vec<(usize, f64)> = Vec::new();
    for (index, advancement) in plan.advancements.iter().enumerate() {
        let kind = advancement.kind();
        let from = advancement.from_tier().unwrap_or(tier);
        if from != tier && Some(from) != previous_tier(tier) {
            fail("advancements", format!("tier {tier} cannot spend a box on the tier {from} sheet"));
            continue;
        }
        let Some(option) = tier_options(from).iter().find(|o| o.kind == kind) else {
            fail("advancements", format!("\"{}\" is not on the tier {from} sheet", kind.name()));
            continue;
        };
        spent += option.cost;
        if let Some(crossed) = crossed_out(sheet, from, kind) {
            fail("advancements", format!("\"{}\" on the tier {from} sheet: {crossed}", kind.name()));
        }
        let now = taken_now.iter().find(|(key, _)| *key == (from, kind)).map_or(0, |&(_, n)| n);
        if taken_in_tier(sheet, from, kind) + now >= option.limit {
            fail("advancements", format!("\"{}\" has no boxes left in tier {from}", kind.name()));
        }
        match taken_now.iter_mut().find(|(key, _)| *key == (from, kind)) {
            Some(entry) => entry.1 += 1,
            None => taken_now.push(((from, kind), 1)),
        }
        if let Some(cap) = option.card_cap {
            card_caps.push((index, cap));
        }
    }
    // A subclass card and a multiclass on the same sheet cross each other out.
    let has_kind = |kind: AdvancementKind| plan.advancements.iter().any(|a| a.kind() == kind);
    if has_kind(AdvancementKind::Subclass) && has_kind(AdvancementKind::Multiclass) {
        fail("advancements", "an upgraded subclass card and a multiclass cross each other out".into());
    }
    if spent != PICKS_PER_LEVEL {
        fail("advancements", format!("a level-up spends exactly {PICKS_PER_LEVEL} picks; this plan spends {spent}"));
    }

    // ---- each pick's own rule ----
    let marked = marked_traits(sheet);
    let mut bumped_now: Vec<Trait> = Vec::new();
    for (index, advancement) in plan.advancements.iter().enumerate() {
        match advancement {
            Advancement::Traits { traits, .. } => {
                if traits[0] == traits[1] {
                    fail("traits", "the two traits must differ".into());
                }
                for &t in traits {
                    if marked.contains(&t) || bumped_now.contains(&t) {
                        fail("traits", format!("{} is already marked", t.name()));
                    }
                    if !bumped_now.contains(&t) {
                        bumped_now.push(t);
                    }
                }
            }
            Advancement::Experiences { names, .. } => {
                let known = sheet.experiences.as_deref().unwrap_or(&[]);
                for name in names {
                    if !known.iter().any(|e| &e.name == name) {
                        fail("experiences", format!("no Experience named \"{name}\""));
                    }
                }
                if names[0] == names[1] {
                    fail("experiences", "the two Experiences must differ".into());
                }
            }
            Advancement::DomainCard { card, .. } => {
                let cap = card_caps.iter().find(|&&(at, _)| at == index).map_or(next, |&(_, cap)| cap);
                if let Err(reason) = card_allowed(sheet, content, card, js::min(next, cap)) {
                    fail("domainCard", reason);
                }
                if *card == plan.domain_card {
                    fail("domainCard", "that is already the card this level grants".into());
                }
            }
            Advancement::Subclass { .. } => {
                if sheet.subclass_id.is_none() {
                    fail("subclass", "no subclass to upgrade".into());
                }
                if subclass_stage(sheet) == SubclassStage::Mastery {
                    fail("subclass", "already at mastery".into());
                }
            }
            Advancement::Multiclass { class_id, domain, .. } => {
                match content.classes.get(class_id) {
                    None => fail("multiclass", format!("unknown class \"{class_id}\"")),
                    Some(_) if *class_id == sheet.class_id => fail("multiclass", "that is already this character's class".into()),
                    Some(klass) if !klass.domains.contains(domain) => fail("multiclass", format!("{} does not have the {domain} domain", klass.name)),
                    Some(_) => {}
                }
                if has_multiclassed(sheet) {
                    fail("multiclass", "already multiclassed".into());
                }
            }
            _ => {}
        }
    }

    // ---- the card every level grants ----
    if let Err(reason) = card_allowed(sheet, content, &plan.domain_card, next) {
        fail("domainCard", reason);
    }

    // ---- the tier achievement ----
    let achievement = ACHIEVEMENT_LEVELS.contains(&next);
    if achievement && plan.experience.is_none() {
        fail("experience", format!("level {} grants a new Experience; name it", js::number_to_string(next)));
    }
    if !achievement && plan.experience.is_some() {
        fail("experience", format!("level {} does not grant an Experience", js::number_to_string(next)));
    }

    if !issues.is_empty() {
        return Err(issues);
    }

    let mut experiences = sheet.experiences.clone().unwrap_or_default();
    experiences.extend(plan.experience.clone());
    let mut levels = sheet.levels.clone().unwrap_or_default();
    levels.push(LevelRecord { level: next, advancements: plan.advancements.clone(), domain_card: plan.domain_card.clone(), experience: plan.experience.clone() });
    Ok(CharacterSheet {
        level: next,
        // The tier achievement's +1. A Proficiency box is counted where the sheet is derived.
        proficiency: sheet.proficiency + if achievement { 1.0 } else { 0.0 },
        experiences: Some(experiences),
        levels: Some(levels),
        ..sheet.clone()
    })
}

/// What a sheet's recorded levels add to the numbers. `derive_character` reads this.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionBonuses {
    pub traits: PartialTraits,
    pub hit_points: f64,
    pub stress: f64,
    pub evasion: f64,
    /// "Increase your Proficiency by +1", once for each Proficiency box ticked.
    pub proficiency: f64,
    /// By Experience name, in the order first bumped.
    #[serde(serialize_with = "as_map")]
    pub experiences: Vec<(String, f64)>,
}

fn as_map<S: serde::Serializer>(entries: &[(String, f64)], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_map(entries.iter().map(|(k, v)| (k, v)))
}

impl ProgressionBonuses {
    pub fn experience(&self, name: &str) -> Option<f64> {
        self.experiences.iter().find(|(known, _)| known == name).map(|&(_, n)| n)
    }
}

pub fn progression_bonuses(sheet: &CharacterSheet) -> ProgressionBonuses {
    let mut bonuses = ProgressionBonuses::default();
    for (_, advancement) in every_advancement(sheet) {
        match advancement {
            Advancement::Traits { traits, .. } => {
                for &t in traits {
                    bonuses.traits.add(t, 1.0);
                }
            }
            Advancement::HitPoint { .. } => bonuses.hit_points += 1.0,
            Advancement::Stress { .. } => bonuses.stress += 1.0,
            Advancement::Evasion { .. } => bonuses.evasion += 1.0,
            Advancement::Proficiency { .. } => bonuses.proficiency += 1.0,
            Advancement::Experiences { names, .. } => {
                for name in names {
                    match bonuses.experiences.iter_mut().find(|(known, _)| known == name) {
                        Some(entry) => entry.1 += 1.0,
                        None => bonuses.experiences.push((name.clone(), 1.0)),
                    }
                }
            }
            _ => {}
        }
    }
    bonuses
}
