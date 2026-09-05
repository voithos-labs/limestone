/*

So hmm

There is of course a set of things all docs have, but it's not as
static as it seems and may cluster into types.

E.g. fs-element, virtual-element

Fs-element is something placed in the native folder system
virtual-element is something that exists in a native format,
perhaps stored as .json etc. etc. or automerge history but
does not live in a useful location on the fs, and is indexed
into the db.

Now, I don't really want to split up my cute simple sqlite db too
much.

Really, the fs/not-fs elements, as far as I can foresee, do not
actually need a class each, since there are only really a few
types of documents, it's just a way of thinking about
where to put said fs values, e.g. rel_path and mtime.

and where does the true internal source 'live'? Is it source_id null?
maybe a flag like "materialized" would fit the circumstances better?

Only other things that comes to mind right now is

table documents:
- id
- title
- document_type
- created_at
- updated_at
- accessed_at
- properties
- file_id [nullable] -> table 'files' id

table files:
- id
- source_id
- rel_path
- mtime
- deleted_at

-> considering 2-way, e.g. document_id

this is fine-ish, remotely, kind of -- it's perhaps slightly better
than just having several nullable fields in the main documents table

it also occurs to me that it makes the source scan kind of cute,
since it could theoretically just interact with this 'files' table
and that's a nice aesthetic point.

if a source is a doc do I just wire this through properties?
I think the answer comes down to: do I need to see sources in global
search and how much metadata do they need to display

Because I could just do

table sources:
- id
- document_id
- path

where document_id -> documents row with type 'source'?

And I suppose the same applies for groups (tags only?) e.g.:

table tags:
- id
- slug [unique]
- document_id

and folders,
table folders:
- id
- source_id
- document_id
- name/title/slug
- parent_folder_id [nullable]

so-called "small update"

The question that comes to mind reviewing this is:
where does document information live for all documents? E.g. a doc
for a group, it can't just live in the DB (DB is a cache), so we
need to store it somewhere.

per type and it's indexed? e.g. views.json, each view just has this
doc info and at index time they're sorted into the db nicely

but what about so-called virtual notes? Simplest solution that comes to mind is literally just
an internal source that is specially flagged in the frontend. No subfolders, just a flat list of
notes.

this does introduce name conflict issues and loses some benefits in sync simplicity, where you
would have many documents represented in a format closer to the db rather than .md files. E.g. when
you sync from another device, mapping source=>source is generally a pain in the cock, and so having
them store their source data just in metadata could have been nice for simplifying sync.

Even easier though would be <app-data-dir>/external_sources/<source>/<source shit> I imagine.
Rel_path makes this easy enough on a fast disk, it's just a folder move when you want to actually
place it somewhere on the device.


TODO
- [ ] include metadata in automerge history;; could live with it but not in it
- [ ] customize uninstall not to clear app data dir actual note data, or at least more clearly label
your shit -- or just add a flag for sources that push for flat storage (folders are not scanned)
 */

import type { Source } from '$lib/models/Source';
import type Tag from '$lib/models/Tag';

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

abstract class Doc {
	readonly id: string; // primary id
	private _relPath: string; // path relative to source root
	readonly source: Source; // source instance, for data and UI
	private hasFile = true;

	title: string;
	tags: Tag[];
	properties: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
	accessedAt: Date;
	deletedAt?: Date;

	private constructor(row: DocumentRow, source: Source) {
		this.id = row.id;
		this._relPath = row.rel_path;
		this.source = source;
		this.title = row.title;
		this.tags = [];
		this.properties =
			typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties;
		this.createdAt = new Date(row.created_at);
		this.updatedAt = new Date(row.updated_at);
		this.accessedAt = new Date(row.accessed_at);
		this.deletedAt = row.deleted_at ? new Date(row.deleted_at) : undefined;
	}
}
