/**
 * crops: one box cut out of a pdf page, drawn into a canvas.
 *
 * Whatever shows a region or ink outside the viewer (a citation card, the digest) draws it through
 * here.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageRect } from './annotation.js';
import { canvasScale } from './layout.js';
import { loadPdf } from './open.js';

export interface Crop {
	/** The PDF's document id. */
	pdf: string;
	/** The edition the box was marked on; its preserved copy is drawn when there is one. */
	edition?: string;
	page: number;
	rect: PageRect;
	/** CSS pixels wide; the height follows from the box's shape. */
	width: number;
	/** Narrows a tall box until it fits this many CSS pixels high. */
	maxHeight?: number;
	signal?: AbortSignal;
	/** The PDF already open on the box's edition, which saves opening a second copy of it. */
	doc?: PDFDocumentProxy | null;
}

/**
 * Renders a box of a page into `canvas` and sizes the canvas to it. Only the box is painted, so a
 * small region costs no more than a large one.
 */
export async function renderCrop(canvas: HTMLCanvasElement, crop: Crop): Promise<void> {
	const { pdf, edition, page, rect, maxHeight, signal } = crop;
	const doc = crop.doc ?? (await loadPdf(pdf, edition));
	signal?.throwIfAborted();
	const p = await doc.getPage(page);
	signal?.throwIfAborted();
	const [x, y, w, h] = rect;
	const base = p.getViewport({ scale: 1 });
	const aspect = (w * base.width) / (h * base.height);
	const width = maxHeight ? Math.min(crop.width, maxHeight * aspect) : crop.width;
	const viewport = p.getViewport({ scale: width / (w * base.width) });
	const height = width / aspect;
	const dpr = canvasScale(width, height, window.devicePixelRatio || 1);
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
