use crate::services::JsonSettingsStore;
use crate::AppData;
use serde_json::Value;
use tauri::{AppHandle, State};

/// For writes
fn settings_store(app: &AppHandle, app_data: &AppData) -> JsonSettingsStore {
    let source_path = app_data
        .active_source
        .lock()
        .unwrap()
        .as_ref()
        .map(|v| v.path.clone());
    JsonSettingsStore::for_app(app, source_path.as_deref())
}

#[tauri::command]
pub fn get_setting(app_data: State<AppData>, key: String) -> Option<Value> {
    app_data.settings.read().unwrap().get(&key).cloned()
}

#[tauri::command]
pub fn set_setting_source(
    app: AppHandle,
    app_data: State<AppData>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let store = settings_store(&app, &app_data);
    store.set_source(&key, &value).map_err(|e| e.to_string())?;
    *app_data.settings.write().unwrap() = store.load_merged();
    Ok(())
}

#[tauri::command]
pub fn set_setting_global(
    app: AppHandle,
    app_data: State<AppData>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let store = settings_store(&app, &app_data);
    store.set_global(&key, value).map_err(|e| e.to_string())?;
    *app_data.settings.write().unwrap() = store.load_merged();
    Ok(())
}
