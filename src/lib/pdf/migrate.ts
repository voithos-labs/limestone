import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pagesOf, type Annotation, type AnnotationFields, type PageRect } from './annotation.js';
import type { TextTarget } from './anchor.js';

/**
 * Carrying annotations made on an earlier edition of a PDF over to the edition on screen. Marks on
 * a page whose text and shape are unchanged move across as they are; a highlight on a changed page
 * is found again by its quote, word for word; everything else is left to place by hand.
 */

// ── Public API ──────────────────────────────────────────────────────────────

/** Why an annotation stays unplaced: its text changed, or its edition's copy wasn't kept. */
export type Unplaced = 'changed' | 'unpreserved';

/** Where an annotation goes on the new edition, with a re-found highlight's text or moved ink. */
export type Placement = Pick<AnnotationFields, 'page' | 'rects'> &
	Partial<Pick<AnnotationFields, 'quote' | 'prefix' | 'suffix' | 'strokes'>>;

/** A place in a page's text, counted as the viewer's text layer reads it: a space ends a line. */
export interface TextPoint {
	page: number;
	offset: number;
}

export interface Editions {
	/** The edition annotations are carried to. */
	doc: PDFDocumentProxy;
	/** An earlier edition's preserved copy, or null when it wasn't kept. */
	earlier: (edition: string) => Promise<PDFDocumentProxy | null>;
	/** What selecting `doc`'s text from `from` up to `to` would make. */
	select: (from: TextPoint, to: TextPoint) => Promise<TextTarget | null>;
}

export interface Carried {
	placed: { id: string; placement: Placement }[];
	unplaced: { id: string; reason: Unplaced }[];
}

/** Works out where each annotation goes on `editions.doc`; writes nothing. */
export async function carryOver(annotations: Annotation[], editions: Editions): Promise<Carried> {
	const next = pageReader(editions.doc);
	const earlier = new Map<string, Promise<PageReader | null>>();
	const carried: Carried = { placed: [], unplaced: [] };
	for (const a of annotations) {
		const edition = a.edition ?? '';
		if (!earlier.has(edition))
			earlier.set(
				edition,
				edition ? editions.earlier(edition).then(readerOf) : Promise.resolve(null)
			);
		const old = await earlier.get(edition)!;
		const placement =
			(old && (await samePages(a, old, next))) ??
			(a.kind === 'highlight' ? await findQuote(a, next, editions.select) : null);
		if (placement) carried.placed.push({ id: a.id, placement });
		else
			carried.unplaced.push({
				id: a.id,
				reason: old || a.kind === 'highlight' ? 'changed' : 'unpreserved'
			});
	}
	return carried;
}

// ── Internal ────────────────────────────────────────────────────────────────

// two pages whose width over height differs by less than this are the same shape
const SHAPE_TOLERANCE = 1e-3;

/** A page's text with its whitespace collapsed, where each character sat before, and its shape. */
interface PageFace {
	text: string;
	at: number[];
	aspect: number;
}

interface PageReader {
	count: number;
	face(n: number): Promise<PageFace>;
}

function readerOf(doc: PDFDocumentProxy | null): PageReader | null {
	return doc && pageReader(doc);
}

function pageReader(doc: PDFDocumentProxy): PageReader {
	const faces = new Map<number, Promise<PageFace>>();
	return {
		count: doc.numPages,
		face(n) {
			let face = faces.get(n);
			if (!face) faces.set(n, (face = readFace(doc, n)));
			return face;
		}
	};
}

async function readFace(doc: PDFDocumentProxy, n: number): Promise<PageFace> {
	const page = await doc.getPage(n);
	const { width, height } = page.getViewport({ scale: 1 });
	const { items } = await page.getTextContent();
	// the text layer draws each item's string and ends a line with a break, read as a space
	const raw = items.map((i) => ('str' in i ? i.str + (i.hasEOL ? ' ' : '') : '')).join('');
	return { ...collapse(raw), aspect: width / height };
}

/** The text with each run of whitespace made one space and the ends trimmed. */
function collapse(raw: string): { text: string; at: number[] } {
	let text = '';
	const at: number[] = [];
	for (let i = 0; i < raw.length; i++) {
		if (/\s/.test(raw[i])) continue;
		if (at.length && i > at[at.length - 1] + 1) {
			text += ' ';
			at.push(i - 1);
		}
		text += raw[i];
		at.push(i);
	}
	return { text, at };
}

