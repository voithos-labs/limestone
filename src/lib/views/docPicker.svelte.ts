import type { SearchResult } from '$lib/types/SearchResult';

// The doc face draws one document, but the control that chooses it lives in the view
export class DocPicker {
	open = $state(false);
	anchor: HTMLElement | null = $state(null);
	results: SearchResult[] = $state([]);
	activeId: string | null = $state(null);
	create: ((title?: string) => void) | null = $state(null);
	onPick: ((id: string) => void) | null = $state(null);

	pick(id: string): void {
		this.activeId = id;
		this.open = false;
		this.onPick?.(id);
	}
}
