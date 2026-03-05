-- connection config
pragma journal_mode = WAL;
pragma foreign_keys = on;
pragma busy_timeout = 5000;

------------
-- Tables --
------------

create table if not exists vaults (
    id text primary key not null,
    title text not null,
    path text not null,
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    accessed_at text not null default (datetime('now')),
    ) strict;

create table if not exists documents (
    id text primary key not null,
    vault_id text not null references vaults(id) on delete cascade,
    rel_path text,
    title text not null,
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    accessed_at text not null default (datetime('now')),
    deleted_at text,
    properties text not null default '{}'
) strict;

create table if not exists groups (
    id text primary key not null,
    vault_id text not null references vaults(id) on delete cascade,
    slug text not null, -- title, unique per vault
    group_type text not null default 'tag', -- tag, folder
    parent_group_id text references groups(id) on delete set null,
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    accessed_at text not null default (datetime('now'))
) strict;

create table if not exists document_groups (
    document_id text not null references documents(id) on delete cascade,
    group_id text not null references groups(id) on delete cascade,
    primary key (document_id, group_id)
) strict;

-------------
-- indexes --
-------------

create index if not exists idx_documents_vault on documents(vault_id);
create index if not exists idx_documents_updated_at on documents(updated_at);
create index if not exists idx_groups_vault on groups(vault_id);
create index if not exists idx_groups_parent on groups(parent_group_id);
create index if not exists idx_document_groups_group on document_groups(group_id);
