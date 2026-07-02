use nucleo_matcher::pattern::{Atom, AtomKind, CaseMatching, Normalization};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchResultKind {
    Document,
    Group,
    Source,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub rel_path: Option<String>,
    pub source_id: Option<String>,
    pub score: f64,
    pub match_indices: Vec<u32>,
    pub kind: SearchResultKind,
    pub group_type: Option<String>,
}

pub struct SearchConfig {
    pub max_results: usize,
    pub prefix_candidate_pool: usize,
    pub fuzzy_threshold: usize,
    pub recency_weight: f64,
    pub recency_multiplier: f64,
    pub recency_default_days: f64,
    pub group_prefix_min_chars: usize,
    pub group_max_results: usize,
    pub source_prefix_min_chars: usize,
    pub source_max_results: usize,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            max_results: 15,
            prefix_candidate_pool: 50,
            fuzzy_threshold: 2,
            recency_weight: 0.5,
            recency_multiplier: 100.0,
            recency_default_days: 365.0,
            group_prefix_min_chars: 3,
            group_max_results: 5,
            source_prefix_min_chars: 3,
            source_max_results: 5,
        }
    }
}

struct DocEntry {
    id: String,
    title: String,
    rel_path: Option<String>,
    source_id: Option<String>,
    accessed_at: Option<String>,
}

impl DocEntry {
    fn to_result(&self) -> SearchResult {
        SearchResult {
            id: self.id.clone(),
            title: self.title.clone(),
            rel_path: self.rel_path.clone(),
            source_id: self.source_id.clone(),
            score: 0.0,
            match_indices: Vec::new(),
            kind: SearchResultKind::Document,
            group_type: None,
        }
    }
}

struct Container {
    id: String,
    title: String,
    source_id: Option<String>,
    accessed_at: Option<String>,
    kind: SearchResultKind,
    group_type: Option<String>,
}

impl Container {
    fn to_result(&self, match_len: u32) -> SearchResult {
        SearchResult {
            id: self.id.clone(),
            title: self.title.clone(),
            rel_path: None,
            source_id: self.source_id.clone(),
            score: 0.0,
            match_indices: (0..match_len).collect(),
            kind: self.kind,
            group_type: self.group_type.clone(),
        }
    }
}

async fn load_docs(db: &SqlitePool, limit: Option<usize>) -> Vec<DocEntry> {
    let rows: Vec<(String, String, Option<String>, Option<String>, Option<String>)> = match limit {
        Some(n) => {
            sqlx::query_as(
                "SELECT id, title, rel_path, source_id, accessed_at FROM documents WHERE deleted_at IS NULL ORDER BY accessed_at DESC LIMIT ?1",
            )
            .bind(n as i64)
            .fetch_all(db)
            .await
        }
        None => {
            sqlx::query_as(
                "SELECT id, title, rel_path, source_id, accessed_at FROM documents WHERE deleted_at IS NULL",
            )
            .fetch_all(db)
            .await
        }
    }
    .unwrap_or_default();

    rows.into_iter()
        .map(|(id, title, rel_path, source_id, accessed_at)| DocEntry {
            id,
            title,
            rel_path,
            source_id,
            accessed_at,
        })
        .collect()
}

async fn load_groups_prefix(db: &SqlitePool, query: &str, limit: usize) -> Vec<Container> {
    let pattern = format!("{}%", query.to_lowercase());
    let rows: Vec<(String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, slug, group_type, source_id, accessed_at FROM groups WHERE lower(slug) LIKE ?1 ORDER BY length(slug) ASC, slug ASC LIMIT ?2",
    )
    .bind(pattern)
    .bind(limit as i64)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .map(|(id, title, group_type, source_id, accessed_at)| Container {
            id,
            title,
            source_id,
            accessed_at,
            kind: SearchResultKind::Group,
            group_type: Some(group_type),
        })
        .collect()
}

async fn load_groups_recent(db: &SqlitePool, limit: usize) -> Vec<Container> {
    let rows: Vec<(String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, slug, group_type, source_id, accessed_at FROM groups ORDER BY accessed_at DESC LIMIT ?1",
    )
    .bind(limit as i64)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .map(|(id, title, group_type, source_id, accessed_at)| Container {
            id,
            title,
            source_id,
            accessed_at,
            kind: SearchResultKind::Group,
            group_type: Some(group_type),
        })
        .collect()
}

async fn load_sources_prefix(db: &SqlitePool, query: &str, limit: usize) -> Vec<Container> {
    let pattern = format!("{}%", query.to_lowercase());
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, title, accessed_at FROM sources WHERE lower(title) LIKE ?1 ORDER BY length(title) ASC, title ASC LIMIT ?2",
    )
    .bind(pattern)
    .bind(limit as i64)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .map(|(id, title, accessed_at)| Container {
            id,
            title,
            source_id: None,
            accessed_at,
            kind: SearchResultKind::Source,
            group_type: None,
        })
        .collect()
}

