<script lang="ts">
    import type EditorState from "$lib/state/EditorState.svelte";
    import type {SearchResult} from "$lib/types/SearchResult";
    import type {Source} from "$lib/models/Source";
    import DocHandle from "$lib/models/DocHandle";
    import {invoke} from "@tauri-apps/api/core";
    import {listen} from "@tauri-apps/api/event";
    import {open} from "@tauri-apps/plugin-dialog";
    import {Search, FolderPlus, Folder} from "@lucide/svelte";
    import {onMount} from "svelte";

    let {editor}: { editor: EditorState } = $props();

    let query = $state('');
    let results: SearchResult[] = $state([]);
    let sources: Source[] = $state([]);
    let addError = $state('');

    async function doSearch() {
        results = await invoke('search_documents', {query});
    }

    async function loadSources() {
        sources = await invoke('get_sources');
    }

    async function addSource() {
        addError = '';
        const selected = await open({directory: true, multiple: false});
        if (!selected || typeof selected !== 'string') return;

        const title = selected.split(/[\\/]/).filter(Boolean).pop() || 'Untitled';
        try {
            await invoke('create_source', {path: selected, title});
            await loadSources();
        } catch (e) {
            addError = String(e);
        }
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
        loadSources();
        const unlisten = listen('source-reconciled', () => {
            doSearch();
            loadSources();
        });
        return () => { unlisten.then(fn => fn()); };
    });
</script>

<div class="search-page">
    <aside class="sources-panel">
        <div class="sources-header">
            <h3 class="sources-title">Sources</h3>
            <button class="add-btn" onclick={addSource} title="Add source">
                <FolderPlus size={14} />
            </button>
        </div>
        {#if addError}
            <p class="add-error">{addError}</p>
        {/if}
        <div class="sources-list">
            {#each sources as source}
                <div class="source-item" title={source.path}>
                    <Folder size={13} />
                    <span class="source-name">{source.title}</span>
                </div>
            {:else}
                <p class="sources-empty">No sources yet</p>
            {/each}
        </div>
    </aside>

    <div class="search-main">
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
</div>

<style>
    .search-page {
        display: flex;
        height: 100%;
    }

    /* ── Sources sidebar ── */
    .sources-panel {
        display: flex;
        flex-direction: column;
        width: 220px;
        padding: 48px 12px 24px;
        border-right: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: 8px;
    }

    .sources-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 8px;
    }

    .sources-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-ui-dulled);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .add-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        border-radius: var(--radius-ui);
        background: transparent;
        color: var(--color-ui-muted);
        cursor: pointer;
    }

    .add-btn:hover {
        background: rgba(255, 255, 255, 0.05);
        color: var(--color-text-primary);
    }

    .add-error {
        margin: 0 8px;
        padding: 6px 8px;
        font-size: 11px;
        color: var(--color-accent);
        background: rgba(255, 0, 0, 0.05);
        border-radius: var(--radius-ui);
    }

    .sources-list {
        display: flex;
        flex-direction: column;
        gap: 1px;
        overflow-y: auto;
        scrollbar-width: none;
    }

    .sources-list::-webkit-scrollbar {
        display: none;
    }

    .source-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: var(--radius-ui);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: default;
    }

    .source-item:hover {
        background: rgba(255, 255, 255, 0.04);
    }

    .source-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .sources-empty {
        padding: 6px 8px;
        font-size: 12px;
        color: var(--color-ui-muted);
    }

    /* ── Search main ── */
    .search-main {
        flex: 1;
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
