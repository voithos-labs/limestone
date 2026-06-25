<script lang="ts">
    import type EditorState from "$lib/state/EditorState.svelte";
    import {TabState} from "$lib/state/EditorState.svelte";
    import type {SearchResult} from "$lib/types/SearchResult";
    import {getSource, touchSource, sourceName} from "$lib/models/Source";
    import DocHandle from "$lib/models/DocHandle";
    import Group from "$lib/models/Group";
    import View from "$lib/models/View.svelte";
    import {invoke} from "@tauri-apps/api/core";
    import {Search, Folder, Folders, Hash, X, TextAlignStart} from "@lucide/svelte";
    import {onMount} from "svelte";

    let {
        editor,
        tab,
        placeholder = 'quick-action...',
        autofocus = true
    }: {
        editor: EditorState;
        tab?: TabState;
        placeholder?: string;
        autofocus?: boolean;
    } = $props();

    let query = $state(tab?.state.query ?? '');
    let results: SearchResult[] = $state([]);
    let inputEl: HTMLInputElement | undefined = $state();

    $effect(() => {
        if (tab) tab.state.query = query;
    });

    // Hosted in a real tab -> replace it in place; otherwise open a fresh tab.
    function openInTab(next: TabState) {
        if (tab) {
            editor.replaceTab(tab.id, next);
        } else {
            editor.openTab(next);
            editor.focusTab({kind: 'tab', id: next.id});
        }
    }

    async function doSearch() {
        if (!query.trim()) {
            results = [];
            return;
        }
        results = await invoke('search_documents', {query});
    }

    async function openResult(result: SearchResult) {
        if (result.kind === 'group') {
            const group = await Group.fromID(result.id);
            group.touch();
            const existing = editor.tabs.find(
                t => t.content.type === 'view' && t.content.view.slug === group.slug
            );
            if (existing) {
                editor.focusTab({kind: 'tab', id: existing.id});
                return;
            }
            openInTab(TabState.forView(View.createFromGroup(group)));
            return;
        }
        if (result.kind === 'source') {
            const source = await getSource(result.id);
            touchSource(source.id);
            const existing = editor.tabs.find(
                t => t.content.type === 'view' && t.content.view.slug === sourceName(source)
            );
            if (existing) {
                editor.focusTab({kind: 'tab', id: existing.id});
                return;
            }
            openInTab(TabState.forView(View.createFromSource(source)));
            return;
        }
        const existing = editor.tabs.find(d => d.id === result.id);
        if (existing) {
            editor.focusTab({kind: 'tab', id: existing.id});
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
        query = '';
        results = [];
        inputEl?.focus();
    }

    function highlightTitle(title: string, indices: number[]): string {
        if (!indices.length) return title;
        const chars = [...title];
        const set = new Set(indices);
        return chars.map((ch, i) => (set.has(i) ? `<mark>${ch}</mark>` : ch)).join('');
    }

    onMount(() => {
        if (autofocus) inputEl?.focus();
        if (query.trim()) doSearch();
    });
</script>

<div class="search" class:open={query.trim()}>
    <div class="quick-action">
        <Search size={18}/>
        <input
                bind:this={inputEl}
                class="quick-action-input"
                type="text"
                {placeholder}
                bind:value={query}
                oninput={doSearch}
                onkeydown={onKeydown}
        />
        {#if query}
            <button class="clear-btn" title="Clear" onclick={clearQuery}>
                <X size={16}/>
            </button>
        {/if}
    </div>

    {#if query.trim()}
        <div class="results-dropdown">
            {#each results as result}
                <button class="result" onclick={() => openResult(result)}>
                    <span class="result-line">
                        {#if result.kind === 'source'}
                            <Folders size={14}/>
                        {:else if result.kind === 'group'}
                            {#if result.group_type === 'folder'}
                                <Folder size={14}/>
                            {:else}
                                <Hash size={14}/>
                            {/if}
                        {:else}
                            <TextAlignStart size={14}/>
                        {/if}
                        <span class="result-title">{@html highlightTitle(result.title, result.match_indices)}</span>
                    </span>
                    {#if result.rel_path}
                        <span class="result-path">{result.rel_path}</span>
                    {/if}
                </button>
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

    .quick-action {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        height: 46px;
        padding: 0 18px;
        background: var(--color-bg-opaque, var(--color-bg));
        border: 1px solid var(--color-border);
        border-radius: 14px;
        color: var(--color-ui-muted);
        flex-shrink: 0;
        box-sizing: border-box;
        z-index: 2;
    }

    .search.open .quick-action {
        border-radius: 14px 14px 0 0;
        border-color: var(--color-border);
    }

    .quick-action-input {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 16px;
    }

    .quick-action-input::placeholder {
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
        background: var(--color-bg-opaque, var(--color-bg));
        border: 1px solid var(--color-border);
        border-top: none;
        border-radius: 0 0 14px 14px;
        scrollbar-width: none;
    }

    .results-dropdown::-webkit-scrollbar {
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

    .result-line {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--color-ui-muted);
    }

    .result-title {
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .result-path {
        font-size: 12px;
        color: var(--color-ui-muted);
        padding-left: 22px;
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
