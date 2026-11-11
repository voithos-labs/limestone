/**
 * citations: how a note points back at a passage in a pdf.
 *
 * A citation is just an ordinary embed of the annotation's note, like `![[X, p3 - words]]`, so
 * it's plain markdown that still makes sense outside Limestone. This file makes one (copy or
 * drag), follows one (opens the pdf at that annotation), and finds the notes that cite an
 * annotation.
 */

import { toasts } from '#lib/overlays.svelte.js';
import { select } from '#lib/services/db.js';
import Doc from '#lib/models/Doc.js';
import type EditorState from '#lib/models/EditorState.svelte.js';

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
	toasts.push('Citation copied: paste into any note to embed the quote and comment.', {
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

/* ------------------------ Opening at an annotation ------------------------ */

/** Tab state that asks a PDF viewer to land on one annotation once it opens. */
export const OPEN_AT_ANNOTATION = 'open_at_annotation';

/** Opens the PDF, or its open tab, at one of its annotations. */
export async function openAtAnnotation(
	editor: EditorState,
	annotation: { pdf: string; id: string }
): Promise<void> {
	editor.openDoc(await Doc.load(annotation.pdf), { [OPEN_AT_ANNOTATION]: annotation.id });
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
export async function citedIn(title: string, annotationId: string): Promise<Citing[]> {
	const words = title.match(/[\p{L}\p{N}]+/gu);
	if (!words) return [];
	const rows = await select<{ id: string; title: string; rel_path: string; body: string }>(
		`SELECT d.id, d.title, d.rel_path, f.body FROM documents_fts f
		 JOIN documents d ON d.id = f.doc_id
		 WHERE documents_fts MATCH ?1 AND d.deleted_at IS NULL AND d.id != ?2`,
		[`"${words.join(' ')}"`, annotationId]
	);
	const out: Citing[] = [];
	for (const row of rows) {
		const line = citingLine(row.body, title);
		if (line !== null) out.push({ id: row.id, title: row.title, relPath: row.rel_path, line });
	}
	return out;
}

/**
 * The text around the first link to `title` in `body`, or null if there is none. A citation on a
 * line of its own reads with the line before it, which is what usually introduces it.
 */
function citingLine(body: string, title: string): string | null {
	const lines = body.split('\n');
	const link = new RegExp(`!?\\[\\[${escapeRegExp(title)}(?:[|#][^\\]]*)?\\]\\]`, 'i');
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
