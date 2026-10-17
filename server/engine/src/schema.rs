//! Checking JSON that arrives from outside the process against the shapes zod checks in the TypeScript
//! (`character/schema.rs`, `dialogue/schema.rs`): the first failure, where and why. A present `null` is
//! not a missing field, since zod's `optional` refuses it.

use serde_json::{Map, Value};

/// Where a document first fails, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SchemaError {
    pub path: String,
    pub message: &'static str,
}

pub type Checked = Result<(), SchemaError>;

pub fn fail(path: &str, message: &'static str) -> Checked {
    Err(SchemaError { path: path.to_string(), message })
}

pub fn object<'a>(value: &'a Value, path: &str) -> Result<&'a Map<String, Value>, SchemaError> {
    value.as_object().ok_or_else(|| SchemaError { path: path.to_string(), message: "expected an object" })
}

pub fn string(value: &Value, path: &str, non_empty: bool) -> Checked {
    match value.as_str() {
        None => fail(path, "expected a string"),
        Some("") if non_empty => fail(path, "expected at least one character"),
        Some(_) => Ok(()),
    }
}

/// `z.number().int()`, with bounds when given.
pub fn int(value: &Value, path: &str, min: Option<f64>, max: Option<f64>) -> Checked {
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
pub fn optional(fields: &Map<String, Value>, key: &str, path: &str, check: impl Fn(&Value, &str) -> Checked) -> Checked {
    match fields.get(key) {
        None => Ok(()),
        Some(value) => check(value, &format!("{path}.{key}")),
    }
}

pub fn required(fields: &Map<String, Value>, key: &str, path: &str, check: impl Fn(&Value, &str) -> Checked) -> Checked {
    match fields.get(key) {
        None => fail(&format!("{path}.{key}"), "required"),
        Some(value) => check(value, &format!("{path}.{key}")),
    }
}

pub fn array(value: &Value, path: &str, each: impl Fn(&Value, &str) -> Checked) -> Checked {
    let Some(items) = value.as_array() else { return fail(path, "expected an array") };
    items.iter().enumerate().try_for_each(|(i, item)| each(item, &format!("{path}[{i}]")))
}

/// `z.number()`: any number JSON can carry.
pub fn number(value: &Value, path: &str) -> Checked {
    if value.is_number() {
        Ok(())
    } else {
        fail(path, "expected a number")
    }
}

/// `contentIdSchema`: `/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/` - lowercase words joined by one `-` or `_`.
pub fn content_id(value: &Value, path: &str) -> Checked {
    let Some(id) = value.as_str() else { return fail(path, "expected a string") };
    let word = |w: &str| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    if id.split(['-', '_']).all(word) {
        Ok(())
    } else {
        fail(path, "ids are lowercase kebab- or snake-case")
    }
}
