/**
 * todo: this is only for native documents (md), will need to be expanded and seperated for
 * handling other document types including virtual documents
 *
 *
 *
 */

// ── Imports ──────────────────────────────────────────────────────────────────────────

// External
import { v4 as uuidv4 } from 'uuid';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import yaml from 'js-yaml';

// Internal
import { select, execute } from '$lib/db';
import { getSource, type Source } from './Source';
import Group, { type GroupRow } from './Group';

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
class DocHandle {
	// db fields *not all, just what is needed
	readonly id: string; // primary id
	private _relPath: string; // path relative to source root
	readonly source: Source; // source instance, for data and UI

	title: string;
	groups: Group[];
	properties: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
	accessedAt: Date;
	deletedAt?: Date; // todo: handle deleted cases, e.g. load from id, where you return a stub

	private constructor(row: DocumentRow, source: Source) {
		this.id = row.id;
		this._relPath = row.rel_path;
		this.source = source;
		this.title = row.title;
		this.groups = [];
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
		if (!source.use_frontmatter) properties = {};

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
		if (groupIds.length > 0) {
			let groups = await Group.fromIDs(groupIds);
			if (!source.use_frontmatter) groups = groups.filter((g) => g.groupType !== 'tag');
			doc.groups = groups;
		}
		return doc;
	}

