use super::JsonSettingsStore;
use chrono::prelude::{DateTime, Utc};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;
use uuid::Uuid;

#[derive(Deserialize, Serialize, Clone)]
pub struct Source {
    pub title: String,
    pub path: PathBuf,
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub accessed_at: DateTime<Utc>,
}

impl Source {
    pub fn new(title: String, path: PathBuf) -> Self {
        let now = Utc::now();
        Self {
            title,
            path,
            id: Uuid::new_v4(),
            created_at: now,
            accessed_at: now,
        }
    }
}

#[derive(Deserialize, Serialize, Default)]
pub struct Sources {
    #[serde(default)]
    pub sources: Vec<Source>,
}

pub fn open_source(app: &AppHandle, app_data: &crate::AppData, mut source: Source) {
    // Allow access to new source
    // Note: previously opened sources remain accessible until app restart (no way to remove perm)
    let _ = app.fs_scope().allow_directory(&source.path, true);

    let source_path = source.path.clone();
    source.accessed_at = Utc::now();
    *app_data.active_source.lock().unwrap() = Some(source);

    let merged = JsonSettingsStore::for_app(app, Some(&source_path)).load_merged();
    *app_data.settings.write().unwrap() = merged;
}

pub fn create_source(title: Option<String>, path: PathBuf) -> Result<Source, std::io::Error> {
    fs::create_dir_all(&path)?;
    let title = title.unwrap_or_else(|| {
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });

    let ignore_path = path.join(".limestoneignore");
    if !ignore_path.exists() {
        let _ = fs::write(
            &ignore_path,
            "# directories\n.limestone/\nassets/\n\n# dotfiles\n.*\n",
        );
    }

    Ok(Source::new(title, path))
}

// ---------------------
// Reconciliation types
// ---------------------

const KNOWN_FM_KEYS: &[&str] = &["id", "tags", "created_at", "updated_at", "accessed_at"];

/// extract everything outside known keys as a json string
pub fn fm_properties(fm: &serde_json::Value) -> String {
    match fm.as_object() {
        Some(map) => {
            let props: serde_json::Map<String, serde_json::Value> = map
                .iter()
                .filter(|(k, _)| !KNOWN_FM_KEYS.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            serde_json::to_string(&props).unwrap_or_default()
        }
        None => "{}".to_string(),
    }
}

#[derive(Debug)]
pub struct ReconciliationDiff {
    pub unchanged: Vec<String>,
    pub modified: Vec<(String, i64)>,
    pub new_paths: Vec<(String, i64)>,
    pub missing: Vec<String>,
}

#[derive(Debug)]
pub enum DbOperation {
    Insert {
        rel_path: String,
        mtime: i64,
        frontmatter: Option<serde_json::Value>,
    },
    UpdatePath {
        old_path: String,
        new_path: String,
        mtime: i64,
    },
    UpdateContent {
        rel_path: String,
        mtime: i64,
        frontmatter: Option<serde_json::Value>,
    },
    Delete {
        rel_path: String,
    },
}

// ── Source Scan ──────────────────────────────────────────────────────────────────────

/// Load .limestoneignore in source root
fn load_ignore_patterns(source_path: &Path) -> Option<globset::GlobSet> {
    let ignore_path = source_path.join(".limestoneignore");
    let content = fs::read_to_string(&ignore_path).ok()?;
    let mut builder = globset::GlobSetBuilder::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Ok(glob) = globset::GlobBuilder::new(line)
            .literal_separator(true)
            .build()
        {
            builder.add(glob);
        }
    }

    builder.build().ok()
}

/// Walk the source directory and collect (rel_path, mtime) for files w/ ignore
pub fn walk_source(source_path: &Path, extensions: &[&str]) -> Vec<(String, i64)> {
    let ignore = load_ignore_patterns(source_path);
    let mut entries = Vec::new();

    for entry in jwalk::WalkDir::new(source_path).sort(true) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        if !extensions
            .iter()
            .any(|&allowed| allowed.eq_ignore_ascii_case(ext))
        {
            continue;
        }

        let rel_path = match path.strip_prefix(source_path) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        if let Some(ref ignore) = ignore {
            if ignore.is_match(&rel_path) {
                continue;
            }
        }

        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        entries.push((rel_path, mtime));
    }

    entries
}

