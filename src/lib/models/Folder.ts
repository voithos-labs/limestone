import { invoke } from '@tauri-apps/api/core';
import { select, execute } from '$lib/services/db';
import {
	deleteSavedView,
	folderPropKey,
	listSavedViewJSON,
	remapIdsInSavedViews,
	renameUnitViewPrefix
} from '$lib/models/View.svelte';
import { flushAll } from '$lib/util/flush';

export interface FolderRow {
	id: string;
	source_id: string;
	slug: string;
	parent_id: string | null;
	repo: number;
	writes_meta: number;
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
	readonly writesMeta: boolean;
	readonly createdAt: Date;
	updatedAt: Date;
	accessedAt: Date;

	constructor(row: FolderRow) {
		this.id = row.id;
		this.slug = row.slug;
		this.sourceId = row.source_id;
		this.parentId = row.parent_id ?? undefined;
		this.repo = row.repo === 1;
		this.writesMeta = row.writes_meta !== 0;
		this.createdAt = new Date(row.created_at);
		this.updatedAt = new Date(row.updated_at);
		this.accessedAt = new Date(row.accessed_at);
	}

	static async list(): Promise<Folder[]> {
		const rows = await select<FolderRow>(
			`SELECT * FROM folders WHERE parent_id IS NOT NULL ORDER BY slug ASC`,
			[]
		);
		return rows.map((r) => new Folder(r));
	}

	static async fromID(id: string): Promise<Folder> {
		const [row] = await select<FolderRow>(`SELECT * FROM folders WHERE id = ?1`, [id]);
		if (!row) throw new Error(`Folder not found: ${id}`);
		return new Folder(row);
	}

	static async metaAt(sourceId: string, dir: string): Promise<{ writes: boolean; repo: boolean }> {
		const segs = dir.split('/').filter(Boolean);
		const ids = [
			folderId(sourceId, ''),
			...segs.map((_, i) => folderId(sourceId, segs.slice(0, i + 1).join('/')))
		];
		const rows = await select<{ id: string; repo: number; writes_meta: number }>(
			`SELECT id, repo, writes_meta FROM folders WHERE id IN (${ids.map(() => '?').join(', ')})`,
			ids
		);
		const byId = new Map(rows.map((r) => [r.id, r]));
		const nearest = ids.reverse().find((id) => byId.has(id));
		return {
			writes: nearest ? byId.get(nearest)!.writes_meta !== 0 : true,
			repo: rows.some((r) => r.repo === 1)
		};
	}

	async setWritesMeta(value: boolean, gitOff: boolean): Promise<void> {
		const [row] = await select<{ parent: number | null }>(
			`SELECT writes_meta AS parent FROM folders WHERE id = ?1`,
			[this.parentId ?? '']
		);
		const inherited = (row?.parent ?? 1) !== 0 && !(gitOff && this.repo);
		await invoke('set_folder_frontmatter', {
			id: this.sourceId,
			dir: folderIdPath(this.id),
			value: value === inherited ? null : value
		});
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
					? `A folder named "${err.name}" is already there.`
					: 'A folder with that name is already there.';
			case 'into_itself':
				return "A folder can't be moved inside itself.";
			case 'invalid_name':
				return err.name
					? `"${err.name}" can't be used as a folder name.`
					: "That name can't be used for a folder.";
			case 'not_found':
				return "That folder couldn't be found. It may have been moved or deleted outside Limestone.";
			case 'source_missing':
				return 'The source folder is unavailable. Check that the drive or folder is connected.';
			case 'locked':
				return 'A file in that folder is open in another app. Close it and try again.';
			case 'permission':
				return "That folder is read-only or you don't have permission to change it.";
			case 'no_space':
				return 'Your disk is out of space.';
			default:
				return fallback;
		}
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

	static async move(sourceId: string, oldPath: string, newPath: string): Promise<string> {
		await flushAll();
		await invoke('move_folder', { sourceId, oldRelDir: oldPath, newRelDir: newPath });
		const newId = folderId(sourceId, newPath);
		await renameUnitViewPrefix(folderPropKey(oldPath), folderPropKey(newPath));
		await remapIdsInSavedViews(folderId(sourceId, oldPath), newId, true);
		const moved = await Folder.fromID(newId);
		await moved.touch();
		return newId;
	}
}

export default Folder;
