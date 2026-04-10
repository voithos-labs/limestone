<script lang="ts">
    import type EditorState from "$lib/state/EditorState.svelte";
    import type {SearchResult} from "$lib/types/SearchResult";
    import DocHandle from "$lib/models/DocHandle";
    import {invoke} from "@tauri-apps/api/core";
    import {listen} from "@tauri-apps/api/event";
    import {Search} from "@lucide/svelte";
    import {onMount} from "svelte";

    let {editor}: { editor: EditorState } = $props();

    let query = $state('');
    let results: SearchResult[] = $state([]);

    async function doSearch() {
        results = await invoke('search_documents', {query});
    }

    async function openResult(result: SearchResult) {
        const existing = editor.tabs.find(d => d.id === result.id);
        if (existing) {
            editor.focusTab({kind: 'document', id: existing.id});
            return;
        }
        const doc = await DocHandle.fromID(result.id);
        editor.openDoc(doc);
        editor.focusTab({kind: 'document', id: doc.id});
    }

    function highlightTitle(title: string, indices: number[]): string {
        if (!indices.length) return title;
        const chars = [...title];
        const set = new Set(indices);
        return chars.map((ch, i) => (set.has(i) ? `<mark>${ch}</mark>` : ch)).join('');
    }

    onMount(() => {
        doSearch();
        const unlisten = listen('source-reconciled', () => doSearch());
        return () => { unlisten.then(fn => fn()); };
    });
</script>

<div class="search-page">
    <div class="search-bar">
        <Search size={16} />
        <input
            class="search-input"
            type="text"
            placeholder="Search documents..."
            bind:value={query}
            oninput={doSearch}
        />
    </div>

    <div class="results">
        {#each results as result}
            <button class="result" onclick={() => openResult(result)}>
                <span class="result-title">{@html highlightTitle(result.title, result.match_indices)}</span>
                {#if result.rel_path}
                    <span class="result-path">{result.rel_path}</span>
                {/if}
            </button>
        {:else}
            {#if query}
                <p class="empty">No results</p>
            {/if}
        {/each}
    </div>
</div>

<style>
    .search-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-width: 600px;
        margin: 0 auto;
        padding: 48px 24px 24px;
    }

    .search-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-surface);
        color: var(--color-ui-muted);
        flex-shrink: 0;
    }

    .search-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 15px;
    }

    .search-input::placeholder {
        color: var(--color-ui-muted);
    }

    .results {
        display: flex;
        flex-direction: column;
        margin-top: 12px;
        overflow-y: auto;
        scrollbar-width: none;
    }

    .results::-webkit-scrollbar {
        display: none;
    }

    .result {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        padding: 10px 14px;
        border: none;
        border-radius: var(--radius-ui);
        background: transparent;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 14px;
        cursor: pointer;
        text-align: left;
    }

    .result:hover {
        background: rgba(255, 255, 255, 0.04);
    }

    .result-title {
        font-weight: 500;
    }

    .result-path {
        font-size: 12px;
        color: var(--color-ui-muted);
    }

    .empty {
        padding: 10px 14px;
        color: var(--color-ui-muted);
        font-size: 14px;
    }

    :global(.result mark) {
        background: rgba(255, 255, 0, 0.2);
        color: var(--color-accent);
        padding: 0;
    }
</style>
