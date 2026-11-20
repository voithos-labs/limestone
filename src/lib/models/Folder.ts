import { invoke } from '@tauri-apps/api/core';
import { select, execute } from '#lib/services/db.js';
import {
	deleteSavedView,
	dirOf,
	docIdsWithKey,
	folderPropKey,
	leftProjectKeys,
	listSavedViewJSON,
	remapIdsInSavedViews,
	removeViewKey,
	renameViewKey
} from '#lib/models/View.svelte.js';
import { flushAll } from '#lib/services/platform.js';
import { reportError, mark } from '#lib/overlays.svelte.js';

export interface FolderRow {
	id: string;
	source_id: string;
	slug: string;
	parent_id: string | null;
	repo: number;
	created_at: number;
	updated_at: number;
	accessed_at: number;
}

export function folderId(sourceId: string, path: string): string {
	return `folder:${sourceId}:${path}`;
}

export function folderIdSource(id: string): string {
	return id.slice('folder:'.length, id.indexOf(':', 'folder:'.length));
}

export function folderIdPath(id: string): string {
	return id.slice(id.indexOf(':', 'folder:'.length) + 1);
}

/** The one folder with no parent, standing for the whole source. */
export function isSourceRoot(id: string): boolean {
	return folderIdPath(id) === '';
}

class Folder {
	readonly id: string; // folder:<source_id>:<path>
	readonly slug: string;
	readonly sourceId: string;
	readonly parentId?: string;
	readonly repo: boolean;
	readonly createdAt: Date;
	updatedAt: Date;
	accessedAt: Date;
	count = 0;

	constructor(row: FolderRow) {
		this.id = row.id;
		this.slug = row.slug;
		this.sourceId = row.source_id;
		this.parentId = row.parent_id ?? undefined;
		this.repo = row.repo === 1;
		this.createdAt = new Date(row.created_at);
		this.updatedAt = new Date(row.updated_at);
		this.accessedAt = new Date(row.accessed_at);
	}

	static async list(): Promise<Folder[]> {
		const [rows, counts] = await Promise.all([
			select<FolderRow>(`SELECT * FROM folders WHERE parent_id IS NOT NULL ORDER BY slug ASC`, []),
			select<{ folder_id: string; n: number }>(
				`SELECT folder_id, COUNT(*) AS n FROM documents
				 WHERE deleted_at IS NULL AND folder_id IS NOT NULL GROUP BY folder_id`,
				[]
			)
		]);
		const byId = new Map(rows.map((r) => [r.id, new Folder(r)]));
		for (const { folder_id, n } of counts) {
			for (let f = byId.get(folder_id); f; f = f.parentId ? byId.get(f.parentId) : undefined) {
				f.count += n;
			}
		}
		return [...byId.values()];
	}

	static async fromID(id: string): Promise<Folder> {
		const [row] = await select<FolderRow>(`SELECT * FROM folders WHERE id = ?1`, [id]);
		if (!row) throw new Error(`Folder not found: ${id}`);
		return new Folder(row);
	}

	async touch(): Promise<void> {
		const now = Date.now();
		await execute(`UPDATE folders SET accessed_at = ?2 WHERE id = ?1`, [this.id, now]);
		this.accessedAt = new Date(now);
	}

	static async create(
		slug: string,
		sourceId: string,
		parent?: { id: string; path: string }
	): Promise<Folder> {
		const path = parent ? `${parent.path}/${slug}` : slug;
		const id: string = await invoke('create_folder', { sourceId, relDir: path });
		return Folder.fromID(id);
	}

	/**
	 * PARAMS
	 *
	 * e :: the error
	 *
	 * fallback :: fallback handle generic case, unknown failures, with this er message
	 */
	static describeOpError(e: unknown, fallback: string): string {
		const err = e as { kind?: string; name?: string };
		switch (err?.kind) {
			case 'already_exists':
				return err.name
					? `A folder named ${mark('folder', err.name)} is already there.`
					: 'A folder with that name is already there.';
			case 'into_itself':
				return "A folder can't be moved inside itself.";
			case 'invalid_name':
				return err.name
					? `"${err.name}" can't be used as a folder name.`
					: "That name can't be used for a folder.";
			case 'not_found':
				return "The folder couldn't be found. It may have been moved or deleted outside Limestone.";
			case 'source_missing':
				return 'The source folder is unavailable. Check that the drive or folder is connected.';
			case 'locked':
				return 'A file in the folder is open in another app. Close it and try again.';
			case 'permission':
				return "The folder is read-only or you don't have permission to change it.";
			case 'no_space':
				return 'Your disk is out of space.';
			default:
				return fallback;
		}
	}

	static reportOpError(e: unknown, fallback: string, retry?: () => unknown): void {
		reportError(e, fallback, retry, Folder.describeOpError);
	}

	// to the OS trash; project views for it and anything below it go with it
	static async delete(sourceId: string, path: string): Promise<void> {
		await flushAll();
		await invoke('delete_folder', { sourceId, relDir: path });
		const id = folderId(sourceId, path);
		for (const v of await listSavedViewJSON()) {
			if (v.unit === id || v.unit?.startsWith(id + '/')) await deleteSavedView(v.id);
		}
	}

	static readonly restorable = !navigator.userAgent.includes('Mac');

	static async restore(sourceId: string, path: string): Promise<void> {
		await invoke('restore_folder', { sourceId, relDir: path });
	}

	static async move(sourceId: string, oldPath: string, newPath: string): Promise<string> {
		await flushAll();
		await invoke('move_folder', { sourceId, oldRelDir: oldPath, newRelDir: newPath });
		const newId = folderId(sourceId, newPath);
		await renameViewKey(sourceId, newId, folderPropKey(oldPath), folderPropKey(newPath));
		await remapIdsInSavedViews(folderId(sourceId, oldPath), newId, true);
		const left = await leftProjectKeys(
			{ sourceId, dir: dirOf(oldPath) },
			{ sourceId, dir: dirOf(newPath) }
		);
		for (const key of left)
			await removeViewKey(sourceId, key, await docIdsWithKey(sourceId, newId, key));
		const moved = await Folder.fromID(newId);
		await moved.touch();
		return newId;
	}
}

export default Folder;
