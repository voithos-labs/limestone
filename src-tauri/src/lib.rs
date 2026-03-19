use serde_json::Value;
use sqlx::SqlitePool;
use std::sync::{Mutex, RwLock};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

mod commands;
mod services;

const SCHEMA: &str = include_str!("../sql/schema.sql");

pub async fn create_pool(path: &std::path::Path) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let url = format!("sqlite:{}?mode=rwc", path.display());
    let pool = SqlitePool::connect(&url).await?;
    sqlx::raw_sql(SCHEMA).execute(&pool).await?;
    Ok(pool)
}

pub struct AppData {
    pub user: services::User,
    pub active_source: Mutex<Option<services::Source>>,
    pub settings: RwLock<Value>,
    pub db: SqlitePool,
}

impl AppData {
    pub fn get_active_source(&self) -> Result<(std::path::PathBuf, String), String> {
        let active = self.active_source.lock().unwrap();
        let source = active.as_ref().ok_or("no active source")?;
        Ok((source.path.clone(), source.id.to_string()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(move |app| {
            // ── Blocking Shi ─────────────────────────────────────────────────────────

            let global_data_path = app.path().app_data_dir()?;

            let user_store = services::JsonSettingsStore {
                path: global_data_path.join("user.json"),
                default_json: None,
                override_path: None,
            };

            let user = user_store.load::<services::User>().unwrap_or_else(|| {
                let new_user = services::User::initialize();
                let _ = user_store.save(&new_user);
                new_user
            });

            // Load sources
            let sources_path = global_data_path.join("sources.json");
            let mut sources = services::JsonSettingsStore {
                path: sources_path,
                default_json: None,
                override_path: None,
            }
            .load::<services::Sources>()
            .unwrap_or_default()
            .sources;
            sources.sort_by_key(|v| std::cmp::Reverse(v.accessed_at));

            // Allow fs access to source dir
            if let Some(source) = sources.first() {
                let _ = app.fs_scope().allow_directory(&source.path, true);
            }

            let active_source = sources.first().cloned();

            let source_path = active_source.as_ref().map(|v| v.path.as_path());
            let initial_settings =
                services::JsonSettingsStore::for_app(app.handle(), source_path).load_merged();

            let fm_buf_size =
                services::dot_get(&initial_settings, "indexing.frontmatter_read_buffer_size")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(512) as usize;

            let db_path = global_data_path.join("limestone.db");
            let pool = tauri::async_runtime::block_on(create_pool(&db_path)).map_err(|e| {
                Box::<dyn std::error::Error>::from(format!("failed to create db pool: {e}"))
            })?;

            app.manage(AppData {
                user,
                active_source: Mutex::new(active_source.clone()),
                settings: RwLock::new(initial_settings),
                db: pool.clone(),
            });

            // ── Not Blocking!1 ───────────────────────────────────────────────────────

            if let Some(source) = active_source {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let source_id = source.id.to_string();
                    if let Err(e) = services::reconcile_source(
                        &source.path,
                        &source_id,
                        &pool,
                        &["md"],
                        fm_buf_size,
                    )
                    .await
                    {
                        eprintln!("Reconciliation failed: {e}");
                    }
                    let _ = app_handle.emit("source-reconciled", &source_id);
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::source_commands::get_sources,
            commands::source_commands::get_active_source,
            commands::source_commands::get_source_by_id,
            commands::source_commands::create_source,
            commands::source_commands::set_active_source,
            commands::source_commands::clear_cache,
            commands::source_commands::search_documents,
            commands::settings_commands::get_setting,
            commands::settings_commands::set_setting_source,
            commands::settings_commands::set_setting_global,
            commands::document_commands::write_document,
            commands::document_commands::rename_document,
            commands::document_commands::move_document,
            commands::db_commands::sql_select,
            commands::db_commands::sql_execute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
