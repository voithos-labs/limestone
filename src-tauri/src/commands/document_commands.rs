use crate::services::fs::{atomic_write, move_file};
use crate::AppData;
use tauri::State;

fn mtime(path: &std::path::Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn write_document(
    app_data: State<'_, AppData>,
    source_path: String,
    rel_path: String,
    contents: String,
) -> Result<(), String> {
    let full_path = std::path::Path::new(&source_path).join(&rel_path);

    atomic_write(&full_path, contents.as_bytes()).map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE documents SET mtime = ?1, updated_at = datetime('now') WHERE rel_path = ?2",
    )
    .bind(mtime(&full_path))
    .bind(&rel_path)
    .execute(&app_data.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn rename_document(
    app_data: State<'_, AppData>,
    source_path: String,
    rel_path: String,
    new_name: String,
) -> Result<String, String> {
    let source = std::path::Path::new(&source_path);
    let old_full = source.join(&rel_path);
    let new_rel = std::path::Path::new(&rel_path)
        .parent()
        .unwrap_or(std::path::Path::new(""))
        .join(&new_name)
        .to_string_lossy()
        .replace('\\', "/");
    let new_full = source.join(&new_rel);

    std::fs::rename(&old_full, &new_full).map_err(|e| e.to_string())?;

    let title = std::path::Path::new(&new_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&new_name);

    sqlx::query("UPDATE documents SET rel_path = ?1, title = ?2, mtime = ?3, updated_at = datetime('now') WHERE rel_path = ?4")
        .bind(&new_rel)
        .bind(title)
        .bind(mtime(&new_full))
        .bind(&rel_path)
        .execute(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(new_rel)
}

#[tauri::command]
pub async fn move_document(
    app_data: State<'_, AppData>,
    source_path: String,
    rel_path: String,
    new_rel_path: String,
) -> Result<(), String> {
    let source = std::path::Path::new(&source_path);
    let old_full = source.join(&rel_path);
    let new_full = source.join(&new_rel_path);

    move_file(&old_full, &new_full).map_err(|e| e.to_string())?;

    sqlx::query("UPDATE documents SET rel_path = ?1, mtime = ?2, updated_at = datetime('now') WHERE rel_path = ?3")
        .bind(&new_rel_path)
        .bind(mtime(&new_full))
        .bind(&rel_path)
        .execute(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
