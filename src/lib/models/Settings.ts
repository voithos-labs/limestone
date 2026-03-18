import {invoke} from '@tauri-apps/api/core';

export type SettingValue = string | number | boolean | null | SettingValue[] | { [key: string]: SettingValue };

export interface Settings {
    [key: string]: SettingValue;
}

export async function getSetting<T extends SettingValue>(key: string): Promise<T | null> {
    return invoke<T | null>('get_setting', {key});
}
