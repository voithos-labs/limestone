import { invoke } from '@tauri-apps/api/core';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface FindMatch {
	page: number;
	at: number;
}

export interface StoredAs {
	id: string;
	sourceId: string;
	relPath: string;
}

interface Runs {
	text: string;
	starts: number[];
	ys: number[];
}

const texts = new WeakMap<PDFDocumentProxy, Map<number, string>>();

function textsOf(doc: PDFDocumentProxy): Map<number, string> {
	let pages = texts.get(doc);
	if (!pages) texts.set(doc, (pages = new Map()));
	return pages;
}

export default class PdfFind {
	query = $state('');
	matches: FindMatch[] = $state.raw([]);
	current = $state(-1);
	scanning = $state(false);

	#doc: () => PDFDocumentProxy | null;
	#run = 0;

	constructor(doc: () => PDFDocumentProxy | null) {
		this.#doc = doc;
	}

	reset() {
		void this.search('');
	}

	async prime(file: StoredAs) {
		const doc = this.#doc();
		if (!doc) return;
		const known = textsOf(doc);
		if (known.size === doc.numPages) return;
		const stored = await invoke<string[] | null>('read_pdf_text', { ...file }).catch(() => null);
		if (doc !== this.#doc()) return;
		if (stored?.length === doc.numPages) {
			stored.forEach((text, i) => known.set(i + 1, text.toLowerCase()));
			return;
		}
		const pages: string[] = [];
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await runs(doc, n).catch(() => null);
			if (!page || doc !== this.#doc()) return;
			known.set(n, page.text.toLowerCase());
			pages.push(page.text);
		}
		await invoke('save_pdf_text', { ...file, pages }).catch(() => {});
	}

	async search(query: string) {
		this.query = query;
		const run = ++this.#run;
		const needle = query.trim().toLowerCase();
		const doc = this.#doc();
		this.matches = [];
		this.current = -1;
		this.scanning = !!needle && !!doc;
		if (!needle || !doc) return;
		const found: FindMatch[] = [];
		for (let n = 1; n <= doc.numPages; n++) {
			const text = await this.#text(doc, n).catch(() => null);
			if (run !== this.#run) return;
			if (!text) continue;
			const before = found.length;
			for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
				found.push({ page: n, at });
			}
			if (found.length > before) this.matches = found.slice();
		}
		this.scanning = false;
	}

	step(dir: 1 | -1, fromPage: number): FindMatch | null {
		const n = this.matches.length;
		if (!n) return null;
		if (this.current < 0) {
			const at = this.matches.findIndex((m) => m.page >= fromPage);
			this.current = at < 0 ? 0 : at;
		} else this.current = (this.current + dir + n) % n;
		return this.matches[this.current];
	}

	async yOf(match: FindMatch): Promise<number> {
		const doc = this.#doc();
		const page = doc && (await runs(doc, match.page).catch(() => null));
		if (!page) return 0;
		let lo = 0;
		let hi = page.starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (page.starts[mid] <= match.at) lo = mid;
			else hi = mid - 1;
		}
		return Math.min(1, Math.max(0, page.ys[lo] ?? 0));
	}

	async #text(doc: PDFDocumentProxy, n: number): Promise<string> {
		const known = textsOf(doc);
		const cached = known.get(n);
		if (cached !== undefined) return cached;
		const text = (await runs(doc, n)).text.toLowerCase();
		known.set(n, text);
		return text;
	}
}

async function runs(doc: PDFDocumentProxy, n: number): Promise<Runs> {
	const page = await doc.getPage(n);
	const [, bottom, , top] = page.view;
	const height = top - bottom || 1;
	const content = await page.getTextContent();
	const out: Runs = { text: '', starts: [], ys: [] };
	for (const item of content.items) {
		if (!('str' in item)) continue;
		out.starts.push(out.text.length);
		out.ys.push(1 - (item.transform[5] + item.height - bottom) / height);
		out.text += item.str + (item.hasEOL ? ' ' : '');
	}
	return out;
}
