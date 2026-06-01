use crate::services::bulk_ops::BulkResult;
use crate::AppData;
use serde_json::Value;
use std::path::Path;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn bulk_set_view_field(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    source_path: String,
    view_slug: String,
    field_name: String,
    value: Value,
    doc_ids: Vec<String>,
) -> Result<BulkResult, String> {
    app_data
        .bulk
        .set_view_field(
            &app_data.db,
            &app,
            &source_id,
            Path::new(&source_path),
            &view_slug,
            &field_name,
            value,
            doc_ids,
        )
        .await
}

#[tauri::command]
pub async fn bulk_rename_view_field(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    source_path: String,
    view_slug: String,
    old_name: String,
    new_name: String,
) -> Result<BulkResult, String> {
    app_data
        .bulk
        .rename_view_field(
            &app_data.db,
            &app,
            &source_id,
            Path::new(&source_path),
            &view_slug,
            &old_name,
            &new_name,
        )
        .await
}

#[tauri::command]
pub async fn bulk_rename_view_option(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    source_path: String,
    view_slug: String,
    field_name: String,
    old_value: String,
    new_value: String,
) -> Result<BulkResult, String> {
    app_data
        .bulk
        .rename_view_option(
            &app_data.db,
            &app,
            &source_id,
            Path::new(&source_path),
            &view_slug,
            &field_name,
            &old_value,
            &new_value,
        )
        .await
}

#[tauri::command]
pub async fn bulk_remove_view_field(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    source_path: String,
    view_slug: String,
    field_name: String,
) -> Result<BulkResult, String> {
    app_data
        .bulk
        .remove_view_field(
            &app_data.db,
            &app,
            &source_id,
            Path::new(&source_path),
            &view_slug,
            &field_name,
        )
        .await
}
