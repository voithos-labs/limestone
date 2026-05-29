<script lang="ts">
    import type {Component} from "svelte";
    import type {ViewField} from "$lib/models/View.svelte";
    import Group, {GroupType} from "$lib/models/Group";
    import {listSources} from "$lib/models/Source";
    import Menu from "./Menu.svelte";
    import InputPopover from "./InputPopover.svelte";
    import FolderValueEditor from "./FolderValueEditor.svelte";

    interface MenuItem { value: string; label: string; icon?: Component; }

    let {
        open = $bindable(false),
        anchor,
        field,
        value,
        sourceId,
        onChange
    }: {
        open: boolean;
        anchor: HTMLElement | null;
        field: ViewField;
        value: unknown;
        sourceId?: string;
        onChange: (newValue: unknown) => void;
    } = $props();

    let tagItems: MenuItem[] = $state([]);
    let sourceItems: MenuItem[] = $state([]);
    let tagsLoaded = false;
    let sourcesLoaded = false;

    $effect(() => {
        if (!open) return;
        if (field.type === 'tags' && !tagsLoaded) {
            tagsLoaded = true;
            Group.list()
                .then(gs => tagItems = gs
                    .filter(g => g.groupType === GroupType.Tag)
                    .map(g => ({value: g.id, label: g.slug})))
                .catch(() => {});
        }
        if (field.type === 'source' && !sourcesLoaded) {
            sourcesLoaded = true;
            listSources()
                .then(ss => sourceItems = ss.map(s => ({value: s.id, label: s.title})))
                .catch(() => {});
        }
    });

    const optionItems: MenuItem[] = $derived.by(() => {
        const opts = (field.config?.options ?? []) as Array<{value: string; label?: string}>;
        return opts.map(o => ({value: o.value, label: o.label ?? o.value}));
    });

    const booleanItems: MenuItem[] = [
        {value: 'true', label: 'true'},
        {value: 'false', label: 'false'}
    ];

    function asString(v: unknown): string {
        if (v === null || v === undefined) return '';
        return String(v);
    }

    function inputType(): 'text' | 'number' | 'date' {
        if (field.type === 'number') return 'number';
        if (field.type === 'date' || field.type === 'created_at' || field.type === 'updated_at') return 'date';
        return 'text';
    }

    function commitInput(s: string) {
        if (field.type === 'number') {
            const n = Number(s);
            onChange(Number.isFinite(n) ? n : null);
        } else {
            onChange(s);
        }
    }

    function toggleTag(id: string) {
        const arr = Array.isArray(value) ? [...value as string[]] : [];
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1);
        else arr.push(id);
        onChange(arr);
    }
</script>

{#if field.type === 'text' || field.type === 'title' || field.type === 'path' || field.type === 'number' || field.type === 'date' || field.type === 'created_at' || field.type === 'updated_at'}
    <InputPopover
            bind:open
            {anchor}
            value={asString(value)}
            inputType={inputType()}
            onChange={commitInput}
    />
{:else if field.type === 'boolean'}
    <Menu
            bind:open
            {anchor}
            items={booleanItems}
            selected={value === true ? 'true' : value === false ? 'false' : undefined}
            onSelect={(v) => onChange(v === 'true')}
            minWidth={120}
    />
{:else if field.type === 'select' || field.type === 'multiselect'}
    <Menu
            bind:open
            {anchor}
            items={optionItems}
            selected={typeof value === 'string' ? value : undefined}
            onSelect={(v) => onChange(v)}
            searchable={optionItems.length > 7}
    />
{:else if field.type === 'tags'}
    <Menu
            bind:open
            {anchor}
            items={tagItems}
            multiple
            selectedValues={Array.isArray(value) ? value as string[] : []}
            onSelect={toggleTag}
            searchable
            placeholder="Search tags…"
    />
{:else if field.type === 'folder'}
    <FolderValueEditor
            bind:open
            {anchor}
            value={typeof value === 'string' ? value : null}
            {sourceId}
            onChange={(v) => onChange(v)}
    />
{:else if field.type === 'source'}
    <Menu
            bind:open
            {anchor}
            items={sourceItems}
            selected={typeof value === 'string' ? value : undefined}
            onSelect={(v) => onChange(v)}
            searchable={sourceItems.length > 7}
            placeholder="Search sources…"
    />
{:else}
    <InputPopover
            bind:open
            {anchor}
            value={asString(value)}
            inputType="text"
            onChange={commitInput}
    />
{/if}
