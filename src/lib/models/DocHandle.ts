/**
 * todo: this is only for native documents (md), will need to be expanded and seperated for
 * ^ okay the time has come
 *
 * I kind of need to create a parent Doc type, and let shit do whatever under that.
 * No matter what I do, it will need a registry for Doc => Svelte Component for a given page.
 * No good way around it, and there *is* already a registry-ish for view faces so I need to not
 * write some garbage if possible.
 *
 *
 * handling other document types including virtual documents
 *
 * for history handling, I can't simply do it on save because watcher + recc can send updates from
 * disk that do not trigger saves, so I need maybe an authoritative flag
 *
 *
 *
 *
 */

// ── Imports ──────────────────────────────────────────────────────────────────────────

// External
import { v4 as uuidv4 } from 'uuid';
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import * as yaml from 'js-yaml';

// Internal
import { select, execute } from '$lib/services/db';
import { addChangeHistory, removeHistory } from '$lib/services/history';
import { LinkRewriteFailure, rewriteLinksForMove } from '$lib/services/links.svelte';
import { isRetryable, toasts, mark } from '$lib/overlays.svelte';
import { sanitizeSegment } from '$lib/util/paths';
import { creationSource, defaultNoteDir, getSource, type Source } from './Source';
import Tag, { tagSlug, type TagRow } from './Tag';
import Folder from './Folder';

// ── Interfaces ───────────────────────────────────────────────────────────────────────

/**
 * Yes I am using snakecase here, this is what they are in the db
 * Fuck you
 */
export interface DocumentRow {
	id: string;
	source_id: string;
	document_type: string;
	rel_path: string;
	title: string;
	created_at: number;
	updated_at: number;
	accessed_at: number;
	mtime: number | null;
	deleted_at: number | null;
	properties: string;
}

const FENCE_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function yamlErrorText(e: unknown): string {
	const err = e as { reason?: string; message?: string; mark?: { line?: number } };
	const reason = err?.reason ?? err?.message ?? 'invalid YAML';
	const line = err?.mark?.line;
	return typeof line === 'number' ? `${reason} (line ${line + 2})` : reason;
}

