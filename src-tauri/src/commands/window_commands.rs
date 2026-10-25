use tauri::WebviewWindow;

#[tauri::command]
pub fn set_mica(window: WebviewWindow, enabled: bool, dark: bool, alt: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let result = if !enabled {
            window_vibrancy::clear_mica(&window)
        } else if alt {
            window_vibrancy::apply_tabbed(&window, Some(dark))
        } else {
            window_vibrancy::apply_mica(&window, Some(dark))
        };
        result.map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        use tauri::Theme;
        use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};
        if !enabled {
            return window_vibrancy::clear_vibrancy(&window)
                .map(|_| ())
                .map_err(|e| e.to_string());
        }
        let theme = if dark { Theme::Dark } else { Theme::Light };
        window.set_theme(Some(theme)).map_err(|e| e.to_string())?;
        let material = if alt {
            NSVisualEffectMaterial::Sidebar
        } else {
            NSVisualEffectMaterial::UnderWindowBackground
        };
        window_vibrancy::apply_vibrancy(
            &window,
            material,
            Some(NSVisualEffectState::FollowsWindowActiveState),
            None,
        )
        .map_err(|e| e.to_string())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (window, dark, alt);
        if enabled {
            Err("translucency is only available on Windows and macOS".to_string())
        } else {
            Ok(())
        }
    }
}
