//! A zod-alike: the part of zod 4 the content schemas use, as data, so a Rust schema reads a document the
//! way the TypeScript's does - the same output, defaults put in and unknown keys dropped, and when it is
//! refused, the same issues with the same paths and the same words, since `readPack` shows zod's messages
//! to the player.
//!
//! What zod 4.5.4 does, as `server/fixtures/content.json` pins it: an object's fields are read in the
//! order the schema lists them and every field is read; a value of the wrong type, a word not in a set, a
//! failed union and a number that is not a whole one are *fatal* - nothing more is checked on that value,
//! and an object holding one skips its refinements - while a bound, a pattern or an integer past the safe
//! range is reported and the next check still runs. A length is checked on anything that has one, even
//! after its type or its items failed, and worded by what it found: a string's `min` given an array says
//! "expected array to have >=1 items". A default stands in, as written, for a missing field and only
//! a missing one; `null` is never missing. A union takes the first option that passes; failing that, the
//! one option that failed only on checks speaks for it, and otherwise it is "Invalid input".
//!
//! `Opaque` is what is not ported yet - a condition, an effect: passed through as it came.

use crate::js;
use serde::Serialize;
use serde_json::{Map, Value};

/// A step on the way to an issue: a key, or a list index.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum Key {
    Name(String),
    Index(usize),
}

impl Key {
    pub fn text(&self) -> String {
        match self {
            Key::Name(name) => name.clone(),
            Key::Index(index) => index.to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Issue {
    pub path: Vec<Key>,
    pub message: String,
    /// Whether it stops what is checked after it: zod's issues without `continue`.
    #[serde(skip)]
    pub fatal: bool,
}

/// What a refinement reports, at a path inside the object it refines.
pub struct Refinements<'a> {
    base: &'a [Key],
    issues: &'a mut Vec<Issue>,
}

impl Refinements<'_> {
    pub fn add(&mut self, path: Vec<Key>, message: String) {
        let mut full = self.base.to_vec();
        full.extend(path);
        self.issues.push(Issue { path: full, message, fatal: false });
    }
}

pub type Refine = fn(&Map<String, Value>, &mut Refinements);

pub enum Presence {
    Required,
    Optional,
    /// Put in, as written, when the field is missing.
    Default(fn() -> Value),
}

pub struct Field {
    pub key: &'static str,
    pub schema: Schema,
    pub presence: Presence,
}

pub enum Schema {
    /// `trim` is zod's overwrite: the text is trimmed before the checks after it read it.
    String { min: Option<usize>, pattern: Option<(fn(&str) -> bool, &'static str)>, trim: bool },
    Number { int: bool, min: Option<(f64, bool)>, max: Option<f64>, multiple_of: Option<f64> },
    Boolean,
    Enum(&'static [&'static str]),
    Literal(Value),
    Array { item: Box<Schema>, min: Option<usize> },
    Object { fields: Vec<Field>, refines: Vec<Refine> },
    Union(Vec<Schema>),
    Tagged { key: &'static str, variants: Vec<(&'static str, Schema)> },
    /// `z.record(key, value)`: an object of any keys, each key and value checked, then refined whole.
    Record { key: Box<Schema>, value: Box<Schema>, refines: Vec<Refine> },
    /// `z.tuple([...])`: exactly these, in order.
    Tuple(Vec<Schema>),
    /// `z.null()`.
    Null,
    /// `.nullable()`: `null`, or what the inner schema reads - its issues are its own.
    Nullable(Box<Schema>),
    /// A schema defined elsewhere, reached through a function so a schema can hold itself.
    Lazy(fn() -> &'static Schema),
    Opaque,
}

pub fn string() -> Schema {
    Schema::String { min: None, pattern: None, trim: false }
}
pub fn number() -> Schema {
    Schema::Number { int: false, min: None, max: None, multiple_of: None }
}
pub fn int() -> Schema {
    Schema::Number { int: true, min: None, max: None, multiple_of: None }
}
pub fn boolean() -> Schema {
    Schema::Boolean
}
pub fn one_of(options: &'static [&'static str]) -> Schema {
    Schema::Enum(options)
}
pub fn literal(value: Value) -> Schema {
    Schema::Literal(value)
}
pub fn array(item: Schema) -> Schema {
    Schema::Array { item: Box::new(item), min: None }
}
pub fn object(fields: Vec<Field>) -> Schema {
    Schema::Object { fields, refines: Vec::new() }
}
pub fn union(options: Vec<Schema>) -> Schema {
    Schema::Union(options)
}
pub fn tagged(key: &'static str, variants: Vec<(&'static str, Schema)>) -> Schema {
    Schema::Tagged { key, variants }
}
pub fn opaque() -> Schema {
    Schema::Opaque
}
pub fn record(key: Schema, value: Schema) -> Schema {
    Schema::Record { key: Box::new(key), value: Box::new(value), refines: Vec::new() }
}
pub fn tuple(items: Vec<Schema>) -> Schema {
    Schema::Tuple(items)
}
pub fn null() -> Schema {
    Schema::Null
}
pub fn nullable(inner: Schema) -> Schema {
    Schema::Nullable(Box::new(inner))
}
pub fn lazy(schema: fn() -> &'static Schema) -> Schema {
    Schema::Lazy(schema)
}

