//! ── Overview BAF (Big Ass File) ──────────────────────────────────────────────────────────
//! This contains, broadly:
//! 1. The source data model definition, config, & associated helpers
//! 2. source scanning and reconciliation logic (big and ugly)
//!
//! Due to the size of the file, I will give a brief overview here.
//!
//! *Source Model*
//!
//! Okay, so, a 'source' is a saved folder resource for the app. It is a static path that is indexed
//! by limestone and made accessible and searchable to the user -- an added folder.
//!
//! Per source, there is basic metadata, a UUID for db reference, and a config file in the
//! source's .limestone folder.
//!
//! *Scan & Reconciliation*
//!
//! Little complicated, but basically:
//! PER SOURCE, IN PARALLEL
//! 1. Walks source dir, collecting dirs and rel_path (to source) + mtime for *.md documents
//! 2. Loads all documents from the db (cache)
//! 3. Diffs source dir to db documents
//!     - same path AND same mtime => unchanged
//!     - same path AND NOT same mtime => modified
//!     - on disk but not found in db (by rel_path) => new_paths
//!     - in db but not found on disk => missing, delete from cache
//!       -> later can prompt to restore for autpmerge history in UI, and allows a better missing
//!       doc page
//! 4. Resolve id-first for each read file, dupes get re-keyed
//! 5. Read each resolved document's metadata, quickly ideally
//! 6. Commit changes
//! 7. Cleanup orphaned tags
//!

use crate::services::body::{fold_tag, lookalikes, LOOKALIKE_MAX_PAIRS};
use crate::services::frontmatter;
use crate::services::fs::{
    atomic_write, birth_ms, clean_location, doc_dir, docs_root, has_history, mtime_ms, read_meta,
    repath_meta, rewrite_meta, touch_meta, META_FILE,
};
use crate::services::metadata::{self, Head};
use chrono::prelude::{DateTime, Utc};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use uuid::Uuid;

// ── Model ────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize, Serialize, Clone, PartialEq, Debug)]
pub struct SourceConfig {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note_location: String,
    #[serde(
        default = "default_asset_location",
        skip_serializing_if = "is_default_asset_location"
    )]
    pub asset_location: String,
    #[serde(default = "default_ignore", skip_serializing_if = "is_default_ignore")]
    pub ignore: Vec<String>,
}

impl Default for SourceConfig {
    fn default() -> Self {
        Self {
            note_location: String::new(),
            asset_location: default_asset_location(),
            ignore: default_ignore(),
        }
    }
}

impl SourceConfig {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct SourceRecord {
    pub title: String,
    pub path: PathBuf,
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub accessed_at: DateTime<Utc>,
}

#[derive(Serialize, Clone)]
pub struct Source {
    pub title: String,
    pub path: PathBuf,
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub accessed_at: DateTime<Utc>,
    pub note_location: String,
    pub asset_location: String,
    pub ignore: Vec<String>,
}

impl Source {
    pub fn new(title: String, path: PathBuf) -> Self {
        let now = Utc::now();
        let record = SourceRecord {
            title,
            path,
            id: Uuid::new_v4(),
            created_at: now,
            accessed_at: now,
        };
        Self::from_parts(record, SourceConfig::default())
    }

    pub fn from_parts(record: SourceRecord, config: SourceConfig) -> Self {
        Self {
            title: record.title,
            path: record.path,
            id: record.id,
            created_at: record.created_at,
            accessed_at: record.accessed_at,
            note_location: config.note_location,
            asset_location: config.asset_location,
            ignore: config.ignore,
        }
    }

    pub fn record(&self) -> SourceRecord {
        SourceRecord {
            title: self.title.clone(),
            path: self.path.clone(),
            id: self.id,
            created_at: self.created_at,
            accessed_at: self.accessed_at,
        }
    }

