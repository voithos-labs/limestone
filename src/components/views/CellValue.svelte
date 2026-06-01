<script lang="ts">
    import {Square} from "@lucide/svelte";
    import type {ViewField, MemberRow} from "$lib/models/View.svelte";
    import type {Source} from "$lib/models/Source";
    import {
        rawStatefulValue, statefulValue, rawArrayValue,
        tagClass, valueFor, folderDir, sourceName
    } from "$lib/views/fieldValue";
    import FolderCrumb from "./FolderCrumb.svelte";

    let {field, row, viewSlug, sources = []}: {
        field: ViewField;
        row: MemberRow;
        viewSlug: string;
        sources?: Source[];
    } = $props();
</script>

{#if field.type === 'boolean'}
    {@const on = rawStatefulValue(row, viewSlug, field.name) === true}
    <span class="bool" class:on>
        {#if on}<Square size={15} strokeWidth={2} fill="currentColor"/>{:else}<Square size={15} strokeWidth={2}/>{/if}
    </span>
{:else if field.type === 'select'}
    {@const v = statefulValue(row, viewSlug, field.name)}
    {#if v}<span class="pill {tagClass(field, v)}">{v}</span>{/if}
{:else if field.type === 'multiselect'}
    {@const arr = rawArrayValue(row, viewSlug, field.name)}
    <span class="pills">
        {#each arr as t (t)}<span class="pill {tagClass(field, t)}">{t}</span>{/each}
    </span>
{:else if field.type === 'folder'}
    <FolderCrumb dir={folderDir(row.rel_path)} rootLabel={sourceName(sources, row.source_id)}/>
{:else}
    {valueFor(field, row, viewSlug)}
{/if}

<style>
    .bool {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        height: var(--row-h);
        color: var(--color-ui-dulled);
        transition: color 120ms ease;
    }

    .bool.on {
        color: var(--color-accent);
    }

    .pills {
        display: inline-flex;
        gap: 4px;
        overflow: hidden;
        vertical-align: middle;
    }

    .pill {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        padding: 1px 8px;
        border-radius: 4px;
        font-size: 11px;
        line-height: 1.55;
        white-space: nowrap;
        background: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-bg-l, 90%));
        color: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-fg-l, 30%));
    }
</style>
