use crate::commands::source_commands::{doc_writes_meta, source_root};
use crate::commands::OpError;
use crate::services::body::{merge_body_tags, rewrite_tags, tag_mentions};
use crate::services::fs::{
    atomic_write, is_taken, move_file, resolve_in_source, validate_file_name,
};
use crate::services::{fm_properties, frontmatter, index_document, sync_folders, sync_tags};
use crate::AppData;
use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;
use std::path::Path;
use tauri::{AppHandle, State};

fn mtime(path: &std::path::Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn fm_tags(fm: Option<&Value>) -> Vec<String> {
    fm.and_then(|fm| fm.get("tags"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

async fn sync_file_tags(
    db: &SqlitePool,
    id: &str,
    path: &Path,
    mut tags: Vec<String>,
) -> Result<(), OpError> {
    if let Ok(contents) = std::fs::read_to_string(path) {
        merge_body_tags(&mut tags, frontmatter::split_content(&contents).1);
    }
    let mut tx = db.begin().await.map_err(OpError::from)?;
    sqlx::query("UPDATE documents SET mtime = ?1 WHERE id = ?2")
        .bind(mtime(path))
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(OpError::from)?;
    sync_tags(&mut tx, id, &tags).await.map_err(OpError::from)?;
    tx.commit().await.map_err(OpError::from)
}

fn root_of(app: &AppHandle, source_id: &str) -> Result<std::path::PathBuf, OpError> {
    match source_root(app, source_id) {
        Ok(root) if root.is_dir() => Ok(root),
        _ => Err(OpError::new("source_missing")),
    }
}

#[derive(Debug, Serialize)]
pub struct ReadError {
    kind: &'static str,
}

fn read_kind(e: &std::io::Error) -> &'static str {
    match crate::services::bulk_ops::classify_io(e).as_str() {
        "not_found" => "not_found",
        "permission" => "permission",
        "locked" => "locked",
        "invalid_data" => "invalid_data",
        _ => "other",
    }
}

#[tauri::command]
pub fn read_document(
    app: AppHandle,
    source_id: String,
    rel_path: String,
) -> Result<String, ReadError> {
    let fail = |kind| ReadError { kind };
    let root = source_root(&app, &source_id).map_err(|_| fail("source_missing"))?;
    if !root.is_dir() {
        return Err(fail("source_missing"));
    }
    let path = resolve_in_source(&root, &rel_path).map_err(|_| fail("not_found"))?;
    std::fs::read_to_string(&path).map_err(|e| match read_kind(&e) {
        "permission" if std::fs::read_dir(&root).is_err() => fail("source_permission"),
        kind => fail(kind),
    })
}

#[tauri::command]
pub async fn write_document(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    rel_path: String,
    contents: String,
    updated_at: i64,
    create: Option<bool>,
) -> Result<(), OpError> {
    let root = root_of(&app, &source_id)?;
    let full_path = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;

    if create.unwrap_or(false) && full_path.exists() {
        return Err(OpError::named("already_exists", &rel_path));
    }
    atomic_write(&full_path, contents.as_bytes()).map_err(OpError::from)?;

    let mtime = mtime(&full_path);
    let (fm, body) = frontmatter::split_content(&contents);

    let mut tx = app_data.db.begin().await.map_err(OpError::from)?;

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
        .map_err(OpError::from)?;
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
        .map_err(OpError::from)?;
    }

    let doc_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2")
            .bind(&source_id)
            .bind(&rel_path)
            .fetch_optional(&mut *tx)
            .await
            .map_err(OpError::from)?;
    if let Some(doc_id) = doc_id {
        let mut tags = fm_tags(fm.as_ref());
        merge_body_tags(&mut tags, body);
        sync_tags(&mut tx, &doc_id, &tags)
            .await
            .map_err(OpError::from)?;
        sync_folders(&mut tx, &source_id, &doc_id, &rel_path)
            .await
            .map_err(OpError::from)?;
        sqlx::query(
            "DELETE FROM documents_fts WHERE rowid = (SELECT rowid FROM documents WHERE id = ?1)",
        )
        .bind(&doc_id)
        .execute(&mut *tx)
        .await
        .map_err(OpError::from)?;
        sqlx::query(
            "INSERT INTO documents_fts (rowid, doc_id, body)
             SELECT rowid, id, ?2 FROM documents WHERE id = ?1",
        )
        .bind(&doc_id)
        .bind(body)
        .execute(&mut *tx)
        .await
        .map_err(OpError::from)?;
    }

    tx.commit().await.map_err(OpError::from)?;
    Ok(())
}

#[tauri::command]
pub fn strip_body_tag(body: String, slug: String) -> Option<String> {
    rewrite_tags(&body, &slug, None)
}

#[tauri::command]
pub async fn set_document_tags(
    app_data: State<'_, AppData>,
    app: AppHandle,
    id: String,
    source_id: String,
    rel_path: String,
    tags: Vec<String>,
) -> Result<(), OpError> {
    if !doc_writes_meta(&app_data.db, &source_id, &rel_path).await? {
        return Err(OpError::new("no_metadata"));
    }

    let root = root_of(&app, &source_id)?;
    let full_path = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;
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
    .map_err(OpError::from)?;

    sync_file_tags(&app_data.db, &id, &full_path, tags).await
}

#[derive(Serialize)]
pub struct DocumentTags {
    frontmatter: Vec<String>,
    body: Vec<String>,
}

#[tauri::command]
pub fn read_document_tags(
    app: AppHandle,
    source_id: String,
    rel_path: String,
) -> Result<DocumentTags, OpError> {
    let root = root_of(&app, &source_id)?;
    let full_path = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;
    let contents = std::fs::read_to_string(&full_path).map_err(OpError::from)?;
    let (fm, body) = frontmatter::split_content(&contents);
    Ok(DocumentTags {
        frontmatter: fm_tags(fm.as_ref()),
        body: tag_mentions(body),
    })
}

#[tauri::command]
pub async fn strip_document_tag(
    app_data: State<'_, AppData>,
    app: AppHandle,
    id: String,
    source_id: String,
    rel_path: String,
    slug: String,
) -> Result<(), OpError> {
    let root = root_of(&app, &source_id)?;
    let full_path = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;
    frontmatter::rewrite_document(&full_path, None, &|body| rewrite_tags(body, &slug, None))
        .map_err(OpError::from)?;
    let contents = std::fs::read_to_string(&full_path).map_err(OpError::from)?;
    let tags = fm_tags(frontmatter::split_content(&contents).0.as_ref());
    sync_file_tags(&app_data.db, &id, &full_path, tags).await
}

#[tauri::command]
pub async fn rename_document(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    rel_path: String,
    new_name: String,
) -> Result<String, OpError> {
    validate_file_name(&new_name).map_err(|_| OpError::named("invalid_name", &new_name))?;

    let root = root_of(&app, &source_id)?;
    let old_full = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;
    let new_rel = std::path::Path::new(&rel_path)
        .parent()
        .unwrap_or(std::path::Path::new(""))
        .join(&new_name)
        .to_string_lossy()
        .replace('\\', "/");
    let new_full = resolve_in_source(&root, &new_rel).map_err(OpError::from)?;

    if is_taken(&old_full, &new_full) {
        return Err(OpError::named("already_exists", &new_name));
    }
    std::fs::rename(&old_full, &new_full).map_err(OpError::from)?;

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
    .map_err(OpError::from)?;

    Ok(new_rel)
}

#[tauri::command]
pub async fn save_document_meta(
    app_data: State<'_, AppData>,
    app: AppHandle,
    id: String,
    source_id: String,
    rel_path: String,
    created_at: Option<String>,
    updated_at: Option<String>,
) -> Result<(), OpError> {
    if !doc_writes_meta(&app_data.db, &source_id, &rel_path).await? {
        return Err(OpError::new("no_metadata"));
    }

    let root = root_of(&app, &source_id)?;
    let full_path = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;

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
    .map_err(OpError::from)?;

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
    .map_err(OpError::from)?;

    Ok(())
}

#[tauri::command]
pub async fn move_document(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    rel_path: String,
    new_rel_path: String,
    new_source_id: Option<String>,
) -> Result<(), OpError> {
    let dest_source_id = new_source_id.unwrap_or_else(|| source_id.clone());

    let root = root_of(&app, &source_id)?;
    let dest_source = root_of(&app, &dest_source_id)?;
    let old_full = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;
    let new_full = resolve_in_source(&dest_source, &new_rel_path).map_err(OpError::from)?;

    move_file(&old_full, &new_full).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => {
            let leaf = new_rel_path.rsplit('/').next().unwrap_or(&new_rel_path);
            OpError::named("already_exists", leaf)
        }
        _ => OpError::from(e),
    })?;

    let doc_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2")
            .bind(&source_id)
            .bind(&rel_path)
            .fetch_optional(&app_data.db)
            .await
            .map_err(OpError::from)?;

    if let Some(doc_id) = doc_id {
        if dest_source_id != source_id {
            sqlx::query("UPDATE documents SET source_id = ?1 WHERE id = ?2")
                .bind(&dest_source_id)
                .bind(&doc_id)
                .execute(&app_data.db)
                .await
                .map_err(OpError::from)?;
        }
        index_document(
            &app_data.db,
            &dest_source_id,
            &dest_source,
            &doc_id,
            &new_rel_path,
            1024,
        )
        .await
        .map_err(OpError::from)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_document(
    app_data: State<'_, AppData>,
    app: AppHandle,
    id: Option<String>,
    source_id: String,
    rel_path: String,
) -> Result<(), OpError> {
    let root = root_of(&app, &source_id)?;
    let full_path = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;

    if full_path.exists() {
        super::to_trash(&full_path)?;
    }
    let Some(id) = id else {
        return Ok(());
    };

    let tag_ids: Vec<String> =
        sqlx::query_scalar("SELECT tag_id FROM document_tags WHERE document_id = ?1")
            .bind(&id)
            .fetch_all(&app_data.db)
            .await
            .map_err(OpError::from)?;

    // Drop the row + its tag links + FTS index
    sqlx::query("DELETE FROM document_tags WHERE document_id = ?1")
        .bind(&id)
        .execute(&app_data.db)
        .await
        .map_err(OpError::from)?;
    sqlx::query(
        "DELETE FROM documents_fts WHERE rowid = (SELECT rowid FROM documents WHERE id = ?1)",
    )
    .bind(&id)
    .execute(&app_data.db)
    .await
    .map_err(OpError::from)?;
    sqlx::query("DELETE FROM documents WHERE id = ?1")
        .bind(&id)
        .execute(&app_data.db)
        .await
        .map_err(OpError::from)?;

    for tag_id in &tag_ids {
        sqlx::query(
            "DELETE FROM tags WHERE id = ?1
             AND id NOT IN (SELECT tag_id FROM document_tags)",
        )
        .bind(tag_id)
        .execute(&app_data.db)
        .await
        .map_err(OpError::from)?;
    }

    Ok(())
}
