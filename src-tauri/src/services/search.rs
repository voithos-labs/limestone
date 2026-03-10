use nucleo_matcher::pattern::{Atom, AtomKind, CaseMatching, Normalization};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use rusqlite::Connection;
use serde::Serialize;

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

fn load_docs(db: &Connection, vault_id: &str, limit: Option<usize>) -> Vec<DocEntry> {
    let sql = match limit {
        Some(_) => "select id, title, rel_path, accessed_at from documents where vault_id = ?1 and deleted_at is null order by accessed_at desc limit ?2",
        None => "select id, title, rel_path, accessed_at from documents where vault_id = ?1 and deleted_at is null",
    };

    let mut stmt = match db.prepare(sql) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<DocEntry> {
        Ok(DocEntry {
            id: row.get(0)?,
            title: row.get(1)?,
            rel_path: row.get(2)?,
            accessed_at: row.get(3)?,
        })
    };

    let result = match limit {
        Some(n) => {
            let rows = stmt.query_map(rusqlite::params![vault_id, n as i64], map_row);
            rows.map(|r| r.filter_map(|e| e.ok()).collect())
                .unwrap_or_default()
        }
        None => {
            let rows = stmt.query_map(rusqlite::params![vault_id], map_row);
            rows.map(|r| r.filter_map(|e| e.ok()).collect())
                .unwrap_or_default()
        }
    };

    result
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

fn search_recents(db: &Connection, vault_id: &str, limit: usize) -> Vec<SearchResult> {
    load_docs(db, vault_id, Some(limit))
        .iter()
        .map(to_result)
        .collect()
}

fn search_prefix(db: &Connection, vault_id: &str, query: &str, cfg: &SearchConfig) -> Vec<SearchResult> {
    let query_lower = query.to_lowercase();
    load_docs(db, vault_id, Some(cfg.prefix_candidate_pool))
        .iter()
        .filter(|doc| doc.title.to_lowercase().contains(&query_lower))
        .take(cfg.max_results)
        .map(to_result)
        .collect()
}

fn search_fuzzy(db: &Connection, vault_id: &str, query: &str, cfg: &SearchConfig) -> Vec<SearchResult> {
    let docs = load_docs(db, vault_id, None);
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
            let recency_bonus = cfg.recency_multiplier / (1.0 + days_since(&docs[i].accessed_at, cfg.recency_default_days));
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

pub fn search(db: &Connection, vault_id: &str, query: &str, cfg: &SearchConfig) -> Vec<SearchResult> {
    let query = query.trim();
    match query.len() {
        0 => search_recents(db, vault_id, cfg.max_results),
        n if n <= cfg.fuzzy_threshold => search_prefix(db, vault_id, query, cfg),
        _ => search_fuzzy(db, vault_id, query, cfg),
    }
}