/// Diff fs and sqlite documents
pub fn diff_against_db(
    db_entries: &[(String, i64)],
    fs_entries: &[(String, i64)],
) -> ReconciliationDiff {
    let db_map: HashMap<&str, i64> = db_entries.iter().map(|(p, m)| (p.as_str(), *m)).collect();
    let fs_map: HashMap<&str, i64> = fs_entries.iter().map(|(p, m)| (p.as_str(), *m)).collect();

    let mut diff = ReconciliationDiff {
        unchanged: Vec::new(),
        modified: Vec::new(),
        new_paths: Vec::new(),
        missing: Vec::new(),
    };

    for (path, mtime) in fs_entries {
        match db_map.get(path.as_str()) {
            Some(&db_mtime) if db_mtime == *mtime => {
                diff.unchanged.push(path.clone());
            }
            Some(_) => {
                diff.modified.push((path.clone(), *mtime));
            }
            None => {
                diff.new_paths.push((path.clone(), *mtime));
            }
        }
    }

    for (path, _) in db_entries {
        if !fs_map.contains_key(path.as_str()) {
            diff.missing.push(path.clone());
        }
    }

    diff
}

/// Read first N bytes and parse frontmatter
pub fn extract_frontmatter(
    source_path: &Path,
    paths: &[String],
    buffer_size: usize,
) -> Vec<(String, Option<serde_json::Value>)> {
    paths
        .par_iter()
        .map(|rel_path| {
            let full_path = source_path.join(rel_path);
            let fm = read_frontmatter(&full_path, buffer_size);
            (rel_path.clone(), fm)
        })
        .collect()
}

fn read_frontmatter(path: &Path, buffer_size: usize) -> Option<serde_json::Value> {
    let mut file = fs::File::open(path).ok()?;
    let mut buf = vec![0u8; buffer_size];
    let n = file.read(&mut buf).ok()?;
    let content = std::str::from_utf8(&buf[..n]).ok()?;

    let content = content.trim_start();
    if !content.starts_with("---") {
        return None;
    }

    let after_open = &content[3..];
    let close = after_open.find("---")?;
    let yaml_str = &after_open[..close];

    serde_yml::from_str(yaml_str).ok()
}

/// Resolve changes to db from fs given diff
pub fn resolve_changes(
    diff: ReconciliationDiff,
    frontmatter: &[(String, Option<serde_json::Value>)],
    db_id_to_path: &HashMap<String, String>,
) -> Vec<DbOperation> {
    let mut ops = Vec::new();

    // Build lookup
    let fm_map: HashMap<&str, &(String, Option<serde_json::Value>)> = frontmatter
        .iter()
        .map(|entry| (entry.0.as_str(), entry))
        .collect();

    // New paths with extracted frontmatter
    let new_fm: HashMap<&str, Option<&serde_json::Value>> = diff
        .new_paths
        .iter()
        .map(|(p, _)| {
            let fm = fm_map.get(p.as_str()).and_then(|(_, fm)| fm.as_ref());
            (p.as_str(), fm)
        })
        .collect();

    // Track which missing paths were resolved as renames
    let mut resolved_missing: std::collections::HashSet<&str> = std::collections::HashSet::new();

    // Handle new paths
    for (path, mtime) in &diff.new_paths {
        let fm = new_fm.get(path.as_str()).copied().flatten();

        if let Some(id) = fm.and_then(|f| f.get("id")).and_then(|v| v.as_str()) {
            if let Some(old_path) = db_id_to_path.get(id) {
                // ID exists in DB with different path -- rename
                if diff.missing.contains(old_path) {
                    resolved_missing.insert(old_path.as_str());
                    ops.push(DbOperation::UpdatePath {
                        old_path: old_path.clone(),
                        new_path: path.clone(),
                        mtime: *mtime,
                    });
                    continue;
                }
            }
        }

        ops.push(DbOperation::Insert {
            rel_path: path.clone(),
            mtime: *mtime,
            frontmatter: None,
        });
    }

    // Handle modified paths
    for (path, mtime) in &diff.modified {
        ops.push(DbOperation::UpdateContent {
            rel_path: path.clone(),
            mtime: *mtime,
            frontmatter: None,
        });
    }

    // Handle missing paths not resolved as renames
    for path in &diff.missing {
        if !resolved_missing.contains(path.as_str()) {
            ops.push(DbOperation::Delete {
                rel_path: path.clone(),
            });
        }
    }

    ops
}

