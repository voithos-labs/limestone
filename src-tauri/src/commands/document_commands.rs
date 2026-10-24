use crate::commands::source_commands::{doc_writes_meta, source_root};
use crate::commands::OpError;
use crate::services::body::{merge_body_tags, rewrite_tags, tag_mentions};
use crate::services::fs::{
    atomic_write, history_dir, is_taken, move_file, mtime_ms, resolve_in_source, validate_file_name,
};
use crate::services::{
    document_type, fm_properties, frontmatter, index_document, sidecar, sync_folders, sync_tags,
};
use crate::AppData;
use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;
use std::path::Path;
use tauri::{AppHandle, State};

fn mtime(path: &Path) -> i64 {
    mtime_ms(path).unwrap_or(0)
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
    if !is_pdf(&path.to_string_lossy()) {
        if let Ok(contents) = std::fs::read_to_string(path) {
            merge_body_tags(&mut tags, frontmatter::split_content(&contents).1);
        }
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

fn is_pdf(rel_path: &str) -> bool {
    document_type(rel_path) == "pdf"
}

fn rewrite_meta(
    root: &Path,
    id: &str,
    rel_path: &str,
    full_path: &Path,
    mutate: impl Fn(&mut Value),
) -> std::io::Result<()> {
    if is_pdf(rel_path) {
        sidecar::rewrite(root, id, rel_path, mutate)
    } else {
        frontmatter::rewrite_frontmatter(full_path, mutate)
    }
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

fn read_in_source<T>(
    app: &AppHandle,
    source_id: &str,
    rel_path: &str,
    read: impl FnOnce(&std::path::Path) -> std::io::Result<T>,
) -> Result<T, ReadError> {
    let fail = |kind| ReadError { kind };
    let root = source_root(app, source_id).map_err(|_| fail("source_missing"))?;
    if !root.is_dir() {
        return Err(fail("source_missing"));
    }
    let path = resolve_in_source(&root, rel_path).map_err(|_| fail("not_found"))?;
    read(&path).map_err(|e| match read_kind(&e) {
        "permission" if std::fs::read_dir(&root).is_err() => fail("source_permission"),
        kind => fail(kind),
    })
}

#[tauri::command]
pub fn read_document(
    app: AppHandle,
    source_id: String,
    rel_path: String,
) -> Result<String, ReadError> {
    read_in_source(&app, &source_id, &rel_path, |p| std::fs::read_to_string(p))
}

#[tauri::command]
pub async fn read_document_bytes(
    app: AppHandle,
    source_id: String,
    rel_path: String,
) -> Result<tauri::ipc::Response, ReadError> {
    read_in_source(&app, &source_id, &rel_path, |p| std::fs::read(p)).map(tauri::ipc::Response::new)
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
) -> Result<i64, OpError> {
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
             WHERE source_id = ?5 AND rel_path = ?6 AND deleted_at IS NULL",
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
            "UPDATE documents SET mtime = ?1, updated_at = ?2
             WHERE source_id = ?3 AND rel_path = ?4 AND deleted_at IS NULL",
        )
        .bind(mtime)
        .bind(updated_at)
        .bind(&source_id)
        .bind(&rel_path)
        .execute(&mut *tx)
        .await
        .map_err(OpError::from)?;
    }

    let doc_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2 AND deleted_at IS NULL",
    )
    .bind(&source_id)
    .bind(&rel_path)
    .fetch_optional(&mut *tx)
    .await
    .map_err(OpError::from)?;
    if let Some(doc_id) = doc_id {
        index_body(&mut tx, &source_id, &doc_id, &rel_path, fm.as_ref(), body).await?;
    }

    tx.commit().await.map_err(OpError::from)?;
    Ok(mtime)
}

async fn index_body(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_id: &str,
    doc_id: &str,
    rel_path: &str,
    fm: Option<&Value>,
    body: &str,
) -> Result<(), OpError> {
    let mut tags = fm_tags(fm);
    merge_body_tags(&mut tags, body);
    sync_tags(tx, doc_id, &tags).await.map_err(OpError::from)?;
    sync_folders(tx, source_id, doc_id, rel_path)
        .await
        .map_err(OpError::from)?;
    sqlx::query(
        "DELETE FROM documents_fts WHERE rowid = (SELECT rowid FROM documents WHERE id = ?1)",
    )
    .bind(doc_id)
    .execute(&mut **tx)
    .await
    .map_err(OpError::from)?;
    sqlx::query(
        "INSERT INTO documents_fts (rowid, doc_id, body)
         SELECT rowid, id, ?2 FROM documents WHERE id = ?1",
    )
    .bind(doc_id)
    .bind(body)
    .execute(&mut **tx)
    .await
    .map_err(OpError::from)?;
    Ok(())
}

