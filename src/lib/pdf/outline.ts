import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface Chapter {
	title: string;
	page: number;
	children: Chapter[];
}

type Outline = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;

const DEPTH = 2;

export async function destOf(
	doc: PDFDocumentProxy,
	raw: string | unknown[] | null
): Promise<{ page: number; dest: unknown[] } | null> {
	const dest = typeof raw === 'string' ? await doc.getDestination(raw) : raw;
	const ref = dest?.[0];
	if (!dest || ref == null) return null;
	const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref as never);
	return { page: index + 1, dest };
}

export async function chaptersOf(doc: PDFDocumentProxy): Promise<Chapter[]> {
	let items = (await doc.getOutline().catch(() => null)) ?? [];
	while (items.length === 1 && items[0].items.length) items = items[0].items;
	return resolve(doc, items, DEPTH);
}

async function resolve(doc: PDFDocumentProxy, items: Outline, depth: number): Promise<Chapter[]> {
	const out: Chapter[] = [];
	for (const item of depth > 0 ? items : []) {
		try {
			const to = await destOf(doc, item.dest);
			if (!to) continue;
			out.push({
				title: item.title.trim(),
				page: to.page,
				children: await resolve(doc, item.items, depth - 1)
			});
		} catch {
			continue;
		}
	}
	return out;
}
