/**
 * the annotation notes of one pdf, as the viewer sees them.
 *
 * It finds them through the document index (every note whose frontmatter names this pdf's id) and
 * reloads whenever the pdf's source folder is rescanned. Making, editing, deleting and undeleting a
 * note all go through here, and so does copying the pdf's edition before a note points at it.
 */

import { invoke } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';
import { select } from '#lib/services/db.js';
import { linkTargets } from '#lib/services/links.svelte.js';
import { citedIn } from './citation.js';
import MarkdownHandle from '#lib/models/MarkdownHandle.js';
import type PdfHandle from '#lib/models/PdfHandle.js';
import { onSourceReconciled, reconcileSource } from '#lib/models/Source.js';
import { preserveEdition } from './edition.js';
import {
	ANNOTATION_KEY,
	ANNOTATION_PATH,
	ANNOTATION_TAG,
	annotationBody,
	parseAnnotation,
	annotationComment,
	annotationLabel,
	annotationTitle,
	parseAnnotationTitle,
	readAnnotation,
	storedFields,
	type Annotation,
	type AnnotationFields
} from './annotation.js';
import type { Placement } from './migrate.js';

/* -------------------------------------------------------------------------- */
/*                            The notes of one PDF                            */
/* -------------------------------------------------------------------------- */

/**
 * The annotation notes of one PDF: found through the index by the PDF's id wherever they sit,
 * read from their files, and written back as ordinary notes.
 */
export default class PdfAnnotations {
	items: Annotation[] = $state([]);
	/** Whether this PDF's folder stores metadata, which annotations need. */
	/** Whether the list has been read at least once, so an empty one means there are none. */
	loaded = $state(false);
	/** The edition on screen, which new annotations are made on and preserve. */
	edition: string | null = null;

	private loadGen = 0;
	/** The notes `remove` deleted, as they were, for `restore` to bring back. */
	private removed = new Map<string, Removed>();
	private labels = new Map<string, string>();
	private links = new Map<string, string>();
	private saving: Promise<unknown> = Promise.resolve();

	linkOf(a: Annotation): string {
		return this.links.get(a.id) ?? a.title;
	}

	constructor(private readonly pdf: () => PdfHandle) {}

	/* -------------------------------- Loading --------------------------------- */

	/** Loads the list, then keeps it current as the PDF's source is reconciled. */
	watch(): () => void {
		void this.load();
		return onSourceReconciled((sourceId) => {
			if (sourceId === this.pdf().source.id) void this.load();
		});
	}

	async load(): Promise<void> {
		const gen = ++this.loadGen;
		const pdf = this.pdf();
		const rows = await select<NoteRow>(
			`SELECT id, source_id, rel_path, title FROM documents
			 WHERE deleted_at IS NULL AND json_extract(properties, '${ANNOTATION_PATH}.pdf') = ?1`,
			[pdf.id]
		);
		const [read, marks] = await Promise.all([
			Promise.all(rows.map((r) => readNote(r).catch(() => null))),
			invoke<unknown[]>('read_pdf_marks', { sourceId: pdf.source.id, id: pdf.id }).catch(() => [])
		]);
		const noted = read.filter((a): a is Annotation => a !== null);
		const links = await linkTargets(
			pdf.source.id,
			noted.map((a) => ({ id: a.id, rel_path: a.relPath }))
		).catch(() => new Map<string, string>());
		if (gen !== this.loadGen) return;
		const bare: Annotation[] = [];
		for (const raw of marks) {
			const mark = raw as { id?: unknown; label?: unknown; annotation?: unknown } | null;
			const fields = mark && parseAnnotation(mark.annotation);
			if (!fields || typeof mark.id !== 'string' || noted.some((a) => a.id === mark.id)) continue;
			if (typeof mark.label === 'string') this.labels.set(mark.id, mark.label);
			bare.push({ ...fields, id: mark.id, title: '', relPath: '', comment: '' });
		}
		this.links = links;
		this.items = [...noted, ...bare].sort(byPlace);
		this.loaded = true;
	}

	private saveMarks(): Promise<unknown> {
		const pdf = this.pdf();
		const marks = $state
			.snapshot(this.items)
			.filter((a) => !a.relPath)
			.map(({ id, title: _title, relPath: _relPath, comment: _comment, ...fields }) => ({
				id,
				label: this.labels.get(id),
				[ANNOTATION_KEY]: storedFields(fields)
			}));
		this.saving = this.saving
			.catch(() => {})
			.then(() =>
				invoke('save_pdf_marks', {
					id: pdf.id,
					sourceId: pdf.source.id,
					relPath: pdf.relPath,
					marks
				})
			);
		return this.saving;
	}

