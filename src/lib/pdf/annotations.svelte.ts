import { invoke } from '@tauri-apps/api/core';
import { select } from '#lib/services/db.js';
import MarkdownHandle from '#lib/models/MarkdownHandle.js';
import type PdfHandle from '#lib/models/PdfHandle.js';
import Folder from '#lib/models/Folder.js';
import { onSourceReconciled } from '#lib/models/Source.js';
import { preserveEdition } from './edition.js';
import {
	ANNOTATION_KEY,
	annotationBody,
	annotationComment,
	annotationLabel,
	annotationTitle,
	readAnnotation,
	storedFields,
	type Annotation,
	type AnnotationFields
} from './annotation.js';
import type { Placement } from './migrate.js';

/**
 * The annotation notes of one PDF: found through the index by the PDF's id wherever they sit,
 * read from their files, and written back as ordinary notes.
 */
export default class PdfAnnotations {
	items: Annotation[] = $state([]);
	/** Whether this PDF's folder stores metadata, which annotations need. */
	writable = $state(true);
	/** Whether the list has been read at least once, so an empty one means there are none. */
	loaded = $state(false);
	/** The edition on screen, which new annotations are made on and preserve. */
	edition: string | null = null;

	private loadGen = 0;

	constructor(private readonly pdf: () => PdfHandle) {}

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
		const [rows, meta] = await Promise.all([
			select<NoteRow>(
				`SELECT id, source_id, rel_path, title, created_at FROM documents
				 WHERE deleted_at IS NULL AND json_extract(properties, '$.${ANNOTATION_KEY}.pdf') = ?1`,
				[pdf.id]
			),
			Folder.metaAt(pdf.source.id, dirOf(pdf.relPath))
		]);
		const read = await Promise.all(rows.map((r) => readNote(r).catch(() => null)));
		if (gen !== this.loadGen) return;
		this.writable = meta.writes;
		this.items = read.filter((a): a is Annotation => a !== null).sort(byPlace);
		this.loaded = true;
	}

	/** Writes a new annotation note beside the PDF and returns it. */
	async create(fields: Omit<AnnotationFields, 'pdf'>, comment = ''): Promise<Annotation> {
		const pdf = this.pdf();
		// The PDF's first metadata write creates its sidecar, which is what keeps its id when it's
		// renamed or moved. Every note made here points at that id.
		await pdf.saveMeta({ createdAt: pdf.createdAt });
		const edition = await this.preserve();
		const annotation: AnnotationFields = {
			pdf: pdf.id,
			...fields,
			...(edition ? { edition } : {})
		};
		const doc = await MarkdownHandle.createFromTitle(pdf.source, {
			title: annotationTitle(pdf.title, fields.page, annotationLabel(fields.kind, fields.quote)),
			dir: siblingDir(pdf.relPath, pdf.title),
			properties: { [ANNOTATION_KEY]: storedFields(annotation) },
			body: annotationBody(fields.quote, comment)
		});
		const created: Annotation = {
			...annotation,
			id: doc.id,
			title: doc.title,
			relPath: doc.relPath,
			comment: comment.trim(),
			created: doc.createdAt.getTime()
		};
		this.items = [...this.items, created].sort(byPlace);
		return created;
	}

	async setComment(id: string, comment: string): Promise<void> {
		await this.update(id, (a) => ({ ...a, comment: comment.trim() }));
	}

	async setFields(id: string, fields: Partial<Omit<AnnotationFields, 'pdf'>>): Promise<void> {
		await this.update(id, (a) => ({ ...a, ...fields }));
	}

	/** Puts an annotation on the edition on screen; its note, comment and title stay as they are. */
	async place(id: string, placement: Placement): Promise<void> {
		const edition = await this.preserve();
		await this.setFields(id, { ...placement, ...(edition ? { edition } : {}) });
	}

	/** Moves the note to the trash, where the existing restore can bring it back. */
	async remove(id: string): Promise<void> {
		const doc = await MarkdownHandle.fromID(id);
		await doc.delete();
		this.items = this.items.filter((a) => a.id !== id);
	}

	/** Keeps the bytes on screen before any note points at them, and says which edition they are. */
	private async preserve(): Promise<string | null> {
		const pdf = this.pdf();
		const edition = this.edition;
		if (edition)
			await preserveEdition({ sourcePath: pdf.source.path, relPath: pdf.relPath }, edition);
		return edition;
	}

	private async update(id: string, change: (a: Annotation) => Annotation): Promise<void> {
		const current = this.items.find((a) => a.id === id);
		if (!current) return;
		const next = change(current);
		this.items = this.items.map((a) => (a.id === id ? next : a));
		// fields still carries any keys this version doesn't know, read from the note at load
		const {
			id: _id,
			title: _title,
			relPath: _relPath,
			comment,
			created: _created,
			...fields
		} = next;
		const doc = await MarkdownHandle.fromID(id);
		await doc.saveContent(annotationBody(fields.quote, comment), {
			properties: { [ANNOTATION_KEY]: storedFields(fields) }
		});
	}
}

// ── Internal ────────────────────────────────────────────────────────────────

interface NoteRow {
	id: string;
	source_id: string;
	rel_path: string;
	title: string;
	created_at: number;
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
		comment: annotationComment(body),
		created: row.created_at
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
