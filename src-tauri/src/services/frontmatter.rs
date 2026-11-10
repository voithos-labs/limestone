use crate::services::body::same_tag;
use crate::services::fs::fast_write;
use serde_json::{Map, Value};
use std::fs;
use std::io;
use std::path::Path;

pub fn date_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp_millis());
    }
    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
        return Some(ndt.and_utc().timestamp_millis());
    }
    if let Ok(nd) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(nd.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis());
    }
    None
}

pub fn tags(fm: Option<&Value>) -> Vec<String> {
    let value = fm.and_then(|f| f.get("tags").or_else(|| f.get("tag")));
    let items: Vec<&str> = match value {
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).collect(),
        Some(Value::String(s)) => s.split(|c: char| c == ',' || c.is_whitespace()).collect(),
        _ => Vec::new(),
    };
    items
        .into_iter()
        .map(|t| t.trim_start_matches('#'))
        .filter(|t| !t.is_empty())
        .map(String::from)
        .collect()
}

pub fn set_tags(fm: &mut Value, tags: &[String]) {
    let Some(root) = fm.as_object_mut() else {
        return;
    };
    root.shift_remove("tag");
    if tags.is_empty() {
        root.shift_remove("tags");
    } else {
        let list = tags.iter().map(|t| Value::String(t.clone())).collect();
        root.insert("tags".to_string(), Value::Array(list));
    }
}

/// It's in the name, rewrite frontmatter, preserve contents
pub fn rewrite_frontmatter(path: &Path, mutate: impl Fn(&mut Value)) -> io::Result<()> {
    rewrite_document(path, Some(&mutate), &|_| None)
}

pub fn rewrite_document(
    path: &Path,
    mutate_fm: Option<&dyn Fn(&mut Value)>,
    mutate_body: &dyn Fn(&str) -> Option<String>,
) -> io::Result<()> {
    let content = fs::read_to_string(path)?;
    let (head, body) = split_raw(&content);
    let body = mutate_body(body).unwrap_or_else(|| body.to_string());
    let next = match mutate_fm {
        None => compose(Some(&content), &body, None, &[], false)?,
        Some(mutate) => {
            let before = head
                .map(|(_, block)| parse_block(block))
                .transpose()?
                .unwrap_or_default();
            let mut after = Value::Object(before.clone());
            mutate(&mut after);
            let after = after.as_object().cloned().unwrap_or_default();
            let (set, remove) = diff_keys(&before, &after);
            compose(Some(&content), &body, Some(&set), &remove, false)?
        }
    };
    if next == content {
        return Ok(());
    }
    fast_write(path, next.as_bytes())
}

pub fn compose(
    existing: Option<&str>,
    body: &str,
    patch: Option<&Map<String, Value>>,
    remove: &[String],
    rebuild: bool,
) -> io::Result<String> {
    let head = existing.filter(|_| !rebuild).and_then(|c| split_raw(c).0);
    let Some(patch) = patch else {
        return Ok(format!("{}{body}", head.map_or("", |(prefix, _)| prefix)));
    };
    let nl = head.map_or_else(|| newline_of(body), |(_, block)| newline_of(block));
    let block = match head {
        Some((_, block)) => {
            parse_block(block)?;
            splice_block(block, patch, remove)
        }
        None => emit_block(patch, nl),
    };
    let bom = match existing {
        Some(c) if c.starts_with('\u{feff}') => "\u{feff}",
        _ => "",
    };
    Ok(format!("{bom}{}", with_block(&block, nl, body)))
}

fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

fn split_raw(content: &str) -> (Option<(&str, &str)>, &str) {
    let trimmed = strip_bom(content).trim_start();
    if let Some(after_open) = trimmed.strip_prefix("---") {
        if let Some(close) = find_closing_fence(after_open) {
            let block = strip_newline(&after_open[..close]);
            let body = strip_newline(&after_open[close + 3..]);
            let prefix = &content[..content.len() - body.len()];
            return (Some((prefix, block)), body);
        }
    }
    (None, content)
}

fn strip_newline(s: &str) -> &str {
    s.strip_prefix("\r\n")
        .or_else(|| s.strip_prefix('\n'))
        .unwrap_or(s)
}

fn newline_of(s: &str) -> &'static str {
    if s.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn parse_block(block: &str) -> io::Result<Map<String, Value>> {
    match serde_yml::from_str::<Value>(block) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Ok(Map::new()),
        Err(_) => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "existing frontmatter could not be parsed",
        )),
    }
}

