<script lang="ts">
    import {untrack} from "svelte";
    import {Search, Folder, FolderPlus, ChevronRight, ChevronDown, Check} from "@lucide/svelte";
    import Group, {GroupType} from "$lib/models/Group";

    let {
        open = $bindable(false),
        anchor,
        value,
        sourceId,
        onChange
    }: {
        open: boolean;
        anchor: HTMLElement | null;
        value: string | null;
        sourceId?: string;
        onChange: (id: string) => void;
    } = $props();

    let popEl: HTMLDivElement | null = $state(null);
    let searchEl: HTMLInputElement | null = $state(null);
    let pos: { top: number; left: number } = $state({top: 0, left: 0});

    let folders: Group[] = $state([]);
    let loadError = $state('');
    let loaded = false;
    let query = $state('');
    let expandedIds: Set<string> = $state(new Set());

    const scoped = $derived(
        sourceId ? folders.filter(f => f.sourceId === sourceId) : folders
    );

    const byId = $derived(new Map(scoped.map(f => [f.id, f])));

    const childrenByParent = $derived.by(() => {
        const map = new Map<string | null, Group[]>();
        for (const f of scoped) {
            const key = f.parentGroupId ?? null;
            const list = map.get(key) ?? [];
            list.push(f);
            map.set(key, list);
        }
        for (const list of map.values()) list.sort((a, b) => a.slug.localeCompare(b.slug));
        return map;
    });

    const searching = $derived(query.trim() !== '');

    const treeRows = $derived.by(() => {
        const out: { folder: Group; depth: number }[] = [];
        const inScope = new Set(scoped.map(f => f.id));
        const roots = scoped
            .filter(f => !f.parentGroupId || !inScope.has(f.parentGroupId))
            .sort((a, b) => a.slug.localeCompare(b.slug));

        function walk(parentId: string, depth: number) {
            const children = childrenByParent.get(parentId) ?? [];
            for (const f of children) {
                out.push({folder: f, depth});
                if (expandedIds.has(f.id)) walk(f.id, depth + 1);
            }
        }

        for (const f of roots) {
            out.push({folder: f, depth: 0});
            if (expandedIds.has(f.id)) walk(f.id, 1);
        }
        return out;
    });

    const searchMatches = $derived.by(() => {
        if (!searching) return [] as Group[];
        const q = query.trim().toLowerCase();
        return scoped
            .filter(f => f.slug.toLowerCase().includes(q))
            .sort((a, b) => a.slug.localeCompare(b.slug));
    });

    // Flat list of currently visible folders for keyboard nav
    const navFolders = $derived(searching ? searchMatches : treeRows.map(r => r.folder));
    let activeIndex = $state(0);

    const createSourceId = $derived(
        sourceId ?? (new Set(folders.map(f => f.sourceId)).size === 1 ? folders[0]?.sourceId : undefined)
    );
    const showCreate = $derived(
        searching
        && !!createSourceId
        && !scoped.some(f => f.slug.toLowerCase() === query.trim().toLowerCase())
    );
    const navCount = $derived(navFolders.length + (showCreate ? 1 : 0));
    let creating = $state(false);

    $effect(() => {
        query;
        expandedIds;
        if (activeIndex >= navCount) activeIndex = 0;
    });

    async function createFolder() {
        const slug = query.trim();
        if (!slug || !createSourceId || creating) return;
        creating = true;
        try {
            const g = await Group.createFolder(slug, createSourceId);
            folders = [...folders, g];
            pick(g.id);
        } catch (e) {
            loadError = String(e);
        } finally {
            creating = false;
        }
    }

    function hasChildren(id: string): boolean {
        return (childrenByParent.get(id)?.length ?? 0) > 0;
    }

    function ancestorPath(folder: Group): string {
        const parts: string[] = [];
        let p = folder.parentGroupId ? byId.get(folder.parentGroupId) : undefined;
        let guard = 0;
        while (p && guard++ < 32) {
            parts.unshift(p.slug);
            p = p.parentGroupId ? byId.get(p.parentGroupId) : undefined;
        }
        return parts.join(' / ');
    }

    function pick(id: string) {
        onChange(id);
        open = false;
    }

    function toggleExpand(id: string) {
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        expandedIds = next;
    }

    function position() {
        if (!anchor || !popEl) return;
        const a = anchor.getBoundingClientRect();
        const m = popEl.getBoundingClientRect();
        const margin = 4;
        let top = a.bottom + margin;
        let left = a.left;
        if (top + m.height > window.innerHeight - 8) {
            top = Math.max(8, a.top - m.height - margin);
        }
        if (left + m.width > window.innerWidth - 8) {
            left = Math.max(8, a.right - m.width);
        }
        pos = {top, left};
    }

    function onDocPointerDown(e: PointerEvent) {
        if (!open) return;
        if (popEl?.contains(e.target as Node)) return;
        if (anchor?.contains(e.target as Node)) return;
        open = false;
    }

    function onKey(e: KeyboardEvent) {
        if (!open) return;
        const n = navCount;
        const onCreateRow = showCreate && activeIndex === navFolders.length;
        if (e.key === 'Escape') {
            open = false;
            e.preventDefault();
        } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            if (n > 0) activeIndex = (activeIndex + 1) % n;
        } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
            e.preventDefault();
            if (n > 0) activeIndex = (activeIndex - 1 + n) % n;
        } else if (e.key === 'ArrowRight' && !searching) {
            const f = navFolders[activeIndex];
            if (f && hasChildren(f.id) && !expandedIds.has(f.id)) {
                toggleExpand(f.id);
                e.preventDefault();
            }
        } else if (e.key === 'ArrowLeft' && !searching) {
            const f = navFolders[activeIndex];
            if (f && expandedIds.has(f.id)) {
                toggleExpand(f.id);
                e.preventDefault();
            }
        } else if (e.key === 'Enter') {
            // Bare Enter never creates by accident: it only creates when you've
            // navigated to the create row w/ tab/arrow
            if (onCreateRow) {
                createFolder();
                e.preventDefault();
                return;
            }
            const f = navFolders[activeIndex];
            if (f) {
                pick(f.id);
                e.preventDefault();
            }
        }
    }

    let wasOpen = false;

    $effect(() => {
        const isOpen = open;
        if (isOpen && !wasOpen) {
            wasOpen = true;
            untrack(() => {
                query = '';
                expandedIds = new Set();
            });
            if (!loaded) {
                loaded = true;
                Group.list()
                    .then(gs => {
                        folders = gs.filter(g => g.groupType === GroupType.Folder);
                        loadError = '';
                    })
                    .catch(e => {
                        loaded = false;
                        loadError = String(e);
                    });
            }
            queueMicrotask(() => {
                position();
                searchEl?.focus();
            });
            window.addEventListener('resize', position);
            window.addEventListener('scroll', position, true);
            document.addEventListener('pointerdown', onDocPointerDown);
            document.addEventListener('keydown', onKey);
            return () => {
                window.removeEventListener('resize', position);
                window.removeEventListener('scroll', position, true);
                document.removeEventListener('pointerdown', onDocPointerDown);
                document.removeEventListener('keydown', onKey);
            };
        }
        if (!isOpen && wasOpen) {
            wasOpen = false;
        }
    });

    $effect(() => {
        query;
        expandedIds;
        if (open) queueMicrotask(position);
    });
