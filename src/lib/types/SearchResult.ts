export interface SearchResult {
	id: string;
	title: string;
	rel_path: string | null;
	score: number;
	match_indices: number[];
	kind: 'document' | 'group' | 'source';
	group_type: string | null;
}
