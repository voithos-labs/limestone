use std::path::{Path, PathBuf};

pub fn assets_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("assets")
}

pub fn import_global_asset_bytes(
    app_data_dir: &Path,
    bytes: &[u8],
    ext: &str,
) -> std::io::Result<String> {
    let hash = blake3::hash(bytes).to_hex().to_string();
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    let name = if ext.is_empty() {
        hash
    } else {
        format!("{hash}.{ext}")
    };
    let dir = assets_dir(app_data_dir);
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(&name);
    if !dest.exists() {
        crate::services::fs::atomic_write(&dest, bytes)?;
    }
    Ok(name)
}

pub fn import_global_asset(app_data_dir: &Path, src: &Path) -> std::io::Result<String> {
    let bytes = std::fs::read(src)?;
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    import_global_asset_bytes(app_data_dir, &bytes, ext)
}

pub fn source_asset_dir(source_path: &Path, asset_location: &str) -> PathBuf {
    let loc = asset_location.trim_matches('/');
    if loc.is_empty() {
        source_path.to_path_buf()
    } else {
        source_path.join(loc)
    }
}

fn unique_dest(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut n = 0u32;
    loop {
        let suffix = if n == 0 {
            String::new()
        } else {
            format!(" {n}")
        };
        let name = if ext.is_empty() {
            format!("{stem}{suffix}")
        } else {
            format!("{stem}{suffix}.{ext}")
        };
        let dest = dir.join(name);
        if !dest.exists() {
            return dest;
        }
        n += 1;
    }
}

pub fn import_source_asset_bytes(
    source_path: &Path,
    asset_location: &str,
    bytes: &[u8],
    stem: &str,
    ext: &str,
) -> std::io::Result<String> {
    let dir = source_asset_dir(source_path, asset_location);
    std::fs::create_dir_all(&dir)?;
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    let dest = unique_dest(&dir, stem, &ext);
    crate::services::fs::atomic_write(&dest, bytes)?;
    Ok(dest
        .strip_prefix(source_path)
        .unwrap_or(&dest)
        .to_string_lossy()
        .replace('\\', "/"))
}

pub fn import_source_asset(
    source_path: &Path,
    asset_location: &str,
    src: &Path,
) -> std::io::Result<String> {
    let bytes = std::fs::read(src)?;
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    import_source_asset_bytes(source_path, asset_location, &bytes, stem, ext)
}
