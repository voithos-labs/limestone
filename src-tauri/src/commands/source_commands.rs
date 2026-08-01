use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;
use uuid::Uuid;

use crate::services::fs::{clean_location, resolve_in_source};
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

// todo: could probably cache sources to avoid reading the sources.json file on every save
pub(crate) fn source_root(app: &AppHandle, source_id: &str) -> Result<PathBuf, String> {
    load_sources(app)
        .into_iter()
        .find(|s| s.id.to_string() == source_id)
        .map(|s| s.path)
        .ok_or_else(|| "source not found".to_string())
}

pub(crate) fn find_source(app: &AppHandle, id: Uuid) -> Result<Source, String> {
    load_sources(app)
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "source not found".to_string())
}

fn frontmatter_buffer_size(app_data: &AppData) -> usize {
    let settings = app_data.settings.read().unwrap();
    dot_get(&settings, "indexing.frontmatter_read_buffer_size")
        .and_then(|v| v.as_u64())
        .unwrap_or(512) as usize
}

async fn run_reconcile(
    app_handle: AppHandle,
    source: Source,
    pool: sqlx::SqlitePool,
    fm_buf_size: usize,
) {
    let source_id = source.id.to_string();
    let (changed, skipped) = services::reconcile_source(&source, &pool, &["md"], fm_buf_size)
        .await
        .unwrap_or_else(|e| {
            eprintln!("reconcile failed: {e}");
            Default::default()
        });
    let _ = app_handle.emit(
        "source-reconciled",
        crate::Reconciled {
            source_id: &source_id,
            skipped,
        },
    );
    if let Err(e) = services::index_fts(&pool, &source, changed).await {
        eprintln!("FTS indexing failed: {e}");
    }
    let _ = app_handle.emit("source-indexed", &source_id);
}

fn spawn_reconcile(app: &AppHandle, source: &Source, app_data: &AppData) {
    let fm_buf_size = frontmatter_buffer_size(app_data);
    tauri::async_runtime::spawn(run_reconcile(
        app.clone(),
        source.clone(),
        app_data.db.clone(),
        fm_buf_size,
    ));
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
    let note_location = clean_location(&note_location).map_err(|e| e.to_string())?;
    let asset_location = clean_location(&asset_location).map_err(|e| e.to_string())?;

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

#[derive(serde::Serialize)]
pub struct FolderOpError {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

impl FolderOpError {
    fn new(kind: &str) -> Self {
        Self {
            kind: kind.to_string(),
            name: None,
        }
    }

    fn named(kind: &str, name: &str) -> Self {
        Self {
            kind: kind.to_string(),
            name: Some(name.to_string()),
        }
    }

    fn io(e: &std::io::Error) -> Self {
        Self::new(&crate::services::bulk_ops::classify_io(e))
    }
}

fn folder_leaf(rel_dir: &str) -> &str {
    rel_dir.rsplit('/').next().unwrap_or(rel_dir)
}

fn validate_folder_path(rel_dir: &str) -> Result<(), FolderOpError> {
    match rel_dir
        .split('/')
        .find(|s| s.is_empty() || s.starts_with('.'))
    {
        Some(seg) => Err(FolderOpError::named("invalid_name", seg)),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn create_folder(
    app: AppHandle,
    app_data: State<'_, AppData>,
    source_id: String,
    rel_dir: String,
) -> Result<String, FolderOpError> {
    validate_folder_path(&rel_dir)?;
    let root = source_root(&app, &source_id).map_err(|_| FolderOpError::new("source_missing"))?;
    let full = resolve_in_source(&root, &rel_dir)
        .map_err(|_| FolderOpError::named("invalid_name", folder_leaf(&rel_dir)))?;
    std::fs::create_dir_all(&full).map_err(|e| FolderOpError::io(&e))?;

    let mut tx = app_data
        .db
        .begin()
        .await
        .map_err(|_| FolderOpError::new("other"))?;
    let mut id = String::new();
    let mut path_acc = String::new();
    for seg in rel_dir.split('/') {
        if !path_acc.is_empty() {
            path_acc.push('/');
        }
        path_acc.push_str(seg);
        id = services::upsert_folder_group(&mut tx, &source_id, &path_acc)
            .await
            .map_err(|_| FolderOpError::new("other"))?;
    }
    tx.commit().await.map_err(|_| FolderOpError::new("other"))?;
    Ok(id)
}

#[tauri::command]
pub async fn move_folder(
    app: AppHandle,
    app_data: State<'_, AppData>,
    source_id: String,
    old_rel_dir: String,
    new_rel_dir: String,
) -> Result<(), FolderOpError> {
    validate_folder_path(&new_rel_dir)?;
    if new_rel_dir == old_rel_dir || new_rel_dir.starts_with(&format!("{old_rel_dir}/")) {
        return Err(FolderOpError::new("into_itself"));
    }
    let root = source_root(&app, &source_id).map_err(|_| FolderOpError::new("source_missing"))?;
    let old_full = resolve_in_source(&root, &old_rel_dir)
        .map_err(|_| FolderOpError::named("not_found", folder_leaf(&old_rel_dir)))?;
    let new_full = resolve_in_source(&root, &new_rel_dir)
        .map_err(|_| FolderOpError::named("invalid_name", folder_leaf(&new_rel_dir)))?;
    if !old_full.is_dir() {
        return Err(FolderOpError::named("not_found", folder_leaf(&old_rel_dir)));
    }
    // case-only change should still pass exists guard
    let case_only = old_rel_dir.eq_ignore_ascii_case(&new_rel_dir);
    if new_full.exists() && !case_only {
        return Err(FolderOpError::named(
            "already_exists",
            folder_leaf(&new_rel_dir),
        ));
    }
    if !new_full.parent().is_some_and(|p| p.is_dir()) {
        return Err(FolderOpError::new("not_found"));
    }
    std::fs::rename(&old_full, &new_full).map_err(|e| FolderOpError::io(&e))?;

    let uuid = Uuid::parse_str(&source_id).map_err(|_| FolderOpError::new("source_missing"))?;
    let source = find_source(&app, uuid).map_err(|_| FolderOpError::new("source_missing"))?;
    let fm_buf_size = frontmatter_buffer_size(&app_data);
    run_reconcile(app.clone(), source, app_data.db.clone(), fm_buf_size).await;
    Ok(())
}

#[tauri::command]
pub fn make_dir(path: String, rel: String) -> Result<(), String> {
    let dir = resolve_in_source(Path::new(&path), &rel).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())
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
