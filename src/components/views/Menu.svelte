<script lang="ts">
    import {Check} from "@lucide/svelte";

    interface MenuItem {
        value: string;
        label: string;
    }

    let {
        open = $bindable(false),
        anchor,
        items,
        selected,
        onSelect,
        minWidth = 160
    }: {
        open: boolean;
        anchor: HTMLElement | null;
        items: MenuItem[];
        selected?: string;
        onSelect: (value: string) => void;
        minWidth?: number;
    } = $props();

    let menuEl: HTMLDivElement | null = $state(null);
    let pos: { top: number; left: number } = $state({top: 0, left: 0});
    let activeIndex = $state(-1);

    function position() {
        if (!anchor || !menuEl) return;
        const a = anchor.getBoundingClientRect();
        const m = menuEl.getBoundingClientRect();
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
        if (menuEl?.contains(e.target as Node)) return;
        if (anchor?.contains(e.target as Node)) return;
        open = false;
    }

    function onKey(e: KeyboardEvent) {
        if (!open) return;
        if (e.key === 'Escape') {
            open = false;
            e.preventDefault();
            return;
        }
        if (e.key === 'ArrowDown') {
            activeIndex = (activeIndex + 1) % items.length;
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            activeIndex = (activeIndex - 1 + items.length) % items.length;
            e.preventDefault();
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            pick(items[activeIndex].value);
            e.preventDefault();
        }
    }

    $effect(() => {
        if (open) {
            activeIndex = items.findIndex(i => i.value === selected);
            queueMicrotask(position);
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
    });

    function pick(value: string) {
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
        {#each items as item, i (item.value)}
            <button
                    class="menu-item"
                    class:active={activeIndex === i}
                    class:selected={selected === item.value}
                    type="button"
                    role="menuitem"
                    onclick={() => pick(item.value)}
                    onmouseenter={() => activeIndex = i}
            >
                <span class="item-label">{item.label}</span>
                {#if selected === item.value}
                    <Check size={13} strokeWidth={2}/>
                {/if}
            </button>
        {/each}
    </div>
{/if}

<style>
    .menu {
        position: fixed;
        z-index: 1000;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        box-shadow:
                0 8px 24px rgba(0, 0, 0, 0.10),
                0 2px 6px rgba(0, 0, 0, 0.06);
        padding: 4px;
        font-family: var(--font-ui);
        font-size: 13px;
        line-height: 1.4;
        color: var(--color-text-primary);
        max-height: 360px;
        overflow-y: auto;
    }

    .menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
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
        background: rgba(0, 0, 0, 0.05);
    }

    .menu-item.selected :global(svg) {
        color: var(--color-accent);
    }

    .item-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
