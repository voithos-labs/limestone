import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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

export function defaultNoteDir(source: Pick<Source, 'note_location'>): string {
	return source.note_location.replace(/^[\\/]+|[\\/]+$/g, '');
}

export async function getSource(id: string): Promise<Source> {
	const result = await invoke<Source | null>('get_source_by_id', { id });
	if (!result) throw new Error(`Source not found: ${id}`);
	return result;
}

export async function listSources(): Promise<Source[]> {
	return await invoke<Source[]>('get_sources');
}

export async function getDefaultSourceId(): Promise<string | null> {
	return await invoke<string | null>('get_default_source_id');
}

export async function setDefaultSource(id: string | null): Promise<void> {
	await invoke('set_default_source', { id });
}

export function pickCreationSource(
	sources: Source[],
	defaultId: string | null
): Source | undefined {
	return sources.find((s) => s.id === defaultId) ?? sources[0];
}

export async function creationSource(): Promise<Source | undefined> {
	const [sources, defaultId] = await Promise.all([listSources(), getDefaultSourceId()]);
	return pickCreationSource(sources, defaultId);
}

export async function touchSource(id: string): Promise<void> {
	await invoke('touch_source', { id });
}

export async function removeSource(id: string): Promise<void> {
	await invoke('delete_source', { id });
	await syncWatchers();
}

export async function createSource(
	path: string,
	title: string,
	config: SourceConfig,
	useFrontmatter: boolean
): Promise<Source> {
	const source = await invoke<Source>('create_source', {
		path,
		title,
		noteLocation: config.note_location,
		assetLocation: config.asset_location,
		useFrontmatter
	});
	await syncWatchers();
	return source;
}

export async function isGitRepo(path: string): Promise<boolean> {
	return await invoke<boolean>('is_git_repo', { path });
}

export async function listDirs(path: string): Promise<string[]> {
	return await invoke<string[]>('list_dirs', { path });
}

export async function makeDir(path: string, rel: string): Promise<void> {
	await invoke('make_dir', { path, rel });
}

export async function updateSource(id: string, config: SourceConfig): Promise<void> {
	await invoke('update_source', {
		id,
		noteLocation: config.note_location,
		assetLocation: config.asset_location
	});
}

export interface FsChanged {
	source_id: string;
	rel_paths: string[];
}

export async function reconcileSource(id: string): Promise<void> {
	await invoke('reconcile_source', { id });
}

export async function syncWatchers(): Promise<void> {
	const sources = await listSources();
	await invoke('set_watched_paths', {
		targets: sources.map((s) => ({ id: s.id, path: s.path }))
	});
}

// in my testing this is long enough to not double-trigger with a git commit
// lol
const RECONCILE_DEBOUNCE_MS = 500;
const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function startWatching(): Promise<UnlistenFn> {
	const unlisten = await listen<FsChanged>('fs-changed', (e) => {
		const id = e.payload.source_id;
		clearTimeout(reconcileTimers.get(id));
		reconcileTimers.set(
			id,
			setTimeout(() => {
				reconcileTimers.delete(id);
				void reconcileSource(id);
			}, RECONCILE_DEBOUNCE_MS)
		);
	});
	await syncWatchers();
	return () => {
		unlisten();
		for (const timer of reconcileTimers.values()) clearTimeout(timer);
		reconcileTimers.clear();
	};
}
