//! JavaScript's arithmetic where it differs from Rust's, as V8 computes it - the engine's rules were
//! written against these, and a walk that rounds a spot to a tile the other way is on another tile.

/// `Math.round`: to the nearest integer, a half towards +Infinity (`Math.round(-0.5)` is -0, not -1).
/// V8's `Float64Round`: the ceiling, less one when that is more than half above.
pub fn round(x: f64) -> f64 {
    let up = x.ceil();
    if up - 0.5 <= x {
        up
    } else {
        up - 1.0
    }
}

/// `Math.hypot(a, b)` as V8 computes it: both scaled by the larger, the squares summed with Kahan's
/// compensation, the root scaled back. Not always the last bit `f64::hypot` gives.
pub fn hypot(a: f64, b: f64) -> f64 {
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let values = [a.abs(), b.abs()];
    let max = if values[1] > values[0] { values[1] } else { values[0] };
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut compensation = 0.0;
    for value in values {
        let n = value / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// `Math.max(a, b)` for numbers that are not NaN: +0 above -0, as JavaScript has it.
pub fn max(a: f64, b: f64) -> f64 {
    if a > b || (a == b && b.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `Math.min(a, b)` for numbers that are not NaN: -0 below +0.
pub fn min(a: f64, b: f64) -> f64 {
    if a < b || (a == b && a.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `Math.trunc`: towards zero.
pub fn trunc(x: f64) -> f64 {
    x.trunc()
}

/// Whether JavaScript's `\s` and `trim` take this character: WhiteSpace and LineTerminator - U+FEFF
/// included, U+0085 not, the other way round from `char::is_whitespace`.
pub fn is_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

/// `String.prototype.trim`.
pub fn trim(text: &str) -> &str {
    text.trim_matches(is_space)
}

/// A number as `String(n)` writes it (`Number::toString`): the shortest digits that read back as the same
/// number, laid out by where the point falls - whole numbers to 21 digits in full, padded with zeros past
/// the digits they need; decimals down to a millionth; the exponent form, with its sign, beyond either.
pub fn number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x == 0.0 {
        return "0".into();
    }
    // Rust's `{:e}` is the shortest round trip, as JavaScript's digits are.
    let shortest = format!("{:e}", x.abs());
    let (mantissa, exponent) = shortest.split_once('e').expect("an exponent");
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().expect("a whole exponent") + 1;
    let zeros = |count: i32| "0".repeat(count.max(0) as usize);
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", zeros(n - k))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", zeros(-n))
    } else {
        let point = if k > 1 { format!("{}.{}", &digits[..1], &digits[1..]) } else { digits.clone() };
        let sign = if n - 1 >= 0 { "+" } else { "-" };
        format!("{point}e{sign}{}", (n - 1).abs())
    };
    if x < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_written_as_javascript_writes_them() {
        for (x, text) in [(0.0, "0"), (-0.0, "0"), (3.0, "3"), (-2.0, "-2"), (0.5, "0.5"), (1e20, "100000000000000000000"), (1e21, "1e+21"), (1.5e22, "1.5e+22"), (1e-7, "1e-7"), (1152921504606846976.0, "1152921504606847000"), (123e-20, "1.23e-18"), (0.000001, "0.000001"), (-0.000123, "-0.000123"), (123456.789, "123456.789"), (1e-6, "0.000001"), (-1e21, "-1e+21"), (2.5e-7, "2.5e-7"), (9007199254740993.0, "9007199254740992")] {
            assert_eq!(number_to_string(x), text, "{x}");
        }
    }

    #[test]
    fn rounds_halves_up() {
        assert_eq!(round(0.5), 1.0);
        assert_eq!(round(-0.5), 0.0);
        assert!(round(-0.5).is_sign_negative());
        assert_eq!(round(-1.5), -1.0);
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(round(-0.35), 0.0);
    }

    #[test]
    fn hypot_is_the_root_of_a_whole_square() {
        assert_eq!(hypot(3.0, 4.0), 5.0);
        assert_eq!(hypot(0.0, 0.0), 0.0);
        assert_eq!(hypot(1.0, 1.0), std::f64::consts::SQRT_2);
    }
}

/// The order `Array.prototype.sort` puts strings in with no comparator: by UTF-16 code unit, so a
/// character past U+FFFF (two surrogates, from U+D800) sorts before one from U+E000 to U+FFFF, which
/// Rust's own `str` order puts the other way round.
pub fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// `Number(text)` for a string: JavaScript's whitespace trimmed, empty is 0, `Infinity`, hex, octal and
/// binary literals, decimals with an exponent; anything else NaN.
pub fn number_of(text: &str) -> f64 {
    let text = trim(text);
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

/// Where an ASCII character falls in ICU's root collation, which `localeCompare` uses: `None` for the
/// control characters it ignores; whitespace, then punctuation and symbols in its order, then digits,
/// then letters with case set aside. Past ASCII, a character falls after every letter by code point -
/// not ICU's order, which content ids (ASCII by schema) never reach.
fn collation_weight(c: char) -> Option<u32> {
    const SPACES: &str = "\t\n\u{b}\u{c}\r ";
    const MARKS: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
    if let Some(at) = SPACES.find(c) {
        return Some(at as u32);
    }
    if let Some(at) = MARKS.find(c) {
        return Some(10 + at as u32);
    }
    match c {
        '\0'..='\u{1f}' | '\u{7f}' => None,
        '0'..='9' => Some(100 + (c as u32 - '0' as u32)),
        'a'..='z' => Some(200 + (c as u32 - 'a' as u32)),
        'A'..='Z' => Some(200 + (c as u32 - 'A' as u32)),
        _ => Some(1000 + c as u32),
    }
}

/// `a.localeCompare(b)` as Node's ICU answers it, for the strings the engine sorts: by character with
/// case set aside, then lowercase before uppercase, left to right. Strings differing only in ignored
/// characters are equal, as they are to ICU.
pub fn locale_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let keys = |s: &str| s.chars().filter_map(|c| collation_weight(c).map(|w| (w, c.is_ascii_uppercase()))).collect::<Vec<_>>();
    let (a, b) = (keys(a), keys(b));
    let primary = |k: &[(u32, bool)]| k.iter().map(|&(w, _)| w).collect::<Vec<_>>();
    primary(&a).cmp(&primary(&b)).then_with(|| {
        let case = |k: &[(u32, bool)]| k.iter().map(|&(_, upper)| upper).collect::<Vec<_>>();
        case(&a).cmp(&case(&b))
    })
}

/// Whether a property name is an array index - a canonical number from 0 to 2^32 - 2 - which a JavaScript
/// object keeps ahead of every other key, in ascending order.
pub fn is_array_index(key: &str) -> bool {
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_digit()) || (key.len() > 1 && key.starts_with('0')) {
        return false;
    }
    key.parse::<u64>().is_ok_and(|n| n < u64::from(u32::MAX))
}

/// A plain JavaScript object's own properties, in the order it keeps them: array indices first, ascending,
/// then every other key in the order it was first set.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct JsObject(Vec<(String, serde_json::Value)>);

impl JsObject {
    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn contains(&self, key: &str) -> bool {
        self.0.iter().any(|(k, _)| k == key)
    }

    /// `object[key] = value`: a known key keeps its place.
    pub fn set(&mut self, key: &str, value: serde_json::Value) {
        if let Some(entry) = self.0.iter_mut().find(|(k, _)| k == key) {
            entry.1 = value;
            return;
        }
        let at = if is_array_index(key) {
            let n: u64 = key.parse().expect("an index");
            self.0.iter().position(|(k, _)| !is_array_index(k) || k.parse::<u64>().is_ok_and(|m| m > n)).unwrap_or(self.0.len())
        } else {
            self.0.len()
        };
        self.0.insert(at, (key.to_string(), value));
    }

    /// `delete object[key]`: whether it was there.
    pub fn delete(&mut self, key: &str) -> bool {
        let before = self.0.len();
        self.0.retain(|(k, _)| k != key);
        self.0.len() != before
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }

    pub fn entries(&self) -> &[(String, serde_json::Value)] {
        &self.0
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::Value::Object(self.0.iter().cloned().collect())
    }
}

#[cfg(test)]
mod collation {
    use super::*;

    #[test]
    fn sorts_as_node_does() {
        let mut xs = vec![
            "a-b", "ab", "a_b", "aB", "Ab", "a1", "a-1", "a10", "a2", "A", "a", "b", "B", "_a", "-a", "0a", "a.b", "a b", "kara", "Kara",
            "group-1-husk-18-3", "group-1-husk-2-3", "rot-hound", "rot_hound", "rothound", "a~", "a+", "a$",
        ];
        xs.sort_by(|a, b| locale_cmp(a, b));
        // `[...xs].sort((a, b) => a.localeCompare(b))` in Node 22, ICU's root collation.
        let node = [
            "_a", "-a", "0a", "a", "A", "a b", "a_b", "a-1", "a-b", "a.b", "a+", "a~", "a$", "a1", "a10", "a2", "ab", "aB", "Ab", "b", "B",
            "group-1-husk-18-3", "group-1-husk-2-3", "kara", "Kara", "rot_hound", "rot-hound", "rothound",
        ];
        assert_eq!(xs, node);
        assert_eq!(locale_cmp("x\u{1}", "x"), std::cmp::Ordering::Equal);
    }

    #[test]
    fn keeps_indices_first() {
        let mut o = JsObject::default();
        for key in ["b", "10", "a", "2", "02", "4294967295", "0"] {
            o.set(key, serde_json::json!(key));
        }
        let keys: Vec<&str> = o.entries().iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["0", "2", "10", "b", "a", "02", "4294967295"]);
    }
}
