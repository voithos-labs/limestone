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

import { select, execute } from '$lib/db';

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
	parentGroupId?: string;
	sourceId?: string;

	// ── State ───────────────────────────────────────────────────────────────────────────

	constructor(row: GroupRow) {
		this.id = row.id;
		this.slug = row.slug;
		this.groupType = row.group_type as GroupType;
		this.createdAt = new Date(row.created_at);
		this.updatedAt = new Date(row.updated_at);
		this.parentGroupId = row.parent_group_id ?? undefined;
		this.sourceId = row.source_id ?? undefined;
	}

	/**
	 * Create a new group
	 */
	private static async create(
		id: string,
		slug: string,
		sourceId: string | undefined,
		groupType: GroupType,
		parentGroupId: string | undefined
	): Promise<Group> {
		await execute(
			`INSERT INTO groups (id, source_id, slug, group_type, parent_group_id)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
			[id, sourceId, slug, groupType, parentGroupId ?? null]
		);

		const [row] = await select<GroupRow>(
			`SELECT *
             FROM groups
             WHERE id = ?1`,
			[id]
		);

		return new Group(row);
	}

	/**
	 * Create a folder group
	 */
	static async createFolder(
		slug: string,
		sourceId: string,
		parent?: { id: string; path: string }
	): Promise<Group> {
		const path = parent ? `${parent.path}/${slug}` : slug;
		return Group.create(
			folderGroupId(sourceId, path),
			slug,
			sourceId,
			GroupType.Folder,
			parent?.id
		);
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

	static async fromSlugs(slugs: string[], sourceId: string): Promise<Group[]> {
		if (slugs.length === 0) return [];
		const placeholders = slugs.map((_, i) => `?${i + 2}`).join(', ');
		const rows = await select<GroupRow>(
			`SELECT * FROM groups WHERE source_id = ?1 AND slug IN (${placeholders})`,
			[sourceId, ...slugs]
		);
		return rows.map((r) => new Group(r));
	}
}

export default Group;