fn diff_keys(
    before: &Map<String, Value>,
    after: &Map<String, Value>,
) -> (Map<String, Value>, Vec<String>) {
    let mut set = Map::new();
    for (k, v) in after {
        if before.get(k) != Some(v) {
            set.insert(k.clone(), v.clone());
        }
    }
    let remove = before
        .keys()
        .filter(|k| !after.contains_key(*k))
        .cloned()
        .collect();
    (set, remove)
}

fn with_block(block: &str, nl: &str, body: &str) -> String {
    if block.trim().is_empty() {
        body.to_string()
    } else {
        format!("---{nl}{block}---{nl}{body}")
    }
}

fn emit_block(map: &Map<String, Value>, nl: &str) -> String {
    let mut out = String::new();
    emit_map(&mut out, map, 0, false);
    if nl == "\r\n" {
        out = out.replace('\n', "\r\n");
    }
    out
}

fn key_of(line: &str) -> Option<&str> {
    let first = line.chars().next()?;
    if first.is_whitespace() || first == '#' || first == '-' {
        return None;
    }
    let (key, rest) = line.split_once(':')?;
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_whitespace()) {
        return None;
    }
    Some(key.trim_end().trim_matches(['"', '\'']))
}

fn is_filler(line: &str) -> bool {
    let t = line.trim();
    t.is_empty() || t.starts_with('#')
}

pub fn splice_block(block: &str, set: &Map<String, Value>, remove: &[String]) -> String {
    let nl = newline_of(block);
    let lines: Vec<&str> = block.split_inclusive('\n').collect();
    let keys: Vec<(&str, usize)> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, l)| key_of(l).map(|k| (k, i)))
        .collect();
    let mut fresh = set
        .iter()
        .filter(|(k, _)| !keys.iter().any(|(bk, _)| bk == k));
    let mut out = String::with_capacity(block.len() + 128);
    let mut cursor = 0;
    for (n, (key, start)) in keys.iter().enumerate() {
        let mut end = keys.get(n + 1).map_or(lines.len(), |(_, s)| *s);
        while end > start + 1 && is_filler(lines[end - 1]) {
            end -= 1;
        }
        out.extend(lines[cursor..*start].iter().copied());
        match set.get(*key) {
            Some(value) => emit_entry(&mut out, key, value, nl),
            None if remove.iter().any(|r| r == key) => {
                if let Some((k, v)) = fresh.next() {
                    emit_entry(&mut out, k, v, nl);
                }
            }
            None => out.extend(lines[*start..end].iter().copied()),
        }
        cursor = end;
    }
    out.extend(lines[cursor..].iter().copied());
    if !out.is_empty() && !out.ends_with('\n') {
        out.push_str(nl);
    }
    for (key, value) in fresh {
        emit_entry(&mut out, key, value, nl);
    }
    out
}

fn emit_entry(out: &mut String, key: &str, value: &Value, nl: &str) {
    let mut one = Map::new();
    one.insert(key.to_string(), value.clone());
    out.push_str(&emit_block(&one, nl));
}

/// The file without its frontmatter
pub fn strip_content(content: &str) -> io::Result<Option<&str>> {
    match head(content) {
        (Head::Block(_), body) => Ok(Some(body)),
        (Head::Broken, _) => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "existing frontmatter could not be parsed",
        )),
        (Head::Absent, _) => Ok(None),
    }
}

/// Removes the file's frontmatter block, leaving its body exactly as it was
pub fn strip_frontmatter(path: &Path) -> io::Result<()> {
    let content = fs::read_to_string(path)?;
    match strip_content(&content)? {
        Some(body) => fast_write(path, body.as_bytes()),
        None => Ok(()),
    }
}

/// Whether the file opens with a frontmatter block, judged from its head only
pub fn has_frontmatter(path: &Path) -> bool {
    use std::io::Read;
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let mut head = Vec::with_capacity(16 * 1024);
    if file.take(64 * 1024).read_to_end(&mut head).is_err() {
        return false;
    }
    let text = String::from_utf8_lossy(&head);
    matches!(split_content(&text), (Some(_), _))
}

pub enum Head {
    Absent,
    Broken,
    Block(Value),
}

impl Head {
    pub fn value(&self) -> Option<&Value> {
        match self {
            Head::Block(v) => Some(v),
            _ => None,
        }
    }

