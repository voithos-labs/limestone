use rayon::prelude::*;
use sqlx::SqlitePool;
use std::collections::HashSet;

use crate::services::frontmatter;
use crate::services::Source;

const CHUNK_SIZE: usize = 500;

pub async fn index_fts(
    db: &SqlitePool,
    source: &Source,
    changed: Vec<(String, String)>,
) -> sqlx::Result<usize> {
    let t_total = std::time::Instant::now();
    let source_id = source.id.to_string();

    let missing: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, rel_path FROM documents WHERE source_id = ?1
         AND rowid NOT IN (SELECT rowid FROM documents_fts)",
    )
    .bind(&source_id)
    .fetch_all(db)
    .await?;

    let mut docs = changed;
    let seen: HashSet<String> = docs.iter().map(|(id, _)| id.clone()).collect();
    docs.extend(missing.into_iter().filter(|(id, _)| !seen.contains(id)));

    for chunk in docs.chunks(CHUNK_SIZE) {
        let bodies: Vec<(&str, Option<String>)> = chunk
            .par_iter()
            .map(|(id, rel_path)| {
                let body = std::fs::read_to_string(source.path.join(rel_path))
                    .ok()
                    .map(|c| frontmatter::split_content(&c).1.to_string());
                (id.as_str(), body)
            })
            .collect();

        let mut tx = db.begin().await?;
        for (id, body) in bodies {
            sqlx::query(
                "DELETE FROM documents_fts WHERE rowid = (SELECT rowid FROM documents WHERE id = ?1)",
            )
            .bind(id)
            .execute(&mut *tx)
            .await?;
            if let Some(body) = body {
                sqlx::query(
                    "INSERT INTO documents_fts (rowid, doc_id, body)
                     SELECT rowid, id, ?2 FROM documents WHERE id = ?1",
                )
                .bind(id)
                .bind(&body)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
    }

    eprintln!(
        "[fts:{}] {}ms | {} docs indexed",
        source.title,
        t_total.elapsed().as_millis(),
        docs.len()
    );
    Ok(docs.len())
}
