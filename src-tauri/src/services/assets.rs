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
