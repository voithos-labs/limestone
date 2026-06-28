<script lang="ts">
    import {contextMenu, isCtxItem, type CtxItem} from "$lib/contextMenu.svelte";
    import {onMount} from "svelte";

    let menuEl: HTMLDivElement | null = $state(null);
    let pos: { top: number; left: number } | null = $state(null);

    // Clamp into the viewport once rendered (so it doesn't spill off-screen)
    $effect(() => {
        if (!contextMenu.open || !menuEl) {
            pos = null;
            return;
        }
        const m = menuEl.getBoundingClientRect();
        let left = contextMenu.x;
        let top = contextMenu.y;
        if (left + m.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - m.width);
        if (top + m.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - m.height);
        pos = {top, left};
    });

    function select(item: CtxItem) {
        if (item.disabled) return;
        contextMenu.close();
        item.action();
    }

    function onPointerDown(e: PointerEvent) {
        if (!contextMenu.open) return;
        if (menuEl?.contains(e.target as Node)) return;
        contextMenu.close();
    }

    function onKey(e: KeyboardEvent) {
        if (contextMenu.open && e.key === 'Escape') {
            e.preventDefault();
            contextMenu.close();
        }
    }

    onMount(() => {
        // Never show the native context menu anywhere.
        const suppress = (e: MouseEvent) => e.preventDefault();
        const onBlur = () => contextMenu.close();
        window.addEventListener('contextmenu', suppress);
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKey);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('contextmenu', suppress);
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('blur', onBlur);
        };
    });
</script>

{#if contextMenu.open}
    <div
            class="ctx-menu"
            bind:this={menuEl}
            style:top="{(pos ?? {top: contextMenu.y, left: contextMenu.x}).top}px"
            style:left="{(pos ?? {top: contextMenu.y, left: contextMenu.x}).left}px"
            role="menu"
            tabindex="-1"
    >
        {#each contextMenu.items as entry}
            {#if isCtxItem(entry)}
                {@const Icon = entry.icon}
                <button
                        class="ctx-item"
                        class:danger={entry.danger}
                        type="button"
                        disabled={entry.disabled}
                        onclick={() => select(entry)}
                >
                    {#if Icon}
                        <span class="ctx-icon"><Icon size={14} strokeWidth={1.75}/></span>
                    {/if}
                    <span class="ctx-label">{entry.label}</span>
                </button>
            {:else}
                <div class="ctx-divider"></div>
            {/if}
        {/each}
    </div>
{/if}

<style>
    .ctx-menu {
        position: fixed;
        z-index: 2000;
        min-width: 168px;
        padding: 4px;
        background: var(--color-bg-opaque, var(--color-bg));
        border: 1px solid var(--color-border);
        border-radius: 8px;
        box-shadow: var(--menu-shadow);
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .ctx-item {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 7px 10px;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .ctx-item:hover {
        background: var(--menu-item-hover);
    }

    .ctx-item:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .ctx-item:disabled:hover {
        background: transparent;
    }

    .ctx-icon {
        display: inline-flex;
        align-items: center;
        color: var(--color-ui-muted);
        flex-shrink: 0;
    }

    .ctx-item.danger {
        color: var(--color-accent);
    }

    .ctx-item.danger .ctx-icon {
        color: var(--color-accent);
    }

    .ctx-divider {
        height: 1px;
        margin: 4px 6px;
        background: var(--color-border);
    }
</style>
