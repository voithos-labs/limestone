use crate::commands::source_commands::find_source;
use crate::services::assets;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[tauri::command]
pub async fn import_global_asset(app: AppHandle, src_path: String) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    assets::import_global_asset(&data_dir, std::path::Path::new(&src_path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_global_asset_bytes(
    app: AppHandle,
    data: String,
    ext: String,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    assets::import_global_asset_bytes(&data_dir, &bytes, &ext).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_source_asset(
    app: AppHandle,
    source_id: Uuid,
    src_path: String,
) -> Result<String, String> {
    let source = find_source(&app, source_id)?;
    assets::import_source_asset(
        &source.path,
        &source.asset_location,
        std::path::Path::new(&src_path),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_source_asset_bytes(
    app: AppHandle,
    source_id: Uuid,
    data: String,
    ext: String,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| e.to_string())?;
    let source = find_source(&app, source_id)?;
    let stem = format!(
        "Pasted image {}",
        chrono::Local::now().format("%Y%m%d%H%M%S")
    );
    assets::import_source_asset_bytes(&source.path, &source.asset_location, &bytes, &stem, &ext)
        .map_err(|e| e.to_string())
}
