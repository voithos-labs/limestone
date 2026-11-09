use atomicwrites::{AtomicFile, OverwriteBehavior::AllowOverwrite};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

fn invalid(what: &str, value: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("invalid {what}: {value}"),
    )
}

fn is_contained(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.contains('\\')
        && Path::new(rel)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

pub fn validate_file_name(name: &str) -> io::Result<()> {
    if !is_contained(name) || name.contains('/') {
        return Err(invalid("file name", name));
    }
    Ok(())
}

pub fn resolve_in_source(root: &Path, rel: &str) -> io::Result<PathBuf> {
    if !is_contained(rel) {
        return Err(invalid("path", rel));
    }
    Ok(root.join(rel))
}

pub fn clean_location(raw: &str) -> io::Result<String> {
    let cleaned = raw.trim().trim_matches(['/', '\\']).to_string();
    if !cleaned.is_empty() && !is_contained(&cleaned) {
        return Err(invalid("folder path", raw));
    }
    Ok(cleaned)
}

pub const META_FILE: &str = "meta.json";

pub fn docs_root(source_path: &Path) -> PathBuf {
    source_path.join(".limestone").join("docs")
}

pub fn doc_dir(source_path: &Path, doc_id: &str) -> PathBuf {
    docs_root(source_path).join(doc_id)
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct DocMeta {
    pub rel_path: String,
    pub created_at: i64,
}

pub fn read_meta(dir: &Path) -> Option<DocMeta> {
    serde_json::from_slice(&fs::read(dir.join(META_FILE)).ok()?).ok()
}

pub fn write_meta(dir: &Path, meta: &DocMeta) -> io::Result<()> {
    atomic_write(&dir.join(META_FILE), &serde_json::to_vec(meta)?)
}

pub fn repath_meta(source_path: &Path, doc_id: &str, rel_path: &str) -> io::Result<()> {
    let dir = doc_dir(source_path, doc_id);
    match read_meta(&dir) {
        Some(meta) if meta.rel_path != rel_path => write_meta(
            &dir,
            &DocMeta {
                rel_path: rel_path.to_string(),
                ..meta
            },
        ),
        _ => Ok(()),
    }
}

pub fn move_dir(from: &Path, to: &Path) -> io::Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            fs::copy(entry.path(), to.join(entry.file_name()))?;
        }
    }
    fs::remove_dir_all(from)
}

pub fn mtime_ms(path: &Path) -> Option<i64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let since = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(since.as_millis() as i64)
}

pub fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    AtomicFile::new(path, AllowOverwrite).write(|f| f.write_all(content))?;
    Ok(())
}

