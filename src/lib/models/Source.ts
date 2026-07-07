import { invoke } from '@tauri-apps/api/core';

export interface Source {
	id: string;
	title: string;
	path: string;
	created_at: string;
	accessed_at: string;
	use_frontmatter: boolean;
	note_location: string;
	asset_location: string;
	ignore: string[];
}

export interface SourceConfig {
	note_location: string;
	asset_location: string;
}

/** A source's display name is just its folder (the basename of its path). */
export function sourceName(source: Pick<Source, 'path' | 'title'>): string {
	return source.path.split(/[\\/]/).filter(Boolean).pop() || source.title;
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

export async function createSource(
	path: string,
	title: string,
	config: SourceConfig,
	useFrontmatter: boolean
): Promise<Source> {
	return await invoke<Source>('create_source', {
		path,
		title,
		noteLocation: config.note_location,
		assetLocation: config.asset_location,
		useFrontmatter
	});
}

export async function isGitRepo(path: string): Promise<boolean> {
	return await invoke<boolean>('is_git_repo', { path });
}

export async function updateSource(id: string, config: SourceConfig): Promise<void> {
	await invoke('update_source', {
		id,
		noteLocation: config.note_location,
		assetLocation: config.asset_location
	});
}
