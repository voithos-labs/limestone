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

/// It's in the name, rewrite frontmatter, preserve contents
pub fn rewrite_frontmatter(path: &Path, mutate: impl Fn(&mut Value)) -> io::Result<()> {
    let content = fs::read_to_string(path)?;
    let (existing, body) = split_content(&content);
    if existing.is_none() && has_unparsed_fence(&content) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "existing frontmatter could not be parsed",
        ));
    }
    let mut fm = existing.unwrap_or_else(|| Value::Object(Map::new()));
    mutate(&mut fm);
    let next = format_content(&fm, body)?;
    if next == content {
        return Ok(());
    }
    fast_write(path, next.as_bytes())
}

pub fn rewrite_document(
    path: &Path,
    mutate_fm: Option<&dyn Fn(&mut Value)>,
    mutate_body: &dyn Fn(&str) -> Option<String>,
) -> io::Result<()> {
    let content = fs::read_to_string(path)?;
    let (existing, body) = split_content(&content);
    if existing.is_none() && has_unparsed_fence(&content) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "existing frontmatter could not be parsed",
        ));
    }
    let fence = &content[..content.len() - body.len()];
    let body = mutate_body(body).unwrap_or_else(|| body.to_string());
    let next = match (existing, mutate_fm) {
        (Some(mut fm), Some(mutate)) => {
            mutate(&mut fm);
            format_content(&fm, &body)?
        }
        _ => format!("{fence}{body}"),
    };
    if next == content {
        return Ok(());
    }
    fast_write(path, next.as_bytes())
}

/// The file without its frontmatter
pub fn strip_content(content: &str) -> io::Result<Option<&str>> {
    match split_content(content) {
        (Some(_), body) => Ok(Some(body)),
        (None, _) if has_unparsed_fence(content) => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "existing frontmatter could not be parsed",
        )),
        (None, _) => Ok(None),
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

fn has_unparsed_fence(content: &str) -> bool {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return false;
    }
    let after_open = &trimmed[3..];
    let Some(close) = find_closing_fence(after_open) else {
        return false;
    };
    serde_yml::from_str::<Value>(&after_open[..close]).is_err()
}

pub fn split_content(content: &str) -> (Option<Value>, &str) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, content);
    }
    let after_open = &trimmed[3..];
    let Some(close) = find_closing_fence(after_open) else {
        return (None, content);
    };
    let yaml_str = &after_open[..close];
    let body = &after_open[close + 3..];
    let body = body.strip_prefix('\n').unwrap_or(body);
    match serde_yml::from_str::<Value>(yaml_str) {
        Ok(v) if v.is_object() => (Some(v), body),
        Ok(_) => (Some(Value::Object(Map::new())), body),
        Err(_) => (None, content),
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
        && mantissa.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '_');
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

/// Rename every `views.<key>` whose key starts with `from`, swapping that prefix for `to`
pub fn rename_view_prefix(fm: &mut Value, from: &str, to: &str) {
    let Some(views) = fm
        .as_object_mut()
        .and_then(|r| r.get_mut("views"))
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    rename_keys(views, |k| {
        k.strip_prefix(from).map(|rest| format!("{to}{rest}"))
    });
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
    let Some(arr) = fm
        .as_object_mut()
        .and_then(|r| r.get_mut("tags"))
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    let mut out: Vec<Value> = Vec::with_capacity(arr.len());
    for item in arr.iter() {
        let next = match item.as_str() {
            Some(s) if same_tag(s, from) => Value::String(to.to_string()),
            _ => item.clone(),
        };
        if !out.contains(&next) {
            out.push(next);
        }
    }
    *arr = out;
}

pub fn remove_tag(fm: &mut Value, slug: &str) {
    let Some(root) = fm.as_object_mut() else {
        return;
    };
    let Some(arr) = root.get_mut("tags").and_then(Value::as_array_mut) else {
        return;
    };
    arr.retain(|v| !v.as_str().is_some_and(|s| same_tag(s, slug)));
    if arr.is_empty() {
        root.shift_remove("tags");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
    fn rename_prefix_moves_whole_subtree() {
        let mut v = json!({ "views": {
            "projects/": { "due": "2026-01-01" },
            "projects/2026/": { "done": true },
            "projectsX/": { "due": 1 },
            "projects": { "x": 1 }
        } });
        rename_view_prefix(&mut v, "projects/", "work/");
        assert_eq!(
            v,
            json!({ "views": {
                "work/": { "due": "2026-01-01" },
                "work/2026/": { "done": true },
                "projectsX/": { "due": 1 },
                "projects": { "x": 1 }
            } })
        );
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
    fn rename_prefix_without_views_is_noop() {
        let mut v = json!({ "tags": ["a"] });
        rename_view_prefix(&mut v, "projects/", "work/");
        assert_eq!(v, json!({ "tags": ["a"] }));
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
}
