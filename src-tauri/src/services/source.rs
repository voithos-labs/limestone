use crate::services::frontmatter;
use chrono::prelude::{DateTime, Utc};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use uuid::Uuid;

// ── Overview (BAF: Big Ass File) ──────────────────────────────────────────────────────────
/// This contains, broadly:
/// 1. The source data model definition & associated helpers
/// 2. source scanning and reconciliation logic (big and ugly)
///
/// Due to the size of the file, I will give a brief overview here.
///
/// *Source Model*
///
/// Okay, so, a 'source' is a saved folder resource for the app. It is a static path that is indexed
/// by limestone and made accessible and searchable to the user -- an added folder.
///
/// Per source, there is basic metadata, a UUID for db reference, and the boolean property
/// `use_frontmatter`, which enables the use of frontmatter in the source's .md documents, which
/// supports more features downstream.
///
/// *Scan & Reconciliation*
///
/// Little complicated, but basically:
/// PER SOURCE, RUN IN PARALLEL
/// 1. Walks source dir, collecting rel_path (to source) and mtime for .md documents
/// 2. Loads all documents from the db (cache)
/// 3. Diffs source dir to db documents
///     - same path AND same mtime => unchanged
///     - same path AND NOT same mtime => modified
///     - on disk but not found in db (by rel_path) => new_paths
///     - in db but not found on disk => missing, delete from cache (TODO: soft-delete, recoverable)
///          -> later can prompt to restore for autpmerge history in UI, and allows a better missing
///             doc page
/// 4. Extract and parse frontmatter, quickly ideally
/// 5. Resolve id-first for each read file, dupes get re-keyed
/// 6. Commit changes
/// 7. Cleanup orphaned groups
///

// ── Model ────────────────────────────────────────────────────────────────────────────

// annoying derive helper
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
    #[serde(default)]
    pub note_location: String,
    #[serde(default = "default_asset_location")]
    pub asset_location: String,
    #[serde(default = "default_ignore")]
    pub ignore: Vec<String>,
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
            note_location: String::new(),
            asset_location: default_asset_location(),
            ignore: default_ignore(),
        }
    }
}

// yup
pub const SOURCES_VERSION: u32 = 1;

fn sources_version() -> u32 {
    SOURCES_VERSION
}

#[derive(Deserialize, Serialize)]
pub struct Sources {
    #[serde(default = "sources_version")]
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_source_id: Option<Uuid>,
    #[serde(default)]
    pub sources: Vec<Source>,
}

impl Default for Sources {
    fn default() -> Self {
        Self {
            version: SOURCES_VERSION,
            default_source_id: None,
            sources: Vec::new(),
        }
    }
}

fn default_asset_location() -> String {
    "assets".to_string()
}

fn default_ignore() -> Vec<String> {
    vec![".*".to_string()]
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

    let mut source = Source::new(title, path);
    source.use_frontmatter = use_frontmatter;
    source.note_location = note_location.unwrap_or_default();
    source.asset_location = asset_location.unwrap_or_else(default_asset_location);
    Ok(source)
}

// ── The Big Scan ─────────────────────────────────────────────────────────────────────

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
pub struct ResolvedDoc {
    pub id: String,
    pub rel_path: String,
    pub mtime: i64,
    pub db_mtime: Option<i64>,
    pub existing: bool,
    pub moved: bool,
    pub rewrite_id: bool,
}

#[derive(Debug)]
pub struct ReconcilePlan {
    pub docs: Vec<ResolvedDoc>,
    pub delete_ids: Vec<String>,
}

fn build_ignore(source: &Source) -> Option<globset::GlobSet> {
    let asset_dir = source.asset_location.trim_matches('/').to_string();
    let mut builder = globset::GlobSetBuilder::new();
    for pattern in source
        .ignore
        .iter()
        .map(|p| p.trim_end_matches('/'))
        .chain(std::iter::once(asset_dir.as_str()))
    {
        if pattern.is_empty() {
            continue;
        }
        for glob in [pattern.to_string(), format!("{pattern}/**")] {
            if let Ok(g) = globset::GlobBuilder::new(&glob)
                .literal_separator(true)
                .build()
            {
                builder.add(g);
            }
        }
    }
    builder.build().ok()
}

