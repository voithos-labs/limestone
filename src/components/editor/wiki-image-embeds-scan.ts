/**
 * Recognizes Obsidian-style image embeds: `![[cat.png]]`, `![[cat.png|300]]`. Pure, and imports
 * nothing from aragonite, so a test can call it directly.
 */

import { isImageTarget } from './image-targets';

/** One embed's span within the raw it was recognized in. */
export interface WikiImageEmbed {
	/** Offset of the `!`. */
	start: number;
	/** Offset just past the closing `]]`. */
	end: number;
	/** Image path relative to the source, turned into a URL by `resolveImageUrl`. */
	target: string;
	/** Display width in pixels, from a numeric `|size` modifier. */
	width?: number;
}

/** What an embed starts with: the scan prefix, the plugin's trigger, and its rewrite guard. */
export const OPEN = '![[';
const NEWLINE = 0x0a;
const OPEN_PAREN = 0x28;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

/**
 * The embed starting at `pos` (the `!`) within `raw[pos, end)`, or null to hand the text back to
 * aragonite's own parser. Returning null matters: this runs first and wins whatever it claims,
 * the two syntaxes overlap (`![[a]](u)` is a valid Markdown image), and claiming wrongly is
 * silent. The text still saves, it just stops being what the author wrote.
 */
export function recognizeWikiImageEmbed(
	raw: string,
	pos: number,
	end: number
): WikiImageEmbed | null {
	if (!raw.startsWith(OPEN, pos)) return null;
	const innerStart = pos + OPEN.length;
	// No string is cut until we know it closes on this line; a long document runs this at
	// every `![[` on every keystroke.
	const innerEnd = findClose(raw, innerStart, end);
	if (innerEnd < 0) return null;
	const embedEnd = innerEnd + 2;
	// A `(` right after means aragonite has an ordinary Markdown image to parse, so leave it
	// alone. The `< end` check matters: past that is outside the range this call was handed,
	// and a `(` there is text aragonite cannot reach either.
	if (embedEnd < end && raw.charCodeAt(embedEnd) === OPEN_PAREN) return null;

	const inner = raw.slice(innerStart, innerEnd);
	const bar = inner.indexOf('|');
	const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
	if (!isImageTarget(target)) return null;
	const width = bar < 0 ? undefined : parseWidth(inner.slice(bar + 1).trim());
	return {
		start: pos,
		end: embedEnd,
		target,
		...(width !== undefined ? { width } : {})
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Offset of the `]]` that closes the embed opened at `from`, or -1. A `[` or a line break stops
 * the search, so an unclosed `![[` cannot swallow the embed after it.
 */
function findClose(raw: string, from: number, end: number): number {
	for (let i = from; i < end; i++) {
		const code = raw.charCodeAt(i);
		if (code === NEWLINE || code === OPEN_BRACKET) return -1;
		if (code === CLOSE_BRACKET) {
			return i + 1 < end && raw.charCodeAt(i + 1) === CLOSE_BRACKET ? i : -1;
		}
	}
	return -1;
}

/** A size modifier is a plain pixel width; Obsidian's `w x h` form is not supported. */
function parseWidth(modifier: string): number | undefined {
	if (!/^\d+$/.test(modifier)) return undefined;
	const width = Number(modifier);
	return width > 0 ? width : undefined;
}
