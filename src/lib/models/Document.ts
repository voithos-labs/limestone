// @ts-ignore > Document is reserved??

// External
import {v4 as uuidv4} from 'uuid';

// Internal
import {select, execute} from '$lib/db';
import {getActiveVault} from './Vault';
import Group, {type GroupRow} from './Group';

// ── Interfaces ───────────────────────────────────────────────────────────────────────

/**
 * create table if not exists documents (
 *     id text primary key not null,
 *     vault_id text not null references vaults(id) on delete cascade,
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
    vault_id: string;
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
    private _relPath: string; // path relative to vault root

    title: string;
    groups: Group[];
    properties: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    accessedAt: Date;
    deletedAt?: Date;


    constructor(row: DocumentRow) {
        this.id = row.id;
        this._relPath = row.rel_path;
        this.title = row.title;
        this.groups = [];
        this.properties = typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties;
        this.createdAt = new Date(row.created_at);
        this.updatedAt = new Date(row.updated_at);
        this.accessedAt = new Date(row.accessed_at);
        this.deletedAt = row.deleted_at ? new Date(row.deleted_at) : undefined;
    }

    static async create(
        title: string,
        relPath: string,
        groupIds: string[] = [],
        properties: Record<string, unknown> = {},
    ): Promise<Document> {
        const id = uuidv4();
        const vault = await getActiveVault();

        // insert new doc stub
        await execute(
            `INSERT INTO documents (id, vault_id, rel_path, title, properties)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
            [id, vault.id, relPath, title, JSON.stringify(properties)],
        );
        // reselect for db defaults
        const [row] = await select<DocumentRow>(
            `SELECT *
             FROM documents
             WHERE id = ?1`,
            [id],
        );

        const doc = new Document(row);
        if (groupIds.length > 0) {
            await doc.addGroups(groupIds);
        }
        return doc;
    }

    static async fromID(id: string): Promise<Document> {
        const [row] = await select<DocumentRow>(
            `SELECT *
             FROM documents
             WHERE id = ?1`,
            [id],
        );
        if (!row) throw new Error(`Document not found: ${id}`);
        const doc = new Document(row);
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
            [this.id],
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
            params,
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
            [this.id, ...groupIds],
        );
        const removed = new Set(groupIds);
        this.groups = this.groups.filter((g) => !removed.has(g.id));
    }


    // ── Fs ───────────────────────────────────────────────────────────────────────────

    async moveToPath(newPath: string) {

    }

    async save(): Promise<void> {
        // todo
    }

    async reload() {
        // todo
    }

    // ── Util ─────────────────────────────────────────────────────────────────────────

    get relPath() {
        return this._relPath;
    }

}

export default Document;