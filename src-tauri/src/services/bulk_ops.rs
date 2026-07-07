//! Bulk frontmatter ops on across documents
//! e.g.:
//!
//! - um view prop renames and deletion, non-present assumes default val so not needed often on
//! creation
//! - eventually renames to fix wikilinks between docs (todo)
//!
//! Basically:
//! 1. The DB index updates in one statement (instant view feedback),
//! 2. the matching files have their frontmatter rewritten in parallel afterwards
//!
//! Structural ops (rename, remove) are recorded to an on-disk journal (i.e. write-ahead)
//! so an interrupted op finishes on the next launch

use crate::services::frontmatter;
use crate::services::fs::atomic_write;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct BulkFailure {
    pub rel_path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BulkResult {
    pub touched: usize,
    pub failed: usize,
    pub failures: Vec<BulkFailure>,
    pub source_unreachable: bool,
}

fn classify_io(e: &std::io::Error) -> String {
    use std::io::ErrorKind;
    let kind = match e.kind() {
        ErrorKind::NotFound => "not_found",
        ErrorKind::PermissionDenied => "permission",
        ErrorKind::InvalidData => "invalid_data",
        _ => match e.raw_os_error() {
            Some(28) | Some(112) => "no_space",
            Some(32) | Some(33) => "locked",
            _ => "other",
        },
    };
    kind.to_string()
}

#[derive(Debug, Clone, Serialize)]
struct BulkProgress {
    done: usize,
    total: usize,
}

/// A resumable structural op, recoverable from these args
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum JournaledOp {
    SetViewField {
        source_id: String,
        view_slug: String,
        field_name: String,
        value: Value,
        doc_ids: Vec<String>,
    },
    RenameViewField {
        source_id: String,
        view_slug: String,
        old_name: String,
        new_name: String,
    },
    RemoveViewField {
        source_id: String,
        view_slug: String,
        field_name: String,
    },
    RenameViewOption {
        source_id: String,
        view_slug: String,
        field_name: String,
        old_value: String,
        new_value: String,
    },
    RenameView {
        source_id: String,
        old_slug: String,
        new_slug: String,
    },
}

impl JournaledOp {
    fn source_id(&self) -> &str {
        match self {
            JournaledOp::SetViewField { source_id, .. }
            | JournaledOp::RenameViewField { source_id, .. }
            | JournaledOp::RemoveViewField { source_id, .. }
            | JournaledOp::RenameViewOption { source_id, .. }
            | JournaledOp::RenameView { source_id, .. } => source_id,
        }
    }
}

// IMPORTANT: you get it, tick this up when the format changes and would break between updates
const JOURNAL_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Default)]
struct Journal {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    ops: Vec<JournaledOp>,
}

#[derive(Clone)]
pub struct BulkRunner {
    inner: Arc<Inner>,
}

struct Inner {
    journal_path: PathBuf,
    lock: Mutex<()>,
}

impl BulkRunner {
    pub fn new(journal_path: PathBuf) -> Self {
        Self {
            inner: Arc::new(Inner {
                journal_path,
                lock: Mutex::new(()),
            }),
        }
    }

    pub async fn set_view_field(
        &self,
        db: &SqlitePool,
        app: &AppHandle,
        source_id: &str,
        source_path: &Path,
        view_slug: &str,
        field_name: &str,
        value: Value,
        doc_ids: Vec<String>,
    ) -> Result<BulkResult, String> {
        validate_ident(view_slug, "view slug")?;
        validate_ident(field_name, "field name")?;
        if doc_ids.is_empty() {
            return Ok(BulkResult {
                touched: 0,
                failed: 0,
                failures: Vec::new(),
                source_unreachable: false,
            });
        }
        let op = JournaledOp::SetViewField {
            source_id: source_id.to_string(),
            view_slug: view_slug.to_string(),
            field_name: field_name.to_string(),
            value,
            doc_ids,
        };
        self.run_journaled(db, app, source_path, op).await
    }

