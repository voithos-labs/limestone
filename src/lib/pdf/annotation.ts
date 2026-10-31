import { sanitizeSegment } from '#lib/util/paths.js';

/**
 * A PDF annotation as it sits in its note's frontmatter, under the one `annotation` key. Pure:
 * reading, naming and the note body, nothing that touches the disk or the DOM.
 */

// ── Public API ──────────────────────────────────────────────────────────────

export type AnnotationKind = 'highlight' | 'region' | 'ink';

/** A box on a page as fractions of the page's width and height: `[x, y, w, h]`, top-left origin. */
export type PageRect = [number, number, number, number];

/** One ink stroke: page fractions as a flat `[x0, y0, x1, y1, …]` list, plus its pen. */
export interface InkStroke {
	color: InkColor;
	width: InkWidth;
	points: number[];
}

export interface AnnotationFields {
	pdf: string;
	page: number;
	kind: AnnotationKind;
	color: AnnotationColor;
	rects: PageRect[];
	quote?: string;
	prefix?: string;
	suffix?: string;
	strokes?: InkStroke[];
	edition?: string;
}

/** An annotation note as the viewer holds it: its fields plus the note's comment. */
export interface Annotation extends AnnotationFields {
	/** The annotation note's document id. */
	id: string;
	title: string;
	relPath: string;
	comment: string;
}

export const ANNOTATION_COLORS = ['amber', 'sage', 'sky', 'rose', 'violet'] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

export const INK_COLORS = ['graphite', 'pink', 'blue', 'green'] as const;
export type InkColor = (typeof INK_COLORS)[number];

export const INK_WIDTHS = ['fine', 'medium', 'marker'] as const;
export type InkWidth = (typeof INK_WIDTHS)[number];

/** The frontmatter key an annotation note's fields live under. */
export const ANNOTATION_KEY = 'annotation';

/**
 * The fields of an annotation note's frontmatter, or null when the note isn't one. Unknown keys
 * are kept, so a later version's fields survive an edit made here.
 */
export function readAnnotation(properties: Record<string, unknown>): AnnotationFields | null {
	const raw = properties[ANNOTATION_KEY];
	if (!raw || typeof raw !== 'object') return null;
	const a = raw as Record<string, unknown>;
	if (typeof a.pdf !== 'string' || !a.pdf) return null;
	if (!Number.isInteger(a.page) || (a.page as number) < 1) return null;
	if (!isKind(a.kind)) return null;
	return {
		...a,
		pdf: a.pdf,
		page: a.page as number,
		kind: a.kind,
		color: isColor(a.color) ? a.color : 'amber',
		rects: Array.isArray(a.rects) ? a.rects.map(parseRect).filter(isRect) : [],
		...(Array.isArray(a.strokes) ? { strokes: a.strokes.map(parseStroke).filter(isStroke) } : {})
	} as AnnotationFields;
}

/**
 * The fields as they're written to frontmatter: a rect as `x y w h` and a stroke's points as
 * `x,y x,y …`, so a note stays a few readable lines rather than one number per line.
 */
export function storedFields(fields: AnnotationFields): Record<string, unknown> {
	// ink wears its strokes' colors, so a highlight color would only mislead a reader
	const { color, ...rest } = fields;
	return {
		...(fields.kind === 'ink' ? rest : { ...rest, color }),
		rects: fields.rects.map((r) => r.join(' ')),
		...(fields.strokes
			? {
					strokes: fields.strokes.map((s) => ({
						...s,
						points: pairs(s.points)
							.map(([x, y]) => `${x},${y}`)
							.join(' ')
					}))
				}
			: {})
	};
}

/**
 * The note's title, which is also its file name and its link text:
 * `Hale & Ortiz 2023, p3 - The rate tracked particulate deposition`. The PDF's name keeps a bare
 * `[[…]]` link unique across PDFs, and the opening words make it readable outside Limestone.
 */
