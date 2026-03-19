import { invoke } from '@tauri-apps/api/core';

export interface Source {
	id: string;
	title: string;
	path: string;
	created_at: string;
	accessed_at: string;
}

export async function getActiveSource(): Promise<Source> {
	const source = await invoke<Source | null>('get_active_source');
	if (!source) throw new Error('No active source');
	return source;
}
