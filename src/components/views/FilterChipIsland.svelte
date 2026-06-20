<script lang="ts">
    import type {Component} from "svelte";
    import {onMount} from "svelte";
    import {X} from "@lucide/svelte";
    import type {ViewField} from "$lib/models/View.svelte";
    import Menu from "./Menu.svelte";
    import FilterValueEditor from "./FilterValueEditor.svelte";
    import type {OpOption} from "$lib/views/filterDisplay";

    let {
        icon,
        fieldName,
        operator,
        opValue,
        opOptions,
        value,
        valuePills,
        rawValue,
        field,
        sourceId,
        autoOpenValue = false,
        onFieldClick,
        onOpChange,
        onValueChange,
        onRemove
    }: {
        icon: Component;
        fieldName: string;
        operator: string;
        opValue?: string;
        opOptions?: OpOption[];
        value?: string;
        valuePills?: { label: string; color: number }[] | undefined;
        rawValue?: unknown;
        field?: ViewField;
        sourceId?: string;
        autoOpenValue?: boolean;
        onFieldClick?: () => void;
        onOpChange?: (op: string) => void;
        onValueChange?: (value: unknown) => void;
        onRemove?: () => void;
    } = $props();

    const Icon = $derived(icon);

    let opEl: HTMLButtonElement | null = $state(null);
    let opOpen = $state(false);

    let valueEl: HTMLButtonElement | null = $state(null);
    let valueOpen = $state(false);

    onMount(() => {
        if (autoOpenValue && field && onValueChange) valueOpen = true;
    });

    function handleOpClick() {
        if (opOptions && opOptions.length > 0 && onOpChange) {
            opOpen = !opOpen;
        }
    }

    function handleValueClick() {
        if (field && onValueChange) {
            valueOpen = !valueOpen;
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
        <button
                class="seg seg-value"
                class:open={valueOpen}
                class:empty={value === ''}
                type="button"
                onclick={handleValueClick}
                bind:this={valueEl}
        >
            {#if valuePills && valuePills.length}
                <span class="value-pills">
                    {#each valuePills as p (p.label)}
                        <span class="vpill tag-c{p.color}">{p.label}</span>
                    {/each}
                </span>
            {:else}
                <span class="seg-label">{value === '' ? 'empty' : value}</span>
            {/if}
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

{#if field && onValueChange}
    <FilterValueEditor
            bind:open={valueOpen}
            anchor={valueEl}
            {field}
            value={rawValue}
            op={opValue}
            {sourceId}
            onChange={(v) => onValueChange?.(v)}
    />
{/if}

<style>
    .chip {
        display: inline-flex;
        align-items: stretch;
        height: 28px;
        background: var(--chip-bg);
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
        background: var(--chip-bg-hover);
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
        background: var(--chip-seg-hover);
        color: var(--color-text-secondary);
    }

    .seg:active {
        background: var(--chip-seg-active);
    }

    .seg.open {
        background: var(--chip-seg-active);
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

    .seg-value.empty {
        color: var(--color-ui-muted);
        font-style: italic;
        font-weight: 400;
    }

    .value-pills {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .vpill {
        display: inline-flex;
        align-items: center;
        padding: 0 6px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        line-height: 1.5;
        white-space: nowrap;
        background: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-bg-l, 90%));
        color: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-fg-l, 30%));
    }

    .divider {
        width: 1px;
        margin: 6px 0;
        background: var(--chip-divider);
        flex-shrink: 0;
    }

    .seg-remove {
        padding: 0 7px;
    }

    .seg-remove:hover {
        background: var(--chip-seg-hover);
        color: var(--color-text-primary);
    }
</style>