export function annotationTitle(pdfTitle: string, page: number, label: string): string {
	return linkSafe(`${pdfTitle}, p${page} - ${label}`);
}

/** The words an annotation is named by: a highlight's opening words, or its kind. */
export function annotationLabel(kind: AnnotationKind, quote?: string): string {
	if (kind !== 'highlight' || !quote) return kind;
	const words = quote.split(/\s+/).filter(Boolean);
	const label = words.slice(0, LABEL_WORDS).join(' ');
	return words.length > LABEL_WORDS ? label : label.replace(/[.,;:]+$/, '');
}

/**
 * The note body: the quote as a blockquote, so the note reads on its own outside Limestone, then
 * the comment.
 */
export function annotationBody(quote: string | undefined, comment: string): string {
	const text = comment.trim();
	if (!quote) return text ? `${text}\n` : '';
	const block = quote
		.split('\n')
		.map((line) => `> ${line}`)
		.join('\n');
	return text ? `${block}\n\n${text}\n` : `${block}\n`;
}

/**
 * The words before a quote, set to read on into it. A prefix starting in lowercase was cut
 * mid-sentence, which is the only sign of it the stored fields keep.
 */
export function leadIn(prefix: string): string {
	const lead = /^\p{Ll}/u.test(prefix) ? '…' : '';
	const gap = /[([{"'“‘]$/.test(prefix) ? '' : ' ';
	return `${lead}${prefix}${gap}`;
}

/** The words after a quote, cut at a word, so they read on from the highlight. */
export function runOn(suffix: string): string {
	const lead = /^[,.;:!?)\]]/.test(suffix) ? '' : ' ';
	const tail = /[.!?]["')\]]?$/.test(suffix) ? '' : '…';
	return `${lead}${suffix}${tail}`;
}

/** The comment in a note body: everything after a leading blockquote, or the whole body. */
export function annotationComment(body: string): string {
	const lines = body.replace(/^\s*\n/, '').split('\n');
	let i = 0;
	while (i < lines.length && /^\s*>/.test(lines[i])) i++;
	return lines.slice(i).join('\n').trim();
}

// ── Internal ────────────────────────────────────────────────────────────────

const LABEL_WORDS = 6;

// a wikilink target can't hold these, and the title doubles as one
const UNLINKABLE_CHARS = /[[\]|#^]/g;

function linkSafe(name: string): string {
	return sanitizeSegment(name.replace(UNLINKABLE_CHARS, ' ').replace(/\s+/g, ' '));
}

function isKind(v: unknown): v is AnnotationKind {
	return v === 'highlight' || v === 'region' || v === 'ink';
}

function isColor(v: unknown): v is AnnotationColor {
	return ANNOTATION_COLORS.includes(v as AnnotationColor);
}

export function isStroke(v: unknown): v is InkStroke {
	if (!v || typeof v !== 'object') return false;
	const s = v as Record<string, unknown>;
	return (
		INK_COLORS.includes(s.color as InkColor) &&
		INK_WIDTHS.includes(s.width as InkWidth) &&
		Array.isArray(s.points) &&
		s.points.length >= 2 &&
		s.points.every((n) => Number.isFinite(n))
	);
}

function parseRect(v: unknown): unknown {
	return typeof v === 'string' ? v.trim().split(/\s+/).map(Number) : v;
}

function parseStroke(v: unknown): unknown {
	if (!v || typeof v !== 'object' || typeof (v as InkStroke).points !== 'string') return v;
	const text = (v as { points: string }).points;
	return {
		...v,
		points: text
			.trim()
			.split(/[\s,]+/)
			.map(Number)
	};
}

function pairs(points: number[]): [number, number][] {
	const out: [number, number][] = [];
	for (let i = 0; i + 1 < points.length; i += 2) out.push([points[i], points[i + 1]]);
	return out;
}

function isRect(v: unknown): v is PageRect {
	return Array.isArray(v) && v.length === 4 && v.every((n) => Number.isFinite(n));
}
