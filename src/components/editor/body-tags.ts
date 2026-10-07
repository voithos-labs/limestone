import {
	getContentRange,
	isProseKind,
	parse,
	parseInline,
	type InlineNode,
	type InlineMenuItem,
	type InlineMenuSource
} from '@voithos-labs/aragonite';
import { walkBlocks } from '@voithos-labs/aragonite/plugin';
import { tagSlug } from '#lib/models/Tag.js';
import { BODY_TAG_KIND, isTagOpening, isTagQuery } from './wikilinks';
import { select } from '#lib/services/db.js';

/**
 * The #tags written in a note's text, found the way the editor draws them: each is one of the
 * tag widgets recognizeTag opens, so a # in code, mid-word or in a link's address isn't one.
 */

export interface BodyTag {
	slug: string;
	/** Every place it's written, in reading order: the block and the offset just after the tag. */
	places: { path: number[]; end: number }[];
}

export function bodyTags(markdown: string): BodyTag[] {
	const bySlug = new Map<string, BodyTag>();
	walkBlocks(parse(markdown), (node, path) => {
		if (!isProseKind(node.kind)) return;
		const range = getContentRange(node);
		for (const tag of tagNodes(parseInline(node.raw, range.start, range.end))) {
			const slug = tagSlug(tag.text ?? '');
			if (!slug) continue;
			const entry = bySlug.get(slug) ?? { slug, places: [] };
			entry.places.push({ path, end: tag.end });
			bySlug.set(slug, entry);
		}
		return 'skip';
	});
	return [...bySlug.values()];
}

export type TagPlace = BodyTag['places'][number];

// Each call for the same tag gives its next place in reading order, wrapping; another tag starts over
export function createTagStepper(): (tags: BodyTag[], slug: string) => TagPlace | null {
	let last = { slug: '', index: -1 };
	return (tags, slug) => {
		const places = tags.find((t) => t.slug === slug)?.places ?? [];
		if (places.length === 0) return null;
		const index = last.slug === slug ? (last.index + 1) % places.length : 0;
		last = { slug, index };
		return places[index];
	};
}

function tagNodes(nodes: InlineNode[]): InlineNode[] {
	return nodes.flatMap((n) =>
		n.kind === BODY_TAG_KIND ? [n] : n.children ? tagNodes(n.children) : []
	);
}

/**
 * The # menu: tags already used somewhere in the library, filtered as you type. A # opens it only
 * where recognizeTag would read a tag, and a pick completes the tag; typing past a pick just
 * makes a new tag, as typing always has.
 */

export const TAG_MENU = 'limestone-tags';

const MAX_ROWS = 8;

export function tagMenu(): InlineMenuSource {
	return {
		name: TAG_MENU,
		trigger: '#',
		opensAt: isTagOpening,
		accepts: isTagQuery,
		items: async ({ query, signal }) => {
			const rows = await usedTags(query.toLowerCase());
			return signal.aborted ? [] : rows;
		}
	};
}

/**
 * Tags starting with the query, or with a nested part that does (#proj finds work/project). The
 * tag already typed in full comes first, so Enter on it changes nothing rather than completing
 * it into a longer one.
 */
async function usedTags(query: string): Promise<InlineMenuItem[]> {
	const rows = await select<{ slug: string; n: number }>(
		`SELECT t.slug, COUNT(*) AS n FROM tags t
		 JOIN document_tags dt ON dt.tag_id = t.id
		 JOIN documents d ON d.id = dt.document_id AND d.deleted_at IS NULL
		 WHERE substr(t.slug, 1, length(?1)) = ?1 OR instr(t.slug, '/' || ?1) > 0
		 GROUP BY t.id
		 ORDER BY t.slug = ?1 DESC, substr(t.slug, 1, length(?1)) = ?1 DESC, n DESC, t.slug
		 LIMIT ?2`,
		[query, MAX_ROWS]
	);
	return rows.map((r) => ({
		id: r.slug,
		label: `#${r.slug}`,
		detail: String(r.n),
		insert: `#${r.slug}`
	}));
}
