/**
 * The # menu: tags already used somewhere in the library, filtered as you type. A # opens it only
 * where recognizeTag would read a tag, and a pick completes the tag; typing past a pick just
 * makes a new tag, as typing always has.
 */

import type { InlineMenuItem, InlineMenuSource } from '@voithos-labs/aragonite';
import { select } from '$lib/services/db';
import { isTagOpening, isTagQuery } from './wikilinks-scan';

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
