/** Page geometry for the PDF viewer: where each page sits, which are near the viewport, and how to keep the reader's place when sizes change. */

// ── Public API ──────────────────────────────────────────────────────────────

export interface PageLayout {
	/** The width every page is drawn at. */
	width: number;
	/** Each page's top within the pages column. */
	tops: number[];
	heights: number[];
	/** The column's height, from the first page's top to the last page's bottom. */
	total: number;
}

/** A run of pages by index, both ends included; empty when `last < first`. */
export interface PageRange {
	first: number;
	last: number;
}

/** Heights are whole pixels so page edges stay on pixels, and so the DOM and the math agree exactly. */
export function layoutPages(ratios: readonly number[], width: number, gap: number): PageLayout {
	const tops: number[] = [];
	const heights: number[] = [];
	let y = 0;
	for (const ratio of ratios) {
		const h = Math.round(width / ratio);
		tops.push(y);
		heights.push(h);
		y += h + gap;
	}
	return { width, tops, heights, total: ratios.length ? y - gap : 0 };
}

/** The page whose top is at or above `y`: the page at that height, or the one whose gap it's in. */
export function pageAt(tops: readonly number[], y: number): number {
	let lo = 0;
	let hi = tops.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (tops[mid] <= y) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/** The pages overlapping the band from `from` to `to`. */
export function pagesBetween(layout: PageLayout, from: number, to: number): PageRange {
	const { tops, heights } = layout;
	const n = tops.length;
	if (n === 0 || to <= 0 || from >= layout.total) return { first: 0, last: -1 };
	let first = pageAt(tops, from);
	if (tops[first] + heights[first] <= from) first++;
	let last = pageAt(tops, to);
	if (tops[last] >= to) last--;
	return first <= last ? { first, last } : { first: 0, last: -1 };
}

/**
 * The pages to keep mounted: everything `need` asks for, plus whatever of `prev` is still inside
 * `keep`, so a page at the edge isn't dropped and redrawn as the reader scrolls back and forth.
 */
export function holdRange(prev: PageRange, need: PageRange, keep: PageRange): PageRange {
	if (need.last < need.first) return need;
	if (prev.last < prev.first || prev.last < keep.first || prev.first > keep.last) return need;
	return {
		first: Math.max(Math.min(prev.first, need.first), keep.first),
		last: Math.min(Math.max(prev.last, need.last), keep.last)
	};
}

/**
 * Where the viewport's top should be after the layout changes, so what the reader was looking at
 * stays put: the page at the top keeps its place, a page above it growing pushes the view down by
 * as much, and a zoom scales the distance into that page along with the page's content.
 */
export function keepPlace(before: PageLayout, after: PageLayout, viewTop: number): number {
	if (viewTop <= 0 || !before.tops.length || before.tops.length !== after.tops.length) {
		return viewTop;
	}
	const held = pageAt(before.tops, viewTop);
	const into = viewTop - before.tops[held];
	const scale = before.width > 0 ? after.width / before.width : 1;
	return after.tops[held] + into * scale;
}

/**
 * How far a canvas may be scaled past the page's CSS size before it outgrows what a browser will
 * allocate, the way pdf.js's own viewer caps it: the pixel ratio, or less for a page too large.
 */
export function canvasScale(width: number, height: number, pixelRatio: number): number {
	if (width <= 0 || height <= 0) return pixelRatio;
	return Math.min(
		pixelRatio,
		Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
		MAX_CANVAS_DIM / width,
		MAX_CANVAS_DIM / height
	);
}

// ── Internal ────────────────────────────────────────────────────────────────

// pdf.js's viewer allows twice this; a few pages stay mounted at once, each canvas 4 bytes a pixel
const MAX_CANVAS_PIXELS = 2 ** 24;
const MAX_CANVAS_DIM = 32767;