pub fn req(key: &'static str, schema: Schema) -> Field {
    Field { key, schema, presence: Presence::Required }
}
pub fn opt(key: &'static str, schema: Schema) -> Field {
    Field { key, schema, presence: Presence::Optional }
}
pub fn def(key: &'static str, schema: Schema, default: fn() -> Value) -> Field {
    Field { key, schema, presence: Presence::Default(default) }
}

impl Schema {
    /// `.min(n)`: characters for a string, items for an array, the least value for a number.
    pub fn min(self, n: f64) -> Schema {
        match self {
            Schema::String { pattern, trim, .. } => Schema::String { min: Some(n as usize), pattern, trim },
            Schema::Array { item, .. } => Schema::Array { item, min: Some(n as usize) },
            Schema::Number { int, max, multiple_of, .. } => Schema::Number { int, min: Some((n, true)), max, multiple_of },
            _ => panic!("min on a schema without one"),
        }
    }

    /// `.positive()`: more than nothing.
    pub fn positive(self) -> Schema {
        match self {
            Schema::Number { int, max, multiple_of, .. } => Schema::Number { int, min: Some((0.0, false)), max, multiple_of },
            _ => panic!("positive on a schema that is not a number"),
        }
    }

    pub fn max(self, n: f64) -> Schema {
        match self {
            Schema::Number { int, min, multiple_of, .. } => Schema::Number { int, min, max: Some(n), multiple_of },
            _ => panic!("max on a schema that is not a number"),
        }
    }

    /// `.multipleOf(step)`, checked after the bounds as the schemas write it, by zod's own remainder.
    pub fn multiple_of(self, step: f64) -> Schema {
        match self {
            Schema::Number { int, min, max, .. } => Schema::Number { int, min, max, multiple_of: Some(step) },
            _ => panic!("multipleOf on a schema that is not a number"),
        }
    }

    /// `.trim()`, written before the checks it comes ahead of.
    pub fn trim(self) -> Schema {
        match self {
            Schema::String { min, pattern, .. } => Schema::String { min, pattern, trim: true },
            _ => panic!("trim on a schema that is not a string"),
        }
    }

    /// `.regex(pattern, message)`, the pattern written as a test.
    pub fn regex(self, test: fn(&str) -> bool, message: &'static str) -> Schema {
        match self {
            Schema::String { min, trim, .. } => Schema::String { min, pattern: Some((test, message)), trim },
            _ => panic!("regex on a schema that is not a string"),
        }
    }

    /// `.superRefine(...)` on an object or a record: run on what was read, when nothing was fatal.
    pub fn refine(self, refine: Refine) -> Schema {
        match self {
            Schema::Object { fields, mut refines } => {
                refines.push(refine);
                Schema::Object { fields, refines }
            }
            Schema::Record { key, value, mut refines } => {
                refines.push(refine);
                Schema::Record { key, value, refines }
            }
            _ => panic!("refine on a schema that is neither an object nor a record"),
        }
    }

    /// Read a value: its output, or everything wrong with it.
    pub fn parse(&self, value: &Value) -> Result<Value, Vec<Issue>> {
        let mut issues = Vec::new();
        let out = self.read(Some(value), &mut Vec::new(), &mut issues);
        if issues.is_empty() {
            Ok(out)
        } else {
            Err(issues)
        }
    }

