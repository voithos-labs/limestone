use atomicwrites::{AtomicFile, OverwriteBehavior::AllowOverwrite};
use std::fs;
use std::io::{self, Write};
use std::path::Path;

pub fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    AtomicFile::new(path, AllowOverwrite).write(|f| f.write_all(content))?;
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
