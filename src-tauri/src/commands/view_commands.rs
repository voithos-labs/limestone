use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::commands::source_commands::find_source;
use crate::commands::OpError;
use crate::services::fs::{atomic_write, resolve_in_source};
use crate::services::{folder_id, VIEW_FILE};
use crate::AppData;

fn view_file_path(app: &AppHandle, source_id: &str, rel_dir: &str) -> Result<PathBuf, OpError> {
    let id = Uuid::parse_str(source_id).map_err(|_| OpError::new("source_missing"))?;
    let source = find_source(app, id).map_err(|_| OpError::new("source_missing"))?;
    if !source.path.is_dir() {
        return Err(OpError::new("source_missing"));
    }
    let dir = if rel_dir.is_empty() {
        source.path
    } else {
        resolve_in_source(&source.path, rel_dir)?
    };
    Ok(dir.join(VIEW_FILE))
}

async fn mark_folder_view(
    db: &sqlx::SqlitePool,
    source_id: &str,
    rel_dir: &str,
    has_view: bool,
) -> Result<(), OpError> {
    sqlx::query("UPDATE folders SET view = ?2 WHERE id = ?1")
        .bind(folder_id(source_id, rel_dir))
        .bind(has_view)
        .execute(db)
        .await?;
    Ok(())
}

fn remove_if_present(path: &PathBuf) -> Result<(), OpError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(OpError::from(e)),
    }
}

#[tauri::command]
pub fn view_file_read(
    app: AppHandle,
    source_id: String,
    rel_dir: String,
) -> Result<Option<String>, OpError> {
    let path = view_file_path(&app, &source_id, &rel_dir)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(OpError::from(e)),
    }
}

#[tauri::command]
pub async fn view_file_write(
    app: AppHandle,
    app_data: State<'_, AppData>,
    source_id: String,
    rel_dir: String,
    text: String,
) -> Result<(), OpError> {
    let path = view_file_path(&app, &source_id, &rel_dir)?;
    if !path.parent().is_some_and(|p| p.is_dir()) {
        return Err(OpError::new("not_found"));
    }
    atomic_write(&path, text.as_bytes())?;
    mark_folder_view(&app_data.db, &source_id, &rel_dir, true).await
}

#[tauri::command]
pub async fn view_file_remove(
    app: AppHandle,
    app_data: State<'_, AppData>,
    source_id: String,
    rel_dir: String,
) -> Result<(), OpError> {
    let path = view_file_path(&app, &source_id, &rel_dir)?;
    remove_if_present(&path)?;
    mark_folder_view(&app_data.db, &source_id, &rel_dir, false).await
}

fn app_views_dir(app: &AppHandle) -> Result<PathBuf, OpError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| OpError::new("other"))?
        .join("views"))
}

fn app_view_path(app: &AppHandle, id: &str) -> Result<PathBuf, OpError> {
    if Uuid::parse_str(id).is_err() {
        return Err(OpError::new("invalid_name"));
    }
    Ok(app_views_dir(app)?.join(format!("{id}.json")))
}

#[tauri::command]
pub fn app_views_read(app: AppHandle) -> Result<Vec<String>, OpError> {
    let entries = match fs::read_dir(app_views_dir(&app)?) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(OpError::from(e)),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&path) {
            out.push(text);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn app_view_write(app: AppHandle, id: String, text: String) -> Result<(), OpError> {
    atomic_write(&app_view_path(&app, &id)?, text.as_bytes()).map_err(OpError::from)
}

#[tauri::command]
pub fn app_view_remove(app: AppHandle, id: String) -> Result<(), OpError> {
    remove_if_present(&app_view_path(&app, &id)?)
}
