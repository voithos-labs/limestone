use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::services::{self, JsonStore, Vault, Vaults};
use crate::AppData;

fn vaults_store(app: &AppHandle) -> JsonStore {
    JsonStore {
        path: app.path().app_data_dir().unwrap().join("vaults.json"),
        default_json: None,
        override_path: None,
    }
}

fn load_vaults(app: &AppHandle) -> Vec<Vault> {
    let mut vaults = vaults_store(app)
        .load::<Vaults>()
        .unwrap_or_default()
        .vaults;
    vaults.sort_by_key(|v| std::cmp::Reverse(v.accessed_at));
    vaults
}

fn save_vaults(app: &AppHandle, vaults: &[Vault]) -> Result<(), String> {
    vaults_store(app)
        .save(&Vaults {
            vaults: vaults.to_vec(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_vault(
    app: AppHandle,
    app_data: State<AppData>,
    path: String,
    title: String,
) -> Result<Vault, String> {
    let vault =
        services::create_vault(Some(title), PathBuf::from(&path)).map_err(|e| e.to_string())?;

    let mut vaults = load_vaults(&app);
    vaults.push(vault.clone());
    save_vaults(&app, &vaults)?;

    services::open_vault(&app, &app_data.active_vault, vault.clone());

    Ok(vault)
}

#[tauri::command]
pub fn set_active_vault(
    app: AppHandle,
    app_data: State<AppData>,
    id: Uuid,
) -> Result<Vault, String> {
    let mut vaults = load_vaults(&app);

    let vault = vaults
        .iter_mut()
        .find(|v| v.id == id)
        .ok_or_else(|| format!("vault {id} not found"))?
        .clone();

    services::open_vault(&app, &app_data.active_vault, vault.clone());

    // update accessed_at
    let active = app_data.active_vault.lock().unwrap();
    if let Some(updated) = active.as_ref() {
        for v in &mut vaults {
            if v.id == id {
                v.accessed_at = updated.accessed_at;
                break;
            }
        }
    }
    drop(active);

    save_vaults(&app, &vaults)?;

    Ok(vaults.into_iter().find(|v| v.id == id).unwrap())
}

#[tauri::command]
pub fn get_vaults(app: AppHandle) -> Vec<Vault> {
    load_vaults(&app)
}

#[tauri::command]
pub fn get_active_vault(app_data: State<AppData>) -> Option<Vault> {
    let active = app_data.active_vault.lock().unwrap();
    active.clone()
}

#[tauri::command]
pub fn get_vault_by_id(app: AppHandle, id: Uuid) -> Option<Vault> {
    load_vaults(&app).into_iter().find(|v| v.id == id)
}
