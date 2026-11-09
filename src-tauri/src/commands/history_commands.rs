use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::commands::source_commands::find_source;
use crate::services::fs::{
    atomic_write, doc_dir, docs_root, move_dir, write_meta, DocMeta, META_FILE,
};
use crate::services::Source;
use crate::AppData;

pub(crate) const DELETED_RETENTION_DAYS: &str = "sources.deleted_retention_days";

const GITIGNORE: &[u8] = b"docs/\n";

fn component_ok(c: &str) -> bool {
    !c.is_empty()
        && c.len() <= 128
        && c != "."
        && c != ".."
        && c.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}

fn is_chunk(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit())
}

fn source_root(app: &AppHandle, source_id: &str) -> Result<PathBuf, String> {
    let id = Uuid::parse_str(source_id).map_err(|e| e.to_string())?;
    let source = find_source(app, id)?;
    if !source.path.is_dir() {
        return Err("source unavailable".to_string());
    }
    Ok(source.path)
}

fn dir_of(root: &Path, doc_id: &str) -> Result<PathBuf, String> {
    if !component_ok(doc_id) {
        return Err(format!("invalid history doc id: {doc_id:?}"));
    }
    Ok(doc_dir(root, doc_id))
}

pub(crate) fn ensure_writable(source_path: &Path) -> Result<(), String> {
    let ignore = source_path.join(".limestone").join(".gitignore");
    if fs::read(&ignore).is_ok_and(|current| current == GITIGNORE) {
        return Ok(());
    }
    atomic_write(&ignore, GITIGNORE).map_err(|e| e.to_string())
}

pub(crate) fn move_doc_dir(old_root: &Path, new_root: &Path, doc_id: &str) -> std::io::Result<()> {
    let from = doc_dir(old_root, doc_id);
    if old_root == new_root || !from.is_dir() {
        return Ok(());
    }
    move_dir(&from, &doc_dir(new_root, doc_id))
}

#[tauri::command]
pub fn history_load(
    app: AppHandle,
    source_id: String,
    doc_id: String,
) -> Result<Vec<String>, String> {
    let dir = dir_of(&source_root(&app, &source_id)?, &doc_id)?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !is_chunk(&entry.file_name().to_string_lossy()) {
            continue;
        }
        out.push(B64.encode(fs::read(entry.path()).map_err(|e| e.to_string())?));
    }
    Ok(out)
}

