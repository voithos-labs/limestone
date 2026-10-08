use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::services::fs::atomic_write;

const LAYOUT_VERSION: &[u8] = b"2";
static LAYOUT_CHECKED: std::sync::OnceLock<()> = std::sync::OnceLock::new();

fn component_ok(c: &str) -> bool {
    !c.is_empty()
        && c.len() <= 128
        && c != "."
        && c != ".."
        && c.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}

fn history_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("history");
    LAYOUT_CHECKED.get_or_init(|| {
        let marker = root.join(".version");
        if fs::read(&marker).ok().as_deref() != Some(LAYOUT_VERSION) {
            let _ = fs::remove_dir_all(&root);
            let _ = atomic_write(&marker, LAYOUT_VERSION);
        }
    });
    Ok(root)
}

fn doc_dir(app: &AppHandle, doc_id: &str) -> Result<PathBuf, String> {
    if !component_ok(doc_id) {
        return Err(format!("invalid history doc id: {doc_id:?}"));
    }
    Ok(history_root(app)?.join(doc_id))
}

#[tauri::command]
pub fn history_load(app: AppHandle, doc_id: String) -> Result<Vec<String>, String> {
    let dir = doc_dir(&app, &doc_id)?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        out.push(B64.encode(fs::read(entry.path()).map_err(|e| e.to_string())?));
    }
    Ok(out)
}

#[tauri::command]
pub fn history_append(
    app: AppHandle,
    doc_id: String,
    hash: String,
    data: String,
) -> Result<(), String> {
    if !component_ok(&hash) {
        return Err(format!("invalid history change hash: {hash:?}"));
    }
    let path = doc_dir(&app, &doc_id)?.join(hash);
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_remove(app: AppHandle, doc_id: String) -> Result<(), String> {
    let dir = doc_dir(&app, &doc_id)?;
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
