//! sidecars are json files attached to PDFs (and potentially other file types eventually)
//! that live in `.limestone/sidecars/<doc uuid>.json`.
//!
//! they act as a stable reference to immutable material (e.g. pdfs, of course), allowing
//! our annotation tooling to simply use a normal doc UUID, and promoting basic file types into
//! full documents with tags and other metadata, a pdf can even be a todo
//!
//! for Daniel ;; when you go to add citations to a given pdf, the sidecar has to be inited,
//! it's not created 'by default' but only when it's needed, e.g. to store a tag
//! 

use crate::services::fs::{atomic_write, mtime_ms};
use serde_json::{Map, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const PLACE_KEYS: [&str; 3] = ["path", "size", "mtime"];

pub struct Sidecar {
    pub id: String,
    pub path: String,
    pub size: u64,
    pub mtime: i64,
    pub written: i64,
    pub meta: Value,
}

pub fn sidecar_root(source_path: &Path) -> PathBuf {
    source_path.join(".limestone").join("sidecars")
}

pub fn sidecar_path(source_path: &Path, id: &str) -> Option<PathBuf> {
    Uuid::parse_str(id).ok()?;
    Some(sidecar_root(source_path).join(format!("{id}.json")))
}

pub fn exists(source_path: &Path, id: &str) -> bool {
    sidecar_path(source_path, id).is_some_and(|p| p.is_file())
}

fn invalid_id(id: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("invalid sidecar id: {id:?}"),
    )
}

fn read_map(path: &Path) -> io::Result<Option<Map<String, Value>>> {
    match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(Value::Object(map)) => Ok(Some(map)),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "sidecar is not a JSON object",
            )),
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn meta_of(map: &Map<String, Value>) -> Value {
    Value::Object(
        map.iter()
            .filter(|(k, _)| !PLACE_KEYS.contains(&k.as_str()))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    )
}

pub fn read(source_path: &Path, id: &str) -> io::Result<Option<Value>> {
    let path = sidecar_path(source_path, id).ok_or_else(|| invalid_id(id))?;
    Ok(read_map(&path)?.map(|m| meta_of(&m)))
}

pub fn load_all(source_path: &Path) -> Vec<Sidecar> {
    let Ok(entries) = fs::read_dir(sidecar_root(source_path)) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let id = name.strip_suffix(".json")?;
            Uuid::parse_str(id).ok()?;
            let map = read_map(&entry.path()).ok()??;
            Some(Sidecar {
                id: id.to_string(),
                path: map.get("path")?.as_str()?.to_string(),
                size: map.get("size").and_then(Value::as_u64).unwrap_or(0),
                mtime: map.get("mtime").and_then(Value::as_i64).unwrap_or(0),
                written: mtime_ms(&entry.path()).unwrap_or(0),
                meta: meta_of(&map),
            })
        })
        .collect()
}

pub fn rewrite(
    source_path: &Path,
    id: &str,
    rel_path: &str,
    mutate: impl FnOnce(&mut Value),
) -> io::Result<()> {
    let path = sidecar_path(source_path, id).ok_or_else(|| invalid_id(id))?;
    let existing = read_map(&path)?;
    let mut meta = existing
        .as_ref()
        .map(meta_of)
        .unwrap_or_else(|| Value::Object(Map::new()));
    mutate(&mut meta);
    let Value::Object(meta) = meta else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "sidecar meta is not an object",
        ));
    };
    if existing.is_none() && meta.is_empty() {
        return Ok(());
    }
    let file = fs::metadata(source_path.join(rel_path))?;
    let mut next = Map::new();
    next.insert("path".into(), Value::String(rel_path.to_string()));
    next.insert("size".into(), Value::from(file.len()));
    next.insert(
        "mtime".into(),
        Value::from(mtime_ms(&source_path.join(rel_path)).unwrap_or(0)),
    );
    next.extend(meta);
    if existing.as_ref() == Some(&next) {
        return Ok(());
    }
    let bytes = serde_json::to_vec_pretty(&Value::Object(next))
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    atomic_write(&path, &bytes)
}

pub fn relocate(source_path: &Path, id: &str, rel_path: &str) -> io::Result<()> {
    if !exists(source_path, id) {
        return Ok(());
    }
    rewrite(source_path, id, rel_path, |_| {})
}