    pub fn broken(&self) -> bool {
        matches!(self, Head::Broken)
    }
}

pub fn head(content: &str) -> (Head, &str) {
    let trimmed = strip_bom(content).trim_start();
    let Some(after_open) = trimmed.strip_prefix("---") else {
        return (Head::Absent, content);
    };
    let Some(close) = find_closing_fence(after_open) else {
        return (Head::Absent, content);
    };
    let body = &after_open[close + 3..];
    let body = body.strip_prefix('\n').unwrap_or(body);
    match serde_yml::from_str::<Value>(&after_open[..close]) {
        Ok(v) if v.is_object() => (Head::Block(v), body),
        Ok(_) => (Head::Block(Value::Object(Map::new())), body),
        Err(_) => (Head::Broken, content),
    }
}

pub fn split_content(content: &str) -> (Option<Value>, &str) {
    match head(content) {
        (Head::Block(v), body) => (Some(v), body),
        _ => (None, content),
    }
}

pub(crate) fn find_closing_fence(after_open: &str) -> Option<usize> {
    let mut from = 0;
    loop {
        let rel = after_open[from..].find("---")?;
        let abs = from + rel;
        if abs == 0 || after_open.as_bytes()[abs - 1] == b'\n' {
            return Some(abs);
        }
        from = abs + 3;
    }
}

#[cfg(test)]
pub fn format_content(fm: &Value, body: &str) -> io::Result<String> {
    let mut out = String::with_capacity(body.len() + 256);
    out.push_str("---\n");
    match fm {
        Value::Object(map) if !map.is_empty() => emit_map(&mut out, map, 0, false),
        _ => out.push_str("{}\n"),
    }
    out.push_str("---\n");
    out.push_str(body);
    Ok(out)
}

fn emit_map(out: &mut String, map: &Map<String, Value>, indent: usize, inline_first: bool) {
    for (i, (key, value)) in map.iter().enumerate() {
        if !(inline_first && i == 0) {
            push_indent(out, indent);
        }
        emit_string(out, key);
        out.push(':');
        match value {
            Value::Object(m) if !m.is_empty() => {
                out.push('\n');
                emit_map(out, m, indent + 2, false);
            }
            Value::Array(a) if !a.is_empty() => {
                out.push('\n');
                emit_seq(out, a, indent + 2, false);
            }
            _ => {
                out.push(' ');
                emit_scalar(out, value);
                out.push('\n');
            }
        }
    }
}

fn emit_seq(out: &mut String, seq: &[Value], indent: usize, inline_first: bool) {
    for (i, value) in seq.iter().enumerate() {
        if !(inline_first && i == 0) {
            push_indent(out, indent);
        }
        out.push_str("- ");
        match value {
            Value::Object(m) if !m.is_empty() => emit_map(out, m, indent + 2, true),
            Value::Array(a) if !a.is_empty() => emit_seq(out, a, indent + 2, true),
            _ => {
                emit_scalar(out, value);
                out.push('\n');
            }
        }
    }
}

fn push_indent(out: &mut String, n: usize) {
    out.extend(std::iter::repeat_n(' ', n));
}

fn emit_scalar(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(s) => emit_string(out, s),
        Value::Array(_) => out.push_str("[]"),
        Value::Object(_) => out.push_str("{}"),
    }
}

fn emit_string(out: &mut String, s: &str) {
    if s.chars().any(|c| c.is_control() && c != '\t') {
        out.push('"');
        for c in s.chars() {
            match c {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
                c => out.push(c),
            }
        }
        out.push('"');
    } else if plain_safe(s) {
        out.push_str(s);
    } else {
        out.push('\'');
        out.push_str(&s.replace('\'', "''"));
        out.push('\'');
    }
}

fn plain_safe(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if first.is_whitespace() || "-?:,[]{}#&*!|=>'\"%@`".contains(first) {
        return false;
    }
    let mut prev = first;
    for c in chars {
        if (c == '#' && prev.is_whitespace()) || (prev == ':' && c.is_whitespace()) {
            return false;
        }
        prev = c;
    }
    if prev.is_whitespace() || prev == ':' {
        return false;
    }
    !matches!(
        s,
        "~" | "null" | "Null" | "NULL" | "true" | "True" | "TRUE" | "false" | "False" | "FALSE"
    ) && !looks_numeric(s)
}

