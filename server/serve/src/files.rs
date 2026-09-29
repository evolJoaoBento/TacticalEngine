//! The JSON files under `data/`, read and written as `tools/*.ts` read and write them.
//!
//! While the dev plugins and this server share the folder (phase 1 of `docs/SERVER.md`), a file one
//! writes the other reads, so a write is what `JSON.stringify(value, null, 2)` writes - two spaces,
//! keys in the order they came, a newline at the end - through a `.partial` file renamed over the old,
//! so a reader never sees half of one.

use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::io;
use std::path::Path;

/// A file's JSON, or `fallback` when there is no file or it is not JSON of that shape.
pub fn read_json<T: DeserializeOwned>(path: &Path, fallback: T) -> T {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(value).map_err(io::Error::other)?;
    text.push('\n');
    let mut partial = path.as_os_str().to_owned();
    partial.push(".partial");
    fs::write(&partial, text)?;
    fs::rename(&partial, path)
}
