export interface SearchResult {
	id: string;
	title: string;
	rel_path: string | null;
	source_id: string | null;
	score: number;
	match_indices: number[];
	kind: 'document' | 'group' | 'source' | 'view';
	group_type: string | null;
	snippet?: string | null;
	emoji?: string;
}
