import { sanitizeSegment } from '#lib/util/paths.js';

/**
 * A PDF annotation as it sits in its note's frontmatter, under the one `annotation` key. Pure:
 * reading, naming and the note body, nothing that touches the disk or the DOM.
 */

// ── Public API ──────────────────────────────────────────────────────────────

export type AnnotationKind = 'highlight' | 'region' | 'ink';

/**
 * A box on a page as fractions of the page's width and height, top-left origin. `page` is set
 * only on a highlight's rect on a later page than the annotation's own, and those come last.
 */
export type PageRect = [x: number, y: number, w: number, h: number, page?: number];

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
	/** The page's text just before the quote, ending with the space between them if there is one. */
	prefix?: string;
	/** The page's text just after the quote, starting with the space between them if there is one. */
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
 * The fields as they're written to frontmatter: a rect as `x y w h` (`p4 x y w h` on another
 * page) and a stroke's points as `x,y x,y …`, so a note stays a few readable lines rather than
 * one number per line.
 */
export function storedFields(fields: AnnotationFields): Record<string, unknown> {
	// ink wears its strokes' colors, so a highlight color would only mislead a reader
	const { color, ...rest } = fields;
	return {
		...(fields.kind === 'ink' ? rest : { ...rest, color }),
		rects: fields.rects.map(
			([x, y, w, h, page]) => `${page ? `p${page} ` : ''}${x} ${y} ${w} ${h}`
		),
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

/** The pages an annotation marks: its own, then any its highlight runs on to. */
export function pagesOf(a: Pick<AnnotationFields, 'page' | 'rects'>): number[] {
	return [...new Set([a.page, ...a.rects.map((r) => rectPage(r, a.page))])];
}

/** An annotation's rects on `page`, as fractions of that page. */
export function rectsOn(a: Pick<AnnotationFields, 'page' | 'rects'>, page: number): PageRect[] {
	return a.rects.filter((r) => rectPage(r, a.page) === page);
}

/**
 * The note's title, which is also its file name and its link text:
 * `Hale & Ortiz 2023, p3 - The rate tracked particulate deposition`. The PDF's name keeps a bare
 * `[[…]]` link unique across PDFs, and the opening words make it readable outside Limestone.
 */
export function annotationTitle(pdfTitle: string, page: number, label: string): string {
	return linkSafe(`${pdfTitle}, p${page} - ${label}`);
}

/**
 * The PDF, page and label an annotation note's title names, or null when it isn't shaped as
 * `annotationTitle` makes them. A title is link-safe, so a `#` means a heading link elsewhere.
 */
export function parseAnnotationTitle(
	title: string
): { pdfTitle: string; page: number; label: string } | null {
	if (title.includes('#')) return null;
	const m = TITLE_SHAPE.exec(title);
	const page = Number(m?.[2]);
	return m && page >= 1 ? { pdfTitle: m[1], page, label: m[3] } : null;
}

/**
 * The words an annotation is named by: the opening words of its quote, or of the text a box
 * covers, or else its kind.
 */
export function annotationLabel(kind: AnnotationKind, text?: string): string {
	const words = (text ?? '').split(/\s+/).filter(Boolean);
	if (words.length === 0) return kind;
	const label = words.slice(0, LABEL_WORDS).join(' ');
	return words.length > LABEL_WORDS ? label : label.replace(/[.,;:]+$/, '');
}

/** The note body, which is the comment alone: the quote lives only in the frontmatter. */
export function annotationBody(comment: string): string {
	const text = comment.trim();
	return text ? `${text}\n` : '';
}

/**
 * The words before a quote, set to read on into it. A prefix starting in lowercase was cut
 * mid-sentence, which is the only sign of it the stored fields keep.
 */
export function leadIn(prefix: string): string {
	return /^\p{Ll}/u.test(prefix) ? `…${prefix}` : prefix;
}

/** The words after a quote, cut at a word, so they read on from the highlight. */
export function runOn(suffix: string): string {
	return /[.!?]["')\]]?$/.test(suffix) ? suffix : `${suffix}…`;
}

/** The comment a note body holds. */
export function annotationComment(body: string): string {
	return body.trim();
}

// ── Internal ────────────────────────────────────────────────────────────────

const LABEL_WORDS = 6;

// greedy, so a PDF title holding its own ", p2 - " still splits at the last one
const TITLE_SHAPE = /^(.+), p(\d+) - (.+)$/;

// the title doubles as a file name and a link target; a character neither can hold goes, rather
// than turning into a hyphen mid-sentence
function linkSafe(name: string): string {
	return sanitizeSegment(name, ' ').replace(/\s+/g, ' ');
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
	if (typeof v !== 'string') return v;
	const [, page, box] = /^\s*(?:p(\d+)\s+)?(.*)$/s.exec(v)!;
	const rect = box.trim().split(/\s+/).map(Number);
	if (rect.length !== 4) return null;
	return page ? [...rect, Number(page)] : rect;
}

function rectPage(r: PageRect, own: number): number {
	return r[4] ?? own;
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
	return (
		Array.isArray(v) &&
		v.every((n) => Number.isFinite(n)) &&
		(v.length === 4 || (v.length === 5 && Number.isInteger(v[4]) && v[4] >= 1))
	);
}
