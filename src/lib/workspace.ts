import { load, type Store } from '@tauri-apps/plugin-store';

export interface Workspace {
	activeTheme: string;
}

const DEFAULTS: Workspace = {
	activeTheme: 'default-dark'
};

let store: Store | null = null;

async function getStore() {
	if (!store) {
		store = await load('workspace.json');
	}
	return store;
}

export async function loadWorkspace(): Promise<Workspace> {
	const s = await getStore();
	return {
		activeTheme: (await s.get<string>('activeTheme')) ?? DEFAULTS.activeTheme
	};
}

export async function updateWorkspace(partial: Partial<Workspace>): Promise<void> {
	const s = await getStore();
	for (const [key, value] of Object.entries(partial)) {
		await s.set(key, value);
	}
}
