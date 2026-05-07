/*
 Limestone App Index Schema
 -> this db acts as a cached index, and can always be rebuilt losslessly from source material
 */

-- ── Config ───────────────────────────────────────────────────────────────────────────

pragma journal_mode = WAL;
pragma foreign_keys = on;
pragma busy_timeout = 5000; -- if you timeout, start worrying

-- ── Tables ───────────────────────────────────────────────────────────────────────────

create table if not exists sources (
    id text primary key not null,
    title text not null,
    path text not null,
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    accessed_at text not null default (datetime('now'))
) strict;

create table if not exists documents (
    id text primary key not null,
    source_id text not null references sources(id) on delete cascade,
    document_type text not null default 'md',
    rel_path text not null,
    title text not null,
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    accessed_at text not null default (datetime('now')),
    mtime integer,
    deleted_at text,
    properties text not null default '{}' check (json_valid(properties))
) strict;

create table if not exists groups (
    id text primary key not null,
    source_id text references sources(id) on delete cascade, -- nullable, only folder groups need this, tags are global
    slug text not null, -- title
    group_type text not null default 'tag' check (group_type in ('tag', 'folder')), -- tag, folder
    parent_group_id text references groups(id) on delete set null,
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    accessed_at text not null default (datetime('now')),
    -- okay to get the full prop flexibility potential (like notion) you need props with default values per-group
    -- can just define in a basic json, schema will have to be enforced in code on-parse. Will add when needed.
    check (
        (group_type = 'tag' and parent_group_id is null)
        or group_type = 'folder'
    )
) strict;

create table if not exists document_groups (
    document_id text not null references documents(id) on delete cascade,
    group_id text not null references groups(id) on delete cascade,
    primary key (document_id, group_id)
) strict;

-- ── Indexes ──────────────────────────────────────────────────────────────────────────

create index if not exists idx_documents_source on documents(source_id);
create unique index if not exists idx_documents_rel_path on documents(source_id, rel_path);
create index if not exists idx_documents_updated_at on documents(updated_at);
create index if not exists idx_groups_source on groups(source_id);
create index if not exists idx_groups_parent on groups(parent_group_id);
create index if not exists idx_document_groups_group on document_groups(group_id);

-- ── Restrictions ─────────────────────────────────────────────────────────────────────

-- tags are globally unique by slug + type
create unique index if not exists idx_groups_slug_global
    on groups(slug, group_type) where source_id is null;

-- folder slugs are unique within their parent
create unique index if not exists idx_groups_slug_parent
    on groups(slug, source_id, parent_group_id) where source_id is not null;

-- root-level folder slugs are unique within their source
create unique index if not exists idx_source_root
    on groups(slug, source_id) where parent_group_id is null and group_type = 'folder';