    pub fn config(&self) -> SourceConfig {
        SourceConfig {
            note_location: self.note_location.clone(),
            asset_location: self.asset_location.clone(),
            ignore: self.ignore.clone(),
        }
    }
}

pub fn source_config_path(source_path: &Path) -> PathBuf {
    source_path.join(".limestone").join("config.json")
}

pub fn load_source_config(source_path: &Path) -> Option<SourceConfig> {
    let text = fs::read_to_string(source_config_path(source_path)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_source_config(source_path: &Path, config: &SourceConfig) -> std::io::Result<()> {
    let path = source_config_path(source_path);
    if config.is_default() {
        return match fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    let json = serde_json::to_string_pretty(config)?;
    atomic_write(&path, json.as_bytes())
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
    pub sources: Vec<SourceRecord>,
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

fn is_default_asset_location(v: &str) -> bool {
    v == "assets"
}

fn default_ignore() -> Vec<String> {
    vec![".*".to_string()]
}

fn is_default_ignore(v: &[String]) -> bool {
    v == [".*"]
}

pub fn create_source(
    title: Option<String>,
    path: PathBuf,
    note_location: Option<String>,
    asset_location: Option<String>,
) -> Result<Source, std::io::Error> {
    fs::create_dir_all(&path)?;
    let title = title.unwrap_or_else(|| {
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });

    let mut source = Source::new(title, path);
    source.note_location = clean_location(&note_location.unwrap_or_default())?;
    source.asset_location = clean_location(&asset_location.unwrap_or_else(default_asset_location))?;
    Ok(source)
}

// ── The Big Scan ─────────────────────────────────────────────────────────────────────

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
    pub created_at: Option<i64>,
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

fn keep_dir(rel_path: &str, ignore: Option<&globset::GlobSet>) -> bool {
    let name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    if name.starts_with('.') {
        return false;
    }
    ignore.is_none_or(|g| !g.is_match(rel_path))
}

pub const VIEW_FILE: &str = ".limestone.view.json";

pub struct WalkResult {
    pub files: Vec<(String, i64)>,
    pub sizes: HashMap<String, u64>,
    pub dirs: Vec<String>,
    pub repos: HashSet<String>,
    pub views: HashSet<String>,
    pub skipped: usize,
}

/// Walk the source directory and collect (rel_path, mtime) for files w/ ignore + dirs
pub fn walk_source(source: &Source, extensions: &[&str]) -> WalkResult {
    let source_path = &source.path;
    let ignore = build_ignore(source);
    let mut files = Vec::new();
    let mut sizes = HashMap::new();
    let mut dirs = Vec::new();
    let mut skipped = 0;

    let prune_ignore = ignore.clone();
    let prune_root = source_path.clone();
    let found_repos = Arc::new(Mutex::new(HashSet::new()));
    let repo_sink = found_repos.clone();
    let found_views = Arc::new(Mutex::new(HashSet::new()));
    let view_sink = found_views.clone();
    let walker = jwalk::WalkDir::new(source_path)
        .sort(true)
        .skip_hidden(false)
        .process_read_dir(move |_depth, path, _state, children| {
            let is_repo = children
                .iter()
                .any(|e| e.as_ref().is_ok_and(|e| e.file_name == ".git"));
            let has_view = children
                .iter()
                .any(|e| e.as_ref().is_ok_and(|e| e.file_name == VIEW_FILE));
            if is_repo || has_view {
                if let Ok(rel) = path.strip_prefix(&prune_root) {
                    let rel_path = rel.to_string_lossy().replace('\\', "/");
                    if is_repo {
                        repo_sink.lock().unwrap().insert(rel_path.clone());
                    }
                    if has_view {
                        view_sink.lock().unwrap().insert(rel_path);
                    }
                }
            }
            children.retain(|entry| {
                let Ok(entry) = entry else { return true };
                if !entry.file_type().is_dir() {
                    return !entry.file_name.to_string_lossy().starts_with('.');
                }
                let path = entry.path();
                let Ok(rel) = path.strip_prefix(&prune_root) else {
                    return true;
                };
                let rel_path = rel.to_string_lossy().replace('\\', "/");
                keep_dir(&rel_path, prune_ignore.as_ref())
            });
        });

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        if entry.file_type().is_dir() {
            let Ok(rel) = path.strip_prefix(source_path) else {
                continue;
            };
            if rel.as_os_str().is_empty() {
                continue;
            }
            if rel.to_str().is_none() {
                skipped += 1;
                continue;
            }
            dirs.push(rel.to_string_lossy().replace('\\', "/"));
            continue;
        }

        if !entry.file_type().is_file() {
            continue;
        }

        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        if !extensions
            .iter()
            .any(|&allowed| allowed.eq_ignore_ascii_case(ext))
        {
            continue;
        }

        let Ok(rel) = path.strip_prefix(source_path) else {
            continue;
        };
        let rel_path = rel.to_string_lossy().replace('\\', "/");

        if let Some(ref ignore) = ignore {
            if ignore.is_match(&rel_path) {
                continue;
            }
        }

        if rel.to_str().is_none() {
            skipped += 1;
            continue;
        }

        let meta = entry.metadata().ok();
        let mtime = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        if let Some(m) = meta.filter(|_| !ext.eq_ignore_ascii_case("md")) {
            sizes.insert(rel_path.clone(), m.len());
        }

        files.push((rel_path, mtime));
    }

    let repos = std::mem::take(&mut *found_repos.lock().unwrap());
    let views = std::mem::take(&mut *found_views.lock().unwrap());
    WalkResult {
        files,
        sizes,
        dirs,
        repos,
        views,
        skipped,
    }
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

pub fn read_heads(
    source_path: &Path,
    docs: &[ResolvedDoc],
    buffer_size: usize,
) -> Vec<(String, Head)> {
    docs.par_iter()
        .map(|doc| {
            let head = metadata::read(source_path, &doc.id, &doc.rel_path, buffer_size);
            (doc.rel_path.clone(), head)
        })
        .collect()
}

// Id-first resolution: every read (new/modified) file resolves to exactly one document id
pub fn resolve_plan(
    diff: &ReconciliationDiff,
    db_docs: &HashMap<String, (String, i64)>,
    deleted_ids: &HashSet<String>,
    seeds: &HashMap<String, (String, i64)>,
    renames: &[(String, String)],
    lookalikes: &[(String, String)],
) -> ReconcilePlan {
    let mut by_path: HashMap<&str, &str> = HashMap::new();
    for live in [false, true] {
        for (id, (path, _)) in db_docs {
            if deleted_ids.contains(id) != live {
                by_path.insert(path.as_str(), id.as_str());
            }
        }
    }
    let resolved = |id: &str, path: &str, mtime: i64| ResolvedDoc {
        id: id.to_string(),
        rel_path: path.to_string(),
        mtime,
        db_mtime: db_docs.get(id).map(|(_, m)| *m),
        existing: true,
        moved: db_docs.get(id).is_some_and(|(p, _)| p != path),
        created_at: None,
    };

    let mut docs: Vec<ResolvedDoc> = diff
        .modified
        .iter()
        .filter_map(|(path, mtime)| Some(resolved(by_path.get(path.as_str())?, path, *mtime)))
        .collect();

    let mut vacated: HashMap<i64, Vec<&str>> = HashMap::new();
    for path in &diff.missing {
        if let Some(&id) = by_path.get(path.as_str()) {
            if let Some((_, mtime)) = db_docs.get(id).filter(|(_, m)| *m != 0) {
                vacated.entry(*mtime).or_default().push(id);
            }
        }
    }
    let mut arrivals: HashMap<i64, usize> = HashMap::new();
    for (_, mtime) in &diff.new_paths {
        *arrivals.entry(*mtime).or_default() += 1;
    }
    let mut hinted: HashMap<String, &str> = HashMap::new();
    for (from, to) in renames {
        for path in &diff.missing {
            let moved = if path == from {
                to.clone()
            } else if let Some(rest) = path
                .strip_prefix(from.as_str())
                .and_then(|r| r.strip_prefix('/'))
            {
                format!("{to}/{rest}")
            } else {
                continue;
            };
            if let Some(&id) = by_path
                .get(path.as_str())
                .filter(|id| !deleted_ids.contains(**id))
            {
                hinted.insert(moved, id);
            }
        }
    }
    let mut lookalike: HashMap<&str, &str> = HashMap::new();
    for (from, to) in lookalikes {
        if let Some(&id) = by_path
            .get(from.as_str())
            .filter(|id| !deleted_ids.contains(**id))
        {
            lookalike.insert(to, id);
        }
    }
    let mut taken: HashSet<&str> = HashSet::new();
    let mut ids: Vec<Option<&str>> = diff
        .new_paths
        .iter()
        .map(|(path, mtime)| {
            let renamed = match vacated.get(mtime).map(Vec::as_slice) {
                Some([id]) if arrivals[mtime] == 1 => Some(*id),
                _ => None,
            };
            hinted
                .get(path.as_str())
                .copied()
                .or_else(|| {
                    by_path
                        .get(path.as_str())
                        .copied()
                        .filter(|id| deleted_ids.contains(*id))
                })
                .or_else(|| seeds.get(path.as_str()).map(|(id, _)| id.as_str()))
                .or(renamed)
                .filter(|id| taken.insert(id))
        })
        .collect();
    for (slot, (path, _)) in ids.iter_mut().zip(&diff.new_paths) {
        if slot.is_none() {
            *slot = lookalike
                .get(path.as_str())
                .copied()
                .filter(|id| taken.insert(id));
        }
    }
    for ((path, mtime), id) in diff.new_paths.iter().zip(ids) {
        docs.push(match id {
            Some(id) if db_docs.contains_key(id) => resolved(id, path, *mtime),
            _ => {
                let seed = id.map(|id| (id, seeds[path.as_str()].1));
                ResolvedDoc {
                    id: seed.map_or_else(|| Uuid::new_v4().to_string(), |(id, _)| id.to_string()),
                    rel_path: path.to_string(),
                    mtime: *mtime,
                    db_mtime: None,
                    existing: false,
                    moved: false,
                    created_at: seed.map(|(_, created)| created),
                }
            }
        });
    }

    let keep: HashSet<&str> = docs
        .iter()
        .map(|d| d.id.as_str())
        .chain(
            diff.unchanged
                .iter()
                .filter_map(|p| by_path.get(p.as_str()).copied()),
        )
        .collect();
    let delete_ids: Vec<String> = db_docs
        .keys()
        .filter(|id| !keep.contains(id.as_str()) && !deleted_ids.contains(id.as_str()))
        .cloned()
        .collect();

    ReconcilePlan { docs, delete_ids }
}

/// Read the file's creation time, fall back to mtime if the
/// platform/filesystem doent expose it
fn fs_birth_ms(path: &Path, fallback_mtime: i64) -> i64 {
    birth_ms(path).unwrap_or(fallback_mtime)
}

pub(crate) fn document_type(rel_path: &str) -> &'static str {
    match rel_path.rsplit_once('.') {
        Some((_, ext)) if ext.eq_ignore_ascii_case("pdf") => "pdf",
        _ => "md",
    }
}

fn fs_mtime_ms(path: &Path) -> i64 {
    mtime_ms(path).unwrap_or(0)
}

pub async fn apply_plan(
    plan: &ReconcilePlan,
    heads: &[(String, Head)],
    source_id: &str,
    source_path: &Path,
    db: &SqlitePool,
) -> sqlx::Result<()> {
    let head_at: HashMap<&str, &Head> = heads
        .iter()
        .map(|(path, head)| (path.as_str(), head))
        .collect();

    let mut tx = db.begin().await?;

    let now = Utc::now().timestamp_millis();
    let mut unlinked_tags: Vec<String> = Vec::new();
    for id in &plan.delete_ids {
        if has_history(&doc_dir(source_path, id)) {
            sqlx::query("UPDATE documents SET deleted_at = ?1 WHERE id = ?2")
                .bind(now)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            continue;
        }
        let _ = touch_meta(source_path, id);
        let tag_ids: Vec<String> =
            sqlx::query_scalar("SELECT tag_id FROM document_tags WHERE document_id = ?1")
                .bind(id)
                .fetch_all(&mut *tx)
                .await?;
        unlinked_tags.extend(tag_ids);
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
        let head = head_at.get(doc.rel_path.as_str()).copied();
        let meta = head.and_then(Head::value);
        let broken = head.is_some_and(Head::broken);
        let title = Path::new(&doc.rel_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled");
        let properties = (!broken).then(|| {
            meta.map(metadata::properties)
                .unwrap_or_else(|| "{}".to_string())
        });
        let mtime = doc.mtime;
        let updated_at = metadata::date(meta, "updated_at").unwrap_or(mtime);

        let wrote = if doc.existing {
            sqlx::query(
                "UPDATE documents SET rel_path = ?1, title = ?2, mtime = ?3, properties = coalesce(?4, properties),
                     updated_at = ?5, deleted_at = NULL
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
            let created_at = metadata::date(meta, "created_at")
                .or(doc.created_at)
                .unwrap_or_else(|| fs_birth_ms(&source_path.join(&doc.rel_path), mtime));
            let accessed_at = metadata::date(meta, "accessed_at").unwrap_or(mtime);
            sqlx::query(
                "INSERT INTO documents (id, source_id, rel_path, title, mtime, properties, created_at, updated_at, accessed_at, document_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .bind(&doc.id)
            .bind(source_id)
            .bind(&doc.rel_path)
            .bind(title)
            .bind(mtime)
            .bind(properties.as_deref().unwrap_or("{}"))
            .bind(created_at)
            .bind(updated_at)
            .bind(accessed_at)
            .bind(document_type(&doc.rel_path))
            .execute(&mut *tx)
            .await?
            .rows_affected()
                > 0
        };

        // a lost write means a race edit is faster
        if wrote {
            if !broken {
                sync_tags(&mut tx, &doc.id, &metadata::tags(meta)).await?;
            }
            sync_folders(&mut tx, source_id, &doc.id, &doc.rel_path).await?;
            if doc.moved {
                let _ = repath_meta(source_path, &doc.id, &doc.rel_path);
            }
            if !metadata::in_file(&doc.rel_path) {
                let _ = rewrite_meta(source_path, &doc.id, &doc.rel_path, |_| {});
            }
        }
    }

    for id in &unlinked_tags {
        sqlx::query(
            "DELETE FROM tags WHERE id = ?1
             AND id NOT IN (SELECT tag_id FROM document_tags)",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await
}

pub(crate) fn tag_id(slug: &str) -> String {
    format!("tag:{}", fold_tag(slug))
}

pub(crate) fn folder_id(source_id: &str, path: &str) -> String {
    format!("folder:{source_id}:{path}")
}

/// Point a document at its folder, creating the folder chain if the walk has not yet.
pub(crate) async fn sync_folders(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_id: &str,
    doc_id: &str,
    rel_path: &str,
) -> sqlx::Result<()> {
    let segments: Vec<&str> = Path::new(rel_path)
        .parent()
        .map(|p| {
            p.components()
                .filter_map(|c| c.as_os_str().to_str())
                .collect()
        })
        .unwrap_or_default();

    // every ancestor has to exist before the leaf can reference it as a parent
    let mut path_acc = String::new();
    let mut id = upsert_folder(tx, source_id, "").await?;
    for slug in &segments {
        if !path_acc.is_empty() {
            path_acc.push('/');
        }
        path_acc.push_str(slug);
        id = upsert_folder(tx, source_id, &path_acc).await?;
    }

    sqlx::query("UPDATE documents SET folder_id = ?1 WHERE id = ?2")
        .bind(&id)
        .bind(doc_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

const ORPHAN_TAG_GRACE_MS: i64 = 60_000;

// age guard: never collect tags younger than the grace window (may be mid-creation in the UI)
// todo: with new routing this can basically only happen when the app first opens, barely worth the
// extra code
pub async fn cleanup_orphan_tags(db: &SqlitePool) -> sqlx::Result<()> {
    let cutoff = Utc::now().timestamp_millis() - ORPHAN_TAG_GRACE_MS;
    sqlx::query(
        "DELETE FROM tags WHERE created_at < ?1
         AND id NOT IN (SELECT tag_id FROM document_tags)",
    )
    .bind(cutoff)
    .execute(db)
    .await?;
    Ok(())
}

fn folder_parent_and_slug(path: &str) -> (Option<&str>, &str) {
    match path.rsplit_once('/') {
        Some((parent, slug)) => (Some(parent), slug),
        None if path.is_empty() => (None, path), // the source root, the only parentless folder
        None => (Some(""), path),
    }
}

pub(crate) async fn upsert_folder(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_id: &str,
    path: &str,
) -> sqlx::Result<String> {
    let id = folder_id(source_id, path);
    let (parent, slug) = folder_parent_and_slug(path);
    let parent_id = parent.map(|p| folder_id(source_id, p));
    sqlx::query(
        "INSERT INTO folders (id, source_id, slug, parent_id)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT DO NOTHING",
    )
    .bind(&id)
    .bind(source_id)
    .bind(slug)
    .bind(parent_id.as_deref())
    .execute(&mut **tx)
    .await?;
    Ok(id)
}

/// Reconcile this source's folders against the walked directory set (disk is truth).
/// `dirs` must be ordered parent-before-child.
pub(crate) async fn sync_folder_dirs(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_id: &str,
    dirs: &[String],
    repos: &HashSet<String>,
    views: &HashSet<String>,
) -> sqlx::Result<()> {
    let mut expected: HashSet<String> = HashSet::with_capacity(dirs.len() + 1);
    expected.insert(upsert_folder(tx, source_id, "").await?);
    for path in dirs {
        expected.insert(upsert_folder(tx, source_id, path).await?);
    }

    let repo_ids: Vec<String> = repos.iter().map(|p| folder_id(source_id, p)).collect();
    sqlx::query(
        "UPDATE folders SET repo = (id IN (SELECT value FROM json_each(?2)))
         WHERE source_id = ?1 AND repo <> (id IN (SELECT value FROM json_each(?2)))",
    )
    .bind(source_id)
    .bind(serde_json::to_string(&repo_ids).unwrap_or_default())
    .execute(&mut **tx)
    .await?;

    let view_ids: Vec<String> = views.iter().map(|p| folder_id(source_id, p)).collect();
    sqlx::query(
        "UPDATE folders SET view = (id IN (SELECT value FROM json_each(?2)))
         WHERE source_id = ?1 AND view <> (id IN (SELECT value FROM json_each(?2)))",
    )
    .bind(source_id)
    .bind(serde_json::to_string(&view_ids).unwrap_or_default())
    .execute(&mut **tx)
    .await?;

    let existing: Vec<String> = sqlx::query_scalar("SELECT id FROM folders WHERE source_id = ?1")
        .bind(source_id)
        .fetch_all(&mut **tx)
        .await?;
    for id in existing {
        if !expected.contains(&id) {
            sqlx::query("DELETE FROM folders WHERE id = ?1")
                .bind(&id)
                .execute(&mut **tx)
                .await?;
        }
    }

    Ok(())
}

/// Sync tags from metadata into the tags table (tags are global)
pub(crate) async fn sync_tags(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    doc_id: &str,
    tags: &[String],
) -> sqlx::Result<()> {
    let old_ids: Vec<String> =
        sqlx::query_scalar("SELECT tag_id FROM document_tags WHERE document_id = ?1")
            .bind(doc_id)
            .fetch_all(&mut **tx)
            .await?;

    // Clear existing tag associations for this document
    sqlx::query("DELETE FROM document_tags WHERE document_id = ?1")
        .bind(doc_id)
        .execute(&mut **tx)
        .await?;

    for tag in tags {
        let slug = fold_tag(tag);
        if slug.is_empty() {
            continue;
        }
        let id = tag_id(&slug);
        sqlx::query("INSERT OR IGNORE INTO tags (id, slug) VALUES (?1, ?2)")
            .bind(&id)
            .bind(&slug)
            .execute(&mut **tx)
            .await?;

        sqlx::query("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?1, ?2)")
            .bind(doc_id)
            .bind(&id)
            .execute(&mut **tx)
            .await?;
    }

    // tags this doc just left die with their last member
    for old_id in &old_ids {
        sqlx::query(
            "DELETE FROM tags WHERE id = ?1
             AND id NOT IN (SELECT tag_id FROM document_tags)",
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
    let head = metadata::read(source_path, doc_id, rel_path, fm_buffer_size);
    let title = Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled");
    let properties = (!head.broken()).then(|| {
        head.value()
            .map(metadata::properties)
            .unwrap_or_else(|| "{}".to_string())
    });
    let mtime = fs_mtime_ms(&full);

    let mut tx = db.begin().await?;
    sqlx::query(
        "UPDATE documents SET rel_path = ?1, title = ?2, mtime = ?3, properties = coalesce(?4, properties) WHERE id = ?5",
    )
    .bind(rel_path)
    .bind(title)
    .bind(mtime)
    .bind(&properties)
    .bind(doc_id)
    .execute(&mut *tx)
    .await?;

    sync_folders(&mut tx, source_id, doc_id, rel_path).await?;
    if let Some(meta) = head.value() {
        sync_tags(&mut tx, doc_id, &metadata::tags(Some(meta))).await?;
    }

    tx.commit().await?;
    Ok(())
}

fn twins(gone: &[(&str, (i64, u64))], here: &[(&str, (i64, u64))]) -> Vec<(String, String)> {
    let count = |side: &[(&str, (i64, u64))]| {
        let mut n: HashMap<(i64, u64), usize> = HashMap::new();
        for (_, key) in side {
            *n.entry(*key).or_default() += 1;
        }
        n
    };
    let (gone_n, here_n) = (count(gone), count(here));
    let by_key: HashMap<(i64, u64), &str> = here.iter().map(|(p, k)| (*k, *p)).collect();
    gone.iter()
        .filter(|(_, k)| gone_n[k] == 1 && here_n.get(k) == Some(&1))
        .map(|(p, k)| (p.to_string(), by_key[k].to_string()))
        .collect()
}

// ENTRY POINT

fn read_seeds(
    source_path: &Path,
    db_docs: &HashMap<String, (String, i64)>,
) -> HashMap<String, (String, i64)> {
    let mut seeds: HashMap<String, (String, i64)> = HashMap::new();
    for entry in fs::read_dir(docs_root(source_path))
        .into_iter()
        .flatten()
        .flatten()
    {
        let id = entry.file_name().to_string_lossy().into_owned();
        if Uuid::parse_str(&id).is_err() || db_docs.contains_key(&id) {
            continue;
        }
        let Some(meta) = read_meta(&entry.path()) else {
            continue;
        };
        let seed = seeds
            .entry(meta.rel_path)
            .or_insert((String::new(), i64::MIN));
        if meta.created_at > seed.1 {
            *seed = (id, meta.created_at);
        }
    }
    seeds
}

pub async fn reconcile_source(
    source: &Source,
    db: &SqlitePool,
    extensions: &[&str],
    frontmatter_buffer_size: usize,
    renames: &[(String, String)],
) -> sqlx::Result<(Vec<(String, String)>, usize)> {
    use std::time::Instant;
    let t_total = Instant::now();
    let source_path = &source.path;
    let source_id = source.id.to_string();
    let source_id = source_id.as_str();

    // unreachable root: skip instead of recc (will WRECK your shit, deleting all your notes)
    if !source_path.is_dir() {
        eprintln!(
            "[reconcile:{}] source path unreachable, skipping",
            source.title
        );
        return Ok(Default::default());
    }

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

    let WalkResult {
        files: fs_entries,
        sizes,
        dirs: fs_dirs,
        repos,
        views,
        skipped,
    } = walk_source(source, extensions);

    let mut tx = db.begin().await?;
    sync_folder_dirs(&mut tx, source_id, &fs_dirs, &repos, &views).await?;
    tx.commit().await?;

    let db_rows: Vec<(String, String, i64, bool)> = sqlx::query_as(
        "SELECT id, rel_path, coalesce(mtime, 0), deleted_at IS NOT NULL FROM documents WHERE source_id = ?1",
    )
    .bind(source_id)
    .fetch_all(db)
    .await?;

    let db_entries: Vec<(String, i64)> = db_rows
        .iter()
        .filter(|(_, _, _, deleted)| !deleted)
        .map(|(_, path, mtime, _)| (path.clone(), *mtime))
        .collect();
    let deleted_ids: HashSet<String> = db_rows
        .iter()
        .filter(|(_, _, _, deleted)| *deleted)
        .map(|(id, _, _, _)| id.clone())
        .collect();
    let db_docs: HashMap<String, (String, i64)> = db_rows
        .into_iter()
        .map(|(id, path, mtime, _)| (id, (path, mtime)))
        .collect();

    let live_at: HashMap<&str, &str> = db_docs
        .iter()
        .filter(|(id, _)| !deleted_ids.contains(*id))
        .map(|(id, (path, _))| (path.as_str(), id.as_str()))
        .collect();
    let fs_entries: Vec<(String, i64)> = {
        let meta_written: HashMap<&str, i64> = live_at
            .iter()
            .filter(|(path, _)| !metadata::in_file(path))
            .filter_map(|(path, id)| {
                let written = mtime_ms(&doc_dir(source_path, id).join(META_FILE))?;
                Some((*path, written))
            })
            .collect();
        fs_entries
            .into_iter()
            .map(|(p, m)| {
                let m = meta_written.get(p.as_str()).map_or(m, |w| m.max(*w));
                (p, m)
            })
            .collect()
    };
    let diff = diff_against_db(&db_entries, &fs_entries);

    let seeds = if diff.new_paths.is_empty() {
        HashMap::new()
    } else {
        read_seeds(source_path, &db_docs)
    };
    let covered = |path: &str| {
        renames.iter().any(|(from, to)| {
            [from, to].iter().any(|r| {
                path == r.as_str()
                    || path
                        .strip_prefix(r.as_str())
                        .is_some_and(|rest| rest.starts_with('/'))
            })
        })
    };
    let deleted_paths: HashSet<&str> = db_docs
        .iter()
        .filter(|(id, _)| deleted_ids.contains(*id))
        .map(|(_, (path, _))| path.as_str())
        .collect();
    let vacated: Vec<&str> = diff
        .missing
        .iter()
        .map(String::as_str)
        .filter(|p| document_type(p) == "md" && !covered(p))
        .collect();
    let arrivals: Vec<&str> = diff
        .new_paths
        .iter()
        .map(|(p, _)| p.as_str())
        .filter(|p| document_type(p) == "md" && !deleted_paths.contains(p) && !covered(p))
        .collect();
    let lookalike_pairs = if vacated.is_empty()
        || arrivals.is_empty()
        || vacated.len() * arrivals.len() > LOOKALIKE_MAX_PAIRS
    {
        Vec::new()
    } else {
        let mut gone = Vec::new();
        for path in vacated {
            let body: Option<String> = sqlx::query_scalar(
                "SELECT f.body FROM documents_fts f JOIN documents d ON d.rowid = f.rowid
                 WHERE d.source_id = ?1 AND d.rel_path = ?2 AND d.deleted_at IS NULL",
            )
            .bind(source_id)
            .bind(path)
            .fetch_optional(db)
            .await?;
            if let Some(body) = body {
                gone.push((path.to_string(), body));
            }
        }
        let here: Vec<(String, String)> = arrivals
            .into_iter()
            .filter_map(|path| {
                let text = fs::read_to_string(source_path.join(path)).ok()?;
                Some((
                    path.to_string(),
                    frontmatter::split_content(&text).1.to_string(),
                ))
            })
            .collect();
        lookalikes(&gone, &here)
    };
    let gone: Vec<(&str, (i64, u64))> = diff
        .missing
        .iter()
        .map(String::as_str)
        .filter(|p| document_type(p) != "md" && !covered(p))
        .filter_map(|p| {
            let meta = read_meta(&doc_dir(source_path, live_at.get(p)?))?;
            Some((p, (meta.mtime?, meta.size?)))
        })
        .collect();
    let here: Vec<(&str, (i64, u64))> = diff
        .new_paths
        .iter()
        .filter(|(p, _)| {
            document_type(p) != "md" && !deleted_paths.contains(p.as_str()) && !covered(p)
        })
        .filter_map(|(p, m)| Some((p.as_str(), (*m, *sizes.get(p)?))))
        .collect();
    let lookalike_pairs = [lookalike_pairs, twins(&gone, &here)].concat();
    let plan = resolve_plan(
        &diff,
        &db_docs,
        &deleted_ids,
        &seeds,
        renames,
        &lookalike_pairs,
    );
    let ops_count = plan.docs.len() + plan.delete_ids.len();

    let heads = read_heads(source_path, &plan.docs, frontmatter_buffer_size);
    apply_plan(&plan, &heads, source_id, source_path, db).await?;

    eprintln!(
        "[reconcile:{}] {}ms | {} files, {} cached, {} ops, {} skipped",
        source.title,
        t_total.elapsed().as_millis(),
        fs_entries.len(),
        db_entries.len(),
        ops_count,
        skipped
    );
    Ok((
        plan.docs
            .iter()
            .map(|d| (d.id.clone(), d.rel_path.clone()))
            .collect(),
        skipped,
    ))
}

// ── Tests ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(
        unchanged: &[&str],
        modified: &[(&str, i64)],
        new_paths: &[(&str, i64)],
        missing: &[&str],
        db: &[(&str, &str, i64)],
        deleted: &[&str],
    ) -> ReconcilePlan {
        let diff = ReconciliationDiff {
            unchanged: unchanged.iter().map(|s| s.to_string()).collect(),
            modified: modified.iter().map(|(s, m)| (s.to_string(), *m)).collect(),
            new_paths: new_paths.iter().map(|(s, m)| (s.to_string(), *m)).collect(),
            missing: missing.iter().map(|s| s.to_string()).collect(),
        };
        let db_docs: HashMap<String, (String, i64)> = db
            .iter()
            .map(|(id, p, m)| (id.to_string(), (p.to_string(), *m)))
            .collect();
        let deleted_ids: HashSet<String> = deleted.iter().map(|s| s.to_string()).collect();
        resolve_plan(&diff, &db_docs, &deleted_ids, &HashMap::new(), &[], &[])
    }

    fn doc<'a>(p: &'a ReconcilePlan, path: &str) -> &'a ResolvedDoc {
        p.docs.iter().find(|d| d.rel_path == path).unwrap()
    }

    #[test]
    fn modified_keeps_its_row_and_missing_deletes() {
        let p = plan(
            &[],
            &[("a.md", 2)],
            &[],
            &["gone.md"],
            &[("id-a", "a.md", 1), ("id-gone", "gone.md", 1)],
            &[],
        );
        let d = doc(&p, "a.md");
        assert_eq!(d.id, "id-a");
        assert!(d.existing && !d.moved);
        assert_eq!(p.delete_ids, vec!["id-gone".to_string()]);
    }

    #[test]
    fn rename_pairs_a_vacated_row_with_the_arrival_sharing_its_mtime() {
        let p = plan(
            &["b.md"],
            &[],
            &[("sub/renamed.md", 7)],
            &["a.md"],
            &[("id-a", "a.md", 7), ("id-b", "b.md", 7)],
            &[],
        );
        let d = doc(&p, "sub/renamed.md");
        assert_eq!(d.id, "id-a");
        assert!(d.existing && d.moved);
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn a_new_path_adopts_the_id_whose_meta_names_it() {
        let diff = ReconciliationDiff {
            unchanged: vec![],
            modified: vec![],
            new_paths: vec![("a.md".to_string(), 3), ("b.md".to_string(), 3)],
            missing: vec![],
        };
        let seeds: HashMap<String, (String, i64)> =
            HashMap::from([("a.md".to_string(), ("id-a".to_string(), 42))]);
        let p = resolve_plan(&diff, &HashMap::new(), &HashSet::new(), &seeds, &[], &[]);
        let a = doc(&p, "a.md");
        assert_eq!(a.id, "id-a");
        assert_eq!(a.created_at, Some(42));
        assert!(!a.existing);
        let b = doc(&p, "b.md");
        assert_ne!(b.id, "id-a");
        assert_eq!(b.created_at, None);
    }

    #[test]
    fn a_seed_outranks_an_equal_mtime_pairing() {
        let diff = ReconciliationDiff {
            unchanged: vec![],
            modified: vec![],
            new_paths: vec![("b.pdf".to_string(), 5)],
            missing: vec!["a.pdf".to_string()],
        };
        let db_docs: HashMap<String, (String, i64)> =
            HashMap::from([("id-a".to_string(), ("a.pdf".to_string(), 5))]);
        let seeds: HashMap<String, (String, i64)> =
            HashMap::from([("b.pdf".to_string(), ("id-seed".to_string(), 7))]);
        let p = resolve_plan(&diff, &db_docs, &HashSet::new(), &seeds, &[], &[]);
        let b = doc(&p, "b.pdf");
        assert_eq!(b.id, "id-seed");
        assert!(!b.existing);
        assert_eq!(b.created_at, Some(7));
        assert_eq!(p.delete_ids, vec!["id-a".to_string()]);
    }

    #[test]
    fn a_watcher_rename_pairs_regardless_of_mtime_and_covers_a_moved_folder() {
        let diff = ReconciliationDiff {
            unchanged: vec![],
            modified: vec![],
            new_paths: vec![("new.md".to_string(), 9), ("dst/deep/c.md".to_string(), 9)],
            missing: vec!["old.md".to_string(), "src/deep/c.md".to_string()],
        };
        let db_docs: HashMap<String, (String, i64)> = HashMap::from([
            ("id-old".to_string(), ("old.md".to_string(), 1)),
            ("id-c".to_string(), ("src/deep/c.md".to_string(), 2)),
        ]);
        let renames = vec![
            ("old.md".to_string(), "new.md".to_string()),
            ("src".to_string(), "dst".to_string()),
        ];
        let p = resolve_plan(
            &diff,
            &db_docs,
            &HashSet::new(),
            &HashMap::new(),
            &renames,
            &[],
        );
        let n = doc(&p, "new.md");
        assert_eq!(n.id, "id-old");
        assert!(n.existing && n.moved);
        let c = doc(&p, "dst/deep/c.md");
        assert_eq!(c.id, "id-c");
        assert!(c.existing && c.moved);
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn a_lookalike_pairs_after_every_stronger_rule_and_never_reuses_a_row() {
        let diff = ReconciliationDiff {
            unchanged: vec![],
            modified: vec![],
            new_paths: vec![("new.md".to_string(), 9), ("copy.md".to_string(), 1)],
            missing: vec!["old.md".to_string()],
        };
        let db_docs: HashMap<String, (String, i64)> =
            HashMap::from([("id-old".to_string(), ("old.md".to_string(), 1))]);
        let looks = vec![("old.md".to_string(), "new.md".to_string())];
        let p = resolve_plan(
            &diff,
            &db_docs,
            &HashSet::new(),
            &HashMap::new(),
            &[],
            &looks,
        );
        assert_eq!(doc(&p, "copy.md").id, "id-old");
        assert_ne!(doc(&p, "new.md").id, "id-old");
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn ambiguous_mtimes_never_pair() {
        let p = plan(
            &[],
            &[],
            &[("x.md", 7)],
            &["a.md", "c.md"],
            &[("id-a", "a.md", 7), ("id-c", "c.md", 7)],
            &[],
        );
        let d = doc(&p, "x.md");
        assert!(!d.existing);
        let mut deleted = p.delete_ids.clone();
        deleted.sort();
        assert_eq!(deleted, vec!["id-a".to_string(), "id-c".to_string()]);

        let p = plan(
            &[],
            &[],
            &[("x.md", 7), ("y.md", 7)],
            &["a.md"],
            &[("id-a", "a.md", 7)],
            &[],
        );
        assert!(!doc(&p, "x.md").existing && !doc(&p, "y.md").existing);
        assert_eq!(p.delete_ids, vec!["id-a".to_string()]);
    }

    #[test]
    fn unknown_mtime_never_pairs() {
        let p = plan(
            &[],
            &[],
            &[("x.md", 0)],
            &["a.md"],
            &[("id-a", "a.md", 0)],
            &[],
        );
        assert!(!doc(&p, "x.md").existing);
    }

    #[test]
    fn a_file_back_at_a_deleted_rows_path_revives_it() {
        let p = plan(
            &[],
            &[],
            &[("a.md", 3)],
            &[],
            &[("id-a", "a.md", 1)],
            &["id-a"],
        );
        let d = doc(&p, "a.md");
        assert_eq!(d.id, "id-a");
        assert!(d.existing && !d.moved);
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn a_live_row_shadows_a_deleted_one_at_the_same_path() {
        let p = plan(
            &[],
            &[("a.md", 3)],
            &[],
            &[],
            &[("id-old", "a.md", 1), ("id-new", "a.md", 2)],
            &["id-old"],
        );
        assert_eq!(doc(&p, "a.md").id, "id-new");
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn a_copy_is_a_new_doc_and_leaves_the_original_alone() {
        let p = plan(
            &["a.md"],
            &[],
            &[("a copy.md", 7)],
            &[],
            &[("id-a", "a.md", 7)],
            &[],
        );
        let d = doc(&p, "a copy.md");
        assert_ne!(d.id, "id-a");
        assert!(!d.existing);
        assert!(p.delete_ids.is_empty());
    }

    #[test]
    fn source_config_round_trips_and_default_removes_the_file() {
        let tmp = std::env::temp_dir().join(format!("ls-source-config-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        save_source_config(&tmp, &SourceConfig::default()).unwrap();
        assert!(!source_config_path(&tmp).exists());
        assert!(load_source_config(&tmp).is_none());

        let mut config = SourceConfig::default();
        config.note_location = "notes".into();
        save_source_config(&tmp, &config).unwrap();
        let text = fs::read_to_string(source_config_path(&tmp)).unwrap();
        assert!(!text.contains("asset_location"));
        assert_eq!(load_source_config(&tmp), Some(config));

        save_source_config(&tmp, &SourceConfig::default()).unwrap();
        assert!(!source_config_path(&tmp).exists());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn walk_notes_dirs_holding_a_view_file() {
        let tmp = std::env::temp_dir().join(format!("ls-walk-views-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("a/b")).unwrap();
        fs::create_dir_all(tmp.join("c")).unwrap();
        fs::write(tmp.join(VIEW_FILE), b"{}").unwrap();
        fs::write(tmp.join("a/b").join(VIEW_FILE), b"{}").unwrap();
        fs::write(tmp.join("c/note.md"), b"hi").unwrap();

        let source = Source::new("t".into(), tmp.clone());
        let walk = walk_source(&source, &["md"]);

        let mut views: Vec<String> = walk.views.into_iter().collect();
        views.sort();
        assert_eq!(views, vec!["".to_string(), "a/b".to_string()]);
        assert_eq!(walk.files.len(), 1);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn walk_picks_up_pdfs_outside_the_asset_folder() {
        let tmp = std::env::temp_dir().join(format!("ls-walk-pdfs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("assets/sub")).unwrap();
        fs::create_dir_all(tmp.join("lectures")).unwrap();
        fs::write(tmp.join("lectures/week3.PDF"), b"%PDF").unwrap();
        fs::write(tmp.join("assets/sub/slides.pdf"), b"%PDF").unwrap();
        fs::write(tmp.join("assetsx.pdf"), b"%PDF").unwrap();

        let source = Source::new("t".into(), tmp.clone());
        let mut files: Vec<String> = walk_source(&source, &["md", "pdf"])
            .files
            .into_iter()
            .map(|(p, _)| p)
            .collect();
        files.sort();
        assert_eq!(files, vec!["assetsx.pdf", "lectures/week3.PDF"]);
        assert_eq!(document_type("lectures/week3.PDF"), "pdf");
        assert_eq!(document_type("lectures/week3.md"), "md");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_binary_pairs_with_its_sole_size_and_mtime_match() {
        let gone = [("gone/a.pdf", (1, 100)), ("gone/b.pdf", (2, 200))];
        let here = [("x/moved.pdf", (1, 100)), ("x/other.pdf", (9, 100))];
        assert_eq!(
            twins(&gone, &here),
            vec![("gone/a.pdf".to_string(), "x/moved.pdf".to_string())]
        );
    }

    #[test]
    fn ambiguous_binaries_pair_nothing() {
        let a = ("gone/a.pdf", (1, 100));
        let twin = ("gone/twin.pdf", (1, 100));
        assert!(twins(&[a, twin], &[("x/moved.pdf", (1, 100))]).is_empty());
        let copies = [("x/one.pdf", (1, 100)), ("x/two.pdf", (1, 100))];
        assert!(twins(&[a], &copies).is_empty());
    }

    #[test]
    fn dot_dirs_pruned_at_any_depth() {
        let source = Source::new("t".into(), PathBuf::from("/tmp/t"));
        let ignore = build_ignore(&source);
        assert!(!keep_dir(".git", ignore.as_ref()));
        assert!(!keep_dir("notes/.obsidian", ignore.as_ref()));
        assert!(keep_dir("notes", ignore.as_ref()));
        assert!(keep_dir("notes/daily", ignore.as_ref()));
    }

    #[test]
    fn asset_and_ignored_dirs_pruned_with_subtrees() {
        let mut source = Source::new("t".into(), PathBuf::from("/tmp/t"));
        source.ignore.push("junk".into());
        let ignore = build_ignore(&source);
        assert!(!keep_dir("assets", ignore.as_ref()));
        assert!(!keep_dir("assets/img", ignore.as_ref()));
        assert!(!keep_dir("junk", ignore.as_ref()));
        assert!(!keep_dir("junk/sub", ignore.as_ref()));
        assert!(keep_dir("junkyard", ignore.as_ref()));
    }

    #[test]
    fn folder_rows_derive_parent_from_path() {
        assert_eq!(folder_parent_and_slug(""), (None, ""));
        assert_eq!(folder_parent_and_slug("a"), (Some(""), "a"));
        assert_eq!(folder_parent_and_slug("a/b"), (Some("a"), "b"));
        assert_eq!(folder_parent_and_slug("a/b/c"), (Some("a/b"), "c"));
        assert_eq!(folder_id("src", ""), "folder:src:");
        assert_eq!(folder_id("src", "a/b"), "folder:src:a/b");
    }
}
