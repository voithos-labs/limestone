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

import { select, execute, parseUtc } from '$lib/db';
import { v4 as uuidv4 } from 'uuid';

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
	created_at: string;
	updated_at: string;
	accessed_at: string;
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
		this.createdAt = parseUtc(row.created_at);
		this.updatedAt = parseUtc(row.updated_at);
		this.parentGroupId = row.parent_group_id ?? undefined;
		this.sourceId = row.source_id ?? undefined;
	}

	/**
	 * Create a new group
	 */
	private static async create(
		slug: string,
		sourceId?: string,
		groupType: GroupType = GroupType.Tag,
		parentGroupId: string | undefined = undefined
	): Promise<Group> {
		const id = uuidv4();

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

	// okay wtf was I on writing the above create

	/**
	 * Create a tag group
	 *
	 * Tags are global and the slug must be unique
	 */
	static async createTag(slug: string): Promise<Group> {
		return Group.create(slug, undefined, GroupType.Tag, undefined);
	}

	/**
	 * Create a folder group
	 *
	 * NOTE: only folders in the root of a source have parentGroupId NULL; leave blank
	 */
	static async createFolder(
		slug: string,
		sourceId: string,
		parentGroupId?: string
	): Promise<Group> {
		return Group.create(slug, sourceId, GroupType.Folder, parentGroupId);
	}

	static async list(): Promise<Group[]> {
		const rows = await select<GroupRow>(
			`SELECT * FROM groups ORDER BY slug ASC`,
			[]
		);
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

	async touch(): Promise<void> {
		await execute(
			`UPDATE groups
             SET accessed_at = datetime('now')
             WHERE id = ?1`,
			[this.id]
		);
	}

	async updateSlug(newSlug: string): Promise<void> {
		//todo: this has to actually find and replace all slugs in documents too
		const [{ updated_at }] = await select<{ updated_at: string }>(
			`UPDATE groups
             SET slug = ?1,
                 updated_at = datetime('now')
             WHERE id = ?2
             RETURNING updated_at`,
			[newSlug, this.id]
		);
		(this as { slug: string }).slug = newSlug;
		this.updatedAt = parseUtc(updated_at);
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
