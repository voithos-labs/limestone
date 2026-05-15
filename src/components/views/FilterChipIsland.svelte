<script lang="ts">
    import type {Component} from "svelte";
    import {X} from "@lucide/svelte";
    import Menu from "./Menu.svelte";
    import type {OpOption} from "$lib/views/filterDisplay";

    let {
        icon,
        fieldName,
        operator,
        opValue,
        opOptions,
        value,
        onFieldClick,
        onOpChange,
        onValueClick,
        onRemove
    }: {
        icon: Component;
        fieldName: string;
        operator: string;
        opValue?: string;
        opOptions?: OpOption[];
        value?: string;
        onFieldClick?: () => void;
        onOpChange?: (op: string) => void;
        onValueClick?: () => void;
        onRemove?: () => void;
    } = $props();

    const Icon = $derived(icon);

    let opEl: HTMLButtonElement | null = $state(null);
    let opOpen = $state(false);

    function handleOpClick() {
        if (opOptions && opOptions.length > 0 && onOpChange) {
            opOpen = !opOpen;
        }
    }
</script>

<div class="chip">
    <button class="seg seg-field" type="button" onclick={onFieldClick}>
        <Icon size={13} strokeWidth={1.75}/>
        <span class="seg-label">{fieldName}</span>
    </button>

    <span class="divider"></span>

    <button
            class="seg seg-op"
            class:open={opOpen}
            type="button"
            onclick={handleOpClick}
            bind:this={opEl}
    >
        <span class="seg-label">{operator}</span>
    </button>

    {#if value !== undefined}
        <span class="divider"></span>
        <button class="seg seg-value" type="button" onclick={onValueClick}>
            <span class="seg-label">{value}</span>
        </button>
    {/if}

    {#if onRemove}
        <span class="divider"></span>
        <button class="seg seg-remove" type="button" aria-label="Remove filter" onclick={onRemove}>
            <X size={12} strokeWidth={2}/>
        </button>
    {/if}
</div>

<Menu
        bind:open={opOpen}
        anchor={opEl}
        items={opOptions ?? []}
        selected={opValue}
        onSelect={(v) => onOpChange?.(v)}
        minWidth={140}
/>

<style>
    .chip {
        display: inline-flex;
        align-items: stretch;
        height: 28px;
        background: rgba(0, 0, 0, 0.045);
        border: none;
        border-radius: 6px;
        font-family: var(--font-ui);
        font-size: 12px;
        line-height: 1.45;
        color: var(--color-ui-muted);
        overflow: hidden;
        transition: color 120ms ease, background-color 120ms ease;
    }

    .chip:hover {
        background: rgba(0, 0, 0, 0.06);
    }

    .seg {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 0 9px;
        background: transparent;
        border: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 100ms ease, color 100ms ease;
    }

    .seg:hover {
        background: rgba(0, 0, 0, 0.04);
        color: var(--color-text-secondary);
    }

    .seg:active {
        background: rgba(0, 0, 0, 0.07);
    }

    .seg.open {
        background: rgba(0, 0, 0, 0.07);
        color: var(--color-text-primary);
    }

    .seg-label {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .seg-field {
        font-weight: 500;
        color: var(--color-text-secondary);
        padding-right: 8px;
    }

    .seg-field :global(svg) {
        color: var(--color-ui-muted);
        flex-shrink: 0;
    }

    .seg-op {
        padding-left: 8px;
        padding-right: 8px;
    }

    .seg-value {
        color: var(--color-text-secondary);
        font-weight: 500;
        padding-left: 8px;
    }

    .divider {
        width: 1px;
        margin: 6px 0;
        background: rgba(0, 0, 0, 0.08);
        flex-shrink: 0;
    }

    .seg-remove {
        padding: 0 7px;
    }

    .seg-remove:hover {
        background: rgba(0, 0, 0, 0.04);
        color: var(--color-text-primary);
    }
</style>
