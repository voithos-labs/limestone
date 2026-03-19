import { readTextFile, writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs';

export interface SourceState {
	activeTheme: string;
}

const DEFAULT_STATE: SourceState = {
	activeTheme: 'default-dark'
};

function statePath(sourcePath: string): string {
	return `${sourcePath}/.limestone/state.json`;
}

export async function loadState(sourcePath: string): Promise<SourceState> {
	const path = statePath(sourcePath);
	if (!(await exists(path))) {
		return { ...DEFAULT_STATE };
	}
	const raw = await readTextFile(path);
	return { ...DEFAULT_STATE, ...JSON.parse(raw) };
}

export async function saveState(sourcePath: string, state: SourceState): Promise<void> {
	const dir = `${sourcePath}/.limestone`;
	if (!(await exists(dir))) {
		await mkdir(dir, { recursive: true });
	}
	await writeTextFile(statePath(sourcePath), JSON.stringify(state, null, 2));
}

export async function updateState(sourcePath: string, partial: Partial<SourceState>): Promise<void> {
	const current = await loadState(sourcePath);
	await saveState(sourcePath, { ...current, ...partial });
}
