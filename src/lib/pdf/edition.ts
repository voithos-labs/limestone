import { copyFile, exists, mkdir, rename } from '@tauri-apps/plugin-fs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

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

/**
 * A short id for the loaded file: the PDF's own identifiers plus its length. Hashing the bytes
 * would mean reading them all, which range loading avoids. A tool that rewrites a file but keeps
 * both identifiers and its exact length would go unnoticed.
 */
export async function editionOf(doc: PDFDocumentProxy): Promise<string> {
	const { length } = await doc.getDownloadInfo();
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
	const target = `${pdf.sourcePath}/${editionPath(edition)}`;
	if (await exists(target)) return;
	await mkdir(`${pdf.sourcePath}/${EDITIONS_DIR}`, { recursive: true });
	const partial = `${target}.partial`;
	await copyFile(`${pdf.sourcePath}/${pdf.relPath}`, partial);
	await rename(partial, target);
}