    fn read(&self, input: Option<&Value>, path: &mut Vec<Key>, issues: &mut Vec<Issue>) -> Value {
        let fatal = |issues: &mut Vec<Issue>, path: &[Key], message: String| issues.push(Issue { path: path.to_vec(), message, fatal: true });
        let expected = |issues: &mut Vec<Issue>, path: &[Key], what: &str| fatal(issues, path, format!("Invalid input: expected {what}, received {}", received(input)));
        match self {
            Schema::String { min, pattern, trim } => {
                let Some(Value::String(text)) = input else {
                    expected(issues, path, "string");
                    length_at_least(input, *min, path, issues);
                    return Value::Null;
                };
                let trimmed = Value::String(js::trim(text).to_string());
                let (text, input) = if *trim { (js::trim(text), Some(&trimmed)) } else { (text.as_str(), input) };
                length_at_least(input, *min, path, issues);
                if let Some((test, message)) = pattern {
                    if !test(text) {
                        issues.push(Issue { path: path.clone(), message: (*message).to_string(), fatal: false });
                    }
                }
                Value::String(text.to_string())
            }
            Schema::Number { int, min, max, multiple_of } => {
                let Some(n) = input.filter(|v| v.is_number()).and_then(Value::as_f64) else {
                    expected(issues, path, "number");
                    return Value::Null;
                };
                if *int {
                    const SAFE: f64 = 9_007_199_254_740_991.0;
                    if n.fract() != 0.0 {
                        expected(issues, path, "int");
                        return Value::Null;
                    }
                    if n > SAFE {
                        issues.push(Issue { path: path.clone(), message: "Too big: expected int to be <=9007199254740991".into(), fatal: false });
                    }
                    if n < -SAFE {
                        issues.push(Issue { path: path.clone(), message: "Too small: expected int to be >=-9007199254740991".into(), fatal: false });
                    }
                }
                if let Some((least, inclusive)) = *min {
                    if (inclusive && n < least) || (!inclusive && n <= least) {
                        let sign = if inclusive { ">=" } else { ">" };
                        issues.push(Issue { path: path.clone(), message: format!("Too small: expected number to be {sign}{}", js::number_to_string(least)), fatal: false });
                    }
                }
                if let Some(most) = *max {
                    if n > most {
                        issues.push(Issue { path: path.clone(), message: format!("Too big: expected number to be <={}", js::number_to_string(most)), fatal: false });
                    }
                }
                if let Some(step) = *multiple_of {
                    // zod's `floatSafeRemainder`: a multiple to within four epsilons of the quotient.
                    let ratio = n / step;
                    let tolerance = 4.0 * f64::EPSILON * js::max(ratio.abs(), 1.0);
                    if (ratio - js::round(ratio)).abs() >= tolerance {
                        issues.push(Issue { path: path.clone(), message: format!("Invalid number: must be a multiple of {}", js::number_to_string(step)), fatal: false });
                    }
                }
                input.cloned().unwrap_or(Value::Null)
            }
            Schema::Boolean => match input {
                Some(Value::Bool(b)) => Value::Bool(*b),
                _ => {
                    expected(issues, path, "boolean");
                    Value::Null
                }
            },
            Schema::Enum(options) => match input.and_then(Value::as_str).filter(|word| options.contains(word)) {
                Some(word) => Value::String(word.to_string()),
                // A set of one is worded as the one value it is.
                None if options.len() == 1 => {
                    fatal(issues, path, format!("Invalid input: expected \"{}\"", options[0]));
                    Value::Null
                }
                None => {
                    let listed: Vec<String> = options.iter().map(|o| format!("\"{o}\"")).collect();
                    fatal(issues, path, format!("Invalid option: expected one of {}", listed.join("|")));
                    Value::Null
                }
            },
            Schema::Literal(literal) => {
                if input == Some(literal) {
                    literal.clone()
                } else {
                    fatal(issues, path, format!("Invalid input: expected {literal}"));
                    Value::Null
                }
            }
            Schema::Array { item, min } => {
                let Some(Value::Array(items)) = input else {
                    expected(issues, path, "array");
                    length_at_least(input, *min, path, issues);
                    return Value::Null;
                };
                let out: Vec<Value> = items
                    .iter()
                    .enumerate()
                    .map(|(index, value)| {
                        path.push(Key::Index(index));
                        let out = item.read(Some(value), path, issues);
                        path.pop();
                        out
                    })
                    .collect();
                length_at_least(input, *min, path, issues);
                Value::Array(out)
            }
            Schema::Object { fields, refines } => {
                let Some(Value::Object(given)) = input else {
                    expected(issues, path, "object");
                    return Value::Null;
                };
                let from = issues.len();
                let mut out = Map::new();
                for field in fields {
                    match (given.get(field.key), &field.presence) {
                        (None, Presence::Optional) => {}
                        (None, Presence::Default(default)) => {
                            out.insert(field.key.to_string(), default());
                        }
                        (value, _) => {
                            path.push(Key::Name(field.key.to_string()));
                            let read = field.schema.read(value, path, issues);
                            path.pop();
                            out.insert(field.key.to_string(), read);
                        }
                    }
                }
                if !issues[from..].iter().any(|i| i.fatal) {
                    for refine in refines {
                        refine(&out, &mut Refinements { base: path, issues });
                    }
                }
                Value::Object(out)
            }
            Schema::Union(options) => {
                let mut tries: Vec<(Value, Vec<Issue>)> = Vec::new();
                for option in options {
                    let mut own = Vec::new();
                    let out = option.read(input, path, &mut own);
                    if own.is_empty() {
                        return out;
                    }
                    tries.push((out, own));
                }
                let mut unaborted: Vec<(Value, Vec<Issue>)> = tries.into_iter().filter(|(_, own)| !own.iter().any(|i| i.fatal)).collect();
                if unaborted.len() == 1 {
                    let (out, own) = unaborted.remove(0);
                    issues.extend(own);
                    return out;
                }
                fatal(issues, path, "Invalid input".into());
                Value::Null
            }
            Schema::Tagged { key, variants } => {
                let Some(Value::Object(given)) = input else {
                    expected(issues, path, "object");
                    return Value::Null;
                };
                match variants.iter().find(|(name, _)| given.get(*key).and_then(Value::as_str) == Some(name)) {
                    Some((_, schema)) => schema.read(input, path, issues),
                    None => {
                        let names: Vec<String> = variants.iter().map(|(name, _)| format!("'{name}'")).collect();
                        let mut at = path.clone();
                        at.push(Key::Name((*key).to_string()));
                        fatal(issues, &at, format!("Invalid discriminator value. Expected {}", names.join(" | ")));
                        Value::Null
                    }
                }
            }
            Schema::Record { key, value, refines } => {
                let Some(Value::Object(given)) = input else {
                    expected(issues, path, "record");
                    return Value::Null;
                };
                let from = issues.len();
                let mut out = Map::new();
                for (k, v) in given {
                    path.push(Key::Name(k.clone()));
                    let mut own = Vec::new();
                    key.read(Some(&Value::String(k.clone())), &mut Vec::new(), &mut own);
                    if own.is_empty() {
                        let read = value.read(Some(v), path, issues);
                        // An own `__proto__` sets the prototype of JavaScript's output, not a key of it.
                        if k != "__proto__" {
                            out.insert(k.clone(), read);
                        }
                    } else {
                        issues.push(Issue { path: path.clone(), message: "Invalid key in record".into(), fatal: true });
                    }
                    path.pop();
                }
                if !issues[from..].iter().any(|i| i.fatal) {
                    for refine in refines {
                        refine(&out, &mut Refinements { base: path, issues });
                    }
                }
                Value::Object(out)
            }
            Schema::Tuple(items) => {
                let Some(Value::Array(given)) = input else {
                    expected(issues, path, "tuple");
                    return Value::Null;
                };
                // Too few is the end of it; too many is said, and the items it has are still read.
                if given.len() < items.len() {
                    fatal(issues, path, format!("Too small: expected array to have >={} items", items.len()));
                    return Value::Null;
                }
                if given.len() > items.len() {
                    fatal(issues, path, format!("Too big: expected array to have <={} items", items.len()));
                }
                let out: Vec<Value> = items
                    .iter()
                    .zip(given)
                    .enumerate()
                    .map(|(index, (schema, value))| {
                        path.push(Key::Index(index));
                        let out = schema.read(Some(value), path, issues);
                        path.pop();
                        out
                    })
                    .collect();
                Value::Array(out)
            }
            Schema::Null => {
                if input == Some(&Value::Null) {
                    Value::Null
                } else {
                    expected(issues, path, "null");
                    Value::Null
                }
            }
            Schema::Nullable(inner) => match input {
                Some(Value::Null) => Value::Null,
                _ => inner.read(input, path, issues),
            },
            Schema::Lazy(schema) => schema().read(input, path, issues),
            Schema::Opaque => input.cloned().unwrap_or(Value::Null),
        }
    }