	private async write(
		id: string,
		fields: AnnotationFields,
		comment: string,
		label: string
	): Promise<Annotation> {
		const pdf = this.pdf();
		const doc = await MarkdownHandle.createFromTitle(pdf.source, {
			id,
			title: annotationTitle(fields.page, label),
			dir: siblingDir(pdf.relPath, pdf.title),
			groupIds: [ANNOTATION_TAG],
			properties: { views: { [ANNOTATION_KEY]: storedFields(fields) } },
			body: annotationBody(comment)
		});
		const targets = await linkTargets(pdf.source.id, [{ id, rel_path: doc.relPath }]).catch(
			() => null
		);
		this.links.set(id, targets?.get(id) ?? doc.title);
		return { ...fields, id, title: doc.title, relPath: doc.relPath, comment: comment.trim() };
	}

	async note(id: string): Promise<Annotation | null> {
		const a = this.items.find((x) => x.id === id);
		if (!a || a.relPath) return a ?? null;
		const { id: _id, title: _title, relPath: _relPath, comment, ...fields } = $state.snapshot(a);
		const label = this.labels.get(id) ?? annotationLabel(fields.kind, fields.quote);
		const noted = await this.write(id, fields, comment, label);
		this.items = this.items.map((x) => (x.id === id ? noted : x));
		await this.saveMarks();
		return noted;
	}

	private async unnote(a: Annotation): Promise<void> {
		const doc = await MarkdownHandle.fromID(a.id);
		if (await doc.delete()) await invoke('purge_document', { id: a.id });
		this.labels.set(
			a.id,
			parseAnnotationTitle(a.title)?.label ?? annotationLabel(a.kind, a.quote)
		);
		this.links.delete(a.id);
		this.items = this.items.map((x) => (x.id === a.id ? { ...x, title: '', relPath: '' } : x));
		await this.saveMarks();
	}

	/* -------------------------- Making and changing --------------------------- */

	/** Writes a new annotation note beside the PDF and returns it. */
	/** `namedBy` is the text its note's title opens with: the quote, or what a box covers. */
	async create(
		fields: Omit<AnnotationFields, 'pdf'>,
		comment = '',
		namedBy = fields.quote
	): Promise<Annotation> {
		const pdf = this.pdf();
		// The PDF's first metadata write creates its doc folder, which is what keeps its id when it's
		// renamed or moved. Every note made here points at that id.
		await pdf.saveMeta({ createdAt: pdf.createdAt });
		const edition = await this.preserve();
		const annotation: AnnotationFields = {
			pdf: pdf.id,
			...fields,
			...(edition ? { edition } : {})
		};
		const id = uuidv4();
		const label = annotationLabel(fields.kind, namedBy);
		this.labels.set(id, label);
		const created: Annotation = comment.trim()
			? await this.write(id, annotation, comment, label)
			: { ...annotation, id, title: '', relPath: '', comment: '' };
		this.items = [...this.items, created].sort(byPlace);
		if (!created.relPath) await this.saveMarks();
		return created;
	}

	async setComment(id: string, comment: string): Promise<void> {
		await this.update(id, (a) => ({ ...a, comment: comment.trim() }));
	}

	async setFields(id: string, fields: Partial<Omit<AnnotationFields, 'pdf'>>): Promise<void> {
		await this.update(id, (a) => ({ ...a, ...fields }));
	}

	private async update(id: string, change: (a: Annotation) => Annotation): Promise<void> {
		const current = this.items.find((a) => a.id === id);
		if (!current) return;
		const next = change(current);
		this.items = this.items.map((a) => (a.id === id ? next : a));
		if (!current.relPath) {
			if (next.comment) await this.note(id);
			else await this.saveMarks();
			return;
		}
		if (current.comment && !next.comment) {
			const cites = await citedIn(next, this.linkOf(next)).catch(() => null);
			if (cites?.length === 0) return this.unnote(next);
		}
		// fields still carries any keys this version doesn't know, read from the note at load
		const { id: _id, title: _title, relPath: _relPath, comment, ...fields } = next;
		const doc = await MarkdownHandle.fromID(id);
		await doc.saveContent(annotationBody(comment), {
			unit: { key: ANNOTATION_KEY, values: storedFields(fields) }
		});
	}

	/* -------------------------------- Editions -------------------------------- */

	/** Puts an annotation on the edition on screen, its note renamed if its page changed. */
	async place(id: string, placement: Placement): Promise<void> {
		const edition = await this.preserve();
		const before = this.items.find((a) => a.id === id);
		await this.setFields(id, { ...placement, ...(edition ? { edition } : {}) });
		if (before?.relPath && before.page !== placement.page) {
			await this.retitle(before, placement.page);
		}
	}

