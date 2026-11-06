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
 * The target of a selection that starts on `page` and may run on through the pages after it,
 * which are its next siblings and carry their numbers in `data-page`. Null when the selection
 * holds no text on `page`.
 */
export function textTarget(range: Range, page: HTMLElement): TextTarget | null {
	const parts: (TextTarget & { el: HTMLElement })[] = [];
	for (let el: Element | null = page; el && range.intersectsNode(el); el = el.nextElementSibling) {
		const part = pageTarget(range, el as HTMLElement);
		if (part) parts.push({ ...part, el: el as HTMLElement });
	}
	const [first, last] = [parts[0], parts[parts.length - 1]];
	if (first?.el !== page) return null;
	return {
		rects: parts.flatMap(({ el, rects }) =>
			el === page
				? rects
				: rects.map(([x, y, w, h]): PageRect => [x, y, w, h, Number(el.dataset.page)])
		),
		quote: parts.map((p) => p.quote).join(' '),
		prefix: first.prefix,
		suffix: last.suffix
	};
}

/**
 * The range a reader would select from character `from.offset` of one text layer up to
 * `to.offset` of the same or a later one, counting each layer's text as `textTarget` reads it.
 */
export function textRange(
	from: { layer: Element; offset: number },
	to: { layer: Element; offset: number }
): Range {
	const range = document.createRange();
	range.setStart(...textPlace(from.layer, from.offset, false));
	range.setEnd(...textPlace(to.layer, to.offset, true));
	return range;
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

/**
 * The text a box on `page` covers, or else the line just under it (a figure's caption) or over
 * it, in reading order: what a region or ink is named by. Empty when no text is near.
 */
export function textNear(page: HTMLElement, rect: PageRect): string {
	const box = page.getBoundingClientRect();
	const [x, y, w, h] = rect;
	const runs = [...page.querySelectorAll('.textLayer span')]
		.filter((span) => !span.querySelector('span'))
		.map((span) => ({
			text: span.textContent ?? '',
			r: toFraction(span.getBoundingClientRect(), box)
		}))
		.filter(({ text, r }) => text.trim() && r[0] < x + w && r[0] + r[2] > x);
	const middle = ({ r }: { r: PageRect }) => r[1] + r[3] / 2;
	const covered = runs.filter((run) => middle(run) > y && middle(run) < y + h);
	if (covered.length) return collapse(covered.map((run) => run.text).join(' '));
	const gap = (run: { r: PageRect }) =>
		middle(run) >= y + h ? middle(run) - (y + h) : (y - middle(run)) * 2;
	const nearest = runs.filter((run) => gap(run) < NEAR_LINE).sort((a, b) => gap(a) - gap(b))[0];
	if (!nearest) return '';
	const line = runs.filter((run) => Math.abs(middle(run) - middle(nearest)) < nearest.r[3] / 2);
	return collapse(line.map((run) => run.text).join(' '));
}

// ── Internal ────────────────────────────────────────────────────────────────

const CONTEXT = 48;
const MIN_BOX_PX = 6;
// how far from a box, as a fraction of the page's height, a line can still name it; a line over
// the box counts as twice as far as one under it, since captions sit under figures
const NEAR_LINE = 0.06;

/** The part of a selection on one page, its rects as fractions of that page. */
function pageTarget(range: Range, page: HTMLElement): TextTarget | null {
	const layer = page.querySelector('.textLayer');
	const clipped = layer && within(range, layer);
	if (!layer || !clipped) return null;

	const { text, start, end } = layerText(layer, clipped);
	const quoted = quoteIn(text, start, end);
	if (!quoted.quote) return null;
	const box = page.getBoundingClientRect();
	const rects = mergeLines([...clipped.getClientRects()].filter((r) => r.width > 0.5))
		.map((r) => toFraction(r, box))
		.filter((r) => r[2] > 0 && r[3] > 0);
	if (rects.length === 0) return null;
	return { rects, ...quoted };
}

/**
 * The quote selected from `start` to `end` of a page's text, and the text either side of it.
 * Space at the selection's edges goes to the text beside it, so a quote cut mid-word has none.
 */
function quoteIn(text: string, start: number, end: number): Omit<TextTarget, 'rects'> {
	const picked = text.slice(start, end);
	const from = start + picked.length - picked.trimStart().length;
	const to = Math.max(from, end - picked.length + picked.trimEnd().length);
	const near = Math.max(0, from - CONTEXT);
	const far = Math.min(text.length, to + CONTEXT);
	// whole words at the far ends, which the digest shows as context
	const prefix = text.slice(near, from).replace(near > 0 ? /^\S*\s/ : /^/, '');
	const suffix = text.slice(to, far).replace(far < text.length ? /\s\S*$/ : /$/, '');
	return {
		quote: collapse(text.slice(from, to)),
		prefix: spaced(prefix).trimStart(),
		suffix: spaced(suffix).trimEnd()
	};
}

/** The part of `range` inside `node`, or null when they don't meet. */
function within(range: Range, node: Node): Range | null {
	const part = document.createRange();
	part.selectNodeContents(node);
	if (part.compareBoundaryPoints(Range.START_TO_START, range) < 0)
		part.setStart(range.startContainer, range.startOffset);
	if (part.compareBoundaryPoints(Range.END_TO_END, range) > 0)
		part.setEnd(range.endContainer, range.endOffset);
	return part.collapsed ? null : part;
}

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

/** The text node and offset in it of a place in the layer's text; an end sits after a character. */
function textPlace(layer: Element, offset: number, end: boolean): [Node, number] {
	const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	let at = 0;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node instanceof Text) {
			if (end ? offset <= at + node.length : offset < at + node.length) return [node, offset - at];
			at += node.length;
		} else if ((node as Element).tagName === 'BR') {
			at += 1;
		}
	}
	return [layer, layer.childNodes.length];
}

function boundaryNode(container: Node, offset: number): Node | null {
	return container instanceof Text ? null : (container.childNodes[offset] ?? null);
}

function collapse(text: string): string {
	return spaced(text).trim();
}

/** Each run of whitespace as one space. */
function spaced(text: string): string {
	return text.replace(/\s+/g, ' ');
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
