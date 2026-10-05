/**
 * --- 2026-10-04 --- [daniel]
 * this loading logic is now extracted into its own file
 * because it applies to every document format.
 * doc.ts should focus on shared document state, not db,
 * thus not there
 */
import { select } from '$lib/services/db';
import type { DocumentRow } from './Doc';
import { getSource, type Source } from './Source';
import Tag, { type TagRow } from './Tag';

export interface DocumentRecord {
	row: DocumentRow;
	source: Source;
	tags: Tag[];
}

export async function loadDocumentRecord(id: string): Promise<DocumentRecord> {
	// get doc AND join source and tag data
	const [row] = await select<DocumentRow & { tags_json: string | null }>(
		`SELECT d.*,
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
	const tags: TagRow[] = row.tags_json ? JSON.parse(row.tags_json) : [];
	return {
		row,
		source,
		tags: tags.filter((tag) => tag.id !== null).map((tag) => new Tag(tag))
	};
}