pub fn move_between(from_root: &Path, to_root: &Path, id: &str, rel_path: &str) -> io::Result<()> {
    let from = sidecar_path(from_root, id).ok_or_else(|| invalid_id(id))?;
    let Some(map) = read_map(&from)? else {
        return Ok(());
    };
    let meta = meta_of(&map);
    rewrite(to_root, id, rel_path, |m| *m = meta)?;
    remove(from_root, id)
}

pub fn touch(source_path: &Path, id: &str) -> io::Result<()> {
    let Some(path) = sidecar_path(source_path, id) else {
        return Ok(());
    };
    match fs::read(&path) {
        Ok(bytes) => atomic_write(&path, &bytes),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

pub fn sweep_strays(source_path: &Path, cutoff: i64) {
    for s in load_all(source_path) {
        if s.written < cutoff && !source_path.join(&s.path).exists() {
            let _ = remove(source_path, &s.id);
        }
    }
}

pub fn remove(source_path: &Path, id: &str) -> io::Result<()> {
    let Some(path) = sidecar_path(source_path, id) else {
        return Ok(());
    };
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "6f1c1d2e-0000-4000-8000-000000000001";

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ls-sidecar-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("a")).unwrap();
        fs::write(dir.join("a/doc.pdf"), b"%PDF-1.7").unwrap();
        dir
    }

    #[test]
    fn nothing_is_written_until_there_is_metadata() {
        let root = tmp("lazy");
        rewrite(&root, ID, "a/doc.pdf", |_| {}).unwrap();
        assert!(!exists(&root, ID));
        rewrite(&root, ID, "a/doc.pdf", |m| {
            m.as_object_mut()
                .unwrap()
                .insert("tags".into(), serde_json::json!(["exam"]));
        })
        .unwrap();
        let all = load_all(&root);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].path, "a/doc.pdf");
        assert_eq!(all[0].size, 8);
        assert_eq!(all[0].meta, serde_json::json!({ "tags": ["exam"] }));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn relocate_and_move_keep_the_metadata() {
        let root = tmp("move");
        let other = tmp("move-dest");
        rewrite(&root, ID, "a/doc.pdf", |m| {
            m.as_object_mut()
                .unwrap()
                .insert("status".into(), serde_json::json!("reading"));
        })
        .unwrap();
        fs::rename(root.join("a/doc.pdf"), root.join("a/renamed.pdf")).unwrap();
        relocate(&root, ID, "a/renamed.pdf").unwrap();
        assert_eq!(load_all(&root)[0].path, "a/renamed.pdf");

        fs::rename(root.join("a/renamed.pdf"), other.join("a/doc.pdf")).unwrap();
        move_between(&root, &other, ID, "a/doc.pdf").unwrap();
        assert!(!exists(&root, ID));
        let moved = load_all(&other);
        assert_eq!(moved[0].path, "a/doc.pdf");
        assert_eq!(moved[0].meta, serde_json::json!({ "status": "reading" }));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&other);
    }

    #[test]
    fn a_stray_is_retired_only_after_its_pdf_has_been_gone_past_the_cutoff() {
        let root = tmp("stray");
        rewrite(&root, ID, "a/doc.pdf", |m| {
            m.as_object_mut()
                .unwrap()
                .insert("tags".into(), serde_json::json!(["exam"]));
        })
        .unwrap();
        touch(&root, ID).unwrap();
        let touched = load_all(&root)[0].written;
        sweep_strays(&root, touched + 1);
        assert!(exists(&root, ID), "kept while its pdf is still on disk");
        fs::remove_file(root.join("a/doc.pdf")).unwrap();
        sweep_strays(&root, touched);
        assert!(exists(&root, ID), "kept until the cutoff passes its touch");
        sweep_strays(&root, touched + 1);
        assert!(!exists(&root, ID));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn conflict_copies_and_strays_are_ignored() {
        let root = tmp("strays");
        fs::create_dir_all(sidecar_root(&root)).unwrap();
        let body = br#"{"path":"a/doc.pdf","size":8,"mtime":0}"#;
        fs::write(
            sidecar_root(&root).join(format!("{ID} (conflicted copy).json")),
            body,
        )
        .unwrap();
        fs::write(sidecar_root(&root).join("notes.json"), body).unwrap();
        fs::write(sidecar_root(&root).join(format!("{ID}.json")), b"[1,2]").unwrap();
        assert!(load_all(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
