//! The door a sheet comes in by (`src/engine/character/sheet-schema.ts`): a save file's or a project's
//! party, checked for being a sheet at all before anything derives from it. The TypeScript asks zod;
//! this asks the same questions by hand - strings are strings, whole numbers are whole, levels 1 to 10,
//! a tier 1 to 4, a pair is two - and, as zod does, keeps only the fields a sheet has. `null` is not a
//! missing field: zod's `optional` refuses it, and so does this.

use crate::character::sheet::CharacterSheet;
use serde_json::{Map, Value};

/// Where a sheet first fails, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SchemaError {
    pub path: String,
    pub message: &'static str,
}

type Checked = Result<(), SchemaError>;

fn fail(path: &str, message: &'static str) -> Checked {
    Err(SchemaError { path: path.to_string(), message })
}

fn object<'a>(value: &'a Value, path: &str) -> Result<&'a Map<String, Value>, SchemaError> {
    value.as_object().ok_or_else(|| SchemaError { path: path.to_string(), message: "expected an object" })
}

fn string(value: &Value, path: &str, non_empty: bool) -> Checked {
    match value.as_str() {
        None => fail(path, "expected a string"),
        Some("") if non_empty => fail(path, "expected at least one character"),
        Some(_) => Ok(()),
    }
}

/// `z.number().int()`, with bounds when given.
fn int(value: &Value, path: &str, min: Option<f64>, max: Option<f64>) -> Checked {
    let Some(n) = value.as_f64() else { return fail(path, "expected a number") };
    if !n.is_finite() || n.fract() != 0.0 {
        return fail(path, "expected a whole number");
    }
    if min.is_some_and(|min| n < min) || max.is_some_and(|max| n > max) {
        return fail(path, "out of range");
    }
    Ok(())
}

/// A field that may be missing; present, it must pass.
fn optional(fields: &Map<String, Value>, key: &str, path: &str, check: impl Fn(&Value, &str) -> Checked) -> Checked {
    match fields.get(key) {
        None => Ok(()),
        Some(value) => check(value, &format!("{path}.{key}")),
    }
}

fn required(fields: &Map<String, Value>, key: &str, path: &str, check: impl Fn(&Value, &str) -> Checked) -> Checked {
    match fields.get(key) {
        None => fail(&format!("{path}.{key}"), "required"),
        Some(value) => check(value, &format!("{path}.{key}")),
    }
}

fn array(value: &Value, path: &str, each: impl Fn(&Value, &str) -> Checked) -> Checked {
    let Some(items) = value.as_array() else { return fail(path, "expected an array") };
    items.iter().enumerate().try_for_each(|(i, item)| each(item, &format!("{path}[{i}]")))
}

/// `z.tuple([a, a])`: exactly two.
fn pair(value: &Value, path: &str, each: impl Fn(&Value, &str) -> Checked) -> Checked {
    match value.as_array() {
        Some(items) if items.len() == 2 => array(value, path, each),
        Some(_) => fail(path, "expected exactly two"),
        None => fail(path, "expected an array"),
    }
}

const TRAITS: [&str; 6] = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

fn trait_name(value: &Value, path: &str) -> Checked {
    match value.as_str() {
        Some(name) if TRAITS.contains(&name) => Ok(()),
        _ => fail(path, "expected a trait"),
    }
}

fn experience(value: &Value, path: &str) -> Checked {
    let fields = object(value, path)?;
    required(fields, "name", path, |v, p| string(v, p, true))?;
    required(fields, "modifier", path, |v, p| int(v, p, None, None))
}

fn advancement(value: &Value, path: &str) -> Checked {
    let fields = object(value, path)?;
    let kind = fields.get("kind").and_then(Value::as_str);
    match kind {
        Some("traits") => required(fields, "traits", path, |v, p| pair(v, p, trait_name))?,
        Some("experiences") => required(fields, "names", path, |v, p| pair(v, p, |v, p| string(v, p, false)))?,
        Some("domainCard") => required(fields, "card", path, |v, p| string(v, p, false))?,
        Some("multiclass") => {
            required(fields, "classId", path, |v, p| string(v, p, false))?;
            required(fields, "domain", path, |v, p| string(v, p, false))?;
        }
        Some("hitPoint" | "stress" | "evasion" | "subclass" | "proficiency") => {}
        _ => return fail(&format!("{path}.kind"), "not an advancement"),
    }
    optional(fields, "fromTier", path, |v, p| match v.as_f64() {
        Some(n) if [1.0, 2.0, 3.0, 4.0].contains(&n) => Ok(()),
        _ => fail(p, "expected a tier, 1 to 4"),
    })
}

fn level_record(value: &Value, path: &str) -> Checked {
    let fields = object(value, path)?;
    required(fields, "level", path, |v, p| int(v, p, Some(2.0), Some(10.0)))?;
    required(fields, "advancements", path, |v, p| array(v, p, advancement))?;
    required(fields, "domainCard", path, |v, p| string(v, p, false))?;
    optional(fields, "experience", path, experience)
}

fn check_sheet(value: &Value) -> Checked {
    let path = "sheet";
    let fields = object(value, path)?;
    let text = |v: &Value, p: &str| string(v, p, false);
    let texts = |v: &Value, p: &str| array(v, p, text);
    required(fields, "id", path, |v, p| string(v, p, true))?;
    required(fields, "name", path, text)?;
    required(fields, "level", path, |v, p| int(v, p, Some(1.0), Some(10.0)))?;
    required(fields, "classId", path, |v, p| string(v, p, true))?;
    optional(fields, "ancestryId", path, text)?;
    optional(fields, "communityId", path, text)?;
    required(fields, "traits", path, |v, p| {
        let traits = object(v, p)?;
        TRAITS.iter().try_for_each(|name| required(traits, name, p, |v, p| int(v, p, None, None)))
    })?;
    required(fields, "proficiency", path, |v, p| int(v, p, Some(1.0), None))?;
    optional(fields, "primaryWeaponId", path, text)?;
    optional(fields, "secondaryWeaponId", path, text)?;
    optional(fields, "armorId", path, text)?;
    optional(fields, "experiences", path, |v, p| array(v, p, experience))?;
    optional(fields, "bonuses", path, |v, p| {
        let bonuses = object(v, p)?;
        ["evasion", "hitPoints", "stress", "armorScore", "majorThreshold", "severeThreshold"].iter().try_for_each(|name| optional(bonuses, name, p, |v, p| int(v, p, None, None)))
    })?;
    optional(fields, "subclassId", path, text)?;
    optional(fields, "domainCards", path, texts)?;
    optional(fields, "loadout", path, texts)?;
    optional(fields, "levels", path, |v, p| array(v, p, level_record))?;
    optional(fields, "scars", path, |v, p| int(v, p, Some(0.0), None))?;
    optional(fields, "model", path, |v, p| string(v, p, true))
}

/// Parse an untrusted sheet: checked, then read, every field it does not know dropped.
pub fn parse_sheet(value: &Value) -> Result<CharacterSheet, SchemaError> {
    check_sheet(value)?;
    serde_json::from_value(value.clone()).map_err(|_| SchemaError { path: "sheet".into(), message: "not a sheet" })
}
