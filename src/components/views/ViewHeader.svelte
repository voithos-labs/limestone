<script lang="ts">
    import type View from "$lib/models/View.svelte";
    import type {FilterNode, FilterLeaf, ViewField} from "$lib/models/View.svelte";
    import {VIEW_FIELD_OPS} from "$lib/models/View.svelte";
    import Group from "$lib/models/Group";
    import {getSource} from "$lib/models/Source";
    import FilterChipIsland from "./FilterChipIsland.svelte";
    import Menu from "./Menu.svelte";
    import {getFieldIcon, getOpLabel, opHasValue, formatFilterValue, opsFor} from "$lib/views/filterDisplay";
    import {Plus, Funnel, ChevronLeft, ChevronRight, Search} from "@lucide/svelte";
    import {onMount} from "svelte";

    let {view, loading, count, elapsedMs}: {
        view: View;
        loading: boolean;
        count: number;
        elapsedMs: number;
    } = $props();

    const fieldsById = $derived(new Map(view.fields.map((f: ViewField) => [f.id, f])));

    const leafFilters: FilterLeaf[] = $derived(
        view.filter.children.filter((n: FilterNode): n is FilterLeaf => 'field_id' in n)
    );

    const sourceScopeId: string | undefined = $derived.by(() => {
        for (const leaf of leafFilters) {
            const field = fieldsById.get(leaf.field_id);
            if (field?.type === 'source' && leaf.op === 'eq' && typeof leaf.value === 'string') {
                return leaf.value;
            }
        }
        return undefined;
    });

    let groupNames: Record<string, string> = $state({});
    let sourceNames: Record<string, string> = $state({});

    $effect(() => {
        const groupIds = new Set<string>();
        const sourceIds = new Set<string>();
        for (const leaf of leafFilters) {
            const field = fieldsById.get(leaf.field_id);
            if (!field) continue;
            if (field.type === 'folder') {
                if (typeof leaf.value === 'string') groupIds.add(leaf.value);
            } else if (field.type === 'tags') {
                if (Array.isArray(leaf.value)) {
                    for (const v of leaf.value) if (typeof v === 'string') groupIds.add(v);
                }
            } else if (field.type === 'source') {
                if (typeof leaf.value === 'string') sourceIds.add(leaf.value);
            }
        }
        for (const id of groupIds) {
            if (id in groupNames) continue;
            Group.fromID(id)
                .then(g => { groupNames = {...groupNames, [id]: g.slug}; })
                .catch(() => { groupNames = {...groupNames, [id]: id}; });
        }
        for (const id of sourceIds) {
            if (id in sourceNames) continue;
            getSource(id)
                .then(s => { sourceNames = {...sourceNames, [id]: s.title}; })
                .catch(() => { sourceNames = {...sourceNames, [id]: id}; });
        }
    });

    function displayValue(leaf: FilterLeaf, field: ViewField | undefined): string | undefined {
        if (!opHasValue(leaf.op)) return undefined;
        if (!field) return formatFilterValue(leaf.value);
        if (field.type === 'tags') {
            const arr = Array.isArray(leaf.value) ? leaf.value : [];
            if (arr.length === 0) return '';
            return arr.map(id => groupNames[String(id)] ?? String(id)).join(', ');
        }
        if (field.type === 'folder') {
            if (typeof leaf.value !== 'string') return '';
            return groupNames[leaf.value] ?? leaf.value;
        }
        if (field.type === 'source') {
            if (typeof leaf.value !== 'string') return '';
            return sourceNames[leaf.value] ?? leaf.value;
        }
        return formatFilterValue(leaf.value);
    }

    function removeFilter(node: FilterLeaf) {
        const i = view.filter.children.indexOf(node);
        if (i >= 0) view.filter.children.splice(i, 1);
    }

    function changeOp(node: FilterLeaf, newOp: string) {
        node.op = newOp;
    }

    function changeValue(node: FilterLeaf, newValue: unknown) {
        node.value = newValue;
    }

    function defaultValueFor(field: ViewField): unknown {
        return field.type === 'tags' ? [] : null;
    }

    let addFilterEl: HTMLButtonElement | null = $state(null);
    let addFilterOpen = $state(false);

    const fieldPickerItems = $derived(view.fields.map((f: ViewField) => ({
        value: f.id,
        label: f.name,
        icon: getFieldIcon(f.type)
    })));

    let pendingFocusLeaf: FilterLeaf | null = $state(null);

    function addFilterByField(fieldId: string) {
        const field = view.fields.find(f => f.id === fieldId);
        if (!field) return;
        const ops = VIEW_FIELD_OPS[field.type] ?? [];
        const op = ops[0] ?? 'eq';
        view.filter.children.push({
            field_id: field.id,
            op,
            value: defaultValueFor(field)
        });
        pendingFocusLeaf = view.filter.children[view.filter.children.length - 1] as FilterLeaf;
        if (view.state.filters_collapsed) view.state.filters_collapsed = false;
    }

    let chipsWidth = $state(0);
    let hasMounted = $state(false);
    onMount(() => { hasMounted = true; });
