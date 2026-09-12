use crate::commands::source_commands::{source_root, source_uses_frontmatter};
use crate::services::bulk_ops::{BulkAction, BulkOp, BulkResult};
use crate::AppData;
use serde_json::Value;
use tauri::{AppHandle, State};

async fn run(
    app_data: &State<'_, AppData>,
    app: &AppHandle,
    source_id: &str,
    action: BulkAction,
) -> Result<BulkResult, String> {
    let root = source_root(app, source_id)?;
    app_data
        .bulk
        .run(&app_data.db, app, &root, BulkOp::new(source_id, action))
        .await
}

#[tauri::command]
pub async fn bulk_set_view_field(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    view_slug: String,
    field_name: String,
    value: Value,
    doc_ids: Vec<String>,
) -> Result<BulkResult, String> {
    if !source_uses_frontmatter(&app, &source_id) {
        return Err("This source stores documents without frontmatter, so per-document metadata can't be saved here.".into());
    }
    run(
        &app_data,
        &app,
        &source_id,
        BulkAction::SetViewField {
            view_slug,
            field_name,
            value,
            doc_ids,
        },
    )
    .await
}

#[tauri::command]
pub async fn bulk_rename_view_field(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    view_slug: String,
    old_name: String,
    new_name: String,
) -> Result<BulkResult, String> {
    run(
        &app_data,
        &app,
        &source_id,
        BulkAction::RenameViewField {
            view_slug,
            old_name,
            new_name,
        },
    )
    .await
}

#[tauri::command]
pub async fn bulk_rename_view(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    old_slug: String,
    new_slug: String,
) -> Result<BulkResult, String> {
    run(
        &app_data,
        &app,
        &source_id,
        BulkAction::RenameView { old_slug, new_slug },
    )
    .await
}

#[tauri::command]
pub async fn bulk_rename_view_prefix(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    old_prefix: String,
    new_prefix: String,
) -> Result<BulkResult, String> {
    run(
        &app_data,
        &app,
        &source_id,
        BulkAction::RenameViewPrefix {
            old_prefix,
            new_prefix,
        },
    )
    .await
}

#[tauri::command]
pub async fn bulk_rename_view_option(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    view_slug: String,
    field_name: String,
    old_value: String,
    new_value: String,
) -> Result<BulkResult, String> {
    run(
        &app_data,
        &app,
        &source_id,
        BulkAction::RenameViewOption {
            view_slug,
            field_name,
            old_value,
            new_value,
        },
    )
    .await
}

#[tauri::command]
pub async fn bulk_remove_view_field(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    view_slug: String,
    field_name: String,
) -> Result<BulkResult, String> {
    run(
        &app_data,
        &app,
        &source_id,
        BulkAction::RemoveViewField {
            view_slug,
            field_name,
        },
    )
    .await
}

#[tauri::command]
pub async fn bulk_rename_tag(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    old_slug: String,
    new_slug: String,
) -> Result<BulkResult, String> {
    if !source_uses_frontmatter(&app, &source_id) {
        return Err(
            "This source stores documents without frontmatter, so tags can't be saved here.".into(),
        );
    }
    run(
        &app_data,
        &app,
        &source_id,
        BulkAction::RenameTag { old_slug, new_slug },
    )
    .await
}

#[tauri::command]
pub async fn bulk_remove_tag(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    slug: String,
) -> Result<BulkResult, String> {
    if !source_uses_frontmatter(&app, &source_id) {
        return Err(
            "This source stores documents without frontmatter, so tags can't be saved here.".into(),
        );
    }
    run(&app_data, &app, &source_id, BulkAction::RemoveTag { slug }).await
}
