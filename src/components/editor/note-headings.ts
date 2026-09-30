/**
 * A note's headings as link fragments, and which one a fragment names. The [[Note# menu lists
 * these and a heading link jumps with findHeading, so anything the menu writes always lands.
 */

import { getContentRange, parse } from '@voithos-labs/aragonite';
import { headingLevel, walkBlocks } from '@voithos-labs/aragonite/plugin';
import { headingFragment } from '$lib/wikilinks';

export interface NoteHeading {
	text: string;
	level: number;
	/** Where the heading sits in the note, as the editor addresses blocks. */
	path: number[];
}

export function noteHeadings(markdown: string): NoteHeading[] {
	const headings: NoteHeading[] = [];
	walkBlocks(parse(markdown), (node, path) => {
		const level = headingLevel(node);
		if (level === null) return;
		const range = getContentRange(node);
		const text = headingFragment(node.raw.slice(range.start, range.end));
		if (text) headings.push({ text, level, path });
		return 'skip';
	});
	return headings;
}

// The first heading with exactly this text, else the first that differs only by case (a link
// typed by hand), else null
export function findHeading(markdown: string, fragment: string): NoteHeading | null {
	const wanted = headingFragment(fragment);
	const headings = noteHeadings(markdown);
	return (
		headings.find((h) => h.text === wanted) ??
		headings.find((h) => h.text.toLowerCase() === wanted.toLowerCase()) ??
		null
	);
}
