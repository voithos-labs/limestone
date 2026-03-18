import { load, type Store } from '@tauri-apps/plugin-store';
import { loadState, updateState } from './state';

export interface Theme {
	name: string;
	type: 'dark' | 'light';
	colors: Record<string, string>;
}

const DEFAULT_THEME: Theme = {
	name: 'Default Dark',
	type: 'dark',
	colors: {
		'color-bg': '#26282B',
		'color-surface': '#1A1C1D',
		'color-text-primary': '#FFFFFF',
		'color-text-secondary': '#E6E5E5',
		'color-ui-dulled': '#AFB1B3',
		'color-ui-muted': '#666666',
		'color-accent-primary': '#567B67'
	}
};

let store: Store | null = null;

async function getStore() {
	if (!store) {
		store = await load('themes.json');
	}
	return store;
}

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	for (const [key, value] of Object.entries(theme.colors)) {
		root.style.setProperty(`--${key}`, value);
	}
}

export async function loadAndApplyTheme(vaultPath: string) {
	const state = await loadState(vaultPath);
	const s = await getStore();
	const theme = await s.get<Theme>(state.activeTheme);
	applyTheme(theme ?? DEFAULT_THEME);
}

export async function setActiveTheme(vaultPath: string, name: string) {
	const s = await getStore();
	const theme = await s.get<Theme>(name);
	if (!theme) return;
	await updateState(vaultPath, { activeTheme: name });
	applyTheme(theme);
}

export async function saveTheme(key: string, theme: Theme) {
	const s = await getStore();
	await s.set(key, theme);
}

export async function listThemes(): Promise<string[]> {
	const s = await getStore();
	return await s.keys();
}

export { DEFAULT_THEME };
