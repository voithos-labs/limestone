use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;
use uuid::Uuid;

use crate::services::{self, dot_get, JsonSettingsStore, Source, Sources};
use crate::AppData;

fn sources_store(app: &AppHandle) -> JsonSettingsStore {
    JsonSettingsStore {
        path: app.path().app_data_dir().unwrap().join("sources.json"),
        default_json: None,
    }
}

fn load_sources_file(app: &AppHandle) -> Sources {
    let mut data = sources_store(app).load::<Sources>().unwrap_or_default();
    data.sources
        .sort_by_key(|v| std::cmp::Reverse(v.accessed_at));
    data
}

fn load_sources(app: &AppHandle) -> Vec<Source> {
    load_sources_file(app).sources
}

pub(crate) fn source_uses_frontmatter(app: &AppHandle, source_id: &str) -> bool {
    load_sources(app)
        .iter()
        .find(|s| s.id.to_string() == source_id)
        .map(|s| s.use_frontmatter)
        .unwrap_or(true)
}

pub(crate) fn find_source(app: &AppHandle, id: Uuid) -> Result<Source, String> {
    load_sources(app)
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "source not found".to_string())
}

fn spawn_reconcile(app: &AppHandle, source: &Source, app_data: &AppData) {
    let pool = app_data.db.clone();
    let source = source.clone();
    let app_handle = app.clone();
    let settings = app_data.settings.read().unwrap();
    let fm_buf_size = dot_get(&settings, "indexing.frontmatter_read_buffer_size")
        .and_then(|v| v.as_u64())
        .unwrap_or(512) as usize;
    drop(settings);
    tauri::async_runtime::spawn(async move {
        let source_id = source.id.to_string();
        let changed = services::reconcile_source(&source, &pool, &["md"], fm_buf_size)
            .await
            .unwrap_or_else(|e| {
                eprintln!("reconcile failed: {e}");
                Vec::new()
            });
        let _ = app_handle.emit("source-reconciled", &source_id);
        if let Err(e) = services::index_fts(&pool, &source, changed).await {
            eprintln!("FTS indexing failed: {e}");
        }
        let _ = app_handle.emit("source-indexed", &source_id);
    });
}

fn save_sources_file(app: &AppHandle, data: &Sources) -> Result<(), String> {
    sources_store(app).save(data).map_err(|e| e.to_string())
}

