use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::file_id::{get_file_id, FileId};
use notify_debouncer_full::{new_debouncer_opt, DebounceEventResult, Debouncer, FileIdCache};
use tauri::{AppHandle, Emitter, Manager};

use crate::services::fs::mtime_ms;
use crate::AppData;

#[derive(Default)]
struct NoteIds(HashMap<PathBuf, FileId>);

impl NoteIds {
    fn fill(&mut self, path: &Path) {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') {
            return;
        }
        let is_dir = path.is_dir();
        if !is_dir && path.extension().and_then(|e| e.to_str()) != Some("md") {
            return;
        }
        if let Ok(id) = get_file_id(path) {
            self.0.insert(path.to_path_buf(), id);
        }
        if is_dir {
            for entry in fs::read_dir(path).into_iter().flatten().flatten() {
                self.fill(&entry.path());
            }
        }
    }
}

impl FileIdCache for NoteIds {
    fn cached_file_id(&self, path: &Path) -> Option<impl AsRef<FileId>> {
        self.0.get(path)
    }

    fn add_path(&mut self, path: &Path, _recursive_mode: RecursiveMode) {
        self.fill(path);
    }

    fn remove_path(&mut self, path: &Path) {
        self.0.retain(|p, _| !p.starts_with(path));
    }
}

type SourceWatcher = Debouncer<RecommendedWatcher, NoteIds>;

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, (PathBuf, SourceWatcher)>>);

#[derive(serde::Deserialize)]
pub struct WatchTarget {
    pub id: String,
    pub path: PathBuf,
}

#[derive(Clone, serde::Serialize)]
struct FsChange {
    rel_path: String,
    mtime: Option<i64>,
    is_dir: bool,
}

#[derive(Clone, serde::Serialize)]
struct FsChanged<'a> {
    source_id: &'a str,
    changes: &'a [FsChange],
}

#[derive(Clone, serde::Serialize)]
struct WatchLost<'a> {
    source_id: &'a str,
}

fn watch(app: AppHandle, source_id: String, root: PathBuf) -> Result<SourceWatcher, String> {
    let handler_root = root.clone();
    let mut debouncer = new_debouncer_opt::<_, RecommendedWatcher, NoteIds>(
        Duration::from_millis(250),
        None,
        move |res: DebounceEventResult| {
            let events = match res {
                Ok(events) => events,
                Err(_) => {
                    let _ = app.emit(
                        "watch-lost",
                        WatchLost {
                            source_id: &source_id,
                        },
                    );
                    return;
                }
            };
            let rel_of = |path: &Path| {
                let rel = path.strip_prefix(&handler_root).ok()?;
                let rel = rel.to_string_lossy().replace('\\', "/");
                (!rel.is_empty() && !rel.split('/').any(|c| c.starts_with('.'))).then_some(rel)
            };
            let mut renames = Vec::new();
            let mut touched = BTreeSet::new();
            for e in &events {
                if matches!(e.kind, EventKind::Modify(ModifyKind::Name(RenameMode::Both))) {
                    if let [from, to] = e.paths.as_slice() {
                        if let (Some(from), Some(to)) = (rel_of(from), rel_of(to)) {
                            renames.push((from, to));
                        }
                    }
                }
                touched.extend(e.paths.iter().filter_map(|p| rel_of(p)));
            }
            if !renames.is_empty() {
                app.state::<AppData>()
                    .renames
                    .lock()
                    .unwrap()
                    .entry(source_id.clone())
                    .or_default()
                    .append(&mut renames);
            }
            let changes: Vec<FsChange> = touched
                .into_iter()
                .map(|rel_path| {
                    let full = handler_root.join(&rel_path);
                    FsChange {
                        mtime: mtime_ms(&full),
                        is_dir: full.is_dir(),
                        rel_path,
                    }
                })
                .collect();
            if changes.is_empty() {
                return;
            }
            let _ = app.emit(
                "fs-changed",
                FsChanged {
                    source_id: &source_id,
                    changes: &changes,
                },
            );
        },
        NoteIds::default(),
        notify::Config::default(),
    )
    .map_err(|e| e.to_string())?;
    debouncer
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    Ok(debouncer)
}

#[tauri::command]
pub async fn set_watched_paths(app: AppHandle, targets: Vec<WatchTarget>) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let watchers = app.state::<Watchers>();
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
    })
    .await;
}
