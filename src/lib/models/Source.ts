import { invoke } from '@tauri-apps/api/core';

export interface Source {
	id: string;
	title: string;
	path: string;
	created_at: string;
	accessed_at: string;
}

export async function getSource(id: string): Promise<Source> {
	const result = await invoke<Source | null>('get_source_by_id', { id });
	if (!result) throw new Error(`Source not found: ${id}`);
	return result;
}

export async function listSources(): Promise<Source[]> {
	return await invoke<Source[]>('get_sources');
}

export async function touchSource(id: string): Promise<void> {
	await invoke('touch_source', { id });
}

export async function removeSource(id: string): Promise<void> {
	await invoke('delete_source', { id });
}
