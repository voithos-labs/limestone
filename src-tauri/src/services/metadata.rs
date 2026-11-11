use crate::services::body::same_tag;
use crate::services::frontmatter;
use crate::services::fs::{doc_dir, read_meta, rewrite_meta};
use crate::services::source::document_type;
use serde_json::{Map, Value};
use std::fs;
use std::io::{self, Read as _};
use std::path::Path;

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

pub fn in_file(rel_path: &str) -> bool {
    document_type(rel_path) == "md"
}

pub fn read(root: &Path, id: &str, rel_path: &str, buffer_size: usize) -> Head {
    if in_file(rel_path) {
        read_head(&root.join(rel_path), buffer_size)
    } else {
        read_meta(&doc_dir(root, id))
            .map(|m| m.fields)
            .filter(Value::is_object)
            .map_or(Head::Absent, Head::Block)
    }
}

pub fn rewrite(
    root: &Path,
    id: &str,
    rel_path: &str,
    mutate: impl Fn(&mut Value),
) -> io::Result<()> {
    if in_file(rel_path) {
        frontmatter::rewrite_frontmatter(&root.join(rel_path), mutate)
    } else {
        rewrite_meta(root, id, rel_path, mutate)
    }
}

// escalate the read window until the closing fence fits (or the whole file is in)
fn read_head(path: &Path, buffer_size: usize) -> Head {
    let mut limit = buffer_size.max(64) as u64;
    loop {
        let mut buf = Vec::new();
        let read = fs::File::open(path).and_then(|f| f.take(limit).read_to_end(&mut buf));
        if read.is_err() {
            return Head::Absent;
        }
        let whole_file = (buf.len() as u64) < limit;

        // tolerate a multibyte char split at the window edge
        let content = match std::str::from_utf8(&buf) {
            Ok(s) => s,
            Err(e) => std::str::from_utf8(&buf[..e.valid_up_to()]).unwrap_or(""),
        };
        let trimmed = content.trim_start_matches('\u{feff}').trim_start();
        let Some(after_open) = trimmed.strip_prefix("---") else {
            return Head::Absent;
        };
        if frontmatter::find_closing_fence(after_open).is_some() {
            return frontmatter::head(content).0;
        }
        if whole_file {
            return Head::Absent;
        }
        let next = limit.saturating_mul(16).min(1 << 22);
        if next == limit {
            return Head::Absent;
        }
        limit = next;
    }
}

const KNOWN_KEYS: &[&str] = &[
    "id",
    "tags",
    "tag",
    "created_at",
    "updated_at",
    "accessed_at",
];
// "tag" is for obsid compat

/// extract everything outside known keys as a json string
pub fn properties(meta: &Value) -> String {
    match meta.as_object() {
        Some(map) => {
            let props: Map<String, Value> = map
                .iter()
                .filter(|(k, _)| !KNOWN_KEYS.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            serde_json::to_string(&props).unwrap_or_default()
        }
        None => "{}".to_string(),
    }
}

pub fn date(meta: Option<&Value>, key: &str) -> Option<i64> {
    meta.and_then(|m| m.get(key))
        .and_then(|v| v.as_str())
        .and_then(date_ms)
}

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
    fn unit_key_move_is_exact() {
        let mut v = json!({ "views": { "read": { "n": 1 }, "reading": { "n": 2 } } });
        rename_unit_key(&mut v, "read", "papers");
        assert_eq!(
            v,
            json!({ "views": { "reading": { "n": 2 }, "papers": { "n": 1 } } })
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
