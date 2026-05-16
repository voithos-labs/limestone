<script lang="ts">
    import {untrack} from "svelte";
    import {Search, Folder, ChevronRight, ChevronLeft, Check} from "@lucide/svelte";
    import Group, {GroupType} from "$lib/models/Group";

    let {
        open = $bindable(false),
        anchor,
        value,
        onChange
    }: {
        open: boolean;
        anchor: HTMLElement | null;
        value: string | null;
        onChange: (id: string) => void;
    } = $props();

    let popEl: HTMLDivElement | null = $state(null);
    let searchEl: HTMLInputElement | null = $state(null);
    let pos: { top: number; left: number } = $state({top: 0, left: 0});

    let folders: Group[] = $state([]);
    let loaded = false;
    let currentParentId: string | null = $state(null);
    let query = $state('');

    const byId = $derived(new Map(folders.map(f => [f.id, f])));

    const childrenByParent = $derived.by(() => {
        const map = new Map<string | null, Group[]>();
        for (const f of folders) {
            const key = f.parentGroupId ?? null;
            const list = map.get(key) ?? [];
            list.push(f);
            map.set(key, list);
        }
        for (const list of map.values()) list.sort((a, b) => a.slug.localeCompare(b.slug));
        return map;
    });

    const currentFolder = $derived(currentParentId ? byId.get(currentParentId) ?? null : null);

    const searching = $derived(query.trim() !== '');

    const visible = $derived.by(() => {
        if (searching) {
            const q = query.trim().toLowerCase();
            return folders
                .filter(f => f.slug.toLowerCase().includes(q))
                .sort((a, b) => a.slug.localeCompare(b.slug));
        }
        return childrenByParent.get(currentParentId) ?? [];
    });

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

    function drill(id: string) {
        currentParentId = id;
        query = '';
    }

    function goBack() {
        currentParentId = currentFolder?.parentGroupId ?? null;
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
        if (e.key === 'Escape') {
            open = false;
            e.preventDefault();
        }
    }

    let wasOpen = false;

    $effect(() => {
        const isOpen = open;
        if (isOpen && !wasOpen) {
            wasOpen = true;
            untrack(() => {
                query = '';
                currentParentId = null;
            });
            if (!loaded) {
                loaded = true;
                Group.list()
                    .then(gs => folders = gs.filter(g => g.groupType === GroupType.Folder))
                    .catch(() => {});
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
        currentParentId;
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

        <div class="list">
            {#if !searching && currentFolder}
                <button class="back-row" type="button" onclick={goBack}>
                    <ChevronLeft size={14} strokeWidth={2}/>
                    <span class="back-label">{currentFolder.slug}</span>
                </button>
            {/if}

            {#each visible as folder (folder.id)}
                <div class="folder-row" class:selected={folder.id === value}>
                    <button class="folder-name" type="button" onclick={() => pick(folder.id)}>
                        <Folder size={13} strokeWidth={1.75}/>
                        <span class="name-label">{folder.slug}</span>
                        {#if searching && ancestorPath(folder)}
                            <span class="name-path">{ancestorPath(folder)}</span>
                        {/if}
                        {#if folder.id === value}
                            <Check size={13} strokeWidth={2}/>
                        {/if}
                    </button>
                    {#if !searching && hasChildren(folder.id)}
                        <button class="drill" type="button" aria-label="Open folder" onclick={() => drill(folder.id)}>
                            <ChevronRight size={14} strokeWidth={2}/>
                        </button>
                    {/if}
                </div>
            {:else}
                <div class="empty">No folders</div>
            {/each}
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
        margin-right: -4px;
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

    .back-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 6px 8px 6px 8px;
        margin-bottom: 2px;
        border: 0;
        background: transparent;
        border-radius: 5px;
        color: var(--color-ui-muted);
        font: inherit;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
    }

    .back-row:hover {
        background: var(--menu-item-hover);
        color: var(--color-text-primary);
    }

    .back-label {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .folder-row {
        display: flex;
        align-items: stretch;
        border-radius: 5px;
    }

    .folder-row.selected {
        background: var(--menu-item-hover);
    }

    .folder-name {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
        padding: 6px 8px 6px 10px;
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

    .folder-name:hover {
        background: var(--menu-item-hover);
    }

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

    .drill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        flex-shrink: 0;
        border: 0;
        background: transparent;
        border-radius: 5px;
        color: var(--color-ui-muted);
        cursor: pointer;
    }

    .drill:hover {
        background: var(--menu-item-hover);
        color: var(--color-text-primary);
    }

    .empty {
        padding: 8px 10px;
        color: var(--color-ui-muted);
        font-size: 12px;
    }
</style>