#[tauri::command]
pub async fn history_append(
    app_data: State<'_, AppData>,
    app: AppHandle,
    source_id: String,
    doc_id: String,
    hash: String,
    data: String,
) -> Result<(), String> {
    if !is_chunk(&hash) {
        return Err(format!("invalid history change hash: {hash:?}"));
    }
    let root = source_root(&app, &source_id)?;
    ensure_writable(&root)?;
    let dir = dir_of(&root, &doc_id)?;
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&dir.join(hash), &bytes).map_err(|e| e.to_string())?;
    if !dir.join(META_FILE).exists() {
        let row: Option<(String, i64)> =
            sqlx::query_as("SELECT rel_path, created_at FROM documents WHERE id = ?1")
                .bind(&doc_id)
                .fetch_optional(&app_data.db)
                .await
                .map_err(|e| e.to_string())?;
        if let Some((rel_path, created_at)) = row {
            let meta = DocMeta {
                rel_path,
                created_at,
            };
            write_meta(&dir, &meta).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn history_remove(app: AppHandle, source_id: String, doc_id: String) -> Result<(), String> {
    let dir = dir_of(&source_root(&app, &source_id)?, &doc_id)?;
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn history_move(
    app: AppHandle,
    source_id: String,
    new_source_id: String,
    doc_id: String,
) -> Result<(), String> {
    if !component_ok(&doc_id) {
        return Err(format!("invalid history doc id: {doc_id:?}"));
    }
    let new_root = source_root(&app, &new_source_id)?;
    ensure_writable(&new_root)?;
    move_doc_dir(&source_root(&app, &source_id)?, &new_root, &doc_id).map_err(|e| e.to_string())
}

#[derive(serde::Serialize, Clone)]
pub(crate) struct HistoryOrphan {
    pub doc_id: String,
    pub source_id: String,
    pub holder_source_id: String,
}

#[derive(serde::Serialize, Clone)]
pub(crate) struct HistoryDeleted {
    pub doc_id: String,
    pub source_id: String,
    pub deleted_at: i64,
}

fn newest_change_ms(dir: &Path) -> i64 {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.metadata().ok()?.modified().ok())
        .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .max()
        .unwrap_or(0)
}

fn retention_days(app: &AppHandle) -> i64 {
    let app_data = app.state::<crate::AppData>();
    let settings = app_data.settings.read().unwrap();
    crate::services::dot_get(&settings, DELETED_RETENTION_DAYS)
        .and_then(|v| v.as_i64())
        .unwrap_or(30)
}

pub(crate) async fn sweep_expired(app: &AppHandle, pool: &sqlx::SqlitePool, source: &Source) {
    let days = retention_days(app);
    if days <= 0 {
        return;
    }
    let cutoff = chrono::Utc::now().timestamp_millis() - days * 24 * 60 * 60 * 1000;
    let expired: Vec<String> = match sqlx::query_scalar(
        "SELECT id FROM documents WHERE source_id = ?1 AND deleted_at < ?2",
    )
    .bind(source.id.to_string())
    .bind(cutoff)
    .fetch_all(pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            eprintln!("deleted sweep failed: {e}");
            return;
        }
    };
    for id in expired {
        if let Err(e) = purge_row(pool, &source.path, &id).await {
            eprintln!("purge failed for {id}: {e}");
        }
    }
}

pub(crate) async fn purge_row(
    pool: &sqlx::SqlitePool,
    source_path: &Path,
    doc_id: &str,
) -> Result<(), String> {
    match fs::remove_dir_all(dir_of(source_path, doc_id)?) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "DELETE FROM documents_fts WHERE rowid = (SELECT rowid FROM documents WHERE id = ?1)",
    )
    .bind(doc_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM documents WHERE id = ?1 AND deleted_at IS NOT NULL")
        .bind(doc_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

const LEGACY_PATH_KEY_NAMESPACE: Uuid = Uuid::from_u128(0x6c696d6573746f6e652d686973746f72);

fn legacy_path_key(rel_path: &str) -> String {
    Uuid::new_v5(
        &LEGACY_PATH_KEY_NAMESPACE,
        rel_path.to_lowercase().as_bytes(),
    )
    .to_string()
}

fn migrate_layout(root: &Path, rows: &[(String, String, i64)]) {
    let docs = docs_root(root);
    let legacy = root.join(".limestone").join("history");
    if legacy.is_dir() && fs::rename(&legacy, &docs).is_err() {
        for entry in fs::read_dir(&legacy).into_iter().flatten().flatten() {
            let _ = move_dir(&entry.path(), &docs.join(entry.file_name()));
        }
        let _ = fs::remove_dir_all(&legacy);
    }
    let by_path = docs.join("by-path");
    if !by_path.is_dir() {
        return;
    }
    for (id, rel_path, _) in rows {
        let keyed = by_path.join(legacy_path_key(rel_path));
        if keyed.is_dir() {
            let _ = move_dir(&keyed, &doc_dir(root, id));
        }
    }
    let _ = fs::remove_dir_all(&by_path);
}

pub(crate) async fn sweep_orphans(app: &AppHandle, pool: &sqlx::SqlitePool, source: &Source) {
    let source_id = source.id.to_string();
    let rows: Vec<(String, String, i64)> =
        match sqlx::query_as("SELECT id, rel_path, created_at FROM documents WHERE source_id = ?1")
            .bind(&source_id)
            .fetch_all(pool)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                eprintln!("history sweep failed: {e}");
                return;
            }
        };
    migrate_layout(&source.path, &rows);
    let Ok(entries) = fs::read_dir(docs_root(&source.path)) else {
        return;
    };
    let own: HashMap<&str, (&str, i64)> = rows
        .iter()
        .map(|(id, rel, created)| (id.as_str(), (rel.as_str(), *created)))
        .collect();
    for entry in entries.flatten() {
        let doc_id = entry.file_name().to_string_lossy().into_owned();
        if Uuid::parse_str(&doc_id).is_err() || !entry.path().is_dir() {
            continue;
        }
        if let Some((rel_path, created_at)) = own.get(doc_id.as_str()) {
            // todo: switch to lazy-write (meta.json) for 1.0
            if !entry.path().join(META_FILE).exists() {
                let meta = DocMeta {
                    rel_path: rel_path.to_string(),
                    created_at: *created_at,
                };
                let _ = write_meta(&entry.path(), &meta);
            }
            continue;
        }
        let holder: Option<String> =
            sqlx::query_scalar("SELECT source_id FROM documents WHERE id = ?1")
                .bind(&doc_id)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten();
        match holder {
            Some(holder_source_id) => {
                let _ = app.emit(
                    "history-orphan",
                    HistoryOrphan {
                        doc_id,
                        source_id: source_id.clone(),
                        holder_source_id,
                    },
                );
            }
            None => {
                let deleted_at = newest_change_ms(&entry.path());
                let _ = app.emit(
                    "history-deleted",
                    HistoryDeleted {
                        doc_id,
                        source_id: source_id.clone(),
                        deleted_at,
                    },
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{legacy_path_key, migrate_layout};
    use crate::services::fs::doc_dir;
    use std::fs;
    use std::path::PathBuf;

    fn sandbox(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("ls-history-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn legacy_history_folds_into_docs_and_by_path_joins_its_row() {
        let root = sandbox("migrate");
        let legacy = root.join(".limestone").join("history");
        fs::create_dir_all(legacy.join("doc-1")).unwrap();
        fs::write(legacy.join("doc-1").join("h1"), b"one").unwrap();
        let keyed = legacy.join("by-path").join(legacy_path_key("Sub/N.md"));
        fs::create_dir_all(&keyed).unwrap();
        fs::write(keyed.join("h2"), b"two").unwrap();
        let stale = legacy.join("by-path").join(legacy_path_key("gone.md"));
        fs::create_dir_all(&stale).unwrap();

        let rows = vec![
            ("doc-1".to_string(), "a.md".to_string(), 1),
            ("doc-2".to_string(), "sub/n.md".to_string(), 2),
        ];
        migrate_layout(&root, &rows);

        assert!(!legacy.exists());
        assert_eq!(
            fs::read(doc_dir(&root, "doc-1").join("h1")).unwrap(),
            b"one"
        );
        assert_eq!(
            fs::read(doc_dir(&root, "doc-2").join("h2")).unwrap(),
            b"two"
        );
        assert!(!root.join(".limestone/docs/by-path").exists());

        migrate_layout(&root, &rows);
        assert_eq!(
            fs::read(doc_dir(&root, "doc-1").join("h1")).unwrap(),
            b"one"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
