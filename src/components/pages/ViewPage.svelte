<script lang="ts">
    import type View from "$lib/models/View.svelte";
    import type {FilterNode, FilterLeaf, ViewField} from "$lib/models/View.svelte";
    import Group from "$lib/models/Group";
    import {getSource} from "$lib/models/Source";
    import FilterChipIsland from "../views/FilterChipIsland.svelte";
    import Menu from "../views/Menu.svelte";
    import {getFieldIcon, getOpLabel, opHasValue, formatFilterValue, opsFor} from "$lib/views/filterDisplay";
    import {VIEW_FIELD_OPS, isLeafActive} from "$lib/models/View.svelte";
    import {Plus} from "@lucide/svelte";
    import {onMount} from "svelte";

    let {view}: { view: View } = $props();

    interface Row {
        id: string;
        title: string;
        rel_path: string;
        created_at: string;
        updated_at: string;
    }

    let rows: Row[] = $state([]);
    let error = $state('');
    let loading = $state(true);
    let elapsedMs = $state(0);

    const fieldsById = $derived(new Map(view.fields.map((f: ViewField) => [f.id, f])));

    const leafFilters: FilterLeaf[] = $derived(
        view.filter.children.filter((n: FilterNode): n is FilterLeaf => 'field_id' in n)
    );

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
    }

    async function load() {
        loading = true;
        error = '';
        const start = performance.now();
        try {
            rows = await view.getMembers({limit: 200}) as Row[];
        } catch (e) {
            error = String(e);
        } finally {
            elapsedMs = performance.now() - start;
            loading = false;
        }
    }

    onMount(load);

    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFilterSig: string | null = null;

    function filterSignature(): string {
        return view.filter.children
            .filter(c => !('field_id' in c) || isLeafActive(c.op, c.value))
            .map(c => 'field_id' in c
                ? `L|${c.field_id}|${c.op}|${String(c.value)}`
                : `C|${c.op}|${c.children.length}`)
            .join(';');
    }

    $effect(() => {
        const sig = filterSignature();
        if (lastFilterSig === null) {
            lastFilterSig = sig;
            return;
        }
        if (sig === lastFilterSig) return;
        lastFilterSig = sig;
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(load, 250);
    });
</script>

<div class="view-page">
    <header class="view-header">
        <h2 class="view-title">{view.slug}</h2>
        <span class="view-meta">
            {#if loading}loading…{:else}{rows.length} docs · {elapsedMs.toFixed(0)}ms{/if}
        </span>
    </header>

    <div class="filter-bar">
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
                autoOpenValue={leaf === pendingFocusLeaf}
                onOpChange={(op) => changeOp(leaf, op)}
                onValueChange={(v) => changeValue(leaf, v)}
                onRemove={() => removeFilter(leaf)}
            />
        {/each}
        <button
                class="add-filter"
                type="button"
                bind:this={addFilterEl}
                onclick={() => addFilterOpen = !addFilterOpen}
        >
            <Plus size={12} strokeWidth={2}/>
            <span>Filter</span>
        </button>
        <Menu
                bind:open={addFilterOpen}
                anchor={addFilterEl}
                items={fieldPickerItems}
                onSelect={addFilterByField}
                searchable={fieldPickerItems.length > 7}
                placeholder="Search fields…"
        />
    </div>

    {#if error}
        <p class="error">{error}</p>
    {/if}

    <div class="table-wrap">
        <table class="basic-table">
            <thead>
                <tr>
                    <th>Title</th>
                    <th>Path</th>
                    <th>Created</th>
                    <th>Updated</th>
                </tr>
            </thead>
            <tbody>
                {#each rows as row (row.id)}
                    <tr>
                        <td class="cell-title">{row.title}</td>
                        <td class="cell-path">{row.rel_path}</td>
                        <td class="cell-time">{row.created_at}</td>
                        <td class="cell-time">{row.updated_at}</td>
                    </tr>
                {:else}
                    {#if !loading}
                        <tr><td colspan="4" class="empty">No documents</td></tr>
                    {/if}
                {/each}
            </tbody>
        </table>
    </div>
</div>

<style>
    .view-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 24px 32px;
        overflow: hidden;
    }

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
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 14px;
        flex-shrink: 0;
    }

    .add-filter {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 28px;
        padding: 0 10px;
        background: var(--chip-bg);
        border: none;
        border-radius: 6px;
        font-family: var(--font-ui);
        font-size: 12px;
        line-height: 1.45;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .add-filter:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .error {
        padding: 8px 12px;
        margin: 0 0 12px;
        font-size: 12px;
        color: var(--color-accent);
        background: var(--error-bg);
        border-radius: var(--radius-ui);
    }

    .table-wrap {
        flex: 1;
        overflow: auto;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-surface);
    }

    .basic-table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-ui);
        font-size: 13px;
    }

    .basic-table thead {
        position: sticky;
        top: 0;
        background: var(--color-surface);
        z-index: 1;
    }

    .basic-table th,
    .basic-table td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid var(--color-border);
        color: var(--color-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 300px;
    }

    .basic-table th {
        font-weight: 600;
        font-size: 12px;
        color: var(--color-ui-dulled);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .cell-path,
    .cell-time {
        color: var(--color-ui-muted);
        font-family: var(--font-mono, monospace);
        font-size: 12px;
    }

    .empty {
        padding: 16px;
        text-align: center;
        color: var(--color-ui-muted);
    }
</style>