/// Apply all ops
pub async fn apply_operations(
    operations: &[DbOperation],
    frontmatter: &[(String, Option<serde_json::Value>)],
    source_id: &str,
    db: &SqlitePool,
) -> sqlx::Result<()> {
    let fm_map: HashMap<&str, Option<&serde_json::Value>> = frontmatter
        .iter()
        .map(|(p, fm)| (p.as_str(), fm.as_ref()))
        .collect();

    let mut tx = db.begin().await?;

    for op in operations {
        match op {
            DbOperation::Insert {
                rel_path, mtime, ..
            } => {
                // todo: this is ugly, might want a document struct to work around for this
                let fm = fm_map.get(rel_path.as_str()).copied().flatten();
                let doc_id = fm
                    .and_then(|f| f.get("id"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                let title = Path::new(rel_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled");
                let properties = fm.map(fm_properties).unwrap_or_else(|| "{}".to_string());
                let created_at = fm
                    .and_then(|f| f.get("created_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let updated_at = fm
                    .and_then(|f| f.get("updated_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let accessed_at = fm
                    .and_then(|f| f.get("accessed_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                sqlx::query(
                    "INSERT INTO documents (id, source_id, rel_path, title, mtime, properties, created_at, updated_at, accessed_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, coalesce(?7, datetime('now')), coalesce(?8, datetime('now')), coalesce(?9, datetime('now')))",
                )
                .bind(&doc_id)
                .bind(source_id)
                .bind(rel_path)
                .bind(title)
                .bind(mtime)
                .bind(&properties)
                .bind(&created_at)
                .bind(&updated_at)
                .bind(&accessed_at)
                .execute(&mut *tx)
                .await?;

                // Sync tags
                if let Some(fm) = fm {
                    let tags: Vec<String> = fm
                        .get("tags")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    sync_tags(&mut tx, source_id, &doc_id, &tags).await?;
                }
            }

            DbOperation::UpdatePath {
                old_path,
                new_path,
                mtime,
            } => {
                sqlx::query(
                    "UPDATE documents SET rel_path = ?1, mtime = ?2, updated_at = datetime('now') WHERE source_id = ?3 AND rel_path = ?4",
                )
                .bind(new_path)
                .bind(mtime)
                .bind(source_id)
                .bind(old_path)
                .execute(&mut *tx)
                .await?;
            }

            DbOperation::UpdateContent {
                rel_path, mtime, ..
            } => {
                let fm = fm_map.get(rel_path.as_str()).copied().flatten();
                let properties = fm.map(fm_properties).unwrap_or_else(|| "{}".to_string());
                let updated_at = fm
                    .and_then(|f| f.get("updated_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let accessed_at = fm
                    .and_then(|f| f.get("accessed_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                sqlx::query(
                    "UPDATE documents SET mtime = ?1, properties = ?2, updated_at = coalesce(?3, datetime('now')), accessed_at = coalesce(?4, datetime('now'))
                     WHERE source_id = ?5 AND rel_path = ?6",
                )
                .bind(mtime)
                .bind(&properties)
                .bind(&updated_at)
                .bind(&accessed_at)
                .bind(source_id)
                .bind(rel_path)
                .execute(&mut *tx)
                .await?;

                // Re-sync tags
                if let Some(fm) = fm {
                    let tags: Vec<String> = fm
                        .get("tags")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    let doc_id: Option<String> = sqlx::query_scalar(
                        "SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2",
                    )
                    .bind(source_id)
                    .bind(rel_path)
                    .fetch_optional(&mut *tx)
                    .await?;
                    if let Some(doc_id) = doc_id {
                        sync_tags(&mut tx, source_id, &doc_id, &tags).await?;
                    }
                }
            }

            DbOperation::Delete { rel_path } => {
                sqlx::query("DELETE FROM documents WHERE source_id = ?1 AND rel_path = ?2")
                    .bind(source_id)
                    .bind(rel_path)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }

    tx.commit().await
}

/// Sync tags from frontmatter into groups
async fn sync_tags(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_id: &str,
    doc_id: &str,
    tags: &[String],
) -> sqlx::Result<()> {
    // Clear existing tag associations for this document
    sqlx::query(
        "DELETE FROM document_groups WHERE document_id = ?1 AND group_id IN (SELECT id FROM groups WHERE source_id = ?2 AND group_type = 'tag')",
    )
    .bind(doc_id)
    .bind(source_id)
    .execute(&mut **tx)
    .await?;

    for tag in tags {
        // Upsert group
        sqlx::query(
            "INSERT INTO groups (id, source_id, slug, group_type) VALUES (?1, ?2, ?3, 'tag')
             ON CONFLICT(id) DO NOTHING",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(source_id)
        .bind(tag)
        .execute(&mut **tx)
        .await?;

        // Get group id by slug
        let group_id: String = sqlx::query_scalar(
            "SELECT id FROM groups WHERE source_id = ?1 AND slug = ?2 AND group_type = 'tag'",
        )
        .bind(source_id)
        .bind(tag)
        .fetch_one(&mut **tx)
        .await?;

        // Link document to group
        sqlx::query(
            "INSERT OR IGNORE INTO document_groups (document_id, group_id) VALUES (?1, ?2)",
        )
        .bind(doc_id)
        .bind(&group_id)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

/// Full reconciliation
pub async fn reconcile_source(
    source_path: &Path,
    source_id: &str,
    db: &SqlitePool,
    extensions: &[&str],
    frontmatter_buffer_size: usize,
) -> sqlx::Result<()> {
    use std::time::Instant;
    let t_total = Instant::now();

    // Ensure source row exists
    sqlx::query("INSERT OR IGNORE INTO sources (id, title, path) VALUES (?1, ?2, ?3)")
        .bind(source_id)
        .bind(
            source_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Untitled"),
        )
        .bind(source_path.to_string_lossy().as_ref())
        .execute(db)
        .await?;

    let t0 = Instant::now();
    let fs_entries = walk_source(source_path, extensions);
    eprintln!(
        "[reconcile] walk: {}ms ({} files)",
        t0.elapsed().as_millis(),
        fs_entries.len()
    );

    let t1 = Instant::now();
    let db_entries: Vec<(String, i64)> = sqlx::query_as(
        "SELECT rel_path, coalesce(mtime, 0) FROM documents WHERE source_id = ?1 AND rel_path IS NOT NULL",
    )
    .bind(source_id)
    .fetch_all(db)
    .await?;

    let db_id_to_path: HashMap<String, String> = sqlx::query_as(
        "SELECT id, rel_path FROM documents WHERE source_id = ?1 AND rel_path IS NOT NULL",
    )
    .bind(source_id)
    .fetch_all(db)
    .await?
    .into_iter()
    .collect();

    eprintln!(
        "[reconcile] db load: {}ms ({} cached)",
        t1.elapsed().as_millis(),
        db_entries.len()
    );

    let diff = diff_against_db(&db_entries, &fs_entries);
    eprintln!(
        "[reconcile] diff: new={}, modified={}, unchanged={}, missing={}",
        diff.new_paths.len(),
        diff.modified.len(),
        diff.unchanged.len(),
        diff.missing.len()
    );

    let t2 = Instant::now();
    let paths_to_read: Vec<String> = diff
        .new_paths
        .iter()
        .map(|(p, _)| p.clone())
        .chain(diff.modified.iter().map(|(p, _)| p.clone()))
        .collect();
    let frontmatter = extract_frontmatter(source_path, &paths_to_read, frontmatter_buffer_size);
    eprintln!(
        "[reconcile] frontmatter: {}ms ({} files read)",
        t2.elapsed().as_millis(),
        paths_to_read.len()
    );

    let operations = resolve_changes(diff, &frontmatter, &db_id_to_path);

    let t3 = Instant::now();
    apply_operations(&operations, &frontmatter, source_id, db).await?;
    eprintln!(
        "[reconcile] apply: {}ms ({} ops)",
        t3.elapsed().as_millis(),
        operations.len()
    );

    eprintln!("[reconcile] total: {}ms", t_total.elapsed().as_millis());
    Ok(())
}
