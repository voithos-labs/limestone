use atomicwrites::{AtomicFile, OverwriteBehavior::AllowOverwrite};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

pub struct JsonSettingsStore {
    /// default static string
    pub default_json: Option<String>,
    /// path to global settings json file
    pub path: PathBuf,
}

impl JsonSettingsStore {
    pub fn for_app(app: &tauri::AppHandle) -> Self {
        Self {
            path: app.path().app_data_dir().unwrap().join("settings.json"),
            default_json: Some(include_str!("../../defaults/default_settings.json").to_string()),
        }
    }

    /// Load entire file as typed struct
    pub fn load<T: DeserializeOwned>(&self) -> Option<T> {
        fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    /// Save entire struct to file
    pub fn save<T: Serialize>(&self, value: &T) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        AtomicFile::new(&self.path, AllowOverwrite)
            .write(|f| f.write_all(serde_json::to_string_pretty(value)?.as_bytes()))?;
        Ok(())
    }

    pub fn load_defaults(&self) -> Value {
        self.default_json
            .as_ref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .unwrap_or(Value::Object(Default::default()))
    }

    /// Load to memory for cahcing
    pub fn load_merged(&self) -> Value {
        // Default
        let mut merged = self.load_defaults();

        // Global
        if let Ok(contents) = fs::read_to_string(&self.path) {
            if let Ok(global) = serde_json::from_str::<Value>(&contents) {
                json_merge(&mut merged, &global);
            }
        }

        merged
    }

    /// Set global override of settings (basically a diff from default settings)
    pub fn set_global<T: Serialize>(&self, key: &str, value: T) -> io::Result<()> {
        let value = serde_json::to_value(value)?;
        if dot_get(&self.load_defaults(), key).is_some_and(|d| json_eq(d, &value)) {
            return self.remove_global(key);
        }
        self.write_to(&self.path, key, value)
    }

    pub fn remove_global(&self, key: &str) -> io::Result<()> {
        self.remove_from(&self.path, key)
    }

    pub fn clear_global(&self) -> io::Result<()> {
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }

    pub fn remove_from(&self, path: &Path, key: &str) -> io::Result<()> {
        let Some(mut json) = fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        else {
            return Ok(());
        };

        let segments: Vec<&str> = key.split('.').collect();
        dot_delete(&mut json, &segments);

        AtomicFile::new(path, AllowOverwrite)
            .write(|f| f.write_all(serde_json::to_string_pretty(&json)?.as_bytes()))?;

        Ok(())
    }

    /// Update value by dot-path key on fs.
    pub fn write_to<T: Serialize>(&self, path: &Path, key: &str, value: T) -> io::Result<()> {
        let mut json: Value = fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Object(Default::default()));

        dot_set(&mut json, key, serde_json::to_value(value)?)?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        AtomicFile::new(path, AllowOverwrite)
            .write(|f| f.write_all(serde_json::to_string_pretty(&json)?.as_bytes()))?;

        Ok(())
    }
}

/// Traverse a Value by dot-separated path.
pub fn dot_get<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

/// Set a value at a dot-separated path, creating intermediate objects as needed.
fn dot_set(root: &mut Value, path: &str, value: Value) -> io::Result<()> {
    let segments: Vec<&str> = path.split('.').collect();
    let mut current = root;

    for segment in &segments[..segments.len() - 1] {
        if !current.get(segment).is_some_and(|v| v.is_object()) {
            current
                .as_object_mut()
                .ok_or_else(|| io::Error::other("expected object in settings path"))?
                .insert((*segment).to_string(), Value::Object(Default::default()));
        }
        current = current.get_mut(segment).unwrap();
    }

    current
        .as_object_mut()
        .ok_or_else(|| io::Error::other("expected object in settings path"))?
        .insert(segments.last().unwrap().to_string(), value);

    Ok(())
}

fn dot_delete(value: &mut Value, segments: &[&str]) {
    let Some(obj) = value.as_object_mut() else {
        return;
    };
    let [head, rest @ ..] = segments else {
        return;
    };
    if rest.is_empty() {
        obj.remove(*head);
    } else if let Some(child) = obj.get_mut(*head) {
        dot_delete(child, rest);
        if child.as_object().is_some_and(|o| o.is_empty()) {
            obj.remove(*head);
        }
    }
}

fn json_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(av, bv)| json_eq(av, bv))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| json_eq(v, w)))
        }
        _ => a == b,
    }
}

/// Deep-merge `source` object into `target`.
fn json_merge(target: &mut Value, source: &Value) {
    if let (Some(t), Some(s)) = (target.as_object_mut(), source.as_object()) {
        for (k, v) in s {
            if let Some(existing) = t.get_mut(k) {
                if existing.is_object() && v.is_object() {
                    json_merge(existing, v);
                    continue;
                }
            }
            t.insert(k.clone(), v.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> JsonSettingsStore {
        let dir = std::env::temp_dir().join(format!("limestone-settings-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        JsonSettingsStore {
            default_json: Some(
                r#"{"appearance":{"ui_scale_percent":100},"search":{"recency_multiplier":100.0}}"#
                    .to_string(),
            ),
            path: dir.join("settings.json"),
        }
    }

    fn file_json(store: &JsonSettingsStore) -> Value {
        serde_json::from_str(&fs::read_to_string(&store.path).unwrap()).unwrap()
    }

    #[test]
    fn set_writes_override_and_merged_reflects_it() {
        let s = store("set");
        s.set_global("appearance.ui_scale_percent", 125).unwrap();
        assert_eq!(
            dot_get(&file_json(&s), "appearance.ui_scale_percent"),
            Some(&Value::from(125))
        );
        assert_eq!(
            dot_get(&s.load_merged(), "appearance.ui_scale_percent"),
            Some(&Value::from(125))
        );
        assert_eq!(
            dot_get(&s.load_merged(), "search.recency_multiplier"),
            Some(&Value::from(100.0))
        );
    }

    #[test]
    fn remove_prunes_empty_parents_and_restores_default() {
        let s = store("remove");
        s.set_global("appearance.ui_scale_percent", 125).unwrap();
        s.remove_global("appearance.ui_scale_percent").unwrap();
        assert!(file_json(&s).as_object().unwrap().is_empty());
        assert_eq!(
            dot_get(&s.load_merged(), "appearance.ui_scale_percent"),
            Some(&Value::from(100))
        );
    }

    #[test]
    fn set_equal_to_default_removes_override() {
        let s = store("set-default");
        s.set_global("appearance.ui_scale_percent", 125).unwrap();
        s.set_global("appearance.ui_scale_percent", 100).unwrap();
        assert!(file_json(&s).as_object().unwrap().is_empty());
    }

    #[test]
    fn set_equal_to_default_compares_numbers_across_int_and_float() {
        let s = store("set-default-float");
        s.set_global("search.recency_multiplier", 50).unwrap();
        s.set_global("search.recency_multiplier", 100).unwrap();
        assert!(file_json(&s).as_object().unwrap().is_empty());
    }

    #[test]
    fn remove_keeps_sibling_overrides() {
        let s = store("remove-sibling");
        s.set_global("appearance.ui_scale_percent", 125).unwrap();
        s.set_global("search.recency_multiplier", 50).unwrap();
        s.remove_global("appearance.ui_scale_percent").unwrap();
        let json = file_json(&s);
        assert!(dot_get(&json, "appearance").is_none());
        assert_eq!(
            dot_get(&json, "search.recency_multiplier"),
            Some(&Value::from(50))
        );
    }
}
