use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::services::{self, dot_get, JsonSettingsStore, Vault, Vaults};
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

fn spawn_reconcile(app: &AppHandle, vault: &Vault, app_data: &AppData) {
    let pool = app_data.db.clone();
    let vault_path = vault.path.clone();
    let vault_id = vault.id.to_string();
    let app_handle = app.clone();
    let settings = app_data.settings.read().unwrap();
    let fm_buf_size = dot_get(&settings, "indexing.frontmatter_read_buffer_size")
        .and_then(|v| v.as_u64())
        .unwrap_or(512) as usize;
    drop(settings);
    std::thread::spawn(move || {
        let db = match pool.get() {
            Ok(db) => db,
            Err(e) => {
                eprintln!("reconcile db connection failed: {e}");
                return;
            }
        };
        if let Err(e) = services::reconcile_vault(&vault_path, &vault_id, &db, &["md"], fm_buf_size) {
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
    spawn_reconcile(&app, &vault, &app_data);

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
    spawn_reconcile(&app, &vault, &app_data);

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
pub fn clear_cache(app_data: State<AppData>) -> Result<(), String> {
    let db = app_data.db.get().map_err(|e| e.to_string())?;
    db.execute_batch("delete from document_groups; delete from documents; delete from groups;")
        .map_err(|e| e.to_string())
}

fn search_config_from_settings(settings: &serde_json::Value) -> services::search::SearchConfig {
    let defaults = services::search::SearchConfig::default();
    services::search::SearchConfig {
        max_results: dot_get(settings, "search.max_results")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(defaults.max_results),
        prefix_candidate_pool: dot_get(settings, "search.prefix_candidate_pool")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(defaults.prefix_candidate_pool),
        fuzzy_threshold: dot_get(settings, "search.fuzzy_threshold")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(defaults.fuzzy_threshold),
        recency_weight: dot_get(settings, "search.recency_weight")
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.recency_weight),
        recency_multiplier: dot_get(settings, "search.recency_multiplier")
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.recency_multiplier),
        recency_default_days: dot_get(settings, "search.recency_default_days")
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.recency_default_days),
    }
}

#[tauri::command]
pub fn search_documents(
    app_data: State<AppData>,
    query: String,
) -> Result<Vec<services::search::SearchResult>, String> {
    let vault = {
        let active = app_data.active_vault.lock().unwrap();
        active.clone().ok_or("no active vault")?
    };
    let search_cfg = {
        let settings = app_data.settings.read().unwrap();
        search_config_from_settings(&settings)
    };
    let db = app_data.db.get().map_err(|e| e.to_string())?;
    Ok(services::search::search(
        &db,
        &vault.id.to_string(),
        &query,
        &search_cfg,
    ))
}
