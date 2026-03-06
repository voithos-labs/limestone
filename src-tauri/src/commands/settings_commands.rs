use crate::services::JsonSettingsStore;
use crate::AppData;
use serde_json::Value;
use tauri::{AppHandle, State};

fn settings_store(app: &AppHandle, app_data: &AppData) -> JsonSettingsStore {
    let vault_path = app_data
        .active_vault
        .lock()
        .unwrap()
        .as_ref()
        .map(|v| v.path.clone());
    JsonSettingsStore::for_app(app, vault_path.as_deref())
}

#[tauri::command]
pub fn get_setting(app_data: State<AppData>, key: String) -> Option<Value> {
    let settings = app_data.settings.lock().unwrap();
    settings.get(&key).cloned()
}

#[tauri::command]
pub fn set_setting_vault(
    app: AppHandle,
    app_data: State<AppData>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let store = settings_store(&app, &app_data);
    store.set_vault(&key, &value).map_err(|e| e.to_string())?;
    *app_data.settings.lock().unwrap() = store.load_merged();
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
    *app_data.settings.lock().unwrap() = store.load_merged();
    Ok(())
}
