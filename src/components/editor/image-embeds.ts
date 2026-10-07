import {
	definePlugin,
	registerInlineSyntax,
	INLINE_PRIORITIES,
	type EditorPlugin,
	type ImageFields,
	type InlineNode
} from '@voithos-labs/aragonite/plugin';

/**
 * Obsidian-style `![[cat.png]]` image embeds, the format limestone's older notes and imported
 * vaults use; new images are written in standard `![](…)` syntax, and this keeps the old ones
 * rendering. An embed parses into aragonite's ordinary `image` node, so the editor treats it
 * as a real image everywhere, not just visually. Two consequences: this gets first look at `!`,
 * ahead of aragonite's own image parser, so it must bow out where the two syntaxes overlap (see
 * wiki-image-embeds-scan.ts), and every edit comes back in aragonite's image shape, so
 * `rewriteImage` is what puts the `![[…]]` back.
 */
export function wikiImageEmbedsPlugin(): EditorPlugin {
	return definePlugin({
		name: 'limestone-wiki-image-embeds',
		setup() {
			registerInlineSyntax('!', wikiImageEmbedNode, {
				prefix: OPEN,
				priority: INLINE_PRIORITIES.prefixOverride,
				rewriteImage: rewriteWikiImageEmbed
			});
		}
	});
}

// ── Internal ────────────────────────────────────────────────────────────────

function wikiImageEmbedNode(raw: string, pos: number, end: number): InlineNode | null {
	const embed = recognizeWikiImageEmbed(raw, pos, end);
	if (!embed) return null;
	return {
		kind: 'image',
		start: embed.start,
		end: embed.end,
		children: [],
		// An embed names its file and nothing else, so the path doubles as the alt text.
		alt: embed.target,
		url: embed.target,
		...(embed.width !== undefined ? { width: embed.width } : {})
	};
}

/**
 * Writes an edited embed back as `![[…]]`, returning null for anything the syntax cannot hold
 * (it has room for a path and a width, nothing else). Null makes the editor reject the edit
 * visibly; quietly ignoring the field would hand back the same text, and the edit would vanish
 * with no explanation at all.
 */
function rewriteWikiImageEmbed(source: string, fields: ImageFields): string | null {
	// This is also called for text nested inside the node, which this plugin never produced.
	// Rewriting that would nest `![[` inside itself.
	if (!source.startsWith(OPEN)) return null;
	if (fields.title !== undefined || fields.label !== undefined) return null;
	// alt is copied from the path when parsing and never stored, so what comes back here is
	// either the new path or the old one. Anything else is real alt text, with nowhere to put it.
	const target = recognizeWikiImageEmbed(source, 0, source.length)?.target;
	if (fields.alt !== fields.url && fields.alt !== target) return null;
	// Height is dropped rather than refused: the syntax has one size slot, and keeping the width
	// someone just dragged to serves them better than rejecting the drag.
	return `${OPEN}${fields.url}${fields.width !== undefined ? `|${fields.width}` : ''}]]`;
}

/**
 * Recognizes Obsidian-style image embeds: `![[cat.png]]`, `![[cat.png|300]]`. Pure, and imports
 * nothing from aragonite, so a test can call it directly.
 */

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

/**
 * Which paths limestone treats as images. Shared by the embed recognizer and the URL resolver on
 * purpose: if the two lists drifted, an embed one accepted and the other did not would render as
 * a broken image with no explanation. Anything outside this set stays plain text, which is what
 * keeps `![[some-note.md]]` readable.
 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

/** Whether `target`'s extension is an image one. A bare `.png` with no name is not a path. */
export function isImageTarget(target: string): boolean {
	const dot = target.lastIndexOf('.');
	if (dot < 1) return false;
	return IMAGE_EXTS.has(target.slice(dot + 1).toLowerCase());
}
