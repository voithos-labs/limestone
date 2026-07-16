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
    pub snippet: Option<String>,
}

pub const SNIPPET_MARK_START: char = '\u{1}';
pub const SNIPPET_MARK_END: char = '\u{2}';

pub struct SearchConfig {
    pub max_results: usize,
    pub prefix_candidate_pool: usize,
    pub fuzzy_threshold: usize,
    pub recency_weight: f64,
    pub recency_default_days: f64,
    pub group_prefix_min_chars: usize,
    pub group_max_results: usize,
    pub source_prefix_min_chars: usize,
    pub source_max_results: usize,
    pub fts_min_chars: usize,
    pub fts_candidate_pool: usize,
    pub hybrid_quality_gate: f64,
    pub bm25_saturation: f64,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            max_results: 15,
            prefix_candidate_pool: 50,
            fuzzy_threshold: 2,
            recency_weight: 0.5,
            recency_default_days: 365.0,
            group_prefix_min_chars: 3,
            group_max_results: 5,
            source_prefix_min_chars: 3,
            source_max_results: 5,
            fts_min_chars: 5,
            fts_candidate_pool: 25,
            hybrid_quality_gate: 0.5,
            bm25_saturation: 5.0,
        }
    }
}

struct DocEntry {
    id: String,
    title: String,
    rel_path: Option<String>,
    source_id: Option<String>,
    accessed_at: Option<i64>,
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
            snippet: None,
        }
    }
}

struct Container {
    id: String,
    title: String,
    source_id: Option<String>,
    accessed_at: Option<i64>,
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
            snippet: None,
        }
    }
}

