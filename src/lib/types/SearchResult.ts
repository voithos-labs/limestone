export interface SearchResult {
	id: string;
	title: string;
	rel_path: string | null;
	score: number;
	match_indices: number[];
}
