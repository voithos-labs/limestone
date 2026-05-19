<script lang="ts">
    import type View from "$lib/models/View.svelte";
    import {isLeafActive} from "$lib/models/View.svelte";
    import ViewHeader from "../views/ViewHeader.svelte";
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
    <ViewHeader {view} {loading} count={rows.length} {elapsedMs}/>

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
