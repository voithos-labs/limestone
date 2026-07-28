use serde_json::Value;
use sqlx::{AssertSqlSafe, SqlitePool};
use serde::Serialize;
use std::sync::RwLock;
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

mod commands;
mod services;

const SCHEMA: &str = include_str!("../sql/schema.sql");
const SCHEMA_VERSION: i64 = 1;

pub async fn create_pool(
    path: &std::path::Path,
) -> Result<SqlitePool, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("sqlite:{}?mode=rwc", path.display());
    let pool = SqlitePool::connect(&url).await?;
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&pool)
        .await?;
    if version != SCHEMA_VERSION {
        // rebuild db on schema version change
        sqlx::raw_sql(
            "DROP TABLE IF EXISTS documents_fts;
             DROP TABLE IF EXISTS document_groups;
             DROP TABLE IF EXISTS documents;
             DROP TABLE IF EXISTS groups;
             DROP TABLE IF EXISTS sources;",
        )
        .execute(&pool)
        .await?;
    }
    sqlx::raw_sql(SCHEMA).execute(&pool).await?;
    sqlx::raw_sql(AssertSqlSafe(format!(
        "PRAGMA user_version = {SCHEMA_VERSION}"
    )))
        .execute(&pool)
        .await?;
    Ok(pool)
}

pub struct AppData {
    pub user: services::User,
    pub settings: RwLock<Value>,
    pub db: SqlitePool,
    pub bulk: services::BulkRunner,
}

#[derive(Serialize, Clone)]
pub(crate) struct Reconciled<'a> {
    pub source_id: &'a str,
    pub skipped: usize,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .register_uri_scheme_protocol("appasset", |ctx, request| {
            let not_found = || {
                tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap()
            };
            let name = request.uri().path().trim_start_matches('/');
            if name.is_empty() || name.contains(['/', '\\', '%']) || name.contains("..") {
                return not_found();
            }
            let Ok(dir) = ctx.app_handle().path().app_data_dir() else {
                return not_found();
            };
            let file = dir.join("assets").join(name);
            let Ok(bytes) = std::fs::read(&file) else {
                return not_found();
            };
            let mime = match file
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .as_deref()
            {
                Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("webp") => "image/webp",
                Some("gif") => "image/gif",
                Some("avif") => "image/avif",
                Some("svg") => "image/svg+xml",
                _ => "application/octet-stream",
            };
            tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", mime)
                .header("Cache-Control", "public, max-age=31536000, immutable")
                .body(bytes)
                .unwrap()
        })
        .setup(move |app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }

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

            let assets_path = global_data_path.join("assets");
            std::fs::create_dir_all(&assets_path)?;
            let _ = app
                .asset_protocol_scope()
                .allow_directory(&assets_path, true);

            // Allow fs and asset access to all source dirs
            for source in &sources {
                let _ = app.fs_scope().allow_directory(&source.path, true);
                let _ = app
                    .asset_protocol_scope()
                    .allow_directory(&source.path, true);
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

            {
                let app_handle = app.handle().clone();
                let pool = pool.clone();
                tauri::async_runtime::spawn(async move {
                    let mut tasks = Vec::new();
                    for source in sources {
                        let app_handle = app_handle.clone();
                        let pool = pool.clone();
                        tasks.push(tauri::async_runtime::spawn(async move {
                            let source_id = source.id.to_string();
                            // reconcile returns changes for deep indexing (FTS, in-body tags, etc.)
                            let (changed, skipped) =
                                services::reconcile_source(&source, &pool, &["md"], fm_buf_size)
                                    .await
                                    .unwrap_or_else(|e| {
                                        eprintln!("Reconciliation failed: {e}");
                                        Default::default()
                                    });
                            let _ = app_handle.emit(
                                "source-reconciled",
                                Reconciled {
                                    source_id: &source_id,
                                    skipped,
                                },
                            );
                            if let Err(e) = services::index_fts(&pool, &source, changed).await {
                                eprintln!("FTS indexing failed: {e}");
                            }
                            let _ = app_handle.emit("source-indexed", &source_id);
                        }));
                    }
                    for task in tasks {
                        let _ = task.await;
                    }
                    if let Err(e) = services::cleanup_orphan_tag_groups(&pool).await {
                        eprintln!("tag cleanup failed: {e}");
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::source_commands::get_sources,
            commands::source_commands::is_git_repo,
            commands::source_commands::get_source_by_id,
            commands::source_commands::update_source,
            commands::source_commands::create_source,
            commands::source_commands::delete_source,
            commands::source_commands::touch_source,
            commands::source_commands::get_default_source_id,
            commands::source_commands::set_default_source,
            commands::source_commands::list_dirs,
            commands::source_commands::make_dir,
            commands::settings_commands::get_app_info,
            commands::settings_commands::get_setting,
            commands::settings_commands::get_all_settings,
            commands::settings_commands::get_default_settings,
            commands::settings_commands::set_setting_global,
            commands::settings_commands::reset_setting_global,
            commands::settings_commands::reset_all_settings,
            commands::document_commands::write_document,
            commands::document_commands::rename_document,
            commands::document_commands::move_document,
            commands::document_commands::save_document_meta,
            commands::document_commands::set_document_tags,
            commands::document_commands::delete_document,
            commands::bulk_ops_commands::bulk_set_view_field,
            commands::bulk_ops_commands::bulk_rename_view_field,
            commands::bulk_ops_commands::bulk_rename_view,
            commands::bulk_ops_commands::bulk_rename_view_option,
            commands::bulk_ops_commands::bulk_remove_view_field,
            commands::db_commands::sql_select,
            commands::db_commands::sql_execute,
            commands::asset_commands::import_global_asset,
            commands::asset_commands::import_global_asset_bytes,
            commands::asset_commands::import_source_asset,
            commands::asset_commands::import_source_asset_bytes,
            commands::history_commands::storage_load,
            commands::history_commands::storage_save,
            commands::history_commands::storage_remove,
            commands::history_commands::storage_load_range,
            commands::history_commands::storage_list_roots,
            commands::history_commands::storage_remove_range,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
