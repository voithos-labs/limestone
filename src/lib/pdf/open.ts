import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/**
 * Opens a PDF in pdf.js reading only the byte ranges it asks for, so a large file shows its first
 * pages without being read whole. The asset protocol answers Range requests but doesn't advertise
 * them, which is why pdf.js gets a transport of its own rather than the URL.
 */

// ── Public API ──────────────────────────────────────────────────────────────

export type PdfLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

export interface PdfFile {
	sourceId: string;
	sourcePath: string;
	relPath: string;
}

/** pdf.js itself, loaded on first use so an engine without it still runs the rest of the app. */
export async function pdfLib(): Promise<PdfLib> {
	const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
	lib.GlobalWorkerOptions.workerSrc = workerUrl;
	return lib;
}

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
	lengths.set(task, length);
	return task;
}

/**
 * The byte length of a PDF opened here. pdf.js's own `getDownloadInfo` only answers once every
 * byte has been read, which range loading never does for most files.
 */
export function fileLength(doc: PDFDocumentProxy): number | undefined {
	return lengths.get(doc.loadingTask);
}

// ── Internal ────────────────────────────────────────────────────────────────

// Enough that a small file arrives whole in its first read, and a large one shows page one.
// Measured, the chunk size barely changes how much a typical PDF reads (its page tree is
// clustered); it only trades bytes for requests on a file whose page dictionaries are scattered.
const FIRST_CHUNK = 1 << 20;
const CHUNK = 1 << 18;

const lengths = new WeakMap<PDFDocumentLoadingTask, number>();

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
