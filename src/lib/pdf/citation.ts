/**
 * citations: how a note points back at a passage in a pdf.
 *
 * A citation is just an ordinary embed of the annotation's note, like `![[p3 - words]]`, so
 * it's plain markdown that still makes sense outside Limestone. This file makes one (copy or
 * drag), follows one (opens the pdf at that annotation), and finds the notes that cite an
 * annotation.
 */

import { toasts } from '#lib/overlays.svelte.js';
import { select } from '#lib/services/db.js';
import { stripExt } from '#lib/services/links.svelte.js';
import Doc from '#lib/models/Doc.js';
import type EditorState from '#lib/models/EditorState.svelte.js';
import type { TabState } from '#lib/models/EditorState.svelte.js';
import type { PageRect } from './annotation.js';

/* ---------------------------- Embeds and links ---------------------------- */

export function citationEmbed(title: string): string {
	return `![[${title}]]`;
}

export function citationLink(title: string): string {
	return `[[${title}]]`;
}

/** Lets a drag carry an annotation's citation, which a note it's dropped into takes as text. */
export function dragCitation(e: DragEvent, title: string): void {
	if (!e.dataTransfer) return;
	e.dataTransfer.setData('text/plain', citationEmbed(title));
	e.dataTransfer.effectAllowed = 'copy';
}

/** Copies the embed and says so, offering the plain link instead. */
export async function copyCitation(title: string): Promise<void> {
	await navigator.clipboard.writeText(citationEmbed(title));
	toasts.push('Citation copied: paste into any note to embed the quote and annotation.', {
		variant: 'info',
		timeout: 6000,
		code: citationEmbed(title),
		action: { label: 'Copy as link instead', run: () => void copyLink(title) }
	});
}

export async function copyLink(title: string): Promise<void> {
	await navigator.clipboard.writeText(citationLink(title));
	toasts.push('Link copied', { variant: 'info' });
}

export interface Excerpt {
	pdfTitle: string;
	page: number;
	rect: PageRect | null;
	quote: string;
}

const EXCERPT = /^(.+)\.pdf#page=(\d+)(?:&rect=([\d.]+),([\d.]+),([\d.]+),([\d.]+))?$/i;
const EXCERPT_QUOTE_MAX = 300;

export function excerptEmbed(e: Excerpt): string {
	const at = e.rect
		? `&rect=${[e.rect[0], e.rect[1], e.rect[2], e.rect[3]].map((n) => Math.round(n * 10000) / 10000)}`
		: '';
	const quote = e.quote
		.replace(/[[\]|\s]+/g, ' ')
		.trim()
		.slice(0, EXCERPT_QUOTE_MAX);
	return `![[${e.pdfTitle}.pdf#page=${e.page}${at}${quote ? `|${quote}` : ''}]]`;
}

export function parseExcerpt(inner: string): Excerpt | null {
	const [target, ...alias] = inner.split('|');
	const m = EXCERPT.exec(target.trim());
	if (!m) return null;
	const rect = m[3] ? (m.slice(3, 7).map(Number) as unknown as PageRect) : null;
	return { pdfTitle: m[1], page: Number(m[2]), rect, quote: alias.join('|').trim() };
}

export async function copyExcerpt(e: Excerpt): Promise<void> {
	const embed = excerptEmbed(e);
	await navigator.clipboard.writeText(embed);
	toasts.push('Citation copied: paste into any note.', {
		variant: 'info',
		timeout: 6000,
		code: embed
	});
}

/* ------------------------ Opening at an annotation ------------------------ */

/** Tab state that asks a PDF viewer to land on one annotation once it opens. */
export const OPEN_AT_ANNOTATION = 'open_at_annotation';

export const OPEN_AT_PAGE = 'open_at_page';

export const OPEN_AT_PLACE = 'open_at_place';

export async function openAtPlace(
	editor: EditorState,
	pdf: string,
	place: { page: number; offset: number }
): Promise<void> {
	openPdf(editor, await Doc.load(pdf), { [OPEN_AT_PLACE]: place });
}

function openPdf(
	editor: EditorState,
	doc: Awaited<ReturnType<typeof Doc.load>>,
	state: Record<string, unknown>
): void {
	const holds = (t: { content: TabState['content'] } | undefined) =>
		t?.content.type === 'pdf' && t.content.handle.id === doc.id;
	const others = (editor.session?.editors ?? []).filter((e) => e !== editor);
	const shown = others.map((e) => e.focusedTab).find(holds);
	if (shown) return void Object.assign(shown.state, state);
	const beside = editor.tabs.some(holds) ? undefined : others.find((e) => e.tabs.some(holds));
	(beside ?? editor).openDoc(doc, state);
}

/** Opens the PDF, or its open tab, at one of its annotations. */
export async function openAtAnnotation(
	editor: EditorState,
	annotation: { pdf: string; id: string }
): Promise<void> {
	openPdf(editor, await Doc.load(annotation.pdf), { [OPEN_AT_ANNOTATION]: annotation.id });
}

/* --------------------- Notes that cite an annotation ---------------------- */

/** A note that cites an annotation, with the line the citation sits in. */
export interface Citing {
	id: string;
	title: string;
	relPath: string;
	line: string;
}

/**
 * The notes that link to or embed an annotation note. The search index narrows to notes holding
 * the title's words, then each body is checked for an actual `[[title` link.
 */
export async function citedIn(
	note: { id: string; title: string; relPath: string },
	link: string
): Promise<Citing[]> {
	const { title, id: annotationId } = note;
	const words = note.relPath ? title.match(/[\p{L}\p{N}]+/gu) : null;
	if (!words) return [];
	const targets = [...new Set([link, stripExt(note.relPath)])];
	const rows = await select<{ id: string; title: string; rel_path: string; body: string }>(
		`SELECT d.id, d.title, d.rel_path, f.body FROM documents_fts f
		 JOIN documents d ON d.id = f.doc_id
		 WHERE documents_fts MATCH ?1 AND d.deleted_at IS NULL AND d.id != ?2`,
		[`"${words.join(' ')}"`, annotationId]
	);
	const out: Citing[] = [];
	for (const row of rows) {
		const line = citingLine(row.body, targets);
		if (line !== null) out.push({ id: row.id, title: row.title, relPath: row.rel_path, line });
	}
	return out;
}

/**
 * The text around the first link to `title` in `body`, or null if there is none. A citation on a
 * line of its own reads with the line before it, which is what usually introduces it.
 */
function citingLine(body: string, targets: string[]): string | null {
	const lines = body.split('\n');
	const link = new RegExp(
		`!?\\[\\[(?:${targets.map(escapeRegExp).join('|')})(?:[|#][^\\]]*)?\\]\\]`,
		'i'
	);
	const at = lines.findIndex((l) => link.test(l));
	if (at < 0) return null;
	const own = plain(lines[at].replace(link, ''));
	if (own) return own;
	for (let i = at - 1; i >= 0; i--) {
		const before = plain(lines[i]);
		if (before) return before;
	}
	return '';
}

function plain(line: string): string {
	return line
		.replace(/^\s*(?:[-*+]|\d+\.|>|#+)\s*/, '')
		.replace(/!?\[\[([^\]|#]*)(?:[|#][^\]]*)?\]\]/g, '$1')
		.replace(/[*_`]/g, '')
		.trim();
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
