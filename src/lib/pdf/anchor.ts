import type { PageRect } from './annotation.js';

/**
 * Turns what's on screen into what an annotation stores: a text selection or a dragged box on a
 * rendered page becomes page-fraction rects, and a selection also takes its quote and the text
 * either side. Fractions don't change with zoom, so a stored rect fits the page at any width.
 */

// ── Public API ──────────────────────────────────────────────────────────────

export interface TextTarget {
	rects: PageRect[];
	quote: string;
	prefix: string;
	suffix: string;
}

/**
 * The target of a selection that starts in `page`'s text layer, cut at the end of that page so
 * one annotation always belongs to one page. Null when nothing selectable is left.
 */
export function textTarget(range: Range, page: HTMLElement): TextTarget | null {
	const layer = page.querySelector('.textLayer');
	if (!layer || !layer.contains(range.startContainer)) return null;
	const clipped = range.cloneRange();
	if (!layer.contains(range.endContainer)) clipped.setEnd(layer, layer.childNodes.length);

	const { text, start, end } = layerText(layer, clipped);
	const quote = collapse(text.slice(start, end));
	if (!quote) return null;
	const box = page.getBoundingClientRect();
	const rects = mergeLines([...clipped.getClientRects()].filter((r) => r.width > 0.5))
		.map((r) => toFraction(r, box))
		.filter((r) => r[2] > 0 && r[3] > 0);
	if (rects.length === 0) return null;
	const from = Math.max(0, start - CONTEXT);
	const to = Math.min(text.length, end + CONTEXT);
	// whole words at the far ends, which the digest shows as context; the edges by the quote stay
	// exact because that's what finds the quote again
	const prefix = text.slice(from, start).replace(from > 0 ? /^\S*\s/ : /^/, '');
	const suffix = text.slice(end, to).replace(to < text.length ? /\s\S*$/ : /$/, '');
	return { rects, quote, prefix: collapse(prefix), suffix: collapse(suffix) };
}

/** A box dragged between two client points, as a fraction rect of `page`. */
export function boxTarget(
	from: { x: number; y: number },
	to: { x: number; y: number },
	page: HTMLElement
): PageRect | null {
	const box = page.getBoundingClientRect();
	const left = clamp(Math.min(from.x, to.x), box.left, box.right);
	const right = clamp(Math.max(from.x, to.x), box.left, box.right);
	const top = clamp(Math.min(from.y, to.y), box.top, box.bottom);
	const bottom = clamp(Math.max(from.y, to.y), box.top, box.bottom);
	if (right - left < MIN_BOX_PX || bottom - top < MIN_BOX_PX) return null;
	return toFraction(new DOMRect(left, top, right - left, bottom - top), box);
}

/** A client point as page fractions, for ink. */
export function pagePoint(
	e: { clientX: number; clientY: number },
	page: HTMLElement
): [number, number] {
	const box = page.getBoundingClientRect();
	return [round((e.clientX - box.left) / box.width), round((e.clientY - box.top) / box.height)];
}

// ── Internal ────────────────────────────────────────────────────────────────

const CONTEXT = 48;
const MIN_BOX_PX = 6;

/**
 * The page's text in reading order with where `range` starts and ends in it. The text layer ends
 * each line with a `<br>` rather than a space, so the breaks are read as spaces; the DOM's own
 * text joins the last word of a line to the first of the next.
 */
function layerText(layer: Element, range: Range): { text: string; start: number; end: number } {
	// a boundary on an element sits before that element's child at its offset
	const startNode = boundaryNode(range.startContainer, range.startOffset);
	const endNode = boundaryNode(range.endContainer, range.endOffset);
	let text = '';
	let start = -1;
	let end = -1;
	const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node === startNode) start = text.length;
		if (node === endNode) end = text.length;
		if (node instanceof Text) {
			if (node === range.startContainer) start = text.length + range.startOffset;
			if (node === range.endContainer) end = text.length + range.endOffset;
			text += node.data;
		} else if ((node as Element).tagName === 'BR') {
			text += ' ';
		}
	}
	return { text, start: Math.max(0, start), end: end < 0 ? text.length : end };
}

function boundaryNode(container: Node, offset: number): Node | null {
	return container instanceof Text ? null : (container.childNodes[offset] ?? null);
}

function collapse(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** The text layer draws a box per run of glyphs; one per line reads as one highlight. */
function mergeLines(rects: DOMRect[]): DOMRect[] {
	const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
	const lines: DOMRect[] = [];
	for (const r of sorted) {
		const last = lines.at(-1);
		const sameLine =
			last && Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top) > r.height / 2;
		if (last && sameLine && r.left <= last.right + r.height) {
			const left = Math.min(last.left, r.left);
			const top = Math.min(last.top, r.top);
			lines[lines.length - 1] = new DOMRect(
				left,
				top,
				Math.max(last.right, r.right) - left,
				Math.max(last.bottom, r.bottom) - top
			);
		} else {
			lines.push(r);
		}
	}
	return lines;
}

function toFraction(r: DOMRect, box: DOMRect): PageRect {
	return [
		round((r.left - box.left) / box.width),
		round((r.top - box.top) / box.height),
		round(r.width / box.width),
		round(r.height / box.height)
	];
}

function round(n: number): number {
	return Math.round(n * 10000) / 10000;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}
