use nucleo_matcher::pattern::{Atom, AtomKind, CaseMatching, Normalization};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub rel_path: Option<String>,
    pub score: f64,
    pub match_indices: Vec<u32>,
}

pub struct SearchConfig {
    pub max_results: usize,
    pub prefix_candidate_pool: usize,
    pub fuzzy_threshold: usize,
    pub recency_weight: f64,
    pub recency_multiplier: f64,
    pub recency_default_days: f64,
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
        }
    }
}

struct DocEntry {
    id: String,
    title: String,
    rel_path: Option<String>,
    accessed_at: Option<String>,
}

async fn load_docs(db: &SqlitePool, source_id: &str, limit: Option<usize>) -> Vec<DocEntry> {
    let rows: Vec<(String, String, Option<String>, Option<String>)> = match limit {
        Some(n) => {
            sqlx::query_as(
                "SELECT id, title, rel_path, accessed_at FROM documents WHERE source_id = ?1 AND deleted_at IS NULL ORDER BY accessed_at DESC LIMIT ?2",
            )
            .bind(source_id)
            .bind(n as i64)
            .fetch_all(db)
            .await
        }
        None => {
            sqlx::query_as(
                "SELECT id, title, rel_path, accessed_at FROM documents WHERE source_id = ?1 AND deleted_at IS NULL",
            )
            .bind(source_id)
            .fetch_all(db)
            .await
        }
    }
    .unwrap_or_default();

    rows.into_iter()
        .map(|(id, title, rel_path, accessed_at)| DocEntry {
            id,
            title,
            rel_path,
            accessed_at,
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

fn to_result(doc: &DocEntry) -> SearchResult {
    SearchResult {
        id: doc.id.clone(),
        title: doc.title.clone(),
        rel_path: doc.rel_path.clone(),
        score: 0.0,
        match_indices: Vec::new(),
    }
}

async fn search_recents(db: &SqlitePool, source_id: &str, limit: usize) -> Vec<SearchResult> {
    load_docs(db, source_id, Some(limit))
        .await
        .iter()
        .map(to_result)
        .collect()
}

async fn search_prefix(
    db: &SqlitePool,
    source_id: &str,
    query: &str,
    cfg: &SearchConfig,
) -> Vec<SearchResult> {
    let query_lower = query.to_lowercase();
    load_docs(db, source_id, Some(cfg.prefix_candidate_pool))
        .await
        .iter()
        .filter(|doc| doc.title.to_lowercase().contains(&query_lower))
        .take(cfg.max_results)
        .map(to_result)
        .collect()
}

async fn search_fuzzy(
    db: &SqlitePool,
    source_id: &str,
    query: &str,
    cfg: &SearchConfig,
) -> Vec<SearchResult> {
    let docs = load_docs(db, source_id, None).await;
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
                id: doc.id.clone(),
                title: doc.title.clone(),
                rel_path: doc.rel_path.clone(),
                score: composite,
                match_indices: indices,
            }
        })
        .collect()
}

pub async fn search(
    db: &SqlitePool,
    source_id: &str,
    query: &str,
    cfg: &SearchConfig,
) -> Vec<SearchResult> {
    let query = query.trim();
    match query.len() {
        0 => search_recents(db, source_id, cfg.max_results).await,
        n if n <= cfg.fuzzy_threshold => search_prefix(db, source_id, query, cfg).await,
        _ => search_fuzzy(db, source_id, query, cfg).await,
    }
}