	/**
	 * Renames an annotation's note to name `page`, when its title still names the old one; a note
	 * renamed by hand keeps its name. The rename rewrites every link to the note.
	 */
	private async retitle(a: Annotation, page: number): Promise<void> {
		const named = parseAnnotationTitle(a.title);
		if (named?.page !== a.page) return;
		const doc = await MarkdownHandle.fromID(a.id);
		try {
			await doc.rename(annotationTitle(page, named.label, named.pdfTitle));
		} catch (e) {
			// a note already holding the new name keeps the old one; the placement still stands
			console.error('annotation rename failed', e);
			return;
		}
		this.items = this.items.map((x) =>
			x.id === a.id ? { ...x, title: doc.title, relPath: doc.relPath } : x
		);
	}

	/** Keeps the bytes on screen before any note points at them, and says which edition they are. */
	private async preserve(): Promise<string | null> {
		const pdf = this.pdf();
		const edition = this.edition;
		if (edition)
			await preserveEdition({ sourcePath: pdf.source.path, relPath: pdf.relPath }, edition);
		return edition;
	}

	/** Whether any of the PDF's annotation notes, trashed ones included, was made on `edition`. */
	async marksEdition(edition: string): Promise<boolean> {
		if (this.items.some((a) => !a.relPath && a.edition === edition)) return true;
		const rows = await select<{ id: string }>(
			`SELECT id FROM documents
			 WHERE json_extract(properties, '${ANNOTATION_PATH}.pdf') = ?1
			   AND json_extract(properties, '${ANNOTATION_PATH}.edition') = ?2 LIMIT 1`,
			[this.pdf().id, edition]
		);
		return rows.length > 0;
	}

	/* ------------------------- Deleting and restoring ------------------------- */

	/** Deletes the note, keeping what `restore` needs to bring it back. */
	async remove(id: string): Promise<void> {
		const annotation = this.items.find((a) => a.id === id);
		if (!annotation) return;
		if (!annotation.relPath) {
			this.removed.set(id, { annotation: $state.snapshot(annotation) });
			this.items = this.items.filter((a) => a.id !== id);
			await this.saveMarks();
			return;
		}
		const doc = await MarkdownHandle.fromID(id);
		const trashed = await doc.delete();
		this.removed.set(id, { doc, annotation, trashed });
		this.items = this.items.filter((a) => a.id !== id);
	}

	/**
	 * Brings back a note `remove` deleted, as it was then and under the same id. The trash keeps
	 * only notes with a history, so any other is written back and a rescan indexes it by its id.
	 */
	async restore(id: string): Promise<void> {
		const removed = this.removed.get(id);
		if (!removed) throw new Error(`No deleted annotation ${id} to restore`);
		const { doc, annotation, trashed } = removed;
		if (!doc) {
			this.removed.delete(id);
			this.items = [...this.items, annotation].sort(byPlace);
			await this.saveMarks();
			return;
		}
		await doc.restore(annotationBody(annotation.comment), false);
		if (!trashed) await reindexed(doc);
		this.removed.delete(id);
		await this.load();
	}
}

/* -------------------------------------------------------------------------- */
/*                     Reading, sorting and filing notes                      */
/* -------------------------------------------------------------------------- */

interface NoteRow {
	id: string;
	source_id: string;
	rel_path: string;
	title: string;
}

async function readNote(row: NoteRow): Promise<Annotation | null> {
	const raw = await invoke<string>('read_document', {
		sourceId: row.source_id,
		relPath: row.rel_path
	});
	const { frontmatter, body } = MarkdownHandle.deserialize(raw);
	const fields = frontmatter && readAnnotation(frontmatter);
	if (!fields) return null;
	return {
		...fields,
		id: row.id,
		title: row.title,
		relPath: row.rel_path,
		comment: annotationComment(body)
	};
}

function byPlace(a: Annotation, b: Annotation): number {
	return a.page - b.page || (a.rects[0]?.[1] ?? 0) - (b.rects[0]?.[1] ?? 0);
}

function dirOf(relPath: string): string {
	return relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
}

/** The folder new annotations go in: beside the PDF, named after it. */
function siblingDir(relPath: string, title: string): string {
	const dir = dirOf(relPath);
	return dir ? `${dir}/${title}` : title;
}

/* -------------------------------------------------------------------------- */
/*                        Bringing a deleted note back                        */
/* -------------------------------------------------------------------------- */

interface Removed {
	doc?: MarkdownHandle;
	annotation: Annotation;
	/** Whether the trash kept the note, which `doc` then revives. */
	trashed?: boolean;
}

// how long a rescan may take to index a written-back note again
const REINDEX_POLL_MS = 100;
const REINDEX_TRIES = 50;

/** Rescans the note's source and waits until its id is in the index again. */
async function reindexed(doc: MarkdownHandle): Promise<void> {
	await reconcileSource(doc.source.id);
	for (let i = 0; i < REINDEX_TRIES; i++) {
		const rows = await select<{ id: string }>(
			'SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL',
			[doc.id]
		);
		if (rows.length) return;
		await new Promise((resolve) => setTimeout(resolve, REINDEX_POLL_MS));
	}
	throw new Error(`The restored note ${doc.relPath} wasn't indexed again`);
}