function stemOf(relPath: string): string {
	return relPath.slice(relPath.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
}

function dirOf(relPath: string): string {
	return relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
}

function validDate(v: unknown): Date | undefined {
	if (v === null || v === undefined || v === '') return undefined;
	const d = new Date(v as string | number | Date);
	return isNaN(d.getTime()) ? undefined : d;
}

export interface DocumentFrontmatter {
	id: string;
	tags: string[];
	updated_at: Date;
	created_at: Date;

	[key: string]: any; // flattened .properties
}

/**
 * Document Handle
 *
 * Provides a stable interface for interacting with a doc on disk,
 * while maintaining data sync between the disk, db, and delta history.
 *
 */
export type ReadErrorKind =
	| 'source_missing'
	| 'source_permission'
	| 'not_found'
	| 'permission'
	| 'locked'
	| 'invalid_data'
	| 'other';

const READ_ERROR_KINDS: ReadErrorKind[] = [
	'source_missing',
	'source_permission',
	'not_found',
	'permission',
	'locked',
	'invalid_data'
];

export function readErrorKind(e: unknown): ReadErrorKind {
	const kind = (e as { kind?: string } | null)?.kind;
	return READ_ERROR_KINDS.find((k) => k === kind) ?? 'other';
}

type Place = { sourceId: string; relPath: string; title: string };

const places = new SvelteMap<string, Place>();

class DocHandle {
	// db fields *not all, just what is needed
	readonly id: string; // primary id
	readonly source: Source; // source instance, for data and UI
	private hasFile = true;
	private static unopened = new Set<string>();

	get title(): string {
		return places.get(this.id)!.title;
	}

	get relPath(): string {
		return places.get(this.id)!.relPath;
	}

	private get _relPath(): string {
		return untrack(() => places.get(this.id)!.relPath);
	}

	private place(relPath: string, title: string): void {
		places.set(this.id, { sourceId: this.source.id, relPath, title });
	}

	private get _title(): string {
		return untrack(() => places.get(this.id)!.title);
	}
	tags: Tag[];
	properties: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
	accessedAt: Date;
	deletedAt?: Date; // todo: handle deleted cases, e.g. load from id, where you return a stub
	frontmatterError: string | null = null;
	writesMeta = true;
	inRepo = false;
	private fence = '';

	private constructor(row: DocumentRow, source: Source) {
		this.id = row.id;
		this.source = source;
		this.place(row.rel_path, row.title);
		this.tags = [];
		this.properties =
			typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties;
		this.createdAt = new Date(row.created_at);
		this.updatedAt = new Date(row.updated_at);
		this.accessedAt = new Date(row.accessed_at);
		this.deletedAt = row.deleted_at ? new Date(row.deleted_at) : undefined;
	}

	static async create(
		source: Source,
		title: string,
		relPath: string,
		groupIds: string[] = [],
		properties: Record<string, unknown> = {}
	): Promise<DocHandle> {
		const id = uuidv4();
		const meta = await Folder.metaAt(source.id, dirOf(relPath));
		if (!meta.writes) properties = {};

		// insert new doc stub
		await execute(
			`INSERT INTO documents (id, source_id, rel_path, title, properties)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
			[id, source.id, relPath, title, JSON.stringify(properties)]
		);
		// reselect for db defaults
		const [row] = await select<DocumentRow>(
			`SELECT *
             FROM documents
             WHERE id = ?1`,
			[id]
		);

		const doc = new DocHandle(row, source);
		doc.hasFile = false;
		doc.applyMeta(meta);
		if (groupIds.length > 0 && meta.writes) {
			doc.tags = await Tag.fromIDs(groupIds);
		}
		return doc;
	}

	static async fromID(id: string): Promise<DocHandle> {
		type Row = DocumentRow & {
			source_path: string;
			source_title: string;
			tags_json: string | null;
		};
		// get doc AND join source and tag data
		const [row] = await select<Row>(
			`SELECT d.*, s.path as source_path, s.title as source_title,
                (SELECT json_group_array(json_object(
                    'id', t.id, 'slug', t.slug, 'created_at', t.created_at,
                    'updated_at', t.updated_at, 'accessed_at', t.accessed_at
                ))
                FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
                WHERE dt.document_id = d.id) as tags_json
             FROM documents d JOIN sources s ON s.id = d.source_id
             WHERE d.id = ?1`,
			[id]
		);
		if (!row) throw new Error(`Document not found: ${id}`);
		const source = await getSource(row.source_id);
		const doc = new DocHandle(row, source);
		const tags: TagRow[] = row.tags_json ? JSON.parse(row.tags_json) : [];
		doc.tags = tags.filter((r) => r.id !== null).map((r) => new Tag(r));
		doc.applyMeta(await Folder.metaAt(source.id, dirOf(row.rel_path)));
		return doc;
	}

	/** Is there a live (non-deleted) document at this path in the source? */
	static async pathExists(sourceId: string, relPath: string): Promise<boolean> {
		const [row] = await select<{ c: number }>(
			`SELECT COUNT(*) as c
             FROM documents
             WHERE source_id = ?1
               AND rel_path = ?2
               AND deleted_at IS NULL`,
			[sourceId, relPath]
		);
		return (row?.c ?? 0) > 0;
	}

	static async pathTaken(source: Source, relPath: string): Promise<boolean> {
		if (await DocHandle.pathExists(source.id, relPath)) return true;
		return exists(`${source.path}/${relPath}`);
	}

	static async uniqueRelPath(source: Source, dir: string, base: string): Promise<string> {
		let candidate = dir ? `${dir}/${base}.md` : `${base}.md`;
		let n = 2;
		while (await DocHandle.pathTaken(source, candidate)) {
			candidate = dir ? `${dir}/${base} ${n}.md` : `${base} ${n}.md`;
			n++;
		}
		return candidate;
	}

	static async createFromTitle(
		source: Source,
		opts: {
			title: string;
			dir?: string;
			groupIds?: string[];
			properties?: Record<string, unknown>;
			body?: string;
			draft?: boolean;
		}
	): Promise<DocHandle> {
		const base = sanitizeSegment(opts.title) || 'Untitled';
		const dir = opts.dir || defaultNoteDir(source);
		const relPath = await DocHandle.uniqueRelPath(source, dir, base);
		// Title must match the de-duplicated filename (e.g. "Untitled 2"), not the
		// requested title, or two files end up sharing one title in the UI
		const title = relPath.split('/').pop()!.replace(/\.md$/i, '');
		const doc = await DocHandle.create(
			source,
			title,
			relPath,
			opts.groupIds ?? [],
			opts.properties ?? {}
		);
		if (base === 'Untitled') DocHandle.unopened.add(doc.id);
		if (opts.draft && !opts.body) {
			doc.hasFile = false;
		} else {
			await doc.saveContent(opts.body ?? '');
		}
		return doc;
	}

	static async createDraft(): Promise<DocHandle | null> {
		const source = await creationSource();
		if (!source) return null;
		return DocHandle.createFromTitle(source, { title: 'Untitled', draft: true });
	}

	// ── Groups ───────────────────────────────────────────────────────────────────────

	async fetchTags(): Promise<void> {
		await this.refreshMetaFromDisk();
	}

	async setTags(slugs: string[]): Promise<void> {
		await this.ensureFile();
		await invoke('set_document_tags', {
			id: this.id,
			sourceId: this.source.id,
			relPath: this._relPath,
			tags: [...new Set(slugs.map(tagSlug).filter(Boolean))]
		});
		await this.fetchTags();
	}

	// ── Serialization ────────────────────────────────────────────────────────────────

	/**
	 * Build the frontmatter from doc state. Properties are stored nested
	 * (e.g. views.<slug>.<field>) as a YAML object.
	 */
	toFrontmatter(): DocumentFrontmatter {
		return {
			id: this.id,
			tags: this.tags.map((t) => t.slug),
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			...this.properties
		};
	}

	/**
	 * Serialize frontmatter + body into a full file string.
	 */
	async serialize(body: string, rebuildFrontmatter = false): Promise<string> {
		await this.refreshMeta();
		if (!this.writesMeta) return this.fence + body;
		if (this.frontmatterError && !rebuildFrontmatter) return body;

		const fm = this.toFrontmatter();
		const fmStr = yaml.dump(fm, { lineWidth: -1, sortKeys: false });
		return `---\n${fmStr}---\n${body}`;
	}

	/**
	 * Parse a raw file string into { frontmatter, body }
	 *
	 * todo: probably want to extract tags from body for obsid compat
	 */
	static stripFence(raw: string): string {
		const match = raw.match(FENCE_RE);
		return match ? match[2] : raw;
	}

	static deserialize(raw: string): {
		frontmatter: DocumentFrontmatter | null;
		body: string;
		error: string | null;
	} {
		const match = raw.match(FENCE_RE);
		if (!match) return { frontmatter: null, body: raw, error: null };

		let parsed: Record<string, any>;
		try {
			const loaded = yaml.load(match[1]);
			parsed = loaded && typeof loaded === 'object' ? (loaded as Record<string, any>) : {};
		} catch (e) {
			return { frontmatter: null, body: raw, error: yamlErrorText(e) };
		}
		const frontmatter: DocumentFrontmatter = {
			...parsed,
			id: parsed.id ?? '',
			tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === 'string') : [],
			created_at: validDate(parsed.created_at) ?? new Date(),
			updated_at: validDate(parsed.updated_at) ?? new Date()
		};

		return { frontmatter, body: match[2], error: null };
	}

	// ── Fs ───────────────────────────────────────────────────────────────────────────

	/**
	 * Read file from disk, parse frontmatter, return contents
	 */
	async loadContent(): Promise<string> {
		// console.debug('=== PROPS ===');
		// console.debug(this.properties);

		let raw: string;
		try {
			raw = await invoke<string>('read_document', {
				sourceId: this.source.id,
				relPath: this._relPath
			});
		} catch (e) {
			if (!this.hasFile && readErrorKind(e) === 'not_found') return '';
			throw e;
		}
		this.hasFile = true;
		const { frontmatter, body, error } = DocHandle.deserialize(raw);
		this.frontmatterError = this.writesMeta ? error : null;
		this.fence = raw.slice(0, raw.length - body.length);

		if (frontmatter) {
			const { id: _id, tags, created_at, updated_at, ...remaining } = frontmatter;
			if (created_at) this.createdAt = new Date(created_at);
			if (updated_at) this.updatedAt = new Date(updated_at);
			this.properties = remaining;
			this.tags = await Tag.fromSlugs(tags);
		}

		// update accessed_at
		const now = Date.now();
		await execute(
			`UPDATE documents
             SET accessed_at = ?2
             WHERE id = ?1`,
			[this.id, now]
		);
		this.accessedAt = new Date(now);

		this.recordHistory(body);
		return body;
	}

	private recordHistory(body: string): void {
		addChangeHistory(this.id, body).catch((e) => console.error('history record failed', e));
	}

	/**
	 * Save document content to disk,,, and some more.
	 * todo
	 * 1. Save to disk + update relevant metadata in db
	 * ON SUCCESS:
	 * 2. Update version history (via automerge updateText)
	 * ALL GOOD:
	 * 3. Trigger FTS reindexing, in the background, don't wait for it.
	 */
	private async refreshMetaFromDisk(): Promise<void> {
		let raw: string;
		try {
			raw = await readTextFile(`${this.source.path}/${this._relPath}`);
		} catch {
			return;
		}
		const { frontmatter, body, error } = DocHandle.deserialize(raw);
		this.frontmatterError = this.writesMeta ? error : null;
		this.fence = raw.slice(0, raw.length - body.length);
		if (!frontmatter) return;
		const { id, tags, created_at, updated_at, ...remaining } = frontmatter;
		this.properties = remaining;
		if (created_at) this.createdAt = new Date(created_at);
		this.tags = await Tag.fromSlugs(tags);
	}

	async saveContent(body: string, opts: { rebuildFrontmatter?: boolean } = {}): Promise<void> {
		await this.refreshMetaFromDisk(); // this is hmm possibly not needed
		this.updatedAt = new Date();
		const contents = await this.serialize(body, opts.rebuildFrontmatter);
		await invoke('write_document', {
			sourceId: this.source.id,
			relPath: this._relPath,
			contents,
			updatedAt: this.updatedAt.getTime(),
			create: !this.hasFile
		});
		this.hasFile = true;
		this.recordHistory(body);
	}

	private applyMeta(meta: { writes: boolean; repo: boolean }): void {
		this.writesMeta = meta.writes;
		this.inRepo = meta.repo;
	}

	async refreshMeta(): Promise<void> {
		this.applyMeta(await Folder.metaAt(this.source.id, dirOf(this._relPath)));
	}

	async restore(body: string, overwrite: boolean): Promise<void> {
		this.hasFile = overwrite;
		await this.saveContent(body, { rebuildFrontmatter: true });
	}

	adoptAsDraft(): void {
		this.hasFile = false;
	}

	private async ensureFile(): Promise<void> {
		if (!this.hasFile) await this.saveContent('');
	}

	/** Delete the document from disk and the index. */
	async delete(): Promise<void> {
		await invoke('delete_document', {
			id: this.id,
			sourceId: this.source.id,
			relPath: this._relPath
		});
		removeHistory(this.id).catch((e) => console.error('history remove failed', e));
	}

	static async trashAt(source: Source, relPath: string): Promise<string | null> {
		const [row] = await select<{ id: string }>(
			`SELECT id FROM documents WHERE source_id = ?1 AND rel_path = ?2`,
			[source.id, relPath]
		);
		await invoke('delete_document', { id: row?.id ?? null, sourceId: source.id, relPath });
		if (row) removeHistory(row.id).catch((e) => console.error('history remove failed', e));
		return row?.id ?? null;
	}

	/**
	 * Move a document file
	 * TODO: has to trigger rescan of path => folder group update
	 *
	 * @param newRelPath Path, relative to source, to move the document to
	 */
	static async syncSource(sourceId: string): Promise<void> {
		const ids = [...places].filter(([, p]) => p.sourceId === sourceId).map(([id]) => id);
		if (ids.length === 0) return;
		const rows = await select<{ id: string; rel_path: string; title: string }>(
			`SELECT id, rel_path, title FROM documents WHERE id IN (${ids.map(() => '?').join(', ')})`,
			ids
		);
		for (const row of rows) {
			const p = places.get(row.id);
			if (p && (p.relPath !== row.rel_path || p.title !== row.title)) {
				places.set(row.id, { ...p, relPath: row.rel_path, title: row.title });
			}
		}
	}

	async refreshPath(): Promise<boolean> {
		const [row] = await select<{ rel_path: string; title: string }>(
			`SELECT rel_path, title
             FROM documents
             WHERE id = ?1`,
			[this.id]
		);
		if (!row || (row.rel_path === this._relPath && row.title === this._title)) return false;
		this.place(row.rel_path, row.title);
		return true;
	}

	async moveToPath(newRelPath: string): Promise<void> {
		await this.ensureFile();
		const oldRelPath = this._relPath;
		await invoke('move_document', {
			sourceId: this.source.id,
			relPath: oldRelPath,
			newRelPath
		});
		this.place(newRelPath, stemOf(newRelPath));
		await this.refreshMeta();
		await this.updateLinks(oldRelPath);
	}

	private async updateLinks(oldRelPath: string): Promise<void> {
		try {
			await rewriteLinksForMove(this.source.id, this.id, oldRelPath, this._relPath);
		} catch (e) {
			console.error('link rewrite failed', e);
			let message = `Links to ${mark('note', this.title)} still use its old name`;
			if (e instanceof LinkRewriteFailure && e.failed > 0)
				message += ` in ${e.failed} ${e.failed === 1 ? 'note' : 'notes'}`;
			if (e instanceof LinkRewriteFailure && e.reason) message += `: ${e.reason}`;
			else message += '.';
			const retry = { label: 'Retry', run: () => void this.updateLinks(oldRelPath) };
			toasts.push(message, { action: isRetryable(e) ? retry : undefined });
		}
	}

	/**
	 * Move a document into a different source (and optionally a folder within it)
	 */
	async moveToSource(newSource: Source, newRelPath: string): Promise<void> {
		await this.ensureFile();
		await invoke('move_document', {
			sourceId: this.source.id,
			relPath: this._relPath,
			newRelPath,
			newSourceId: newSource.id
		});
		(this as { source: Source }).source = newSource;
		this.place(newRelPath, stemOf(newRelPath));
		await this.refreshMeta();
	}

	/**
	 * will update this to allow mutation of other fields, for now need to easily update dates
	 */
	async saveMeta(meta: { createdAt?: Date; updatedAt?: Date }): Promise<void> {
		await this.ensureFile();
		await invoke('save_document_meta', {
			id: this.id,
			sourceId: this.source.id,
			relPath: this._relPath,
			createdAt: meta.createdAt ? meta.createdAt.toISOString() : null,
			updatedAt: meta.updatedAt ? meta.updatedAt.toISOString() : null
		});
		if (meta.createdAt) this.createdAt = meta.createdAt;
		if (meta.updatedAt) this.updatedAt = meta.updatedAt;
	}

	/**
	 * Rename the document file, which is what the title is derived from
	 *
	 * @param title
	 */
	async rename(title: string): Promise<void> {
		await this.ensureFile();
		const oldRelPath = this._relPath;
		const ext = oldRelPath.match(/\.[^./]+$/)?.[0] ?? '.md';
		const newRel: string = await invoke('rename_document', {
			sourceId: this.source.id,
			relPath: oldRelPath,
			newName: title + ext
		});
		this.place(newRel, title);
		await this.updateLinks(oldRelPath);
	}

	// ── Util ─────────────────────────────────────────────────────────────────────────

	get isDraft(): boolean {
		return !this.hasFile;
	}

	get isNew(): boolean {
		return this.isDraft || DocHandle.unopened.has(this.id);
	}

	markOpened() {
		DocHandle.unopened.delete(this.id);
	}
}

export default DocHandle;
