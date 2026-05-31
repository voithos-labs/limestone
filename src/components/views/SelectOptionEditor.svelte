<script lang="ts">
    /**
     * todo:
     */
    import {untrack} from "svelte";
    import {Check, Plus, Ellipsis} from "@lucide/svelte";
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
    }

    let {
        open = $bindable(false),
        anchor,
        field,
        value,
        multiple = false,
        onChange
    }: Props = $props();

    let popEl: HTMLDivElement | null = $state(null);
    let searchEl: HTMLInputElement | null = $state(null);
    let pos: { top: number; left: number } = $state({top: 0, left: 0});
    let query = $state('');
    let colorEditFor: string | null = $state(null);

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

    function createAndPick() {
        const v = query.trim();
        if (!v) return;
        if (!vf.config.options) vf.config.options = [];
        if (!options.some((o) => o.value === v)) {
            vf.config.options.push({value: v, color: nextColor()});
        }
        pick(v);
    }

    function setColor(optValue: string, color: number) {
        const opt = options.find((o) => o.value === optValue);
        if (opt) opt.color = color;
        colorEditFor = null;
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
        if (popEl?.contains(e.target as Node)) return;
        if (anchor?.contains(e.target as Node)) return;
        open = false;
    }

    function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            open = false;
            e.preventDefault();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (query.trim() && !exact) createAndPick();
            else if (filtered.length > 0) pick(filtered[0].value);
        }
    }

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
            return () => {
                window.removeEventListener('resize', position);
                window.removeEventListener('scroll', position, true);
                document.removeEventListener('pointerdown', onDocPointerDown);
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
                    onkeydown={onKey}
            />
        </div>
        <div class="list">
            {#each filtered as opt (opt.value)}
                <div class="opt-row">
                    <button class="opt" type="button" onclick={() => pick(opt.value)}>
                        <span class="pill tag-c{opt.color}">{opt.value}</span>
                        {#if isSelected(opt.value)}
                            <Check size={13} strokeWidth={2}/>
                        {/if}
                    </button>
                    <button
                            class="opt-color"
                            type="button"
                            aria-label="Change color"
                            onclick={(e) => { e.stopPropagation(); colorEditFor = colorEditFor === opt.value ? null : opt.value; }}
                    >
                        <Ellipsis size={14} strokeWidth={2}/>
                    </button>
                </div>
                {#if colorEditFor === opt.value}
                    <div class="swatches">
                        {#each Array(16) as _, i}
                            <button
                                    class="swatch tag-c{i}"
                                    class:active={opt.color === i}
                                    type="button"
                                    aria-label="Color {i}"
                                    onclick={() => setColor(opt.value, i)}
                            ></button>
                        {/each}
                    </div>
                {/if}
            {/each}

            {#if query.trim() && !exact}
                <button class="opt create" type="button" onclick={createAndPick}>
                    <Plus size={13} strokeWidth={1.75}/>
                    <span class="create-label">Create</span>
                    <span class="pill tag-c{nextColor()}">{query.trim()}</span>
                </button>
            {:else if filtered.length === 0}
                <div class="empty">No options</div>
            {/if}
        </div>
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
    }

    .opt-row:hover .opt-color {
        opacity: 1;
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

    .opt-color {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        border: 0;
        background: transparent;
        border-radius: 5px;
        color: var(--color-ui-muted);
        cursor: pointer;
        opacity: 0;
        transition: opacity 120ms ease;
    }

    .opt-color:hover {
        background: var(--menu-item-hover);
        color: var(--color-text-primary);
    }

    .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        padding: 6px 8px 8px;
    }

    .swatch {
        width: 18px;
        height: 18px;
        padding: 0;
        border: 1.5px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        background: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-bg-l, 90%));
    }

    .swatch.active {
        border-color: var(--color-text-primary);
    }

    .opt:hover {
        background: var(--menu-item-hover);
    }

    .opt :global(svg) {
        flex-shrink: 0;
        color: var(--color-ui-muted);
        margin-left: auto;
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
