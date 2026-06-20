use serde_json::Value;
use sqlx::SqlitePool;
use std::sync::RwLock;
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;
use window_vibrancy::apply_acrylic;

mod commands;
mod services;

const SCHEMA: &str = include_str!("../sql/schema.sql");

pub async fn create_pool(
    path: &std::path::Path,
) -> Result<SqlitePool, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("sqlite:{}?mode=rwc", path.display());
    let pool = SqlitePool::connect(&url).await?;
    sqlx::raw_sql(SCHEMA).execute(&pool).await?;
    Ok(pool)
}

pub struct AppData {
    pub user: services::User,
    pub settings: RwLock<Value>,
    pub db: SqlitePool,
    pub bulk: services::BulkRunner,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(move |app| {
            // ── Blocking Shi ─────────────────────────────────────────────────────────

            let global_data_path = app.path().app_data_dir()?;

            let cache_path = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&cache_path)?;
            let db_path = cache_path.join("index.db");
            // start db load earlyl in bg, check back in a bit
            let db_handle = tauri::async_runtime::spawn(async move { create_pool(&db_path).await });

            let user_store = services::JsonSettingsStore {
                path: global_data_path.join("user.json"),
                default_json: None,
            };

            let user = user_store.load::<services::User>().unwrap_or_else(|| {
                let new_user = services::User::initialize();
                let _ = user_store.save(&new_user);
                new_user
            });

            // Load sources
            let sources_path = global_data_path.join("sources.json");
            let sources = services::JsonSettingsStore {
                path: sources_path,
                default_json: None,
            }
            .load::<services::Sources>()
            .unwrap_or_default()
            .sources;

            // Allow fs access to all source dirs
            for source in &sources {
                let _ = app.fs_scope().allow_directory(&source.path, true);
            }

            let initial_settings = services::JsonSettingsStore::for_app(app.handle()).load_merged();

            let fm_buf_size =
                services::dot_get(&initial_settings, "indexing.frontmatter_read_buffer_size")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(512) as usize;

            // wait for db ready (probably done)
            let pool = tauri::async_runtime::block_on(db_handle)
                .unwrap_or_else(|e| panic!("db task panicked (bad): {e}"))
                .map_err(|e| {
                    Box::<dyn std::error::Error>::from(format!("failed to create db pool: {e}"))
                })?;

            let bulk = services::BulkRunner::new(global_data_path.join("bulk_ops.json"));

            app.manage(AppData {
                user,
                settings: RwLock::new(initial_settings),
                db: pool.clone(),
                bulk: bulk.clone(),
            });

            // this is for the transparency
            if let Some(window) = app.get_webview_window("main") {
                let _ = apply_acrylic(&window, Some((0, 0, 0, 0)));
            }

            // ── Not Blocking!1 ───────────────────────────────────────────────────────

            let source_paths: std::collections::HashMap<String, std::path::PathBuf> = sources
                .iter()
                .map(|s| (s.id.to_string(), s.path.clone()))
                .collect();

            {
                let app_handle = app.handle().clone();
                let pool = pool.clone();
                let bulk = bulk.clone();
                let source_paths = source_paths.clone();
                tauri::async_runtime::spawn(async move {
                    bulk.resume(&pool, &app_handle, &source_paths).await;
                });
            }

            for source in sources {
                let app_handle = app.handle().clone();
                let pool = pool.clone();
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
            commands::source_commands::get_source_by_id,
            commands::source_commands::create_source,
            commands::source_commands::delete_source,
            commands::source_commands::touch_source,
            commands::source_commands::clear_cache,
            commands::source_commands::search_documents,
            commands::settings_commands::get_setting,
            commands::settings_commands::get_all_settings,
            commands::settings_commands::set_setting_global,
            commands::document_commands::write_document,
            commands::document_commands::rename_document,
            commands::document_commands::move_document,
            commands::document_commands::save_document_meta,
            commands::document_commands::delete_document,
            commands::bulk_ops_commands::bulk_set_view_field,
            commands::bulk_ops_commands::bulk_rename_view_field,
            commands::bulk_ops_commands::bulk_rename_view,
            commands::bulk_ops_commands::bulk_rename_view_option,
            commands::bulk_ops_commands::bulk_remove_view_field,
            commands::db_commands::sql_select,
            commands::db_commands::sql_execute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