    pub async fn rename_view_field(
        &self,
        db: &SqlitePool,
        app: &AppHandle,
        source_id: &str,
        source_path: &Path,
        view_slug: &str,
        old_name: &str,
        new_name: &str,
    ) -> Result<BulkResult, String> {
        validate_ident(view_slug, "view slug")?;
        validate_ident(old_name, "field name")?;
        validate_ident(new_name, "new field name")?;
        let op = JournaledOp::RenameViewField {
            source_id: source_id.to_string(),
            view_slug: view_slug.to_string(),
            old_name: old_name.to_string(),
            new_name: new_name.to_string(),
        };
        self.run_journaled(db, app, source_path, op).await
    }

    pub async fn remove_view_field(
        &self,
        db: &SqlitePool,
        app: &AppHandle,
        source_id: &str,
        source_path: &Path,
        view_slug: &str,
        field_name: &str,
    ) -> Result<BulkResult, String> {
        validate_ident(view_slug, "view slug")?;
        validate_ident(field_name, "field name")?;
        let op = JournaledOp::RemoveViewField {
            source_id: source_id.to_string(),
            view_slug: view_slug.to_string(),
            field_name: field_name.to_string(),
        };
        self.run_journaled(db, app, source_path, op).await
    }

    pub async fn rename_view(
        &self,
        db: &SqlitePool,
        app: &AppHandle,
        source_id: &str,
        source_path: &Path,
        old_slug: &str,
        new_slug: &str,
    ) -> Result<BulkResult, String> {
        validate_ident(old_slug, "view slug")?;
        validate_ident(new_slug, "new view slug")?;
        let op = JournaledOp::RenameView {
            source_id: source_id.to_string(),
            old_slug: old_slug.to_string(),
            new_slug: new_slug.to_string(),
        };
        self.run_journaled(db, app, source_path, op).await
    }

    pub async fn rename_view_option(
        &self,
        db: &SqlitePool,
        app: &AppHandle,
        source_id: &str,
        source_path: &Path,
        view_slug: &str,
        field_name: &str,
        old_value: &str,
        new_value: &str,
    ) -> Result<BulkResult, String> {
        validate_ident(view_slug, "view slug")?;
        validate_ident(field_name, "field name")?;
        let op = JournaledOp::RenameViewOption {
            source_id: source_id.to_string(),
            view_slug: view_slug.to_string(),
            field_name: field_name.to_string(),
            old_value: old_value.to_string(),
            new_value: new_value.to_string(),
        };
        self.run_journaled(db, app, source_path, op).await
    }

    async fn run_journaled(
        &self,
        db: &SqlitePool,
        app: &AppHandle,
        source_path: &Path,
        op: JournaledOp,
    ) -> Result<BulkResult, String> {
        let _guard = self.inner.lock.lock().await;
        self.journal_add(&op);
        let result = execute(db, app, source_path, &op).await;
        self.journal_remove(&op);
        result
    }

    /// Re-run journaled ops after interrupt
    pub async fn resume(
        &self,
        db: &SqlitePool,
        app: &AppHandle,
        source_paths: &HashMap<String, PathBuf>,
    ) {
        let ops = self.journal_read();
        for op in &ops {
            let Some(path) = source_paths.get(op.source_id()) else {
                continue;
            };
            let _guard = self.inner.lock.lock().await;
            match execute(db, app, path, op).await {
                Ok(result) if result.source_unreachable => {}
                Ok(_) => self.journal_remove(op),
                Err(e) => eprintln!("bulk resume failed: {e}"),
            }
        }
    }

