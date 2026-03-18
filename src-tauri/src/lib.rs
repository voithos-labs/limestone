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
    pub active_vault: Mutex<Option<services::Vault>>,
    pub settings: RwLock<Value>,
    pub db: SqlitePool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:limestone.db",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "initial schema",
                        sql: include_str!("../sql/schema.sql"),
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
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

            // Load vaults
            let vaults_path = global_data_path.join("vaults.json");
            let mut vaults = services::JsonSettingsStore {
                path: vaults_path,
                default_json: None,
                override_path: None,
            }
            .load::<services::Vaults>()
            .unwrap_or_default()
            .vaults;
            vaults.sort_by_key(|v| std::cmp::Reverse(v.accessed_at));

            // Allow fs access to vault dir
            if let Some(vault) = vaults.first() {
                let _ = app.fs_scope().allow_directory(&vault.path, true);
            }

            let active_vault = vaults.first().cloned();

            let vault_path = active_vault.as_ref().map(|v| v.path.as_path());
            let initial_settings =
                services::JsonSettingsStore::for_app(app.handle(), vault_path).load_merged();

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
                active_vault: Mutex::new(active_vault.clone()),
                settings: RwLock::new(initial_settings),
                db: pool.clone(),
            });

            // ── Not Blocking!1 ───────────────────────────────────────────────────────

            if let Some(vault) = active_vault {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let vault_id = vault.id.to_string();
                    if let Err(e) = services::reconcile_vault(
                        &vault.path,
                        &vault_id,
                        &pool,
                        &["md"],
                        fm_buf_size,
                    )
                    .await
                    {
                        eprintln!("Reconciliation failed: {e}");
                    }
                    let _ = app_handle.emit("vault-reconciled", &vault_id);
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_commands::get_vaults,
            commands::vault_commands::get_active_vault,
            commands::vault_commands::get_vault_by_id,
            commands::vault_commands::create_vault,
            commands::vault_commands::set_active_vault,
            commands::vault_commands::clear_cache,
            commands::vault_commands::search_documents,
            commands::settings_commands::get_setting,
            commands::settings_commands::set_setting_vault,
            commands::settings_commands::set_setting_global,
            commands::document_commands::write_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
