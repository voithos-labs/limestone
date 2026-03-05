use crate::services::JsonSettingsStore;
use crate::AppData;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

fn get_settings_store(
    app: &AppHandle,
    app_data: &State<AppData>,
) -> Result<JsonSettingsStore, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json");

    let override_path = app_data
        .active_vault
        .lock()
        .unwrap()
        .as_ref()
        .map(|v| v.path.join("settings.json"));

    Ok(JsonSettingsStore {
        path,
        default_json: None,
        override_path,
    })
}

#[tauri::command]
pub fn get_setting(app: AppHandle, app_data: State<AppData>, key: String) -> Option<Value> {
    let store = get_settings_store(&app, &app_data).ok()?;
    store.get(&key)
}

#[tauri::command]
pub fn set_setting_vault(
    app: AppHandle,
    app_data: State<AppData>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let store = get_settings_store(&app, &app_data)?;
    store.set_vault(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting_global(
    app: AppHandle,
    app_data: State<AppData>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let store = get_settings_store(&app, &app_data)?;
    store.set_global(&key, value).map_err(|e| e.to_string())
}
