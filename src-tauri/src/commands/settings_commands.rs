use crate::services::{dot_get, JsonSettingsStore};
use crate::AppData;
use serde_json::Value;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_setting(app_data: State<AppData>, key: String) -> Option<Value> {
    dot_get(&app_data.settings.read().unwrap(), &key).cloned()
}

#[tauri::command]
pub fn get_all_settings(app_data: State<AppData>) -> Value {
    app_data.settings.read().unwrap().clone()
}

#[tauri::command]
pub fn get_default_settings(app: AppHandle) -> Value {
    JsonSettingsStore::for_app(&app).load_defaults()
}

#[tauri::command]
pub fn set_setting_global(
    app: AppHandle,
    app_data: State<AppData>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let store = JsonSettingsStore::for_app(&app);
    store.set_global(&key, value).map_err(|e| e.to_string())?;
    *app_data.settings.write().unwrap() = store.load_merged();
    Ok(())
}

#[tauri::command]
pub fn reset_setting_global(
    app: AppHandle,
    app_data: State<AppData>,
    key: String,
) -> Result<(), String> {
    let store = JsonSettingsStore::for_app(&app);
    store.remove_global(&key).map_err(|e| e.to_string())?;
    *app_data.settings.write().unwrap() = store.load_merged();
    Ok(())
}

#[tauri::command]
pub fn reset_all_settings(app: AppHandle, app_data: State<AppData>) -> Result<(), String> {
    let store = JsonSettingsStore::for_app(&app);
    store.clear_global().map_err(|e| e.to_string())?;
    *app_data.settings.write().unwrap() = store.load_merged();
    Ok(())
}