fn looks_numeric(s: &str) -> bool {
    let body = s.strip_prefix(['+', '-']).unwrap_or(s);
    let lower = body.to_ascii_lowercase();
    if lower == ".inf" || lower == ".nan" {
        return true;
    }
    if let Some(hex) = lower.strip_prefix("0x") {
        return !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit() || c == '_');
    }
    if let Some(oct) = lower.strip_prefix("0o") {
        return !oct.is_empty() && oct.chars().all(|c| ('0'..='7').contains(&c) || c == '_');
    }
    if let Some(bin) = lower.strip_prefix("0b") {
        return !bin.is_empty() && bin.chars().all(|c| c == '0' || c == '1' || c == '_');
    }
    let (mantissa, exponent) = match lower.split_once('e') {
        Some((m, e)) => (m, Some(e)),
        None => (lower.as_str(), None),
    };
    let mantissa_ok = mantissa.chars().any(|c| c.is_ascii_digit())
        && mantissa.chars().filter(|c| *c == '.').count() <= 1
        && mantissa
            .chars()
            .all(|c| c.is_ascii_digit() || c == '.' || c == '_');
    let exponent_ok = exponent.is_none_or(|e| {
        let digits = e.strip_prefix(['+', '-']).unwrap_or(e);
        !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
    });
    mantissa_ok && exponent_ok
}