async fn load_sources_recent(db: &SqlitePool, limit: usize) -> Vec<Container> {
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, title, accessed_at FROM sources ORDER BY accessed_at DESC LIMIT ?1",
    )
    .bind(limit as i64)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .map(|(id, title, accessed_at)| Container {
            id,
            title,
            source_id: None,
            accessed_at,
            kind: SearchResultKind::Source,
            group_type: None,
        })
        .collect()
}

fn days_since(accessed_at: &Option<String>, default_days: f64) -> f64 {
    let now = chrono::Utc::now();
    accessed_at
        .as_deref()
        .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok())
        .map(|dt| {
            let accessed = dt.and_utc();
            let duration = now.signed_duration_since(accessed);
            duration.num_hours().max(0) as f64 / 24.0
        })
        .unwrap_or(default_days)
}

async fn search_recents(db: &SqlitePool, limit: usize) -> Vec<SearchResult> {
    let docs = load_docs(db, Some(limit)).await;
    let mut containers = load_groups_recent(db, limit).await;
    containers.extend(load_sources_recent(db, limit).await);

    let mut merged: Vec<(String, SearchResult)> =
        Vec::with_capacity(docs.len() + containers.len());
    for doc in &docs {
        merged.push((doc.accessed_at.clone().unwrap_or_default(), doc.to_result()));
    }
    for c in &containers {
        merged.push((c.accessed_at.clone().unwrap_or_default(), c.to_result(0)));
    }

    // accessed_at is 'YYYY-MM-DD HH:MM:SS' ;;;;;;;; might want to switch all to ms since epoch
    merged.sort_by(|a, b| b.0.cmp(&a.0));
    merged.truncate(limit);
    merged.into_iter().map(|(_, r)| r).collect()
}

async fn search_prefix(db: &SqlitePool, query: &str, cfg: &SearchConfig) -> Vec<SearchResult> {
    let query_lower = query.to_lowercase();
    load_docs(db, Some(cfg.prefix_candidate_pool))
        .await
        .iter()
        .filter(|doc| doc.title.to_lowercase().contains(&query_lower))
        .take(cfg.max_results)
        .map(DocEntry::to_result)
        .collect()
}

async fn search_fuzzy(db: &SqlitePool, query: &str, cfg: &SearchConfig) -> Vec<SearchResult> {
    let docs = load_docs(db, None).await;
    if docs.is_empty() {
        return Vec::new();
    }

    let mut matcher = Matcher::new(Config::DEFAULT);
    let atom = Atom::new(
        query,
        CaseMatching::Ignore,
        Normalization::Smart,
        AtomKind::Fuzzy,
        false,
    );

    // Score all docs
    let mut scored: Vec<(usize, u16)> = Vec::new();
    let mut buf = Vec::new();

    for (i, doc) in docs.iter().enumerate() {
        let haystack = Utf32Str::new(&doc.title, &mut buf);
        if let Some(score) = atom.score(haystack, &mut matcher) {
            if score > 0 {
                scored.push((i, score));
            }
        }
    }

    // scores w/ recency
    let mut results: Vec<(usize, f64)> = scored
        .iter()
        .map(|&(i, nucleo_score)| {
            let recency_bonus = cfg.recency_multiplier
                / (1.0 + days_since(&docs[i].accessed_at, cfg.recency_default_days));
            let composite = nucleo_score as f64 + (recency_bonus * cfg.recency_weight);
            (i, composite)
        })
        .collect();

    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(cfg.max_results);

    // Get match indices for top results only
    results
        .iter()
        .map(|&(i, composite)| {
            let doc = &docs[i];
            let mut indices = Vec::new();
            let mut buf = Vec::new();
            let haystack = Utf32Str::new(&doc.title, &mut buf);
            atom.indices(haystack, &mut matcher, &mut indices);
            indices.sort();

            SearchResult {
                score: composite,
                match_indices: indices,
                ..doc.to_result()
            }
        })
        .collect()
}

pub async fn search(db: &SqlitePool, query: &str, cfg: &SearchConfig) -> Vec<SearchResult> {
    let query = query.trim();
    let docs = match query.len() {
        0 => search_recents(db, cfg.max_results).await,
        n if n <= cfg.fuzzy_threshold => search_prefix(db, query, cfg).await,
        _ => search_fuzzy(db, query, cfg).await,
    };

    let match_len = query.chars().count() as u32;
    let mut containers: Vec<Container> = Vec::new();
    if query.len() >= cfg.source_prefix_min_chars {
        containers.extend(load_sources_prefix(db, query, cfg.source_max_results).await);
    }
    if query.len() >= cfg.group_prefix_min_chars {
        containers.extend(load_groups_prefix(db, query, cfg.group_max_results).await);
    }

    containers
        .iter()
        .map(|c| c.to_result(match_len))
        .chain(docs.into_iter())
        .collect()
}
