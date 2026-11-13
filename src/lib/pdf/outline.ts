import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface Chapter {
	title: string;
	page: number;
	children: Chapter[];
}

type Outline = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;

const DEPTH = 2;

export async function chaptersOf(doc: PDFDocumentProxy): Promise<Chapter[]> {
	let items = (await doc.getOutline().catch(() => null)) ?? [];
	while (items.length === 1 && items[0].items.length) items = items[0].items;
	return resolve(doc, items, DEPTH);
}

async function resolve(doc: PDFDocumentProxy, items: Outline, depth: number): Promise<Chapter[]> {
	const out: Chapter[] = [];
	for (const item of depth > 0 ? items : []) {
		try {
			const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
			const ref = dest?.[0];
			if (ref == null) continue;
			const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref);
			out.push({
				title: item.title.trim(),
				page: index + 1,
				children: await resolve(doc, item.items, depth - 1)
			});
		} catch {
			continue;
		}
	}
	return out;
}
