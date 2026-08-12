use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, (PathBuf, Debouncer<RecommendedWatcher>)>>);

#[derive(serde::Deserialize)]
pub struct WatchTarget {
    pub id: String,
    pub path: PathBuf,
}

#[derive(Clone, serde::Serialize)]
struct FsChanged<'a> {
    source_id: &'a str,
    rel_paths: &'a [String],
}

fn watch(
    app: AppHandle,
    source_id: String,
    root: PathBuf,
) -> Result<Debouncer<RecommendedWatcher>, String> {
    let handler_root = root.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(250),
        move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            let mut rel_paths: Vec<String> = events
                .iter()
                .filter_map(|e| e.path.strip_prefix(&handler_root).ok())
                .map(|rel| rel.to_string_lossy().replace('\\', "/"))
                .filter(|rel| !rel.is_empty() && !rel.split('/').any(|c| c.starts_with('.')))
                .collect();
            rel_paths.sort();
            rel_paths.dedup();
            if rel_paths.is_empty() {
                return;
            }
            let _ = app.emit(
                "fs-changed",
                FsChanged {
                    source_id: &source_id,
                    rel_paths: &rel_paths,
                },
            );
        },
    )
    .map_err(|e| e.to_string())?;
    debouncer
        .watcher()
        .watch(&root, notify::RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    Ok(debouncer)
}

#[tauri::command]
pub fn set_watched_paths(app: AppHandle, watchers: State<'_, Watchers>, targets: Vec<WatchTarget>) {
    let mut map = watchers.0.lock().unwrap();
    map.retain(|id, (path, _)| targets.iter().any(|t| &t.id == id && &t.path == path));
    for target in targets {
        if map.contains_key(&target.id) {
            continue;
        }
        match watch(app.clone(), target.id.clone(), target.path.clone()) {
            Ok(debouncer) => {
                map.insert(target.id, (target.path, debouncer));
            }
            Err(e) => eprintln!("watch failed for {}: {e}", target.path.display()),
        }
    }
}
