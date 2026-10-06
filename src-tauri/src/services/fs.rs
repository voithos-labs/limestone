use atomicwrites::{AtomicFile, OverwriteBehavior::AllowOverwrite};
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

/// .tmp atomic write, big safe
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
