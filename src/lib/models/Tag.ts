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
 * Hi this is later, you may notice this is in a file called Tag.ts, yup I should have separated
 * them. It's about 50 fewer lines of code total but also a lot less gross, especially in schema.sql
 */

import { select, execute } from '$lib/services/db';
import {
	BUILTIN_UNITS,
	bulkPerSource,
	deleteSavedView,
	isBuiltinUnit,
	listSavedViewJSON,
	remapIdsInSavedViews,
	type BulkResult
} from '$lib/models/View.svelte';
import { sourceName, type Source } from '$lib/models/Source';
import { toasts } from '$lib/toasts.svelte';
import { flushAll } from '$lib/util/flush';

export interface TagRow {
	id: string;
	slug: string;
	created_at: number;
	updated_at: number;
	accessed_at: number;
}

// lowercase, no trailing slash, as Obsidian reads them; a leading slash is part of the name.
// A tag of only slashes folds to nothing, since "/" alone would be the source root's prop key
export function tagSlug(raw: string): string {
	const t = raw.toLowerCase().replace(/\/+$/, '');
	return /^\/*$/.test(t) ? '' : t;
}

export function tagId(slug: string): string {
	return `tag:${tagSlug(slug)}`;
}

class Tag {
	readonly id: string; // tag:<slug>
	readonly slug: string;
	readonly createdAt: Date;
	updatedAt: Date;
	accessedAt: Date;

	constructor(row: TagRow) {
		this.id = row.id;
		this.slug = row.slug;
		this.createdAt = new Date(row.created_at);
		this.updatedAt = new Date(row.updated_at);
		this.accessedAt = new Date(row.accessed_at);
	}

	private static bare(id: string): Tag {
		return new Tag({
			id,
			slug: id.slice('tag:'.length),
			created_at: 0,
			updated_at: 0,
			accessed_at: 0
		});
	}

	static async list(): Promise<Tag[]> {
		const rows = await select<TagRow>(`SELECT * FROM tags`, []);
		const tags = rows.map((r) => new Tag(r));
		const defined = [
			...Object.keys(BUILTIN_UNITS),
			...(await listSavedViewJSON()).map((v) => v.unit ?? '')
		];
		const listed = new Set(tags.map((t) => t.id));
		for (const id of defined) {
			if (id.startsWith('tag:') && !listed.has(id)) {
				listed.add(id);
				tags.push(Tag.bare(id));
			}
		}
		return tags.sort((a, b) => a.slug.localeCompare(b.slug));
	}

	static async memberCounts(): Promise<Map<string, number>> {
		const rows = await select<{ tag_id: string; n: number }>(
			`SELECT dt.tag_id, COUNT(*) AS n
             FROM document_tags dt
                      JOIN documents d ON d.id = dt.document_id
             WHERE d.deleted_at IS NULL
             GROUP BY dt.tag_id`,
			[]
		);
		return new Map(rows.map((r) => [r.tag_id, r.n]));
	}

	static async fromID(id: string): Promise<Tag> {
		const [row] = await select<TagRow>(`SELECT * FROM tags WHERE id = ?1`, [id]);
		return row ? new Tag(row) : Tag.bare(id);
	}

	static async fromIDs(ids: string[]): Promise<Tag[]> {
		if (ids.length === 0) return [];
		const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
		const rows = await select<TagRow>(`SELECT * FROM tags WHERE id IN (${placeholders})`, ids);
		const byId = new Map(rows.map((r) => [r.id, new Tag(r)]));
		return ids.map((id) => byId.get(id) ?? Tag.bare(id));
	}

	static async fromSlugs(slugs: string[]): Promise<Tag[]> {
		return Tag.fromIDs([...new Set(slugs.map(tagId))]);
	}

	async touch(): Promise<void> {
		const now = Date.now();
		await execute(`UPDATE tags SET accessed_at = ?2 WHERE id = ?1`, [this.id, now]);
		this.accessedAt = new Date(now);
	}

	private static toastSkippedSources(
		results: { source: Source; result: BulkResult }[],
		action: string
	) {
		for (const { source, result } of results) {
			if (result.source_unreachable) {
				toasts.push(
					`The ${sourceName(source)} source folder is not present, associated notes have not had their tags ${action}.`
				);
			}
		}
	}

	static async rename(tag: Tag, rawSlug: string): Promise<string> {
		const newSlug = tagSlug(rawSlug);
		const newId = tagId(newSlug);
		if (newId === tag.id || isBuiltinUnit(tag.id)) return tag.id;
		await flushAll();
		const results = await bulkPerSource(
			'bulk_rename_tag',
			{ oldSlug: tag.slug, newSlug },
			{ silent: true }
		);
		Tag.toastSkippedSources(results, 'renamed');
		await remapIdsInSavedViews(tag.id, newId);
		return newId;
	}

	static async delete(tag: Tag): Promise<void> {
		if (isBuiltinUnit(tag.id)) return;
		await flushAll();
		const results = await bulkPerSource('bulk_remove_tag', { slug: tag.slug }, { silent: true });
		Tag.toastSkippedSources(results, 'removed');
		const view = (await listSavedViewJSON()).find((v) => v.unit === tag.id);
		if (view) await deleteSavedView(view.id);
	}
}

export default Tag;
