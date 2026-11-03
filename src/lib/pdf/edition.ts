import { copyFile, exists, mkdir, rename, stat } from '@tauri-apps/plugin-fs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getSource } from '#lib/models/Source.js';
import { fileLength } from './open.js';

/**
 * Editions: which bytes an annotation was made on, and a preserved copy of them, so replacing a
 * PDF never repaints old marks onto new pages and the old pages stay readable.
 */

// ── Public API ──────────────────────────────────────────────────────────────

/** Where a source keeps its preserved editions. The scanner skips dot-folders. */
export const EDITIONS_DIR = '.limestone/editions';

export function editionPath(edition: string): string {
	return `${EDITIONS_DIR}/${edition}.pdf`;
}

/** Whether a source keeps a copy of an edition's bytes. */
export function isPreserved(sourcePath: string, edition: string): Promise<boolean> {
	return exists(`${sourcePath}/${editionPath(edition)}`);
}

/**
 * A short id for the loaded file: the PDF's own identifiers plus its length. Hashing the bytes
 * would mean reading them all, which range loading avoids. A tool that rewrites a file but keeps
 * both identifiers and its exact length would go unnoticed.
 */
export async function editionOf(doc: PDFDocumentProxy): Promise<string> {
	const length = fileLength(doc) ?? (await doc.getDownloadInfo()).length;
	const text = `${doc.fingerprints.join('|')}|${length}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)]
		.slice(0, 8)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Copies the PDF into the source's editions folder unless that edition is already there. The copy
 * lands under a temporary name and is renamed into place, so an interrupted copy never passes for
 * a preserved edition.
 */
export async function preserveEdition(
	pdf: { sourcePath: string; relPath: string },
	edition: string
): Promise<void> {
	if (await isPreserved(pdf.sourcePath, edition)) return;
	const target = `${pdf.sourcePath}/${editionPath(edition)}`;
	await mkdir(`${pdf.sourcePath}/${EDITIONS_DIR}`, { recursive: true });
	const partial = `${target}.partial`;
	await copyFile(`${pdf.sourcePath}/${pdf.relPath}`, partial);
	await rename(partial, target);
}

/**
 * The day an edition dates from, as "Oct 2" (with the year when it isn't this one), taken from
 * its preserved copy's modified time. Null when that can't be read.
 */
export async function editionDate(sourceId: string, edition: string): Promise<string | null> {
	const key = `${sourceId}/${edition}`;
	const known = dates.get(key);
	if (known) return known;
	try {
		const source = await getSource(sourceId);
		const { mtime } = await stat(`${source.path}/${editionPath(edition)}`);
		if (!mtime) return null;
		const year = mtime.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
		const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year });
		const date = day.format(mtime);
		dates.set(key, date);
		return date;
	} catch {
		return null;
	}
}

// ── Internal ────────────────────────────────────────────────────────────────

// an edition's bytes never change, so neither does its date; a failed read is asked again
const dates = new Map<string, string>();
