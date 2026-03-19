use crate::services::JsonSettingsStore;
use crate::AppData;
use serde_json::Value;
use tauri::{AppHandle, State};

fn settings_store(app: &AppHandle) -> JsonSettingsStore {
    JsonSettingsStore::for_app(app)
}

#[tauri::command]
pub fn get_setting(app_data: State<AppData>, key: String) -> Option<Value> {
    app_data.settings.read().unwrap().get(&key).cloned()
}

#[tauri::command]
pub fn set_setting_global(
    app: AppHandle,
    app_data: State<AppData>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let store = settings_store(&app);
    store.set_global(&key, value).map_err(|e| e.to_string())?;
    *app_data.settings.write().unwrap() = store.load_merged();
    Ok(())
}
