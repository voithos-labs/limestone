/**
 * Recognizer for Obsidian-style image embeds — `![[cat.png]]`, `![[cat.png|300]]` —
 * over one block's raw source. Pure and aragonite-free so the editor's test suite can
 * drive it directly; `wiki-embed-plugin.ts` is what turns the spans into decorations.
 */

/** One embed's span within the raw it was scanned from. */
export interface WikiEmbed {
	/** Offset of the `!`. */
	start: number;
	/** Offset just past the closing `]]`. */
	end: number;
	/** Source-relative image path, for the host's resolver. */
	target: string;
	/** Display width in pixels, from a numeric `|size` modifier. */
	width?: number;
}

// The extensions the previous editor embedded. A target outside the set stays literal
// text, which is what keeps `![[some-note.md]]` — an Obsidian note link — readable.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

const OPEN = '![[';
const NEWLINE = 0x0a;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

/** Every embed in `raw`, in source order. */
export function scanWikiEmbeds(raw: string): WikiEmbed[] {
	const embeds: WikiEmbed[] = [];
	let from = 0;
	for (;;) {
		const open = raw.indexOf(OPEN, from);
		if (open < 0) return embeds;
		const innerStart = open + OPEN.length;
		// Nothing is sliced until the construct is known to close on this line — a
		// document of prose runs this scan per keystroke.
		const innerEnd = findClose(raw, innerStart);
		if (innerEnd < 0) {
			from = innerStart;
			continue;
		}
		const embed = readEmbed(raw, open, innerStart, innerEnd);
		if (!embed) {
			from = innerStart;
			continue;
		}
		embeds.push(embed);
		from = embed.end;
	}
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Offset of the `]]` closing the embed opened at `from`, or -1 before one appears. A
 * bracket or a line ending ends the search, so an unterminated `![[` cannot swallow the
 * embed that follows it — the inner opener is the one that wins.
 */
function findClose(raw: string, from: number): number {
	for (let i = from; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		if (code === NEWLINE || code === OPEN_BRACKET) return -1;
		if (code === CLOSE_BRACKET) {
			return raw.charCodeAt(i + 1) === CLOSE_BRACKET ? i : -1;
		}
	}
	return -1;
}

function readEmbed(
	raw: string,
	start: number,
	innerStart: number,
	innerEnd: number
): WikiEmbed | null {
	const inner = raw.slice(innerStart, innerEnd);
	const bar = inner.indexOf('|');
	const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
	if (!isImagePath(target)) return null;
	const width = bar < 0 ? undefined : parseWidth(inner.slice(bar + 1).trim());
	return {
		start,
		end: innerEnd + 2,
		target,
		...(width !== undefined ? { width } : {})
	};
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
