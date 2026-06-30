use crate::services::fs::{atomic_write, move_file};
use crate::services::{frontmatter, index_document};
use crate::AppData;
use chrono::{DateTime, Utc};
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
    source_id: String,
    source_path: String,
    rel_path: String,
    contents: String,
    updated_at: String,
) -> Result<(), String> {
    let full_path = std::path::Path::new(&source_path).join(&rel_path);

    atomic_write(&full_path, contents.as_bytes()).map_err(|e| e.to_string())?;

    let updated_sql = iso_to_sql(&updated_at)?;
    sqlx::query(
        "UPDATE documents SET mtime = ?1, updated_at = ?2 WHERE source_id = ?3 AND rel_path = ?4",
    )
    .bind(mtime(&full_path))
    .bind(&updated_sql)
    .bind(&source_id)
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

/// Parse a JS ISO
fn iso_to_sql(s: &str) -> Result<String, String> {
    let dt = DateTime::parse_from_rfc3339(s)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);
    Ok(dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

#[tauri::command]
pub async fn save_document_meta(
    app_data: State<'_, AppData>,
    id: String,
    source_path: String,
    rel_path: String,
    created_at: Option<String>,
    updated_at: Option<String>,
) -> Result<(), String> {
    let full_path = std::path::Path::new(&source_path).join(&rel_path);

    // Patch frontmatter on fs
    let c = created_at.clone();
    let u = updated_at.clone();
    frontmatter::rewrite_frontmatter(&full_path, |fm| {
        if let Some(obj) = fm.as_object_mut() {
            if let Some(c) = &c {
                obj.insert(
                    "created_at".to_string(),
                    serde_json::Value::String(c.clone()),
                );
            }
            if let Some(u) = &u {
                obj.insert(
                    "updated_at".to_string(),
                    serde_json::Value::String(u.clone()),
                );
            }
        }
    })
    .map_err(|e| e.to_string())?;

    let created_sql = created_at.as_deref().map(iso_to_sql).transpose()?;
    let updated_sql = updated_at.as_deref().map(iso_to_sql).transpose()?;

    sqlx::query(
        "UPDATE documents
         SET created_at = COALESCE(?1, created_at),
             updated_at = COALESCE(?2, updated_at),
             mtime = ?3
         WHERE id = ?4",
    )
    .bind(created_sql)
    .bind(updated_sql)
    .bind(mtime(&full_path))
    .bind(&id)
    .execute(&app_data.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn move_document(
    app_data: State<'_, AppData>,
    source_id: String,
    source_path: String,
    rel_path: String,
    new_rel_path: String,
    new_source_id: Option<String>,
    new_source_path: Option<String>,
) -> Result<(), String> {
    let dest_source_id = new_source_id.unwrap_or_else(|| source_id.clone());
    let dest_source_path = new_source_path.unwrap_or_else(|| source_path.clone());

    let old_full = std::path::Path::new(&source_path).join(&rel_path);
    let dest_source = std::path::Path::new(&dest_source_path);
    let new_full = dest_source.join(&new_rel_path);

    move_file(&old_full, &new_full).map_err(|e| e.to_string())?;

    let doc_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2")
            .bind(&source_id)
            .bind(&rel_path)
            .fetch_optional(&app_data.db)
            .await
            .map_err(|e| e.to_string())?;

    if let Some(doc_id) = doc_id {
        if dest_source_id != source_id {
            sqlx::query("UPDATE documents SET source_id = ?1 WHERE id = ?2")
                .bind(&dest_source_id)
                .bind(&doc_id)
                .execute(&app_data.db)
                .await
                .map_err(|e| e.to_string())?;
        }
        index_document(
            &app_data.db,
            &dest_source_id,
            dest_source,
            &doc_id,
            &new_rel_path,
            1024,
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_document(
    app_data: State<'_, AppData>,
    id: String,
    source_path: String,
    rel_path: String,
) -> Result<(), String> {
    let full_path = std::path::Path::new(&source_path).join(&rel_path);

    // Remove the file (ignore a missing file so the DB row is still cleaned up)
    match std::fs::remove_file(&full_path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }

    // Drop the row + its group memberships (folder/tag links)
    sqlx::query("DELETE FROM document_groups WHERE document_id = ?1")
        .bind(&id)
        .execute(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM documents WHERE id = ?1")
        .bind(&id)
        .execute(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
