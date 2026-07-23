use atomicwrites::{AtomicFile, OverwriteBehavior::AllowOverwrite};
use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path};
use uuid::Uuid;

pub fn validate_file_name(name: &str) -> io::Result<()> {
    let mut parts = Path::new(name).components();
    let single = matches!(parts.next(), Some(Component::Normal(_))) && parts.next().is_none();
    if !single || name.contains(['/', '\\']) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid file name: {name}"),
        ));
    }
    Ok(())
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

pub fn move_file(src: &Path, dest: &Path) -> io::Result<()> {
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
}