/// Navigate to a nested object by key path
fn object_at<'a>(root: &'a mut Value, path: &[&str]) -> &'a mut Map<String, Value> {
    let mut cur = root;
    for key in path {
        if !cur.is_object() {
            *cur = Value::Object(Map::new());
        }
        cur = cur
            .as_object_mut()
            .unwrap()
            .entry((*key).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    if !cur.is_object() {
        *cur = Value::Object(Map::new());
    }
    cur.as_object_mut().unwrap()
}

pub fn set_view_field(fm: &mut Value, slug: &str, field: &str, value: Value) {
    object_at(fm, &["views", slug]).insert(field.to_string(), value);
}

pub fn rename_view_field(fm: &mut Value, slug: &str, from: &str, to: &str) {
    let obj = object_at(fm, &["views", slug]);
    if obj.contains_key(from) {
        rename_keys(obj, |k| (k == from).then(|| to.to_string()));
    }
}

/// Move a whole unit namespace, `views.<from>` to `views.<to>`
pub fn rename_unit_key(fm: &mut Value, from: &str, to: &str) {
    let Some(views) = fm
        .as_object_mut()
        .and_then(|r| r.get_mut("views"))
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    rename_keys(views, |k| (k == from).then(|| to.to_string()));
}

pub fn remove_unit_key(fm: &mut Value, key: &str) {
    let Some(root) = fm.as_object_mut() else {
        return;
    };
    let Some(views) = root.get_mut("views").and_then(Value::as_object_mut) else {
        return;
    };
    views.shift_remove(key);
    if views.is_empty() {
        root.shift_remove("views");
    }
}

fn rename_keys(map: &mut Map<String, Value>, rename: impl Fn(&str) -> Option<String>) {
    let renamed: Map<String, Value> = std::mem::take(map)
        .into_iter()
        .map(|(k, v)| (rename(&k).unwrap_or(k), v))
        .collect();
    *map = renamed;
}

/// Rename a select/multiselect option value in-place within `views.<slug>.<field>`
pub fn rename_view_option(fm: &mut Value, slug: &str, field: &str, from: &str, to: &str) {
    let Some(views) = fm.as_object_mut().and_then(|r| r.get_mut("views")) else {
        return;
    };
    let Some(obj) = views.as_object_mut().and_then(|v| v.get_mut(slug)) else {
        return;
    };
    let Some(val) = obj.as_object_mut().and_then(|o| o.get_mut(field)) else {
        return;
    };
    match val {
        Value::String(s) if s == from => *s = to.to_string(),
        Value::Array(arr) => {
            for item in arr.iter_mut() {
                if matches!(item, Value::String(s) if s == from) {
                    *item = Value::String(to.to_string());
                }
            }
            let mut seen: Vec<Value> = Vec::with_capacity(arr.len());
            arr.retain(|v| {
                if seen.contains(v) {
                    false
                } else {
                    seen.push(v.clone());
                    true
                }
            });
        }
        _ => {}
    }
}

/// View prop pruning, e.g. removing `views.<slug>.<field>` when the `field` no longer exists in the
/// view definition or the view itself no longer exists
pub fn remove_view_field(fm: &mut Value, slug: &str, field: &str) {
    let Some(root) = fm.as_object_mut() else {
        return;
    };
    let Some(views) = root.get_mut("views").and_then(Value::as_object_mut) else {
        return;
    };
    if let Some(obj) = views.get_mut(slug).and_then(Value::as_object_mut) {
        obj.shift_remove(field);
        if obj.is_empty() {
            views.shift_remove(slug);
        }
    }
    if views.is_empty() {
        root.shift_remove("views");
    }
}

pub fn rename_tag(fm: &mut Value, from: &str, to: &str) {
    let before = tags(Some(fm));
    let mut after: Vec<String> = Vec::with_capacity(before.len());
    for tag in &before {
        let next = if same_tag(tag, from) {
            to.to_string()
        } else {
            tag.clone()
        };
        if !after.iter().any(|t| same_tag(t, &next)) {
            after.push(next);
        }
    }
    if after != before {
        set_tags(fm, &after);
    }
}

pub fn remove_tag(fm: &mut Value, slug: &str) {
    let before = tags(Some(fm));
    let after: Vec<String> = before
        .iter()
        .filter(|t| !same_tag(t, slug))
        .cloned()
        .collect();
    if after.len() != before.len() {
        set_tags(fm, &after);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn splice_replaces_in_place_fills_removed_slots_and_appends_the_rest() {
        let block =
            "# top\nid: old\ntags:\n  - a\n# about custom\ncustom: value   # trailing\n\nz: 1\n";
        let mut set = Map::new();
        set.insert("tags".into(), json!(["a", "b"]));
        set.insert("views".into(), json!({ "todo": { "due": "2026-01-01" } }));
        set.insert("extra".into(), json!(1));
        let out = splice_block(block, &set, &["id".to_string()]);
        assert_eq!(
            out,
            "# top\nviews:\n  todo:\n    due: 2026-01-01\ntags:\n  - a\n  - b\n# about custom\ncustom: value   # trailing\n\nz: 1\nextra: 1\n"
        );
    }

    #[test]
    fn a_flow_value_broken_across_lines_is_one_entry() {
        let block = "tags: [a,\nb]\nz: 1\n";
        let mut set = Map::new();
        set.insert("tags".into(), json!(["c"]));
        assert_eq!(splice_block(block, &set, &[]), "tags:\n  - c\nz: 1\n");
    }

    #[test]
    fn a_bom_is_read_through_and_kept_in_front() {
        let raw = "\u{feff}---\ntags: [a]\n---\nbody\n";
        assert_eq!(
            split_content(raw),
            (Some(json!({ "tags": ["a"] })), "body\n")
        );
        let mut set = Map::new();
        set.insert("tags".into(), json!(["b"]));
        assert_eq!(
            compose(Some(raw), "body\n", Some(&set), &[], false).unwrap(),
            "\u{feff}---\ntags:\n  - b\n---\nbody\n"
        );
        assert_eq!(
            compose(Some(raw), "new\n", None, &[], false).unwrap(),
            "\u{feff}---\ntags: [a]\n---\nnew\n"
        );
    }

    #[test]
    fn head_tells_a_broken_block_from_none() {
        assert!(head("---\ntags: [unclosed\n---\nbody").0.broken());
        assert!(matches!(head("plain\n").0, Head::Absent));
        assert!(head("---\na: 1\n---\n").0.value().is_some());
    }

    #[test]
    fn a_renamed_key_keeps_its_line() {
        let block = "title: t\ntag: a, b\nz: 1\n";
        let mut set = Map::new();
        set.insert("tags".into(), json!(["c", "b"]));
        let out = splice_block(block, &set, &["tag".to_string()]);
        assert_eq!(out, "title: t\ntags:\n  - c\n  - b\nz: 1\n");
    }

    #[test]
    fn compose_without_a_patch_keeps_any_block_byte_for_byte() {
        let raw = "---\r\nbad: [unclosed\r\n---\r\nold\r\n";
        assert_eq!(
            compose(Some(raw), "new", None, &[], false).unwrap(),
            "---\r\nbad: [unclosed\r\n---\r\nnew"
        );
        assert_eq!(
            compose(Some("plain"), "new", None, &[], false).unwrap(),
            "new"
        );
        assert_eq!(compose(None, "new", None, &[], false).unwrap(), "new");
    }

    #[test]
    fn compose_adds_a_block_only_for_a_nonempty_patch() {
        let mut p = Map::new();
        assert_eq!(
            compose(None, "body\n", Some(&p), &[], false).unwrap(),
            "body\n"
        );
        p.insert("tags".into(), json!(["todo"]));
        assert_eq!(
            compose(None, "body\n", Some(&p), &[], false).unwrap(),
            "---\ntags:\n  - todo\n---\nbody\n"
        );
        assert_eq!(
            compose(Some("old\n"), "body\n", Some(&p), &[], false).unwrap(),
            "---\ntags:\n  - todo\n---\nbody\n"
        );
    }

    #[test]
    fn compose_patches_in_place_and_keeps_crlf() {
        let raw = "---\r\n# mine\r\ntitle: x\r\ntags:\r\n  - a\r\n---\r\nbody\r\n";
        let mut p = Map::new();
        p.insert("tags".into(), json!(["b"]));
        assert_eq!(
            compose(Some(raw), "body\r\n", Some(&p), &[], false).unwrap(),
            "---\r\n# mine\r\ntitle: x\r\ntags:\r\n  - b\r\n---\r\nbody\r\n"
        );
    }

    #[test]
    fn compose_refuses_to_patch_an_unparsable_block_unless_rebuilding() {
        let raw = "---\nbad: [unclosed\n---\nbody\n";
        let mut p = Map::new();
        p.insert("tags".into(), json!(["a"]));
        assert!(compose(Some(raw), "body\n", Some(&p), &[], false).is_err());
        assert_eq!(
            compose(Some(raw), "body\n", Some(&p), &[], true).unwrap(),
            "---\ntags:\n  - a\n---\nbody\n"
        );
        assert_eq!(
            compose(Some(raw), "body\n", None, &[], true).unwrap(),
            "body\n"
        );
    }

    #[test]
    fn rewrite_touches_only_the_keys_a_mutation_changed() {
        let dir = std::env::temp_dir().join(format!("ls-splice-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("n.md");
        fs::write(
            &path,
            "---\n# keep me\ncustom: 'quoted'\ntags:\n  - a\n---\nhello\n",
        )
        .unwrap();
        rewrite_frontmatter(&path, |fm| {
            set_view_field(fm, "todo", "due", json!("2026-01-01"))
        })
        .unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "---\n# keep me\ncustom: 'quoted'\ntags:\n  - a\nviews:\n  todo:\n    due: 2026-01-01\n---\nhello\n"
        );
        fs::write(&path, "hello\n").unwrap();
        rewrite_frontmatter(&path, |_| {}).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello\n");
        fs::write(&path, "---\nbad: [unclosed\n---\nhello\n").unwrap();
        assert!(rewrite_frontmatter(&path, |_| {}).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn strip_takes_the_block_and_keeps_the_body() {
        let body = strip_content("---\ntags: [a]\ndue: 2026-10-02\n---\n# Title\n\ntext\n")
            .unwrap()
            .unwrap();
        assert_eq!(body, "# Title\n\ntext\n");
    }

    #[test]
    fn strip_leaves_a_file_without_a_block() {
        assert!(strip_content("# Title\n---\nnot a fence\n")
            .unwrap()
            .is_none());
    }

    #[test]
    fn strip_refuses_an_unparsable_block() {
        assert!(strip_content("---\ntags: [unclosed\n---\nbody").is_err());
    }

    #[test]
    fn strip_keeps_a_rule_inside_the_body() {
        let body = strip_content("---\na: 1\n---\nabove\n\n---\n\nbelow")
            .unwrap()
            .unwrap();
        assert_eq!(body, "above\n\n---\n\nbelow");
    }

    #[test]
    fn strip_writes_only_the_body() {
        let dir = std::env::temp_dir().join(format!("ls-strip-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("n.md");
        fs::write(&path, "---\nid: x\n---\nhello\n").unwrap();
        strip_frontmatter(&path).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello\n");
        strip_frontmatter(&path).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn split_no_frontmatter() {
        let (fm, body) = split_content("hello");
        assert!(fm.is_none());
        assert_eq!(body, "hello");
    }

    #[test]
    fn split_with_frontmatter() {
        let (fm, body) = split_content("---\ntitle: x\n---\nbody");
        assert_eq!(fm.unwrap(), json!({ "title": "x" }));
        assert_eq!(body, "body");
    }

    #[test]
    fn format_roundtrips() {
        let (fm, body) = split_content("---\ntitle: x\n---\nbody");
        let out = format_content(&fm.unwrap(), body).unwrap();
        let (fm2, body2) = split_content(&out);
        assert_eq!(fm2.unwrap(), json!({ "title": "x" }));
        assert_eq!(body2, "body");
    }

    #[test]
    fn obsidian_written_file_is_left_byte_identical() {
        let raw = "---\nid: d134b0e5-63b1-4e26-9372-79930568a04a\ntags:\n  - todo\n  - ideas\ncreated_at: 2026-10-02T13:08:20.000Z\nupdated_at: 2026-10-03T12:41:14.349Z\nviews:\n  /limestone-project/:\n    Type:\n      - uiux\n  todo:\n    done: true\n    due: null\n---\nbody\n";
        let (fm, body) = split_content(raw);
        assert_eq!(format_content(&fm.unwrap(), body).unwrap(), raw);
    }

    #[test]
    fn digit_led_ids_and_dates_stay_plain() {
        let v = json!({ "id": "92f25201-f34a-444d-b1ff-222b33f78932", "due": "2026-01-01" });
        let out = format_content(&v, "").unwrap();
        assert_eq!(
            out,
            "---\nid: 92f25201-f34a-444d-b1ff-222b33f78932\ndue: 2026-01-01\n---\n"
        );
        assert_eq!(split_content(&out).0.unwrap(), v);
    }

    #[test]
    fn ambiguous_strings_are_quoted_and_round_trip() {
        let v = json!({
            "a": "true", "b": "null", "c": "1.5", "d": "007", "e": "1e3", "f": "0x1f",
            "g": "-dash", "h": "a: b", "i": "a #b", "j": " pad", "k": "", "l": "'tis",
            "m": "line\nbreak", "n": "@at", "o": "trail:", "p": "a#b", "q": "a:b", "r": "x, [y]"
        });
        let out = format_content(&v, "").unwrap();
        assert_eq!(split_content(&out).0.unwrap(), v);
        assert!(out.contains("\na: 'true'\n"));
        assert!(out.contains("\nd: '007'\n"));
        assert!(out.contains("\ng: '-dash'\n"));
        assert!(out.contains("\nl: '''tis'\n"));
        assert!(out.contains("\nk: ''\n"));
        assert!(out.contains("\nm: \"line\\nbreak\"\n"));
        assert!(out.contains("\np: a#b\n"));
        assert!(out.contains("\nq: a:b\n"));
        assert!(out.contains("\nr: x, [y]\n"));
    }

    #[test]
    fn nested_sequences_and_empty_collections() {
        let v = json!({ "a": [], "b": {}, "c": [[1, 2], { "k": "v", "k2": "v2" }], "d": 1.5 });
        let out = format_content(&v, "").unwrap();
        assert_eq!(
            out,
            "---\na: []\nb: {}\nc:\n  - - 1\n    - 2\n  - k: v\n    k2: v2\nd: 1.5\n---\n"
        );
        assert_eq!(split_content(&out).0.unwrap(), v);
    }

    #[test]
    fn mutations_keep_key_positions() {
        let mut v = json!({ "id": "x", "tags": ["a"], "views": { "v": { "p": 1, "q": 2, "r": 3 } }, "z": 1 });
        rename_view_field(&mut v, "v", "q", "qq");
        remove_view_field(&mut v, "v", "p");
        let out = format_content(&v, "").unwrap();
        assert_eq!(
            out,
            "---\nid: x\ntags:\n  - a\nviews:\n  v:\n    qq: 2\n    r: 3\nz: 1\n---\n"
        );
    }

    #[test]
    fn set_creates_nested() {
        let mut v = json!({});
        set_view_field(&mut v, "my-view", "due", json!("2026-01-01"));
        assert_eq!(
            v,
            json!({ "views": { "my-view": { "due": "2026-01-01" } } })
        );
    }

    #[test]
    fn rename_moves_value() {
        let mut v = json!({ "views": { "v": { "status": "todo" } } });
        rename_view_field(&mut v, "v", "status", "state");
        assert_eq!(v, json!({ "views": { "v": { "state": "todo" } } }));
    }

    #[test]
    fn rename_missing_is_noop() {
        let mut v = json!({ "views": { "v": { "x": 1 } } });
        rename_view_field(&mut v, "v", "status", "state");
        assert_eq!(v, json!({ "views": { "v": { "x": 1 } } }));
    }

    #[test]
    fn remove_prunes_empty_parents() {
        let mut v = json!({ "views": { "v": { "x": 1 } } });
        remove_view_field(&mut v, "v", "x");
        assert_eq!(v, json!({}));
    }

    #[test]
    fn remove_keeps_nonempty_parents() {
        let mut v = json!({ "views": { "v": { "x": 1, "y": 2 } } });
        remove_view_field(&mut v, "v", "x");
        assert_eq!(v, json!({ "views": { "v": { "y": 2 } } }));
    }

    #[test]
    fn unit_key_removal_is_exact_and_prunes_empty_views() {
        let mut v =
            json!({ "tags": ["a"], "views": { "read": { "n": 1 }, "reading": { "n": 2 } } });
        remove_unit_key(&mut v, "read");
        assert_eq!(
            v,
            json!({ "tags": ["a"], "views": { "reading": { "n": 2 } } })
        );
        remove_unit_key(&mut v, "reading");
        assert_eq!(v, json!({ "tags": ["a"] }));
        remove_unit_key(&mut v, "missing");
        assert_eq!(v, json!({ "tags": ["a"] }));
    }

    #[test]
    fn dotted_keys_survive_a_yaml_round_trip() {
        let mut v = json!({});
        set_view_field(&mut v, "projects/v1.2/", "due.date", json!("2026-01-01"));
        set_view_field(&mut v, "1.5", "n", json!(2));
        let out = format_content(&v, "body").unwrap();
        let (back, body) = split_content(&out);
        assert_eq!(back.unwrap(), v);
        assert_eq!(body, "body");
    }

    #[test]
    fn unit_key_move_is_exact() {
        let mut v = json!({ "views": { "read": { "n": 1 }, "reading": { "n": 2 } } });
        rename_unit_key(&mut v, "read", "papers");
        assert_eq!(
            v,
            json!({ "views": { "reading": { "n": 2 }, "papers": { "n": 1 } } })
        );
    }

    #[test]
    fn body_only_rewrite_keeps_frontmatter_bytes() {
        let dir = std::env::temp_dir().join(format!("limestone-fm-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        fs::write(
            &path,
            "---\n# kept\ntitle:   Spaced\ntags: [old]\n---\nsee #old here\n",
        )
        .unwrap();
        rewrite_document(&path, None, &|t| {
            crate::services::body::rewrite_tags(t, "old", Some("new"))
        })
        .unwrap();
        let after = fs::read_to_string(&path).unwrap();
        fs::remove_dir_all(&dir).ok();
        assert_eq!(
            after,
            "---\n# kept\ntitle:   Spaced\ntags: [old]\n---\nsee #new here\n"
        );
    }

    #[test]
    fn tag_rewrites_ignore_case() {
        let mut v = json!({ "tags": ["Todo", "keep"] });
        rename_tag(&mut v, "todo", "task");
        assert_eq!(v, json!({ "tags": ["task", "keep"] }));
        remove_tag(&mut v, "TASK");
        assert_eq!(v, json!({ "tags": ["keep"] }));
    }

    #[test]
    fn tags_read_every_obsidian_form() {
        assert_eq!(tags(Some(&json!({ "tags": ["a", "#b", 3] }))), ["a", "b"]);
        assert_eq!(tags(Some(&json!({ "tags": "a, b  c" }))), ["a", "b", "c"]);
        assert_eq!(tags(Some(&json!({ "tag": "solo" }))), ["solo"]);
        assert_eq!(tags(Some(&json!({ "tags": ["x"], "tag": "y" }))), ["x"]);
        assert!(tags(Some(&json!({ "tags": null }))).is_empty());
        assert!(tags(None).is_empty());
    }

    #[test]
    fn tag_rewrites_normalize_only_when_they_change_something() {
        let mut v = json!({ "tag": "a, b", "title": "t" });
        rename_tag(&mut v, "zzz", "q");
        assert_eq!(v, json!({ "tag": "a, b", "title": "t" }));
        rename_tag(&mut v, "a", "c");
        assert_eq!(v, json!({ "title": "t", "tags": ["c", "b"] }));
        remove_tag(&mut v, "b");
        remove_tag(&mut v, "c");
        assert_eq!(v, json!({ "title": "t" }));
    }
}
