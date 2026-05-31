use atomicwrites::{AtomicFile, OverwriteBehavior::AllowOverwrite};
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use uuid::Uuid;

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

pub fn rename(src: &Path, dest: &Path) -> io::Result<()> {
    fs::rename(src, dest)
}

pub fn move_file(src: &Path, dest: &Path) -> io::Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(src, dest)
}
