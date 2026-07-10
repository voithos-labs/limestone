import { invoke } from '@tauri-apps/api/core';
import type { SearchResult } from '$lib/types/SearchResult';

export function searchDocuments(query: string): Promise<SearchResult[]> {
	return invoke<SearchResult[]>('search_documents', { query });
}
