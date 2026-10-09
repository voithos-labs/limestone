use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::commands::source_commands::find_source;
use crate::services::fs::atomic_write;
use crate::services::Source;

const GITIGNORE: &[u8] = b"history/\n";

fn component_ok(c: &str) -> bool {
    !c.is_empty()
        && c.len() <= 128
        && c != "."
        && c != ".."
        && c.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}

fn history_root(source_path: &Path) -> PathBuf {
    source_path.join(".limestone").join("history")
}

fn source_root(app: &AppHandle, source_id: &str) -> Result<PathBuf, String> {
    let id = Uuid::parse_str(source_id).map_err(|e| e.to_string())?;
    let source = find_source(app, id)?;
    if !source.path.is_dir() {
        return Err("source unavailable".to_string());
    }
    Ok(source.path)
}

fn doc_dir(app: &AppHandle, source_id: &str, doc_id: &str) -> Result<PathBuf, String> {
    if !component_ok(doc_id) {
        return Err(format!("invalid history doc id: {doc_id:?}"));
    }
    Ok(history_root(&source_root(app, source_id)?).join(doc_id))
}

fn ensure_writable(source_path: &Path) -> Result<(), String> {
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
) -> Result<Vec<String>, String> {
    let dir = doc_dir(&app, &source_id, &doc_id)?;
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
    hash: String,
    data: String,
) -> Result<(), String> {
    if !component_ok(&hash) {
        return Err(format!("invalid history change hash: {hash:?}"));
    }
    let source_path = source_root(&app, &source_id)?;
    ensure_writable(&source_path)?;
    let path = doc_dir(&app, &source_id, &doc_id)?.join(hash);
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_remove(app: AppHandle, source_id: String, doc_id: String) -> Result<(), String> {
    let dir = doc_dir(&app, &source_id, &doc_id)?;
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
    let from = doc_dir(&app, &source_id, &doc_id)?;
    if !from.is_dir() {
        return Ok(());
    }
    let to = doc_dir(&app, &new_source_id, &doc_id)?;
    ensure_writable(&source_root(&app, &new_source_id)?)?;
    move_dir(&from, &to).map_err(|e| e.to_string())
}

#[derive(serde::Serialize, Clone)]
pub(crate) struct HistoryOrphan {
    pub doc_id: String,
    pub source_id: String,
    pub holder_source_id: String,
}

pub(crate) async fn sweep_orphans(app: &AppHandle, pool: &sqlx::SqlitePool, source: &Source) {
    let Ok(entries) = fs::read_dir(history_root(&source.path)) else {
        return;
    };
    let source_id = source.id.to_string();
    let own: HashSet<String> =
        match sqlx::query_scalar("SELECT id FROM documents WHERE source_id = ?1")
            .bind(&source_id)
            .fetch_all(pool)
            .await
        {
            Ok(ids) => ids.into_iter().collect(),
            Err(e) => {
                eprintln!("history sweep failed: {e}");
                return;
            }
        };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let doc_id = entry.file_name().to_string_lossy().into_owned();
        if own.contains(&doc_id) {
            continue;
        }
        let holder: Option<String> =
            sqlx::query_scalar("SELECT source_id FROM documents WHERE id = ?1")
                .bind(&doc_id)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten();
        if let Some(holder_source_id) = holder {
            let _ = app.emit(
                "history-orphan",
                HistoryOrphan {
                    doc_id,
                    source_id: source_id.clone(),
                    holder_source_id,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::move_dir;
    use std::fs;

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
