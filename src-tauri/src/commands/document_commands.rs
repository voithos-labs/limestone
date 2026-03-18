use crate::services::fs::atomic_write;
use crate::AppData;
use tauri::State;

#[tauri::command]
pub async fn write_document(
    app_data: State<'_, AppData>,
    rel_path: String,
    contents: String,
) -> Result<(), String> {
    let (vault_path, vault_id) = {
        let active = app_data.active_vault.lock().unwrap();
        let vault = active.as_ref().ok_or("no active vault")?;
        (vault.path.clone(), vault.id.to_string())
    };

    let full_path = vault_path.join(&rel_path);

    atomic_write(&full_path, contents.as_bytes()).map_err(|e| e.to_string())?;

    let mtime = std::fs::metadata(&full_path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    sqlx::query("UPDATE documents SET mtime = ?1, updated_at = datetime('now') WHERE vault_id = ?2 AND rel_path = ?3")
        .bind(mtime)
        .bind(&vault_id)
        .bind(&rel_path)
        .execute(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
