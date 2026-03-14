use super::JsonSettingsStore;
use chrono::prelude::{DateTime, Utc};
use rayon::prelude::*;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;
use uuid::Uuid;

#[derive(Deserialize, Serialize, Clone)]
pub struct Vault {
    pub title: String,
    pub path: PathBuf,
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub accessed_at: DateTime<Utc>,
}

impl Vault {
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
pub struct Vaults {
    #[serde(default)]
    pub vaults: Vec<Vault>,
}

pub fn open_vault(app: &AppHandle, app_data: &crate::AppData, mut vault: Vault) {
    // Allow access to new vault
    // Note: previously opened vaults remain accessible until app restart (no way to remove perm)
    let _ = app.fs_scope().allow_directory(&vault.path, true);

    let vault_path = vault.path.clone();
    vault.accessed_at = Utc::now();
    *app_data.active_vault.lock().unwrap() = Some(vault);

    let merged = JsonSettingsStore::for_app(app, Some(&vault_path)).load_merged();
    *app_data.settings.write().unwrap() = merged;
}

pub fn create_vault(title: Option<String>, path: PathBuf) -> Result<Vault, std::io::Error> {
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

    Ok(Vault::new(title, path))
}

// ---------------------
// Reconciliation types
// ---------------------

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Frontmatter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessed_at: Option<String>,
    #[serde(default, flatten)]
    pub properties: HashMap<String, serde_json::Value>,
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
        frontmatter: Option<Frontmatter>,
    },
    UpdatePath {
        old_path: String,
        new_path: String,
        mtime: i64,
    },
    UpdateContent {
        rel_path: String,
        mtime: i64,
        frontmatter: Option<Frontmatter>,
    },
    Delete {
        rel_path: String,
    },
}

// ── Vault Scan ───────────────────────────────────────────────────────────────────────