#[tauri::command]
pub async fn restore_document(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    id: String,
    rel_path: String,
    contents: String,
    updated_at: i64,
) -> Result<(), OpError> {
    let root = root_of(&app, &source_id)?;
    let full_path = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;
    if full_path.exists() {
        return Err(OpError::named("already_exists", &rel_path));
    }
    atomic_write(&full_path, contents.as_bytes()).map_err(OpError::from)?;

    let mtime = mtime(&full_path);
    let (fm, body) = frontmatter::split_content(&contents);
    let properties = fm
        .as_ref()
        .map(fm_properties)
        .unwrap_or_else(|| "{}".to_string());
    let title = Path::new(&rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled");

    let mut tx = app_data.db.begin().await.map_err(OpError::from)?;
    let revived = sqlx::query(
        "UPDATE documents
         SET rel_path = ?1, title = ?2, mtime = ?3, updated_at = ?4, properties = ?5,
             folder_id = NULL, deleted_at = NULL
         WHERE id = ?6 AND source_id = ?7 AND deleted_at IS NOT NULL",
    )
    .bind(&rel_path)
    .bind(title)
    .bind(mtime)
    .bind(updated_at)
    .bind(&properties)
    .bind(&id)
    .bind(&source_id)
    .execute(&mut *tx)
    .await
    .map_err(OpError::from)?
    .rows_affected();
    if revived == 0 {
        return Err(OpError::new("not_found"));
    }
    index_body(&mut tx, &source_id, &id, &rel_path, fm.as_ref(), body).await?;
    tx.commit().await.map_err(OpError::from)?;
    Ok(())
}

#[tauri::command]
pub async fn purge_document(
    app_data: State<'_, AppData>,
    app: AppHandle,
    id: String,
) -> Result<(), OpError> {
    let source_id: Option<String> = sqlx::query_scalar(
        "SELECT source_id FROM documents WHERE id = ?1 AND deleted_at IS NOT NULL",
    )
    .bind(&id)
    .fetch_optional(&app_data.db)
    .await
    .map_err(OpError::from)?;
    let Some(source_id) = source_id else {
        return Err(OpError::new("not_found"));
    };
    let root = root_of(&app, &source_id)?;
    crate::commands::history_commands::purge_row(&app_data.db, &root, &id)
        .await
        .map_err(OpError::from)
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
    rewrite_meta(&root, &id, &rel_path, &full_path, move |fm| {
        if let Some(obj) = fm.as_object_mut() {
            if fm_tags.is_empty() {
                obj.shift_remove("tags");
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
    id: Option<String>,
) -> Result<DocumentTags, OpError> {
    let root = root_of(&app, &source_id)?;
    if is_pdf(&rel_path) {
        let fm = id.and_then(|id| sidecar::read(&root, &id).ok().flatten());
        return Ok(DocumentTags {
            frontmatter: fm_tags(fm.as_ref()),
            body: Vec::new(),
        });
    }
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
    let doc_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2 AND deleted_at IS NULL",
    )
    .bind(&source_id)
    .bind(&rel_path)
    .fetch_optional(&app_data.db)
    .await
    .map_err(OpError::from)?;
    std::fs::rename(&old_full, &new_full).map_err(OpError::from)?;
    if let Some(id) = doc_id.filter(|_| is_pdf(&new_rel)) {
        sidecar::relocate(&root, &id, &new_rel).map_err(OpError::from)?;
    }

    let title = std::path::Path::new(&new_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&new_name);

    sqlx::query(
        "UPDATE documents SET rel_path = ?1, title = ?2, mtime = ?3
         WHERE source_id = ?4 AND rel_path = ?5 AND deleted_at IS NULL",
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
) -> Result<i64, OpError> {
    if !doc_writes_meta(&app_data.db, &source_id, &rel_path).await? {
        return Err(OpError::new("no_metadata"));
    }

    let root = root_of(&app, &source_id)?;
    let full_path = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;

    // Patch frontmatter on fs
    let c = created_at.clone();
    let u = updated_at.clone();
    rewrite_meta(&root, &id, &rel_path, &full_path, |fm| {
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
    let mtime = mtime(&full_path);

    sqlx::query(
        "UPDATE documents
         SET created_at = COALESCE(?1, created_at),
             updated_at = COALESCE(?2, updated_at),
             mtime = ?3
         WHERE id = ?4",
    )
    .bind(created_ms)
    .bind(updated_ms)
    .bind(mtime)
    .bind(&id)
    .execute(&app_data.db)
    .await
    .map_err(OpError::from)?;

    Ok(mtime)
}

/// moves a doc within or between sources
///
/// if the move occurs between sources, it rounds ups its refs
/// and moves/copies them over:
/// `if dest_source_id != source_id`
///
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

    let doc_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2 AND deleted_at IS NULL",
    )
    .bind(&source_id)
    .bind(&rel_path)
    .fetch_optional(&app_data.db)
    .await
    .map_err(OpError::from)?;

    if let Some(doc_id) = doc_id {
        if is_pdf(&new_rel_path) {
            if dest_source_id != source_id {
                sidecar::move_between(&root, &dest_source, &doc_id, &new_rel_path)
            } else {
                sidecar::relocate(&root, &doc_id, &new_rel_path)
            }
            .map_err(OpError::from)?;
        }
        let mut assets: Vec<(String, bool)> = Vec::new();
        if dest_source_id != source_id {
            assets = sqlx::query_as(
                "SELECT a.rel_path, EXISTS(
                    SELECT 1 FROM asset_refs o JOIN documents d ON d.id = o.document_id
                    WHERE o.rel_path = a.rel_path AND d.source_id = ?1 AND o.document_id != ?2
                 ) FROM asset_refs a WHERE a.document_id = ?2",
            )
            .bind(&source_id)
            .bind(&doc_id)
            .fetch_all(&app_data.db)
            .await
            .map_err(OpError::from)?;
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
        carry_assets(&root, &dest_source, &assets).map_err(OpError::from)?;
    }

    Ok(())
}

fn carry_assets(root: &Path, dest_root: &Path, assets: &[(String, bool)]) -> std::io::Result<()> {
    for (rel_path, shared) in assets {
        let Ok(src) = resolve_in_source(root, rel_path) else {
            continue;
        };
        if !src.is_file() {
            continue;
        }
        let dest = resolve_in_source(dest_root, rel_path)?;
        if dest.exists() {
            continue;
        }
        if *shared {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&src, &dest)?;
        } else {
            move_file(&src, &dest)?;
        }
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
) -> Result<bool, OpError> {
    let root = root_of(&app, &source_id)?;
    let full_path = resolve_in_source(&root, &rel_path).map_err(OpError::from)?;

    if full_path.exists() {
        super::to_trash(&full_path)?;
    }
    let Some(id) = id else {
        return Ok(false);
    };

    if history_dir(&root, &id).is_dir() || sidecar::exists(&root, &id) {
        sqlx::query("UPDATE documents SET deleted_at = ?1 WHERE id = ?2 AND source_id = ?3")
            .bind(chrono::Utc::now().timestamp_millis())
            .bind(&id)
            .bind(&source_id)
            .execute(&app_data.db)
            .await
            .map_err(OpError::from)?;
        return Ok(true);
    }

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

    Ok(false)
}

#[cfg(test)]
mod carry_assets_tests {
    use super::carry_assets;
    use std::fs;

    #[test]
    fn moves_sole_refs_and_copies_shared_ones() {
        let tmp = std::env::temp_dir().join(format!("ls-carry-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let a = tmp.join("a");
        let b = tmp.join("b");
        fs::create_dir_all(a.join("assets")).unwrap();
        fs::create_dir_all(b.join("assets")).unwrap();
        fs::write(a.join("assets/sole.png"), b"sole").unwrap();
        fs::write(a.join("assets/shared.png"), b"shared").unwrap();
        fs::write(a.join("assets/taken.png"), b"mine").unwrap();
        fs::write(b.join("assets/taken.png"), b"theirs").unwrap();

        carry_assets(
            &a,
            &b,
            &[
                ("assets/sole.png".into(), false),
                ("assets/shared.png".into(), true),
                ("assets/taken.png".into(), false),
                ("assets/missing.png".into(), false),
            ],
        )
        .unwrap();

        assert!(!a.join("assets/sole.png").exists());
        assert_eq!(fs::read(b.join("assets/sole.png")).unwrap(), b"sole");
        assert_eq!(fs::read(a.join("assets/shared.png")).unwrap(), b"shared");
        assert_eq!(fs::read(b.join("assets/shared.png")).unwrap(), b"shared");
        assert_eq!(fs::read(a.join("assets/taken.png")).unwrap(), b"mine");
        assert_eq!(fs::read(b.join("assets/taken.png")).unwrap(), b"theirs");
        let _ = fs::remove_dir_all(&tmp);
    }
}
