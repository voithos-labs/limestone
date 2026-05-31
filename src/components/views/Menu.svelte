<script lang="ts">
    import {untrack} from "svelte";
    import {Check, Search, ChevronRight} from "@lucide/svelte";
    import type {MenuItem, MenuEntry} from "$lib/views/menuTypes";
    import {isMenuItem as isItem} from "$lib/views/menuTypes";
    import Menu from "./Menu.svelte";

    let {
        open = $bindable(false),
        anchor,
        items,
        selected,
        selectedValues = [],
        multiple = false,
        onSelect,
        minWidth = 160,
        searchable = false,
        placeholder = 'Search…',
        placement = 'bottom',
        header
    }: {
        open: boolean;
        anchor: HTMLElement | null;
        items: MenuEntry[];
        selected?: string;
        selectedValues?: string[];
        multiple?: boolean;
        onSelect: (value: string) => void;
        minWidth?: number;
        searchable?: boolean;
        placeholder?: string;
        placement?: 'bottom' | 'right';
        header?: import('svelte').Snippet;
    } = $props();

    function isChecked(value: string): boolean {
        return multiple ? selectedValues.includes(value) : selected === value;
    }

    let menuEl: HTMLDivElement | null = $state(null);
    let pos: { top: number; left: number } = $state({top: 0, left: 0});
    let activeIndex = $state(-1);
    let query = $state('');
    let searchEl: HTMLInputElement | null = $state(null);

    // ── Submenu (single open slot, always mounted, controlled via bound open) ──
    let subOpen = $state(false);
    let subAnchor: HTMLElement | null = $state(null);
    let subItems: MenuEntry[] = $state([]);

    const filtered = $derived(
        !searchable || query.trim() === ''
            ? items
            : items.filter((i): i is MenuItem => isItem(i) && i.label.toLowerCase().includes(query.trim().toLowerCase()))
    );

    const actionable = $derived(filtered.filter(isItem));

    function position() {
        if (!anchor || !menuEl) return;
        const a = anchor.getBoundingClientRect();
        const m = menuEl.getBoundingClientRect();
        const margin = 4;
        let top: number;
        let left: number;
        if (placement === 'right') {
            top = a.top;
            left = a.right + margin;
            if (left + m.width > window.innerWidth - 8) {
                left = Math.max(8, a.left - m.width - margin);
            }
            if (top + m.height > window.innerHeight - 8) {
                top = Math.max(8, window.innerHeight - 8 - m.height);
            }
        } else {
            top = a.bottom + margin;
            left = a.left;
            if (top + m.height > window.innerHeight - 8) {
                top = Math.max(8, a.top - m.height - margin);
            }
            if (left + m.width > window.innerWidth - 8) {
                left = Math.max(8, a.right - m.width);
            }
        }
        pos = {top, left};
    }

    function onDocPointerDown(e: PointerEvent) {
        if (!open) return;
        if (menuEl?.contains(e.target as Node)) return;
        if (anchor?.contains(e.target as Node)) return;
        open = false;
    }

    function onKey(e: KeyboardEvent) {
        if (!open) return;
        // While a submenu is open it owns the keyboard, esc backs
        if (subOpen) return;
        if (e.key === 'Escape') {
            open = false;
            e.preventDefault();
            return;
        }
        if (e.key === 'ArrowDown') {
            activeIndex = actionable.length === 0 ? -1 : (activeIndex + 1) % actionable.length;
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            activeIndex = actionable.length === 0 ? -1 : (activeIndex - 1 + actionable.length) % actionable.length;
            e.preventDefault();
        } else if (e.key === 'Enter' && activeIndex >= 0 && actionable[activeIndex]) {
            activate(actionable[activeIndex], activeRowEl());
            e.preventDefault();
        }
    }

    function activeRowEl(): HTMLElement | null {
        const value = actionable[activeIndex]?.value;
        return value ? menuEl?.querySelector(`[data-mi="${value}"]`) ?? null : null;
    }

    let wasOpen = false;

    $effect(() => {
        const isOpen = open;
        if (isOpen && !wasOpen) {
            wasOpen = true;
            untrack(() => {
                activeIndex = actionable.findIndex(i => i.value === selected);
                if (activeIndex < 0 && actionable.length > 0) activeIndex = 0;
                if (query !== '') query = '';
                subOpen = false;
            });
            queueMicrotask(() => {
                position();
                if (searchable) searchEl?.focus();
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
        if (open) {
            queueMicrotask(position);
            untrack(() => {
                if (actionable.length > 0 && (activeIndex < 0 || activeIndex >= actionable.length)) {
                    activeIndex = 0;
                }
            });
        }
    });

    function pick(value: string) {
        onSelect(value);
        if (!multiple) open = false;
    }

    function activate(entry: MenuItem, rowEl: HTMLElement | null) {
        if (entry.children && entry.children.length > 0) {
            subItems = entry.children;
            subAnchor = rowEl;
            subOpen = true;
        } else {
            pick(entry.value);
        }
    }

    function hover(entry: MenuItem, i: number, rowEl: HTMLElement) {
        activeIndex = i;
        if (entry.children && entry.children.length > 0) {
            subItems = entry.children;
            subAnchor = rowEl;
            subOpen = true;
        } else {
            subOpen = false;
        }
    }

    function handleChildSelect(value: string) {
        onSelect(value);
        open = false;
    }
</script>

{#if open}
    <div
            class="menu"
            bind:this={menuEl}
            style:top="{pos.top}px"
            style:left="{pos.left}px"
            style:min-width="{minWidth}px"
            role="menu"
            tabindex="-1"
    >
        {#if header}
            <div class="menu-header">{@render header()}</div>
        {/if}
        {#if searchable}
            <div class="search-row">
                <Search size={13} strokeWidth={1.75}/>
                <input
                        class="search-input"
                        type="text"
                        bind:value={query}
                        bind:this={searchEl}
                        placeholder={placeholder}
                />
            </div>
        {/if}
        <div class="list">
            {#each filtered as entry, i (isItem(entry) ? entry.value : 'd' + i)}
                {#if isItem(entry)}
                    {@const Icon = entry.icon}
                    {@const itemIdx = actionable.indexOf(entry)}
                    {@const hasChildren = !!entry.children && entry.children.length > 0}
                    <button
                            class="menu-item"
                            class:active={activeIndex === itemIdx}
                            class:selected={isChecked(entry.value)}
                            type="button"
                            role="menuitem"
                            data-mi={entry.value}
                            onclick={(e) => activate(entry, e.currentTarget as HTMLElement)}
                            onmouseenter={(e) => hover(entry, itemIdx, e.currentTarget as HTMLElement)}
                    >
                        {#if Icon}
                            <span class="item-icon"><Icon size={13} strokeWidth={1.75}/></span>
                        {/if}
                        <span class="item-label">{entry.label}</span>
                        {#if hasChildren}
                            <ChevronRight size={13} strokeWidth={2}/>
                        {:else if isChecked(entry.value)}
                            <Check size={13} strokeWidth={2}/>
                        {/if}
                    </button>
                {:else}
                    <div class="menu-divider" role="separator"></div>
                {/if}
            {:else}
                <div class="empty">No results</div>
            {/each}
        </div>

        <Menu
                bind:open={subOpen}
                anchor={subAnchor}
                items={subItems}
                {selected}
                {selectedValues}
                {multiple}
                onSelect={handleChildSelect}
                {minWidth}
                placement="right"
        />
    </div>
{/if}

<style>
    .menu {
        position: fixed;
        z-index: 1000;
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

    .menu-header {
        margin: -4px -4px 4px;
        padding: 6px;
        border-bottom: 1px solid var(--menu-search-divider);
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
        padding-right: 0;
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

    .menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
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

    .menu-item.active {
        background: var(--menu-item-hover);
    }

    .menu-item.selected :global(svg) {
        color: var(--color-accent);
    }

    .item-icon {
        display: inline-flex;
        align-items: center;
        color: var(--color-ui-muted);
        flex-shrink: 0;
    }

    .item-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .empty {
        padding: 8px 10px;
        color: var(--color-ui-muted);
        font-size: 12px;
    }

    .menu-divider {
        height: 1px;
        margin: 4px 6px;
        background: var(--color-border);
    }
</style>
