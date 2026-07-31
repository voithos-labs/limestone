<script lang="ts">
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import { TabState } from '$lib/models/EditorState.svelte.js';
	import type { SearchResult } from '$lib/types/SearchResult';
	import { getSource, touchSource, listSources, type Source } from '$lib/models/Source';
	import DocHandle from '$lib/models/DocHandle';
	import Group from '$lib/models/Group';
	import View, { listSavedViewJSON } from '$lib/models/View.svelte';
	import { searchDocuments } from '$lib/services/search';
	import SearchResultRow from './SearchResultRow.svelte';
	import { Search, X } from '@lucide/svelte';
	import { onMount, untrack } from 'svelte';

	let {
		editor,
		tab,
		placeholder = 'quick search...',
		autofocus = true
	}: {
		editor: EditorState;
		tab?: TabState;
		placeholder?: string;
		autofocus?: boolean;
	} = $props();

	let query = $state(untrack(() => tab?.state.query ?? ''));
	let results: SearchResult[] = $state([]);
	let resultsFor = $state('');
	let inputEl: HTMLInputElement | undefined = $state();
	let sources: Source[] = $state([]);

	// Documents and folder groups carry a source_id; show that source as a chip.
	// Views have none, and source results are themselves a source, so both skip it.
	function resultSource(result: SearchResult): Source | null {
		if (!result.source_id) return null;
		return sources.find((s) => s.id === result.source_id) ?? null;
	}

	$effect(() => {
		if (tab) tab.state.query = query;
	});

	function findViewTabByOrigin(originId: string): TabState | undefined {
		return editor.tabs.find(
			(t) => t.content.type === 'view' && t.content.view.state?.origin_id === originId
		);
	}

	// Hosted in a real tab -> replace it in place; otherwise open a fresh tab.
	function openInTab(next: TabState) {
		if (tab) {
			editor.replaceTab(tab.id, next);
		} else {
			editor.openTab(next);
			editor.focusTab({ kind: 'tab', id: next.id });
		}
	}

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	const SEARCH_DEBOUNCE_MS = 10;

	function scheduleSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(doSearch, SEARCH_DEBOUNCE_MS);
	}

	async function doSearch() {
		const q = query;
		if (!q.trim()) {
			results = [];
			resultsFor = q;
			return;
		}
		const ql = q.trim().toLowerCase();
		// Saved views live in views.json (frontend)
		const [docResults, savedViews] = await Promise.all([
			searchDocuments(q),
			listSavedViewJSON().catch(() => [])
		]);
		const viewResults: SearchResult[] = savedViews
			.filter((v) => v.slug.toLowerCase().includes(ql))
			.map((v) => ({
				id: v.id,
				title: v.slug,
				rel_path: null,
				source_id: null,
				score: 0,
				match_indices: [],
				kind: 'view' as const,
				group_type: null,
				emoji: v.emoji
			}));
		if (q !== query) return;
		results = [...viewResults, ...docResults].slice(0, 25);
		resultsFor = q;
	}

	async function openResult(result: SearchResult) {
		if (result.kind === 'view') {
			const existing = editor.tabs.find(
				(t) => t.content.type === 'view' && t.content.view.id === result.id
			);
			if (existing) {
				editor.focusTab({ kind: 'tab', id: existing.id });
				return;
			}
			const saved = (await View.listSaved()).find((v) => v.id === result.id);
			if (saved) openInTab(TabState.forView(saved));
			return;
		}
		if (result.kind === 'group') {
			const group = await Group.fromID(result.id);
			group.touch();
			const existing = findViewTabByOrigin(group.id);
			if (existing) {
				editor.focusTab({ kind: 'tab', id: existing.id });
				return;
			}
			openInTab(TabState.forView(View.createFromGroup(group)));
			return;
		}
		if (result.kind === 'source') {
			const source = await getSource(result.id);
			touchSource(source.id);
			const existing = findViewTabByOrigin(source.id);
			if (existing) {
				editor.focusTab({ kind: 'tab', id: existing.id });
				return;
			}
			openInTab(TabState.forView(View.createFromSource(source)));
			return;
		}
		const existing = editor.tabs.find((d) => d.id === result.id);
		if (existing) {
			editor.focusTab({ kind: 'tab', id: existing.id });
			return;
		}
		const doc = await DocHandle.fromID(result.id);
		openInTab(TabState.forDoc(doc));
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && results.length > 0) {
			e.preventDefault();
			openResult(results[0]);
		} else if (e.key === 'Escape' && query) {
			e.preventDefault();
			clearQuery();
		}
	}

	function clearQuery() {
		if (searchTimer) clearTimeout(searchTimer);
		query = '';
		results = [];
		resultsFor = '';
		inputEl?.focus();
	}

	onMount(() => {
		if (autofocus) inputEl?.focus();
		if (query.trim()) doSearch();
		listSources()
			.then((ss) => (sources = ss))
			.catch(() => {});
	});
</script>

<div class="search" class:open={query.trim()}>
	<div class="quick-search">
		<Search size={18} />
		<input
			bind:this={inputEl}
			class="quick-search-input"
			type="text"
			{placeholder}
			bind:value={query}
			oninput={scheduleSearch}
			onkeydown={onKeydown}
		/>
		{#if query}
			<button class="clear-btn" title="Clear" onclick={clearQuery}>
				<X size={16} />
			</button>
		{/if}
	</div>

	{#if query.trim() && (results.length > 0 || resultsFor === query)}
		<div class="results-dropdown">
			{#each results as result}
				<SearchResultRow
					{result}
					source={resultSource(result)}
					onSelect={() => openResult(result)}
				/>
			{:else}
				<p class="empty">No results</p>
			{/each}
		</div>
	{/if}
</div>

<style>
	.search {
		position: relative;
		width: 100%;
		z-index: 2;
	}

	.search.open {
		filter: drop-shadow(0 10px 22px rgba(0, 0, 0, 0.16));
	}

	.quick-search {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 36px;
		padding: 0 14px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-ui-muted);
		flex-shrink: 0;
		box-sizing: border-box;
		z-index: 2;
	}

	.search.open .quick-search {
		border-radius: 8px 8px 0 0;
		border-color: var(--color-border);
	}

	.quick-search-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 14px;
	}

	.quick-search-input::placeholder {
		color: var(--color-ui-muted);
	}

	.clear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.clear-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text-primary);
	}

	.results-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 1;
		display: flex;
		flex-direction: column;
		padding: 8px;
		max-height: 48vh;
		overflow-y: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-top: none;
		border-radius: 0 0 8px 8px;
		scrollbar-width: none;
	}

	.results-dropdown::-webkit-scrollbar {
		display: none;
	}

	.empty {
		padding: 10px 14px;
		color: var(--color-ui-muted);
		font-size: 14px;
	}
</style>
