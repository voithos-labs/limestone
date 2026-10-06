import { exists } from '@tauri-apps/plugin-fs';
import { listSources, sourceName } from '$lib/models/Source';
import { folderIdPath, folderIdSource } from '$lib/models/Folder';

export type FolderPresence =
	| { state: 'ok' }
	| { state: 'removed' }
	| { state: 'source_missing'; source: string }
	| { state: 'gone'; source: string; path: string };

export async function folderPresence(unitId: string): Promise<FolderPresence> {
	const source = (await listSources()).find((s) => s.id === folderIdSource(unitId));
	if (!source) return { state: 'removed' };
	const name = sourceName(source);
	if (!(await exists(source.path).catch(() => false)))
		return { state: 'source_missing', source: name };
	const path = folderIdPath(unitId);
	if (!path || (await exists(`${source.path}/${path}`).catch(() => true))) return { state: 'ok' };
	return { state: 'gone', source: name, path };
}
