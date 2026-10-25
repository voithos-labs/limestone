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
    #[cfg(not(windows))]
    {
        let _ = (window, dark, alt);
        if enabled {
            Err("mica is only available on Windows".to_string())
        } else {
            Ok(())
        }
    }
}
