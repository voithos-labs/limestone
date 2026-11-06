use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::commands::source_commands::find_source;
use crate::services::fs::{
    atomic_write, history_dir, history_path_dir, history_path_key, history_root, HISTORY_BY_PATH,
};
use crate::services::{read_frontmatter, Source};

pub(crate) const DELETED_RETENTION_DAYS: &str = "sources.deleted_retention_days";

const GITIGNORE: &[u8] = b"history/\n";

fn component_ok(c: &str) -> bool {
    !c.is_empty()
        && c.len() <= 128
        && c != "."
        && c != ".."
        && c.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}

fn source_root(app: &AppHandle, source_id: &str) -> Result<PathBuf, String> {
    let id = Uuid::parse_str(source_id).map_err(|e| e.to_string())?;
    let source = find_source(app, id)?;
    if !source.path.is_dir() {
        return Err("source unavailable".to_string());
    }
    Ok(source.path)
}

fn file_claims(root: &Path, rel_path: &str, doc_id: &str) -> bool {
    read_frontmatter(&root.join(rel_path), 1024)
        .and_then(|fm| Some(fm.get("id")?.as_str()? == doc_id))
        .unwrap_or(false)
}

fn resolve_dir(root: &Path, doc_id: &str, rel_path: Option<&str>) -> PathBuf {
    let by_id = history_dir(root, doc_id);
    let Some(rel) = rel_path else {
        return by_id;
    };
    if by_id.is_dir() {
        return by_id;
    }
    let by_path = history_path_dir(root, rel);
    if !file_claims(root, rel, doc_id) {
        return by_path;
    }
    if by_path.is_dir() {
        let _ = move_dir(&by_path, &by_id);
    }
    by_id
}

fn doc_dir(
    app: &AppHandle,
    source_id: &str,
    doc_id: &str,
    rel_path: Option<&str>,
) -> Result<PathBuf, String> {
    if !component_ok(doc_id) {
        return Err(format!("invalid history doc id: {doc_id:?}"));
    }
    Ok(resolve_dir(&source_root(app, source_id)?, doc_id, rel_path))
}

pub(crate) fn move_path_history(
    old_root: &Path,
    old_rel: &str,
    new_root: &Path,
    new_rel: &str,
) -> std::io::Result<()> {
    let from = history_path_dir(old_root, old_rel);
    if !from.is_dir() {
        return Ok(());
    }
    move_dir(&from, &history_path_dir(new_root, new_rel))
}

pub(crate) fn move_id_history(
    old_root: &Path,
    new_root: &Path,
    doc_id: &str,
) -> std::io::Result<()> {
    let from = history_dir(old_root, doc_id);
    if old_root == new_root || !from.is_dir() {
        return Ok(());
    }
    move_dir(&from, &history_dir(new_root, doc_id))
}

pub(crate) fn ensure_writable(source_path: &Path) -> Result<(), String> {
    let ignore = source_path.join(".limestone").join(".gitignore");
    if !ignore.exists() {
        atomic_write(&ignore, GITIGNORE).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn move_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            fs::copy(entry.path(), to.join(entry.file_name()))?;
        }
    }
    fs::remove_dir_all(from)
}

#[tauri::command]
pub fn history_load(
    app: AppHandle,
    source_id: String,
    doc_id: String,
    rel_path: Option<String>,
) -> Result<Vec<String>, String> {
    let dir = doc_dir(&app, &source_id, &doc_id, rel_path.as_deref())?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        out.push(B64.encode(fs::read(entry.path()).map_err(|e| e.to_string())?));
    }
    Ok(out)
}