</script>

<header class="view-header">
    <h2 class="view-title">{view.slug}</h2>
    <span class="view-meta">
        {#if loading}loading…{:else}{count} docs · {elapsedMs.toFixed(0)}ms{/if}
    </span>
</header>

<div class="filter-bar">
    {#if leafFilters.length > 0}
        <button
                class="collapse-toggle"
                type="button"
                aria-label={view.state.filters_collapsed ? 'Show filters' : 'Hide filters'}
                onclick={() => view.state.filters_collapsed = !view.state.filters_collapsed}
        >
            <Funnel size={13} strokeWidth={1.75}/>
            {#if view.state.filters_collapsed}
                <ChevronRight size={13} strokeWidth={2}/>
            {:else}
                <ChevronLeft size={13} strokeWidth={2}/>
            {/if}
        </button>
    {/if}

    <div
            class="chips-wrap"
            class:collapsed={view.state.filters_collapsed}
            class:animate={hasMounted}
            style:max-width={view.state.filters_collapsed ? '0px' : chipsWidth + 'px'}
    >
        <div class="chips-inner" bind:clientWidth={chipsWidth}>
            {#each leafFilters as leaf (leaf)}
                {@const field = fieldsById.get(leaf.field_id)}
                <FilterChipIsland
                        icon={getFieldIcon(field?.type)}
                        fieldName={field?.name ?? 'unknown'}
                        operator={getOpLabel(leaf.op)}
                        opValue={leaf.op}
                        opOptions={opsFor(field?.type)}
                        value={displayValue(leaf, field)}
                        rawValue={leaf.value}
                        {field}
                        sourceId={sourceScopeId}
                        autoOpenValue={leaf === pendingFocusLeaf}
                        onOpChange={(op) => changeOp(leaf, op)}
                        onValueChange={(v) => changeValue(leaf, v)}
                        onRemove={() => removeFilter(leaf)}
                />
            {/each}
        </div>
    </div>

    <button
            class="add-filter"
            type="button"
            aria-label="Add filter"
            bind:this={addFilterEl}
            onclick={() => addFilterOpen = !addFilterOpen}
    >
        <Plus size={14} strokeWidth={2}/>
    </button>
    <Menu
            bind:open={addFilterOpen}
            anchor={addFilterEl}
            items={fieldPickerItems}
            onSelect={addFilterByField}
            searchable={fieldPickerItems.length > 7}
            placeholder="Search fields…"
    />

    <label class="search-chip">
        <Search size={13} strokeWidth={1.75}/>
        <input
                type="text"
                class="search-input"
                placeholder="Search…"
                value={(view.state.search ?? '')}
                oninput={(e) => view.state.search = (e.currentTarget as HTMLInputElement).value}
        />
    </label>
</div>

<style>
    .view-header {
        display: flex;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 12px;
        flex-shrink: 0;
    }

    .view-title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .view-meta {
        font-size: 12px;
        color: var(--color-ui-muted);
    }

    .filter-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 14px;
        flex-shrink: 0;
    }

    .collapse-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        height: 28px;
        padding: 0 7px;
        flex-shrink: 0;
        background: var(--chip-bg);
        border: none;
        border-radius: 6px;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .collapse-toggle:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .chips-wrap {
        overflow: hidden;
        flex-shrink: 0;
    }

    .chips-wrap.collapsed {
        margin-left: -6px;
    }

    .chips-wrap.animate {
        transition: max-width 240ms ease, margin-left 240ms ease;
    }

    .chips-inner {
        display: flex;
        gap: 6px;
        width: max-content;
    }

    .chips-wrap.animate .chips-inner {
        transition: transform 240ms ease, opacity 160ms ease;
    }

    .chips-wrap.collapsed .chips-inner {
        opacity: 0;
        transform: translateX(-10px);
    }

    .add-filter {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 28px;
        padding: 0 10px;
        flex-shrink: 0;
        background: var(--chip-bg);
        border: none;
        border-radius: 6px;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .add-filter:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .search-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        padding: 0 9px;
        flex: 1;
        min-width: 80px;
        background: transparent;
        border-radius: 6px;
        color: var(--color-ui-muted);
        font-family: var(--font-ui);
        font-size: 12px;
        line-height: 1.45;
        transition: background-color 120ms ease, color 120ms ease;
        cursor: text;
    }

    .search-chip:hover {
        background: var(--chip-bg);
        color: var(--color-text-secondary);
    }

    .search-chip:focus-within {
        background: var(--chip-bg-hover);
        color: var(--color-text-secondary);
    }

    .search-input {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: 0;
        outline: none;
        font: inherit;
        color: var(--color-text-primary);
        padding: 0;
    }

    .search-input::placeholder {
        color: var(--color-ui-muted);
    }
</style>