    fn journal_read(&self) -> Vec<JournaledOp> {
        let journal: Journal = std::fs::read_to_string(&self.inner.journal_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if journal.version != JOURNAL_VERSION {
            return Vec::new();
        }
        journal.ops
    }

    fn journal_write(&self, ops: &[JournaledOp]) {
        let journal = Journal {
            version: JOURNAL_VERSION,
            ops: ops.to_vec(),
        };
        if let Ok(json) = serde_json::to_vec_pretty(&journal) {
            let _ = atomic_write(&self.inner.journal_path, &json);
        }
    }

    fn journal_add(&self, op: &JournaledOp) {
        let mut ops = self.journal_read();
        ops.push(op.clone());
        self.journal_write(&ops);
    }

    fn journal_remove(&self, op: &JournaledOp) {
        let mut ops = self.journal_read();
        ops.retain(|o| o != op);
        self.journal_write(&ops);
    }
}

async fn execute(
    db: &SqlitePool,
    app: &AppHandle,
    source_path: &Path,
    op: &JournaledOp,
) -> Result<BulkResult, String> {
    match op {
        JournaledOp::SetViewField {
            source_id,
            view_slug,
            field_name,
            value,
            doc_ids,
        } => {
            let path = json_path(view_slug, field_name);
            let placeholders = doc_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "UPDATE documents SET properties = json_set(properties, ?, json(?))
                 WHERE source_id = ? AND id IN ({placeholders})"
            );
            let mut q = sqlx::query(&sql)
                .bind(&path)
                .bind(serde_json::to_string(value).map_err(|e| e.to_string())?)
                .bind(source_id);
            for id in doc_ids {
                q = q.bind(id);
            }
            q.execute(db).await.map_err(|e| e.to_string())?;

            let rel_paths = fetch_paths_by_id(db, source_id, doc_ids).await?;
            let (slug, field, value) = (view_slug.clone(), field_name.clone(), value.clone());
            write_files(app, source_path, rel_paths, move |fm| {
                frontmatter::set_view_field(fm, &slug, &field, value.clone());
            })
            .await
        }
        JournaledOp::RenameViewField {
            source_id,
            view_slug,
            old_name,
            new_name,
        } => {
            let old_path = json_path(view_slug, old_name);
            let new_path = json_path(view_slug, new_name);
            let rel_paths = fetch_paths_with_field(db, source_id, &old_path).await?;
            sqlx::query(
                "UPDATE documents
                 SET properties = json_remove(json_set(properties, ?1, json_extract(properties, ?2)), ?2)
                 WHERE source_id = ?3 AND json_extract(properties, ?2) IS NOT NULL",
            )
            .bind(&new_path)
            .bind(&old_path)
            .bind(source_id)
            .execute(db)
            .await
            .map_err(|e| e.to_string())?;

            let (slug, from, to) = (view_slug.clone(), old_name.clone(), new_name.clone());
            write_files(app, source_path, rel_paths, move |fm| {
                frontmatter::rename_view_field(fm, &slug, &from, &to);
            })
            .await
        }
        JournaledOp::RemoveViewField {
            source_id,
            view_slug,
            field_name,
        } => {
            let path = json_path(view_slug, field_name);
            let rel_paths = fetch_paths_with_field(db, source_id, &path).await?;
            sqlx::query(
                "UPDATE documents
                 SET properties = json_remove(properties, ?1)
                 WHERE source_id = ?2 AND json_extract(properties, ?1) IS NOT NULL",
            )
            .bind(&path)
            .bind(source_id)
            .execute(db)
            .await
            .map_err(|e| e.to_string())?;

            let (slug, field) = (view_slug.clone(), field_name.clone());
            write_files(app, source_path, rel_paths, move |fm| {
                frontmatter::remove_view_field(fm, &slug, &field);
            })
            .await
        }
        JournaledOp::RenameViewOption {
            source_id,
            view_slug,
            field_name,
            old_value,
            new_value,
        } => {
            let path = json_path(view_slug, field_name);
            // candidates = the scalar equals the old value or an array contains it
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT id, rel_path FROM documents
                 WHERE source_id = ?1 AND deleted_at IS NULL
                   AND (json_extract(properties, ?2) = ?3
                        OR EXISTS (SELECT 1 FROM json_each(properties, ?2) WHERE value = ?3))",
            )
            .bind(source_id)
            .bind(&path)
            .bind(old_value)
            .fetch_all(db)
            .await
            .map_err(|e| e.to_string())?;

            let rel_paths: Vec<String> = rows.iter().map(|(_, p)| p.clone()).collect();
            sqlx::query(
                "UPDATE documents
                 SET properties = json_set(properties, ?1, ?2)
                 WHERE source_id = ?3 AND json_extract(properties, ?1) = ?4",
            )
            .bind(&path)
            .bind(new_value)
            .bind(source_id)
            .bind(old_value)
            .execute(db)
            .await
            .map_err(|e| e.to_string())?;

            let (slug, field, from, to) = (
                view_slug.clone(),
                field_name.clone(),
                old_value.clone(),
                new_value.clone(),
            );
            write_files(app, source_path, rel_paths, move |fm| {
                frontmatter::rename_view_option(fm, &slug, &field, &from, &to);
            })
            .await
        }
        JournaledOp::RenameView {
            source_id,
            old_slug,
            new_slug,
        } => {
            let old_path = json_view_path(old_slug);
            let new_path = json_view_path(new_slug);
            let rel_paths = fetch_paths_with_field(db, source_id, &old_path).await?;
            sqlx::query(
                "UPDATE documents
                 SET properties = json_remove(json_set(properties, ?1, json_extract(properties, ?2)), ?2)
                 WHERE source_id = ?3 AND json_extract(properties, ?2) IS NOT NULL",
            )
            .bind(&new_path)
            .bind(&old_path)
            .bind(source_id)
            .execute(db)
            .await
            .map_err(|e| e.to_string())?;

            let (from, to) = (old_slug.clone(), new_slug.clone());
            write_files(app, source_path, rel_paths, move |fm| {
                frontmatter::rename_view(fm, &from, &to);
            })
            .await
        }
    }
}

