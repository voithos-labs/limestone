/*

--- 2026-08-19 --- [finn]

~ compacted ~

Even easier though would be <app-data-dir>/external_sources/<source>/<source shit> I imagine.
Rel_path makes this easy enough on a fast disk, it's just a folder move when you want to actually
place it somewhere on the device.

--- 2026-09-18 --- [finn]

Discard everything above.

so from the above, I did end up separating out folders and tags, because the old age model
they were from had decohered.

otherwise, locallly, I'm not doing so-called 'virtual' notes. It's extra machinery for... what?
To avoid name conflicts? Fml, have your name conflicts and stuff it

so do we need this orphaned Doc model? Yes, there is an actual shape here. Wrapping certain files
etc. with document-shaped properties just makes sense, especially with how we want to display them
in the UI next to your markdown documents.

Example document types, inexhaustive:
- PDFs,
- hmm, well, mostly PDFs
- Maybe URLs to documents, e.g. a Google Doc, which can open in your browser ;; but that feels
kinda nasty
- oh oh audio files
- video files
- other file-shaped things you reasonably may want to open in limestone

--- 2026-10-04 --- [daniel]
can i discard your rambling - they are in git history anyways

--- 2026-10-07 --- [finn]
^ I compacted it

Oh, sweet Fancy! let her loose;
Every thing is spoilt by use:
Where's the cheek that doth not fade,
Too much gaz'd at? Where's the maid
Whose lip mature is ever new?
Where's the eye, however blue,
Doth not weary? Where's the face
One would meet in every place?
Where's the voice, however soft,
One would hear so very oft?

- Keats

--- ~ ---
 */

import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { select } from '$lib/services/db';
import { getSource, type Source } from '$lib/models/Source';
import Tag, { type TagRow } from '$lib/models/Tag';

/**
 * Yes I am using snakecase here, this is what they are in the db
 * Fuck you
 * No u
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

type DocumentPlace = { sourceId: string; relPath: string; title: string };

// shared document state
// protected (not public) such that outside code cannot call it
// its honestly just the convention of giving things the needed minimum scope
export default abstract class Doc {
	protected static readonly places = new SvelteMap<string, DocumentPlace>();

	readonly id: string; // primary id
	readonly documentType: string;
	// imma write the prefix _ as its the convention for private backing fields
	// private backing fields, btw, is a stupid ass name
	private _source: Source; // source instance, for data and ui
	tags: Tag[];
	properties: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
	accessedAt: Date;
	deletedAt?: Date; // todo[finn]: handle deleted cases, e.g. load from id, where you return a stub

	protected constructor(row: DocumentRow, source: Source) {
		this.id = row.id;
		this.documentType = row.document_type;
		this._source = source;
		this.updateLocation(source, row.rel_path, row.title);
		this.tags = [];
		this.properties =
			typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties;
		this.createdAt = new Date(row.created_at);
		this.updatedAt = new Date(row.updated_at);
		this.accessedAt = new Date(row.accessed_at);
		this.deletedAt = row.deleted_at ? new Date(row.deleted_at) : undefined;
	}

	// again, the idea of giving things min needed scope.
	// now source and relPath read only for outside code
	get source(): Source {
		return this._source;
	}

	get relPath(): string {
		return Doc.places.get(this.id)!.relPath;
	}

	get title(): string {
		return Doc.places.get(this.id)!.title;
	}

	protected get _relPath(): string {
		return untrack(() => Doc.places.get(this.id)!.relPath);
	}

	protected get _title(): string {
		return untrack(() => Doc.places.get(this.id)!.title);
	}

	// such that subclass can still write
	protected updateLocation(source: Source, relPath: string, title: string): void {
		this._source = source;
		Doc.places.set(this.id, { sourceId: source.id, relPath, title });
	}

	static async fromID<T extends Doc>(
		this: new (row: DocumentRow, source: Source) => T,
		id: string
	): Promise<T> {
		const [row] = await select<DocumentRow & { tags_json: string | null }>(
			`SELECT d.*,
                (SELECT json_group_array(json_object(
                    'id', t.id, 'slug', t.slug, 'created_at', t.created_at,
                    'updated_at', t.updated_at, 'accessed_at', t.accessed_at
                ))
                FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
                WHERE dt.document_id = d.id) as tags_json
             FROM documents d
             WHERE d.id = ?1`,
			[id]
		);
		if (!row) throw new Error(`Document not found: ${id}`);
		const doc = new this(row, await getSource(row.source_id));
		const tags: TagRow[] = row.tags_json ? JSON.parse(row.tags_json) : [];
		doc.tags = tags.filter((t) => t.id !== null).map((t) => new Tag(t));
		await doc.hydrate();
		return doc;
	}

	protected async hydrate(): Promise<void> {}
}
