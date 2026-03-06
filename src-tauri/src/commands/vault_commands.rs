use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::services::{self, JsonSettingsStore, Vault, Vaults};
use crate::AppData;

fn vaults_store(app: &AppHandle) -> JsonSettingsStore {
    JsonSettingsStore {
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

fn spawn_reconcile(app: &AppHandle, vault: &Vault) {
    let db_path = app.path().app_data_dir().unwrap().join("limestone.db");
    let vault_path = vault.path.clone();
    let vault_id = vault.id.to_string();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let db = match crate::open_db(&db_path) {
            Ok(db) => db,
            Err(e) => {
                eprintln!("reconcile db open failed: {e}");
                return;
            }
        };
        if let Err(e) = services::reconcile_vault(&vault_path, &vault_id, &db, &["md"]) {
            eprintln!("reconcile failed: {e}");
        }
        // probably want to type w/ json body these later, e.g. emit content update type and then specify what kind
        let _ = app_handle.emit("vault-reconciled", &vault_id);
    });
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

    services::open_vault(&app, &app_data, vault.clone());
    spawn_reconcile(&app, &vault);

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

    services::open_vault(&app, &app_data, vault.clone());
    spawn_reconcile(&app, &vault);

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

#[tauri::command]
pub fn clear_cache(app: AppHandle) -> Result<(), String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("limestone.db");
    let db = crate::open_db(&db_path).map_err(|e| e.to_string())?;
    db.execute_batch("delete from document_groups; delete from documents; delete from groups;")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_documents(
    app: AppHandle,
    app_data: State<AppData>,
    query: String,
) -> Result<Vec<services::search::SearchResult>, String> {
    let vault = {
        let active = app_data.active_vault.lock().unwrap();
        active.clone().ok_or("no active vault")?
    };
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("limestone.db");
    let db = crate::open_db(&db_path).map_err(|e| e.to_string())?;
    Ok(services::search::search(
        &db,
        &vault.id.to_string(),
        &query,
        15,
    ))
}