</script>

{#if open}
    <div
            class="pop"
            bind:this={popEl}
            style:top="{pos.top}px"
            style:left="{pos.left}px"
            role="menu"
            tabindex="-1"
    >
        <div class="search-row">
            <Search size={13} strokeWidth={1.75}/>
            <input
                    class="search-input"
                    type="text"
                    bind:value={query}
                    bind:this={searchEl}
                    placeholder="Search folders…"
            />
        </div>

        {#if loadError}
            <div class="load-error">{loadError}</div>
        {/if}
        <div class="list">
            {#if searching}
                {#each searchMatches as folder, i (folder.id)}
                    <div class="folder-row" class:selected={folder.id === value} class:active={i === activeIndex}>
                        <span class="disclosure-spacer"></span>
                        <button class="folder-name" type="button" tabindex="-1" onclick={() => pick(folder.id)}
                                onmouseenter={() => activeIndex = i}>
                            <Folder size={13} strokeWidth={1.75}/>
                            <span class="name-label">{folder.slug}</span>
                            {#if ancestorPath(folder)}
                                <span class="name-path">{ancestorPath(folder)}</span>
                            {/if}
                            {#if folder.id === value}
                                <Check size={13} strokeWidth={2}/>
                            {/if}
                        </button>
                    </div>
                {/each}
                {#if showCreate}
                    <div class="folder-row create" class:active={activeIndex === searchMatches.length}>
                        <span class="disclosure-spacer"></span>
                        <button
                                class="folder-name"
                                type="button"
                                tabindex="-1"
                                onclick={createFolder}
                                onmouseenter={() => activeIndex = searchMatches.length}
                        >
                            <FolderPlus size={13} strokeWidth={1.75}/>
                            <span class="name-label">Create folder</span>
                            <span class="create-name">{query.trim()}</span>
                        </button>
                    </div>
                {:else if searchMatches.length === 0}
                    <div class="empty">No folders</div>
                {/if}
            {:else}
                {#each treeRows as item, i (item.folder.id)}
                    {@const folder = item.folder}
                    {@const expanded = expandedIds.has(folder.id)}
                    {@const children = hasChildren(folder.id)}
                    <div
                            class="folder-row"
                            class:selected={folder.id === value}
                            class:active={i === activeIndex}
                            style:padding-left="{item.depth * 14}px"
                    >
                        {#if children}
                            <button
                                    class="disclosure"
                                    type="button"
                                    tabindex="-1"
                                    aria-label={expanded ? 'Collapse' : 'Expand'}
                                    onclick={() => toggleExpand(folder.id)}
                            >
                                {#if expanded}
                                    <ChevronDown size={12} strokeWidth={2}/>
                                {:else}
                                    <ChevronRight size={12} strokeWidth={2}/>
                                {/if}
                            </button>
                        {:else}
                            <span class="disclosure-spacer"></span>
                        {/if}
                        <button class="folder-name" type="button" tabindex="-1" onclick={() => pick(folder.id)}
                                onmouseenter={() => activeIndex = i}>
                            <Folder size={13} strokeWidth={1.75}/>
                            <span class="name-label">{folder.slug}</span>
                            {#if folder.id === value}
                                <Check size={13} strokeWidth={2}/>
                            {/if}
                        </button>
                    </div>
                {:else}
                    <div class="empty">No folders</div>
                {/each}
            {/if}
        </div>
    </div>
{/if}

<style>
    .pop {
        position: fixed;
        z-index: 1000;
        min-width: 220px;
        max-width: 320px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        box-shadow: var(--menu-shadow);
        padding: 4px;
        font-family: var(--font-ui);
        font-size: 13px;
        line-height: 1.4;
        color: var(--color-text-primary);
        max-height: 360px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .search-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: -4px -4px 4px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--menu-search-divider);
        color: var(--color-ui-muted);
    }

    .search-row :global(svg) {
        flex-shrink: 0;
    }

    .search-input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 13px;
        color: var(--color-text-primary);
        outline: none;
        padding: 0;
    }

    .search-input::placeholder {
        color: var(--color-ui-dulled);
    }

    .list {
        overflow-y: auto;
        flex: 1;
        scrollbar-width: thin;
        scrollbar-color: var(--menu-scrollbar-thumb) transparent;
    }

    .list::-webkit-scrollbar {
        width: 5px;
    }

    .list::-webkit-scrollbar-track {
        background: transparent;
    }

    .list::-webkit-scrollbar-thumb {
        background: var(--menu-scrollbar-thumb);
        border-radius: 3px;
    }

    .list::-webkit-scrollbar-thumb:hover {
        background: var(--menu-scrollbar-thumb-hover);
    }

    .folder-row {
        display: flex;
        align-items: stretch;
        border-radius: 5px;
    }

    .disclosure,
    .disclosure-spacer {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        flex-shrink: 0;
        border: 0;
        background: transparent;
        color: var(--color-ui-dulled);
        cursor: pointer;
    }

    .disclosure:hover {
        color: var(--color-text-primary);
    }

    .disclosure-spacer {
        cursor: default;
    }

    .folder-row.selected {
        background: var(--menu-item-hover);
    }

    .folder-row.active .folder-name {
        background: var(--menu-item-hover);
    }

    .folder-name {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
        padding: 6px 8px 6px 6px;
        border: 0;
        background: transparent;
        border-radius: 5px;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
    }

    .folder-name :global(svg) {
        flex-shrink: 0;
        color: var(--color-ui-muted);
    }

    /* Highlight is driven by .folder-row.active (set on mouseenter), so hover and
       keyboard nav share one cursor*/

    .name-label {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .name-path {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 11px;
        color: var(--color-ui-dulled);
    }

    .folder-row.create .name-label {
        color: var(--color-ui-muted);
    }

    .create-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .empty {
        padding: 8px 10px;
        color: var(--color-ui-muted);
        font-size: 12px;
    }

    .load-error {
        margin: 0 2px 4px;
        padding: 6px 10px;
        font-size: 11px;
        color: var(--color-accent);
        background: var(--error-bg);
        border-radius: 5px;
    }
</style>