    /// The value with every opaque part blanked, so two readings can be compared where both are read.
    pub fn mask(&self, value: &Value) -> Value {
        match (self, value) {
            (Schema::Opaque, _) => Value::String("<not ported>".into()),
            (Schema::Array { item, .. }, Value::Array(items)) => Value::Array(items.iter().map(|v| item.mask(v)).collect()),
            (Schema::Object { fields, .. }, Value::Object(given)) => Value::Object(
                given
                    .iter()
                    .map(|(key, v)| match fields.iter().find(|f| f.key == key) {
                        Some(field) => (key.clone(), field.schema.mask(v)),
                        None => (key.clone(), v.clone()),
                    })
                    .collect(),
            ),
            (Schema::Lazy(schema), _) => schema().mask(value),
            (Schema::Nullable(inner), _) if !value.is_null() => inner.mask(value),
            (Schema::Tuple(items), Value::Array(given)) => Value::Array(given.iter().zip(items).map(|(v, s)| s.mask(v)).collect()),
            (Schema::Record { value: inner, .. }, Value::Object(given)) => Value::Object(given.iter().map(|(k, v)| (k.clone(), inner.mask(v))).collect()),
            (Schema::Tagged { key, variants }, Value::Object(given)) => match variants.iter().find(|(name, _)| given.get(*key).and_then(Value::as_str) == Some(name)) {
                Some((_, schema)) => schema.mask(value),
                None => value.clone(),
            },
            _ => value.clone(),
        }
    }

