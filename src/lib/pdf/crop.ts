import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { select } from '#lib/services/db.js';
import { getSource } from '#lib/models/Source.js';
import { openPdf } from './open.js';
import type { PageRect } from './annotation.js';

/** Draws a box of a PDF page into a canvas, for anything that shows a region outside the viewer. */

// ── Public API ──────────────────────────────────────────────────────────────

export interface Crop {
	/** The PDF's document id. */
	pdf: string;
	page: number;
	rect: PageRect;
	/** CSS pixels wide; the height follows from the box's shape. */
	width: number;
	/** Narrows a tall box until it fits this many CSS pixels high. */
	maxHeight?: number;
	signal?: AbortSignal;
}

/**
 * Renders a box of a page into `canvas` and sizes the canvas to it. Only the box is painted, so a
 * small region costs no more than a large one.
 */
export async function renderCrop(canvas: HTMLCanvasElement, crop: Crop): Promise<void> {
	const { pdf, page, rect, maxHeight, signal } = crop;
	const doc = await loadPdf(pdf);
	signal?.throwIfAborted();
	const p = await doc.getPage(page);
	signal?.throwIfAborted();
	const [x, y, w, h] = rect;
	const base = p.getViewport({ scale: 1 });
	const aspect = (w * base.width) / (h * base.height);
	const width = maxHeight ? Math.min(crop.width, maxHeight * aspect) : crop.width;
	const viewport = p.getViewport({ scale: width / (w * base.width) });
	const height = width / aspect;
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.max(1, Math.round(width * dpr));
	canvas.height = Math.max(1, Math.round(height * dpr));
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	const task = p.render({
		canvas,
		viewport,
		transform: [dpr, 0, 0, dpr, -x * viewport.width * dpr, -y * viewport.height * dpr]
	});
	const cancel = () => task.cancel();
	signal?.addEventListener('abort', cancel, { once: true });
	try {
		await task.promise;
	} finally {
		signal?.removeEventListener('abort', cancel);
	}
}

/** The smallest box holding every rect, or null for none. */
export function unionRect(rects: PageRect[]): PageRect | null {
	if (!rects.length) return null;
	let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const [x, y, w, h] of rects) {
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x + w);
		y1 = Math.max(y1, y + h);
	}
	return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

// ── Internal ────────────────────────────────────────────────────────────────

// several cards for one PDF share its loaded document, and a few PDFs stay open between notes
const CACHE_SIZE = 4;
const loaded = new Map<string, Promise<PDFDocumentProxy>>();

function loadPdf(pdfId: string): Promise<PDFDocumentProxy> {
	const hit = loaded.get(pdfId);
	if (hit) {
		loaded.delete(pdfId);
		loaded.set(pdfId, hit);
		return hit;
	}
	const next = openById(pdfId);
	loaded.set(pdfId, next);
	next.catch(() => {
		if (loaded.get(pdfId) === next) loaded.delete(pdfId);
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
async function openById(pdfId: string): Promise<PDFDocumentProxy> {
	const [row] = await select<{ source_id: string; rel_path: string }>(
		`SELECT source_id, rel_path FROM documents WHERE id = ?1 AND document_type = 'pdf'`,
		[pdfId]
	);
	if (!row) throw new Error(`no pdf with id ${pdfId}`);
	const source = await getSource(row.source_id);
	const task = await openPdf({
		sourceId: source.id,
		sourcePath: source.path,
		relPath: row.rel_path
	});
	return task.promise;
}
