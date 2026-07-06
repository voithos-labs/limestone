use crate::commands::source_commands::source_uses_frontmatter;
use crate::services::fs::{atomic_write, move_file};
use crate::services::{
    cleanup_orphan_folder_groups, fm_properties, frontmatter, index_document, sync_folders,
    sync_tags,
};
use crate::AppData;
use tauri::{AppHandle, State};

fn mtime(path: &std::path::Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn write_document(
    app_data: State<'_, AppData>,
    source_id: String,
    source_path: String,
    rel_path: String,
    contents: String,
    updated_at: i64,
    create: Option<bool>,
) -> Result<(), String> {
    let full_path = std::path::Path::new(&source_path).join(&rel_path);

    if create.unwrap_or(false) && full_path.exists() {
        return Err(format!("\"{rel_path}\" already exists"));
    }
    atomic_write(&full_path, contents.as_bytes()).map_err(|e| e.to_string())?;

    let mtime = mtime(&full_path);
    let (fm, _) = frontmatter::split_content(&contents);

    let mut tx = app_data.db.begin().await.map_err(|e| e.to_string())?;

    if let Some(fm) = &fm {
        let properties = fm_properties(fm);
        let created_ms = fm
            .get("created_at")
            .and_then(|v| v.as_str())
            .and_then(frontmatter::date_ms);

        sqlx::query(
            "UPDATE documents
             SET mtime = ?1, updated_at = ?2, properties = ?3,
                 created_at = COALESCE(?4, created_at)
             WHERE source_id = ?5 AND rel_path = ?6",
        )
        .bind(mtime)
        .bind(updated_at)
        .bind(&properties)
        .bind(created_ms)
        .bind(&source_id)
        .bind(&rel_path)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    } else {
        sqlx::query(
            "UPDATE documents SET mtime = ?1, updated_at = ?2 WHERE source_id = ?3 AND rel_path = ?4",
        )
        .bind(mtime)
        .bind(updated_at)
        .bind(&source_id)
        .bind(&rel_path)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    let doc_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2")
            .bind(&source_id)
            .bind(&rel_path)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    if let Some(doc_id) = doc_id {
        if let Some(fm) = &fm {
            let tags: Vec<String> = fm
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            sync_tags(&mut tx, &doc_id, &tags)
                .await
                .map_err(|e| e.to_string())?;
        }
        sync_folders(&mut tx, &source_id, &doc_id, &rel_path)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_document_tags(
    app_data: State<'_, AppData>,
    app: AppHandle,
    id: String,
    source_id: String,
    source_path: String,
    rel_path: String,
    tags: Vec<String>,
) -> Result<(), String> {
    if !source_uses_frontmatter(&app, &source_id) {
        return Err(
            "This source stores documents without frontmatter, so tags can't be saved here.".into(),
        );
    }

    let full_path = std::path::Path::new(&source_path).join(&rel_path);
    let fm_tags = tags.clone();
    frontmatter::rewrite_frontmatter(&full_path, move |fm| {
        if let Some(obj) = fm.as_object_mut() {
            if fm_tags.is_empty() {
                obj.remove("tags");
            } else {
                obj.insert(
                    "tags".to_string(),
                    serde_json::Value::Array(
                        fm_tags
                            .iter()
                            .map(|t| serde_json::Value::String(t.clone()))
                            .collect(),
                    ),
                );
            }
        }
    })
    .map_err(|e| e.to_string())?;

    let mut tx = app_data.db.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE documents SET mtime = ?1 WHERE id = ?2")
        .bind(mtime(&full_path))
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sync_tags(&mut tx, &id, &tags)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rename_document(
    app_data: State<'_, AppData>,
    source_id: String,
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

    if new_full.exists() {
        return Err(format!("\"{new_rel}\" already exists"));
    }
    std::fs::rename(&old_full, &new_full).map_err(|e| e.to_string())?;

    let title = std::path::Path::new(&new_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&new_name);

    sqlx::query(
        "UPDATE documents SET rel_path = ?1, title = ?2, mtime = ?3 WHERE source_id = ?4 AND rel_path = ?5",
    )
    .bind(&new_rel)
    .bind(title)
    .bind(mtime(&new_full))
    .bind(&source_id)
    .bind(&rel_path)
    .execute(&app_data.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(new_rel)
}

#[tauri::command]
pub async fn save_document_meta(
    app_data: State<'_, AppData>,
    app: AppHandle,
    id: String,
    source_id: String,
    source_path: String,
    rel_path: String,
    created_at: Option<String>,
    updated_at: Option<String>,
) -> Result<(), String> {
    if !source_uses_frontmatter(&app, &source_id) {
        return Err(
            "This source stores documents without frontmatter, so per-document metadata can't be saved here."
                .into(),
        );
    }

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

    let created_ms = created_at.as_deref().and_then(frontmatter::date_ms);
    let updated_ms = updated_at.as_deref().and_then(frontmatter::date_ms);

    sqlx::query(
        "UPDATE documents
         SET created_at = COALESCE(?1, created_at),
             updated_at = COALESCE(?2, updated_at),
             mtime = ?3
         WHERE id = ?4",
    )
    .bind(created_ms)
    .bind(updated_ms)
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
        if dest_source_id != source_id {
            cleanup_orphan_folder_groups(&app_data.db, &source_id)
                .await
                .map_err(|e| e.to_string())?;
        }
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

    let source_id: Option<String> =
        sqlx::query_scalar("SELECT source_id FROM documents WHERE id = ?1")
            .bind(&id)
            .fetch_optional(&app_data.db)
            .await
            .map_err(|e| e.to_string())?;
    let group_ids: Vec<String> =
        sqlx::query_scalar("SELECT group_id FROM document_groups WHERE document_id = ?1")
            .bind(&id)
            .fetch_all(&app_data.db)
            .await
            .map_err(|e| e.to_string())?;

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

    for group_id in &group_ids {
        sqlx::query(
            "DELETE FROM groups WHERE id = ?1 AND group_type = 'tag'
             AND id NOT IN (SELECT group_id FROM document_groups)",
        )
        .bind(group_id)
        .execute(&app_data.db)
        .await
        .map_err(|e| e.to_string())?;
    }
    if let Some(source_id) = source_id {
        cleanup_orphan_folder_groups(&app_data.db, &source_id)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
