use atomicwrites::{AtomicFile, OverwriteBehavior::AllowOverwrite};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub struct JsonStore {
    /// default static string
    pub default_json: Option<String>,
    /// path to global settings json file
    pub path: PathBuf,
    /// vault override path to json
    pub override_path: Option<PathBuf>,
}

impl JsonStore {
    /// Load entire file as typed struct
    pub fn load<T: DeserializeOwned>(&self) -> Option<T> {
        fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    /// Save entire struct to file
    pub fn save<T: Serialize>(&self, value: &T) -> io::Result<()> {
        AtomicFile::new(&self.path, AllowOverwrite)
            .write(|f| f.write_all(serde_json::to_string_pretty(value)?.as_bytes()))?;
        Ok(())
    }

    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        // try load from os, vault -> global -> compiled defaults
        let paths: Vec<&Path> = self
            .override_path
            .iter()
            .map(|p| p.as_path())
            .chain(std::iter::once(self.path.as_path()))
            .collect();

        for path in paths {
            if let Ok(contents) = fs::read_to_string(path) {
                if let Ok(json) = serde_json::from_str::<Value>(&contents) {
                    if let Some(val) = json.get(key) {
                        return serde_json::from_value(val.clone()).ok();
                    }
                }
            }
        }

        // compiled defaults
        self.default_json
            .as_ref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .and_then(|j| j.get(key).cloned())
            .and_then(|v| serde_json::from_value(v).ok())
    }

    /// Set vault-level settings override for specified key
    pub fn set_vault<T: Serialize>(&self, key: &str, value: T) -> io::Result<()> {
        let path = self
            .override_path
            .as_ref()
            .ok_or_else(|| io::Error::other("no vault path configured"))?;
        self.write_to(path, key, value)
    }

    /// Set global override of settings (basically a diff from default settings)
    pub fn set_global<T: Serialize>(&self, key: &str, value: T) -> io::Result<()> {
        self.write_to(&self.path, key, value)
    }

    /// Update value by key on fs
    pub fn write_to<T: Serialize>(&self, path: &Path, key: &str, value: T) -> io::Result<()> {
        let mut json: Value = fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Object(Default::default()));

        json.as_object_mut()
            .ok_or_else(|| io::Error::other("config root not an object"))?
            .insert(key.to_string(), serde_json::to_value(value)?);

        AtomicFile::new(path, AllowOverwrite)
            .write(|f| f.write_all(serde_json::to_string_pretty(&json)?.as_bytes()))?;

        Ok(())
    }
}
