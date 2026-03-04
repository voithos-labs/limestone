/**
 * Okay, just thinking maybe I'll just use this tauri plugin, but default handling is nice:
 * https://v2.tauri.app/plugin/store/
 */


export type SettingValue = string | number | boolean | null | SettingValue[] | { [key: string]: SettingValue };

export interface Settings {
    [key: string]: SettingValue;
}
