<script lang="ts">
    /**
     * todo:
     */
    import {untrack} from "svelte";
    import {Check, Plus, PaintBucket, Trash2, ArrowLeft, X} from "@lucide/svelte";
    import type {ViewField} from "$lib/models/View.svelte";

    interface TagOption {
        value: string;
        color: number;
    }

    interface Props {
        open: boolean;
        anchor: HTMLElement | null;
        field: ViewField;
        value: unknown;
        multiple?: boolean;
        onChange: (value: unknown) => void;
        onRenameOption?: (oldValue: string, newValue: string) => void;
    }

    let {
        open = $bindable(false),
        anchor,
        field,
        value,
        multiple = false,
        onChange,
        onRenameOption
    }: Props = $props();

    let popEl: HTMLDivElement | null = $state(null);
    let searchEl: HTMLInputElement | null = $state(null);
    let pos: { top: number; left: number } = $state({top: 0, left: 0});
    let query = $state('');
    let colorEditFor: string | null = $state(null);
    let confirmDeleteFor: string | null = $state(null);
    let renamingFor: string | null = $state(null);
    let renameDraft = $state('');
    let renameInput: HTMLInputElement | null = $state(null);

    function startRename(opt: TagOption) {
        renamingFor = opt.value;
        renameDraft = opt.value;
        colorEditFor = null;
        confirmDeleteFor = null;
        queueMicrotask(() => {
            renameInput?.focus();
            renameInput?.select();
        });
    }

    function commitRename(oldValue: string) {
        const next = renameDraft.trim();
        renamingFor = null;
        if (!next || next === oldValue) return;
        if (options.some((o) => o.value === next)) return; // avoid collision
        if (Array.isArray(vf.config.options)) {
            vf.config.options = vf.config.options.map((o: TagOption) =>
                o.value === oldValue ? {...o, value: next} : o
            );
        }
        // Update the live selection so the cell reflects the new label immediately
        if (selectedValues.includes(oldValue)) {
            onChange(multiple ? selectedValues.map((v) => v === oldValue ? next : v) : next);
        }
        onRenameOption?.(oldValue, next);
    }

    const vf = $derived(field as ViewField);
    const options = $derived((vf.config.options ?? []) as TagOption[]);

    const selectedValues = $derived(
        multiple
            ? (Array.isArray(value) ? (value as string[]) : [])
            : (typeof value === 'string' && value ? [value] : [])
    );

    const filtered = $derived(
        query.trim() === ''
            ? options
            : options.filter((o) => o.value.toLowerCase().includes(query.trim().toLowerCase()))
    );

    const exact = $derived(options.some((o) => o.value === query.trim()));

    // Navigable rows: each filtered option, plus a trailing "create" row when the query is mot found
    const showCreate = $derived(query.trim() !== '' && !exact);
    const navCount = $derived(filtered.length + (showCreate ? 1 : 0));
    let activeIndex = $state(0);

    function isSelected(v: string): boolean {
        return selectedValues.includes(v);
    }

    function nextColor(): number {
        const used = new Set(options.map((o) => o.color));
        for (let i = 0; i < 16; i++) if (!used.has(i)) return i;
        return options.length % 16;
    }

    function pick(v: string) {
        if (multiple) {
            const arr = [...selectedValues];
            const i = arr.indexOf(v);
            if (i >= 0) arr.splice(i, 1);
            else arr.push(v);
            onChange(arr);
            query = '';
        } else {
            onChange(v);
            open = false;
        }
    }

    function clearSelection() {
        onChange(multiple ? [] : null);
        if (!multiple) open = false;
    }

    function createAndPick() {
        const v = query.trim();
        if (!v) return;
        const existing = Array.isArray(vf.config.options) ? vf.config.options : [];
        if (!existing.some((o: TagOption) => o.value === v)) {
            vf.config.options = [...existing, {value: v, color: nextColor()}];
        }
        pick(v);
    }

    function setColor(optValue: string, color: number) {
        if (!Array.isArray(vf.config.options)) return;
        // Reassign (not in-place mutate) so the change propagates to the table,
        // which reads colors from field.config.options.
        vf.config.options = vf.config.options.map((o: TagOption) =>
            o.value === optValue ? {...o, color} : o
        );
        colorEditFor = null;
    }

    function removeOption(optValue: string) {
        if (!Array.isArray(vf.config.options)) return;
        vf.config.options = vf.config.options.filter((o: TagOption) => o.value !== optValue);
        colorEditFor = null;
        confirmDeleteFor = null;
        // Drop the value from the current selection if present
        if (selectedValues.includes(optValue)) {
            if (multiple) onChange(selectedValues.filter((v) => v !== optValue));
            else onChange(null);
        }
    }

    function position() {
        if (!anchor || !popEl) return;
        const a = anchor.getBoundingClientRect();
        const m = popEl.getBoundingClientRect();
        const margin = 4;
        let top = a.bottom + margin;
        let left = a.left;
        if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - m.height - margin);
        if (left + m.width > window.innerWidth - 8) left = Math.max(8, a.right - m.width);
        pos = {top, left};
    }

    function onDocPointerDown(e: PointerEvent) {
        if (!open) return;
        const t = e.target as Node;
        if (popEl?.contains(t)) {
            // Clicking inside the menu but outside the open color panel dismisses it
            if (colorEditFor && !(e.target as HTMLElement).closest?.('.color-panel, .opt-icon')) {
                colorEditFor = null;
            }
            return;
        }
        if (anchor?.contains(t)) return;
        open = false;
    }

    function activateIndex(i: number) {
        if (showCreate && i === filtered.length) {
            createAndPick();
        } else if (filtered[i]) {
            pick(filtered[i].value);
        }
    }

    function onKey(e: KeyboardEvent) {
        if (!open) return;
        if (e.key === 'Escape') {
            open = false;
            e.preventDefault();
        } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            if (navCount > 0) activeIndex = (activeIndex + 1) % navCount;
        } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
            e.preventDefault();
            if (navCount > 0) activeIndex = (activeIndex - 1 + navCount) % navCount;
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIndex >= 0 && activeIndex < navCount) activateIndex(activeIndex);
            else if (showCreate) createAndPick();
            else if (filtered.length > 0) pick(filtered[0].value);
        }
    }

    // Reset/clamp the active row as the filtered set changes
    $effect(() => {
        query;
        if (activeIndex >= navCount) activeIndex = navCount > 0 ? 0 : 0;
    });

    let wasOpen = false;
    $effect(() => {
        const isOpen = open;
        if (isOpen && !wasOpen) {
            wasOpen = true;
            untrack(() => {
                query = '';
            });
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
        if (!isOpen && wasOpen) wasOpen = false;
    });

    $effect(() => {
        query;
        if (open) queueMicrotask(position);
    });
</script>

{#if open}
    <div class="pop" bind:this={popEl} style:top="{pos.top}px" style:left="{pos.left}px" role="menu" tabindex="-1">
        <div class="search-row">
            <input
                    class="search-input"
                    type="text"
                    bind:value={query}
                    bind:this={searchEl}
                    placeholder="Search or create…"
            />
        </div>
        <div class="list">
            {#each filtered as opt, i (opt.value)}
                <div class="opt-row" class:active={i === activeIndex} class:confirming={confirmDeleteFor === opt.value}>
                    {#if renamingFor === opt.value}
                        <span class="opt rename">
                            <input
                                    class="rename-input"
                                    bind:this={renameInput}
                                    bind:value={renameDraft}
                                    onkeydown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === 'Enter') { e.preventDefault(); commitRename(opt.value); }
                                        else if (e.key === 'Escape') { e.preventDefault(); renamingFor = null; }
                                    }}
                                    onblur={() => commitRename(opt.value)}
                            />
                        </span>
                    {:else}
                        <button
                                class="opt"
                                type="button"
                                tabindex="-1"
                                onclick={() => pick(opt.value)}
                                ondblclick={(e) => { e.stopPropagation(); startRename(opt); }}
                                onmouseenter={() => activeIndex = i}
                        >
                            <span class="pill tag-c{opt.color}">{opt.value}</span>
                        </button>
                    {/if}
                    {#if confirmDeleteFor === opt.value}
                        <button
                                class="opt-icon"
                                type="button"
                                tabindex="-1"
                                aria-label="Cancel delete"
                                onclick={(e) => { e.stopPropagation(); confirmDeleteFor = null; }}
                        >
                            <ArrowLeft size={14} strokeWidth={2}/>
                        </button>
                        <button
                                class="confirm-btn"
                                type="button"
                                tabindex="-1"
                                onclick={(e) => { e.stopPropagation(); removeOption(opt.value); }}
                        >
                            Confirm
                        </button>
                    {:else}
                        {#if i === activeIndex}
                            <button
                                    class="opt-icon"
                                    type="button"
                                    tabindex="-1"
                                    aria-label="Change color"
                                    onclick={(e) => { e.stopPropagation(); colorEditFor = colorEditFor === opt.value ? null : opt.value; }}
                            >
                                <PaintBucket size={14} strokeWidth={1.75}/>
                            </button>
                            <button
                                    class="opt-icon danger"
                                    type="button"
                                    tabindex="-1"
                                    aria-label="Delete option"
                                    onclick={(e) => { e.stopPropagation(); confirmDeleteFor = opt.value; colorEditFor = null; }}
                            >
                                <Trash2 size={14} strokeWidth={1.75}/>
                            </button>
                        {/if}
                        <span class="opt-check" class:shown={isSelected(opt.value)}>
                            <Check size={13} strokeWidth={2}/>
                        </span>
                    {/if}
                </div>
                {#if colorEditFor === opt.value}
                    <div class="color-panel">
                        <div class="swatch-grid">
                            {#each Array(16) as _, ci}
                                <button
                                        class="swatch tag-c{ci}"
                                        class:active={opt.color === ci}
                                        type="button"
                                        tabindex="-1"
                                        aria-label="Color {ci}"
                                        onclick={() => setColor(opt.value, ci)}
                                ></button>
                            {/each}
                        </div>
                    </div>
                {/if}
            {/each}

            {#if showCreate}
                <button
                        class="opt create"
                        class:active={activeIndex === filtered.length}
                        type="button"
                        tabindex="-1"
                        onclick={createAndPick}
                        onmouseenter={() => activeIndex = filtered.length}
                >
                    <Plus size={13} strokeWidth={1.75}/>
                    <span class="create-label">Create</span>
                    <span class="pill tag-c{nextColor()}">{query.trim()}</span>
                </button>
            {:else if filtered.length === 0}
                <div class="empty">No options</div>
            {/if}
        </div>
        {#if selectedValues.length > 0}
            <button class="clear-row" type="button" tabindex="-1" onclick={clearSelection}>
                <X size={13} strokeWidth={2}/>
                <span>Clear</span>
            </button>
        {/if}
    </div>
{/if}

<style>
    .pop {
        position: fixed;
        z-index: 1000;
        min-width: 200px;
        max-width: 320px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        box-shadow: var(--menu-shadow);
        padding: 4px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
        max-height: 360px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .search-row {
        margin: -4px -4px 4px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--menu-search-divider);
    }

    .search-input {
        width: 100%;
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

    .opt-row {
        display: flex;
        align-items: center;
        gap: 4px;
        position: relative;
        padding-right: 4px;
        border-radius: 5px;
    }

    .opt-row.active {
        background: var(--menu-item-hover);
    }

    .opt-row.confirming .pill {
        text-decoration: line-through;
        opacity: 0.6;
    }

    .confirm-btn {
        flex-shrink: 0;
        align-self: center;
        height: 24px;
        padding: 0 10px;
        border: 0;
        border-radius: 5px;
        background: var(--chip-bg);
        color: var(--color-text-primary);
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 120ms ease;
    }

    .confirm-btn:hover {
        background: var(--chip-bg-hover);
    }

    .opt.rename {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
        padding: 4px 6px;
    }

    .rename-input {
        width: 100%;
        padding: 2px 6px;
        border: 1px solid var(--color-border);
        border-radius: 4px;
        background: var(--color-bg);
        font: inherit;
        font-size: 13px;
        color: var(--color-text-primary);
        outline: none;
    }

    .rename-input:focus {
        border-color: var(--color-ui-muted);
    }

    .opt {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
        padding: 5px 8px;
        border: 0;
        background: transparent;
        border-radius: 5px;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .opt-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        align-self: center;
        width: 24px;
        height: 24px;
        border: 0;
        background: transparent;
        border-radius: 5px;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .opt-icon:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .opt-icon.danger:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .clear-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        margin-top: 4px;
        padding: 7px 10px;
        border: 0;
        border-top: 1px solid var(--menu-search-divider);
        background: transparent;
        font: inherit;
        font-size: 12px;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: color 120ms ease;
    }

    .clear-row:hover {
        color: var(--color-text-primary);
    }

    .clear-row :global(svg) {
        flex-shrink: 0;
    }

    .color-panel {
        padding: 4px 8px 8px 10px;
    }

    .swatch-grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 5px;
    }

    .swatch {
        aspect-ratio: 1 / 1;
        padding: 0;
        border: 1.5px solid transparent;
        border-radius: 5px;
        cursor: pointer;
        background: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-bg-l, 90%));
    }

    .swatch.active {
        border-color: var(--color-text-primary);
    }

    .opt.create:hover,
    .opt.create.active {
        background: var(--menu-item-hover);
    }

    .opt-check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        flex-shrink: 0;
        color: var(--color-accent);
        visibility: hidden;
    }

    .opt-check.shown {
        visibility: visible;
    }

    .create .create-label {
        color: var(--color-ui-muted);
        margin-left: 0;
    }

    .create :global(svg) {
        margin-left: 0;
        color: var(--color-ui-muted);
    }

    .pill {
        display: inline-flex;
        align-items: center;
        max-width: 200px;
        padding: 1px 8px;
        border-radius: 4px;
        font-size: 11px;
        line-height: 1.55;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        background: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-bg-l, 90%));
        color: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-fg-l, 30%));
    }

    .empty {
        padding: 8px 10px;
        color: var(--color-ui-muted);
        font-size: 12px;
    }
</style>