	static async fromID(id: string): Promise<DocHandle> {
		type Row = DocumentRow & {
			source_path: string;
			source_title: string;
			groups_json: string | null;
		};
		// get doc AND join source and group data
		const [row] = await select<Row>(
			`SELECT d.*, s.path as source_path, s.title as source_title,
                (SELECT json_group_array(json_object(
                    'id', g.id, 'source_id', g.source_id, 'slug', g.slug,
                    'group_type', g.group_type, 'parent_group_id', g.parent_group_id,
                    'created_at', g.created_at, 'updated_at', g.updated_at, 'accessed_at', g.accessed_at
                ))
                FROM document_groups dg JOIN groups g ON g.id = dg.group_id
                WHERE dg.document_id = d.id) as groups_json
             FROM documents d JOIN sources s ON s.id = d.source_id
             WHERE d.id = ?1`,
			[id]
		);
		if (!row) throw new Error(`Document not found: ${id}`);
		const doc = new DocHandle(row, {
			id: row.source_id,
			title: row.source_title,
			path: row.source_path,
			created_at: '',
			accessed_at: '',
			use_frontmatter: true
		});
		const groups: GroupRow[] = row.groups_json ? JSON.parse(row.groups_json) : [];
		doc.groups = groups.filter((r) => r.id !== null).map((r) => new Group(r));
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

	/** A non-colliding rel_path for `base` in `dir`, appending " 2", " 3", … as needed */
	static async uniqueRelPath(sourceId: string, dir: string, base: string): Promise<string> {
		let candidate = dir ? `${dir}/${base}.md` : `${base}.md`;
		let n = 2;
		while (await DocHandle.pathExists(sourceId, candidate)) {
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
		}
	): Promise<DocHandle> {
		const base = opts.title.replace(/[\\/]/g, '-');
		const relPath = await DocHandle.uniqueRelPath(source.id, opts.dir ?? '', base);
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
		await doc.saveContent(opts.body ?? '');
		return doc;
	}

	// ── Groups ───────────────────────────────────────────────────────────────────────

	async fetchGroups(): Promise<void> {
		const rows = await select<GroupRow>(
			`SELECT g.*
             FROM groups g
                      JOIN document_groups dg ON dg.group_id = g.id
             WHERE dg.document_id = ?1`,
			[this.id]
		);
		this.groups = rows.map((r) => new Group(r));
	}

	async setTags(slugs: string[]): Promise<void> {
		await invoke('set_document_tags', {
			id: this.id,
			sourceId: this.source.id,
			sourcePath: this.source.path,
			relPath: this._relPath,
			tags: slugs
		});
		await this.fetchGroups();
	}

	// UTIL GETTERS

	get tags(): Group[] {
		return this.groups.filter((g) => g.groupType == 'tag');
	}

	get folders(): Group[] {
		return this.groups.filter((g) => g.groupType == 'folder');
	}

	// ── Serialization ────────────────────────────────────────────────────────────────

	/**
	 * Build the frontmatter from doc state. Properties are stored nested
	 * (e.g. views.<slug>.<field>) as a YAML object.
	 */
	toFrontmatter(): DocumentFrontmatter {
		return {
			id: this.id,
			tags: this.groups.filter((g) => g.groupType === 'tag').map((g) => g.slug),
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			...this.properties
		};
	}

	/**
	 * Serialize frontmatter + body into a full file string.
	 */
	async serialize(body: string): Promise<string> {
		const source = await getSource(this.source.id);
		if (source.use_frontmatter === false) return body;

		const fm = this.toFrontmatter();
		const fmStr = yaml.dump(fm, { lineWidth: -1, sortKeys: false });
		return `---\n${fmStr}---\n${body}`;
	}

	/**
	 * Parse a raw file string into { frontmatter, body }
	 *
	 * todo: probably want to extract tags from body for obsid compat
	 */
	static deserialize(raw: string): { frontmatter: DocumentFrontmatter | null; body: string } {
		const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
		if (!match) return { frontmatter: null, body: raw };

		const parsed = (yaml.load(match[1]) as Record<string, any>) ?? {};
		const frontmatter: DocumentFrontmatter = {
			...parsed,
			id: parsed.id ?? '',
			tags: Array.isArray(parsed.tags) ? parsed.tags : [],
			created_at: parsed.created_at ? new Date(parsed.created_at) : new Date(),
			updated_at: parsed.updated_at ? new Date(parsed.updated_at) : new Date()
		};

		return { frontmatter, body: match[2] };
	}

	// ── Fs ───────────────────────────────────────────────────────────────────────────

	/**
	 * Read file from disk, parse frontmatter, return contents
	 */
	async loadContent(): Promise<string> {
		const raw = await readTextFile(`${this.source.path}/${this._relPath}`);
		const { frontmatter, body } = DocHandle.deserialize(raw);

		if (frontmatter) {
			const { id: _id, tags, created_at, updated_at, ...remaining } = frontmatter;
			if (created_at) this.createdAt = new Date(created_at);
			if (updated_at) this.updatedAt = new Date(updated_at);
			this.properties = remaining;
			this.groups = await Group.fromSlugs(tags, this.source.id);
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

		return body;
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
		const { frontmatter } = DocHandle.deserialize(raw);
		if (!frontmatter) return;
		const { id, tags, created_at, updated_at, ...remaining } = frontmatter;
		this.properties = remaining;
		if (created_at) this.createdAt = new Date(created_at);
		this.groups = await Group.fromSlugs(tags, this.source.id);
	}

	async saveContent(body: string): Promise<void> {
		await this.refreshMetaFromDisk();
		this.updatedAt = new Date();
		const contents = await this.serialize(body);
		await invoke('write_document', {
			sourceId: this.source.id,
			sourcePath: this.source.path,
			relPath: this._relPath,
			contents,
			updatedAt: this.updatedAt.getTime()
		});
	}

	/** Delete the document from disk and the index. */
	async delete(): Promise<void> {
		await invoke('delete_document', {
			id: this.id,
			sourcePath: this.source.path,
			relPath: this._relPath
		});
	}

	/**
	 * Move a document file
	 * TODO: has to trigger rescan of path => folder group update
	 *
	 * @param newRelPath Path, relative to source, to move the document to
	 */
	async moveToPath(newRelPath: string): Promise<void> {
		await invoke('move_document', {
			sourceId: this.source.id,
			sourcePath: this.source.path,
			relPath: this._relPath,
			newRelPath
		});
		this._relPath = newRelPath;
	}

	/**
	 * Move a document into a different source (and optionally a folder within it)
	 */
	async moveToSource(newSource: Source, newRelPath: string): Promise<void> {
		await invoke('move_document', {
			sourceId: this.source.id,
			sourcePath: this.source.path,
			relPath: this._relPath,
			newRelPath,
			newSourceId: newSource.id,
			newSourcePath: newSource.path
		});
		this._relPath = newRelPath;
		(this as { source: Source }).source = newSource;
	}

	/**
	 * will update this to allow mutation of other fields, for now need to easily update dates
	 */
	async saveMeta(meta: { createdAt?: Date; updatedAt?: Date }): Promise<void> {
		await invoke('save_document_meta', {
			id: this.id,
			sourceId: this.source.id,
			sourcePath: this.source.path,
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
	 * @param newName
	 */
	async rename(newName: string): Promise<void> {
		const newRel: string = await invoke('rename_document', {
			sourceId: this.source.id,
			sourcePath: this.source.path,
			relPath: this._relPath,
			newName
		});
		this._relPath = newRel;
		this.title = newName.replace(/\.[^.]+$/, '');
	}

	// ── Util ─────────────────────────────────────────────────────────────────────────

	get relPath() {
		return this._relPath;
	}
}

export default DocHandle;
