use crate::services::fs::fast_write;
use serde_json::{Map, Value};
use std::fs;
use std::io;
use std::path::Path;

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

fn find_closing_fence(after_open: &str) -> Option<usize> {
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
    let yaml =
        serde_yml::to_string(fm).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let mut out = String::with_capacity(yaml.len() + body.len() + 8);
    out.push_str("---\n");
    out.push_str(yaml.trim_end_matches('\n'));
    out.push_str("\n---\n");
    out.push_str(body);
    Ok(out)
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
    if let Some(v) = obj.remove(from) {
        obj.insert(to.to_string(), v);
    }
}

/// Rename a whole view namespace ;;;; move `views.<from>` to `views.<to>`
pub fn rename_view(fm: &mut Value, from: &str, to: &str) {
    let Some(views) = fm.as_object_mut().and_then(|r| r.get_mut("views")) else {
        return;
    };
    let Some(views) = views.as_object_mut() else {
        return;
    };
    if let Some(val) = views.remove(from) {
        views.insert(to.to_string(), val);
    }
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
        obj.remove(field);
        if obj.is_empty() {
            views.remove(slug);
        }
    }
    if views.is_empty() {
        root.remove("views");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
}
