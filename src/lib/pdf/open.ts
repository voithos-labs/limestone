/**
 * opening pdfs with pdf.js.
 *
 * pdf.js itself is loaded the first time a pdf opens, and a file is read in pieces as pdf.js asks
 * for them, so a huge pdf shows its first pages without being read whole. `loadPdf` opens one by
 * its document id instead (or an earlier edition's copy), and keeps a few open for callers to
 * share.
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { select } from '#lib/services/db.js';
import { getSource } from '#lib/models/Source.js';
import { editionPath, isPreserved } from './edition.js';

/* ----------------------------- Loading pdf.js ----------------------------- */

export type PdfLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/** pdf.js itself, loaded on first use so an engine without it still runs the rest of the app. */
export async function pdfLib(): Promise<PdfLib> {
	const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
	lib.GlobalWorkerOptions.workerSrc = workerUrl;
	return lib;
}

/* ----------------------------- Opening a PDF ------------------------------ */

export interface PdfFile {
	sourceId: string;
	sourcePath: string;
	relPath: string;
}

// Enough that a small file arrives whole in its first read, and a large one shows page one.
// Measured, the chunk size barely changes how much a typical PDF reads (its page tree is
// clustered); it only trades bytes for requests on a file whose page dictionaries are scattered.
const FIRST_CHUNK = 1 << 20;
const CHUNK = 1 << 18;

/**
 * Starts loading a PDF. A file that can't be read rejects with the same `{ kind }` errors the
 * byte read gives, so callers keep telling a missing source from a locked file.
 */
export async function openPdf(file: PdfFile): Promise<PDFDocumentLoadingTask> {
	const lib = await pdfLib();
	const url = convertFileSrc(`${file.sourcePath}/${file.relPath}`);
	const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
	const length = Number(head?.headers.get('content-length'));
	if (!head?.ok || !Number.isFinite(length)) throw await readFailure(file);

	const initial = await fetchRange(url, 0, Math.min(length, FIRST_CHUNK));
	const stop = new AbortController();
	class Ranges extends lib.PDFDataRangeTransport {
		requestDataRange(begin: number, end: number) {
			fetchRange(url, begin, end, stop.signal)
				.then((chunk) => {
					if (!stop.signal.aborted) this.onDataRange(begin, chunk);
				})
				.catch((e) => {
					if (!stop.signal.aborted) console.error('pdf range read failed', e);
				});
		}
		// pdf.js calls this when the document is destroyed; reads still in flight have no reader
		abort() {
			stop.abort();
		}
	}
	const task = lib.getDocument({
		range: new Ranges(length, initial),
		rangeChunkSize: CHUNK,
		disableAutoFetch: true,
		disableStream: true
	});
	return task;
}

async function fetchRange(
	url: string,
	begin: number,
	end: number,
	signal?: AbortSignal
): Promise<Uint8Array> {
	const res = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal });
	if (!res.ok) throw new Error(`range ${begin}-${end} answered ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

/** The byte read's own error for a file the asset protocol couldn't serve, which says why. */
async function readFailure(file: PdfFile): Promise<unknown> {
	try {
		await invoke('read_document_bytes', { sourceId: file.sourceId, relPath: file.relPath });
		return { kind: 'other' };
	} catch (e) {
		return e;
	}
}

/* ------------------------- Opening by document id ------------------------- */

// several cards for one PDF share its loaded document, and a few PDFs stay open between notes
const CACHE_SIZE = 4;
const loaded = new Map<string, Promise<PDFDocumentProxy>>();

/**
 * A PDF opened by its document id, from the edition's preserved copy when there is one and its
 * current file otherwise. A few stay open, so callers share them and never destroy one.
 */
export function loadPdf(pdfId: string, edition?: string): Promise<PDFDocumentProxy> {
	const key = `${pdfId}@${edition ?? ''}`;
	const hit = loaded.get(key);
	if (hit) {
		loaded.delete(key);
		loaded.set(key, hit);
		return hit;
	}
	const next = openById(pdfId, edition);
	loaded.set(key, next);
	next.catch(() => {
		if (loaded.get(key) === next) loaded.delete(key);
	});
	while (loaded.size > CACHE_SIZE) {
		const [oldest, doc] = loaded.entries().next().value!;
		loaded.delete(oldest);
		doc.then((d) => d.loadingTask.destroy()).catch(() => {});
	}
	return next;
}

// Opens the file itself rather than through PdfHandle.open, which marks the PDF opened:
// a note showing a crop isn't the reader opening the PDF.
async function openById(pdfId: string, edition?: string): Promise<PDFDocumentProxy> {
	const [row] = await select<{ source_id: string; rel_path: string }>(
		`SELECT source_id, rel_path FROM documents WHERE id = ?1 AND document_type = 'pdf'`,
		[pdfId]
	);
	if (!row) throw new Error(`no pdf with id ${pdfId}`);
	const source = await getSource(row.source_id);
	// a box marked on bytes since replaced is drawn from those bytes, while they're kept
	const preserved = edition && (await isPreserved(source.path, edition));
	const task = await openPdf({
		sourceId: source.id,
		sourcePath: source.path,
		relPath: preserved ? editionPath(edition) : row.rel_path
	});
	return task.promise;
}