function same(a: PageFace, b: PageFace): boolean {
	return a.text === b.text && Math.abs(a.aspect - b.aspect) < SHAPE_TOLERANCE;
}

/** The annotation as it is, moved to where its pages went, when none of them changed. */
async function samePages(
	a: Annotation,
	old: PageReader,
	next: PageReader
): Promise<Placement | null> {
	const pages = pagesOf(a);
	if (pages.some((n) => n > old.count)) return null;
	const to = await samePage(await old.face(a.page), a.page, old.count, next);
	if (to === null) return null;
	const shift = to - a.page;
	for (const n of pages.slice(1)) {
		if (n + shift > next.count || !same(await old.face(n), await next.face(n + shift))) return null;
	}
	return {
		page: to,
		rects: a.rects.map(([x, y, w, h, p]): PageRect => (p ? [x, y, w, h, p + shift] : [x, y, w, h]))
	};
}

/**
 * The page nearest `n` that reads and is shaped as `face` does. A page with no text (a scan) can
 * only be told apart by its place, so it matches only itself, and only when no page was added or
 * taken away.
 */
async function samePage(
	face: PageFace,
	n: number,
	count: number,
	next: PageReader
): Promise<number | null> {
	if (!face.text) return count === next.count && same(face, await next.face(n)) ? n : null;
	for (const m of outward(n, next.count)) if (same(face, await next.face(m))) return m;
	return null;
}

/**
 * A highlight found again where its quote reads word for word, running on across pages if need
 * be: the place whose text either side agrees most with the stored prefix and suffix, then the
 * one nearest the old page.
 */
async function findQuote(
	a: Annotation,
	next: PageReader,
	select: Editions['select']
): Promise<Placement | null> {
	const quote = (a.quote ?? '').replace(/\s+/g, ' ').trim();
	if (!quote) return null;
	const prefix = a.prefix ?? '';
	const suffix = a.suffix ?? '';
	let best: { from: TextPoint; to: TextPoint; agree: number } | null = null;
	search: for (const n of outward(a.page, next.count)) {
		const run = await textRun(next, n, quote.length + suffix.length + 1);
		const own = run.parts[0].face.text;
		for (
			let i = run.text.indexOf(quote);
			i >= 0 && i < own.length;
			i = run.text.indexOf(quote, i + 1)
		) {
			const end = i + quote.length;
			const agree =
				commonEnd(prefix, own.slice(0, i).trimEnd()) +
				commonStart(suffix, run.text.slice(end).trimStart());
			if (!best || agree > best.agree) {
				const last = pointAt(run.parts, end - 1);
				best = { from: pointAt(run.parts, i), to: { ...last, offset: last.offset + 1 }, agree };
			}
			if (agree === prefix.length + suffix.length) break search;
		}
	}
	if (!best) return null;
	const target = await select(best.from, best.to);
	// a selection reading other words would mean the page's text was counted wrongly
	return target?.quote === quote ? { page: best.from.page, ...target } : null;
}

/** Page numbers from `n` outward, nearest first. */
function* outward(n: number, count: number): Generator<number> {
	for (let d = 0; n - d >= 1 || n + d <= count; d++) {
		if (n - d >= 1 && n - d <= count) yield n - d;
		if (d && n + d <= count) yield n + d;
	}
}

interface RunPart {
	page: number;
	start: number;
	face: PageFace;
}

/**
 * Page `n`'s text, run on through the pages after it, joined by a space as a selection across
 * pages joins them, until `reach` characters past page `n`'s end are there.
 */
async function textRun(
	next: PageReader,
	n: number,
	reach: number
): Promise<{ text: string; parts: RunPart[] }> {
	const first = await next.face(n);
	const parts: RunPart[] = [{ page: n, start: 0, face: first }];
	let text = first.text;
	for (let m = n + 1; m <= next.count && text.length < first.text.length + reach; m++) {
		const face = await next.face(m);
		if (!face.text) continue;
		parts.push({ page: m, start: text.length + 1, face });
		text += ` ${face.text}`;
	}
	return { text, parts };
}

/** Where a character of a run sits in its page's text. */
function pointAt(parts: RunPart[], i: number): TextPoint {
	let part = parts[0];
	for (const p of parts) if (p.start <= i) part = p;
	return { page: part.page, offset: part.face.at[i - part.start] };
}

function commonEnd(a: string, b: string): number {
	let k = 0;
	while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
	return k;
}

function commonStart(a: string, b: string): number {
	let k = 0;
	while (k < a.length && k < b.length && a[k] === b[k]) k++;
	return k;
}
