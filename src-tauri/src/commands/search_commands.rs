use nucleo_matcher::pattern::{Atom, AtomKind, CaseMatching, Normalization};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::{bind_json, AppData};

// now only used in one location, could be cleaned up
#[derive(Debug, Clone, Deserialize)]
pub struct SearchScope {
    #[serde(default)]
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TitleMatch {
    pub id: String,
    pub title: String,
    pub rel_path: Option<String>,
    pub source_id: Option<String>,
    pub accessed_at: Option<i64>,
    pub quality: f64,
    pub match_indices: Vec<u32>,
}

type DocRow = (String, String, Option<String>, Option<String>, Option<i64>);

/// Fuzzy-match `query` against every in-scope document title, in-process next to the
/// data so titles never cross IPC. Returns raw matcher output (quality normalized to
/// [0,1] against a perfect self-match); all ranking policy lives in the frontend.
#[tauri::command]
pub async fn fuzzy_match_titles(
    app_data: State<'_, AppData>,
    query: String,
    scope: Option<SearchScope>,
) -> Result<Vec<TitleMatch>, String> {
    let mut sql = String::from(
        "SELECT id, title, rel_path, source_id, accessed_at FROM documents d WHERE d.deleted_at IS NULL",
    );
    if let Some(s) = scope.as_ref().filter(|s| !s.sql.is_empty()) {
        sql.push_str(" AND (");
        sql.push_str(&s.sql);
        sql.push(')');
    }
    let params = scope.as_ref().map_or(&[][..], |s| s.params.as_slice());
    let docs: Vec<DocRow> = bind_json!(sqlx::query_as(&sql), params)
        .fetch_all(&app_data.db)
        .await
        .unwrap_or_default();

    let trimmed = query.trim();
    let mut matcher = Matcher::new(Config::DEFAULT);
    let atom = Atom::new(
        trimmed,
        CaseMatching::Ignore,
        Normalization::Smart,
        AtomKind::Fuzzy,
        false,
    );
    let mut buf = Vec::new();
    let self_max = atom
        .score(Utf32Str::new(trimmed, &mut buf), &mut matcher)
        .unwrap_or(1)
        .max(1) as f64;

    Ok(docs
        .into_iter()
        .filter_map(|(id, title, rel_path, source_id, accessed_at)| {
            let score = atom.score(Utf32Str::new(&title, &mut buf), &mut matcher)?;
            if score == 0 {
                return None;
            }
            let mut indices = Vec::new();
            atom.indices(Utf32Str::new(&title, &mut buf), &mut matcher, &mut indices);
            indices.sort();
            Some(TitleMatch {
                id,
                title,
                rel_path,
                source_id,
                accessed_at,
                quality: (score as f64 / self_max).min(1.0),
                match_indices: indices,
            })
        })
        .collect())
}
