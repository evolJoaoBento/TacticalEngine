//! A content pack as a document (`src/engine/content/pack/document.ts`): reading one entry by entry, so
//! one bad weapon costs that weapon and not the file, and saying what it holds. An older document is
//! brought up to date first (`scene::migrate`); a newer one is refused by name.

use crate::content::schema::Kind;
use crate::js;
use crate::zod::{Issue, Key};
use serde::Serialize;
use serde_json::{Map, Value};

/// The document version this build writes.
pub const CURRENT_FORMAT_VERSION: f64 = 6.0;

/// A pack's lists, in the order the TypeScript reads them, and the kind each holds.
pub const PACK_LISTS: [(&str, Kind); 11] = [
    ("weapons", Kind::Weapon),
    ("armors", Kind::Armor),
    ("classes", Kind::Class),
    ("ancestries", Kind::Ancestry),
    ("communities", Kind::Community),
    ("subclasses", Kind::Subclass),
    ("cards", Kind::Card),
    ("adversaries", Kind::Adversary),
    ("abilities", Kind::Ability),
    ("conditionDefs", Kind::ConditionDef),
    ("code", Kind::Code),
];

/// What `describe_pack` calls one entry of a list, and several.
const NAMES: [(&str, &str); 11] = [
    ("weapon", "weapons"),
    ("armor", "armors"),
    ("class", "classes"),
    ("ancestry", "ancestries"),
    ("community", "communities"),
    ("subclass", "subclasses"),
    ("card", "cards"),
    ("adversary", "adversaries"),
    ("ability", "abilities"),
    ("condition", "conditions"),
    ("script", "scripts"),
];

/// A pack document: every list, read entries only, and the format it was stamped with, if any.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PackDocument {
    pub format_version: Option<f64>,
    pub lists: [Vec<Value>; 11],
}

impl PackDocument {
    pub fn list(&self, name: &str) -> &[Value] {
        PACK_LISTS.iter().position(|(list, _)| *list == name).map_or(&[], |i| &self.lists[i])
    }
}

impl Serialize for PackDocument {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut out = Map::new();
        for ((name, _), entries) in PACK_LISTS.iter().zip(&self.lists) {
            out.insert((*name).to_string(), Value::Array(entries.clone()));
        }
        if let Some(version) = self.format_version {
            out.insert("formatVersion".into(), Value::from(version as i64));
        }
        out.serialize(serializer)
    }
}

/// One entry that could not be read: whose, which field, and zod's words for what is wrong.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ContentIssue {
    pub source: String,
    pub entry: String,
    pub field: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PackReading {
    pub pack: PackDocument,
    pub issues: Vec<ContentIssue>,
    /// Why nothing was taken from the document, when nothing was.
    pub refused: Option<String>,
}

/// Read a pack document an entry at a time: what could be read, what could not and why, or why the
/// whole document was refused.
pub fn read_pack(raw: &Value, source: &str) -> PackReading {
    let mut issues: Vec<ContentIssue> = Vec::new();
    let refuse = |issues: Vec<ContentIssue>, reason: String| PackReading { pack: PackDocument::default(), issues, refused: Some(reason) };

    let Value::Object(given) = raw else { return refuse(issues, "it is not a JSON object".into()) };
    let claimed = given.get("formatVersion").and_then(Value::as_f64);
    if let Some(claimed) = claimed.filter(|&c| c > CURRENT_FORMAT_VERSION) {
        let (claimed, current) = (js::number_to_string(claimed), js::number_to_string(CURRENT_FORMAT_VERSION));
        return refuse(issues, format!("it was written by a newer build (format {claimed}; this one reads up to {current})"));
    }
    let migrated = crate::scene::migrate::migrate_document(raw);
    let doc = migrated.as_object().expect("an object migrates to an object");

    let mut pack = PackDocument::default();
    let mut offered = 0;
    for (at, (list, kind)) in PACK_LISTS.iter().enumerate() {
        let Some(entries) = doc.get(*list) else { continue };
        let Value::Array(entries) = entries else {
            issues.push(ContentIssue { source: source.into(), entry: (*list).into(), field: (*list).into(), message: "expected a list".into() });
            continue;
        };
        offered += entries.len();
        for (index, entry) in entries.iter().enumerate() {
            match kind.schema().parse(entry) {
                Ok(read) => pack.lists[at].push(read),
                Err(found) => {
                    let first: Option<&Issue> = found.first();
                    let mut field = vec![(*list).to_string(), index.to_string()];
                    field.extend(first.map(|i| i.path.iter().map(Key::text).collect::<Vec<_>>()).unwrap_or_default());
                    issues.push(ContentIssue {
                        source: source.into(),
                        entry: entry.get("id").and_then(Value::as_str).map_or_else(|| format!("{list}[{index}]"), str::to_string),
                        field: field.join("."),
                        message: first.map_or_else(|| "invalid".into(), |i| i.message.clone()),
                    });
                }
            }
        }
    }

    if offered == 0 {
        let names: Vec<&str> = PACK_LISTS.iter().map(|(list, _)| *list).collect();
        return refuse(issues, format!("it carries none of the lists a pack is made of ({})", names.join(", ")));
    }
    if pack.lists.iter().all(Vec::is_empty) {
        return refuse(issues, format!("none of its {offered} entries could be read"));
    }
    PackReading { pack, issues, refused: None }
}

/// A project's lists as a pack, stamped with the current format.
pub fn pack_of(lists: [Vec<Value>; 11]) -> PackDocument {
    PackDocument { format_version: Some(CURRENT_FORMAT_VERSION), lists }
}

/// "3 weapons, 1 card", or "nothing".
pub fn describe_pack(pack: &PackDocument) -> String {
    let parts: Vec<String> = pack
        .lists
        .iter()
        .zip(NAMES)
        .filter(|(entries, _)| !entries.is_empty())
        .map(|(entries, (one, many))| format!("{} {}", entries.len(), if entries.len() == 1 { one } else { many }))
        .collect();
    if parts.is_empty() {
        "nothing".into()
    } else {
        parts.join(", ")
    }
}
