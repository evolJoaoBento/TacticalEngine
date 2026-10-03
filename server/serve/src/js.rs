//! What JavaScript does with text and numbers, where the dev plugins' answers depend on it.
//!
//! The Store judges titles by `trim().length` - JavaScript's trim, JavaScript's UTF-16 length - reads
//! uploads with Node's lenient base64, finds a proof by `Number(text)`, and writes timestamps as
//! `JSON.stringify` does (no `.0` on a whole number). Held to `server/fixtures/store.json`.

use serde_json::Number;

/// Whether JavaScript's `trim` takes this character: WhiteSpace and LineTerminator. Not U+0085, which
/// Rust's `char::is_whitespace` would take; and U+FEFF, which it would not.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// A string's `length` in JavaScript: UTF-16 units.
pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Base64 as Node's `Buffer.from(text, 'base64')` reads it: the standard and URL-safe alphabets, any
/// other character skipped, the first `=` the end, and a last lone character dropped.
pub fn node_base64(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let mut bits: u32 = 0;
    let mut count = 0;
    for c in text.chars() {
        let value = match c {
            'A'..='Z' => c as u32 - 'A' as u32,
            'a'..='z' => c as u32 - 'a' as u32 + 26,
            '0'..='9' => c as u32 - '0' as u32 + 52,
            '+' | '-' => 62,
            '/' | '_' => 63,
            '=' => break,
            _ => continue,
        };
        bits = (bits << 6) | value;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    out
}

/// `Number(text)` for a string: JavaScript's whitespace trimmed, empty is 0, `Infinity`, hex, octal and
/// binary literals, decimals with an exponent; anything else NaN.
pub fn js_number_of(text: &str) -> f64 {
    let text = js_trim(text);
    if text.is_empty() {
        return 0.0;
    }
    match text {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let radix = |digits: &str, base: u32| -> f64 {
        if digits.is_empty() || !digits.chars().all(|c| c.is_digit(base)) {
            return f64::NAN;
        }
        digits.chars().fold(0.0, |total, c| total * f64::from(base) + f64::from(c.to_digit(base).unwrap()))
    };
    let lower = text.get(..2).map(str::to_ascii_lowercase);
    match lower.as_deref() {
        Some("0x") => return radix(&text[2..], 16),
        Some("0o") => return radix(&text[2..], 8),
        Some("0b") => return radix(&text[2..], 2),
        _ => {}
    }
    // A decimal: [+-] digits [. digits] [e [+-] digits], at least one digit before the exponent.
    let bytes = text.as_bytes();
    let mut i = 0;
    if matches!(bytes.first(), Some(b'+' | b'-')) {
        i += 1;
    }
    let start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i - start;
    if i < bytes.len() && bytes[i] == b'.' {
        i += 1;
        let fraction = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        digits += i - fraction;
    }
    if digits == 0 {
        return f64::NAN;
    }
    if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
        i += 1;
        if matches!(bytes.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        let exponent = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == exponent {
            return f64::NAN;
        }
    }
    if i != bytes.len() {
        return f64::NAN;
    }
    text.parse().unwrap_or(f64::NAN)
}

/// A number as `JSON.stringify` writes it: a whole number without `.0`.
pub fn js_number(value: f64) -> Number {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        Number::from(value as i64)
    } else {
        Number::from_f64(value).unwrap_or_else(|| Number::from(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_as_javascript_reads_them() {
        for (text, wanted) in [("1", 1.0), (" 2 ", 2.0), ("", 0.0), ("0x1f", 31.0), ("1e1", 10.0), (".5", 0.5), ("5.", 5.0), ("-0", -0.0), ("+3", 3.0)] {
            assert_eq!(js_number_of(text), wanted, "{text:?}");
        }
        for text in ["abc", "1a", "inf", "infinity", "NaN", "0x", "1e", "--1", ".", "0x-1", "1_000"] {
            assert!(js_number_of(text).is_nan(), "{text:?}");
        }
    }

    #[test]
    fn whole_numbers_are_written_whole() {
        assert_eq!(serde_json::to_string(&js_number(1790620299871.0)).unwrap(), "1790620299871");
        // Not exactly a double: JavaScript prints the nearest one's shortest form, as serde_json does.
        assert_eq!(serde_json::to_string(&js_number(1790000000123.4567)).unwrap(), "1790000000123.4568");
    }
}
