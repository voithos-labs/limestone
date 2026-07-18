use std::path::{Path, PathBuf};

use base64::Engine;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::commands::source_commands::find_source;
use crate::services::fs::atomic_write;

fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| e.to_string())
}

fn global_import(app: &AppHandle, bytes: &[u8], ext: &str) -> Result<String, String> {
    let hash = blake3::hash(bytes).to_hex().to_string();
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    let name = if ext.is_empty() {
        hash
    } else {
        format!("{hash}.{ext}")
    };
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("assets");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&name);
    if !dest.exists() {
        atomic_write(&dest, bytes).map_err(|e| e.to_string())?;
    }
    Ok(name)
}

fn unique_dest(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut n = 0u32;
    loop {
        let suffix = if n == 0 {
            String::new()
        } else {
            format!(" {n}")
        };
        let name = if ext.is_empty() {
            format!("{stem}{suffix}")
        } else {
            format!("{stem}{suffix}.{ext}")
        };
        let dest = dir.join(name);
        if !dest.exists() {
            return dest;
        }
        n += 1;
    }
}

fn source_import(
    app: &AppHandle,
    source_id: Uuid,
    bytes: &[u8],
    stem: &str,
    ext: &str,
) -> Result<String, String> {
    let source = find_source(app, source_id)?;
    let loc = source.asset_location.trim_matches('/');
    let dir = if loc.is_empty() {
        source.path.clone()
    } else {
        source.path.join(loc)
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    let dest = unique_dest(&dir, stem, &ext);
    atomic_write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest
        .strip_prefix(&source.path)
        .unwrap_or(&dest)
        .to_string_lossy()
        .replace('\\', "/"))
}

#[tauri::command]
pub async fn import_global_asset(app: AppHandle, src_path: String) -> Result<String, String> {
    let src = Path::new(&src_path);
    let bytes = std::fs::read(src).map_err(|e| e.to_string())?;
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    global_import(&app, &bytes, ext)
}

#[tauri::command]
pub async fn import_global_asset_bytes(
    app: AppHandle,
    data: String,
    ext: String,
) -> Result<String, String> {
    global_import(&app, &decode_base64(&data)?, &ext)
}

#[tauri::command]
pub async fn import_source_asset(
    app: AppHandle,
    source_id: Uuid,
    src_path: String,
) -> Result<String, String> {
    let src = Path::new(&src_path);
    let bytes = std::fs::read(src).map_err(|e| e.to_string())?;
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    source_import(&app, source_id, &bytes, stem, ext)
}

#[tauri::command]
pub async fn import_source_asset_bytes(
    app: AppHandle,
    source_id: Uuid,
    data: String,
    ext: String,
) -> Result<String, String> {
    let stem = format!(
        "Pasted image {}",
        chrono::Local::now().format("%Y%m%d%H%M%S")
    );
    source_import(&app, source_id, &decode_base64(&data)?, &stem, &ext)
}