async fn load_docs(db: &SqlitePool, limit: Option<usize>) -> Vec<DocEntry> {
    let rows: Vec<(String, String, Option<String>, Option<String>, Option<i64>)> = match limit {
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
    let rows: Vec<(String, String, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT id, slug, group_type, source_id, accessed_at FROM groups WHERE lower(slug) LIKE ?1 ORDER BY length(slug) ASC, slug ASC LIMIT ?2",
    )
    .bind(pattern)
    .bind(limit as i64)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .map(
            |(id, title, group_type, source_id, accessed_at)| Container {
                id,
                title,
                source_id,
                accessed_at,
                kind: SearchResultKind::Group,
                group_type: Some(group_type),
            },
        )
        .collect()
}

async fn load_groups_recent(db: &SqlitePool, limit: usize) -> Vec<Container> {
    let rows: Vec<(String, String, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT id, slug, group_type, source_id, accessed_at FROM groups ORDER BY accessed_at DESC LIMIT ?1",
    )
    .bind(limit as i64)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .map(
            |(id, title, group_type, source_id, accessed_at)| Container {
                id,
                title,
                source_id,
                accessed_at,
                kind: SearchResultKind::Group,
                group_type: Some(group_type),
            },
        )
        .collect()
}

async fn load_sources_prefix(db: &SqlitePool, query: &str, limit: usize) -> Vec<Container> {
    let pattern = format!("{}%", query.to_lowercase());
    let rows: Vec<(String, String, Option<i64>)> = sqlx::query_as(
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
    let rows: Vec<(String, String, Option<i64>)> = sqlx::query_as(
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

fn days_since(accessed_at: &Option<i64>, default_days: f64) -> f64 {
    let now_ms = chrono::Utc::now().timestamp_millis();
    accessed_at
        .map(|ms| ((now_ms - ms).max(0) as f64) / 86_400_000.0)
        .unwrap_or(default_days)
}

async fn search_recents(db: &SqlitePool, limit: usize) -> Vec<SearchResult> {
    let docs = load_docs(db, Some(limit)).await;
    let mut containers = load_groups_recent(db, limit).await;
    containers.extend(load_sources_recent(db, limit).await);

    let mut merged: Vec<(i64, SearchResult)> = Vec::with_capacity(docs.len() + containers.len());
    for doc in &docs {
        merged.push((doc.accessed_at.unwrap_or(0), doc.to_result()));
    }
    for c in &containers {
        merged.push((c.accessed_at.unwrap_or(0), c.to_result(0)));
    }

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

fn tidy_snippet(raw: &str) -> String {
    let first_mark = raw.find(SNIPPET_MARK_START).unwrap_or(0);
    let last_mark = raw
        .rfind(SNIPPET_MARK_END)
        .map(|i| i + SNIPPET_MARK_END.len_utf8())
        .unwrap_or(raw.len());

    let begin = raw[..first_mark].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let end = raw[last_mark..]
        .find('\n')
        .map(|i| last_mark + i)
        .unwrap_or(raw.len());

    raw[begin..end]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn fts_match_query(query: &str) -> Option<String> {
    let prefix_last = !query.ends_with(char::is_whitespace);
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        return None;
    }
    let mut out = terms.join(" ");
    if prefix_last {
        out.push('*');
    }
    Some(out)
}

type FtsRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<i64>,
    String,
    f64,
);

async fn fts_candidates(db: &SqlitePool, query: &str, cfg: &SearchConfig) -> Vec<FtsRow> {
    let Some(match_query) = fts_match_query(query) else {
        return Vec::new();
    };
    sqlx::query_as(
        "SELECT d.id, d.title, d.rel_path, d.source_id, d.accessed_at,
                snippet(documents_fts, 1, ?2, ?3, '…', 16), bm25(documents_fts)
         FROM documents_fts JOIN documents d ON d.rowid = documents_fts.rowid
         WHERE documents_fts MATCH ?1 AND d.deleted_at IS NULL
         ORDER BY bm25(documents_fts) LIMIT ?4",
    )
    .bind(&match_query)
    .bind(SNIPPET_MARK_START.to_string())
    .bind(SNIPPET_MARK_END.to_string())
    .bind(cfg.fts_candidate_pool as i64)
    .fetch_all(db)
    .await
    .unwrap_or_default()
}

const BODY_QUALITY_CAP: f64 = 0.9;

struct HybridCandidate {
    result: SearchResult,
    quality: f64,
    strong: bool,
    accessed_at: Option<i64>,
}

async fn search_hybrid(db: &SqlitePool, query: &str, cfg: &SearchConfig) -> Vec<SearchResult> {
    let docs = load_docs(db, None).await;

    let mut matcher = Matcher::new(Config::DEFAULT);
    let atom = Atom::new(
        query,
        CaseMatching::Ignore,
        Normalization::Smart,
        AtomKind::Fuzzy,
        false,
    );

    let mut buf = Vec::new();
    let self_max = atom
        .score(Utf32Str::new(query, &mut buf), &mut matcher)
        .unwrap_or(1)
        .max(1) as f64;

    let mut candidates: std::collections::HashMap<String, HybridCandidate> =
        std::collections::HashMap::new();

    for doc in &docs {
        let haystack = Utf32Str::new(&doc.title, &mut buf);
        let Some(score) = atom.score(haystack, &mut matcher) else {
            continue;
        };
        if score == 0 {
            continue;
        }
        let quality = (score as f64 / self_max).min(1.0);
        candidates.insert(
            doc.id.clone(),
            HybridCandidate {
                result: doc.to_result(),
                quality,
                strong: quality >= cfg.hybrid_quality_gate,
                accessed_at: doc.accessed_at,
            },
        );
    }

    if query.len() >= cfg.fts_min_chars {
        for (id, title, rel_path, source_id, accessed_at, snippet, bm25) in
            fts_candidates(db, query, cfg).await
        {
            let relevance = (-bm25).max(0.0);
            let quality = BODY_QUALITY_CAP * relevance / (relevance + cfg.bm25_saturation);
            match candidates.get_mut(&id) {
                Some(existing) => {
                    existing.strong = true;
                    if quality > existing.quality {
                        existing.quality = quality;
                        existing.result.snippet = Some(tidy_snippet(&snippet));
                    }
                }
                None => {
                    candidates.insert(
                        id.clone(),
                        HybridCandidate {
                            result: SearchResult {
                                id,
                                title,
                                rel_path,
                                source_id,
                                score: 0.0,
                                match_indices: Vec::new(),
                                kind: SearchResultKind::Document,
                                group_type: None,
                                snippet: Some(tidy_snippet(&snippet)),
                            },
                            quality,
                            strong: true,
                            accessed_at,
                        },
                    );
                }
            }
        }
    }

    let mut strong: Vec<HybridCandidate> = Vec::new();
    let mut weak: Vec<HybridCandidate> = Vec::new();
    for (_, mut c) in candidates {
        let boost =
            1.0 + cfg.recency_weight / (1.0 + days_since(&c.accessed_at, cfg.recency_default_days));
        c.result.score = c.quality * boost;
        if c.strong {
            strong.push(c);
        } else {
            weak.push(c);
        }
    }

    fn by_score(a: &HybridCandidate, b: &HybridCandidate) -> std::cmp::Ordering {
        b.result
            .score
            .partial_cmp(&a.result.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.result.title.cmp(&b.result.title))
    }
    strong.sort_by(by_score);
    weak.sort_by(by_score);
    strong.truncate(cfg.max_results);
    weak.truncate(cfg.max_results.saturating_sub(strong.len()));

    strong
        .into_iter()
        .chain(weak)
        .map(|c| {
            let mut result = c.result;
            if result.snippet.is_none() {
                let haystack = Utf32Str::new(&result.title, &mut buf);
                let mut indices = Vec::new();
                atom.indices(haystack, &mut matcher, &mut indices);
                indices.sort();
                result.match_indices = indices;
            }
            result
        })
        .collect()
}

pub async fn search(db: &SqlitePool, query: &str, cfg: &SearchConfig) -> Vec<SearchResult> {
    let query = query.trim();
    let docs = match query.len() {
        0 => search_recents(db, cfg.max_results).await,
        n if n <= cfg.fuzzy_threshold => search_prefix(db, query, cfg).await,
        _ => search_hybrid(db, query, cfg).await,
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