    /// Whether a path into a value passes through an opaque part.
    pub fn touches_opaque(&self, value: Option<&Value>, path: &[Key]) -> bool {
        match self {
            Schema::Opaque => true,
            Schema::Lazy(schema) => schema().touches_opaque(value, path),
            Schema::Tagged { key, variants } => {
                let tag = value.and_then(|v| v.get(*key)).and_then(Value::as_str);
                variants.iter().find(|(name, _)| Some(*name) == tag).is_some_and(|(_, schema)| schema.touches_opaque(value, path))
            }
            _ => match path.split_first() {
                None => false,
                Some((Key::Name(name), rest)) => match self {
                    Schema::Object { fields, .. } => fields.iter().find(|f| f.key == name).is_some_and(|f| f.schema.touches_opaque(value.and_then(|v| v.get(name)), rest)),
                    _ => false,
                },
                Some((Key::Index(index), rest)) => match self {
                    Schema::Array { item, .. } => item.touches_opaque(value.and_then(|v| v.get(*index)), rest),
                    _ => false,
                },
            },
        }
    }
}

/// A `min` length, checked on whatever has a length and worded by what it is.
fn length_at_least(input: Option<&Value>, min: Option<usize>, path: &[Key], issues: &mut Vec<Issue>) {
    let Some(min) = min else { return };
    let (length, what, unit) = match input {
        Some(Value::String(text)) => (text.encode_utf16().count(), "string", "characters"),
        Some(Value::Array(items)) => (items.len(), "array", "items"),
        _ => return,
    };
    if length < min {
        issues.push(Issue { path: path.to_vec(), message: format!("Too small: expected {what} to have >={min} {unit}"), fatal: false });
    }
}

