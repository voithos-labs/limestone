<script lang="ts">
    import type EditorState from '$lib/models/EditorState.svelte.js';
    import type {SearchResult} from '$lib/types/SearchResult';
    import {listSources} from '$lib/models/Source';
    import DocHandle from '$lib/models/DocHandle';
    import View from '$lib/models/View.svelte';
    import {searchDocuments} from '$lib/services/search';
    import {readTextFile} from '@tauri-apps/plugin-fs';
    import {listen} from '@tauri-apps/api/event';
    import {formatDateFriendly} from '$lib/views/dateFormat';
    import type {MenuEntry} from '$lib/views/menuTypes';
    import ClockHero from '../ClockHero.svelte';
    import QuickSearch from '../QuickSearch.svelte';
    import SourceDialog from '../SourceDialog.svelte';
    import Menu from '../views/Menu.svelte';
    import {Cuboid, Plus, FolderPlus} from '@lucide/svelte';
    import CuboidPlus from '../CuboidPlus.svelte';
    import IconAddNotes from '~icons/material-symbols/add-notes';
    import {onMount} from 'svelte';

    let {editor}: { editor: EditorState } = $props();

    interface DocCard {
        id: string;
        title: string;
        relPath: string | null;
        preview: string;
        updatedAt: Date;
        tags: string[];
    }

    let savedViews: View[] = $state([]);
    let docs: DocCard[] = $state([]);

    // Recent views show a single row: render only as many cards as columns fit at
    // the current width. Same 240px/14px basis as the docs grid so both reflow together.
    const GRID_MIN = 220;
    const GRID_GAP = 12;
    let viewsWidth = $state(0);
    const viewCols = $derived(
        Math.max(1, Math.floor((viewsWidth + GRID_GAP) / (GRID_MIN + GRID_GAP)))
    );
    const visibleViews = $derived(savedViews.slice(0, viewCols));

    // Skeleton rows for the view "database" preview: each row is [col2, col3] bar widths.
    const ROWS = [
        [78, 54],
        [60, 40],
        [88, 36],
        [50, 62],
        [70, 46]
    ];

    function makePreview(body: string): string {
        return body
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/[*_`>]/g, '')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, 320);
    }

    async function loadDoc(r: SearchResult): Promise<DocCard> {
        try {
            const h = await DocHandle.fromID(r.id);
            // Read the file directly (don't loadContent — that bumps accessed_at).
            const raw = await readTextFile(`${h.source.path}/${h.relPath}`);
            const {body} = DocHandle.deserialize(raw);
            return {
                id: h.id,
                title: h.title,
                relPath: h.relPath,
                preview: makePreview(body),
                updatedAt: h.updatedAt,
                tags: h.tags.map((g) => g.slug)
            };
        } catch {
            return {
                id: r.id,
                title: r.title,
                relPath: r.rel_path,
                preview: '',
                updatedAt: new Date(0),
                tags: []
            };
        }
    }

    async function loadRecents() {
        const [recents, saved] = await Promise.all([
            searchDocuments(''),
            View.listSaved()
        ]);
        savedViews = saved.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
        docs = await Promise.all(recents.filter((r) => r.kind === 'document').map(loadDoc));
    }

    function openSavedView(v: View) {
        const existing = editor.tabs.find(
            (t) => t.content.type === 'view' && t.content.view.id === v.id
        );
        if (existing) {
            editor.focusTab({kind: 'tab', id: existing.id});
            return;
        }
        editor.openView(v);
    }

    // ── New menu (+ ▾) ─────────────────────────────────────────────────────────
    let newOpen = $state(false);
    let newBtnEl: HTMLButtonElement | null = $state(null);

    const newItems: MenuEntry[] = [
        {value: 'doc', label: 'New document', icon: IconAddNotes},
        {value: 'view', label: 'New view', icon: CuboidPlus},
        {value: 'source', label: 'New source', icon: FolderPlus}
    ];

    function handleNew(value: string) {
        newOpen = false;
        if (value === 'doc') newDocument();
        else if (value === 'view') editor.openView(View.create('New view'));
        else if (value === 'source') sourceDialogOpen = true;
    }

    let sourceDialogOpen = $state(false);

    async function newDocument() {
        const srcs = await listSources();
        const source = srcs[0];
        if (!source) {
            sourceDialogOpen = true;
            return;
        }
        const doc = await DocHandle.createFromTitle(source, {title: 'Untitled', draft: true});
        editor.openDoc(doc);
    }

    async function openDoc(d: DocCard) {
        const existing = editor.tabs.find((t) => t.id === d.id);
        if (existing) {
            editor.focusTab({kind: 'tab', id: existing.id});
            return;
        }
        const doc = await DocHandle.fromID(d.id);
        editor.openDoc(doc);
    }

    onMount(() => {
        loadRecents();
        const unlisten = listen('source-reconciled', () => loadRecents());
        return () => {
            unlisten.then((fn) => fn());
        };
    });
</script>

<div class="library">
    <div class="lib-inner">
        <div class="lib-hero">
            <ClockHero/>
        </div>
        <div class="search-row">
            <div class="search-cell">
                <QuickSearch {editor}/>
            </div>
            <button class="new-btn" bind:this={newBtnEl} title="New" onclick={() => (newOpen = !newOpen)}>
                <Plus size={19}/>
            </button>
        </div>
        <Menu
                bind:open={newOpen}
                anchor={newBtnEl}
                items={newItems}
                onSelect={handleNew}
                minWidth={180}
        />
        <SourceDialog bind:open={sourceDialogOpen} mode="create" onSaved={loadRecents}/>

        <section class="lib-section">
            <h2 class="sec-title">Recent Views</h2>
            <div class="views-grid" bind:clientWidth={viewsWidth}>
                {#each visibleViews as v (v.id)}
                    <button class="view-card" onclick={() => openSavedView(v)}>
                        <div class="vc-header">
                            {#if v.emoji}
                                <span class="vc-emoji">{v.emoji}</span>
                            {:else}
                                <Cuboid size={13}/>
                            {/if}
                            <span class="vc-title">{v.slug}</span>
                            <span class="vc-pill"></span>
                        </div>
                        <div class="vc-table">
                            {#each ROWS as r}
                                <div class="vc-row">
                                    <span class="vc-cell"><span class="vc-dot"></span></span>
                                    <span class="vc-cell"><span class="vc-bar" style:width="{r[0]}%"></span></span>
                                    <span class="vc-cell"><span class="vc-bar" style:width="{r[1]}%"></span></span>
                                </div>
                            {/each}
                        </div>
                    </button>
                {/each}
            </div>
            {#if savedViews.length === 0}
                <p class="lib-empty">No saved views yet</p>
            {/if}
        </section>

        <section class="lib-section">
            <h2 class="sec-title">Recent documents</h2>
            {#if docs.length}
                <div class="docs-grid">
                    {#each docs as d (d.id)}
                        <button class="doc-card" onclick={() => openDoc(d)}>
                            <div class="dc-title">{d.title}</div>
                            {#if d.preview}
                                <div class="dc-preview">{d.preview}</div>
                            {/if}
                            <div class="dc-footer">
                                <span class="dc-time">{formatDateFriendly(d.updatedAt)}</span>
                                {#if d.tags.length}
									<span class="dc-tags">
										{#each d.tags.slice(0, 3) as t}
											<span class="dc-tag">{t}</span>
										{/each}
									</span>
                                {/if}
                            </div>
                            {#if d.relPath}
                                <div class="dc-path">{d.relPath}</div>
                            {/if}
                        </button>
                    {/each}
                </div>
            {:else}
                <p class="lib-empty">No documents yet</p>
            {/if}
        </section>
    </div>
</div>

<style>
    .library {
        height: 100%;
        overflow-y: auto;
        scrollbar-width: none;
    }

    .library::-webkit-scrollbar {
        display: none;
    }

    .lib-inner {
        max-width: 900px;
        margin: 0 auto;
        padding: 36px 24px 64px;
    }

    .lib-hero {
        margin-bottom: 22px;
    }

    .search-row {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .search-cell {
        flex: 1;
        min-width: 0;
    }

    .new-btn {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 42px;
        padding: 0 12px;
        flex-shrink: 0;
        border: 1px solid var(--color-border);
        border-radius: 14px;
        background: var(--color-bg);
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .new-btn:hover {
        color: var(--color-text-primary);
        border-color: var(--color-ui-muted);
    }

    .lib-section {
        margin-top: 30px;
    }

    .sec-title {
        margin: 0 0 10px;
        font-family: var(--font-ui);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-ui-muted);
    }

    /* ── Views (basic database cards) ── */
    .views-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
    }

    .view-card {
        display: flex;
        flex-direction: column;
        padding: 0;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg);
        overflow: hidden;
        cursor: pointer;
        text-align: left;
        font-family: var(--font-ui);
        transition: border-color 120ms ease;
    }

    .view-card:hover {
        border-color: var(--color-ui-muted);
    }

    .vc-header {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 10px 12px;
        color: var(--color-text-primary);
    }

    .vc-header :global(svg) {
        flex-shrink: 0;
        color: var(--color-ui-muted);
    }

    .vc-emoji {
        font-size: 14px;
        line-height: 1;
        flex-shrink: 0;
    }

    .vc-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 600;
    }

    .vc-pill {
        width: 26px;
        height: 6px;
        border-radius: 999px;
        background: var(--color-accent);
        flex-shrink: 0;
    }

    .vc-table {
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--color-border);
    }

    .vc-row {
        display: grid;
        grid-template-columns: 26px 1fr 1fr;
        align-items: center;
        height: 18px;
        border-bottom: 1px solid var(--color-border);
    }

    .vc-row:last-child {
        border-bottom: none;
    }

    .vc-cell {
        display: flex;
        align-items: center;
        height: 100%;
        padding: 0 10px;
        border-right: 1px solid var(--color-border);
    }

    .vc-cell:last-child {
        border-right: none;
    }

    .vc-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--color-ui-muted);
        opacity: 0.55;
        flex-shrink: 0;
    }

    .vc-bar {
        height: 6px;
        border-radius: 999px;
        background: var(--color-ui-muted);
        opacity: 0.28;
    }

    /* ── Documents (Google Keep masonry) ── */
    .docs-grid {
        columns: 220px;
        column-gap: 12px;
    }

    .doc-card {
        display: inline-block;
        width: 100%;
        margin: 0 0 12px;
        padding: 12px 14px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg);
        cursor: pointer;
        text-align: left;
        font-family: var(--font-ui);
        break-inside: avoid;
        transition: border-color 120ms ease;
    }

    .doc-card:hover {
        border-color: var(--color-ui-muted);
    }

    .dc-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .dc-preview {
        margin-top: 6px;
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--color-text-secondary);
        white-space: pre-wrap;
        display: -webkit-box;
        -webkit-line-clamp: 9;
        line-clamp: 9;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .dc-footer {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
    }

    .dc-time {
        font-size: 11px;
        color: var(--color-ui-muted);
    }

    .dc-tags {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
    }

    .dc-tag {
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--chip-bg);
        font-size: 11px;
        color: var(--color-ui-dulled);
    }

    .dc-path {
        margin-top: 6px;
        font-size: 11px;
        color: var(--color-ui-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .lib-empty {
        color: var(--color-ui-muted);
        font-size: 13px;
    }
</style>