/// fast write, basically atomic to the cache not the drive, does not wait for final confirmation (no fsync)
pub fn fast_write(path: &Path, content: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    // Temp lives in the destination directory so the rename stays on one filesystem for similar atomic trait
    let tmp = parent.join(format!(".{}.lstmp", Uuid::new_v4()));
    fs::write(&tmp, content)?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

pub fn is_taken(src: &Path, dest: &Path) -> bool {
    dest.exists() && fs::canonicalize(src).ok() != fs::canonicalize(dest).ok()
}

pub fn move_file(src: &Path, dest: &Path) -> io::Result<()> {
    if is_taken(src, dest) {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "destination exists",
        ));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(src, dest)?;
            fs::remove_file(src)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn move_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("ls-move-{}", std::process::id()));
        fs::create_dir_all(dir.join("a")).unwrap();
        fs::create_dir_all(dir.join("b")).unwrap();
        let moving = dir.join("a/ideas.md");
        let resident = dir.join("b/ideas.md");
        fs::write(&moving, "moving").unwrap();
        fs::write(&resident, "resident").unwrap();

        let err = move_file(&moving, &resident).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&moving).unwrap(), "moving");
        assert_eq!(fs::read_to_string(&resident).unwrap(), "resident");

        let free = dir.join("b/new/ideas 2.md");
        move_file(&moving, &free).unwrap();
        assert!(!moving.exists());
        assert_eq!(fs::read_to_string(&free).unwrap(), "moving");
        assert_eq!(fs::read_to_string(&resident).unwrap(), "resident");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn meta_round_trips_and_is_absent_until_written() {
        let dir = std::env::temp_dir().join(format!("ls-meta-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(read_meta(&dir), None);
        let meta = DocMeta {
            rel_path: "notes/a.md".into(),
            created_at: 1700000000000,
        };
        write_meta(&dir, &meta).unwrap();
        assert_eq!(read_meta(&dir), Some(meta));

        let root = dir.join("root");
        let keyed = doc_dir(&root, "doc-1");
        repath_meta(&root, "doc-1", "b.md").unwrap();
        assert_eq!(read_meta(&keyed), None);
        write_meta(
            &keyed,
            &DocMeta {
                rel_path: "a.md".into(),
                created_at: 5,
            },
        )
        .unwrap();
        repath_meta(&root, "doc-1", "b.md").unwrap();
        assert_eq!(
            read_meta(&keyed),
            Some(DocMeta {
                rel_path: "b.md".into(),
                created_at: 5,
            })
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_dir_carries_every_file_and_removes_the_old_dir() {
        let tmp = std::env::temp_dir().join(format!("ls-movedir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let from = tmp.join("a/.limestone/docs/doc");
        let to = tmp.join("b/.limestone/docs/doc");
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("h1"), b"one").unwrap();
        fs::write(from.join("h2"), b"two").unwrap();

        move_dir(&from, &to).unwrap();

        assert!(!from.exists());
        assert_eq!(fs::read(to.join("h1")).unwrap(), b"one");
        assert_eq!(fs::read(to.join("h2")).unwrap(), b"two");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn accepts_plain_names() {
        for name in ["note.md", "a b.md", ".hidden.md", "..leading.md", "n..md"] {
            assert!(validate_file_name(name).is_ok(), "{name}");
        }
    }

    #[test]
    fn rejects_traversal_and_separators() {
        for name in [
            "",
            ".",
            "..",
            "../evil.md",
            "..",
            "a/b.md",
            "a\\b.md",
            "/etc/passwd",
            "\\\\server\\share\\x.md",
            "./x.md",
            "sub/../../x.md",
        ] {
            assert!(validate_file_name(name).is_err(), "{name:?}");
        }
    }

    #[test]
    fn rejects_absolute_windows_path() {
        assert!(validate_file_name("C:/Windows/x.md").is_err());
        assert!(validate_file_name("C:\\Windows\\x.md").is_err());
    }

    #[test]
    fn resolve_joins_nested_paths() {
        let root = Path::new("/vault");
        assert_eq!(
            resolve_in_source(root, "a/b/c.md").unwrap(),
            Path::new("/vault/a/b/c.md")
        );
        assert_eq!(
            resolve_in_source(root, "note.md").unwrap(),
            Path::new("/vault/note.md")
        );
        assert_eq!(
            resolve_in_source(root, "a/./b.md").unwrap(),
            Path::new("/vault/a/b.md")
        );
    }

    #[test]
    fn resolve_rejects_escapes() {
        let root = Path::new("/vault");
        for rel in [
            "",
            "..",
            "../out.md",
            "a/../../out.md",
            "/etc/passwd",
            "./x.md",
            "..\\out.md",
            "a\\b.md",
        ] {
            assert!(resolve_in_source(root, rel).is_err(), "{rel:?}");
        }
    }

    #[test]
    fn containment_check_still_allows_existing_odd_names() {
        assert!(resolve_in_source(Path::new("/vault"), "notes/a:b.md").is_ok());
    }

    #[test]
    fn clean_location_normalizes_and_allows_root() {
        assert_eq!(clean_location("").unwrap(), "");
        assert_eq!(clean_location("   ").unwrap(), "");
        assert_eq!(clean_location("assets").unwrap(), "assets");
        assert_eq!(clean_location("/assets/").unwrap(), "assets");
        assert_eq!(clean_location("notes/daily").unwrap(), "notes/daily");
    }

    #[test]
    fn clean_location_rejects_escapes() {
        for raw in ["..", "../out", "a/../../out", "a\\b", "note/../.."] {
            assert!(clean_location(raw).is_err(), "{raw:?}");
        }
    }

    #[test]
    fn resolve_never_escapes_root() {
        let root = Path::new("/vault");
        for rel in [
            "..",
            "../out.md",
            "a/../../out.md",
            "/etc/passwd",
            "C:/Windows/x.md",
            "C:\\Windows\\x.md",
            "\\\\server\\share\\x.md",
            "a/./b.md",
            "....//420/....//out.md",
        ] {
            if let Ok(p) = resolve_in_source(root, rel) {
                assert!(p.starts_with(root), "{rel:?} -> {p:?}");
                assert!(
                    !p.components().any(|c| matches!(c, Component::ParentDir)),
                    "{rel:?} -> {p:?}"
                );
            }
        }
    }
}