async fn write_files(
    app: &AppHandle,
    source_path: &Path,
    rel_paths: Vec<String>,
    mutate: impl Fn(&mut Value) + Send + Sync + 'static,
) -> Result<BulkResult, String> {
    let total = rel_paths.len();
    if total == 0 {
        return Ok(BulkResult {
            touched: 0,
            failed: 0,
            failures: Vec::new(),
            source_unreachable: false,
        });
    }
    let app = app.clone();
    let source_path = source_path.to_path_buf();

    tauri::async_runtime::spawn_blocking(move || {
        let done = AtomicUsize::new(0);
        let failures = std::sync::Mutex::new(Vec::<BulkFailure>::new());
        let step = (total / 50).max(50);

        rel_paths.par_iter().for_each(|rel| {
            match frontmatter::rewrite_frontmatter(&source_path.join(rel), &mutate) {
                Ok(()) => {
                    let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if n % step == 0 || n == total {
                        let _ = app.emit("bulk-progress", BulkProgress { done: n, total });
                    }
                }
                Err(e) => {
                    failures.lock().unwrap().push(BulkFailure {
                        rel_path: rel.clone(),
                        kind: classify_io(&e),
                    });
                }
            }
        });

        let failures = failures.into_inner().unwrap();
        let source_unreachable = !failures.is_empty() && std::fs::metadata(&source_path).is_err();
        BulkResult {
            touched: done.into_inner(),
            failed: failures.len(),
            failures,
            source_unreachable,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

async fn fetch_paths_with_field(
    db: &SqlitePool,
    source_id: &str,
    json_path: &str,
) -> Result<Vec<String>, String> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT rel_path FROM documents
         WHERE source_id = ? AND deleted_at IS NULL AND json_extract(properties, ?) IS NOT NULL",
    )
    .bind(source_id)
    .bind(json_path)
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

async fn fetch_paths_by_id(
    db: &SqlitePool,
    source_id: &str,
    doc_ids: &[String],
) -> Result<Vec<String>, String> {
    if doc_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = doc_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT rel_path FROM documents
         WHERE source_id = ? AND deleted_at IS NULL AND id IN ({placeholders})"
    );
    let mut q = sqlx::query_as::<_, (String,)>(&sql).bind(source_id);
    for id in doc_ids {
        q = q.bind(id);
    }
    let rows = q.fetch_all(db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

fn json_path(view_slug: &str, field: &str) -> String {
    format!("$.views.\"{view_slug}\".\"{field}\"")
}

fn json_view_path(view_slug: &str) -> String {
    format!("$.views.\"{view_slug}\"")
}

fn validate_ident(s: &str, what: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err(format!("{what} is empty"));
    }
    if s.chars()
        .any(|c| c == '.' || c == '"' || c == '\'' || c == '\\' || c.is_control())
    {
        return Err(format!("{what} has unsafe characters: {s}"));
    }
    Ok(())
}
