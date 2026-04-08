import { load, type Store } from '@tauri-apps/plugin-store';
import type EditorState from '$lib/state/EditorState';

// ── State Model ──────────────────────────────────────────────────────────────────────

export interface State {
	activeTheme: string;
	editors: EditorState[];
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
		editors: (await s.get<EditorState[]>('editors')) ?? DEFAULTS.editors
	};
}

export async function updateState(partial: Partial<State>): Promise<void> {
	const s = await getStore();
	for (const [key, value] of Object.entries(partial)) {
		await s.set(key, value);
	}
}
