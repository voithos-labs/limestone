use chrono::prelude::{DateTime, Utc};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use uuid::Uuid;

fn default_true() -> bool {
    true
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Source {
    pub title: String,
    pub path: PathBuf,
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub accessed_at: DateTime<Utc>,
    #[serde(default = "default_true")]
    pub use_frontmatter: bool,
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
            use_frontmatter: true,
        }
    }
}

#[derive(Deserialize, Serialize, Default)]
pub struct Sources {
    #[serde(default)]
    pub sources: Vec<Source>,
}

fn default_asset_location() -> String {
    "assets".to_string()
}

#[derive(Deserialize, Serialize, Clone)]
pub struct SourceConfig {
    #[serde(default)]
    pub note_location: String,
    #[serde(default = "default_asset_location")]
    pub asset_location: String,
}

impl Default for SourceConfig {
    fn default() -> Self {
        Self {
            note_location: String::new(),
            asset_location: default_asset_location(),
        }
    }
}

pub fn read_source_config(source_path: &Path) -> SourceConfig {
    fs::read_to_string(source_path.join(".limestone.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<SourceConfig>(&s).ok())
        .unwrap_or_default()
}

pub fn write_source_config(source_path: &Path, config: &SourceConfig) -> std::io::Result<()> {
    let config_path = source_path.join(".limestone.json");
    let mut root = fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!({ "ignore": [".limestone/", "assets/", ".*"] }));
    if let Some(obj) = root.as_object_mut() {
        obj.insert(
            "note_location".into(),
            serde_json::Value::String(config.note_location.clone()),
        );
        obj.insert(
            "asset_location".into(),
            serde_json::Value::String(config.asset_location.clone()),
        );
    }
    fs::write(&config_path, serde_json::to_string_pretty(&root).unwrap())
}

pub fn create_source(
    title: Option<String>,
    path: PathBuf,
    note_location: Option<String>,
    asset_location: Option<String>,
    use_frontmatter: bool,
) -> Result<Source, std::io::Error> {
    fs::create_dir_all(&path)?;
    let title = title.unwrap_or_else(|| {
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });

    let config = SourceConfig {
        note_location: note_location.unwrap_or_default(),
        asset_location: asset_location.unwrap_or_else(default_asset_location),
    };
    let _ = write_source_config(&path, &config);

    let mut source = Source::new(title, path);
    source.use_frontmatter = use_frontmatter;
    Ok(source)
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
    },
    UpdatePath {
        old_path: String,
        new_path: String,
        mtime: i64,
    },
    UpdateContent {
        rel_path: String,
        mtime: i64,
    },
    Delete {
        rel_path: String,
    },
}

// ── Source Scan ──────────────────────────────────────────────────────────────────────