/// Load .limestoneignore in vault root
fn load_ignore_patterns(vault_path: &Path) -> Option<globset::GlobSet> {
    let ignore_path = vault_path.join(".limestoneignore");
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

/// Walk the vault directory and collect (rel_path, mtime) for files w/ ignore
pub fn walk_vault(vault_path: &Path, extensions: &[&str]) -> Vec<(String, i64)> {
    let ignore = load_ignore_patterns(vault_path);
    let mut entries = Vec::new();

    for entry in jwalk::WalkDir::new(vault_path).sort(true) {
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

        let rel_path = match path.strip_prefix(vault_path) {
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
    vault_path: &Path,
    paths: &[String],
    buffer_size: usize,
) -> Vec<(String, Option<Frontmatter>)> {
    paths
        .par_iter()
        .map(|rel_path| {
            let full_path = vault_path.join(rel_path);
            let fm = read_frontmatter(&full_path, buffer_size);
            (rel_path.clone(), fm)
        })
        .collect()
}

fn read_frontmatter(path: &Path, buffer_size: usize) -> Option<Frontmatter> {
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
    frontmatter: &[(String, Option<Frontmatter>)],
    db_id_to_path: &HashMap<String, String>,
) -> Vec<DbOperation> {
    let mut ops = Vec::new();

    // Build lookup
    let fm_map: HashMap<&str, &(String, Option<Frontmatter>)> = frontmatter
        .iter()
        .map(|entry| (entry.0.as_str(), entry))
        .collect();

    // New paths with extracted frontmatter
    let new_fm: HashMap<&str, Option<&Frontmatter>> = diff
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

        if let Some(id) = fm.and_then(|f| f.id.as_deref()) {
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
            // Check if ID found in any new path (already handled above)
            ops.push(DbOperation::Delete {
                rel_path: path.clone(),
            });
        }
    }

    ops
}

/// Apply all ops
pub fn apply_operations(
    operations: &[DbOperation],
    frontmatter: &[(String, Option<Frontmatter>)],
    vault_id: &str,
    db: &Connection,
) -> rusqlite::Result<()> {
    let fm_map: HashMap<&str, Option<&Frontmatter>> = frontmatter
        .iter()
        .map(|(p, fm)| (p.as_str(), fm.as_ref()))
        .collect();

    let tx = db.unchecked_transaction()?;

    for op in operations {
        match op {
            DbOperation::Insert {
                rel_path, mtime, ..
            } => {
                let fm = fm_map.get(rel_path.as_str()).copied().flatten();
                let doc_id = fm
                    .and_then(|f| f.id.as_deref())
                    .unwrap_or_else(|| "")
                    .to_string();
                let doc_id = if doc_id.is_empty() {
                    Uuid::new_v4().to_string()
                } else {
                    doc_id
                };
                let title = Path::new(rel_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled");
                let properties = fm
                    .map(|f| serde_json::to_string(&f.properties).unwrap_or_default())
                    .unwrap_or_else(|| "{}".to_string());
                let created_at = fm.and_then(|f| f.created_at.as_deref());
                let updated_at = fm.and_then(|f| f.updated_at.as_deref());
                let accessed_at = fm.and_then(|f| f.accessed_at.as_deref());

                tx.execute(
                    "insert into documents (id, vault_id, rel_path, title, mtime, properties, created_at, updated_at, accessed_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, coalesce(?7, datetime('now')), coalesce(?8, datetime('now')), coalesce(?9, datetime('now')))",
                    rusqlite::params![doc_id, vault_id, rel_path, title, mtime, properties, created_at, updated_at, accessed_at],
                )?;

                // Sync tags
                if let Some(fm) = fm {
                    sync_tags(&tx, vault_id, &doc_id, &fm.tags)?;
                }
            }

            DbOperation::UpdatePath {
                old_path,
                new_path,
                mtime,
            } => {
                tx.execute(
                    "update documents set rel_path = ?1, mtime = ?2, updated_at = datetime('now') where vault_id = ?3 and rel_path = ?4",
                    rusqlite::params![new_path, mtime, vault_id, old_path],
                )?;
            }

            DbOperation::UpdateContent {
                rel_path, mtime, ..
            } => {
                let fm = fm_map.get(rel_path.as_str()).copied().flatten();
                let properties = fm
                    .map(|f| serde_json::to_string(&f.properties).unwrap_or_default())
                    .unwrap_or_else(|| "{}".to_string());
                let updated_at = fm.and_then(|f| f.updated_at.as_deref());
                let accessed_at = fm.and_then(|f| f.accessed_at.as_deref());

                tx.execute(
                    "update documents set mtime = ?1, properties = ?2, updated_at = coalesce(?3, datetime('now')), accessed_at = coalesce(?4, datetime('now'))
                     where vault_id = ?5 and rel_path = ?6",
                    rusqlite::params![mtime, properties, updated_at, accessed_at, vault_id, rel_path],
                )?;

                // Re-sync tags
                if let Some(fm) = fm {
                    let doc_id: Option<String> = tx
                        .query_row(
                            "select id from documents where vault_id = ?1 and rel_path = ?2",
                            rusqlite::params![vault_id, rel_path],
                            |row| row.get(0),
                        )
                        .ok();
                    if let Some(doc_id) = doc_id {
                        sync_tags(&tx, vault_id, &doc_id, &fm.tags)?;
                    }
                }
            }

            DbOperation::Delete { rel_path } => {
                tx.execute(
                    "delete from documents where vault_id = ?1 and rel_path = ?2",
                    rusqlite::params![vault_id, rel_path],
                )?;
            }
        }
    }

    tx.commit()
}

/// Sync tags from frontmatter into groups
fn sync_tags(
    tx: &rusqlite::Transaction,
    vault_id: &str,
    doc_id: &str,
    tags: &[String],
) -> rusqlite::Result<()> {
    // Clear existing tag associations for this document
    tx.execute(
        "delete from document_groups where document_id = ?1 and group_id in (select id from groups where vault_id = ?2 and group_type = 'tag')",
        rusqlite::params![doc_id, vault_id],
    )?;

    for tag in tags {
        // Upsert group
        tx.execute(
            "insert into groups (id, vault_id, slug, group_type) values (?1, ?2, ?3, 'tag')
             on conflict(id) do nothing",
            rusqlite::params![Uuid::new_v4().to_string(), vault_id, tag],
        )?;

        // Get group id by slug
        let group_id: String = tx.query_row(
            "select id from groups where vault_id = ?1 and slug = ?2 and group_type = 'tag'",
            rusqlite::params![vault_id, tag],
            |row| row.get(0),
        )?;

        // Link document to group
        tx.execute(
            "insert or ignore into document_groups (document_id, group_id) values (?1, ?2)",
            rusqlite::params![doc_id, group_id],
        )?;
    }

    Ok(())
}

/// Full reconilation
pub fn reconcile_vault(
    vault_path: &Path,
    vault_id: &str,
    db: &Connection,
    extensions: &[&str],
    frontmatter_buffer_size: usize,
) -> rusqlite::Result<()> {
    use std::time::Instant;
    let t_total = Instant::now();

    // Ensure vault row exists
    db.execute(
        "insert or ignore into vaults (id, title, path) values (?1, ?2, ?3)",
        rusqlite::params![
            vault_id,
            vault_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Untitled"), // this maybe should behave differently
            vault_path.to_string_lossy()
        ],
    )?;

    let t0 = Instant::now();
    let fs_entries = walk_vault(vault_path, extensions);
    eprintln!(
        "[reconcile] walk: {}ms ({} files)",
        t0.elapsed().as_millis(),
        fs_entries.len()
    );

    let t1 = Instant::now();
    let mut stmt = db.prepare(
        "select rel_path, coalesce(mtime, 0) from documents where vault_id = ?1 and rel_path is not null",
    )?;
    let db_entries: Vec<(String, i64)> = stmt
        .query_map(rusqlite::params![vault_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut id_stmt = db.prepare(
        "select id, rel_path from documents where vault_id = ?1 and rel_path is not null",
    )?;
    let db_id_to_path: HashMap<String, String> = id_stmt
        .query_map(rusqlite::params![vault_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .filter_map(|r| r.ok())
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
    let frontmatter = extract_frontmatter(vault_path, &paths_to_read, frontmatter_buffer_size);
    eprintln!(
        "[reconcile] frontmatter: {}ms ({} files read)",
        t2.elapsed().as_millis(),
        paths_to_read.len()
    );

    let operations = resolve_changes(diff, &frontmatter, &db_id_to_path);

    let t3 = Instant::now();
    apply_operations(&operations, &frontmatter, vault_id, db)?;
    eprintln!(
        "[reconcile] apply: {}ms ({} ops)",
        t3.elapsed().as_millis(),
        operations.len()
    );

    eprintln!("[reconcile] total: {}ms", t_total.elapsed().as_millis());
    Ok(())
}