/// Canonicalize if possible, otherwise fall back to the cleaned path.
fn normalize_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Check that `candidate` is neither equal to, nor an ancestor of, nor a
/// descendant of any existing source path.
fn check_source_conflict(candidate: &Path, existing: &[Source]) -> Result<(), String> {
    let candidate_norm = normalize_path(candidate);
    for source in existing {
        let existing_norm = normalize_path(&source.path);
        if candidate_norm == existing_norm {
            return Err(format!("\"{}\" is already a source", source.title));
        }
        if candidate_norm.starts_with(&existing_norm) {
            return Err(format!(
                "Folder is nested inside existing source \"{}\"",
                source.title
            ));
        }
        if existing_norm.starts_with(&candidate_norm) {
            return Err(format!(
                "Folder contains existing source \"{}\"",
                source.title
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn create_source(
    app: AppHandle,
    app_data: State<AppData>,
    path: String,
    title: String,
    note_location: Option<String>,
    asset_location: Option<String>,
    use_frontmatter: bool,
) -> Result<Source, String> {
    let candidate = PathBuf::from(&path);
    let mut data = load_sources_file(&app);
    check_source_conflict(&candidate, &data.sources)?;

    let source = services::create_source(
        Some(title),
        candidate,
        note_location,
        asset_location,
        use_frontmatter,
    )
    .map_err(|e| e.to_string())?;

    // add fs access to new source dir
    let _ = app.fs_scope().allow_directory(&source.path, true);
    let _ = app
        .asset_protocol_scope()
        .allow_directory(&source.path, true);

    data.sources.push(source.clone());
    save_sources_file(&app, &data)?;

    spawn_reconcile(&app, &source, &app_data);

    Ok(source)
}

#[tauri::command]
pub fn get_sources(app: AppHandle) -> Vec<Source> {
    load_sources(&app)
}

#[tauri::command]
pub fn is_git_repo(path: String) -> bool {
    let mut dir: Option<&Path> = Some(Path::new(&path));
    while let Some(d) = dir {
        if d.join(".git").exists() {
            return true;
        }
        dir = d.parent();
    }
    false
}

#[tauri::command]
pub fn get_source_by_id(app: AppHandle, id: Uuid) -> Option<Source> {
    load_sources(&app).into_iter().find(|v| v.id == id)
}

#[tauri::command]
pub fn update_source(
    app: AppHandle,
    id: Uuid,
    note_location: String,
    asset_location: String,
) -> Result<(), String> {
    let mut data = load_sources_file(&app);
    let source = data
        .sources
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "source not found".to_string())?;
    source.note_location = note_location;
    source.asset_location = asset_location;
    save_sources_file(&app, &data)
}

#[tauri::command]
pub async fn touch_source(
    app: AppHandle,
    app_data: State<'_, AppData>,
    id: Uuid,
) -> Result<(), String> {
    let mut data = load_sources_file(&app);
    let now = chrono::Utc::now();
    if let Some(s) = data.sources.iter_mut().find(|s| s.id == id) {
        s.accessed_at = now;
    }
    save_sources_file(&app, &data)?;

    sqlx::query("UPDATE sources SET accessed_at = ?1 WHERE id = ?2")
        .bind(now.timestamp_millis())
        .bind(id.to_string())
        .execute(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_source(
    app: AppHandle,
    app_data: State<'_, AppData>,
    id: Uuid,
) -> Result<(), String> {
    sqlx::query(
        "DELETE FROM documents_fts WHERE rowid IN (SELECT rowid FROM documents WHERE source_id = ?1)",
    )
    .bind(id.to_string())
    .execute(&app_data.db)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM sources WHERE id = ?1")
        .bind(id.to_string())
        .execute(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;

    services::cleanup_orphan_tag_groups(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;

    let mut data = load_sources_file(&app);
    data.sources.retain(|s| s.id != id);
    if data.default_source_id == Some(id) {
        data.default_source_id = None;
    }
    save_sources_file(&app, &data)?;

    Ok(())
}

#[tauri::command]
pub fn list_dirs(path: String) -> Vec<String> {
    let root = PathBuf::from(&path);
    let mut out = Vec::new();
    collect_dirs(&root, &root, 0, &mut out);
    out.sort();
    out
}

fn collect_dirs(root: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
    if depth >= 6 || out.len() >= 500 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        if let Ok(rel) = p.strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
        collect_dirs(root, &p, depth + 1, out);
    }
}

#[tauri::command]
pub fn make_dir(path: String, rel: String) -> Result<(), String> {
    let rel_path = Path::new(&rel);
    if rel_path
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("invalid folder name".to_string());
    }
    std::fs::create_dir_all(Path::new(&path).join(rel_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_default_source_id(app: AppHandle) -> Option<Uuid> {
    let data = load_sources_file(&app);
    data.default_source_id
        .filter(|id| data.sources.iter().any(|s| s.id == *id))
}

#[tauri::command]
pub fn set_default_source(app: AppHandle, id: Option<Uuid>) -> Result<(), String> {
    let mut data = load_sources_file(&app);
    if let Some(id) = id {
        if !data.sources.iter().any(|s| s.id == id) {
            return Err("source not found".to_string());
        }
    }
    data.default_source_id = id;
    save_sources_file(&app, &data)
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
        group_prefix_min_chars: dot_get(settings, "search.group_prefix_min_chars")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(defaults.group_prefix_min_chars),
        group_max_results: dot_get(settings, "search.group_max_results")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(defaults.group_max_results),
        source_prefix_min_chars: dot_get(settings, "search.source_prefix_min_chars")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(defaults.source_prefix_min_chars),
        source_max_results: dot_get(settings, "search.source_max_results")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(defaults.source_max_results),
    }
}

#[tauri::command]
pub async fn search_documents(
    app_data: State<'_, AppData>,
    query: String,
) -> Result<Vec<services::search::SearchResult>, String> {
    let search_cfg = {
        let settings = app_data.settings.read().unwrap();
        search_config_from_settings(&settings)
    };
    Ok(services::search::search(&app_data.db, &query, &search_cfg).await)
}
