import { load, type Store } from '@tauri-apps/plugin-store';

export interface State {
	activeTheme: string;
}

const DEFAULTS: State = {
	activeTheme: 'default-dark'
};

let store: Store | null = null;

async function getStore() {
	if (!store) {
		store = await load('state.json');
	}
	return store;
}

export async function loadState(): Promise<State> {
	const s = await getStore();
	return {
		activeTheme: (await s.get<string>('activeTheme')) ?? DEFAULTS.activeTheme
	};
}

export async function updateState(partial: Partial<State>): Promise<void> {
	const s = await getStore();
	for (const [key, value] of Object.entries(partial)) {
		await s.set(key, value);
	}
}
