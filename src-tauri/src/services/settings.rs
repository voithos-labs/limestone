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

    /// Load to memory for cahcing
    pub fn load_merged(&self) -> Value {
        // Default
        let mut merged = self
            .default_json
            .as_ref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .unwrap_or(Value::Object(Default::default()));

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
        self.write_to(&self.path, key, value)
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
