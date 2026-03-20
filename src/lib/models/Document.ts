// @ts-ignore > Document is reserved??

// External
import { v4 as uuidv4 } from 'uuid';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import yaml from 'js-yaml';

// Internal
import { select, execute } from '$lib/db';
import type { Source } from './Source';
import Group, { type GroupRow } from './Group';
import { getSetting } from './Settings';

// ── Interfaces ───────────────────────────────────────────────────────────────────────

/**
 * create table if not exists documents (
 *     id text primary key not null,
 *     source_id text not null references sources(id) on delete cascade,
 *     document_type text not null default 'md',
 *     rel_path text not null,
 *     title text not null,
 *     created_at text not null default (datetime('now')),
 *     updated_at text not null default (datetime('now')),
 *     accessed_at text not null default (datetime('now')),
 *     mtime integer,
 *     deleted_at text,
 *     properties text not null default '{}'
 * ) strict;
 */
export interface DocumentRow {
	id: string;
	source_id: string;
	document_type: string;
	rel_path: string;
	title: string;
	created_at: string;
	updated_at: string;
	accessed_at: string;
	mtime: number | null;
	deleted_at: string | null;
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
 * Document
 *
 * todo
 * As is, since for most of development we will simply be using this to represent markdown documents, the features for
 * such will remain here. Later, when we distinguish the different kinds of documents, I will likely separate out some
 * of the functionality to MarkdownDocument or FileDocument.
 *
 */
class Document {
	// db fields *not all, just what is needed
	readonly id: string; // primary id
	private _relPath: string; // path relative to source root
	readonly source: Source;

	title: string;
	groups: Group[];
	properties: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
	accessedAt: Date;
	deletedAt?: Date;

	constructor(row: DocumentRow, source: Source) {
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
	): Promise<Document> {
		const id = uuidv4();

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

		const doc = new Document(row, source);
		if (groupIds.length > 0) {
			await doc.addGroups(groupIds);
		}
		return doc;
	}

	static async fromID(id: string): Promise<Document> {
		const [row] = await select<DocumentRow & { source_path: string; source_title: string }>(
			`SELECT d.*, s.path as source_path, s.title as source_title
             FROM documents d
             JOIN sources s ON s.id = d.source_id
             WHERE d.id = ?1`,
			[id]
		);
		if (!row) throw new Error(`Document not found: ${id}`);
		const source: Source = {
			id: row.source_id,
			title: row.source_title,
			path: row.source_path,
			created_at: '',
			accessed_at: ''
		};
		const doc = new Document(row, source);
		await doc.fetchGroups();
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

	async addGroups(groupIds: string[]): Promise<void> {
		if (groupIds.length === 0) return;
		const placeholders = groupIds.map((_, i) => `(?${i * 2 + 1}, ?${i * 2 + 2})`).join(', ');
		const params = groupIds.flatMap((gid) => [this.id, gid]);
		await execute(
			`INSERT
            OR IGNORE INTO document_groups (document_id, group_id) VALUES
            ${placeholders}`,
			params
		);
		await this.fetchGroups();
	}

	async removeGroups(groupIds: string[]): Promise<void> {
		if (groupIds.length === 0) return;
		const placeholders = groupIds.map((_, i) => `?${i + 2}`).join(', ');
		await execute(
			`DELETE
             FROM document_groups
             WHERE document_id = ?1
               AND group_id IN (${placeholders})`,
			[this.id, ...groupIds]
		);
		const removed = new Set(groupIds);
		this.groups = this.groups.filter((g) => !removed.has(g.id));
	}

	// ── Serialization ────────────────────────────────────────────────────────────────

	/**
	 * Build the frontmatter from doc state
	 */
	toFrontmatter(): DocumentFrontmatter {
		return {
			id: this.id,
			tags: this.groups.map((g) => g.slug),
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			...this.properties
		};
	}

	/**
	 * Serialize frontmatter + body into a full file string.
	 */
	async serialize(body: string): Promise<string> {
		const useFrontmatter = await getSetting<boolean>('documents.use_yaml_frontmatter');
		if (useFrontmatter === false) return body;

		const fm = this.toFrontmatter();
		const fmStr = yaml.dump(fm, { lineWidth: -1, sortKeys: false });
		return `---\n${fmStr}---\n${body}`;
	}

	/**
	 * Parse a raw file string into { frontmatter, body }
	 * todo: probably want to extract tags from body for obsid compat
	 */
	static deserialize(raw: string): { frontmatter: DocumentFrontmatter | null; body: string } {
		const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
		if (!match) return { frontmatter: null, body: raw };

		const parsed = (yaml.load(match[1]) as Record<string, any>) ?? {};
		const frontmatter: DocumentFrontmatter = {
			id: parsed.id ?? '',
			tags: Array.isArray(parsed.tags) ? parsed.tags : [],
			created_at: parsed.created_at ? new Date(parsed.created_at) : new Date(),
			updated_at: parsed.updated_at ? new Date(parsed.updated_at) : new Date(),
			...parsed
		};

		return { frontmatter, body: match[2] };
	}

	// ── Fs ───────────────────────────────────────────────────────────────────────────

	/**
	 * Read file from disk, parse frontmatter, return contents
	 */
	async loadContent(): Promise<string> {
		const raw = await readTextFile(`${this.source.path}/${this._relPath}`);
		const { frontmatter, body } = Document.deserialize(raw);

		if (frontmatter) {
			const { id, tags, created_at, updated_at, ...remaining } = frontmatter;
			if (id) (this as { id: string }).id = id;
			if (created_at) this.createdAt = new Date(created_at);
			if (updated_at) this.updatedAt = new Date(updated_at);
			this.properties = remaining;
			this.groups = await Group.fromSlugs(tags, this.source.id);
		}

		// update accessed_at
		await execute(
			`UPDATE documents
             SET accessed_at = datetime('now')
             WHERE id = ?1`,
			[this.id]
		);
		this.accessedAt = new Date();

		return body;
	}

	/**
	 * Serialize and use atomic write via the rust command
	 */
	async saveContent(body: string): Promise<void> {
		const contents = await this.serialize(body);
		await invoke('write_document', {
			sourcePath: this.source.path,
			relPath: this._relPath,
			contents
		});
	}

	async moveToPath(newRelPath: string): Promise<void> {
		await invoke('move_document', {
			sourcePath: this.source.path,
			relPath: this._relPath,
			newRelPath
		});
		this._relPath = newRelPath;
	}

	async rename(newName: string): Promise<void> {
		const newRel: string = await invoke('rename_document', {
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

export default Document;
