import { invoke } from '@tauri-apps/api/core';

export type SettingValue =
	string | number | boolean | null | SettingValue[] | { [key: string]: SettingValue };

export interface Settings {
	[key: string]: SettingValue;
}

export type SettingType = 'boolean' | 'number';
export type SettingControl = 'toggle' | 'stepper' | 'select';

export interface SettingOption {
	value: SettingValue;
	label: string;
}

export interface SettingDef {
	key: string;
	type: SettingType;
	control: SettingControl;
	label: string;
	description?: string;
	min?: number;
	max?: number;
	step?: number;
	options?: SettingOption[];
	allowCustom?: boolean;
}

export interface SettingCategory {
	id: string;
	label: string;
	settings: SettingDef[];
}

export const SETTINGS_REGISTRY: SettingCategory[] = [
	{
		id: 'appearance',
		label: 'Appearance',
		settings: [
			{
				key: 'appearance.compact_tabs',
				type: 'boolean',
				control: 'toggle',
				label: 'Compact Tabs',
				description: 'Use smaller tabs in the top bar.'
			},
			{
				key: 'appearance.collapse_pinned_tabs',
				type: 'boolean',
				control: 'toggle',
				label: 'Collapse Pinned Tabs',
				description: 'Shrink pinned tabs down to just their icon.'
			},
			{
				key: 'appearance.compact_doc_header',
				type: 'boolean',
				control: 'toggle',
				label: 'Compact Document Header',
				description: 'Sit a document’s folder, tags, and date inline with its title when they fit.'
			},
			{
				key: 'appearance.editor_font_size',
				type: 'number',
				control: 'stepper',
				label: 'Editor Font Size',
				description: 'Font size in pixels for the document editor.',
				min: 8,
				max: 32,
				step: 1
			},
			{
				key: 'appearance.ui_scale_percent',
				type: 'number',
				control: 'select',
				label: 'UI Scale',
				description: 'Scale of the entire interface.',
				min: 25,
				max: 500,
				options: [75, 90, 100, 110, 125, 150, 175, 200].map((v) => ({
					value: v,
					label: `${v}%`
				})),
				allowCustom: true
			},
			{
				key: 'appearance.max_page_width',
				type: 'number',
				control: 'stepper',
				label: 'Max Page Width',
				description: 'Maximum content width in pixels for documents and views.',
				min: 600,
				max: 3000,
				step: 50
			}
		]
	}
];

export interface AppInfo {
	device_key: string;
	version: string;
}

export async function getAppInfo(): Promise<AppInfo> {
	return invoke<AppInfo>('get_app_info');
}

export async function getSetting<T extends SettingValue>(key: string): Promise<T | null> {
	return invoke<T | null>('get_setting', { key });
}

export async function getAllSettings(): Promise<Settings> {
	return invoke<Settings>('get_all_settings');
}

export async function getDefaultSettings(): Promise<Settings> {
	return invoke<Settings>('get_default_settings');
}

export async function setSetting(key: string, value: SettingValue): Promise<void> {
	await invoke('set_setting_global', { key, value });
}

export async function resetSetting(key: string): Promise<void> {
	await invoke('reset_setting_global', { key });
}

export async function resetAllSettings(): Promise<void> {
	await invoke('reset_all_settings');
}

export function dotGet(root: Settings, key: string): SettingValue | null {
	let current: SettingValue = root;
	for (const segment of key.split('.')) {
		if (current === null || typeof current !== 'object' || Array.isArray(current)) return null;
		const next: SettingValue | undefined = current[segment];
		if (next === undefined) return null;
		current = next;
	}
	return current;
}

function dotSet(root: Settings, key: string, value: SettingValue): void {
	const segments = key.split('.');
	let current = root;
	for (const segment of segments.slice(0, -1)) {
		const next = current[segment];
		if (next === null || typeof next !== 'object' || Array.isArray(next)) {
			current[segment] = {};
		}
		current = current[segment] as Settings;
	}
	current[segments[segments.length - 1]] = value;
}

export function settingEquals(a: SettingValue | null, b: SettingValue | null): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => settingEquals(v, b[i]));
	}
	if (
		a !== null &&
		typeof a === 'object' &&
		!Array.isArray(a) &&
		b !== null &&
		typeof b === 'object' &&
		!Array.isArray(b)
	) {
		const keys = Object.keys(a);
		return (
			keys.length === Object.keys(b).length &&
			keys.every((k) => settingEquals(a[k] ?? null, b[k] ?? null))
		);
	}
	return false;
}

export class SettingsState {
	defaults: Settings = $state({});
	values: Settings = $state({});

	async load(): Promise<void> {
		const [defaults, values] = await Promise.all([getDefaultSettings(), getAllSettings()]);
		this.defaults = defaults;
		this.values = values;
		if (import.meta.env.DEV) this.validateRegistry();
	}

	get<T extends SettingValue>(key: string): T | null {
		return dotGet(this.values, key) as T | null;
	}

	getDefault<T extends SettingValue>(key: string): T | null {
		return dotGet(this.defaults, key) as T | null;
	}

	isModified(key: string): boolean {
		return !settingEquals(this.get(key), this.getDefault(key));
	}

	async set(key: string, value: SettingValue): Promise<void> {
		dotSet(this.values, key, value);
		await setSetting(key, value);
	}

	async reset(key: string): Promise<void> {
		const def = this.getDefault(key);
		if (def !== null) dotSet(this.values, key, $state.snapshot(def as unknown) as SettingValue);
		await resetSetting(key);
	}

	private validateRegistry(): void {
		for (const category of SETTINGS_REGISTRY) {
			for (const def of category.settings) {
				if (dotGet(this.defaults, def.key) === null) {
					console.warn(`settings registry key missing from defaults: ${def.key}`);
				}
			}
		}
	}
}
