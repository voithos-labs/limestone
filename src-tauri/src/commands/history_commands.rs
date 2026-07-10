use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::services::fs::atomic_write;

#[derive(serde::Serialize)]
pub struct StorageChunk {
    pub key: Vec<String>,
    pub data: String,
}

fn component_ok(c: &str) -> bool {
    !c.is_empty()
        && c.len() <= 128
        && c != "."
        && c != ".."
        && c.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}

const LAYOUT_VERSION: &[u8] = b"1";
static LAYOUT_MARKER: std::sync::OnceLock<()> = std::sync::OnceLock::new();

fn history_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("history");
    LAYOUT_MARKER.get_or_init(|| {
        let marker = root.join(".version");
        if !marker.exists() {
            let _ = atomic_write(&marker, LAYOUT_VERSION);
        }
    });
    Ok(root)
}

fn key_path(app: &AppHandle, key: &[String]) -> Result<PathBuf, String> {
    if key.is_empty() {
        return Err("empty storage key".to_string());
    }
    let mut path = history_root(app)?;
    for c in key {
        if !component_ok(c) {
            return Err(format!("invalid storage key component: {c:?}"));
        }
        path.push(c);
    }
    Ok(path)
}

fn collect_chunks(dir: &Path, base: &Path, out: &mut Vec<StorageChunk>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect_chunks(&path, base, out)?;
            continue;
        }
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let key: Vec<String> = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        out.push(StorageChunk {
            key,
            data: B64.encode(fs::read(&path)?),
        });
    }
    Ok(())
}

#[tauri::command]
pub fn storage_load(app: AppHandle, key: Vec<String>) -> Result<Option<String>, String> {
    let path = key_path(&app, &key)?;
    match fs::read(&path) {
        Ok(bytes) => Ok(Some(B64.encode(bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn storage_save(app: AppHandle, key: Vec<String>, data: String) -> Result<(), String> {
    let path = key_path(&app, &key)?;
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn storage_remove(app: AppHandle, key: Vec<String>) -> Result<(), String> {
    let path = key_path(&app, &key)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn storage_load_range(
    app: AppHandle,
    prefix: Vec<String>,
) -> Result<Vec<StorageChunk>, String> {
    let root = key_path(&app, &prefix)?;
    let base = history_root(&app)?;
    let mut out = Vec::new();
    if root.is_dir() {
        collect_chunks(&root, &base, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

#[tauri::command]
pub fn storage_list_roots(app: AppHandle, prefix: Vec<String>) -> Result<Vec<String>, String> {
    let root = key_path(&app, &prefix)?;
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            out.push(name);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn storage_remove_range(app: AppHandle, prefix: Vec<String>) -> Result<(), String> {
    let root = key_path(&app, &prefix)?;
    match fs::remove_dir_all(&root) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
