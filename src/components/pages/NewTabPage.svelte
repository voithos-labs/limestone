<script lang="ts">
    import type EditorState from "$lib/state/EditorState.svelte";
    import {TabState} from "$lib/state/EditorState.svelte";
    import type {SearchResult} from "$lib/types/SearchResult";
    import {type Source, getSource, touchSource} from "$lib/models/Source";
    import DocHandle from "$lib/models/DocHandle";
    import Group from "$lib/models/Group";
    import View from "$lib/models/View.svelte";
    import {invoke} from "@tauri-apps/api/core";
    import {getVersion} from "@tauri-apps/api/app";
    import {Search, Folder, Folders, Hash, LayersPlus, X, TextAlignStart} from "@lucide/svelte";
    import IconAddNotes from "~icons/material-symbols/add-notes";
    import {onMount} from "svelte";
    import '@fontsource/jetbrains-mono/400.css';
    import '@fontsource/jetbrains-mono/500.css';
    import '@fontsource/jetbrains-mono/800.css';

    let {tab, editor}: { tab?: TabState; editor: EditorState } = $props();

    let query = $state(tab?.state.query ?? '');
    let results: SearchResult[] = $state([]);
    let actionError = $state('');
    let inputEl: HTMLInputElement | undefined = $state();

    $effect(() => {
        if (tab) tab.state.query = query;
    });

    // When hosted in a real tab, the chosen doc/view replaces this new-tab in
    // place; in the empty-state (no tab) it opens a fresh tab instead
    function openInTab(next: TabState) {
        if (tab) {
            editor.replaceTab(tab.id, next);
        } else {
            editor.openTab(next);
            editor.focusTab({kind: 'tab', id: next.id});
        }
    }

    let now = $state(new Date());
    let version = $state('');

    const timeStr = $derived.by(() => {
        const h = now.getHours() % 12 || 12;
        const m = now.getMinutes().toString().padStart(2, '0');
        return `${h}:${m}`;
    });
    const dateStr = $derived(
        now.toLocaleDateString([], {weekday: 'long', month: 'long', day: 'numeric'})
    );
    const ampm = $derived(now.getHours() < 12 ? 'am' : 'pm');

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
                t => t.content.type === 'view' && t.content.view.slug === source.title
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

    async function createNewDocument() {
        actionError = '';
        const sources: Source[] = await invoke('get_sources');
        const source = sources[0];
        if (!source) {
            actionError = 'Add a source before creating a document';
            return;
        }
        const doc = await DocHandle.createFromTitle(source, {title: 'Untitled'});
        openInTab(TabState.forDoc(doc));
    }

    function createNewView() {
        actionError = '';
        openInTab(TabState.forView(View.create('New view')));
    }

    function highlightTitle(title: string, indices: number[]): string {
        if (!indices.length) return title;
        const chars = [...title];
        const set = new Set(indices);
        return chars.map((ch, i) => (set.has(i) ? `<mark>${ch}</mark>` : ch)).join('');
    }

    onMount(() => {
        inputEl?.focus();
        if (query.trim()) doSearch();
        getVersion().then(v => version = v);
        const id = setInterval(() => {
            now = new Date();
        }, 1000);
        return () => clearInterval(id);
    });
</script>

<div class="new-tab-page">
    <div class="stack">
        <div class="hero">
            <div class="time">{timeStr}<span class="ampm">{ampm}</span></div>
            <div class="meta">
                <div class="date">{dateStr}</div>
                <div class="brand">limestone v{version || '0.1.0'}</div>
            </div>
        </div>

        <div class="search" class:open={query.trim()}>
            <div class="quick-action">
                <Search size={18}/>
                <input
                        bind:this={inputEl}
                        class="quick-action-input"
                        type="text"
                        placeholder="quick-action..."
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

        <div class="actions">
            <button class="action" onclick={createNewDocument}>
                <IconAddNotes width={14} height={14}/>
                <span>New document</span>
            </button>
            <button class="action" onclick={createNewView}>
                <LayersPlus size={13}/>
                <span>New view</span>
            </button>
            {#if actionError}
                <p class="action-error">{actionError}</p>
            {/if}
        </div>
    </div>
</div>

<style>
    .new-tab-page {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 0 24px 14vh;
        overflow-y: auto;
        scrollbar-width: none;
    }

    .new-tab-page::-webkit-scrollbar {
        display: none;
    }

    .stack {
        width: 100%;
        max-width: 620px;
        padding-bottom: 24px;
    }

    /* ── Hero (clock + date + brand) ── */
    .hero {
        display: flex;
        align-items: stretch;
        justify-content: center;
        gap: 18px;
        margin-bottom: 30px;
    }

    .time {
        position: relative;
        font-family: 'JetBrains Mono', var(--font-editor), monospace;
        font-size: 72px;
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.01em;
        color: var(--color-text-primary);
        font-variant-numeric: tabular-nums;
    }

    .ampm {
        position: absolute;
        top: 100%;
        right: 2px;
        margin-top: -6px;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0;
        color: var(--color-ui-dulled);
        line-height: 1;
    }

    .meta {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        gap: 12px;
        padding-bottom: 2px;
    }

    .date {
        font-family: 'JetBrains Mono', var(--font-editor), monospace;
        font-size: 30px;
        font-weight: 500;
        line-height: 1;
        letter-spacing: -0.06em;
        color: var(--color-text-primary);
        white-space: nowrap;
    }

    .brand {
        font-family: 'JetBrains Mono', var(--font-editor), monospace;
        font-size: 17px;
        font-weight: 400;
        line-height: 1;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-ui-dulled);
        white-space: nowrap;
    }

    .search {
        position: relative;
        width: 100%;
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
        height: 52px;
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

    /* ── Default actions ── */
    .actions {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        width: 100%;
        max-width: 620px;
        margin-top: 14vh;
    }

    .action {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px 12px;
        border: none;
        border-radius: var(--radius-ui);
        background: transparent;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 14px;
        cursor: pointer;
    }

    .action:hover {
        color: var(--color-text-primary);
        text-decoration: underline;
    }

    .action-error {
        margin: 4px 0 0 12px;
        font-size: 12px;
        color: var(--color-accent);
    }

    /* ── Search results (placeholder) ── */
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
