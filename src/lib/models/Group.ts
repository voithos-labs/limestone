/**
 * Okay what be a group
 *
 * There are two kinds of groups; tags and folders
 *
 * Why group? There was a reason when I thought it up and I've reconsidered a few times and settled
 * on groups, it's easier to do intersections and unions and searches with a unified unit of
 * organization -- maybe regret later issue
 *
 * So tags:
 * - global, flat tags -- unique slugs
 *
 * Folders:
 * - um folders, basically
 *
 * I'll make a note here later if I should have separated them
 *
 * todo:
 * - when folder manipulation is added to the app we'll need a way to auto-update folder-groups
 * 		I mean we kind of have this on full reload but ya know, prob want it to work while in the app
 */

import { invoke } from '@tauri-apps/api/core';
import { select, execute } from '$lib/services/db';
import { remapFolderIdsInSavedViews } from '$lib/models/View.svelte';

function folderGroupId(sourceId: string, path: string): string {
	return `folder:${sourceId}:${path}`;
}

// just wasting lines at this point
export enum GroupType {
	Tag = 'tag',
	Folder = 'folder'
}

export interface GroupRow {
	id: string;
	source_id: string;
	slug: string;
	group_type: string;
	parent_group_id: string | null;
	created_at: number;
	updated_at: number;
	accessed_at: number;
}

class Group {
	readonly id: string;
	readonly slug: string;
	readonly groupType: GroupType;
	readonly createdAt: Date;
	updatedAt: Date;
	accessedAt: Date;
	parentGroupId?: string;
	sourceId?: string;

	// ── State ───────────────────────────────────────────────────────────────────────────

	constructor(row: GroupRow) {
		this.id = row.id;
		this.slug = row.slug;
		this.groupType = row.group_type as GroupType;
		this.createdAt = new Date(row.created_at);
		this.updatedAt = new Date(row.updated_at);
		this.accessedAt = new Date(row.accessed_at);
		this.parentGroupId = row.parent_group_id ?? undefined;
		this.sourceId = row.source_id ?? undefined;
	}

	static async list(): Promise<Group[]> {
		const rows = await select<GroupRow>(`SELECT * FROM groups ORDER BY slug ASC`, []);
		return rows.map((r) => new Group(r));
	}

	static async fromID(id: string): Promise<Group> {
		const [row] = await select<GroupRow>(
			`SELECT *
             FROM groups
             WHERE id = ?1`,
			[id]
		);
		if (!row) throw new Error(`Group not found: ${id}`);
		return new Group(row);
	}

	static async fromIDs(ids: string[]): Promise<Group[]> {
		if (ids.length === 0) return [];
		const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
		const rows = await select<GroupRow>(`SELECT * FROM groups WHERE id IN (${placeholders})`, ids);
		return rows.map((r) => new Group(r));
	}

	async touch(): Promise<void> {
		await execute(
			`UPDATE groups
             SET accessed_at = ?2
             WHERE id = ?1`,
			[this.id, Date.now()]
		);
	}

	async updateSlug(newSlug: string): Promise<void> {
		//todo: this has to actually find and replace all slugs in documents too
		const now = Date.now();
		await execute(
			`UPDATE groups
             SET slug = ?1,
                 updated_at = ?3
             WHERE id = ?2`,
			[newSlug, this.id, now]
		);
		(this as { slug: string }).slug = newSlug;
		this.updatedAt = new Date(now);
	}

	static async fromSlugs(slugs: string[]): Promise<Group[]> {
		if (slugs.length === 0) return [];
		const placeholders = slugs.map((_, i) => `?${i + 1}`).join(', ');
		const rows = await select<GroupRow>(
			`SELECT * FROM groups WHERE source_id IS NULL AND group_type = 'tag' AND slug IN (${placeholders})`,
			slugs
		);
		return rows.map((r) => new Group(r));
	}

	// ── FOLDERS ─────────────────────────────────────────────────────────────────────────

	/**
	 * Create a folder group
	 */
	static async createFolder(
		slug: string,
		sourceId: string,
		parent?: { id: string; path: string }
	): Promise<Group> {
		const path = parent ? `${parent.path}/${slug}` : slug;
		const id: string = await invoke('create_folder', { sourceId, relDir: path });
		return Group.fromID(id);
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

	static async moveFolder(sourceId: string, oldPath: string, newPath: string): Promise<string> {
		await invoke('move_folder', { sourceId, oldRelDir: oldPath, newRelDir: newPath });
		const newId = folderGroupId(sourceId, newPath);
		await remapFolderIdsInSavedViews(folderGroupId(sourceId, oldPath), newId);
		const moved = await Group.fromID(newId);
		await moved.touch();
		return newId;
	}
}

export default Group;