#[tauri::command]
pub fn history_append(
    app: AppHandle,
    source_id: String,
    doc_id: String,
    rel_path: Option<String>,
    hash: String,
    data: String,
) -> Result<(), String> {
    if !component_ok(&hash) {
        return Err(format!("invalid history change hash: {hash:?}"));
    }
    let source_path = source_root(&app, &source_id)?;
    ensure_writable(&source_path)?;
    let path = doc_dir(&app, &source_id, &doc_id, rel_path.as_deref())?.join(hash);
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_remove(
    app: AppHandle,
    source_id: String,
    doc_id: String,
    rel_path: Option<String>,
) -> Result<(), String> {
    let dir = doc_dir(&app, &source_id, &doc_id, rel_path.as_deref())?;
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
    if source_id == new_source_id {
        return Ok(());
    }
    let from = doc_dir(&app, &source_id, &doc_id, None)?;
    if !from.is_dir() {
        return Ok(());
    }
    let to = doc_dir(&app, &new_source_id, &doc_id, None)?;
    ensure_writable(&source_root(&app, &new_source_id)?)?;
    move_dir(&from, &to).map_err(|e| e.to_string())
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
    if !component_ok(doc_id) {
        return Err(format!("invalid history doc id: {doc_id:?}"));
    }
    match fs::remove_dir_all(history_dir(source_path, doc_id)) {
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

pub(crate) async fn sweep_orphans(app: &AppHandle, pool: &sqlx::SqlitePool, source: &Source) {
    let Ok(entries) = fs::read_dir(history_root(&source.path)) else {
        return;
    };
    let source_id = source.id.to_string();
    let rows: Vec<(String, String)> =
        match sqlx::query_as("SELECT id, rel_path FROM documents WHERE source_id = ?1")
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
    let own: HashSet<&str> = rows.iter().map(|(id, _)| id.as_str()).collect();
    let path_keys: HashSet<String> = rows
        .iter()
        .map(|(_, rel)| history_path_key(rel))
        .collect();
    if let Ok(keyed) = fs::read_dir(history_root(&source.path).join(HISTORY_BY_PATH)) {
        for entry in keyed.flatten() {
            if !path_keys.contains(&*entry.file_name().to_string_lossy()) {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let doc_id = entry.file_name().to_string_lossy().into_owned();
        if doc_id == HISTORY_BY_PATH || own.contains(doc_id.as_str()) {
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
    use super::{move_dir, move_path_history, resolve_dir};
    use crate::services::fs::{history_dir, history_path_dir};
    use std::fs;
    use std::path::PathBuf;

    fn sandbox(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("ls-history-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn history_key_follows_the_file_id_then_the_path() {
        let root = sandbox("key");
        fs::write(root.join("plain.md"), "hello").unwrap();
        fs::write(root.join("claimed.md"), "---\nid: doc-1\n---\nhello").unwrap();

        assert_eq!(
            resolve_dir(&root, "doc-0", Some("plain.md")),
            history_path_dir(&root, "plain.md")
        );
        assert_eq!(
            resolve_dir(&root, "doc-1", Some("claimed.md")),
            history_dir(&root, "doc-1")
        );
        assert_eq!(
            resolve_dir(&root, "doc-2", Some("claimed.md")),
            history_path_dir(&root, "claimed.md")
        );
        assert_eq!(resolve_dir(&root, "doc-0", None), history_dir(&root, "doc-0"));

        fs::create_dir_all(history_dir(&root, "doc-0")).unwrap();
        assert_eq!(
            resolve_dir(&root, "doc-0", Some("plain.md")),
            history_dir(&root, "doc-0")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn path_history_migrates_once_the_file_carries_its_id() {
        let root = sandbox("migrate");
        fs::write(root.join("n.md"), "hello").unwrap();
        let by_path = history_path_dir(&root, "n.md");
        fs::create_dir_all(&by_path).unwrap();
        fs::write(by_path.join("h1"), b"one").unwrap();

        fs::write(root.join("n.md"), "---\nid: doc-9\n---\nhello").unwrap();
        assert_eq!(
            resolve_dir(&root, "doc-9", Some("n.md")),
            history_dir(&root, "doc-9")
        );
        assert!(!by_path.exists());
        assert_eq!(
            fs::read(history_dir(&root, "doc-9").join("h1")).unwrap(),
            b"one"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn path_history_moves_with_a_rename_and_ignores_case() {
        let root = sandbox("rename");
        let from = history_path_dir(&root, "old.md");
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("h1"), b"one").unwrap();

        move_path_history(&root, "old.md", &root, "sub/new.md").unwrap();
        assert!(!from.exists());
        assert_eq!(
            fs::read(history_path_dir(&root, "Sub/NEW.md").join("h1")).unwrap(),
            b"one"
        );
        move_path_history(&root, "nothing.md", &root, "x.md").unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_dir_carries_every_change_and_removes_the_old_dir() {
        let tmp = std::env::temp_dir().join(format!("ls-history-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let from = tmp.join("a/.limestone/history/doc");
        let to = tmp.join("b/.limestone/history/doc");
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("h1"), b"one").unwrap();
        fs::write(from.join("h2"), b"two").unwrap();

        move_dir(&from, &to).unwrap();

        assert!(!from.exists());
        assert_eq!(fs::read(to.join("h1")).unwrap(), b"one");
        assert_eq!(fs::read(to.join("h2")).unwrap(), b"two");
        let _ = fs::remove_dir_all(&tmp);
    }
}