fn load_ignore_patterns(source_path: &Path) -> Option<globset::GlobSet> {
    let config_path = source_path.join(".limestone.json");
    let content = fs::read_to_string(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    let patterns = config.get("ignore")?.as_array()?;

    let mut builder = globset::GlobSetBuilder::new();
    for pattern in patterns {
        if let Some(s) = pattern.as_str() {
            if let Ok(glob) = globset::GlobBuilder::new(s).literal_separator(true).build() {
                builder.add(glob);
            }
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

    // path -> id
    let db_path_to_id: HashMap<&str, &str> = db_id_to_path
        .iter()
        .map(|(id, path)| (path.as_str(), id.as_str()))
        .collect();

    // Track which missing paths were resolved as renames
    let mut resolved_missing: std::collections::HashSet<&str> = std::collections::HashSet::new();
    // Modified paths that are handled
    let mut modified_handled: std::collections::HashSet<&str> = std::collections::HashSet::new();
    // Track modified paths where the ID changed (vacated by old ID: VACATED!)
    let mut vacated: HashMap<&str, &str> = HashMap::new(); // modified_path -> old_id

    // prescan modified files for ID changes
    for (path, _mtime) in &diff.modified {
        let fm = fm_map.get(path.as_str()).and_then(|(_, fm)| fm.as_ref());
        let new_id = fm.and_then(|f| f.get("id")).and_then(|v| v.as_str());
        let old_id = db_path_to_id.get(path.as_str()).copied();

        if let (Some(new_id), Some(old_id)) = (new_id, old_id) {
            if new_id != old_id {
                vacated.insert(path.as_str(), old_id);
            }
        }
    }

    // Deferred ops for inbound moves to modified paths (must apply after vacating ops)
    let mut deferred_inbound: Vec<DbOperation> = Vec::new();

    // Pre-resolve modified paths with inbound moves (e.g. UUID-B moved from bar.md to foo.md)
    // this is for handling the external swap case
    for (path, mtime) in &diff.modified {
        if !vacated.contains_key(path.as_str()) {
            continue;
        }
        let fm = fm_map.get(path.as_str()).and_then(|(_, fm)| fm.as_ref());
        let new_id = fm.and_then(|f| f.get("id")).and_then(|v| v.as_str());

        if let Some(new_id) = new_id {
            if let Some(old_path) = db_id_to_path.get(new_id) {
                if diff.missing.contains(old_path) {
                    resolved_missing.insert(old_path.as_str());
                    modified_handled.insert(path.as_str());
                    deferred_inbound.push(DbOperation::UpdatePath {
                        old_path: old_path.clone(),
                        new_path: path.clone(),
                        mtime: *mtime,
                    });
                    deferred_inbound.push(DbOperation::UpdateContent {
                        rel_path: path.clone(),
                        mtime: *mtime,
                    });
                }
            }
        }
    }

    // Handle new paths (including vacating + move, before deferred inbound)
    for (path, mtime) in &diff.new_paths {
        let fm = new_fm.get(path.as_str()).copied().flatten();

        if let Some(id) = fm.and_then(|f| f.get("id")).and_then(|v| v.as_str()) {
            if let Some(old_path) = db_id_to_path.get(id) {
                if diff.missing.contains(old_path) {
                    resolved_missing.insert(old_path.as_str());
                    ops.push(DbOperation::UpdatePath {
                        old_path: old_path.clone(),
                        new_path: path.clone(),
                        mtime: *mtime,
                    });
                    continue;
                }
                // ID vacated a modified path -- just rename (I think)
                if vacated.get(old_path.as_str()) == Some(&id) {
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
        });
    }

    // Now apply inbound moves (path is vacated by ops above)
    ops.extend(deferred_inbound);

    // Handle modified paths (skip those handled as moves)
    for (path, mtime) in &diff.modified {
        if modified_handled.contains(path.as_str()) {
            continue;
        }
        ops.push(DbOperation::UpdateContent {
            rel_path: path.clone(),
            mtime: *mtime,
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

/// Format an epoch-seconds timestamp the way `datetime('now')` does
/// (`YYYY-MM-DD HH:MM:SS`)
fn epoch_to_sql(secs: i64) -> String {
    DateTime::<Utc>::from_timestamp(secs, 0)
        .unwrap_or_else(Utc::now)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// Read the file's creation time, fall back to mtime if the
/// platform/filesystem doent expose it
fn fs_birth_secs(path: &Path, fallback_mtime: i64) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.created().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(fallback_mtime)
}

fn fs_mtime_secs(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Apply all ops
pub async fn apply_operations(
    operations: &[DbOperation],
    frontmatter: &[(String, Option<serde_json::Value>)],
    source_id: &str,
    source_path: &Path,
    db: &SqlitePool,
) -> sqlx::Result<()> {
    let fm_map: HashMap<&str, Option<&serde_json::Value>> = frontmatter
        .iter()
        .map(|(p, fm)| (p.as_str(), fm.as_ref()))
        .collect();

    let mut tx = db.begin().await?;

    for op in operations {
        match op {
            DbOperation::Insert { rel_path, mtime } => {
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
                // Prefer frontmatter dates; otherwise derive from filesystem so
                // imported files retain their real history instead of all
                // being stamped with the moment of indexing.
                let full_path = source_path.join(rel_path);
                let mtime_str = epoch_to_sql(*mtime);
                let created_at = fm
                    .and_then(|f| f.get("created_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| epoch_to_sql(fs_birth_secs(&full_path, *mtime)));
                let updated_at = fm
                    .and_then(|f| f.get("updated_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| mtime_str.clone());
                let accessed_at = fm
                    .and_then(|f| f.get("accessed_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| mtime_str.clone());

                sqlx::query(
                    "INSERT INTO documents (id, source_id, rel_path, title, mtime, properties, created_at, updated_at, accessed_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
                    sync_tags(&mut tx, &doc_id, &tags).await?;
                }

                sync_folders(&mut tx, source_id, &doc_id, rel_path).await?;
            }

            DbOperation::UpdatePath {
                old_path,
                new_path,
                mtime,
            } => {
                let doc_id: Option<String> = sqlx::query_scalar(
                    "SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2",
                )
                .bind(source_id)
                .bind(old_path)
                .fetch_optional(&mut *tx)
                .await?;

                let title = Path::new(new_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled");

                sqlx::query(
                    "UPDATE documents SET rel_path = ?1, title = ?2, mtime = ?3, updated_at = datetime('now') WHERE source_id = ?4 AND rel_path = ?5",
                )
                .bind(new_path)
                .bind(title)
                .bind(mtime)
                .bind(source_id)
                .bind(old_path)
                .execute(&mut *tx)
                .await?;

                if let Some(doc_id) = doc_id {
                    sync_folders(&mut tx, source_id, &doc_id, new_path).await?;
                }
            }

            DbOperation::UpdateContent { rel_path, mtime } => {
                let fm = fm_map.get(rel_path.as_str()).copied().flatten();
                let title = Path::new(rel_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled");
                let properties = fm.map(fm_properties).unwrap_or_else(|| "{}".to_string());
                let mtime_str = epoch_to_sql(*mtime);
                let updated_at = fm
                    .and_then(|f| f.get("updated_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| mtime_str.clone());
                let accessed_at = fm
                    .and_then(|f| f.get("accessed_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| mtime_str.clone());

                sqlx::query(
                    "UPDATE documents SET title = ?1, mtime = ?2, properties = ?3, updated_at = ?4, accessed_at = ?5
                     WHERE source_id = ?6 AND rel_path = ?7",
                )
                .bind(title)
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
                        sync_tags(&mut tx, &doc_id, &tags).await?;
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

/// Ensure folder groups exist for a document's path and link the document to all ancestors
async fn sync_folders(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_id: &str,
    doc_id: &str,
    rel_path: &str,
) -> sqlx::Result<()> {
    let path = Path::new(rel_path);
    let segments: Vec<&str> = path
        .parent()
        .map(|p| {
            p.components()
                .filter_map(|c| c.as_os_str().to_str())
                .collect()
        })
        .unwrap_or_default();

    if segments.is_empty() {
        return Ok(());
    }

    // Clear existing folder associations for this document
    sqlx::query(
        "DELETE FROM document_groups WHERE document_id = ?1 AND group_id IN (SELECT id FROM groups WHERE source_id = ?2 AND group_type = 'folder')",
    )
    .bind(doc_id)
    .bind(source_id)
    .execute(&mut **tx)
    .await?;

    let mut parent_id: Option<String> = None;

    for slug in &segments {
        let existing: Option<String> = match &parent_id {
            Some(pid) => {
                sqlx::query_scalar(
                    "SELECT id FROM groups WHERE source_id = ?1 AND slug = ?2 AND group_type = 'folder' AND parent_group_id = ?3",
                )
                .bind(source_id)
                .bind(slug)
                .bind(pid)
                .fetch_optional(&mut **tx)
                .await?
            }
            None => {
                sqlx::query_scalar(
                    "SELECT id FROM groups WHERE source_id = ?1 AND slug = ?2 AND group_type = 'folder' AND parent_group_id IS NULL",
                )
                .bind(source_id)
                .bind(slug)
                .fetch_optional(&mut **tx)
                .await?
            }
        };

        let group_id = match existing {
            Some(id) => id,
            None => {
                let id = Uuid::new_v4().to_string();
                sqlx::query(
                    "INSERT INTO groups (id, source_id, slug, group_type, parent_group_id) VALUES (?1, ?2, ?3, 'folder', ?4)",
                )
                .bind(&id)
                .bind(source_id)
                .bind(slug)
                .bind(parent_id.as_deref())
                .execute(&mut **tx)
                .await?;
                id
            }
        };

        sqlx::query(
            "INSERT OR IGNORE INTO document_groups (document_id, group_id) VALUES (?1, ?2)",
        )
        .bind(doc_id)
        .bind(&group_id)
        .execute(&mut **tx)
        .await?;

        parent_id = Some(group_id);
    }

    Ok(())
}

/// Remove groups with no document associations
async fn cleanup_orphan_groups(db: &SqlitePool) -> sqlx::Result<()> {
    // Tags: delete any with zero members
    sqlx::query(
        "DELETE FROM groups WHERE group_type = 'tag'
         AND id NOT IN (SELECT group_id FROM document_groups)",
    )
    .execute(db)
    .await?;

    // Folders: repeatedly prune leaves with no documents and no children
    loop {
        let result = sqlx::query(
            "DELETE FROM groups WHERE group_type = 'folder'
             AND id NOT IN (SELECT group_id FROM document_groups)
             AND id NOT IN (SELECT parent_group_id FROM groups WHERE parent_group_id IS NOT NULL)",
        )
        .execute(db)
        .await?;

        if result.rows_affected() == 0 {
            break;
        }
    }

    Ok(())
}

/// Sync tags from frontmatter into groups (tags are global, source_id is null)
pub(crate) async fn sync_tags(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    doc_id: &str,
    tags: &[String],
) -> sqlx::Result<()> {
    // Clear existing tag associations for this document
    sqlx::query(
        "DELETE FROM document_groups WHERE document_id = ?1 AND group_id IN (SELECT id FROM groups WHERE source_id IS NULL AND group_type = 'tag')",
    )
    .bind(doc_id)
    .execute(&mut **tx)
    .await?;

    for tag in tags {
        // Upsert tag group (global)
        sqlx::query(
            "INSERT INTO groups (id, slug, group_type) VALUES (?1, ?2, 'tag')
             ON CONFLICT(slug, group_type) DO NOTHING",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(tag)
        .execute(&mut **tx)
        .await?;

        let group_id: String = sqlx::query_scalar(
            "SELECT id FROM groups WHERE slug = ?1 AND group_type = 'tag' AND source_id IS NULL",
        )
        .bind(tag)
        .fetch_one(&mut **tx)
        .await?;

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

///
/// Reconcile a Source
///
/// Little complicated, but basically:
///
/// 1. Walks source dir, collecting rel_path (to source) and mtime for .md documents
/// 2. Loads all documents from this source in the db (cached)
/// 3. Diffs source dir to db documents for this source
///     - same path AND same mtime => unchanged
///     - same path AND NOT same mtime => modifiedd
///     - on disk but not found in db (by rel_path) => new_paths
///     - in db but not found on disk => missing (later can prompt to restore for autpmerge history in UI)
/// 4. Extract and parse frontmatter, quickly ideally
/// 5. Resolve documents (little complicated, but handles a few cases like external file name swaps)
/// 6. Commit changes
/// 7. Cleanup orphaned groups
///

pub async fn index_document(
    db: &SqlitePool,
    source_id: &str,
    source_path: &Path,
    doc_id: &str,
    rel_path: &str,
    fm_buffer_size: usize,
) -> sqlx::Result<()> {
    let full = source_path.join(rel_path);
    let fm = read_frontmatter(&full, fm_buffer_size);
    let title = Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled");
    let properties = fm
        .as_ref()
        .map(fm_properties)
        .unwrap_or_else(|| "{}".to_string());
    let mtime = fs_mtime_secs(&full);

    let mut tx = db.begin().await?;
    sqlx::query(
        "UPDATE documents SET rel_path = ?1, title = ?2, mtime = ?3, properties = ?4, updated_at = datetime('now') WHERE id = ?5",
    )
    .bind(rel_path)
    .bind(title)
    .bind(mtime)
    .bind(&properties)
    .bind(doc_id)
    .execute(&mut *tx)
    .await?;

    sync_folders(&mut tx, source_id, doc_id, rel_path).await?;
    if let Some(fm) = fm.as_ref() {
        let tags: Vec<String> = fm
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        sync_tags(&mut tx, doc_id, &tags).await?;
    }

    tx.commit().await?;
    Ok(())
}

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

    let fs_entries = walk_source(source_path, extensions);

    let db_rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT id, rel_path, coalesce(mtime, 0) FROM documents WHERE source_id = ?1 AND rel_path IS NOT NULL",
    )
    .bind(source_id)
    .fetch_all(db)
    .await?;

    let db_entries: Vec<(String, i64)> = db_rows
        .iter()
        .map(|(_, path, mtime)| (path.clone(), *mtime))
        .collect();
    let db_id_to_path: HashMap<String, String> = db_rows
        .into_iter()
        .map(|(id, path, _)| (id, path))
        .collect();

    let diff = diff_against_db(&db_entries, &fs_entries);

    let paths_to_read: Vec<String> = diff
        .new_paths
        .iter()
        .map(|(p, _)| p.clone())
        .chain(diff.modified.iter().map(|(p, _)| p.clone()))
        .collect();
    let frontmatter = extract_frontmatter(source_path, &paths_to_read, frontmatter_buffer_size);

    let operations = resolve_changes(diff, &frontmatter, &db_id_to_path);
    let ops_count = operations.len();

    apply_operations(&operations, &frontmatter, source_id, source_path, db).await?;
    cleanup_orphan_groups(db).await?;

    let source_title = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("?");
    eprintln!(
        "[reconcile:{}] {}ms | {} files, {} cached, {} ops",
        source_title,
        t_total.elapsed().as_millis(),
        fs_entries.len(),
        db_entries.len(),
        ops_count
    );
    Ok(())
}
