use chrono::prelude::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;
use uuid::Uuid;

#[derive(Deserialize, Serialize, Clone)]
pub struct Vault {
    pub title: String,
    pub path: PathBuf,
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub accessed_at: DateTime<Utc>,
}

impl Vault {
    pub fn new(title: String, path: PathBuf) -> Self {
        let now = Utc::now();
        Self {
            title,
            path,
            id: Uuid::new_v4(),
            created_at: now,
            accessed_at: now,
        }
    }
}

#[derive(Deserialize, Serialize, Default)]
pub struct Vaults {
    #[serde(default)]
    pub vaults: Vec<Vault>,
}

pub fn open_vault(app: &AppHandle, active_vault: &Mutex<Option<Vault>>, mut vault: Vault) {
    let mut active = active_vault.lock().unwrap();

    // Allow access to new vault
    // Note: previously opened vaults remain accessible until app restart (no way to remove perm)
    let _ = app.fs_scope().allow_directory(&vault.path, true);

    vault.accessed_at = Utc::now();
    *active = Some(vault);
}

pub fn create_vault(title: Option<String>, path: PathBuf) -> Result<Vault, std::io::Error> {
    fs::create_dir_all(&path)?;
    let title = title.unwrap_or_else(|| {
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });
    Ok(Vault::new(title, path))
}
