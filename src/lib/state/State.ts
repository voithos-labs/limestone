import { load, type Store } from '@tauri-apps/plugin-store';
import type { EditorJSON } from '$lib/state/EditorState.svelte';

// ── State Model ──────────────────────────────────────────────────────────────────────

export interface State {
	activeTheme: string;
	editors: EditorJSON[];
	viewTabs?: { kind: string; state?: Record<string, any> }[];
}
const DEFAULTS: State = {
	activeTheme: 'default-dark',
	editors: []
};

// ── Json Store ───────────────────────────────────────────────────────────────────────

let store: Store | null = null;

async function getStore() {
	if (!store) {
		store = await load('state.json');
	}
	return store;
}

// ── Manage State ─────────────────────────────────────────────────────────────────────

export async function loadState(): Promise<State> {
	const s = await getStore();
	return {
		activeTheme: (await s.get<string>('activeTheme')) ?? DEFAULTS.activeTheme,
		editors: (await s.get<EditorJSON[]>('editors')) ?? DEFAULTS.editors,
		viewTabs: (await s.get<State['viewTabs']>('viewTabs')) ?? []
	};
}

export async function updateState(partial: Partial<State>): Promise<void> {
	const s = await getStore();
	for (const [key, value] of Object.entries(partial)) {
		await s.set(key, value);
	}
}
