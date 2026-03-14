use serde::Deserialize;
use tauri::State;

use crate::services::{self, dot_get, Frontmatter};
use crate::AppData;

fn vault_path(app_data: &AppData) -> Result<std::path::PathBuf, String> {
    app_data
        .active_vault
        .lock()
        .unwrap()
        .as_ref()
        .map(|v| v.path.clone())
        .ok_or_else(|| "no active vault".to_string())
}

#[tauri::command]
pub fn get_document(
    app_data: State<AppData>,
    id: String,
) -> Result<services::document::DocumentContent, String> {
    let vault = vault_path(&app_data)?;
    let db = app_data.db.get().map_err(|e| e.to_string())?;
    let settings = app_data.settings.read().unwrap();

    let rel_path: String = db
        .query_row(
            "select rel_path from documents where id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let use_fm = dot_get(&settings, "documents.use_yaml_frontmatter")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    services::document::read_document(&vault.join(&rel_path), use_fm)
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct SaveDocumentArgs {
    pub id: String,
    pub frontmatter: Frontmatter,
    pub body: String,
    pub had_frontmatter: bool,
}

#[tauri::command]
pub fn save_document(
    app_data: State<AppData>,
    args: SaveDocumentArgs,
) -> Result<(), String> {
    let vault = vault_path(&app_data)?;
    let db = app_data.db.get().map_err(|e| e.to_string())?;
    let settings = app_data.settings.read().unwrap();

    let rel_path: String = db
        .query_row(
            "select rel_path from documents where id = ?1",
            rusqlite::params![args.id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let full_path = vault.join(&rel_path);

    let use_fm = dot_get(&settings, "documents.use_yaml_frontmatter")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let add_to_existing = dot_get(&settings, "documents.add_yaml_frontmatter_to_existing_documents")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    drop(settings);

    let mut fm = args.frontmatter;

    services::document::write_document(
        &full_path,
        &mut fm,
        &args.body,
        use_fm,
        add_to_existing,
        args.had_frontmatter,
    )?;

    // Update db mtime + properties
    let mtime = std::fs::metadata(&full_path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let properties = serde_json::to_string(&fm.properties).unwrap_or_else(|_| "{}".to_string());

    db.execute(
        "update documents set mtime = ?1, properties = ?2, updated_at = datetime('now') where id = ?3",
        rusqlite::params![mtime, properties, args.id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
