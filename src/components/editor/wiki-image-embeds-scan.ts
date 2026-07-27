/**
 * Recognizer for Obsidian-style image embeds — `![[cat.png]]`, `![[cat.png|300]]`.
 * Pure and aragonite-free so a spec can drive it directly; `wiki-image-embeds-plugin.ts` is
 * what turns a recognized span into an inline image node.
 */

/** One embed's span within the raw it was recognized in. */
export interface WikiImageEmbed {
	/** Offset of the `!`. */
	start: number;
	/** Offset just past the closing `]]`. */
	end: number;
	/** Source-relative image path, which the editor's `resolveImageUrl` resolves. */
	target: string;
	/** Display width in pixels, from a numeric `|size` modifier. */
	width?: number;
}

// The extensions the previous editor embedded. A target outside the set stays literal
// text, which is what keeps `![[some-note.md]]` — an Obsidian note link — readable.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

/** The bytes an embed opens with: the scanner's prefix, and the plugin's rung and rewrite gate. */
export const OPEN = '![[';
const NEWLINE = 0x0a;
const OPEN_PAREN = 0x28;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

/**
 * The embed at `pos` within `raw[pos, end)`, or null to leave the bytes to the scanner.
 * `pos` is at the `!`.
 *
 * Declining is a contract, not tidiness. This runs ahead of the built-in scanner, whose
 * grammar overlaps: `![[a]](u)` is a legal GFM image with alt `[a]`. A claim here wins,
 * and a wrong claim is silent — the bytes still serialize, they just stop being the
 * construct the author wrote. Hence two gates, both declining rather than guessing.
 */
export function recognizeWikiImageEmbed(
	raw: string,
	pos: number,
	end: number
): WikiImageEmbed | null {
	if (!raw.startsWith(OPEN, pos)) return null;
	const innerStart = pos + OPEN.length;
	// Nothing is sliced until the construct is known to close on this line — a document
	// of prose runs this at every `![[` on every keystroke.
	const innerEnd = findClose(raw, innerStart, end);
	if (innerEnd < 0) return null;
	const embedEnd = innerEnd + 2;
	// A `(` here means the built-in scanner has an inline image to parse; leave it be. The
	// window bound is not decoration: reading `raw[end]` would be outside the range this is
	// handed, and a `(` beyond it is a tail the built-in scanner cannot reach either.
	if (embedEnd < end && raw.charCodeAt(embedEnd) === OPEN_PAREN) return null;

	const inner = raw.slice(innerStart, innerEnd);
	const bar = inner.indexOf('|');
	const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
	if (!isImagePath(target)) return null;
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
 * Offset of the `]]` closing the embed opened at `from`, or -1 before one appears. A
 * bracket or a line ending ends the search, so an unterminated `![[` cannot swallow the
 * embed that follows it — the inner opener is the one that wins.
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

function isImagePath(target: string): boolean {
	const dot = target.lastIndexOf('.');
	if (dot < 1) return false;
	return IMAGE_EXTS.has(target.slice(dot + 1).toLowerCase());
}

/** A size modifier is a plain pixel width; Obsidian's `w x h` form is not supported. */
function parseWidth(modifier: string): number | undefined {
	if (!/^\d+$/.test(modifier)) return undefined;
	const width = Number(modifier);
	return width > 0 ? width : undefined;
}