/// What zod calls the type of what it was given.
fn received(input: Option<&Value>) -> &'static str {
    match input {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

/// `/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/`.
pub fn is_content_id(id: &str) -> bool {
    id.split(['-', '_']).all(|word| !word.is_empty() && word.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// `contentIdSchema`: a non-empty lowercase kebab- or snake-case id.
pub fn content_id() -> Schema {
    string().min(1.0).regex(is_content_id, "ids are lowercase kebab- or snake-case")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn messages(schema: &Schema, value: Value) -> Vec<String> {
        schema.parse(&value).err().unwrap_or_default().into_iter().map(|i| i.message).collect()
    }

    /// What zod 4.5.4 said to each, read off `node` while this was written.
    #[test]
    fn corners_the_content_never_reaches() {
        let fields = object(vec![req("a", one_of(&["x"])), req("b", string().min(1.0))]).refine(|_, found| found.add(vec![], "R".into()));
        assert_eq!(messages(&fields, json!({ "a": "y", "b": "" })), ["Invalid input: expected \"x\"", "Too small: expected string to have >=1 characters"]);
        assert_eq!(messages(&array(string()).min(2.0), json!("a")), ["Invalid input: expected array, received string", "Too small: expected string to have >=2 characters"]);
        assert_eq!(messages(&array(string()).min(3.0), json!([1])), ["Invalid input: expected string, received number", "Too small: expected array to have >=3 items"]);
        assert_eq!(messages(&int().max(10.0), json!(1152921504606846976_u64)), ["Too big: expected int to be <=9007199254740991", "Too big: expected number to be <=10"]);
        assert_eq!(messages(&int().positive(), json!(-1.5)), ["Invalid input: expected int, received number"]);
        let safe_then_refine = object(vec![req("a", int())]).refine(|_, found| found.add(vec![], "R".into()));
        assert_eq!(messages(&safe_then_refine, json!({ "a": 1152921504606846976_u64 })), ["Too big: expected int to be <=9007199254740991", "R"]);
        assert_eq!(messages(&union(vec![int().min(5.0), int().min(10.0)]), json!(1)), ["Invalid input"]);
        assert_eq!(messages(&null(), json!(3)), ["Invalid input: expected null, received number"]);
        // A bad key stops the refinements of the object holding the record; a bad value does too.
        let with_record = object(vec![req("r", record(string().min(1.0), number()))]).refine(|_, found| found.add(vec![], "R".into()));
        assert_eq!(messages(&with_record, json!({ "r": { "": 1 } })), ["Invalid key in record"]);
        assert_eq!(messages(&with_record, json!({ "r": { "a": "x" } })), ["Invalid input: expected number, received string"]);
        assert_eq!(messages(&tagged("kind", vec![("a", object(vec![req("kind", literal(json!("a")))]))]), json!({ "kind": 3 })), ["Invalid discriminator value. Expected 'a'"]);
    }

    /// What zod 4.5.4 said, on `node`, to the four the scene schemas brought in.
    #[test]
    fn multiples_tuples_trimming_and_refined_records() {
        let quarter = number().min(-10.0).max(10.0).multiple_of(0.25);
        for ok in [0.25, -0.75, 2.5] {
            assert!(quarter.parse(&json!(ok)).is_ok(), "{ok}");
        }
        for bad in [0.3, 1.1, 1e-7, 3.000000001] {
            assert_eq!(messages(&quarter, json!(bad)), ["Invalid number: must be a multiple of 0.25"], "{bad}");
        }
        assert_eq!(messages(&quarter, json!(11.1)), ["Too big: expected number to be <=10", "Invalid number: must be a multiple of 0.25"]);
        let pair = tuple(vec![string(), string()]);
        assert_eq!(pair.parse(&json!(["a", "b"])), Ok(json!(["a", "b"])));
        assert_eq!(messages(&pair, json!(["a"])), ["Too small: expected array to have >=2 items"]);
        assert_eq!(messages(&pair, json!(["a", "b", "c"])), ["Too big: expected array to have <=2 items"]);
        assert_eq!(messages(&pair, json!("x")), ["Invalid input: expected tuple, received string"]);
        assert_eq!(messages(&pair, json!([1, 2, 3])), ["Too big: expected array to have <=2 items", "Invalid input: expected string, received number", "Invalid input: expected string, received number"]);
        let trimmed = object(vec![def("pair", string().trim(), || json!("")), opt("n", string().trim().min(2.0))]);
        assert_eq!(trimmed.parse(&json!({ "pair": "  a b  " })), Ok(json!({ "pair": "a b" })));
        assert_eq!(messages(&trimmed, json!({ "n": " a " })), ["Too small: expected string to have >=2 characters"]);
        assert_eq!(trimmed.parse(&json!({ "n": "  abc " })), Ok(json!({ "pair": "", "n": "abc" })));
        let refined = record(string(), object(vec![req("s", string())])).refine(|map, found| {
            for key in map.keys() {
                found.add(vec![Key::Name(key.clone())], format!("R {key}"));
            }
        });
        assert_eq!(messages(&refined, json!({ "a": { "s": "x" }, "b": { "s": 1 } })), ["Invalid input: expected string, received number"]);
        assert_eq!(messages(&refined, json!({ "a": { "s": "x" } })), ["R a"]);
    }
}
