/**
 * The #tags written in a note's text, found the way the editor draws them: each is one of the
 * tag widgets recognizeTag opens, so a # in code, mid-word or in a link's address isn't one.
 */

import { getContentRange, isProseKind, parse, parseInline } from '@voithos-labs/aragonite';
import type { InlineNode } from '@voithos-labs/aragonite';
import { walkBlocks } from '@voithos-labs/aragonite/plugin';
import { tagSlug } from '$lib/models/Tag';
import { BODY_TAG_KIND } from './wikilinks-plugin';

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
