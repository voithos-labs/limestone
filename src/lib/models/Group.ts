import {select, execute} from '$lib/db';
import {getActiveVault} from './Vault';
import {v4 as uuidv4} from 'uuid';

export enum GroupType {
    Tag = 'tag',
    Folder = 'folder',
}

/**
 * create table if not exists groups (
 *     id text primary key not null,
 *     vault_id text not null references vaults(id) on delete cascade,
 *     slug text not null,
 *     group_type text not null default 'tag',
 *     parent_group_id text references groups(id) on delete set null,
 *     created_at text not null default (datetime('now')),
 *     updated_at text not null default (datetime('now')),
 *     accessed_at text not null default (datetime('now'))
 * ) strict;
 */
export interface GroupRow {
    id: string;
    vault_id: string;
    slug: string;
    group_type: string;
    parent_group_id: string | null;
    created_at: string;
    updated_at: string;
    accessed_at: string;
}

class Group {
    readonly id: string;
    readonly slug: string;
    readonly groupType: GroupType;
    readonly createdAt: Date;
    updatedAt: Date;
    parentGroupId?: string;

    constructor(row: GroupRow) {
        this.id = row.id;
        this.slug = row.slug;
        this.groupType = row.group_type as GroupType;
        this.createdAt = new Date(row.created_at);
        this.updatedAt = new Date(row.updated_at);
        this.parentGroupId = row.parent_group_id ?? undefined;
    }

    static async create(
        slug: string,
        groupType: GroupType = GroupType.Tag,
        parentGroupId?: string,
    ): Promise<Group> {
        const id = uuidv4();
        const vault = await getActiveVault();

        await execute(
            `INSERT INTO groups (id, vault_id, slug, group_type, parent_group_id)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
            [id, vault.id, slug, groupType, parentGroupId ?? null],
        );

        const [row] = await select<GroupRow>(
            `SELECT *
             FROM groups
             WHERE id = ?1`,
            [id],
        );

        return new Group(row);
    }

    static async fromSlugs(slugs: string[], vaultId: string): Promise<Group[]> {
        if (slugs.length === 0) return [];
        const placeholders = slugs.map((_, i) => `?${i + 2}`).join(', ');
        const rows = await select<GroupRow>(
            `SELECT * FROM groups WHERE vault_id = ?1 AND slug IN (${placeholders})`,
            [vaultId, ...slugs],
        );
        return rows.map((r) => new Group(r));
    }

    static async fromID(id: string): Promise<Group> {
        const [row] = await select<GroupRow>(
            `SELECT *
             FROM groups
             WHERE id = ?1`,
            [id],
        );
        if (!row) throw new Error(`Group not found: ${id}`);
        return new Group(row);
    }

    async updateSlug(newSlug: string): Promise<void> {
        //todo: this has to actually find and replace all slugs in documents too
        await execute(
            `UPDATE groups
             SET slug = ?1,
                 updated_at = datetime('now')
             WHERE id = ?2`,
            [newSlug, this.id],
        );
        (this as { slug: string }).slug = newSlug;
        this.updatedAt = new Date();
    }
}

export default Group;
