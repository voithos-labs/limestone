<script lang="ts">
    import type View from "$lib/models/View";
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
</script>

<div class="view-page">
    <header class="view-header">
        <h2 class="view-title">{view.slug}</h2>
        <span class="view-meta">
            {#if loading}loading…{:else}{rows.length} docs · {elapsedMs.toFixed(0)}ms{/if}
        </span>
    </header>

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
        margin-bottom: 16px;
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

    .error {
        padding: 8px 12px;
        margin: 0 0 12px;
        font-size: 12px;
        color: var(--color-accent);
        background: rgba(255, 0, 0, 0.05);
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
