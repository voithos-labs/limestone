use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::services::{self, dot_get, JsonSettingsStore, Source, Sources};
use crate::AppData;

fn sources_store(app: &AppHandle) -> JsonSettingsStore {
    JsonSettingsStore {
        path: app.path().app_data_dir().unwrap().join("sources.json"),
        default_json: None,
        override_path: None,
    }
}

fn load_sources(app: &AppHandle) -> Vec<Source> {
    let mut sources = sources_store(app)
        .load::<Sources>()
        .unwrap_or_default()
        .sources;
    sources.sort_by_key(|v| std::cmp::Reverse(v.accessed_at));
    sources
}

fn spawn_reconcile(app: &AppHandle, source: &Source, app_data: &AppData) {
    let pool = app_data.db.clone();
    let source_path = source.path.clone();
    let source_id = source.id.to_string();
    let app_handle = app.clone();
    let settings = app_data.settings.read().unwrap();
    let fm_buf_size = dot_get(&settings, "indexing.frontmatter_read_buffer_size")
        .and_then(|v| v.as_u64())
        .unwrap_or(512) as usize;
    drop(settings);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = services::reconcile_source(&source_path, &source_id, &pool, &["md"], fm_buf_size).await {
            eprintln!("reconcile failed: {e}");
        }
        let _ = app_handle.emit("source-reconciled", &source_id);
    });
}

fn save_sources(app: &AppHandle, sources: &[Source]) -> Result<(), String> {
    sources_store(app)
        .save(&Sources {
            sources: sources.to_vec(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_source(
    app: AppHandle,
    app_data: State<AppData>,
    path: String,
    title: String,
) -> Result<Source, String> {
    let source =
        services::create_source(Some(title), PathBuf::from(&path)).map_err(|e| e.to_string())?;

    let mut sources = load_sources(&app);
    sources.push(source.clone());
    save_sources(&app, &sources)?;

    services::open_source(&app, &app_data, source.clone());
    spawn_reconcile(&app, &source, &app_data);

    Ok(source)
}

#[tauri::command]
pub fn set_active_source(
    app: AppHandle,
    app_data: State<AppData>,
    id: Uuid,
) -> Result<Source, String> {
    let mut sources = load_sources(&app);

    let source = sources
        .iter_mut()
        .find(|v| v.id == id)
        .ok_or_else(|| format!("source {id} not found"))?
        .clone();

    services::open_source(&app, &app_data, source.clone());
    spawn_reconcile(&app, &source, &app_data);

    // update accessed_at
    let active = app_data.active_source.lock().unwrap();
    if let Some(updated) = active.as_ref() {
        for v in &mut sources {
            if v.id == id {
                v.accessed_at = updated.accessed_at;
                break;
            }
        }
    }
    drop(active);

    save_sources(&app, &sources)?;

    Ok(sources.into_iter().find(|v| v.id == id).unwrap())
}

#[tauri::command]
pub fn get_sources(app: AppHandle) -> Vec<Source> {
    load_sources(&app)
}

#[tauri::command]
pub fn get_active_source(app_data: State<AppData>) -> Option<Source> {
    let active = app_data.active_source.lock().unwrap();
    active.clone()
}

#[tauri::command]
pub fn get_source_by_id(app: AppHandle, id: Uuid) -> Option<Source> {
    load_sources(&app).into_iter().find(|v| v.id == id)
}

#[tauri::command]
pub async fn clear_cache(app_data: State<'_, AppData>) -> Result<(), String> {
    sqlx::raw_sql("DELETE FROM document_groups; DELETE FROM documents; DELETE FROM groups;")
        .execute(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
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
pub async fn search_documents(
    app_data: State<'_, AppData>,
    query: String,
) -> Result<Vec<services::search::SearchResult>, String> {
    let source_id = {
        let active = app_data.active_source.lock().unwrap();
        active.as_ref().ok_or("no active source")?.id.to_string()
    };
    let search_cfg = {
        let settings = app_data.settings.read().unwrap();
        search_config_from_settings(&settings)
    };
    Ok(services::search::search(
        &app_data.db,
        &source_id,
        &query,
        &search_cfg,
    )
    .await)
}
