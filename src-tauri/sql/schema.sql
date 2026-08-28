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
    created_at integer not null default (unixepoch() * 1000),
    updated_at integer not null default (unixepoch() * 1000),
    accessed_at integer not null default (unixepoch() * 1000)
) strict;

create table if not exists documents (
    id text primary key not null,
    document_type text not null default 'md',
    title text not null,
    created_at integer not null default (unixepoch() * 1000),
    updated_at integer not null default (unixepoch() * 1000),
    accessed_at integer not null default (unixepoch() * 1000),
    properties text not null default '{}' check (json_valid(properties)),
    -- fs
    source_id text not null references sources(id) on delete cascade,
    rel_path text not null,
    folder_id text references folders(id) on delete set null,
    mtime integer,
    deleted_at integer
) strict;

create table if not exists tags (
    id text primary key not null,
    slug text not null unique,
    created_at integer not null default (unixepoch() * 1000),
    updated_at integer not null default (unixepoch() * 1000),
    accessed_at integer not null default (unixepoch() * 1000)
) strict;

create table if not exists folders (
    id text primary key not null, -- folder:<source_id>:<path>, path is identity
    source_id text not null references sources(id) on delete cascade,
    slug text not null, -- leaf name
    parent_id text references folders(id) on delete cascade,
    created_at integer not null default (unixepoch() * 1000),
    updated_at integer not null default (unixepoch() * 1000),
    accessed_at integer not null default (unixepoch() * 1000)
) strict;

create table if not exists document_tags (
    document_id text not null references documents(id) on delete cascade,
    tag_id text not null references tags(id) on delete cascade,
    primary key (document_id, tag_id)
) strict;


-- FTS --
create virtual table if not exists documents_fts using fts5(doc_id unindexed, body);

-- ── Indexes ──────────────────────────────────────────────────────────────────────────

create index if not exists idx_documents_source on documents(source_id);
create unique index if not exists idx_documents_rel_path on documents(source_id, rel_path);
create index if not exists idx_documents_updated_at on documents(updated_at);
create index if not exists idx_documents_folder on documents(folder_id);
create index if not exists idx_folders_source on folders(source_id);
create index if not exists idx_folders_parent on folders(parent_id);
create index if not exists idx_document_tags_tag on document_tags(tag_id);

-- ── Restrictions ─────────────────────────────────────────────────────────────────────

-- folder slugs are unique within their parent
create unique index if not exists idx_folders_slug_parent
    on folders(slug, source_id, parent_id) where parent_id is not null;

-- root-level folder slugs are unique within their source
create unique index if not exists idx_folders_slug_root
    on folders(slug, source_id) where parent_id is null;
