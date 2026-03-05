use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

mod commands;
mod services;

pub struct AppData {
    pub user: services::User,
    pub active_vault: Mutex<Option<services::Vault>>,
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
        .setup(move |app| {
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

            app.manage(AppData {
                user,
                active_vault: Mutex::new(vaults.first().cloned()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_commands::get_vaults,
            commands::vault_commands::get_active_vault,
            commands::vault_commands::get_vault_by_id,
            commands::vault_commands::create_vault,
            commands::vault_commands::set_active_vault,
            commands::settings_commands::get_setting,
            commands::settings_commands::set_setting_vault,
            commands::settings_commands::set_setting_global,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
