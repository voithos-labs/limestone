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
import { bulkPerSource, remapIdsInSavedViews, type BulkResult } from '$lib/models/View.svelte';
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

export function tagId(slug: string): string {
	return `tag:${slug}`;
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

	static async list(): Promise<Tag[]> {
		const rows = await select<TagRow>(`SELECT * FROM tags ORDER BY slug ASC`, []);
		return rows.map((r) => new Tag(r));
	}

	static async fromID(id: string): Promise<Tag> {
		const [row] = await select<TagRow>(`SELECT * FROM tags WHERE id = ?1`, [id]);
		if (!row) throw new Error(`Tag not found: ${id}`);
		return new Tag(row);
	}

	static async fromIDs(ids: string[]): Promise<Tag[]> {
		if (ids.length === 0) return [];
		const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
		const rows = await select<TagRow>(`SELECT * FROM tags WHERE id IN (${placeholders})`, ids);
		return rows.map((r) => new Tag(r));
	}

	static async fromSlugs(slugs: string[]): Promise<Tag[]> {
		if (slugs.length === 0) return [];
		const placeholders = slugs.map((_, i) => `?${i + 1}`).join(', ');
		const rows = await select<TagRow>(`SELECT * FROM tags WHERE slug IN (${placeholders})`, slugs);
		return rows.map((r) => new Tag(r));
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

	static async rename(tag: Tag, newSlug: string): Promise<string> {
		const newId = tagId(newSlug);
		if (newId === tag.id) return newId;
		await flushAll();
		const results = await bulkPerSource(
			'bulk_rename_tag',
			{ oldSlug: tag.slug, newSlug },
			{ frontmatterOnly: true, silent: true }
		);
		Tag.toastSkippedSources(results, 'renamed');
		await remapIdsInSavedViews(tag.id, newId);
		return newId;
	}

	static async delete(tag: Tag): Promise<void> {
		await flushAll();
		const results = await bulkPerSource(
			'bulk_remove_tag',
			{ slug: tag.slug },
			{ frontmatterOnly: true, silent: true }
		);
		Tag.toastSkippedSources(results, 'removed');
	}
}

export default Tag;