/// Walk the source directory and collect (rel_path, mtime) for files w/ ignore
pub fn walk_source(source: &Source, extensions: &[&str]) -> Vec<(String, i64)> {
    let source_path = &source.path;
    let ignore = build_ignore(source);
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
            .map(|d| d.as_millis() as i64)
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

// escalate the read window until the closing fence fits (or the whole file is in)
fn read_frontmatter(path: &Path, buffer_size: usize) -> Option<serde_json::Value> {
    let mut limit = buffer_size.max(64) as u64;
    loop {
        let mut buf = Vec::new();
        fs::File::open(path)
            .ok()?
            .take(limit)
            .read_to_end(&mut buf)
            .ok()?;
        let whole_file = (buf.len() as u64) < limit;

        // tolerate a multibyte char split at the window edge
        let content = match std::str::from_utf8(&buf) {
            Ok(s) => s,
            Err(e) => std::str::from_utf8(&buf[..e.valid_up_to()]).ok()?,
        };
        let trimmed = content.trim_start();
        if !trimmed.starts_with("---") {
            return None;
        }
        let after_open = &trimmed[3..];
        if let Some(close) = frontmatter::find_closing_fence(after_open) {
            return serde_yml::from_str(&after_open[..close]).ok();
        }
        if whole_file {
            return None;
        }
        let next = limit.saturating_mul(16).min(1 << 22);
        if next == limit {
            return None;
        }
        limit = next;
    }
}

// Id-first resolution: every read (new/modified) file resolves to exactly one document id
pub fn resolve_plan(
    diff: &ReconciliationDiff,
    frontmatter: &[(String, Option<serde_json::Value>)],
    db_docs: &HashMap<String, (String, i64)>,
    foreign_ids: &HashSet<String>,
) -> ReconcilePlan {
    let fm_map: HashMap<&str, Option<&serde_json::Value>> = frontmatter
        .iter()
        .map(|(p, fm)| (p.as_str(), fm.as_ref()))
        .collect();
    let db_path_to_id: HashMap<&str, &str> = db_docs
        .iter()
        .map(|(id, (path, _))| (path.as_str(), id.as_str()))
        .collect();
    let unchanged: HashSet<&str> = diff.unchanged.iter().map(|p| p.as_str()).collect();

    let mut read_paths: Vec<(&str, i64)> = diff
        .modified
        .iter()
        .chain(diff.new_paths.iter())
        .map(|(p, m)| (p.as_str(), *m))
        .collect();
    read_paths.sort();

    let claims: HashMap<&str, &str> = read_paths
        .iter()
        .filter_map(|(p, _)| {
            fm_map
                .get(p)
                .copied()
                .flatten()
                .and_then(|f| f.get("id"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|id| (*p, id))
        })
        .collect();

    let mut assigned: HashSet<&str> = HashSet::new();
    let mut docs: Vec<ResolvedDoc> = Vec::new();
    let mut claimless: Vec<(&str, i64)> = Vec::new();

    for (path, mtime) in &read_paths {
        let Some(&claim) = claims.get(path) else {
            claimless.push((path, *mtime));
            continue;
        };
        let holder = db_docs.get(claim).map(|(p, _)| p.as_str());
        // a claim is granted unless the id's current holder keeps it (duplicate)
        let granted = !assigned.contains(claim)
            && !foreign_ids.contains(claim)
            && match holder {
                Some(q) if q == *path => true,
                Some(q) => !unchanged.contains(q) && claims.get(q) != Some(&claim),
                None => true,
            };
        if granted {
            assigned.insert(claim);
            docs.push(ResolvedDoc {
                id: claim.to_string(),
                rel_path: path.to_string(),
                mtime: *mtime,
                db_mtime: db_docs.get(claim).map(|(_, m)| *m),
                existing: holder.is_some(),
                moved: holder.is_some_and(|q| q != *path),
                rewrite_id: false,
            });
        } else {
            docs.push(ResolvedDoc {
                id: Uuid::new_v4().to_string(),
                rel_path: path.to_string(),
                mtime: *mtime,
                db_mtime: None,
                existing: false,
                moved: false,
                rewrite_id: true,
            });
        }
    }

    for (path, mtime) in claimless {
        let existing = db_path_to_id
            .get(path)
            .copied()
            .filter(|id| !assigned.contains(id));
        if let Some(id) = existing {
            assigned.insert(id);
        }
        docs.push(ResolvedDoc {
            id: existing
                .map(str::to_string)
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            rel_path: path.to_string(),
            mtime,
            db_mtime: existing.and_then(|id| db_docs.get(id).map(|(_, m)| *m)),
            existing: existing.is_some(),
            moved: false,
            rewrite_id: false,
        });
    }

    let keep: HashSet<&str> = docs
        .iter()
        .map(|d| d.id.as_str())
        .chain(
            unchanged
                .iter()
                .filter_map(|p| db_path_to_id.get(p).copied()),
        )
        .collect();
    let delete_ids: Vec<String> = db_docs
        .keys()
        .filter(|id| !keep.contains(id.as_str()))
        .cloned()
        .collect();

    ReconcilePlan { docs, delete_ids }
}

/// Read the file's creation time, fall back to mtime if the
/// platform/filesystem doent expose it
fn fs_birth_ms(path: &Path, fallback_mtime: i64) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.created().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(fallback_mtime)
}

fn fs_mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn fm_tags(fm: Option<&serde_json::Value>) -> Vec<String> {
    fm.and_then(|f| f.get("tags"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn fm_date(fm: Option<&serde_json::Value>, key: &str) -> Option<i64> {
    fm.and_then(|f| f.get(key))
        .and_then(|v| v.as_str())
        .and_then(frontmatter::date_ms)
}

pub async fn apply_plan(
    plan: &ReconcilePlan,
    frontmatter: &[(String, Option<serde_json::Value>)],
    source_id: &str,
    source_path: &Path,
    db: &SqlitePool,
) -> sqlx::Result<()> {
    let fm_map: HashMap<&str, Option<&serde_json::Value>> = frontmatter
        .iter()
        .map(|(p, fm)| (p.as_str(), fm.as_ref()))
        .collect();

    // duplicates get a fresh id written back so they stay stable across runs
    for doc in plan.docs.iter().filter(|d| d.rewrite_id) {
        let id = doc.id.clone();
        let _ = frontmatter::rewrite_frontmatter(&source_path.join(&doc.rel_path), move |fm| {
            if let Some(obj) = fm.as_object_mut() {
                obj.insert("id".into(), serde_json::Value::String(id.clone()));
            }
        });
    }

    let mut tx = db.begin().await?;

    let mut unlinked_groups: Vec<String> = Vec::new();
    for id in &plan.delete_ids {
        let group_ids: Vec<String> =
            sqlx::query_scalar("SELECT group_id FROM document_groups WHERE document_id = ?1")
                .bind(id)
                .fetch_all(&mut *tx)
                .await?;
        unlinked_groups.extend(group_ids);
        sqlx::query(
            "DELETE FROM documents_fts WHERE rowid = (SELECT rowid FROM documents WHERE id = ?1)",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM documents WHERE id = ?1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    // park moved rows on collision-free temp paths before final paths are assigned
    // every write is conditional on the snapshot mtime so a concurrent in-app edit wins
    for doc in plan.docs.iter().filter(|d| d.moved) {
        sqlx::query("UPDATE documents SET rel_path = ?1 WHERE id = ?2 AND coalesce(mtime, 0) = ?3")
            .bind(format!("/{}", doc.id))
            .bind(&doc.id)
            .bind(doc.db_mtime.unwrap_or(0))
            .execute(&mut *tx)
            .await?;
    }

    for doc in &plan.docs {
        let fm = fm_map.get(doc.rel_path.as_str()).copied().flatten();
        let title = Path::new(&doc.rel_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled");
        let properties = fm.map(fm_properties).unwrap_or_else(|| "{}".to_string());
        let full_path = source_path.join(&doc.rel_path);
        let mtime = if doc.rewrite_id {
            fs_mtime_ms(&full_path)
        } else {
            doc.mtime
        };
        let updated_at = fm_date(fm, "updated_at").unwrap_or(mtime);

        let wrote = if doc.existing {
            sqlx::query(
                "UPDATE documents SET rel_path = ?1, title = ?2, mtime = ?3, properties = ?4, updated_at = ?5
                 WHERE id = ?6 AND coalesce(mtime, 0) = ?7",
            )
            .bind(&doc.rel_path)
            .bind(title)
            .bind(mtime)
            .bind(&properties)
            .bind(updated_at)
            .bind(&doc.id)
            .bind(doc.db_mtime.unwrap_or(0))
            .execute(&mut *tx)
            .await?
            .rows_affected()
                > 0
        } else {
            let created_at =
                fm_date(fm, "created_at").unwrap_or_else(|| fs_birth_ms(&full_path, mtime));
            let accessed_at = fm_date(fm, "accessed_at").unwrap_or(mtime);
            sqlx::query(
                "INSERT INTO documents (id, source_id, rel_path, title, mtime, properties, created_at, updated_at, accessed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT DO NOTHING",
            )
            .bind(&doc.id)
            .bind(source_id)
            .bind(&doc.rel_path)
            .bind(title)
            .bind(mtime)
            .bind(&properties)
            .bind(created_at)
            .bind(updated_at)
            .bind(accessed_at)
            .execute(&mut *tx)
            .await?
            .rows_affected()
                > 0
        };

        // a lost write means a race edit is faster
        if wrote {
            sync_tags(&mut tx, &doc.id, &fm_tags(fm)).await?;
            sync_folders(&mut tx, source_id, &doc.id, &doc.rel_path).await?;
        }
    }

    for group_id in &unlinked_groups {
        sqlx::query(
            "DELETE FROM groups WHERE id = ?1 AND group_type = 'tag'
             AND id NOT IN (SELECT group_id FROM document_groups)",
        )
        .bind(group_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await
}

/// Ensure folder groups exist for a document's path and link the document to all ancestors
fn tag_group_id(slug: &str) -> String {
    format!("tag:{slug}")
}

fn folder_group_id(source_id: &str, path: &str) -> String {
    format!("folder:{source_id}:{path}")
}

pub(crate) async fn sync_folders(
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
    let mut path_acc = String::new();

    for slug in &segments {
        if !path_acc.is_empty() {
            path_acc.push('/');
        }
        path_acc.push_str(slug);
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
                let id = folder_group_id(source_id, &path_acc);
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

const ORPHAN_TAG_GRACE_MS: i64 = 60_000;

// age guard: never collect tags younger than the grace window (may be mid-creation in the UI)
// todo: with new routing this can basically only happen when the app first opens, barely worth the
// extra code
pub async fn cleanup_orphan_tag_groups(db: &SqlitePool) -> sqlx::Result<()> {
    let cutoff = Utc::now().timestamp_millis() - ORPHAN_TAG_GRACE_MS;
    sqlx::query(
        "DELETE FROM groups WHERE group_type = 'tag'
         AND created_at < ?1
         AND id NOT IN (SELECT group_id FROM document_groups)",
    )
    .bind(cutoff)
    .execute(db)
    .await?;
    Ok(())
}

// repeatedly prune this source's folder leaves with no documents and no children
pub(crate) async fn cleanup_orphan_folder_groups(
    db: &SqlitePool,
    source_id: &str,
) -> sqlx::Result<()> {
    loop {
        let result = sqlx::query(
            "DELETE FROM groups WHERE group_type = 'folder'
             AND source_id = ?1
             AND id NOT IN (SELECT group_id FROM document_groups)
             AND id NOT IN (SELECT parent_group_id FROM groups WHERE parent_group_id IS NOT NULL)",
        )
        .bind(source_id)
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
    let old_ids: Vec<String> = sqlx::query_scalar(
        "SELECT group_id FROM document_groups WHERE document_id = ?1 AND group_id IN (SELECT id FROM groups WHERE source_id IS NULL AND group_type = 'tag')",
    )
    .bind(doc_id)
    .fetch_all(&mut **tx)
    .await?;

    // Clear existing tag associations for this document
    sqlx::query(
        "DELETE FROM document_groups WHERE document_id = ?1 AND group_id IN (SELECT id FROM groups WHERE source_id IS NULL AND group_type = 'tag')",
    )
    .bind(doc_id)
    .execute(&mut **tx)
    .await?;

    for tag in tags {
        // Upsert tag group (global)
        sqlx::query("INSERT OR IGNORE INTO groups (id, slug, group_type) VALUES (?1, ?2, 'tag')")
            .bind(tag_group_id(tag))
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

    // tags this doc just left die with their last member
    for old_id in &old_ids {
        sqlx::query(
            "DELETE FROM groups WHERE id = ?1
             AND id NOT IN (SELECT group_id FROM document_groups)",
        )
        .bind(old_id)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

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
    let mtime = fs_mtime_ms(&full);

    let mut tx = db.begin().await?;
    sqlx::query(
        "UPDATE documents SET rel_path = ?1, title = ?2, mtime = ?3, properties = ?4 WHERE id = ?5",
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
    cleanup_orphan_folder_groups(db, source_id).await?;
    Ok(())
}

// ENTRY POINT

pub async fn reconcile_source(
    source: &Source,
    db: &SqlitePool,
    extensions: &[&str],
    frontmatter_buffer_size: usize,
) -> sqlx::Result<Vec<(String, String)>> {
    use std::time::Instant;
    let t_total = Instant::now();
    let source_path = &source.path;
    let source_id = source.id.to_string();
    let source_id = source_id.as_str();

    // Ensure source row exists
    sqlx::query(
        "INSERT INTO sources (id, title, path) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, path = excluded.path",
    )
    .bind(source_id)
    .bind(&source.title)
    .bind(source_path.to_string_lossy().as_ref())
    .execute(db)
    .await?;

    let fs_entries = walk_source(source, extensions);

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
    let db_docs: HashMap<String, (String, i64)> = db_rows
        .into_iter()
        .map(|(id, path, mtime)| (id, (path, mtime)))
        .collect();

    let diff = diff_against_db(&db_entries, &fs_entries);

    let paths_to_read: Vec<String> = diff
        .new_paths
        .iter()
        .map(|(p, _)| p.clone())
        .chain(diff.modified.iter().map(|(p, _)| p.clone()))
        .collect();
    let frontmatter = extract_frontmatter(source_path, &paths_to_read, frontmatter_buffer_size);

    let foreign_ids: HashSet<String> =
        sqlx::query_scalar("SELECT id FROM documents WHERE source_id != ?1")
            .bind(source_id)
            .fetch_all(db)
            .await?
            .into_iter()
            .collect();

    let plan = resolve_plan(&diff, &frontmatter, &db_docs, &foreign_ids);
    let ops_count = plan.docs.len() + plan.delete_ids.len();

    apply_plan(&plan, &frontmatter, source_id, source_path, db).await?;
    cleanup_orphan_folder_groups(db, source_id).await?;

    eprintln!(
        "[reconcile:{}] {}ms | {} files, {} cached, {} ops",
        source.title,
        t_total.elapsed().as_millis(),
        fs_entries.len(),
        db_entries.len(),
        ops_count
    );
    Ok(plan
        .docs
        .iter()
        .map(|d| (d.id.clone(), d.rel_path.clone()))
        .collect())
}

// ── Tests ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fm(id: &str) -> Option<serde_json::Value> {
        Some(json!({ "id": id }))
    }

    fn plan(
        unchanged: &[&str],
        modified: &[&str],
        new_paths: &[&str],
        missing: &[&str],
        frontmatter: &[(&str, Option<serde_json::Value>)],
        db: &[(&str, &str)],
        foreign: &[&str],
    ) -> ReconcilePlan {
        let diff = ReconciliationDiff {
            unchanged: unchanged.iter().map(|s| s.to_string()).collect(),
            modified: modified.iter().map(|s| (s.to_string(), 1)).collect(),
            new_paths: new_paths.iter().map(|s| (s.to_string(), 1)).collect(),
            missing: missing.iter().map(|s| s.to_string()).collect(),
        };
        let frontmatter: Vec<(String, Option<serde_json::Value>)> = frontmatter
            .iter()
            .map(|(p, f)| (p.to_string(), f.clone()))
            .collect();
        let db_docs: HashMap<String, (String, i64)> = db
            .iter()
            .map(|(id, p)| (id.to_string(), (p.to_string(), 0)))
            .collect();
        let foreign_ids: HashSet<String> = foreign.iter().map(|s| s.to_string()).collect();
        resolve_plan(&diff, &frontmatter, &db_docs, &foreign_ids)
    }

    fn doc<'a>(p: &'a ReconcilePlan, path: &str) -> &'a ResolvedDoc {
        p.docs.iter().find(|d| d.rel_path == path).unwrap()
    }

    #[test]
    fn duplicate_of_unchanged_file_gets_fresh_id() {
        let p = plan(
            &["a.md"],
            &[],
            &["a copy.md"],
            &[],
            &[("a copy.md", fm("id-a"))],
            &[("id-a", "a.md")],
            &[],
        );
        let d = doc(&p, "a copy.md");
        assert_ne!(d.id, "id-a");
        assert!(d.rewrite_id);
        assert!(!d.existing);
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn duplicate_of_modified_holder_loses_to_holder() {
        let p = plan(
            &[],
            &["a.md"],
            &["a copy.md"],
            &[],
            &[("a.md", fm("id-a")), ("a copy.md", fm("id-a"))],
            &[("id-a", "a.md")],
            &[],
        );
        assert_eq!(doc(&p, "a.md").id, "id-a");
        assert!(doc(&p, "a copy.md").rewrite_id);
    }

    #[test]
    fn pure_swap_moves_both_rows() {
        let p = plan(
            &[],
            &["a.md", "b.md"],
            &[],
            &[],
            &[("a.md", fm("id-b")), ("b.md", fm("id-a"))],
            &[("id-a", "a.md"), ("id-b", "b.md")],
            &[],
        );
        let a = doc(&p, "a.md");
        let b = doc(&p, "b.md");
        assert_eq!(a.id, "id-b");
        assert_eq!(b.id, "id-a");
        assert!(a.moved && b.moved);
        assert!(a.existing && b.existing);
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn replaced_content_inserts_new_id_and_deletes_old() {
        let p = plan(
            &[],
            &["a.md"],
            &[],
            &[],
            &[("a.md", fm("id-new"))],
            &[("id-old", "a.md")],
            &[],
        );
        let d = doc(&p, "a.md");
        assert_eq!(d.id, "id-new");
        assert!(!d.existing);
        assert_eq!(p.delete_ids, vec!["id-old".to_string()]);
    }

    #[test]
    fn rename_is_a_move_not_delete_insert() {
        let p = plan(
            &[],
            &[],
            &["b.md"],
            &["a.md"],
            &[("b.md", fm("id-a"))],
            &[("id-a", "a.md")],
            &[],
        );
        let d = doc(&p, "b.md");
        assert_eq!(d.id, "id-a");
        assert!(d.existing && d.moved);
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn vacated_path_gets_indexed_same_pass() {
        let p = plan(
            &[],
            &["a.md"],
            &["c.md"],
            &[],
            &[("a.md", fm("id-2")), ("c.md", fm("id-1"))],
            &[("id-1", "a.md")],
            &[],
        );
        assert_eq!(doc(&p, "c.md").id, "id-1");
        assert!(doc(&p, "c.md").moved);
        let a = doc(&p, "a.md");
        assert_eq!(a.id, "id-2");
        assert!(!a.existing);
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn cross_source_copy_gets_fresh_id() {
        let p = plan(
            &[],
            &[],
            &["a.md"],
            &[],
            &[("a.md", fm("id-elsewhere"))],
            &[],
            &["id-elsewhere"],
        );
        let d = doc(&p, "a.md");
        assert_ne!(d.id, "id-elsewhere");
        assert!(d.rewrite_id);
    }

    #[test]
    fn claimless_modified_keeps_row_and_missing_deletes() {
        let p = plan(
            &[],
            &["a.md"],
            &[],
            &["gone.md"],
            &[("a.md", None)],
            &[("id-a", "a.md"), ("id-gone", "gone.md")],
            &[],
        );
        let d = doc(&p, "a.md");
        assert_eq!(d.id, "id-a");
        assert!(d.existing && !d.moved && !d.rewrite_id);
        assert_eq!(p.delete_ids, vec!["id-gone".to_string()]);
    }
}
